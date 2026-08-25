/**
 * Measure descriptors — what the choropleth can be asked to display.
 *
 * Two kinds: columns discovered in the sheet, and three percentages computed
 * from them. Both appear in one picker, visually grouped, and both resolve to
 * the same interface so the map, legend, and aggregator need no special cases.
 *
 * ## Aggregation is derived, never picked
 *
 * A measure carries its own aggregation strategy, inferred from the column. The
 * brief is right that a picker would be UI with no decision behind it: sum is
 * correct for every populated measure in this file, and offering "mean" beside
 * it would invite a user to produce a wrong number for no reason.
 *
 * ## Why derived percentages are `ratio`, not `mean`
 *
 * The brief's rule — mean for anything ending in `%` — is right for a sheet
 * column of stated percentages, where the components are not available. It is
 * wrong for a percentage we compute ourselves, and measurably so.
 *
 * Averaging per-record percentages weights a 10-acre site the same as a
 * 3,000-acre one. Measured against the real file, mean-of-ratios and
 * ratio-of-sums disagree by up to **6.8 percentage points**:
 *
 * ```
 * Tamil Nadu     mean of ratios 52.5%     ratio of sums 59.3%
 * Rajasthan      mean of ratios 50.3%     ratio of sums 44.0%
 * Uttar Pradesh  mean of ratios 43.9%     ratio of sums 47.3%
 * ```
 *
 * The ratio-of-sums figure is the one that answers "what share of this state's
 * land is used", which is the question the measure's name asks. So derived
 * percentages aggregate as {@link AggregationStrategy} `'ratio'`: sum the
 * numerators, sum the denominator, divide once at the end.
 */

import type { NormalizedKey } from '@/types/schema';

/** How per-record values combine into a regional figure. */
export type AggregationStrategy =
  /** Add them up. Correct for extensive quantities like acreage. */
  | 'sum'
  /**
   * Arithmetic mean of non-null values.
   *
   * Used only for sheet columns that already hold a percentage or rate, where
   * the components are not available to weight by. Unweighted, and therefore an
   * approximation — see the note above on why that matters.
   */
  | 'mean'
  /**
   * Sum numerators, sum the denominator, divide once. Weighted by construction.
   *
   * The only strategy used for derived percentages.
   */
  | 'ratio';

/** Unit, for formatting at the render boundary. */
export type MeasureUnit = 'acre' | 'percent' | 'currency-inr' | 'number';

interface MeasureBase {
  /** Stable id. Serialized into the URL, so it must not change across loads. */
  readonly id: string;
  readonly label: string;
  readonly aggregation: AggregationStrategy;
  readonly unit: MeasureUnit;
}

/** A column discovered in the uploaded sheet. */
export interface SheetMeasure extends MeasureBase {
  readonly kind: 'sheet';
  readonly columnKey: NormalizedKey;
  /** True when the column is entirely null in this file. */
  readonly isEmpty: boolean;
  /** Original header, for the picker's secondary line. */
  readonly rawHeader: string | null;
}

/**
 * A percentage computed from sheet columns.
 *
 * Offered only when every column it needs is bound. A derived measure whose
 * denominator is missing would paint the whole map as no-data, and listing it
 * would be an invitation to a dead end.
 */
export interface DerivedMeasure extends MeasureBase {
  readonly kind: 'derived';
  readonly aggregation: 'ratio';
  readonly unit: 'percent';
  /** Summed to form the numerator. */
  readonly numeratorKeys: readonly NormalizedKey[];
  readonly denominatorKey: NormalizedKey;
  /** Human-readable formula, shown in the picker. */
  readonly formula: string;
  /**
   * Id of a sheet column measuring the same thing and holding data.
   *
   * When set, this derived measure is a FALLBACK: the sheet's own figure is
   * authoritative and the picker labels both so they can never be mistaken for
   * each other. Null when no such column exists or it is empty, in which case
   * this measure is the only source.
   */
  readonly supersededBy: string | null;
}

export type MeasureDescriptor = SheetMeasure | DerivedMeasure;

/** The picker's two groups. */
export interface MeasureGroup {
  readonly label: string;
  readonly measures: readonly MeasureDescriptor[];
}

/** Whether a measure produces a percentage, for formatting and scale choice. */
export function isPercentMeasure(measure: MeasureDescriptor): boolean {
  return measure.unit === 'percent';
}

/** Stable id for a sheet column. */
export function sheetMeasureId(key: NormalizedKey): string {
  return `sheet:${key}`;
}

/** The three derived measures this app knows how to compute. */
export const DERIVED_MEASURE_IDS = {
  utilisation: 'derived:utilisation',
  privateTenure: 'derived:private-tenure',
  govtTenure: 'derived:govt-tenure',
} as const;
