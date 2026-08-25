/**
 * Classification tests.
 *
 * The headline case is the one the brief called out: quantile and
 * equal-interval must DISAGREE on this dataset's long tail. If they ever agree,
 * the toggle is decorative and the warning attached to it is false.
 */

import { describe, expect, it } from 'vitest';

import {
  binIndexOf,
  computeScale,
  DEFAULT_BIN_COUNT,
  rampFor,
  SEQUENTIAL_RAMPS,
} from '..';

/** Long-tailed, like the real acreage distribution. */
const LONG_TAIL = [
  ...Array.from({ length: 20 }, (_, i) => 100 + i * 5),
  600, 700, 850,
  3775,
];

describe('computeScale', () => {
  it('produces the requested number of bins on well-spread data', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const scale = computeScale(values, 'quantile', 5);

    expect(scale.bins).toHaveLength(5);
    expect(scale.breaks).toHaveLength(4);
    expect(scale.reducedFrom).toBeUndefined();
  });

  it('covers the full range with contiguous bins', () => {
    const scale = computeScale(LONG_TAIL, 'quantile', 5);

    expect(scale.bins[0]?.min).toBe(Math.min(...LONG_TAIL));
    expect(scale.bins[scale.bins.length - 1]?.max).toBe(Math.max(...LONG_TAIL));

    for (let i = 0; i < scale.bins.length - 1; i += 1) {
      expect(scale.bins[i]!.max).toBe(scale.bins[i + 1]!.min);
    }
  });

  it('assigns every value to exactly one bin', () => {
    for (const method of ['quantile', 'equal-interval', 'jenks'] as const) {
      const scale = computeScale(LONG_TAIL, method, 5);
      const total = scale.bins.reduce((sum, bin) => sum + bin.count, 0);
      expect(total, `method ${method}`).toBe(LONG_TAIL.length);

      for (const value of LONG_TAIL) {
        expect(binIndexOf(scale, value), `${method} @ ${value}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('puts the maximum in the last bin, not outside every bin', () => {
    // The final bin is closed while the rest are half-open. Getting this wrong
    // leaves the single largest region unpainted, which is the region a reader
    // is most likely to be looking for.
    const scale = computeScale(LONG_TAIL, 'quantile', 5);
    const max = Math.max(...LONG_TAIL);
    expect(binIndexOf(scale, max)).toBe(scale.bins.length - 1);
  });
});

describe('quantile vs equal-interval on a long tail', () => {
  it('disagrees — which is the entire reason the toggle exists', () => {
    const quantile = computeScale(LONG_TAIL, 'quantile', 5);
    const equal = computeScale(LONG_TAIL, 'equal-interval', 5);

    expect(quantile.breaks).not.toEqual(equal.breaks);
  });

  it('quantile spreads regions evenly, hiding the magnitude gap', () => {
    const scale = computeScale(LONG_TAIL, 'quantile', 5);
    const counts = scale.bins.map((b) => b.count);
    const spread = Math.max(...counts) - Math.min(...counts);

    // Roughly balanced classes — the map looks well-distributed regardless of
    // how skewed the underlying values are.
    expect(spread).toBeLessThanOrEqual(3);
  });

  it('equal-interval piles regions into the lowest class, showing the skew', () => {
    const scale = computeScale(LONG_TAIL, 'equal-interval', 5);
    const first = scale.bins[0]?.count ?? 0;

    // The honest picture of a long tail, and an unreadable map. Both facts are
    // true at once, which is why neither method can be the only one offered.
    expect(first / LONG_TAIL.length).toBeGreaterThan(0.8);
  });

  it('jenks isolates the outlier instead of burying it', () => {
    const scale = computeScale(LONG_TAIL, 'jenks', 5);
    const last = scale.bins[scale.bins.length - 1];

    expect(last?.count).toBeLessThanOrEqual(2);
    expect(binIndexOf(scale, 3775)).toBe(scale.bins.length - 1);
  });
});

describe('degenerate inputs', () => {
  it('returns no bins for no values', () => {
    const scale = computeScale([], 'quantile', 5);
    expect(scale.bins).toEqual([]);
    expect(binIndexOf(scale, 10)).toBe(-1);
  });

  it('collapses to one bin when every value is identical', () => {
    // Splitting these would paint identical regions in different colours.
    const scale = computeScale([500, 500, 500, 500], 'quantile', 5);

    expect(scale.bins).toHaveLength(1);
    expect(scale.reducedFrom).toBe(5);
    expect(binIndexOf(scale, 500)).toBe(0);
  });

  it('reduces the bin count when distinct values are fewer than bins', () => {
    const scale = computeScale([1, 2, 3], 'quantile', 5);

    expect(scale.bins.length).toBeLessThanOrEqual(3);
    expect(scale.reducedFrom).toBe(5);
  });

  it('never emits an empty class under the data-driven methods', () => {
    // Quantile and Jenks both derive their breaks from the values, so an empty
    // class would be an artefact rather than a finding.
    for (const method of ['quantile', 'jenks'] as const) {
      const scale = computeScale([0, 0, 0, 0, 0, 0, 0, 0, 5, 900], method, 5);
      for (const bin of scale.bins) {
        expect(bin.count, `${method}: ${bin.min}-${bin.max}`).toBeGreaterThan(0);
      }
    }
  });

  it('DOES emit empty classes under equal-interval — that is the finding', () => {
    // Equal-interval cuts the range into fixed widths regardless of occupancy.
    // An empty class here says "no region falls in this range", which is
    // precisely the magnitude gap quantile conceals. Suppressing it would
    // defeat the reason the method is offered at all.
    const scale = computeScale([0, 0, 0, 0, 0, 0, 0, 0, 5, 900], 'equal-interval', 5);

    expect(scale.bins.some((bin) => bin.count === 0)).toBe(true);
    // Still a complete partition: every value lands somewhere.
    expect(scale.bins.reduce((s, bin) => s + bin.count, 0)).toBe(10);
  });

  it('never emits a zero-width class under any method', () => {
    // Zero-width classes ARE artefacts — no value can occupy them — and they
    // arise from duplicate values collapsing adjacent breaks.
    for (const method of ['quantile', 'equal-interval', 'jenks'] as const) {
      const scale = computeScale([0, 0, 0, 0, 0, 0, 0, 0, 5, 900], method, 5);
      for (const bin of scale.bins) {
        expect(bin.max, `${method}`).toBeGreaterThan(bin.min);
      }
    }
  });

  it('ignores non-finite values rather than propagating them', () => {
    const scale = computeScale([1, 2, Number.NaN, 4, Number.POSITIVE_INFINITY], 'quantile', 3);
    expect(scale.bins.reduce((s, b) => s + b.count, 0)).toBe(3);
    expect(binIndexOf(scale, Number.NaN)).toBe(-1);
  });

  it('handles a distribution that is mostly zeros', () => {
    // Realistic: many districts hold zero of a given tenure type.
    const values = [...Array.from({ length: 40 }, () => 0), 100, 250, 900];
    const scale = computeScale(values, 'quantile', 5);

    expect(scale.min).toBe(0);
    expect(scale.bins.every((b) => b.count > 0)).toBe(true);
    expect(binIndexOf(scale, 0)).toBe(0);
  });
});

describe('ramps', () => {
  it('supplies one colour per bin at every supported count', () => {
    for (const count of [3, 4, 5] as const) {
      expect(rampFor('sequential', 'light', count)).toHaveLength(count);
      expect(rampFor('sequential', 'dark', count)).toHaveLength(count);
    }
  });

  it('runs light→dark in light mode and dark→light in dark mode', () => {
    // The design system specifies that a sequential ramp flips its anchor in
    // dark mode: against a dark surface, lighter means more.
    const light = SEQUENTIAL_RAMPS.light[5];
    const dark = SEQUENTIAL_RAMPS.dark[5];

    expect(light[0]).toBe('#86b6ef');
    expect(light[4]).toBe('#0d366b');
    expect(dark[0]).toBe('#184f95');
    expect(dark[4]).toBe('#cde2fb');
  });

  it('never starts the light ramp at the near-invisible step 100', () => {
    // Step 100 sits at 1.29:1 against the surface — a low-value region would be
    // indistinguishable from a no-data one, and those are different facts.
    for (const count of [3, 4, 5] as const) {
      expect(SEQUENTIAL_RAMPS.light[count][0]).not.toBe('#cde2fb');
    }
  });

  it('builds a diverging ramp with a neutral gray midpoint', () => {
    const ramp = rampFor('diverging', 'light', 5);

    expect(ramp).toHaveLength(5);
    // A hue at the midpoint would read as a third category and destroy the
    // "which side of the baseline" question the scale exists to answer.
    expect(ramp[2]).toBe('#f0efec');
  });

  it('defaults to five bins, the maximum the ramp sustains', () => {
    expect(DEFAULT_BIN_COUNT).toBe(5);
  });
});
