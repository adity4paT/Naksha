/**
 * Aggregation tests, run against the real workbook and the real boundaries.
 *
 * The property under test throughout is conservation: every acre in the
 * spreadsheet is either on the map or in the unmapped panel, and never both or
 * neither. That is what makes the panel's running total trustworthy.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { aggregateByRegion, scaleValuesFrom } from '..';
import { computeScale } from '@/lib/color';
import { buildBoundaryIndex, parseAliasMap, resolveRecord } from '@/lib/geo';
import type { BoundaryFeature } from '@/lib/geo';
import { parseWorkbook } from '@/lib/ingest';
import type { NormalizedKey } from '@/types/schema';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

const GEO = '../../../../public/geo/';

function setup(measure = 'total land area') {
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL('../../../../Dummy land mis.xlsx', import.meta.url))),
  );
  const workbook = parseWorkbook(bytes, { fileName: 'Dummy land mis.xlsx' });

  const states = readJson(`${GEO}india-states.geojson`) as { features: BoundaryFeature[] };
  const districts = readJson(`${GEO}india-districts.geojson`) as {
    features: BoundaryFeature[];
  };
  const index = buildBoundaryIndex(states.features, districts.features);
  const aliases = parseAliasMap(readJson(`${GEO}aliases.json`)).map;

  const key = (k: string) => k as NormalizedKey;
  const resolutions = workbook.records.map((record) =>
    resolveRecord(record.values[key('state')], record.values[key('district')], index, aliases),
  );

  const columns = {
    measureKey: key(measure),
    siteKey: key('site'),
    stateKey: key('state'),
    districtKey: key('district'),
  };

  return { workbook, resolutions, columns, index };
}

describe('conservation of acreage', () => {
  it('places every acre either on the map or in the unmapped panel', () => {
    const { workbook, resolutions, columns } = setup();

    const sheetTotal = workbook.records.reduce((sum, record) => {
      const value = record.values[columns.measureKey];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);

    for (const level of ['state', 'district'] as const) {
      const result = aggregateByRegion(workbook.records, resolutions, columns, level);
      expect(result.mappedTotal + result.unmappedTotal, `level ${level}`).toBeCloseTo(
        sheetTotal,
        6,
      );
    }
  });

  it('matches the known sheet total of 269,795 acres', () => {
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'state');

    expect(result.mappedTotal + result.unmappedTotal).toBe(269_795);
  });

  it('places every record exactly once', () => {
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'district');

    const placed = [...result.byRegion.values()].reduce((s, r) => s + r.recordCount, 0);
    expect(placed + result.unmapped.length).toBe(workbook.records.length);
  });
});

describe('no data is not zero', () => {
  it('omits regions with no records rather than storing them as zero', () => {
    const { workbook, resolutions, columns, index } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'state');

    // The sample covers 18 states; the boundary file has 36. The other 18 must
    // be ABSENT from the map, not present with a total of 0 — the map layer
    // paints absence with the no-data hatch, and a stored zero would paint them
    // as "we hold nothing here", which is a claim the data does not make.
    expect(result.byRegion.size).toBe(18);
    expect(index.states.length).toBe(36);

    for (const entry of index.states) {
      const region = result.byRegion.get(entry.name);
      if (region !== undefined) expect(region.total).toBeGreaterThan(0);
    }
  });

  it('keeps no-data regions out of the scale distribution', () => {
    // Feeding absent regions in as zeros would drag every quantile break
    // downward and change what colour the real districts are painted — the map
    // would be reporting the shape of our ignorance, not of the data.
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'state');

    const values = scaleValuesFrom(result);
    expect(values).toHaveLength(18);

    const withPhantomZeros = [...values, ...Array.from({ length: 18 }, () => 0)];
    const honest = computeScale(values, 'quantile', 5);
    const inflated = computeScale(withPhantomZeros, 'quantile', 5);

    expect(honest.breaks).not.toEqual(inflated.breaks);
  });

  it('retains a genuine zero as a real value', () => {
    // Forest is 0 on most rows and non-zero on four. Those zeros are data.
    const { workbook, resolutions, columns } = setup('forest');
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'state');

    const zeroStates = [...result.byRegion.values()].filter((r) => r.total === 0);
    expect(zeroStates.length).toBeGreaterThan(0);
    // Present in the map with a total of 0 — distinct from being absent.
    for (const state of zeroStates) {
      expect(result.byRegion.has(state.name)).toBe(true);
    }
  });
});

describe('site counts', () => {
  it('counts distinct sites, not spreadsheet rows', () => {
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'district');

    const totalSites = [...result.byRegion.values()].reduce((s, r) => s + r.siteCount, 0);
    const totalRecords = [...result.byRegion.values()].reduce(
      (s, r) => s + r.recordCount,
      0,
    );

    // 124 distinct site names across 130 rows, so counts must be lower.
    expect(totalSites).toBeLessThan(totalRecords);
    expect(totalSites).toBeGreaterThan(100);
  });

  it('gives every region with records at least one site', () => {
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'district');

    for (const region of result.byRegion.values()) {
      expect(region.siteCount, region.name).toBeGreaterThan(0);
      expect(region.recordIds.length).toBe(region.recordCount);
    }
  });

  it('groups the six Kutch sites into one badge', () => {
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'district');

    const kutch = result.byRegion.get('Kutch');
    expect(kutch).toBeDefined();
    // Seven rows once 'Kutch ' converges onto 'Kutch'; they share one centroid,
    // which is exactly why they get a count badge and not seven markers.
    expect(kutch?.recordCount).toBe(7);
    expect(kutch?.siteCount).toBeGreaterThan(1);
  });
});

describe('state level keeps district-level failures', () => {
  it('counts a record whose state resolved but whose district did not', () => {
    // Such a record is still that state's acreage. Dropping it from the state
    // view would make state totals disagree with the data table.
    const { workbook, resolutions, columns } = setup();

    const stateResult = aggregateByRegion(workbook.records, resolutions, columns, 'state');
    const districtResult = aggregateByRegion(
      workbook.records,
      resolutions,
      columns,
      'district',
    );

    expect(stateResult.mappedTotal).toBeGreaterThanOrEqual(districtResult.mappedTotal);
    expect(stateResult.unmapped.length).toBeLessThanOrEqual(districtResult.unmapped.length);
  });
});

describe('unmapped entries', () => {
  it('always carry acreage so the panel total reconciles', () => {
    const { workbook, resolutions, columns } = setup();
    const result = aggregateByRegion(workbook.records, resolutions, columns, 'district');

    for (const entry of result.unmapped) {
      expect(Number.isFinite(entry.acres)).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(0);
    }

    const summed = result.unmapped.reduce((s, e) => s + e.acres, 0);
    expect(summed).toBeCloseTo(result.unmappedTotal, 6);
  });

  it('reports raw spreadsheet spellings, not canonical names', () => {
    // The user has to find these strings in their own file to fix them.
    const { workbook, resolutions, columns } = setup();

    const noState = workbook.records.map(() => ({
      state: { input: 'Wakanda', normalized: 'wakanda', stage: 4 as const, match: null, confidence: 0, detail: 'x', candidates: [] },
      district: null,
      stage: 4 as const,
      resolvedToDistrict: false,
      resolvedToState: false,
    }));

    const result = aggregateByRegion(workbook.records, noState, columns, 'state');

    expect(result.unmapped).toHaveLength(130);
    expect(result.unmappedTotal).toBe(269_795);
    expect(result.mappedTotal).toBe(0);
    // Raw values survive, so the panel can point at the actual cell contents.
    expect(result.unmapped.some((e) => e.rawState === 'Gujarat')).toBe(true);
  });
});
