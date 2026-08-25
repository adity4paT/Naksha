/**
 * The ingest orchestrator: workbook bytes in, {@link ParsedWorkbook} out.
 *
 * Pipeline, in order:
 *
 *   1. Read every sheet into a matrix          → sheet.ts
 *   2. Score sheets, select the densest        → sheet.ts
 *   3. Detect the header row                   → sheet.ts
 *   4. Normalize headers into keys             → normalize.ts
 *   5. Clean every cell                        → values.ts
 *   6. Profile columns, infer roles            → profile.ts
 *   7. Drop rows with no location dimension    → here
 *   8. Bind columns to semantic roles          → binding.ts
 *   9. Validate both invariants                → validate.ts
 *
 * Parsing happens entirely in the browser. Nothing in this module performs I/O
 * beyond reading the ArrayBuffer it was handed — no fetch, no upload, no
 * telemetry. See CLAUDE.md "Confidentiality".
 */

import * as XLSX from 'xlsx';

import type {
  CellValue,
  ColumnDescriptor,
  DroppedRow,
  IngestStats,
  IngestWarning,
  NormalizedKey,
  ParsedRecord,
  ParsedWorkbook,
  RecordId,
} from '@/types/schema';
import { effectiveRole } from '@/types/schema';
import { bindColumns } from './binding';
import { disambiguateKey, normalizeHeader, synthesizeKey } from './normalize';
import { describeColumn, profileColumn } from './profile';
import type { SheetMatrix } from './sheet';
import { detectHeaderRow, matrixWidth, selectSheet } from './sheet';
import { validateRecords } from './validate';
import { cleanCell } from './values';

/** Options for {@link parseWorkbook}. */
export interface ParseOptions {
  /** Display name of the uploaded file. Never transmitted. */
  readonly fileName: string;
  /** User override for sheet selection. */
  readonly sheetName?: string;
  /** User override for the header row, zero-based. */
  readonly headerRowIndex?: number;
}

/** Read every sheet into a row-major matrix, preserving blanks and full width. */
function readMatrices(workbook: XLSX.WorkBook): Map<string, SheetMatrix> {
  const matrices = new Map<string, SheetMatrix>();

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet === undefined) continue;

    // `header: 1` yields raw rows; `blankrows: true` keeps positional alignment
    // so a detected header index refers to the same row the user sees in Excel.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });

    matrices.set(name, matrix);
  }

  return matrices;
}

/** Build unique keys for each header cell, reporting collisions. */
function buildKeys(headerRow: readonly unknown[], width: number): {
  keys: (NormalizedKey | null)[];
  headers: (string | null)[];
  duplicates: NormalizedKey[];
} {
  const keys: (NormalizedKey | null)[] = [];
  const headers: (string | null)[] = [];
  const duplicates: NormalizedKey[] = [];
  const seen = new Map<NormalizedKey, number>();

  for (let index = 0; index < width; index += 1) {
    const raw = headerRow[index];
    const header = typeof raw === 'string' ? raw : raw == null ? null : String(raw);
    const base = header === null ? null : normalizeHeader(header);

    headers.push(header);

    if (base === null) {
      keys.push(null);
      continue;
    }

    const previous = seen.get(base);
    if (previous === undefined) {
      seen.set(base, 1);
      keys.push(base);
    } else {
      const occurrence = previous + 1;
      seen.set(base, occurrence);
      duplicates.push(base);
      keys.push(disambiguateKey(base, occurrence));
    }
  }

  return { keys, headers, duplicates };
}

/**
 * Parse a workbook into records, descriptors, and a validation report.
 *
 * Never throws on data problems — a malformed file produces warnings and
 * whatever records could be recovered. It throws only when handed something
 * that is not a workbook at all, which is a caller error rather than a data one.
 */
