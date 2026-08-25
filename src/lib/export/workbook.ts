/**
 * Exporting filtered records to .xlsx.
 *
 * ## The provenance sheet is the point
 *
 * An extract with no record of the filters that produced it is a number
 * without a question. Someone opens `land-extract.xlsx` three weeks later,
 * reads "48,210 acres", and has no way to know whether that was one business
 * or all three, one state or eighteen, or which measure it aggregated. The
 * number gets quoted, and it is wrong in a way nobody can detect from the file
 * itself.
 *
 * So every export carries a second sheet recording exactly what produced it:
 * the source workbook, the timestamp, every active filter, the row counts on
 * both sides of the filter, and the boundary vintage the geography was resolved
 * against. It costs one sheet and it makes the first sheet quotable.
 *
 * ## Original headers, not internal keys
 *
 * Columns are written with the header text from the source file — trailing
 * spaces, CRLF, typos and all. A user opening the export should see the same
 * column names they sent us, not `na_clu_pending_acres`. The whole point of
 * keeping `ColumnDescriptor.name` verbatim is so this round-trips.
 */

import * as XLSX from 'xlsx';

import type { MeasureDescriptor } from '@/lib/measures';
import type { FilterSelections } from '@/lib/filters';
import type { CellValue, ColumnDescriptor, ParsedRecord } from '@/types/schema';

/** What produced this extract. Written verbatim onto the provenance sheet. */
export interface ExportProvenance {
  readonly sourceFileName: string | null;
  readonly sourceLoadedAt: string | null;
  readonly measure: MeasureDescriptor;
  readonly selections: FilterSelections;
  /** Rows in the loaded dataset, before filtering. */
  readonly totalRecords: number;
  /** Rows in this extract. */
  readonly exportedRecords: number;
  /** Records that resolved to no boundary, and their acreage. */
  readonly unmappedRecords: number;
  readonly unmappedAcres: number;
  /** Boundary source, from `public/geo/provenance.json`. */
  readonly boundaryCommit: string;
  readonly boundaryVintage: string;
  /** Invariant violations in the loaded dataset. */
  readonly invariantViolations: number;
  /** Names resolved by fuzzy match rather than exactly. */
  readonly fuzzyMatchedNames: number;
}

const SHEET_DATA = 'Filtered Data';
const SHEET_PROVENANCE = 'Export Provenance';

/** Excel cannot store a Date without a format; ISO strings round-trip cleanly. */
function toCell(value: CellValue): string | number | boolean | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

const formatList = (values: readonly string[]): string =>
  values.length === 0 ? '(all)' : values.join(', ');

/**
 * Build the provenance rows.
 *
 * Written as label/value pairs rather than a wide table so it stays readable in
 * Excel without horizontal scrolling, and so adding a field later does not
 * shift existing columns.
 */
function provenanceRows(provenance: ExportProvenance): (string | number)[][] {
  const { selections } = provenance;

  const rangeRows = Object.entries(selections.ranges).map(([key, range]) => [
    `  range · ${key}`,
    `${range.min} to ${range.max}`,
  ]);

  return [
    ['Naksha — Land MIS extract'],
    [],
    ['Exported at', new Date().toISOString()],
    ['Source workbook', provenance.sourceFileName ?? '(unknown)'],
    ['Source loaded at', provenance.sourceLoadedAt ?? '(unknown)'],
    [],
    ['— FILTERS APPLIED —'],
    ['Business', formatList(selections.business)],
    ['State', formatList(selections.state)],
    ['District', formatList(selections.district)],
    ['Site', formatList(selections.site)],
    ...rangeRows,
    [],
    ['— MEASURE SHOWN ON MAP —'],
    ['Measure', provenance.measure.label],
    [
      'Source',
      provenance.measure.kind === 'derived'
        ? `Calculated: ${provenance.measure.formula}`
        : 'Column in the source workbook',
    ],
    [
      'Aggregation',
      provenance.measure.aggregation === 'ratio'
        ? 'Ratio of sums (numerators summed, denominator summed, divided once)'
        : provenance.measure.aggregation === 'mean'
          ? 'Arithmetic mean, unweighted'
          : 'Sum',
    ],
    [],
    ['— ROW COUNTS —'],
    ['Rows in source dataset', provenance.totalRecords],
    ['Rows in this extract', provenance.exportedRecords],
    [
      'Rows excluded by filters',
      provenance.totalRecords - provenance.exportedRecords,
    ],
    [],
    ['— DATA QUALITY —'],
    // Carried into the export because these caveats travel with the numbers.
    // A reader of the extract has no other way to learn them.
    ['Records not shown on the map', provenance.unmappedRecords],
    ['Acres not shown on the map', Math.round(provenance.unmappedAcres)],
    ['Invariant violations in source', provenance.invariantViolations],
    ['Place names matched by fuzzy spelling', provenance.fuzzyMatchedNames],
    [],
    ['— GEOGRAPHY —'],
    ['Boundary source commit', provenance.boundaryCommit],
    ['Boundary vintage', provenance.boundaryVintage],
    [],
    ['— LIMITATIONS —'],
    [
      'Location precision',
      'District-level only. Every site is placed at its district polygon; there are no surveyed coordinates in this data.',
    ],
    [
      'Area figures',
      'Taken from the source spreadsheet as stated. No acreage is measured or derived from map geometry.',
    ],
  ];
}

/**
 * Build the export workbook.
 *
 * Returns bytes rather than triggering a download, so the caller controls when
 * and how the file is delivered and so this stays testable without a DOM.
 */
export function buildExportWorkbook(
  records: readonly ParsedRecord[],
  columns: readonly ColumnDescriptor[],
  provenance: ExportProvenance,
): Uint8Array {
  // Original header text, verbatim. A column with no header at all gets its
  // display label, which is the synthesized "Column 28".
  const headers = columns.map((column) => column.name ?? column.displayLabel);

  const rows: (string | number | boolean | null)[][] = [
    headers,
    ...records.map((record) =>
      columns.map((column) => toCell(record.values[column.normalizedKey] ?? null)),
    ),
  ];

  const book = XLSX.utils.book_new();

  const data = XLSX.utils.aoa_to_sheet(rows);
  // Rough column widths so the export opens readable rather than with every
  // column collapsed to its default.
  data['!cols'] = headers.map((header) => ({ wch: Math.min(28, Math.max(10, header.length + 2)) }));
  XLSX.utils.book_append_sheet(book, data, SHEET_DATA);

  const meta = XLSX.utils.aoa_to_sheet(provenanceRows(provenance));
  meta['!cols'] = [{ wch: 38 }, { wch: 72 }];
  XLSX.utils.book_append_sheet(book, meta, SHEET_PROVENANCE);

  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

/** Filename for an extract, timestamped so successive exports do not collide. */
export function exportFileName(sourceFileName: string | null): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = (sourceFileName ?? 'land-mis')
    .replace(/\.(xlsx|xlsm)$/i, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base}-extract-${stamp}.xlsx`;
}

/** Sheet names, exported so tests can assert on them. */
export const EXPORT_SHEETS = { data: SHEET_DATA, provenance: SHEET_PROVENANCE } as const;
