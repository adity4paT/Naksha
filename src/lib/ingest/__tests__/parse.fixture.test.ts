/**
 * Integration tests against the real `Dummy land mis.xlsx`.
 *
 * These are the assertions the brief called for, plus the discovery behaviour
 * that has to hold for them to mean anything.
 */

import { describe, expect, it } from 'vitest';

import { effectiveRole } from '@/types/schema';
import { columnByLabel, parseFixture } from './fixture';

describe('sheet and header discovery', () => {
  it('finds the data sheet by density rather than by assuming a name', () => {
    const workbook = parseFixture();

    expect(workbook.sheetName).toBe('Sheet2');
    // Selection must be earned, not hardcoded: the chosen sheet is the densest.
    const selected = workbook.sheets.find((sheet) => sheet.selected);
    const densest = [...workbook.sheets].sort(
      (a, b) => b.populatedCellCount - a.populatedCellCount,
    )[0];
    expect(selected?.name).toBe(densest?.name);
  });

  it('exposes every sheet so the UI can offer a picker', () => {
    const workbook = parseFixture();
    expect(workbook.sheets.length).toBeGreaterThanOrEqual(1);
    expect(workbook.sheets.filter((sheet) => sheet.selected)).toHaveLength(1);
  });

  it('detects the header row instead of assuming row 1', () => {
    const workbook = parseFixture();

    expect(workbook.header.rowIndex).toBe(0);
    expect(workbook.header.usedFallback).toBe(false);
    expect(workbook.header.stringDensity).toBeGreaterThan(0.7);
    // The corroborating signal: the row below mixes types.
    expect(workbook.header.rowBelowTypes.length).toBeGreaterThanOrEqual(2);
    expect(workbook.header.rowBelowTypes).toContain('string');
    expect(workbook.header.rowBelowTypes).toContain('number');
  });
});

describe('row and column counts', () => {
  it('keeps 130 rows, dropping the trailing junk row', () => {
    const workbook = parseFixture();

    expect(workbook.records).toHaveLength(130);
    expect(workbook.stats.parsedRecordCount).toBe(130);
  });

  it('drops exactly one row, and drops it for a null State', () => {
    const workbook = parseFixture();

    expect(workbook.droppedRows).toHaveLength(1);
    expect(workbook.droppedRows[0]?.reason).toBe('null-state');
  });

  it('discovers 27 columns, discarding the two header-less empty ones', () => {
    const workbook = parseFixture();

    // The sheet reports 29 header cells. Two have no header text AND no data —
    // spreadsheet debris, not columns. The 27 that remain are the real ones.
    expect(workbook.columns).toHaveLength(27);
    expect(workbook.stats.columnCount).toBe(27);
    expect(
      workbook.warnings.some((warning) => warning.code === 'discarded-empty-columns'),
    ).toBe(true);
  });

  it('keeps all 14 empty-but-named columns, since production will populate them', () => {
    const workbook = parseFixture();
    expect(workbook.stats.emptyColumnCount).toBe(14);
  });
});

