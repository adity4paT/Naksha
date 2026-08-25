/**
 * Class-interval methods for the choropleth.
 *
 * Three methods, and the toggle between them is a feature rather than a
 * preference. They disagree, and the disagreement is informative:
 *
 * - **Quantile** puts an equal *count* of regions in each bin. The map always
 *   looks well-distributed, which is exactly the problem — it hides magnitude
 *   gaps. This dataset has a long tail (a handful of very large holdings
 *   against many small ones), so quantile will paint a 250-acre district and a
 *   2,400-acre district the same shade if the counts happen to fall that way.
 * - **Equal interval** cuts the range into equal-width slices, so bin colour is
 *   directly comparable to magnitude. With a long tail it collapses most
 *   regions into the lowest bin and leaves upper bins nearly empty — which is a
 *   true picture of a skewed distribution, and an unreadable map.
 * - **Jenks** (Fisher natural breaks) minimises within-class variance. Usually
 *   the best compromise, and the most expensive to compute.
 *
 * Quantile is the default because it reads well on first load. The toggle
 * exists because a user who trusts it without ever seeing equal-interval is
 * being misled by the default.
 */

/** Available class-interval methods. */
export const BINNING_METHODS = ['quantile', 'equal-interval', 'jenks'] as const;
export type BinningMethod = (typeof BINNING_METHODS)[number];

export const BINNING_METHOD_LABELS: Readonly<Record<BinningMethod, string>> = {
  quantile: 'Quantile',
  'equal-interval': 'Equal interval',
  jenks: 'Natural breaks (Jenks)',
};

/** One class of the scale. */
export interface Bin {
  /** Inclusive lower bound. */
  readonly min: number;
  /**
   * Upper bound. Exclusive for every bin except the last, which is inclusive so
   * the maximum value has somewhere to land.
   */
  readonly max: number;
  /** Regions falling in this bin. */
  readonly count: number;
}

/** A computed scale, ready for the legend and the paint expression. */
export interface BinnedScale {
  readonly method: BinningMethod;
  readonly bins: readonly Bin[];
  /** Interior break points — `bins.length - 1` of them. */
  readonly breaks: readonly number[];
  readonly min: number;
  readonly max: number;
  /**
   * Set when fewer bins were produced than requested.
   *
   * Happens when the data has fewer distinct values than bins. Surfaced so the
   * legend can render the bins that actually exist rather than inventing empty
   * classes that no region can ever fall into.
   */
  readonly reducedFrom?: number;
}

/** Ascending copy with non-finite values removed. */
function cleanSorted(values: readonly number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

/** Assemble bins from interior breaks and count members. */
function toBins(sorted: readonly number[], breaks: readonly number[]): Bin[] {
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const edges = [min, ...breaks, max];
  const bins: Bin[] = [];

  for (let i = 0; i < edges.length - 1; i += 1) {
    const lower = edges[i]!;
    const upper = edges[i + 1]!;
    const isLast = i === edges.length - 2;

    const count = sorted.filter((v) =>
      isLast ? v >= lower && v <= upper : v >= lower && v < upper,
    ).length;

    bins.push({ min: lower, max: upper, count });
  }

  return bins;
}

/**
 * Equal-count classification.
 *
 * Breaks land on order statistics, so every bin holds roughly the same number
 * of regions. Duplicate values can collapse adjacent breaks — 40 districts all
 * at zero cannot be split across two bins — and the collapsed breaks are
 * de-duplicated rather than producing an empty class.
 */
function quantileBreaks(sorted: readonly number[], binCount: number): number[] {
  const breaks: number[] = [];
  for (let i = 1; i < binCount; i += 1) {
    const position = (i / binCount) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    const value = sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
    breaks.push(value);
  }
  return breaks;
}

/** Equal-width classification across the observed range. */
function equalIntervalBreaks(
  min: number,
  max: number,
  binCount: number,
): number[] {
  const width = (max - min) / binCount;
  return Array.from({ length: binCount - 1 }, (_, i) => min + width * (i + 1));
}

/**
 * Fisher–Jenks natural breaks.
 *
 * O(k·n²) dynamic programming over the sorted values, minimising the sum of
 * within-class squared deviations. n here is at most 724 districts, so the cost
 * is trivial and the exact algorithm is preferable to the k-means approximation
 * commonly shipped in its place.
 *
 * Values are deduplicated first: repeated values carry no extra information for
 * break placement, and with 40 districts at zero the matrix would otherwise be
 * dominated by a single value.
 */
function jenksBreaks(sorted: readonly number[], binCount: number): number[] {
  const values = [...new Set(sorted)];
  const n = values.length;
  if (n <= binCount) return values.slice(1);

  // variance[i][k] = lowest within-class variance for the first i values in k classes
  const variance: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(binCount + 1).fill(Number.POSITIVE_INFINITY),
  );
  // backlink[i][k] = index where class k starts, for reconstructing breaks
  const backlink: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(binCount + 1).fill(0),
  );

  variance[0]![0] = 0;

  for (let k = 1; k <= binCount; k += 1) {
    for (let i = k; i <= n; i += 1) {
      let sum = 0;
      let sumSquares = 0;
      let count = 0;

      // Walk backwards, accumulating the trailing class's variance in O(1) per
      // step rather than recomputing it.
      for (let j = i; j >= k; j -= 1) {
        const value = values[j - 1]!;
        count += 1;
        sum += value;
        sumSquares += value * value;

        const classVariance = sumSquares - (sum * sum) / count;
        const previous = variance[j - 1]![k - 1]!;

        if (previous !== Number.POSITIVE_INFINITY && previous + classVariance < variance[i]![k]!) {
          variance[i]![k] = previous + classVariance;
          backlink[i]![k] = j - 1;
        }
      }
    }
  }

  const breaks: number[] = [];
  let index = n;
  for (let k = binCount; k > 1; k -= 1) {
    const start = backlink[index]![k]!;
    breaks.unshift(values[start]!);
    index = start;
  }
  return breaks;
}

