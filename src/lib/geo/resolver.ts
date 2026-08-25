/**
 * The resolver cascade: spreadsheet place names → boundary polygons.
 *
 * Stages, tried in order, stopping at the first confident match:
 *
 *   0. RESERVED FOR V2 — surveyed geometry. Documented no-op, see {@link stageZero}.
 *   1. Exact match on the normalized name, scoped to the resolved parent state.
 *   2. Alias lookup, state-scoped where the alias declares a state.
 *   3. Fuzzy match, scoped to the parent state, ≥ threshold, and only if
 *      EXACTLY ONE candidate clears it.
 *   4. Unresolved. Never guess.
 *
 * ## State before district, always
 *
 * The state is resolved first and its canonical name scopes every district
 * lookup. This is not a performance optimisation — it is the only thing
 * standing between this dataset and records landing 1,100 km from where they
 * belong.
 *
 * `Raigarh` is a real district of Chhattisgarh. `Raigad` is a real district of
 * Maharashtra. They differ by one letter, and the sample spells the Maharashtra
 * one "Raigarh" on three rows — so the correct answer for that exact string
 * depends entirely on which state the record is in. Four more names collide outright across states in this dataset —
 * Aurangabad, Bilaspur, Balrampur, Hamirpur, Pratapgarh — and Balrampur is live
 * in the sample under Uttar Pradesh while also existing in Chhattisgarh.
 *
 * A district lookup that is not scoped to a resolved state is not a slower
 * correct answer. It is a wrong answer that looks fine on the map.
 */

import type { BoundaryEntry, BoundaryIndex } from './boundaries';
import { districtCompositeKey, districtsIn } from './boundaries';
import type { AliasMap } from './aliases';
import { lookupDistrictAlias, lookupStateAlias } from './aliases';
import { similarityRatio } from './levenshtein';
import { isResolvablePlaceName, normalizePlaceName } from './normalize-place';

/* -------------------------------------------------------------------------- */
/* Stage 0 — reserved                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Stage 0: geometry-based resolution. RESERVED FOR V2, INTENTIONALLY A NO-OP.
 *
 * When a record carries its own surveyed polygon — V2's KMZ upload — that
 * geometry outranks every name-based strategy below it, because a surveyed
 * boundary is evidence and a name is a guess. Resolution will short-circuit
 * here and never consult the alias table or the fuzzy matcher at all.
 *
 * It is numbered 0 and wired into the cascade now, returning `null`, so that
 * adding it later means implementing this one function. Nothing downstream
 * needs renumbering, no consumer's switch statement changes, and the stage
 * ordering in the report stays stable across the V1/V2 boundary.
 *
 * CLAUDE.md: "The resolver cascade reserves stage 0 for geometry-based
 * resolution. Number the V1 stages 1–4 and leave stage 0 documented but
 * unimplemented."
 */
function stageZero(): null {
  return null;
}

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Which cascade stage produced a result. Mirrors `ResolverStage` in schema.ts. */
export type GeoStage = 0 | 1 | 2 | 3 | 4;

export const GEO_STAGE_LABELS: Readonly<Record<GeoStage, string>> = {
  0: 'Surveyed geometry (V2 — not implemented)',
  1: 'Exact name match',
  2: 'Known alias',
  3: 'Fuzzy match within state',
  4: 'Unresolved',
} as const;

