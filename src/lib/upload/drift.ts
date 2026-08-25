/**
 * Column drift between the loaded dataset and a candidate upload.
 *
 * CLAUDE.md's whole premise is that 14 of the sample's columns are empty and
 * production files will populate them. So a new upload is expected to have a
 * different shape from the one in memory, and "different" must be shown rather
 * than assumed away.
 *
 * The case that matters most is {@link ColumnDelta} `'became-populated'`. A
 * column that was empty had its role guessed from its header text alone — the
 * profiler had no evidence to work with. The moment real data arrives, that
 * guess is either confirmed or contradicted, and the preview is the one place
 * a user sees it before it starts colouring a map. This is why V1 needs no
 * separate role-override UI: a wrong inference is visible here, and the fix is
 * to correct the header and re-upload.
 */

import type { ColumnDescriptor, ParsedWorkbook } from '@/types/schema';
import { effectiveRole } from '@/types/schema';
import type { ColumnRole, NormalizedKey } from '@/types/schema';

/** How a column changed between the loaded workbook and the candidate. */
export type ColumnDelta =
  /** Present in both, unchanged in role and populated-ness. */
  | 'unchanged'
  /** Not in the loaded workbook at all. */
  | 'added'
  /** In the loaded workbook, absent from the candidate. */
  | 'removed'
  /** Empty before, holds data now. The inference has changed basis. */
  | 'became-populated'
  /** Held data before, empty now. */
  | 'became-empty'
  /** Same column, different inferred role. */
  | 'role-changed';

export interface ColumnChange {
  readonly key: NormalizedKey;
  readonly label: string;
  readonly delta: ColumnDelta;
  readonly previousRole: ColumnRole | null;
  readonly newRole: ColumnRole | null;
  /** Non-null cells in the candidate. Null when the column was removed. */
  readonly newPopulatedCount: number | null;
  /**
   * True when the candidate's role came from header keywords rather than data.
   *
   * Carried through so the preview can mark a role that is still a guess
   * distinctly from one the data supports.
   */
  readonly newRoleFromNameOnly: boolean;
  /** One line explaining why this matters, for the drift table. */
  readonly note: string;
}

export interface ColumnDriftReport {
  readonly changes: readonly ColumnChange[];
  /** True when nothing about the column set changed. */
  readonly identical: boolean;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly roleChangedCount: number;
  readonly becamePopulatedCount: number;
  /**
   * Changes a user should read before committing: anything except `unchanged`.
   * Ordered most-consequential first.
   */
  readonly needsAttention: readonly ColumnChange[];
}

/** Ordering for the drift table: the surprising things first. */
const DELTA_PRIORITY: Record<ColumnDelta, number> = {
  'role-changed': 0,
  'became-populated': 1,
  removed: 2,
  added: 3,
  'became-empty': 4,
  unchanged: 5,
};

function describe(
  delta: ColumnDelta,
  previousRole: ColumnRole | null,
  newRole: ColumnRole | null,
  fromNameOnly: boolean,
): string {
  switch (delta) {
    case 'role-changed':
      return `Was inferred as ${previousRole}, now ${newRole}. Committing changes how this column is used.`;
    case 'became-populated':
      return fromNameOnly
        ? `Empty before, populated now — but its role is still guessed from the header. Check that "${newRole}" is right.`
        : `Empty before, populated now. Role "${newRole}" is now inferred from the data rather than the header.`;
    case 'became-empty':
      return 'Held data in the loaded file, empty in this one. Anything relying on it will show no data.';
    case 'added':
      return fromNameOnly
        ? `New column, and empty — its role is guessed from the header alone.`
        : 'New column, not present in the loaded dataset.';
    case 'removed':
      return 'Present in the loaded dataset, missing from this file. Filters or measures using it will disappear.';
    case 'unchanged':
      return 'No change.';
  }
}

function populatedCount(column: ColumnDescriptor): number {
  return column.rowCount - column.nullCount;
}

/**
 * Diff a candidate workbook against the loaded one.
 *
 * With no dataset loaded, every column reports as `'added'` — which is
 * accurate, and lets the preview use one code path for the first upload and
 * every later one.
 */
export function diffColumns(
  loaded: ParsedWorkbook | null,
  candidate: ParsedWorkbook,
): ColumnDriftReport {
  const previous = new Map<NormalizedKey, ColumnDescriptor>(
    (loaded?.columns ?? []).map((column) => [column.normalizedKey, column]),
  );
  const next = new Map<NormalizedKey, ColumnDescriptor>(
    candidate.columns.map((column) => [column.normalizedKey, column]),
  );

  const changes: ColumnChange[] = [];

  for (const column of candidate.columns) {
    const before = previous.get(column.normalizedKey);
    const newRole = effectiveRole(column);

    if (before === undefined) {
      changes.push({
        key: column.normalizedKey,
        label: column.displayLabel.trim(),
        delta: 'added',
        previousRole: null,
        newRole,
        newPopulatedCount: populatedCount(column),
        newRoleFromNameOnly: column.inferredFromNameOnly,
        note: describe('added', null, newRole, column.inferredFromNameOnly),
      });
      continue;
    }

    const previousRole = effectiveRole(before);
    const wasEmpty = before.isEmptyInSample;
    const isEmpty = column.isEmptyInSample;

    // Role change is reported ahead of populated-ness, because it is the one
    // that changes what the column DOES rather than merely what it holds.
    const delta: ColumnDelta =
      previousRole !== newRole
        ? 'role-changed'
        : wasEmpty && !isEmpty
          ? 'became-populated'
          : !wasEmpty && isEmpty
            ? 'became-empty'
            : 'unchanged';

    changes.push({
      key: column.normalizedKey,
      label: column.displayLabel.trim(),
      delta,
      previousRole,
      newRole,
      newPopulatedCount: populatedCount(column),
      newRoleFromNameOnly: column.inferredFromNameOnly,
      note: describe(delta, previousRole, newRole, column.inferredFromNameOnly),
    });
  }

  for (const [key, column] of previous) {
    if (next.has(key)) continue;
    changes.push({
      key,
      label: column.displayLabel.trim(),
      delta: 'removed',
      previousRole: effectiveRole(column),
      newRole: null,
      newPopulatedCount: null,
      newRoleFromNameOnly: false,
      note: describe('removed', effectiveRole(column), null, false),
    });
  }

  changes.sort(
    (a, b) =>
      DELTA_PRIORITY[a.delta] - DELTA_PRIORITY[b.delta] || a.label.localeCompare(b.label),
  );

  const needsAttention = changes.filter((change) => change.delta !== 'unchanged');

  return {
    changes,
    identical: needsAttention.length === 0,
    addedCount: changes.filter((c) => c.delta === 'added').length,
    removedCount: changes.filter((c) => c.delta === 'removed').length,
    roleChangedCount: changes.filter((c) => c.delta === 'role-changed').length,
    becamePopulatedCount: changes.filter((c) => c.delta === 'became-populated').length,
    needsAttention,
  };
}
