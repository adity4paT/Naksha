/**
 * Cascade computation: options, live counts, orphan detection, and restore.
 *
 * All pure functions over {@link FacetRow}[]. Nothing here touches React or the
 * store, which is what makes the cascade's trickiest behaviour — orphaned
 * selections — testable without rendering anything.
 */

import type {
  CascadeLevel,
  FacetOption,
  FacetRow,
  FacetView,
  FilterDimension,
  FilterSelections,
  MeasureBounds,
  OrphanedSelection,
  RangeSelection,
} from './types';
import { DIMENSION_LABELS, isIndependent, upstreamOf } from './types';

/** Read the value a dimension filters on. */
function valueOf(row: FacetRow, dimension: FilterDimension): string | null {
  switch (dimension) {
    case 'business':
      return row.business;
    case 'state':
      return row.state;
    case 'district':
      return row.district;
    case 'site':
      return row.site;
  }
}

/**
 * Whether a row satisfies one dimension's selection.
 *
 * An empty selection means "no constraint", not "match nothing" — the usual
 * multi-select convention, and the only one that makes an unset filter
 * invisible.
 *
 * `active` is passed in rather than read from selections: orphaned values must
 * NOT filter. If a struck-through district still constrained the result set,
 * the user would see zero records with no visible cause.
 */
function matchesDimension(
  row: FacetRow,
  dimension: FilterDimension,
  active: readonly string[],
): boolean {
  if (active.length === 0) return true;
  const value = valueOf(row, dimension);
  return value !== null && active.includes(value);
}

/** Whether a row satisfies every range constraint. */
export function matchesRanges(
  row: FacetRow,
  ranges: Readonly<Record<string, RangeSelection>>,
): boolean {
  for (const [key, range] of Object.entries(ranges)) {
    const value = row.measures[key];
    // A null measure cannot be compared. Excluding it is the honest reading of
    // "between X and Y" — an unrecorded figure is not known to be in range.
    if (value === null || value === undefined) return false;
    if (value < range.min || value > range.max) return false;
  }
  return true;
}

/**
 * Rows surviving the given dimensions' ACTIVE selections, plus ranges.
 *
 * @param only Dimensions to apply. Omit one to compute that dimension's own
 *   facet counts, which is the standard faceted-search rule: a facet's counts
 *   exclude its own selection so a user can see what adding another value
 *   would gain.
 */
export function rowsMatching(
  rows: readonly FacetRow[],
  active: Readonly<Record<FilterDimension, readonly string[]>>,
  ranges: Readonly<Record<string, RangeSelection>>,
  only: readonly FilterDimension[],
): FacetRow[] {
  return rows.filter(
    (row) =>
      only.every((dimension) => matchesDimension(row, dimension, active[dimension])) &&
      matchesRanges(row, ranges),
  );
}

/**
 * Values a dimension may offer, given its upstream filters.
 *
 * This is what makes "selecting a state narrows the district list to that
 * state's districts only" true: district options are drawn from rows that
 * already passed the state filter.
 *
 * Business ignores this and always offers everything — see
 * {@link isIndependent}.
 */
export function availableValues(
  rows: readonly FacetRow[],
  dimension: FilterDimension,
  active: Readonly<Record<FilterDimension, readonly string[]>>,
  ranges: Readonly<Record<string, RangeSelection>>,
): Set<string> {
  const scope = isIndependent(dimension)
    ? rows
    : rowsMatching(rows, active, ranges, [...upstreamOf(dimension)]);

  const values = new Set<string>();
  for (const row of scope) {
    const value = valueOf(row, dimension);
    if (value !== null) values.add(value);
  }
  return values;
}

/**
 * Active selections: what the user picked, intersected with what is available.
 *
 * Computing this rather than storing it is what lets an orphaned selection
 * spring back to life when the user re-widens upstream, without any
 * re-selection or bookkeeping.
 */
export function computeActive(
  rows: readonly FacetRow[],
  selections: FilterSelections,
): Record<FilterDimension, readonly string[]> {
  const active: Record<FilterDimension, readonly string[]> = {
    business: [],
    state: [],
    district: [],
    site: [],
  };

  // Resolved in cascade order, since each level's availability depends on the
  // active — not merely selected — values of the levels above it.
  for (const dimension of ['business', 'state', 'district', 'site'] as const) {
    const available = availableValues(rows, dimension, active, selections.ranges);
    active[dimension] = selections[dimension].filter((value) => available.has(value));
  }

  return active;
}

/** Rows passing every active filter. The result set the rest of the app sees. */
export function applyFilters(
  rows: readonly FacetRow[],
  selections: FilterSelections,
): FacetRow[] {
  const active = computeActive(rows, selections);
  return rowsMatching(rows, active, selections.ranges, [
    'business',
    'state',
    'district',
    'site',
  ]);
}

/**
 * What upstream widening would bring an orphaned value back.
 *
 * Computed from the FULL dataset rather than remembered from when the value was
 * selected. That matters: a user can arrive at the same orphaned state by
 * several routes, and a remembered context would be stale for all but one of
 * them. Looking it up fresh is always right.
 *
 * Only genuinely blocking dimensions are returned. If a district is orphaned
 * purely because of the state filter, restore widens the state filter and
 * leaves business alone — a restore that resets unrelated filters is its own
 * kind of surprise.
 */