describe('role inference', () => {
  it('infers exactly 7 measures from observed data', () => {
    const workbook = parseFixture();

    const dataMeasures = workbook.columns.filter(
      (column) => effectiveRole(column) === 'measure' && !column.inferredFromNameOnly,
    );

    expect(dataMeasures.map((column) => column.displayLabel.trim()).sort()).toEqual([
      'Forest',
      'Govt/revenue',
      'Private Lease',
      'Private Sale',
      'Total Land Area',
      'Unused Land',
      'Used Land',
    ]);
    expect(dataMeasures).toHaveLength(7);
  });

  it('infers exactly 5 dimensions', () => {
    const workbook = parseFixture();

    const dimensions = workbook.columns.filter(
      (column) => effectiveRole(column) === 'dimension',
    );

    expect(dimensions.map((column) => column.displayLabel.trim()).sort()).toEqual([
      'Business',
      'District',
      'Site',
      'State',
      'Village',
    ]);
    expect(dimensions).toHaveLength(5);
  });

  it('demotes Sr No to meta — it is a row counter, not a quantity', () => {
    const workbook = parseFixture();
    const srNo = columnByLabel(workbook, 'Sr No');

    expect(srNo).toBeDefined();
    // It would pass the numeric test: 130 finite numbers over 130 rows.
    expect(srNo?.numericParseRatio).toBe(1);
    // But summing a serial index is meaningless, so it is detected structurally.
    expect(effectiveRole(srNo!)).toBe('meta');
    expect(srNo?.inferenceReason).toBe('serial-index');
  });

  it('flags high-cardinality dimensions without demoting them', () => {
    const workbook = parseFixture();

    const district = columnByLabel(workbook, 'District');
    const state = columnByLabel(workbook, 'State');

    // District is 80 distinct across 130 rows — past the 40% threshold, yet it
    // is the column the whole choropleth groups by. Flagged, not demoted.
    expect(effectiveRole(district!)).toBe('dimension');
    expect(district?.isHighCardinality).toBe(true);

    // State is 18 distinct — a good default grouping.
    expect(effectiveRole(state!)).toBe('dimension');
    expect(state?.isHighCardinality).toBe(false);
  });

  it('infers empty columns from header keywords and flags the guess', () => {
    const workbook = parseFixture();

    const nameOnly = workbook.columns.filter((column) => column.inferredFromNameOnly);
    expect(nameOnly.length).toBeGreaterThan(0);
    // Every name-only inference must be on an empty column — there is no reason
    // to guess from a header when data was available.
    expect(nameOnly.every((column) => column.isEmptyInSample)).toBe(true);

    // 'Acers' is a typo of 'acres'; the keyword list handles it at match time
    // rather than normalization repairing the header.
    const coversion = workbook.columns.find((column) =>
      column.normalizedKey.includes('coversion'),
    );
    expect(effectiveRole(coversion!)).toBe('measure');
    expect(coversion?.inferredFromNameOnly).toBe(true);

    // A date column must not be called a measure.
    const purchaseDate = columnByLabel(workbook, 'Purchase Date');
    expect(effectiveRole(purchaseDate!)).toBe('meta');
  });

  it('warns that name-only inferences need confirmation', () => {
    const workbook = parseFixture();
    expect(workbook.warnings.some((w) => w.code === 'name-only-inference')).toBe(true);
    expect(workbook.stats.nameOnlyInferenceCount).toBeGreaterThan(0);
  });
});

describe('invariants', () => {
  it('reports 0 violations — both invariants hold across all 130 rows', () => {
    const workbook = parseFixture();

    expect(workbook.validation.entries).toEqual([]);
    expect(workbook.validation.unboundInvariants).toEqual([]);
  });

  it('actually ran both invariants on every row', () => {
    const workbook = parseFixture();

    // "0 violations" is worthless if the check never executed. These assert it did.
    expect(workbook.validation.checkedByInvariant.composition).toBe(130);
    expect(workbook.validation.checkedByInvariant.utilization).toBe(130);
    expect(workbook.validation.skippedByInvariant.composition).toBe(0);
    expect(workbook.validation.skippedByInvariant.utilization).toBe(0);
  });
});