/**
 * Fuzzy threshold. A candidate must score at least this to be considered.
 *
 * 0.88 as specified. Calibration against this dataset, for anyone tempted to
 * lower it:
 *
 * - `raigarh`   vs `raigad`    → 0.714  (below — different places, must not match)
 * - `mutksar`   vs `muktsar`   → 0.714  (below — transposition, handled by alias)
 * - `punjabb`   vs `punjab`    → 0.857  (below — one edit in a short name)
 * - `ludhiyana` vs `ludhiana`  → 0.889  (above — transliteration variant)
 * - `shravasti` vs `shrawasti` → 0.889  (above — live in the sample; the v/w
 *                                         variant this stage exists to catch)
 *
 * The 0.857 band is where the judgement lives. `punjabb` is a typo we would
 * like to catch, and `raigad` is a different district 1,100 km away that we
 * must not — and at these lengths they score within 0.06 of each other. The
 * threshold sits above both, which means the fuzzy stage misses some genuine
 * typos in short names. That is the correct trade: a missed typo surfaces as an
 * unresolved name the user can fix with one alias, while a wrong match is a
 * confident polygon in the wrong state that nobody notices.
 */
export const FUZZY_THRESHOLD = 0.88;

/** Outcome for a single name at one administrative level. */
export interface NameResolution {
  /** The value as it appeared in the spreadsheet. */
  readonly input: string;
  /** {@link normalizePlaceName} of `input`. */
  readonly normalized: string;
  readonly stage: GeoStage;
  /** The matched boundary, or `null` when unresolved. */
  readonly match: BoundaryEntry | null;
  /**
   * Confidence in `[0, 1]`.
   *
   * 1 for exact and alias matches, the similarity ratio for fuzzy, 0 for
   * unresolved. Exact and alias are both 1 because both are deterministic —
   * an alias is a human decision recorded in a reviewable file, not a guess.
   */
  readonly confidence: number;
  /** Why, in one line, for the report. */
  readonly detail: string;
  /**
   * Runners-up considered at stage 3, best first. Empty otherwise.
   *
   * Populated even when the stage FAILS on ambiguity, because "two districts
   * tied and I refused to choose" is the single most useful thing the report
   * can tell a user about an unresolved name.
   */
  readonly candidates: readonly { name: string; score: number }[];
}

/** Combined state + district outcome for one record. */
export interface RecordResolution {
  readonly state: NameResolution;
  /** `null` when the record had no district value to resolve. */
  readonly district: NameResolution | null;
  /** The effective stage — the weaker of the two, since both must land. */
  readonly stage: GeoStage;
  /** True when a district polygon was found. */
  readonly resolvedToDistrict: boolean;
  /** True when at least a state polygon was found. */
  readonly resolvedToState: boolean;
}

/* -------------------------------------------------------------------------- */
/* Stage implementations                                                       */
/* -------------------------------------------------------------------------- */

function unresolved(input: string, normalized: string, detail: string): NameResolution {
  return {
    input,
    normalized,
    stage: 4,
    match: null,
    confidence: 0,
    detail,
    candidates: [],
  };
}

/**
 * Stage 3: fuzzy match within a fixed candidate set.
 *
 * Two guards, and both are necessary:
 *
 * 1. The best score must clear {@link FUZZY_THRESHOLD}.
 * 2. Exactly one candidate may clear it. If two do, the stage FAILS rather than
 *    taking the higher score.
 *
 * The second guard is the one people remove to "improve the match rate", and it
 * is the one doing the real work. When two districts both score 0.9 the top
 * score is noise — a different typo in the same name would flip the order — and
 * "I am not sure" is a far better answer than a coin flip rendered as a
 * confident polygon on a map. The tied candidates are returned so the user can
 * resolve it by adding one alias.
 */
