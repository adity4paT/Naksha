/**
 * Evaluating a measure, per record and per region.
 *
 * ## null is the answer, never 0 and never NaN
 *
 * Every division here is guarded. A record with zero total area has an
 * *undefined* utilisation, not a utilisation of zero — the brief is explicit
 * that such a site must render as "no data", and the distinction survives all
 * the way to the map because {@link RegionValue.value} is nullable and the fill
 * expression branches on it.
 *
 * `0` would claim the land is entirely unused. `NaN` would poison every
 * downstream sum and silently produce an empty scale. Both are worse than
 * admitting the figure cannot be computed.
 */

import { parseMeasure } from '@/lib/ingest';
import type { CellValue, NormalizedKey } from '@/types/schema';
import type { MeasureDescriptor } from './types';

/** A record's cell values, keyed by normalized column key. */
export type RecordValues = Readonly<Partial<Record<NormalizedKey, CellValue>>>;

const read = (values: RecordValues, key: NormalizedKey): number | null =>
  parseMeasure(values[key]);

/**
 * The measure's value for one record.
 *
 * Used by the detail table and by per-record range filtering, NOT by regional
 * aggregation — a ratio measure must be aggregated from its components rather
 * than from per-record ratios. See {@link aggregateMeasure}.
 */
export function recordValue(
  measure: MeasureDescriptor,
  values: RecordValues,
): number | null {
  if (measure.kind === 'sheet') return read(values, measure.columnKey);

  const denominator = read(values, measure.denominatorKey);
  // The guard. Zero total area, a missing total, or a negative one all mean the
  // percentage is undefined for this record.
  if (denominator === null || denominator <= 0) return null;

  let numerator = 0;
  let sawValue = false;
  for (const key of measure.numeratorKeys) {
    const part = read(values, key);
    if (part === null) continue;
    numerator += part;
    sawValue = true;
  }

  // Every component missing means the figure is unknown, not zero.
  if (!sawValue) return null;

  return (numerator / denominator) * 100;
}

/** Aggregated result for a region, with nullability preserved. */
export interface RegionValue {
  /** `null` when the measure cannot be computed for this region. */
  readonly value: number | null;
  /** Records that contributed a usable figure. */
  readonly contributingCount: number;
}

/**
 * Aggregate a measure across a region's records.
 *
 * Strategy comes from the measure, not from the caller:
 *
 * - `sum`   — add non-null values. Null only when no record had one.
 * - `mean`  — unweighted mean of non-null values.
 * - `ratio` — sum numerators, sum the denominator, divide ONCE.
 *
 * The `ratio` path is what keeps a derived percentage honest. Averaging
 * per-record percentages would weight a 10-acre site equally with a 3,000-acre
 * one; measured on the real file that disagrees with the weighted figure by up
 * to 6.8 percentage points.
 */
export function aggregateMeasure(
  measure: MeasureDescriptor,
  records: readonly RecordValues[],
): RegionValue {
  if (measure.kind === 'derived') {
    let numerator = 0;
    let denominator = 0;
    let contributing = 0;

    for (const values of records) {
      const rowDenominator = read(values, measure.denominatorKey);
      // A record with no usable denominator contributes to neither sum. Adding
      // its numerator anyway would inflate the ratio using land the denominator
      // never counted.
      if (rowDenominator === null || rowDenominator <= 0) continue;

      let rowNumerator = 0;
      let sawValue = false;
      for (const key of measure.numeratorKeys) {
        const part = read(values, key);
        if (part === null) continue;
        rowNumerator += part;
        sawValue = true;
      }
      if (!sawValue) continue;

      numerator += rowNumerator;
      denominator += rowDenominator;
      contributing += 1;
    }

    // The aggregate guard, mirroring the per-record one.
    if (denominator <= 0 || contributing === 0) {
      return { value: null, contributingCount: 0 };
    }

    return { value: (numerator / denominator) * 100, contributingCount: contributing };
  }

  const values: number[] = [];
  for (const record of records) {
    const value = read(record, measure.columnKey);
    if (value !== null) values.push(value);
  }

  if (values.length === 0) return { value: null, contributingCount: 0 };

  const sum = values.reduce((acc, value) => acc + value, 0);

  return {
    value: measure.aggregation === 'mean' ? sum / values.length : sum,
    contributingCount: values.length,
  };
}

/**
 * Format a value for display.
 *
 * Percentages get one decimal — regional utilisation figures differ by fractions
 * of a point and rounding to whole numbers would make distinct regions look
 * identical. Acreage gets none, since the source data is whole acres.
 */
export function formatMeasureValue(
  measure: MeasureDescriptor,
  value: number | null,
): string {
  if (value === null) return 'no data';

  switch (measure.unit) {
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'currency-inr':
      return `₹${Math.round(value).toLocaleString('en-IN')}`;
    case 'acre':
      return `${Math.round(value).toLocaleString('en-IN')} ac`;
    case 'number':
      return value.toLocaleString('en-IN');
  }
}

/** Short unit label for the legend header. */
export function measureUnitLabel(measure: MeasureDescriptor): string {
  switch (measure.unit) {
    case 'percent':
      return 'percent';
    case 'currency-inr':
      return 'rupees';
    case 'acre':
      return 'acres';
    case 'number':
      return '';
  }
}
