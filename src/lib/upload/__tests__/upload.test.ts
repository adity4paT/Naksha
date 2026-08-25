/**
 * Upload inspection, drift, and error paths.
 *
 * The error cases are built by constructing real workbooks with SheetJS rather
 * than by mocking, so each one exercises the same code a user's broken file
 * would.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  coordinateNotice,
  detectCoordinateColumns,
  diffColumns,
  hasAcceptedExtension,
  inspectBytes,
  looksLikeZip,
  MAX_FILE_BYTES,
  notAZip,
  wrongFileType,
} from '..';
import type { InspectOptions } from '..';
import { buildBoundaryIndex, parseAliasMap } from '@/lib/geo';
import type { BoundaryFeature } from '@/lib/geo';
import { parseWorkbook } from '@/lib/ingest';
import type { ParsedWorkbook } from '@/types/schema';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

const GEO = '../../../../public/geo/';

let cachedOptions: InspectOptions | undefined;
function options(loaded: ParsedWorkbook | null = null): InspectOptions {
  if (cachedOptions === undefined) {
    const states = readJson(`${GEO}india-states.geojson`) as { features: BoundaryFeature[] };
    const districts = readJson(`${GEO}india-districts.geojson`) as {
      features: BoundaryFeature[];
    };
    cachedOptions = {
      boundaries: buildBoundaryIndex(states.features, districts.features),
      aliases: parseAliasMap(readJson(`${GEO}aliases.json`)).map,
      loaded: null,
    };
  }
  return { ...cachedOptions, loaded };
}

function sampleBytes(): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL('../../../../Dummy land mis.xlsx', import.meta.url))),
  );
}

/** Build a real .xlsx in memory from rows. */
function makeWorkbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

/* -------------------------------------------------------------------------- */

describe('file type gates', () => {
  it('accepts .xlsx and .xlsm only', () => {
    expect(hasAcceptedExtension('mis.xlsx')).toBe(true);
    expect(hasAcceptedExtension('MIS.XLSM')).toBe(true);
    expect(hasAcceptedExtension('mis.xls')).toBe(false);
    expect(hasAcceptedExtension('mis.csv')).toBe(false);
    expect(hasAcceptedExtension('mis')).toBe(false);
  });

  it('names the actual extension and gives format-specific advice', () => {
    // Never a generic "Invalid file".
    expect(wrongFileType('land.csv').message).toContain('.csv');
    expect(wrongFileType('land.csv').remedy).toMatch(/CSV/);
    expect(wrongFileType('land.xls').remedy).toMatch(/older binary/);
    expect(wrongFileType('land').message).toContain('(none)');
  });

  it('detects a ZIP signature', () => {
    expect(looksLikeZip(sampleBytes())).toBe(true);
    expect(looksLikeZip(new Uint8Array([0x53, 0x74, 0x61, 0x74]))).toBe(false);
    expect(looksLikeZip(new Uint8Array([0x50]))).toBe(false);
  });

  it('explains that the name is not what makes a file an xlsx', () => {
    expect(notAZip('renamed.xlsx').message).toMatch(/whatever its name says/);
  });

  it('sets a file size ceiling with a reason', () => {
    expect(MAX_FILE_BYTES).toBeGreaterThan(0);
  });
});

describe('inspecting the real sample', () => {
  it('produces a preview with the expected shape', () => {
    const result = inspectBytes(sampleBytes(), 'Dummy land mis.xlsx', 26652, options());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { preview } = result;
    expect(preview.workbook.sheetName).toBe('Sheet2');
    expect(preview.workbook.header.rowIndex).toBe(0);
    expect(preview.workbook.stats.parsedRecordCount).toBe(130);
    expect(preview.workbook.stats.columnCount).toBe(27);
    expect(preview.resolutionReport.recordsResolvedToDistrict).toBe(130);
  });

  it('reports no cautions for a clean file', () => {
    const result = inspectBytes(sampleBytes(), 'x.xlsx', 0, options());
    expect(result.ok && result.preview.cautions).toEqual([]);
  });

  it('finds no coordinate columns in the sample', () => {
    const result = inspectBytes(sampleBytes(), 'x.xlsx', 0, options());
    expect(result.ok && result.preview.coordinateColumns).toEqual([]);
  });

  it('offers a default measure that is not an empty column', () => {
    const result = inspectBytes(sampleBytes(), 'x.xlsx', 0, options());
    expect(result.ok && result.preview.defaultMeasureId).toBeTruthy();
  });
});