function fuzzyMatch(
  normalized: string,
  candidates: readonly BoundaryEntry[],
): { match: BoundaryEntry | null; scored: { name: string; score: number }[]; tied: boolean } {
  const scored = candidates
    .map((entry) => ({ entry, score: similarityRatio(normalized, entry.key) }))
    .sort((a, b) => b.score - a.score);

  const clearing = scored.filter((c) => c.score >= FUZZY_THRESHOLD);
  const top = scored.slice(0, 5).map((c) => ({ name: c.entry.name, score: round(c.score) }));

  if (clearing.length === 1) {
    return { match: clearing[0]?.entry ?? null, scored: top, tied: false };
  }

  return { match: null, scored: top, tied: clearing.length > 1 };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/* -------------------------------------------------------------------------- */
/* State resolution                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a state name through the cascade.
 *
 * State candidates are never scoped — there is no level above them — so stage 1
 * is a map lookup and stage 3 scores against all 36.
 */
export function resolveState(
  rawName: unknown,
  index: BoundaryIndex,
  aliases: AliasMap,
): NameResolution {
  if (!isResolvablePlaceName(rawName)) {
    return unresolved(
      typeof rawName === 'string' ? rawName : '',
      '',
      'No state value on this record.',
    );
  }

  const input = rawName;
  const normalized = normalizePlaceName(input);

  // Stage 0 — reserved for V2 surveyed geometry.
  if (stageZero() !== null) {
    /* istanbul ignore next — unreachable in V1 by construction */
  }

  // Stage 1 — exact.
  const exact = index.stateByKey.get(normalized);
  if (exact !== undefined) {
    return {
      input,
      normalized,
      stage: 1,
      match: exact,
      confidence: 1,
      detail: `Exact match on "${exact.name}".`,
      candidates: [],
    };
  }

  // Stage 2 — alias.
  const aliased = lookupStateAlias(aliases, normalized);
  if (aliased !== null) {
    const target = index.stateByKey.get(normalizePlaceName(aliased));
    if (target !== undefined) {
      return {
        input,
        normalized,
        stage: 2,
        match: target,
        confidence: 1,
        detail: `Alias "${normalized}" → "${target.name}".`,
        candidates: [],
      };
    }
    // The alias points at a state that is not in the boundary file. Report it
    // rather than falling through silently — a broken alias is a maintenance
    // problem the user can fix, and it should look different from a name that
    // was simply never mapped.
    return unresolved(
      input,
      normalized,
      `Alias maps "${normalized}" → "${aliased}", but no such state exists in the boundary file.`,
    );
  }

  // Stage 3 — fuzzy across all states.
  const { match, scored, tied } = fuzzyMatch(normalized, index.states);
  if (match !== null) {
    const score = scored[0]?.score ?? FUZZY_THRESHOLD;
    return {
      input,
      normalized,
      stage: 3,
      match,
      confidence: score,
      detail: `Fuzzy match to "${match.name}" at ${(score * 100).toFixed(1)}%.`,
      candidates: scored,
    };
  }

  // Stage 4 — unresolved.
  return {
    ...unresolved(
      input,
      normalized,
      tied
        ? `Ambiguous: more than one state scored above the ${FUZZY_THRESHOLD} threshold. Refusing to guess.`
        : `No state matched. Best candidate scored ${((scored[0]?.score ?? 0) * 100).toFixed(1)}%, below the ${(FUZZY_THRESHOLD * 100).toFixed(0)}% threshold.`,
    ),
    candidates: scored,
  };
}

/* -------------------------------------------------------------------------- */
/* District resolution                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a district name, scoped to an already-resolved parent state.
 *
 * `canonicalState` is required, not optional. Passing `null` does NOT widen the
 * search to all 724 districts — it returns unresolved. Widening would be the
 * intuitive fallback and it is precisely the bug this design exists to prevent:
 * an unscoped search is how `Raigarh` ends up in Maharashtra.
 */
export function resolveDistrict(
  rawName: unknown,
  canonicalState: string | null,
  index: BoundaryIndex,
  aliases: AliasMap,
): NameResolution {
  if (!isResolvablePlaceName(rawName)) {
    return unresolved(
      typeof rawName === 'string' ? rawName : '',
      '',
      'No district value on this record.',
    );
  }

  const input = rawName;
  const normalized = normalizePlaceName(input);

  if (canonicalState === null) {
    return unresolved(
      input,
      normalized,
      'Parent state did not resolve, so the district search has no safe scope. ' +
        'District names repeat across states; an unscoped match could place this record in the wrong state.',
    );
  }

  const scope = districtsIn(index, canonicalState);

  // Stage 0 — reserved for V2 surveyed geometry.
  if (stageZero() !== null) {
    /* istanbul ignore next — unreachable in V1 by construction */
  }

  // Stage 1 — exact, within the state.
  const exact = index.districtByStateAndKey.get(
    districtCompositeKey(canonicalState, normalized),
  );
  if (exact !== undefined) {
    return {
      input,
      normalized,
      stage: 1,
      match: exact,
      confidence: 1,
      detail: `Exact match on "${exact.name}" in ${canonicalState}.`,
      candidates: [],
    };
  }

  // Stage 2 — alias, preferring an entry scoped to this state.
  const alias = lookupDistrictAlias(aliases, normalized, canonicalState);
  if (alias !== null) {
    const target = index.districtByStateAndKey.get(
      districtCompositeKey(canonicalState, normalizePlaceName(alias.to)),
    );

    if (target !== undefined) {
      const scopeNote = alias.state === undefined ? '' : ` (scoped to ${alias.state})`;
      return {
        input,
        normalized,
        stage: 2,
        match: target,
        confidence: 1,
        detail: `Alias "${normalized}" → "${alias.to}"${scopeNote}.`,
        candidates: [],
      };
    }

    // The alias resolved to a name that does not exist IN THIS STATE. This is
    // the guard that matters most: an unscoped `raigarh → Raigad` alias applied
    // to a Chhattisgarh record lands here, because Raigad is not a Chhattisgarh
    // district. Reporting it beats quietly falling through to a fuzzy match
    // that might find something plausible-but-wrong.
    return unresolved(
      input,
      normalized,
      `Alias maps "${normalized}" → "${alias.to}", but ${canonicalState} has no district by that name. ` +
        `The alias may need a "state" scope, or this record's state may be wrong.`,
    );
  }

  // Stage 3 — fuzzy, within the state only.
  const { match, scored, tied } = fuzzyMatch(normalized, scope);
  if (match !== null) {
    const score = scored[0]?.score ?? FUZZY_THRESHOLD;
    return {
      input,
      normalized,
      stage: 3,
      match,
      confidence: score,
      detail: `Fuzzy match to "${match.name}" in ${canonicalState} at ${(score * 100).toFixed(1)}%.`,
      candidates: scored,
    };
  }

  // Stage 4 — unresolved.
  return {
    ...unresolved(
      input,
      normalized,
      tied
        ? `Ambiguous within ${canonicalState}: more than one district scored above the threshold. Refusing to guess.`
        : `No district in ${canonicalState} matched. Best candidate scored ${((scored[0]?.score ?? 0) * 100).toFixed(1)}%, below the ${(FUZZY_THRESHOLD * 100).toFixed(0)}% threshold.`,
    ),
    candidates: scored,
  };
}

/* -------------------------------------------------------------------------- */
/* Combined                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolve one record: state first, then district scoped to it.
 *
 * The record's effective stage is the WEAKER of the two, because a record is
 * only as trustworthy as its shakiest link. A district that matched exactly but
 * hangs off a fuzzy-matched state is a fuzzy result, and reporting it as exact
 * would hide the guess that actually carries the risk.
 */
export function resolveRecord(
  rawState: unknown,
  rawDistrict: unknown,
  index: BoundaryIndex,
  aliases: AliasMap,
): RecordResolution {
  const state = resolveState(rawState, index, aliases);
  const canonicalState = state.match?.name ?? null;

  const district =
    rawDistrict === null || rawDistrict === undefined
      ? null
      : resolveDistrict(rawDistrict, canonicalState, index, aliases);

  const stages: GeoStage[] = [state.stage];
  if (district !== null) stages.push(district.stage);

  return {
    state,
    district,
    stage: Math.max(...stages) as GeoStage,
    resolvedToDistrict: district?.match != null,
    resolvedToState: state.match != null,
  };
}