/**
 * Compute a binned scale.
 *
 * Only values for regions that HAVE data should be passed. A region with no
 * records must not enter the distribution as a zero — it would drag every
 * quantile break downward and make the map claim a precision the data does not
 * support. Such regions get the no-data fill instead.
 */
export function computeScale(
  values: readonly number[],
  method: BinningMethod,
  binCount: number,
): BinnedScale {
  const sorted = cleanSorted(values);

  if (sorted.length === 0) {
    return { method, bins: [], breaks: [], min: 0, max: 0 };
  }

  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;

  // Every region shares one value. One bin is the honest answer; splitting it
  // would render identical regions in different colours.
  if (min === max) {
    return {
      method,
      bins: [{ min, max, count: sorted.length }],
      breaks: [],
      min,
      max,
      ...(binCount > 1 ? { reducedFrom: binCount } : {}),
    };
  }

  const distinct = new Set(sorted).size;
  const effectiveBins = Math.min(binCount, distinct);

  const raw =
    method === 'quantile'
      ? quantileBreaks(sorted, effectiveBins)
      : method === 'equal-interval'
        ? equalIntervalBreaks(min, max, effectiveBins)
        : jenksBreaks(sorted, effectiveBins);

  // Drop breaks that coincide with each other or with the range ends. A
  // repeated break defines a ZERO-WIDTH class, which no value can ever occupy
  // and which exists only as an artefact of duplicate values in the data.
  //
  // This is not the same as an empty class of non-zero width, and those are
  // deliberately kept. Under equal-interval an empty class is the finding: it
  // says no region falls in this range, which is exactly the magnitude gap that
  // quantile hides. Suppressing it would defeat the reason the toggle exists.
  const breaks = [...new Set(raw)]
    .filter((b) => b > min && b < max)
    .sort((a, b) => a - b);

  const bins = toBins(sorted, breaks);

  return {
    method,
    bins,
    breaks,
    min,
    max,
    ...(bins.length < binCount ? { reducedFrom: binCount } : {}),
  };
}

/**
 * Index of the bin a value falls into, or `-1` if it falls outside.
 *
 * Mirrors {@link toBins}: half-open except the final bin, which is closed so
 * the maximum belongs somewhere.
 */
export function binIndexOf(scale: BinnedScale, value: number): number {
  if (!Number.isFinite(value)) return -1;
  for (let i = 0; i < scale.bins.length; i += 1) {
    const bin = scale.bins[i]!;
    const isLast = i === scale.bins.length - 1;
    if (isLast ? value >= bin.min && value <= bin.max : value >= bin.min && value < bin.max) {
      return i;
    }
  }
  return -1;
}