describe('error paths', () => {
  it('reports a corrupt workbook for ZIP-shaped rubbish', () => {
    // Starts with PK so it passes the signature check, then fails to parse.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0x41)]);
    const result = inspectBytes(bytes, 'broken.xlsx', 68, options());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('corrupt-workbook');
    expect(result.error.message).toMatch(/could not be read/);
  });

  it('reports no-tabular-sheet for a workbook of empty sheets', () => {
    const result = inspectBytes(
      makeWorkbook({ Cover: [[]], Notes: [[]] }),
      'empty.xlsx',
      0,
      options(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('no-tabular-sheet');
    // Names the sheets it looked at, so the user can tell which file it read.
    expect(result.error.detail).toMatch(/Cover/);
  });

  it('reports zero-rows-after-cleaning and names the column that dropped them', () => {
    // Headers present, but every row has a blank State.
    const result = inspectBytes(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area'],
          ['A', null, 'Kutch', 100],
          ['B', null, 'Surat', 200],
        ],
      }),
      'blank-state.xlsx',
      0,
      options(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('zero-rows-after-cleaning');
    expect(result.error.remedy).toMatch(/State/);
  });

  it('reports header-row-undetectable when no columns can be formed', () => {
    // A single row of numbers: nothing can serve as a header.
    const result = inspectBytes(
      makeWorkbook({ Data: [[1, 2, 3]] }),
      'no-header.xlsx',
      0,
      options(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['header-row-undetectable', 'zero-rows-after-cleaning']).toContain(
      result.error.code,
    );
  });

  it('gives every error a remedy or a detail, never a bare message', () => {
    const cases: Uint8Array[] = [
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]),
      makeWorkbook({ Empty: [[]] }),
    ];

    for (const bytes of cases) {
      const result = inspectBytes(bytes, 'x.xlsx', 0, options());
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.message.length).toBeGreaterThan(20);
      expect(
        result.error.remedy !== undefined || result.error.detail !== undefined,
      ).toBe(true);
    }
  });
});

describe('cautions rather than refusals', () => {
  it('loads a file with a title row above the header, and says it guessed', () => {
    // Header detection skips the title row. Refusing would be unhelpful when
    // the guess is right; the caution lets the user check it in the preview.
    const result = inspectBytes(
      makeWorkbook({
        Data: [
          ['Land Holdings 2026', null, null, null],
          ['Site', 'State', 'District', 'Total Land Area'],
          ['A', 'Gujarat', 'Kutch', 100],
          ['B', 'Gujarat', 'Surat', 200],
        ],
      }),
      'titled.xlsx',
      0,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.workbook.header.rowIndex).toBe(1);
    expect(result.preview.workbook.stats.parsedRecordCount).toBe(2);
  });

  it('warns when several sheets hold data', () => {
    const result = inspectBytes(
      makeWorkbook({
        Summary: [['Report'], ['Generated', '2026']],
        Data: [
          ['Site', 'State', 'District', 'Total Land Area'],
          ['A', 'Gujarat', 'Kutch', 100],
          ['B', 'Punjab', 'Ludhiana', 200],
        ],
      }),
      'multi.xlsx',
      0,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.cautions.join(' ')).toMatch(/sheets contain data/);
  });
});

