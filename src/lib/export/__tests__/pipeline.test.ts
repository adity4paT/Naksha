/**
 * End-to-end: the real workbook through every stage, and back out as an export.
 *
 * This exercises the same functions the UI calls, in the same order:
 *
 *   parse → resolve → flatten → filter → aggregate → scale → export → re-read
 *
 * It cannot prove the React tree renders. What it does prove is that the data
 * path is sound and that the numbers agree at every hand-off — which is where a
 * dashboard actually goes wrong, and the one thing a screenshot would not tell
 * you.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { aggregateByRegion, scaleValuesFrom } from '@/lib/aggregate';
import { computeScale } from '@/lib/color';
import { applyFilters, EMPTY_SELECTIONS } from '@/lib/filters';
import type { FacetRow, FilterSelections } from '@/lib/filters';
import { buildBoundaryIndex, parseAliasMap } from '@/lib/geo';
import type { BoundaryFeature, RecordResolution } from '@/lib/geo';
import { parseWorkbook } from '@/lib/ingest';
import { buildMeasureCatalogue, DERIVED_MEASURE_IDS, findMeasure } from '@/lib/measures';
import { inspectBytes } from '@/lib/upload';
import type { NormalizedKey, ParsedRecord } from '@/types/schema';
import { buildExportWorkbook, EXPORT_SHEETS, exportFileName } from '..';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

const GEO = '../../../../public/geo/';
const key = (k: string) => k as NormalizedKey;

function pipeline(selections: FilterSelections = EMPTY_SELECTIONS, measureId?: string) {
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL('../../../../Dummy land mis.xlsx', import.meta.url))),
  );

  const states = readJson(`${GEO}india-states.geojson`) as { features: BoundaryFeature[] };
  const districts = readJson(`${GEO}india-districts.geojson`) as {
    features: BoundaryFeature[];
  };
  const boundaries = buildBoundaryIndex(states.features, districts.features);
  const aliases = parseAliasMap(readJson(`${GEO}aliases.json`)).map;

  // Through the same entry point the drop zone uses.
  const inspection = inspectBytes(bytes, 'Dummy land mis.xlsx', bytes.length, {
    boundaries,
    aliases,
    loaded: null,
  });

  if (!inspection.ok) throw new Error(`inspect failed: ${inspection.error.code}`);
  const { workbook, resolutions, binding } = inspection.preview;

  const catalogue = buildMeasureCatalogue(workbook);
  const measure =
    findMeasure(catalogue.measures, measureId ?? catalogue.defaultId) ??
    catalogue.measures[0]!;

  const facetRows: FacetRow[] = workbook.records.map((record, index) => ({
    recordId: record.id,
    business: (record.values[key('business')] as string | null) ?? null,
    state: resolutions[index]?.state.match?.name ?? null,
    district: resolutions[index]?.district?.match?.name ?? null,
    site: (record.values[key('site')] as string | null) ?? null,
    measures: {},
  }));

  const keptIds = new Set(applyFilters(facetRows, selections).map((r) => r.recordId));
  const filteredRecords: ParsedRecord[] = [];
  const filteredResolutions: RecordResolution[] = [];

  workbook.records.forEach((record, index) => {
    if (!keptIds.has(record.id)) return;
    filteredRecords.push(record);
    const resolution = resolutions[index];
    if (resolution !== undefined) filteredResolutions.push(resolution);
  });

  const aggregation = aggregateByRegion(
    filteredRecords,
    filteredResolutions,
    binding,
    measure,
    'state',
  );

  return { workbook, measure, filteredRecords, aggregation, binding, catalogue };
}

describe('the full pipeline on the real file', () => {
  it('runs end to end and produces a shaded map', () => {
    const { workbook, aggregation } = pipeline();

    expect(workbook.stats.parsedRecordCount).toBe(130);
    expect(aggregation.byRegion.size).toBe(18);

    const scale = computeScale(scaleValuesFrom(aggregation), 'quantile', 5);
    expect(scale.bins).toHaveLength(5);
    // Every region lands in a class — no region is left unpainted.
    for (const region of aggregation.byRegion.values()) {
      expect(region.value).not.toBeNull();
    }
  });

  it('keeps the map, table and chart consistent by construction', () => {
    // All three read the same filteredRecords and the same aggregation. The
    // property that matters is that the counts reconcile.
    const { filteredRecords, aggregation } = pipeline();

    const inRegions = [...aggregation.byRegion.values()].reduce(
      (sum, region) => sum + region.recordCount,
      0,
    );

    expect(inRegions + aggregation.unmapped.length).toBe(filteredRecords.length);
  });

  it('narrows every stage when a filter is applied', () => {
    const filtered = pipeline({ ...EMPTY_SELECTIONS, state: ['Gujarat'] });

    expect(filtered.filteredRecords).toHaveLength(18);
    expect(filtered.aggregation.byRegion.size).toBe(1);
    expect(filtered.aggregation.byRegion.get('Gujarat')?.recordCount).toBe(18);
  });

  it('switches to a derived percentage without breaking the scale', () => {
    const { aggregation } = pipeline(EMPTY_SELECTIONS, DERIVED_MEASURE_IDS.utilisation);

    const values = scaleValuesFrom(aggregation);
    expect(values.length).toBe(18);
    // Percentages, not acreages.
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }

    expect(aggregation.byRegion.get('Tamil Nadu')?.value).toBeCloseTo(59.3, 1);
  });
});

describe('export', () => {
  it('writes both sheets', () => {
    const { workbook, measure, filteredRecords, aggregation } = pipeline();

    const bytes = buildExportWorkbook(filteredRecords, workbook.columns, {
      sourceFileName: 'Dummy land mis.xlsx',
      sourceLoadedAt: '2026-08-25T00:00:00.000Z',
      measure,
      selections: EMPTY_SELECTIONS,
      totalRecords: workbook.records.length,
      exportedRecords: filteredRecords.length,
      unmappedRecords: aggregation.unmapped.length,
      unmappedAcres: aggregation.unmappedTotal,
      boundaryCommit: 'cc91a19',
      boundaryVintage: 'Census 2011',
      invariantViolations: 0,
      fuzzyMatchedNames: 1,
    });

    const reread = XLSX.read(bytes, { type: 'array' });
    expect(reread.SheetNames).toEqual([EXPORT_SHEETS.data, EXPORT_SHEETS.provenance]);
  });

  it('preserves the ORIGINAL header labels, trailing spaces and all', () => {
    const { workbook, measure, filteredRecords, aggregation } = pipeline();

    const bytes = buildExportWorkbook(filteredRecords, workbook.columns, {
      sourceFileName: 'x.xlsx',
      sourceLoadedAt: null,
      measure,
      selections: EMPTY_SELECTIONS,
      totalRecords: 130,
      exportedRecords: filteredRecords.length,
      unmappedRecords: 0,
      unmappedAcres: 0,
      boundaryCommit: 'x',
      boundaryVintage: 'x',
      invariantViolations: 0,
      fuzzyMatchedNames: 0,
    });

    const reread = XLSX.read(bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(reread.Sheets[EXPORT_SHEETS.data]!, {
      header: 1,
    });
    const headers = rows[0] as string[];

    // A user opening this must see the column names they sent us, not our
    // internal keys.
    expect(headers).toContain('Used Land ');
    expect(headers).toContain('Sr No ');
    expect(headers).toContain('NA/ Coversion Done\r\n(Acers) ');
    expect(headers).not.toContain('used land');
  });

  it('round-trips the row count and the values', () => {
    const { workbook, measure, filteredRecords } = pipeline({
      ...EMPTY_SELECTIONS,
      state: ['Gujarat'],
    });

    const bytes = buildExportWorkbook(filteredRecords, workbook.columns, {
      sourceFileName: 'x.xlsx',
      sourceLoadedAt: null,
      measure,
      selections: { ...EMPTY_SELECTIONS, state: ['Gujarat'] },
      totalRecords: 130,
      exportedRecords: filteredRecords.length,
      unmappedRecords: 0,
      unmappedAcres: 0,
      boundaryCommit: 'x',
      boundaryVintage: 'x',
      invariantViolations: 0,
      fuzzyMatchedNames: 0,
    });

    const reread = XLSX.read(bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      reread.Sheets[EXPORT_SHEETS.data]!,
    );

    expect(rows).toHaveLength(18);
    const total = rows.reduce(
      (sum, row) => sum + (typeof row['Total Land Area'] === 'number' ? row['Total Land Area'] : 0),
      0,
    );
    expect(total).toBe(
      filteredRecords.reduce(
        (sum, record) => sum + ((record.values[key('total land area')] as number) ?? 0),
        0,
      ),
    );
  });

  it('records the filters that produced the extract', () => {
    // The reason the provenance sheet exists: an extract with no record of its
    // filters is a number without a question.
    const { workbook, measure, filteredRecords } = pipeline();

    const selections: FilterSelections = {
      business: ['xyz'],
      state: ['Gujarat', 'Punjab'],
      district: [],
      site: [],
      ranges: { 'total land area': { min: 500, max: 3000 } },
    };

    const bytes = buildExportWorkbook(filteredRecords, workbook.columns, {
      sourceFileName: 'Dummy land mis.xlsx',
      sourceLoadedAt: '2026-08-25T00:00:00.000Z',
      measure,
      selections,
      totalRecords: 130,
      exportedRecords: filteredRecords.length,
      unmappedRecords: 3,
      unmappedAcres: 12_430,
      boundaryCommit: 'cc91a19ffbca10b7ca6872a1e9690b4e5fd3aa0a',
      boundaryVintage: 'Census 2011 with later corrections',
      invariantViolations: 0,
      fuzzyMatchedNames: 1,
    });

    const reread = XLSX.read(bytes, { type: 'array' });
    const text = XLSX.utils
      .sheet_to_json<unknown[]>(reread.Sheets[EXPORT_SHEETS.provenance]!, { header: 1 })
      .flat()
      .join(' | ');

    expect(text).toContain('xyz');
    expect(text).toContain('Gujarat, Punjab');
    expect(text).toContain('500 to 3000');
    expect(text).toContain('Dummy land mis.xlsx');
    expect(text).toContain('cc91a19ffbca10b7ca6872a1e9690b4e5fd3aa0a');
    // Caveats travel with the numbers — a reader of the extract has no other
    // way to learn them.
    expect(text).toMatch(/District-level only/);
    expect(text).toMatch(/No acreage is measured/);
    expect(text).toContain('12430');
  });

  it('shows "(all)" for a dimension with no filter', () => {
    const { workbook, measure, filteredRecords } = pipeline();

    const bytes = buildExportWorkbook(filteredRecords, workbook.columns, {
      sourceFileName: null,
      sourceLoadedAt: null,
      measure,
      selections: EMPTY_SELECTIONS,
      totalRecords: 130,
      exportedRecords: 130,
      unmappedRecords: 0,
      unmappedAcres: 0,
      boundaryCommit: 'x',
      boundaryVintage: 'x',
      invariantViolations: 0,
      fuzzyMatchedNames: 0,
    });

    const reread = XLSX.read(bytes, { type: 'array' });
    const text = XLSX.utils
      .sheet_to_json<unknown[]>(reread.Sheets[EXPORT_SHEETS.provenance]!, { header: 1 })
      .flat()
      .join(' | ');

    expect(text).toContain('(all)');
  });

  it('builds a timestamped filename from the source', () => {
    expect(exportFileName('Dummy land mis.xlsx')).toMatch(
      /^Dummy-land-mis-extract-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(exportFileName(null)).toMatch(/^land-mis-extract-/);
  });
});
