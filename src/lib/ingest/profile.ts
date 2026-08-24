/**
 * Column profiling and role inference.
 *
 * ## A note on the dimension rule
 *
 * The brief specified `dimension: string-typed AND distinctCount < 40% of
 * rowCount`, with `meta` for everything else. Applied literally to this file
 * that rule classifies only Business (3 distinct) and State (18) as dimensions.
 * District, at 80 distinct across 130 rows, becomes meta — and District is the
 * column the entire choropleth is grouped by. Site and Village go with it. The
 * result is a dashboard whose primary axis is unavailable.
 *
 * The rule and the expected outcome cannot both hold, so this module treats
 * them as measuring two different things:
 *
 * - **Type decides the role.** A string-typed column is groupable and
 *   filterable in principle, so it is a dimension. That yields exactly the five
 *   the brief expects, because the five string columns in this file are exactly
 *   Business, Site, State, Village, District.
 * - **Cardinality decides how the role is offered.** The 40% threshold survives
 *   intact as {@link ColumnDescriptor.isHighCardinality}, a UI hint meaning
 *   "do not default to grouping by this" — 124 legend entries is not a
 *   choropleth. It no longer removes the column from the dimension list.
 *
 * `meta` is then reserved for things that genuinely cannot be grouped or summed:
 * dates, Y/N flags, file references, and serial indices.
 *
 * ## A note on `Sr No`
 *
 * `Sr No` is 130 finite numbers over 130 rows, so the numeric rule alone makes
 * it a measure — and summing a row counter to 8,515 is meaningless. It is
 * detected structurally instead (see {@link isSerialIndex}) and demoted to
 * meta, which is also what CLAUDE.md asks for when it says "Ignore".
 *
 * Both departures are inference defaults, and inference is user-overridable by
 * design. Neither is load-bearing for correctness — only for what the UI offers
 * before anyone touches it.
 */

import {
  HIGH_CARDINALITY_RATIO,
  MEASURE_HEADER_KEYWORDS,
  MEASURE_NUMERIC_RATIO_THRESHOLD,
  META_HEADER_KEYWORDS,
} from '@/lib/constants';
import type {
  CellPrimitiveType,
  CellValue,
  ColumnDescriptor,
  ColumnRole,
  NormalizedKey,
  RoleInferenceReason,
} from '@/types/schema';
import { distinctKeyOf, parseMeasure, primitiveTypeOf } from './values';

/** Distinct sample values shown in the override UI. Kept small — Site has 124. */
const SAMPLE_VALUE_LIMIT = 5;

/** Everything observed about one column's values. */
export interface ColumnProfile {
  readonly populatedCount: number;
  readonly nullCount: number;
  readonly distinctCount: number;
  readonly numericParseRatio: number;
  readonly valueTypes: readonly CellPrimitiveType[];
  readonly sampleValues: readonly CellValue[];
  /** Populated numeric values, in row order. Feeds {@link isSerialIndex}. */
  readonly numericValues: readonly number[];
}

/** Tally one column's cleaned values. */
export function profileColumn(values: readonly CellValue[]): ColumnProfile {
  const distinct = new Set<string>();
  const types = new Set<CellPrimitiveType>();
  const samples: CellValue[] = [];
  const numericValues: number[] = [];

  let populatedCount = 0;
  let numericCount = 0;

  for (const value of values) {
    if (value === null) continue;
    populatedCount += 1;

    const key = distinctKeyOf(value);
    if (!distinct.has(key)) {
      distinct.add(key);
      if (samples.length < SAMPLE_VALUE_LIMIT) samples.push(value);
    }

    const type = primitiveTypeOf(value);
    if (type !== null) types.add(type);

    const numeric = parseMeasure(value);
    if (numeric !== null) {
      numericCount += 1;
      numericValues.push(numeric);
    }
  }

  return {
    populatedCount,
    nullCount: values.length - populatedCount,
    distinctCount: distinct.size,
    numericParseRatio: populatedCount === 0 ? 0 : numericCount / populatedCount,
    valueTypes: [...types],
    sampleValues: samples,
    numericValues,
  };
}

/**
 * Whether a numeric column is a row counter rather than a quantity.
 *
 * Requires all four: every row populated, every value a non-negative integer,
 * every value distinct, and — the decisive one — the sorted values forming a
 * gapless run. `Sr No` is 1…130 over 130 rows and matches on all four.
 *
 * Kept strict on purpose. Genuine measures do occasionally look index-like in
 * small samples, and the gapless-run requirement is what a real quantity
 * essentially never satisfies by accident. A file with a *filtered* serial
 * column (1, 2, 5, 6…) fails the gap test and stays a measure — the right
 * outcome, since a false demotion silently removes a column from the choropleth
 * while a false promotion merely adds a useless option to a menu.
 */
export function isSerialIndex(profile: ColumnProfile, rowCount: number): boolean {
  if (rowCount === 0) return false;
  if (profile.populatedCount !== rowCount) return false;
  if (profile.numericValues.length !== rowCount) return false;
  if (profile.distinctCount !== rowCount) return false;
  if (!profile.numericValues.every((n) => Number.isInteger(n) && n >= 0)) return false;

  const sorted = [...profile.numericValues].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return false;

  return last - first === rowCount - 1;
}