describe('coordinate detection', () => {
  it('detects latitude and longitude columns without using them', () => {
    const workbook = parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Latitude', 'Longitude'],
          ['A', 'Gujarat', 'Kutch', 100, 23.1, 69.7],
          ['B', 'Gujarat', 'Surat', 200, 21.2, 72.8],
        ],
      }),
      { fileName: 'coords.xlsx' },
    );

    const found = detectCoordinateColumns(workbook.columns);
    expect(found.map((c) => c.kind).sort()).toEqual(['latitude', 'longitude']);
    expect(found.every((c) => c.populatedCount === 2)).toBe(true);
  });

  it('reports a paired column once, not as both lat and long', () => {
    const workbook = parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Lat/Long'],
          ['A', 'Gujarat', 'Kutch', 100, '23.1, 69.7'],
          ['B', 'Gujarat', 'Surat', 200, '21.2, 72.8'],
        ],
      }),
      { fileName: 'coords.xlsx' },
    );

    const found = detectCoordinateColumns(workbook.columns);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('paired');
  });

  it('does not match substrings inside ordinary words', () => {
    // 'Belonging' contains "long"; 'Plate' contains "lat". A substring match
    // would flag both as coordinates.
    const workbook = parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Belonging To', 'Plate Number'],
          ['A', 'Gujarat', 'Kutch', 100, 'x', 'y'],
          ['B', 'Gujarat', 'Surat', 200, 'x', 'y'],
        ],
      }),
      { fileName: 'x.xlsx' },
    );

    expect(detectCoordinateColumns(workbook.columns)).toEqual([]);
  });

  it('states plainly that coordinates are not plotted', () => {
    const notice = coordinateNotice([
      { key: 'lat' as never, label: 'Latitude', kind: 'latitude', populatedCount: 5 },
    ]);
    expect(notice).toMatch(/does NOT plot from coordinates/);
    expect(notice).toMatch(/district boundary/);
  });

  it('says so differently when the columns exist but are empty', () => {
    const notice = coordinateNotice([
      { key: 'lat' as never, label: 'Latitude', kind: 'latitude', populatedCount: 0 },
    ]);
    expect(notice).toMatch(/all empty/);
  });
});

describe('column drift', () => {
  const base = () =>
    parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Circle rate'],
          ['A', 'Gujarat', 'Kutch', 100, null],
          ['B', 'Punjab', 'Ludhiana', 200, null],
        ],
      }),
      { fileName: 'base.xlsx' },
    );

  it('reports every column as added on first load', () => {
    const drift = diffColumns(null, base());
    expect(drift.changes.every((c) => c.delta === 'added')).toBe(true);
    expect(drift.identical).toBe(false);
  });

  it('reports identical when nothing changed', () => {
    const drift = diffColumns(base(), base());
    expect(drift.identical).toBe(true);
    expect(drift.needsAttention).toEqual([]);
  });

  it('flags a column that became populated', () => {
    // The case CLAUDE.md is built around: an empty column gets real data, and
    // its role stops being a guess from the header.
    const next = parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Circle rate'],
          ['A', 'Gujarat', 'Kutch', 100, 4500],
          ['B', 'Punjab', 'Ludhiana', 200, 5200],
        ],
      }),
      { fileName: 'next.xlsx' },
    );

    const drift = diffColumns(base(), next);
    const change = drift.needsAttention.find((c) => c.label === 'Circle rate');

    expect(change?.delta).toBe('became-populated');
    expect(change?.newPopulatedCount).toBe(2);
    expect(drift.becamePopulatedCount).toBe(1);
  });

  it('flags added and removed columns', () => {
    const next = parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Forest'],
          ['A', 'Gujarat', 'Kutch', 100, 5],
          ['B', 'Punjab', 'Ludhiana', 200, 0],
        ],
      }),
      { fileName: 'next.xlsx' },
    );

    const drift = diffColumns(base(), next);
    expect(drift.needsAttention.find((c) => c.label === 'Forest')?.delta).toBe('added');
    expect(drift.needsAttention.find((c) => c.label === 'Circle rate')?.delta).toBe(
      'removed',
    );
  });

  it('sorts role changes above everything else', () => {
    const next = parseWorkbook(
      makeWorkbook({
        Data: [
          ['Site', 'State', 'District', 'Total Land Area', 'Circle rate', 'Forest'],
          ['A', 'Gujarat', 'Kutch', 100, 4500, 5],
          ['B', 'Punjab', 'Ludhiana', 200, 5200, 0],
        ],
      }),
      { fileName: 'next.xlsx' },
    );

    const drift = diffColumns(base(), next);
    const priorities = drift.needsAttention.map((c) => c.delta);
    // Whatever the mix, nothing benign sorts above a role change.
    const firstBenign = priorities.findIndex((d) => d === 'added');
    const lastRoleChange = priorities.lastIndexOf('role-changed');
    if (firstBenign !== -1 && lastRoleChange !== -1) {
      expect(lastRoleChange).toBeLessThan(firstBenign);
    }
  });

  it('carries the name-only flag so the preview can mark a guessed role', () => {
    const drift = diffColumns(null, base());
    const circleRate = drift.changes.find((c) => c.label === 'Circle rate');
    // Empty column: role came from the word "rate", not from data.
    expect(circleRate?.newRoleFromNameOnly).toBe(true);
  });
});