export function parseWorkbook(
  data: ArrayBuffer | Uint8Array,
  options: ParseOptions,
): ParsedWorkbook {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });
  const matrices = readMatrices(workbook);
  const warnings: IngestWarning[] = [];

  const sheets = selectSheet(matrices, options.sheetName);
  const selected = sheets.find((candidate) => candidate.selected);
  const sheetName = selected?.name ?? workbook.SheetNames[0] ?? '';
  const matrix = matrices.get(sheetName) ?? [];

  const populatedSheets = sheets.filter((candidate) => candidate.populatedCellCount > 0);
  if (populatedSheets.length > 1) {
    warnings.push({
      code: 'multiple-populated-sheets',
      message:
        `${populatedSheets.length} sheets contain data. "${sheetName}" was selected ` +
        `as the densest (${selected?.populatedCellCount ?? 0} populated cells). ` +
        `Use the sheet picker if this is the wrong one.`,
    });
  }

  const detected = detectHeaderRow(matrix);
  const header =
    options.headerRowIndex === undefined
      ? detected
      : { ...detected, rowIndex: options.headerRowIndex, usedFallback: false };

  if (header.usedFallback) {
    warnings.push({
      code: 'header-row-fallback',
      message:
        `No row met the header thresholds, so row ${header.rowIndex + 1} was assumed. ` +
        `Every column in this file depends on that guess — confirm it before trusting the data.`,
    });
  }

  const width = matrixWidth(matrix);
  const headerRow = matrix[header.rowIndex] ?? [];
  const { keys, headers, duplicates } = buildKeys(headerRow, width);

  for (const duplicate of new Set(duplicates)) {
    warnings.push({
      code: 'duplicate-normalized-key',
      message:
        `More than one column normalizes to "${duplicate}". The later ones were ` +
        `suffixed rather than dropped, so no data was lost, but their headers are ` +
        `ambiguous and worth renaming at the source.`,
      affectedColumns: [duplicate],
    });
  }

  const dataRows = matrix.slice(header.rowIndex + 1);

  // Clean every cell once, up front. Profiling, dropping, and validation all
  // read from this — cleaning per-consumer would let them disagree about
  // whether a given cell is null.
  const cleanedRows: CellValue[][] = dataRows.map((row) => {
    const cleaned: CellValue[] = [];
    for (let index = 0; index < width; index += 1) {
      cleaned.push(cleanCell(row[index]));
    }
    return cleaned;
  });

  // Drop rows that are entirely empty before profiling. A trailing block of
  // blank spreadsheet rows would otherwise inflate every column's null count
  // and drag its cardinality ratio toward zero.
  const nonEmptyRows = cleanedRows
    .map((row, offset) => ({ row, sourceRowNumber: header.rowIndex + 2 + offset }))
    .filter(({ row }) => row.some((cell) => cell !== null));

  // Columns with neither a header nor any data are spreadsheet debris — the
  // sample's trailing pair at indices 27 and 28. Keeping them would put two
  // unnamed, unfillable columns in the picker. A column with no header but with
  // data is kept and given a synthesized key, because discarding real data to
  // tidy up a UI is the wrong trade.
  const columnIsPopulated: boolean[] = [];
  for (let index = 0; index < width; index += 1) {
    columnIsPopulated.push(nonEmptyRows.some(({ row }) => row[index] !== null));
  }

  const keptIndices: number[] = [];
  let discardedDebris = 0;
  const unnamedButPopulated: number[] = [];

  for (let index = 0; index < width; index += 1) {
    const hasHeader = keys[index] != null;
    const hasData = columnIsPopulated[index] === true;

    if (!hasHeader && !hasData) {
      discardedDebris += 1;
      continue;
    }
    if (!hasHeader) unnamedButPopulated.push(index);
    keptIndices.push(index);
  }

  if (discardedDebris > 0) {
    warnings.push({
      code: 'discarded-empty-columns',
      message:
        `${discardedDebris} column(s) had neither a header nor any data and were ` +
        `discarded as spreadsheet debris.`,
    });
  }

  if (unnamedButPopulated.length > 0) {
    warnings.push({
      code: 'unnamed-column',
      message:
        `${unnamedButPopulated.length} column(s) hold data under a blank header and ` +
        `were kept with a positional label. Their keys are position-based and will ` +
        `shift if columns are inserted upstream.`,
    });
  }

  /** Build descriptors for a given set of rows. Run twice — see below. */
  const describeAll = (rows: readonly CellValue[][]): ColumnDescriptor[] =>
    keptIndices.map((index) =>
      describeColumn({
        index,
        header: headers[index] ?? null,
        key: keys[index] ?? synthesizeKey(index),
        profile: profileColumn(rows.map((row) => row[index] ?? null)),
        rowCount: rows.length,
      }),
    );

  // Two passes, and the ordering is forced by a genuine circularity: rows are
  // dropped by consulting the location column, but identifying that column
  // requires roles, which require a profile, which requires knowing which rows
  // survive.
  //
  // Pass 1 is provisional and used only to locate the location column.
  const provisionalColumns = describeAll(nonEmptyRows.map(({ row }) => row));
  const provisionalBinding = bindColumns(provisionalColumns);

  // Drop rows with no value in the location dimension. This removes the
  // sample's trailing junk row, whose only content is `Used Land` = 0 and
  // `Unused Land` = 0 — a row that satisfies the utilization invariant
  // trivially and would otherwise pad the record count with a phantom site.
  const keptRows: { row: CellValue[]; sourceRowNumber: number }[] = [];
  const droppedRaw: { row: CellValue[]; sourceRowNumber: number }[] = [];
  const stateColumn =
    provisionalBinding.stateKey === null
      ? undefined
      : provisionalColumns.find((c) => c.normalizedKey === provisionalBinding.stateKey);

  for (const entry of nonEmptyRows) {
    const stateValue =
      stateColumn === undefined ? undefined : entry.row[stateColumn.index] ?? null;

    if (stateColumn !== undefined && stateValue === null) {
      droppedRaw.push(entry);
    } else {
      keptRows.push(entry);
    }
  }

  // Pass 2 profiles only the surviving rows. This is what the descriptors
  // report, and it is the only honest choice — a null count that includes a
  // row the user never sees would misstate the completeness of every column.
  // It also makes serial-index detection work: `Sr No` is blank on the junk
  // row, so against 131 rows it looks like a measure with one gap, and only
  // against the 130 real rows does it read as the row counter it is.
  const columns = describeAll(keptRows.map(({ row }) => row));
  const binding = bindColumns(columns);

  const valuesFor = (row: CellValue[]): Partial<Record<NormalizedKey, CellValue>> => {
    const values: Partial<Record<NormalizedKey, CellValue>> = {};
    for (const column of columns) {
      values[column.normalizedKey] = row[column.index] ?? null;
    }
    return values;
  };

  const records: ParsedRecord[] = keptRows.map(({ row, sourceRowNumber }) => ({
    id: `row-${sourceRowNumber}` as RecordId,
    sourceRowNumber,
    values: valuesFor(row),
    // Row-level warnings are derived from the validation report after it runs,
    // so a record's warnings and the report can never disagree.
    warnings: [],
  }));

  const droppedRows: DroppedRow[] = droppedRaw.map(({ row, sourceRowNumber }) => ({
    sourceRowNumber,
    reason: 'null-state',
    rawValues: valuesFor(row),
  }));

  if (droppedRows.length > 0) {
    warnings.push({
      code: 'rows-dropped',
      message:
        `${droppedRows.length} row(s) had no value in the location column and were ` +
        `dropped. They are listed in the drop report.`,
      affectedRowCount: droppedRows.length,
    });
  }

  const validation = validateRecords(records, binding);

  if (validation.entries.length > 0) {
    warnings.push({
      code: 'invariant-violations',
      message:
        `${validation.entries.length} invariant violation(s) across ` +
        `${new Set(validation.entries.map((entry) => entry.rowIndex)).size} row(s). ` +
        `Figures are reported as found and have not been corrected.`,
      affectedRowCount: new Set(validation.entries.map((entry) => entry.rowIndex)).size,
    });
  }

  for (const invariant of validation.unboundInvariants) {
    warnings.push({
      code: 'unbound-invariant',
      message:
        `The ${invariant} invariant could not run: no column matched the roles it ` +
        `needs. This is not a clean result — the check never executed.`,
    });
  }

  const measureCount = columns.filter((c) => effectiveRole(c) === 'measure').length;
  const dimensionCount = columns.filter((c) => effectiveRole(c) === 'dimension').length;
  const metaCount = columns.filter((c) => effectiveRole(c) === 'meta').length;
  const nameOnly = columns.filter((c) => c.inferredFromNameOnly);

  if (measureCount === 0) {
    warnings.push({
      code: 'no-measure-columns',
      message:
        'No column was inferred as a measure, so the choropleth has nothing to ramp. ' +
        'Assign a measure manually in the column settings.',
    });
  }

  if (nameOnly.length > 0) {
    warnings.push({
      code: 'name-only-inference',
      message:
        `${nameOnly.length} empty column(s) were assigned a role from their header ` +
        `text alone. Confirm these before relying on them.`,
      affectedColumns: nameOnly.map((column) => column.normalizedKey),
    });
  }

  const stats: IngestStats = {
    totalRowsInSheet: nonEmptyRows.length,
    parsedRecordCount: records.length,
    droppedRowCount: droppedRows.length,
    recordsWithWarnings: new Set(validation.entries.map((entry) => entry.rowIndex)).size,
    columnCount: columns.length,
    emptyColumnCount: columns.filter((column) => column.isEmptyInSample).length,
    measureCount,
    dimensionCount,
    metaCount,
    nameOnlyInferenceCount: nameOnly.length,
  };

  return {
    sheetName,
    sheets,
    header,
    columns,
    records,
    droppedRows,
    validation,
    warnings,
    stats,
    parsedAt: new Date().toISOString(),
    sourceFileName: options.fileName,
  };
}