/** Outcome of inferring a role, with the evidence that produced it. */
export interface RoleInference {
  readonly role: ColumnRole;
  readonly reason: RoleInferenceReason;
  readonly fromNameOnly: boolean;
}

/**
 * Infer a role for a column that held no data at all.
 *
 * 14 of the sample's columns are empty and production files will populate them,
 * so they cannot simply be discarded — but there is no evidence to infer from
 * either, only the header text.
 *
 * Meta keywords are tested first and the ordering is load-bearing: "Purchase
 * Date" is unambiguous, but a column called "Valuation Date" contains "value"
 * and would otherwise be called a measure. Dates, document flags, and file
 * references are never aggregable, so they win.
 *
 * Every result here sets `fromNameOnly`, which the UI must surface as a caution
 * badge. This is a guess from a word in a header: a real `Circle rate` column
 * could arrive holding "Zone A" / "Zone B" strings and nothing in this file
 * would have contradicted it.
 */
export function inferRoleFromHeader(key: NormalizedKey): RoleInference {
  const haystack = key.toLowerCase();

  for (const keyword of META_HEADER_KEYWORDS) {
    if (haystack.includes(keyword)) {
      return { role: 'meta', reason: 'header-keyword', fromNameOnly: true };
    }
  }

  for (const keyword of MEASURE_HEADER_KEYWORDS) {
    if (haystack.includes(keyword)) {
      return { role: 'measure', reason: 'header-keyword', fromNameOnly: true };
    }
  }

  return { role: 'meta', reason: 'empty-column', fromNameOnly: true };
}

/**
 * Infer a role from a column's profile, falling back to its header when empty.
 *
 * Order of tests, each of which can only fire if the ones above it did not:
 *
 * 1. **Empty** → header keywords. No evidence to work from.
 * 2. **Serial index** → meta. Checked before the numeric test, because a serial
 *    column passes the numeric test and must not be allowed to.
 * 3. **Numeric above threshold** → measure.
 * 4. **Temporal / boolean** → meta. Never grouped or summed.
 * 5. **String-typed** → dimension, tagged by cardinality.
 * 6. **Anything else** → meta.
 */
export function inferRole(
  key: NormalizedKey,
  profile: ColumnProfile,
  rowCount: number,
): RoleInference {
  if (profile.populatedCount === 0) {
    return inferRoleFromHeader(key);
  }

  if (isSerialIndex(profile, rowCount)) {
    return { role: 'meta', reason: 'serial-index', fromNameOnly: false };
  }

  if (profile.numericParseRatio > MEASURE_NUMERIC_RATIO_THRESHOLD) {
    return { role: 'measure', reason: 'numeric-values', fromNameOnly: false };
  }

  const types = new Set(profile.valueTypes);

  if (types.has('date')) {
    return { role: 'meta', reason: 'temporal-values', fromNameOnly: false };
  }

  if (types.has('boolean') && !types.has('string')) {
    return { role: 'meta', reason: 'boolean-like', fromNameOnly: false };
  }

  if (types.has('string')) {
    // A two-value string column is a flag, not a grouping — 'Y'/'N' and
    // 'Yes'/'No' arrive as strings, and the sample's `Original Docs Y/N` and
    // `Railway Docs Y/N` columns will look exactly like this once populated.
    if (profile.distinctCount <= 2) {
      return { role: 'meta', reason: 'boolean-like', fromNameOnly: false };
    }

    const ratio = cardinalityRatioOf(profile);
    return {
      role: 'dimension',
      reason: ratio >= HIGH_CARDINALITY_RATIO ? 'high-cardinality-text' : 'low-cardinality',
      fromNameOnly: false,
    };
  }

  return { role: 'meta', reason: 'empty-column', fromNameOnly: false };
}

/** `distinctCount / populatedCount`, guarding the empty case. */
export function cardinalityRatioOf(profile: ColumnProfile): number {
  return profile.populatedCount === 0 ? 0 : profile.distinctCount / profile.populatedCount;
}

/** Assemble the public descriptor for one column. */
export function describeColumn(args: {
  index: number;
  header: string | null;
  key: NormalizedKey;
  profile: ColumnProfile;
  rowCount: number;
}): ColumnDescriptor {
  const { index, header, key, profile, rowCount } = args;
  const inference = inferRole(key, profile, rowCount);
  const cardinalityRatio = cardinalityRatioOf(profile);

  return {
    index,
    name: header,
    normalizedKey: key,
    // The original header is what the user recognises. They wrote
    // "NA/CLU Pending (acres)"; showing them "na_clu_pending_acres" makes them
    // translate their own spreadsheet back into our internal representation.
    displayLabel: header ?? `Column ${index + 1}`,
    inferredRole: inference.role,
    inferenceReason: inference.reason,
    inferredFromNameOnly: inference.fromNameOnly,
    nullCount: profile.nullCount,
    distinctCount: profile.distinctCount,
    rowCount,
    isEmptyInSample: profile.populatedCount === 0,
    cardinalityRatio,
    isHighCardinality: cardinalityRatio >= HIGH_CARDINALITY_RATIO,
    valueTypes: profile.valueTypes,
    numericParseRatio: profile.numericParseRatio,
    sampleValues: profile.sampleValues,
  };
}