describe('value cleaning on real data', () => {
  it("cleans 'Nellore\\u00a0' to 'Nellore'", () => {
    const workbook = parseFixture();
    const district = columnByLabel(workbook, 'District');
    expect(district).toBeDefined();

    const districts = workbook.records.map(
      (record) => record.values[district!.normalizedKey],
    );

    expect(districts).toContain('Nellore');
    // The NBSP form must be gone entirely, not merely also present.
    expect(districts).not.toContain('Nellore ');
    expect(districts.some((value) => typeof value === 'string' && / /.test(value))).toBe(
      false,
    );
  });

  it('converges the trailing-space duplicates onto one value each', () => {
    const workbook = parseFixture();
    const district = columnByLabel(workbook, 'District');

    const values = workbook.records
      .map((record) => record.values[district!.normalizedKey])
      .filter((value): value is string => typeof value === 'string');

    // 'Kutch' and 'Kutch ' were two raw strings; after cleaning they are one.
    expect(values).toContain('Kutch');
    expect(values.filter((value) => value === 'Kutch')).toHaveLength(7);
    expect(values).toContain('Nagpur');
    expect(values.filter((value) => value === 'Nagpur')).toHaveLength(3);

    // No value retains outer whitespace.
    expect(values.every((value) => value === value.trim())).toBe(true);

    // 80 raw district strings collapse to 78 once whitespace variants converge.
    // The remaining duplicates are genuine spelling differences that only the
    // resolver's alias table can merge.
    expect(district?.distinctCount).toBe(78);
  });

  it("cleans 'Goa ' in the State column", () => {
    const workbook = parseFixture();
    const state = columnByLabel(workbook, 'State');

    const values = workbook.records.map((record) => record.values[state!.normalizedKey]);
    expect(values).toContain('Goa');
    expect(values.every((value) => typeof value === 'string' && value === value.trim())).toBe(
      true,
    );
  });

  it('leaves spelling variants distinct — normalization is not correction', () => {
    const workbook = parseFixture();
    const district = columnByLabel(workbook, 'District');

    const values = new Set(
      workbook.records
        .map((record) => record.values[district!.normalizedKey])
        .filter((value): value is string => typeof value === 'string'),
    );

    // Merging these is the resolver's job (cascade stage 2), not the parser's.
    // If the parser did it, the unmapped-records panel could never show what
    // was actually in the file.
    expect(values.has('Ludhiana')).toBe(true);
    expect(values.has('Ludhiyana')).toBe(true);
    expect(values.has('Muktsar')).toBe(true);
    expect(values.has('Mutksar')).toBe(true);
  });

  it('preserves the original header as the display label', () => {
    const workbook = parseFixture();

    const usedLand = workbook.columns.find(
      (column) => column.normalizedKey === 'used land',
    );

    // Users recognise their own header text, not our internal key.
    expect(usedLand?.name).toBe('Used Land ');
    expect(usedLand?.displayLabel).toBe('Used Land ');
    expect(usedLand?.normalizedKey).toBe('used land');
  });
});

describe('measure totals', () => {
  it('sums Total Land Area to the figure in the sheet', () => {
    const workbook = parseFixture();
    const total = columnByLabel(workbook, 'Total Land Area');

    const sum = workbook.records.reduce((acc, record) => {
      const value = record.values[total!.normalizedKey];
      return acc + (typeof value === 'number' ? value : 0);
    }, 0);

    expect(sum).toBe(269_795);
  });

  it("nulls the two literal '-' cells in Village without touching anything else", () => {
    const workbook = parseFixture();
    const village = columnByLabel(workbook, 'Village');

    // Rows 18 and 19 hold '-' and row 97 is genuinely blank, so 3 of 130 are
    // null. The raw sheet has only 1 blank — the other 2 are the null-token
    // rule doing its job, and this pins that it applies to dimensions too, not
    // just measures.
    expect(village?.nullCount).toBe(3);

    const values = workbook.records.map((record) => record.values[village!.normalizedKey]);
    expect(values.filter((value) => value === null)).toHaveLength(3);
    expect(values).not.toContain('-');
  });

  it('keeps a genuine zero distinct from a missing value', () => {
    const workbook = parseFixture();
    const forest = columnByLabel(workbook, 'Forest');

    const values = workbook.records.map((record) => record.values[forest!.normalizedKey]);

    // Forest is 0 on most rows and non-zero on four. Those zeros are data.
    expect(values.filter((value) => value === 0).length).toBeGreaterThan(100);
    expect(values.filter((value) => value === null)).toHaveLength(0);
  });
});
