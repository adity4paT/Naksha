/**
 * Tests for discovery and inference behaviour the real fixture cannot exercise.
 *
 * The sample has one sheet, a clean header on row 1, and no invariant
 * violations — so it proves the happy path and nothing else. These synthetic
 * cases cover the failure modes a production file will actually hit.
 */

import { describe, expect, it } from 'vitest';

import { bindColumns } from '../binding';
import { unsafeKey } from '../normalize';
import { describeColumn, inferRole, isSerialIndex, profileColumn } from '../profile';
import { detectHeaderRow, selectSheet } from '../sheet';
import type { SheetMatrix } from '../sheet';
import { validateRecords } from '../validate';
import type { CellValue, ParsedRecord, RecordId } from '@/types/schema';

/* -------------------------------------------------------------------------- */
/* Sheet selection                                                             */
/* -------------------------------------------------------------------------- */

describe('selectSheet', () => {
  const summary: SheetMatrix = [['Report'], ['Generated', '2024-01-01']];
  const data: SheetMatrix = [
    ['State', 'Area'],
    ['Punjab', 100],
    ['Gujarat', 200],
    ['Bihar', 300],
  ];

  it('picks the densest sheet, not the first one', () => {
    const sheets = selectSheet(new Map([['Summary', summary], ['Data', data]]));
    expect(sheets.find((sheet) => sheet.selected)?.name).toBe('Data');
  });

  it('honours a user override even when it is not the densest', () => {
    const sheets = selectSheet(
      new Map([['Summary', summary], ['Data', data]]),
      'Summary',
    );
    expect(sheets.find((sheet) => sheet.selected)?.name).toBe('Summary');
  });

  it('ignores an override naming a sheet that does not exist', () => {
    const sheets = selectSheet(new Map([['Data', data]]), 'Nonexistent');
    expect(sheets.find((sheet) => sheet.selected)?.name).toBe('Data');
  });

  it('scores every sheet so the picker can show why', () => {
    const sheets = selectSheet(new Map([['Summary', summary], ['Data', data]]));
    expect(sheets).toHaveLength(2);
    expect(sheets.every((sheet) => sheet.populatedCellCount > 0)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Header detection                                                            */
/* -------------------------------------------------------------------------- */

describe('detectHeaderRow', () => {
  it('skips a title row above the header', () => {
    const matrix: SheetMatrix = [
      ['Land Holdings Report 2024', null, null],
      ['State', 'District', 'Area'],
      ['Punjab', 'Ludhiana', 500],
      ['Gujarat', 'Kutch', 800],
    ];

    const detection = detectHeaderRow(matrix);
    expect(detection.rowIndex).toBe(1);
    expect(detection.usedFallback).toBe(false);
  });

  it('does not mistake a second label row for data', () => {
    // Row 0 is dense strings but row 1 is also all strings — not a data row.
    // Row 1 is the real header, because row 2 below it is mixed.
    const matrix: SheetMatrix = [
      ['Section A', 'Section A', 'Section B'],
      ['State', 'District', 'Area'],
      ['Punjab', 'Ludhiana', 500],
    ];

    expect(detectHeaderRow(matrix).rowIndex).toBe(1);
  });

  it('falls back and flags it when no row qualifies', () => {
    const matrix: SheetMatrix = [['Punjab', 'Ludhiana', 'Chawapail']];
    const detection = detectHeaderRow(matrix);

    expect(detection.usedFallback).toBe(true);
    expect(detection.rowIndex).toBe(0);
  });

  it('counts density against full sheet width, so trailing blanks count against', () => {
    // 2 strings across a 10-wide sheet is 20% — below the 70% floor.
    const matrix: SheetMatrix = [
      ['State', 'Area', null, null, null, null, null, null, null, null],
      ['Punjab', 500, null, null, null, null, null, null, null, null],
    ];

    expect(detectHeaderRow(matrix).usedFallback).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Serial-index detection                                                      */
/* -------------------------------------------------------------------------- */

describe('isSerialIndex', () => {
  const profileOf = (values: CellValue[]) => profileColumn(values);

  it('detects a gapless 1..n counter', () => {
    const values = Array.from({ length: 50 }, (_, i) => i + 1);
    expect(isSerialIndex(profileOf(values), 50)).toBe(true);
  });

  it('detects a 0-based counter', () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    expect(isSerialIndex(profileOf(values), 20)).toBe(true);
  });

  it('rejects a filtered serial with gaps, keeping it a measure', () => {
    // A false demotion silently removes a column from the choropleth; a false
    // promotion only adds a useless menu entry. This errs toward the latter.
    const values = [1, 2, 5, 6, 9];
    expect(isSerialIndex(profileOf(values), 5)).toBe(false);
  });

  it('rejects a real measure that happens to be distinct integers', () => {
    const values = [739, 843, 381, 1729, 80];
    expect(isSerialIndex(profileOf(values), 5)).toBe(false);
  });

  it('rejects a column with any null', () => {
    const values = [1, 2, null, 4];
    expect(isSerialIndex(profileOf(values), 4)).toBe(false);
  });

  it('rejects non-integer values', () => {
    const values = [1.5, 2.5, 3.5];
    expect(isSerialIndex(profileOf(values), 3)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Role inference                                                              */
/* -------------------------------------------------------------------------- */

describe('inferRole', () => {
  it('calls a mostly-numeric column a measure despite stray text', () => {
    // 9 numbers, 1 'TBD' — cleaned to null, so 9/9 populated parse numerically.
    const values: CellValue[] = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, null];
    const role = inferRole(unsafeKey('area'), profileColumn(values), 10);
    expect(role.role).toBe('measure');
  });

  it('keeps a column a measure at exactly the threshold boundary', () => {
    // 9 numeric, 2 non-numeric strings => 9/11 = 0.818, above 0.8.
    const values: CellValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'pending', 'unknown'];
    expect(inferRole(unsafeKey('area'), profileColumn(values), 11).role).toBe('measure');
  });

  it('does not call a mostly-text column a measure', () => {
    const values: CellValue[] = ['a', 'b', 'c', 'd', 'e', 1, 2];
    expect(inferRole(unsafeKey('notes'), profileColumn(values), 7).role).not.toBe('measure');
  });

  it('calls a high-cardinality string column a dimension, flagged not demoted', () => {
    const values: CellValue[] = Array.from({ length: 100 }, (_, i) => `Site ${i}`);
    const inference = inferRole(unsafeKey('site'), profileColumn(values), 100);

    expect(inference.role).toBe('dimension');
    expect(inference.reason).toBe('high-cardinality-text');
  });

  it('calls a two-value string column meta, not a dimension', () => {
    const values: CellValue[] = ['Y', 'N', 'Y', 'N', 'Y'];
    const inference = inferRole(unsafeKey('original docs y/n'), profileColumn(values), 5);

    expect(inference.role).toBe('meta');
    expect(inference.reason).toBe('boolean-like');
  });

  it('calls a date column meta', () => {
    const values: CellValue[] = [new Date('2024-01-01'), new Date('2024-02-01')];
    expect(inferRole(unsafeKey('purchase date'), profileColumn(values), 2).role).toBe('meta');
  });

  describe('empty columns inferred from the header alone', () => {
    const emptyProfile = profileColumn([null, null, null]);

    it.each([
      ['circle rate', 'measure'],
      ['market value tentative', 'measure'],
      ['utilization percentage(%)', 'measure'],
      ['na/clu pending (acres)', 'measure'],
      ['na/ coversion done (acers)', 'measure'],
    ])('infers %s as %s', (key, expected) => {
      const inference = inferRole(unsafeKey(key), emptyProfile, 3);
      expect(inference.role).toBe(expected);
      expect(inference.fromNameOnly).toBe(true);
    });

    it.each([
      ['purchase date'],
      ['original docs y/n'],
      ['kmz files'],
      ['railway docs y/n'],
      ['mutation done'],
    ])('infers %s as meta', (key) => {
      expect(inferRole(unsafeKey(key), emptyProfile, 3).role).toBe('meta');
    });

    it('lets meta keywords win over measure keywords', () => {
      // Contains 'value', but a date is never aggregable.
      expect(inferRole(unsafeKey('valuation date'), emptyProfile, 3).role).toBe('meta');
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Column binding                                                              */
/* -------------------------------------------------------------------------- */

describe('bindColumns', () => {
  const measure = (key: string) =>
    describeColumn({
      index: 0,
      header: key,
      key: unsafeKey(key),
      profile: profileColumn([1, 2, 3, 5, 8, 13, 21]),
      rowCount: 7,
    });

  const dimension = (key: string) =>
    describeColumn({
      index: 0,
      header: key,
      key: unsafeKey(key),
      profile: profileColumn(['a', 'b', 'c', 'd', 'e']),
      rowCount: 5,
    });

  it("binds 'unused land' to unused, NOT to used", () => {
    // 'unused land' contains the substring 'used'. Getting this wrong makes the
    // utilization invariant check unused + unused === total, which fails on
    // every row of a perfectly clean file.
    const binding = bindColumns([measure('used land'), measure('unused land')]);

    expect(binding.measures.used).toBe('used land');
    expect(binding.measures.unused).toBe('unused land');
  });

  it('binds correctly when unused appears before used', () => {
    const binding = bindColumns([measure('unused land'), measure('used land')]);

    expect(binding.measures.used).toBe('used land');
    expect(binding.measures.unused).toBe('unused land');
  });

  it('binds the four tenure components and the total', () => {
    const binding = bindColumns([
      measure('private sale'),
      measure('private lease'),
      measure('govt/revenue'),
      measure('forest'),
      measure('total land area'),
    ]);

    expect(binding.measures['private-sale']).toBe('private sale');
    expect(binding.measures['private-lease']).toBe('private lease');
    expect(binding.measures['govt-revenue']).toBe('govt/revenue');
    expect(binding.measures.forest).toBe('forest');
    expect(binding.measures.total).toBe('total land area');
  });

  it('never binds one column to two roles', () => {
    const binding = bindColumns([measure('total land area'), measure('private sale')]);
    const bound = Object.values(binding.measures);
    expect(new Set(bound).size).toBe(bound.length);
  });

  it("does not mistake 'Real Estate' for the State column", () => {
    const binding = bindColumns([dimension('real estate'), dimension('state')]);
    expect(binding.stateKey).toBe('state');
  });

  it('never binds a measure role to a dimension column', () => {
    const binding = bindColumns([dimension('forest type')]);
    expect(binding.measures.forest).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

describe('validateRecords', () => {
  const keys = {
    sale: unsafeKey('private sale'),
    lease: unsafeKey('private lease'),
    govt: unsafeKey('govt/revenue'),
    forest: unsafeKey('forest'),
    total: unsafeKey('total land area'),
    used: unsafeKey('used land'),
    unused: unsafeKey('unused land'),
  };

  const binding = {
    measures: {
      'private-sale': keys.sale,
      'private-lease': keys.lease,
      'govt-revenue': keys.govt,
      forest: keys.forest,
      total: keys.total,
      used: keys.used,
      unused: keys.unused,
    },
    stateKey: unsafeKey('state'),
    districtKey: unsafeKey('district'),
  } as const;

  const record = (
    sourceRowNumber: number,
    values: Partial<Record<string, CellValue>>,
  ): ParsedRecord => ({
    id: `row-${sourceRowNumber}` as RecordId,
    sourceRowNumber,
    values: values as ParsedRecord['values'],
    warnings: [],
  });

  it('reports no entries for a clean row', () => {
    const report = validateRecords(
      [
        record(2, {
          [keys.sale]: 739,
          [keys.lease]: 8,
          [keys.govt]: 1729,
          [keys.forest]: 0,
          [keys.total]: 2476,
          [keys.used]: 1520,
          [keys.unused]: 956,
        }),
      ],
      binding,
    );

    expect(report.entries).toEqual([]);
    expect(report.checkedByInvariant.composition).toBe(1);
    expect(report.checkedByInvariant.utilization).toBe(1);
  });

  it('reports a composition violation with a signed delta and does not correct it', () => {
    const report = validateRecords(
      [
        record(2, {
          [keys.sale]: 739,
          [keys.lease]: 8,
          [keys.govt]: 1729,
          [keys.forest]: 0,
          [keys.total]: 2500, // components sum to 2476
          [keys.used]: 1544,
          [keys.unused]: 956,
        }),
      ],
      binding,
    );

    const entry = report.entries.find((e) => e.invariant === 'composition');
    expect(entry).toBeDefined();
    expect(entry?.expected).toBe(2500);
    expect(entry?.actual).toBe(2476);
    expect(entry?.delta).toBe(-24);
    expect(entry?.sourceRowNumber).toBe(2);
    expect(entry?.rowIndex).toBe(0);
  });

  it('skips a row with a null component instead of calling it violated', () => {
    const report = validateRecords(
      [
        record(2, {
          [keys.sale]: 739,
          [keys.lease]: null,
          [keys.govt]: 1729,
          [keys.forest]: 0,
          [keys.total]: 2476,
          [keys.used]: 1520,
          [keys.unused]: 956,
        }),
      ],
      binding,
    );

    expect(report.entries.filter((e) => e.invariant === 'composition')).toEqual([]);
    expect(report.skippedByInvariant.composition).toBe(1);
    expect(report.checkedByInvariant.composition).toBe(0);
    // The utilization check is independent and still ran.
    expect(report.checkedByInvariant.utilization).toBe(1);
  });

  it('reports an unbound invariant rather than a false clean result', () => {
    const report = validateRecords([record(2, { [keys.total]: 100 })], {
      measures: {},
      stateKey: null,
      districtKey: null,
    });

    expect(report.unboundInvariants).toContain('composition');
    expect(report.unboundInvariants).toContain('utilization');
    expect(report.entries).toEqual([]);
  });

  it('never throws, even when every row violates', () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      record(i + 2, {
        [keys.sale]: 1,
        [keys.lease]: 1,
        [keys.govt]: 1,
        [keys.forest]: 1,
        [keys.total]: 999,
        [keys.used]: 1,
        [keys.unused]: 1,
      }),
    );

    const report = validateRecords(records, binding);
    expect(report.entries).toHaveLength(40); // both invariants × 20 rows
  });
});
