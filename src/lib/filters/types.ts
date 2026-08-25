/**
 * Filter model.
 *
 * ## Selections are retained, not pruned
 *
 * The single most important idea in this module: a selected value stays in the
 * store even when an upstream change makes it unavailable. What gets computed
 * is which selections are currently *active*.
 *
 * ```
 * selected  — what the user asked for. Only the user removes these.
 * available — what the current upstream filters permit.
 * active    — selected ∩ available. This is what actually filters records.
 * orphaned  — selected \ available. Shown struck through, restorable.
 * ```
 *
 * Deleting an orphaned selection silently is the standard implementation and it
 * is the thing that destroys trust in a cascading filter: a user narrows by
 * state, loses three districts they had chosen, and has no way to know it
 * happened or to get them back. Retaining the selection also means widening the
 * upstream filter again *automatically* re-activates it, with no re-selection.
 */

import type { NormalizedKey } from '@/types/schema';

/** The cascade levels, in order. Position defines what is upstream of what. */
export const CASCADE_LEVELS = ['state', 'district', 'site'] as const;
export type CascadeLevel = (typeof CASCADE_LEVELS)[number];

/** Every dimension a user can filter on. */
export const FILTER_DIMENSIONS = ['business', ...CASCADE_LEVELS] as const;
export type FilterDimension = (typeof FILTER_DIMENSIONS)[number];

export const DIMENSION_LABELS: Readonly<Record<FilterDimension, string>> = {
  business: 'Business',
  state: 'State',
  district: 'District',
  site: 'Site',
};

/**
 * One record, flattened to the fields filters operate on.
 *
 * `state` and `district` are CANONICAL boundary names, taken from the resolver,
 * not the raw spreadsheet strings. That is what keeps the filter panel and the
 * map talking about the same regions — a user filtering to "Raigad" gets the
 * three rows the sheet spells "Raigarh", because the resolver already
 * reconciled them.
 *
 * Both are `null` for a record that failed to resolve. Such records can never
 * match a state or district filter, which is correct and matches the map: they
 * live in the unmapped panel, not in a region.
 */
export interface FacetRow {
  readonly recordId: string;
  readonly business: string | null;
  readonly state: string | null;
  readonly district: string | null;
  readonly site: string | null;
  /** Numeric value per measure column, for range filters. */
  readonly measures: Readonly<Record<string, number | null>>;
}

/** Inclusive numeric range. */
export interface RangeSelection {
  readonly min: number;
  readonly max: number;
}

/** The complete, serializable filter state. */
export interface FilterSelections {
  /**
   * Cross-cutting, not a geographic level. See {@link isIndependent}.
   */
  readonly business: readonly string[];
  readonly state: readonly string[];
  readonly district: readonly string[];
  readonly site: readonly string[];
  /** Keyed by measure column. Absent key means unconstrained. */
  readonly ranges: Readonly<Record<string, RangeSelection>>;
}

export const EMPTY_SELECTIONS: FilterSelections = {
  business: [],
  state: [],
  district: [],
  site: [],
  ranges: {},
};

/**
 * Whether a dimension's option list is immune to narrowing.
 *
 * Business is the one independent dimension, and this is where the brief's two
 * statements about it are reconciled. It listed Business as the head of the
 * cascade *and* described it as cross-cutting, which cannot both be literally
 * true. The resolution:
 *
 * - Business **filters records**, so it narrows what the geographic levels
 *   offer. That is the "Business → State → District → Site" part.
 * - Business's **own option list is never narrowed** by anything downstream.
 *   All three values stay on screen whatever geography is selected. That is
 *   the "cross-cuts" part, and it is why the panel renders it in a separate
 *   group above the cascade.
 * - Business **counts stay live** — computed against every other active filter
 *   — so selecting Gujarat updates the numbers beside each business without
 *   removing any of them. A frozen count would be independence bought at the
 *   price of feedback.
 */
export function isIndependent(dimension: FilterDimension): boolean {
  return dimension === 'business';
}

/** Dimensions upstream of the given one, nearest first. */
export function upstreamOf(dimension: FilterDimension): readonly FilterDimension[] {
  switch (dimension) {
    case 'business':
      return [];
    case 'state':
      return ['business'];
    case 'district':
      return ['business', 'state'];
    case 'site':
      return ['business', 'state', 'district'];
  }
}

/** One selectable value with its live count. */
export interface FacetOption {
  readonly value: string;
  /**
   * Records that would remain if this value were selected, given every other
   * active filter.
   *
   * Zero is meaningful and such options are shown rather than hidden — "this
   * exists but not under your current filters" is information, and removing it
   * makes the list shift under the user as they work.
   */
  readonly count: number;
  readonly selected: boolean;
}

/**
 * A selection that survives in the store but cannot currently filter anything.
 *
 * Carries the exact upstream widening that would bring it back, computed from
 * the full dataset rather than remembered — so it stays correct even if the
 * user reaches the same orphaned state by a different route.
 */
export interface OrphanedSelection {
  readonly dimension: FilterDimension;
  readonly value: string;
  /**
   * What to add upstream to re-activate this value. Applying all of it is the
   * "restore" click.
   */
  readonly restore: Readonly<Partial<Record<FilterDimension, readonly string[]>>>;
  /** One line explaining what is blocking it, for the tooltip. */
  readonly reason: string;
}

/** Everything the panel needs to render one dimension. */
export interface FacetView {
  readonly dimension: FilterDimension;
  readonly options: readonly FacetOption[];
  readonly orphaned: readonly OrphanedSelection[];
  /** Selected values that are currently active. */
  readonly activeCount: number;
  /** Distinct values available before this dimension's own selection. */
  readonly availableCount: number;
}

/** Data-derived bounds for a measure, used to initialise a range control. */
export interface MeasureBounds {
  readonly key: NormalizedKey;
  readonly label: string;
  readonly min: number;
  readonly max: number;
}
