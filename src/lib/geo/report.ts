/**
 * The resolution report.
 *
 * CLAUDE.md requires that any row failing to join to a boundary appears in a
 * visible panel with its acreage, and the brief adds that stage-3 and stage-4
 * results must be surfaced — the user needs to see that "Raigarh" was
 * fuzzy-matched before trusting the map.
 *
 * This module builds a report that makes both possible. It reports on distinct
 * NAMES rather than on rows: 130 rows resolve through 78 distinct districts, and
 * a user fixing a mismatch fixes it once, by adding one alias. A per-row listing
 * would show them the same problem six times.
 */

import type { GeoStage, NameResolution, RecordResolution } from './resolver';
import { GEO_STAGE_LABELS } from './resolver';

/** How a distinct input name resolved, plus how many records depend on it. */
export interface ResolutionReportEntry {
  /** The value as it appeared in the spreadsheet. */
  readonly input: string;
  readonly level: 'state' | 'district';
  /** Parent state this name was resolved under. Null for state-level entries. */
  readonly parentState: string | null;
  readonly stage: GeoStage;
  readonly stageLabel: string;
  /** Canonical boundary name, or null when unresolved. */
  readonly matchedName: string | null;
  readonly confidence: number;
  readonly detail: string;
  readonly candidates: readonly { name: string; score: number }[];
  /** Records that carry this name. Drives the "worth fixing first" ordering. */
  readonly recordCount: number;
  /**
   * True when this entry needs a human to look at it — every stage 3 and 4.
   *
   * Stage 3 is included even though it succeeded. A fuzzy match is a guess the
   * software made on the user's behalf, and it is drawn on the map identically
   * to an exact one. If it is not surfaced, it is invisible.
   */
  readonly needsReview: boolean;
}

/** The full report. */
export interface ResolutionReport {
  readonly entries: readonly ResolutionReportEntry[];
  readonly countsByStage: Readonly<Record<GeoStage, number>>;
  /** Records fully resolved to a district polygon. */
  readonly recordsResolvedToDistrict: number;
  /** Records that got a state but no district. */
  readonly recordsResolvedToStateOnly: number;
  /** Records with no boundary at all. */
  readonly recordsUnresolved: number;
  readonly totalRecords: number;
  /** Entries at stage 3 or 4, most-records-affected first. */
  readonly needsReview: readonly ResolutionReportEntry[];
  /** Problems parsing aliases.json, passed through for display. */
  readonly aliasProblems: readonly string[];
}

interface Accumulator {
  resolution: NameResolution;
  level: 'state' | 'district';
  parentState: string | null;
  recordCount: number;
}

/**
 * Build a report from per-record resolutions.
 *
 * District entries are keyed by `(parent state, input)` rather than by input
 * alone. Without the parent, `Balrampur` in Uttar Pradesh and `Balrampur` in
 * Chhattisgarh would collapse into one row that claims a single outcome for two
 * genuinely different resolutions.
 */
export function buildResolutionReport(
  resolutions: readonly RecordResolution[],
  aliasProblems: readonly string[] = [],
): ResolutionReport {
  const accumulators = new Map<string, Accumulator>();

  const add = (
    resolution: NameResolution,
    level: 'state' | 'district',
    parentState: string | null,
  ) => {
    const key = `${level}|${parentState ?? ''}|${resolution.normalized || resolution.input}`;
    const existing = accumulators.get(key);
    if (existing === undefined) {
      accumulators.set(key, { resolution, level, parentState, recordCount: 1 });
    } else {
      existing.recordCount += 1;
    }
  };

  const countsByStage: Record<GeoStage, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let resolvedToDistrict = 0;
  let resolvedToStateOnly = 0;
  let unresolvedRecords = 0;

  for (const record of resolutions) {
    add(record.state, 'state', null);
    if (record.district !== null) {
      add(record.district, 'district', record.state.match?.name ?? null);
    }

    if (record.resolvedToDistrict) resolvedToDistrict += 1;
    else if (record.resolvedToState) resolvedToStateOnly += 1;
    else unresolvedRecords += 1;
  }

  const entries: ResolutionReportEntry[] = [...accumulators.values()].map((acc) => {
    const { resolution } = acc;
    countsByStage[resolution.stage] += 1;

    return {
      input: resolution.input,
      level: acc.level,
      parentState: acc.parentState,
      stage: resolution.stage,
      stageLabel: GEO_STAGE_LABELS[resolution.stage],
      matchedName: resolution.match?.name ?? null,
      confidence: resolution.confidence,
      detail: resolution.detail,
      candidates: resolution.candidates,
      recordCount: acc.recordCount,
      needsReview: resolution.stage >= 3,
    };
  });

  // Sorted by stage descending, then by how many records ride on it. A user
  // working down this list fixes the most impactful problem first, and the
  // things that are simply broken sort above the things that merely need
  // confirming.
  entries.sort(
    (a, b) => b.stage - a.stage || b.recordCount - a.recordCount || a.input.localeCompare(b.input),
  );

  return {
    entries,
    countsByStage,
    recordsResolvedToDistrict: resolvedToDistrict,
    recordsResolvedToStateOnly: resolvedToStateOnly,
    recordsUnresolved: unresolvedRecords,
    totalRecords: resolutions.length,
    needsReview: entries.filter((entry) => entry.needsReview),
    aliasProblems,
  };
}
