/**
 * Measure catalogue and evaluation.
 *
 * Two things carry the weight here: every divide-by-zero path must yield
 * `null` rather than `0` or `NaN`, and derived percentages must aggregate as a
 * ratio of sums rather than a mean of ratios.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  aggregateMeasure,
  buildMeasureCatalogue,
  DERIVED_MEASURE_IDS,
  findMeasure,
  formatMeasureValue,
  inferAggregation,
  inferUnit,
  recordValue,
  sheetMeasureId,
} from '..';
import type { DerivedMeasure, MeasureDescriptor } from '..';
import { parseWorkbook } from '@/lib/ingest';
import type { CellValue, NormalizedKey, ParsedWorkbook } from '@/types/schema';

let cached: ParsedWorkbook | undefined;
function sample(): ParsedWorkbook {
  cached ??= parseWorkbook(
    new Uint8Array(
      readFileSync(fileURLToPath(new URL('../../../../Dummy land mis.xlsx', import.meta.url))),
    ),
    { fileName: 'Dummy land mis.xlsx' },
  );
  return cached;
}

const key = (k: string) => k as NormalizedKey;
const row = (values: Record<string, CellValue>) =>
  values as Readonly<Partial<Record<NormalizedKey, CellValue>>>;

describe('aggregation inference', () => {
  it.each([
    ['total land area', 'sum'],
    ['private sale', 'sum'],
    ['used land', 'sum'],
    ['utilization percentage(%)', 'mean'],
    ['circle rate', 'mean'],
  ])('infers %s as %s', (name, expected) => {
    expect(inferAggregation(name)).toBe(expected);
  });

  it('separates unit from aggregation', () => {
    // Both are means, but one is rupees and one is a percentage. Collapsing the
    // two would render currency with a % suffix.
    expect(inferAggregation('circle rate')).toBe('mean');
    expect(inferUnit('circle rate')).toBe('currency-inr');
    expect(inferAggregation('utilization percentage(%)')).toBe('mean');
    expect(inferUnit('utilization percentage(%)')).toBe('percent');
  });

  it('treats the sheet’s "Acers" typo as an area column', () => {
    expect(inferUnit('na/ coversion done (acers)')).toBe('acre');
  });
});

describe('the catalogue built from the real sheet', () => {
  it('offers all three derived measures, since every needed column is bound', () => {
    const { measures } = buildMeasureCatalogue(sample());
    const ids = measures.map((m) => m.id);

    expect(ids).toContain(DERIVED_MEASURE_IDS.utilisation);
    expect(ids).toContain(DERIVED_MEASURE_IDS.privateTenure);
    expect(ids).toContain(DERIVED_MEASURE_IDS.govtTenure);
  });

  it('groups them separately from sheet columns', () => {
    const { groups } = buildMeasureCatalogue(sample());

    expect(groups.map((g) => g.label)).toEqual(['From the sheet', 'Calculated']);
    expect(groups[1]?.measures.every((m) => m.kind === 'derived')).toBe(true);
  });

  it('defaults to Total Land Area, never to an empty column', () => {
    const { defaultId, measures } = buildMeasureCatalogue(sample());
    const chosen = findMeasure(measures, defaultId);

    expect(chosen?.label).toBe('Total Land Area');
    // An empty default would paint the whole map as no-data on first load,
    // which reads as a broken app rather than an empty column.
    expect(chosen?.kind === 'sheet' && chosen.isEmpty).toBe(false);
  });

  it('marks the sheet’s empty columns as empty rather than hiding them', () => {
    const { measures } = buildMeasureCatalogue(sample());
    const empty = measures.filter((m) => m.kind === 'sheet' && m.isEmpty);

    // Production files will populate these, so they stay listed.
    expect(empty.length).toBeGreaterThan(0);
  });

  it('does NOT mark derived utilisation as superseded, since the sheet column is empty', () => {
    // `Utilization percentage(%)` exists but holds nothing in this file, so the
    // calculated figure is the only source available.
    const { measures } = buildMeasureCatalogue(sample());
    const derived = findMeasure(measures, DERIVED_MEASURE_IDS.utilisation) as DerivedMeasure;

    expect(derived.supersededBy).toBeNull();
  });

  it('marks it superseded once that column holds data', () => {
    // Simulates a future upload. The sheet's stated figure is authoritative and
    // the calculated one becomes a labelled fallback — never silently conflated.
    const workbook = sample();
    const patched: ParsedWorkbook = {
      ...workbook,
      columns: workbook.columns.map((column) =>
        column.normalizedKey === 'utilization percentage(%)'
          ? { ...column, isEmptyInSample: false, nullCount: 0 }
          : column,
      ),
    };

    const { measures } = buildMeasureCatalogue(patched);
    const derived = findMeasure(measures, DERIVED_MEASURE_IDS.utilisation) as DerivedMeasure;

    expect(derived.supersededBy).toBe(sheetMeasureId(key('utilization percentage(%)')));
  });

  it('omits a derived measure when its denominator is unbound', () => {
    // No Total Land Area means no percentage is computable, and offering one
    // would be an invitation to an all-no-data map.
    const workbook = sample();
    const withoutTotal: ParsedWorkbook = {
      ...workbook,
      columns: workbook.columns.filter((c) => c.normalizedKey !== 'total land area'),
    };

    const { measures } = buildMeasureCatalogue(withoutTotal);
    expect(measures.filter((m) => m.kind === 'derived')).toEqual([]);
  });
});

describe('divide-by-zero guards', () => {
  const utilisation: DerivedMeasure = {
    kind: 'derived',
    id: 'test',
    label: 'Utilisation %',
    aggregation: 'ratio',
    unit: 'percent',
    numeratorKeys: [key('used')],
    denominatorKey: key('total'),
    formula: 'used / total',
    supersededBy: null,
  };

  it('returns null for zero total area — never 0, never NaN', () => {
    // The brief's explicit case: a site with zero total area must render as
    // "no data", not as 0% utilised.
    const value = recordValue(utilisation, row({ used: 0, total: 0 }));

    expect(value).toBeNull();
    expect(value).not.toBe(0);
    expect(Number.isNaN(value as number)).toBe(false);
  });

  it('returns null for a missing or negative denominator', () => {
    expect(recordValue(utilisation, row({ used: 10, total: null }))).toBeNull();
    expect(recordValue(utilisation, row({ used: 10, total: -5 }))).toBeNull();
    expect(recordValue(utilisation, row({ used: 10 }))).toBeNull();
  });

  it('returns null when every numerator component is missing', () => {
    // Unknown, not zero.
    expect(recordValue(utilisation, row({ total: 100 }))).toBeNull();
  });

  it('computes normally when both are present', () => {
    expect(recordValue(utilisation, row({ used: 25, total: 100 }))).toBe(25);
  });

  it('treats a genuine zero numerator as 0%, not as no data', () => {
    // Nothing used out of 100 acres IS zero percent — a real figure.
    expect(recordValue(utilisation, row({ used: 0, total: 100 }))).toBe(0);
  });

  it('returns null at the aggregate level when every denominator is zero', () => {
    const result = aggregateMeasure(utilisation, [
      row({ used: 0, total: 0 }),
      row({ used: 0, total: 0 }),
    ]);

    expect(result.value).toBeNull();
    expect(result.contributingCount).toBe(0);
  });

  it('skips zero-denominator records without corrupting the rest', () => {
    // The bad record must not contribute its numerator to a denominator that
    // never counted its land.
    const result = aggregateMeasure(utilisation, [
      row({ used: 50, total: 100 }),
      row({ used: 7, total: 0 }),
    ]);

    expect(result.value).toBe(50);
    expect(result.contributingCount).toBe(1);
  });
});

describe('ratio of sums, not mean of ratios', () => {
  const utilisation: DerivedMeasure = {
    kind: 'derived',
    id: 'test',
    label: 'Utilisation %',
    aggregation: 'ratio',
    unit: 'percent',
    numeratorKeys: [key('used')],
    denominatorKey: key('total'),
    formula: 'used / total',
    supersededBy: null,
  };

  it('weights by size instead of averaging percentages', () => {
    // One large site at 20%, one tiny site at 90%.
    //   mean of ratios  = (20 + 90) / 2      = 55%
    //   ratio of sums   = 609 / 3010 * 100   = 20.2%
    // The second answers "what share of this region's land is used", which is
    // what the measure's name claims to report.
    const records = [row({ used: 600, total: 3000 }), row({ used: 9, total: 10 })];
    const result = aggregateMeasure(utilisation, records);

    expect(result.value).toBeCloseTo(20.23, 1);
    expect(result.value).not.toBeCloseTo(55, 0);
  });

  it('sums multiple numerator components before dividing', () => {
    const privateTenure: DerivedMeasure = {
      ...utilisation,
      numeratorKeys: [key('sale'), key('lease')],
    };

    const result = aggregateMeasure(privateTenure, [
      row({ sale: 30, lease: 10, total: 100 }),
      row({ sale: 10, lease: 0, total: 100 }),
    ]);

    // (30+10+10+0) / 200 = 25%
    expect(result.value).toBe(25);
  });

  it('matches the hand-computed Tamil Nadu figure from the real sheet', () => {
    // Cross-checks the implementation against a figure computed independently
    // from the raw spreadsheet: Tamil Nadu is 59.3% by ratio of sums and 52.5%
    // by mean of ratios. Getting 52.5 here would mean the wrong strategy ran.
    const workbook = sample();
    const { measures } = buildMeasureCatalogue(workbook);
    const derived = findMeasure(measures, DERIVED_MEASURE_IDS.utilisation)!;

    const tamilNadu = workbook.records
      .filter((record) => record.values[key('state')] === 'Tamil Nadu')
      .map((record) => record.values);

    expect(tamilNadu.length).toBe(7);
    expect(aggregateMeasure(derived, tamilNadu).value).toBeCloseTo(59.3, 1);
  });
});

describe('sheet measure aggregation', () => {
  const totalArea: MeasureDescriptor = {
    kind: 'sheet',
    id: 'sheet:total',
    label: 'Total Land Area',
    columnKey: key('total'),
    aggregation: 'sum',
    unit: 'acre',
    isEmpty: false,
    rawHeader: 'Total Land Area',
  };

  it('sums, skipping nulls', () => {
    const result = aggregateMeasure(totalArea, [
      row({ total: 100 }),
      row({ total: null }),
      row({ total: 250 }),
    ]);

    expect(result.value).toBe(350);
    expect(result.contributingCount).toBe(2);
  });

  it('returns null when no record has a value, rather than 0', () => {
    const result = aggregateMeasure(totalArea, [row({ total: null }), row({})]);
    expect(result.value).toBeNull();
  });

  it('means a percentage column, unweighted', () => {
    const percent: MeasureDescriptor = {
      ...totalArea,
      aggregation: 'mean',
      unit: 'percent',
    };

    expect(aggregateMeasure(percent, [row({ total: 20 }), row({ total: 90 })]).value).toBe(
      55,
    );
  });
});

describe('formatting', () => {
  const acre: MeasureDescriptor = {
    kind: 'sheet',
    id: 'a',
    label: 'A',
    columnKey: key('a'),
    aggregation: 'sum',
    unit: 'acre',
    isEmpty: false,
    rawHeader: 'A',
  };

  it('says "no data" for null rather than rendering 0', () => {
    expect(formatMeasureValue(acre, null)).toBe('no data');
  });

  it('formats each unit distinctly', () => {
    expect(formatMeasureValue(acre, 2476)).toBe('2,476 ac');
    expect(formatMeasureValue({ ...acre, unit: 'percent' }, 59.3)).toBe('59.3%');
    expect(formatMeasureValue({ ...acre, unit: 'currency-inr' }, 125000)).toBe('₹1,25,000');
  });

  it('keeps a decimal on percentages so near-identical regions stay distinct', () => {
    expect(formatMeasureValue({ ...acre, unit: 'percent' }, 47.34)).toBe('47.3%');
    expect(formatMeasureValue({ ...acre, unit: 'percent' }, 47.84)).toBe('47.8%');
  });
});