export function restoreActionFor(
  rows: readonly FacetRow[],
  dimension: FilterDimension,
  value: string,
  selections: FilterSelections,
  active: Record<FilterDimension, readonly string[]>,
): OrphanedSelection {
  // Every row where this value appears at all, ignoring current filters.
  const supporting = rows.filter((row) => valueOf(row, dimension) === value);

  const restore: Partial<Record<FilterDimension, readonly string[]>> = {};
  const blocking: string[] = [];

  for (const upstream of upstreamOf(dimension)) {
    const selected = active[upstream];
    if (selected.length === 0) continue;

    const supportingValues = new Set(
      supporting
        .map((row) => valueOf(row, upstream))
        .filter((v): v is string => v !== null),
    );

    // Already permitted by this dimension — not what is blocking.
    if ([...supportingValues].some((v) => selected.includes(v))) continue;

    const toAdd = [...supportingValues].sort();
    if (toAdd.length > 0) {
      restore[upstream] = toAdd;
      blocking.push(
        `${DIMENSION_LABELS[upstream]} filter excludes ${toAdd.length === 1 ? toAdd[0] : `${toAdd.length} values`}`,
      );
    }
  }

  // Ranges can orphan a value too, and no upstream widening fixes that. Say so
  // rather than offering a restore button that would do nothing.
  if (blocking.length === 0) {
    const passesRanges = supporting.some((row) => matchesRanges(row, selections.ranges));
    blocking.push(
      passesRanges
        ? 'No records with this value under the current filters'
        : 'Excluded by a measure range filter',
    );
  }

  return { dimension, value, restore, reason: blocking.join('; ') };
}

/** Build everything the panel needs for one dimension. */
export function buildFacetView(
  rows: readonly FacetRow[],
  dimension: FilterDimension,
  selections: FilterSelections,
  active: Record<FilterDimension, readonly string[]>,
): FacetView {
  const available = availableValues(rows, dimension, active, selections.ranges);

  // Counts exclude this dimension's own selection, so a multi-select shows what
  // ADDING each value would yield rather than collapsing to the current result.
  const others = (['business', 'state', 'district', 'site'] as const).filter(
    (d) => d !== dimension,
  );
  const countScope = rowsMatching(rows, active, selections.ranges, [...others]);

  const counts = new Map<string, number>();
  for (const row of countScope) {
    const value = valueOf(row, dimension);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const selected = new Set(selections[dimension]);

  const options: FacetOption[] = [...available]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({
      value,
      count: counts.get(value) ?? 0,
      selected: selected.has(value),
    }));

  const orphaned = selections[dimension]
    .filter((value) => !available.has(value))
    .map((value) => restoreActionFor(rows, dimension, value, selections, active));

  return {
    dimension,
    options,
    orphaned,
    activeCount: active[dimension].length,
    availableCount: available.size,
  };
}

/** Facet views for every dimension, in panel order. */
export function buildAllFacets(
  rows: readonly FacetRow[],
  selections: FilterSelections,
): { readonly active: Record<FilterDimension, readonly string[]>; readonly views: readonly FacetView[] } {
  const active = computeActive(rows, selections);
  const views = (['business', 'state', 'district', 'site'] as const).map((dimension) =>
    buildFacetView(rows, dimension, selections, active),
  );
  return { active, views };
}

/**
 * Data bounds for each measure, used to initialise range controls.
 *
 * Bounds come from the FULL dataset, not the filtered one. A slider whose track
 * rescales as you filter is unusable — the handle you just dragged jumps, and
 * the same pixel means a different number from one moment to the next.
 */
export function measureBounds(
  rows: readonly FacetRow[],
  measures: readonly { key: string; label: string }[],
): MeasureBounds[] {
  return measures
    .map(({ key, label }) => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;

      for (const row of rows) {
        const value = row.measures[key];
        if (value === null || value === undefined || !Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }

      return Number.isFinite(min) && Number.isFinite(max)
        ? { key: key as MeasureBounds['key'], label, min, max }
        : null;
    })
    .filter((b): b is MeasureBounds => b !== null);
}

/** Whether a range actually constrains anything, for chip display. */
export function isRangeActive(range: RangeSelection, bounds: MeasureBounds): boolean {
  return range.min > bounds.min || range.max < bounds.max;
}

/** Total active constraints, for the "Reset all" affordance. */
export function activeFilterCount(
  selections: FilterSelections,
  bounds: readonly MeasureBounds[],
): number {
  const dimensional =
    selections.business.length +
    selections.state.length +
    selections.district.length +
    selections.site.length;

  const ranged = Object.entries(selections.ranges).filter(([key, range]) => {
    const bound = bounds.find((b) => b.key === key);
    return bound !== undefined && isRangeActive(range, bound);
  }).length;

  return dimensional + ranged;
}

/** Cascade levels, exported for iteration in the panel. */
export const CASCADE_ORDER: readonly CascadeLevel[] = ['state', 'district', 'site'];
