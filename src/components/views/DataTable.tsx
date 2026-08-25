'use client';

/**
 * Sortable table of the filtered records.
 *
 * Reads `filteredRecords` from the shared derivation, never its own query. The
 * row count here and the acreage on the map come from one computation, so they
 * cannot disagree — a table showing 47 rows beside a map summing 52 is the
 * classic symptom of a parallel query path, and it is unfixable once it exists
 * because nothing is authoritative.
 *
 * Rows are windowed rather than virtualised: a slice is rendered and the rest
 * reached by paging. 130 records need neither, but a production file of 20,000
 * would put 20,000 DOM rows on the page and make sorting feel broken. Paging is
 * a fraction of the complexity of a virtualiser and degrades honestly.
 */

import { useMemo, useState } from 'react';

import { formatMeasureValue } from '@/lib/measures';
import type { MeasureDescriptor } from '@/lib/measures';
import type { CellValue, ColumnDescriptor, ParsedRecord } from '@/types/schema';
import { effectiveRole } from '@/types/schema';

export interface DataTableProps {
  readonly records: readonly ParsedRecord[];
  readonly columns: readonly ColumnDescriptor[];
  readonly measure: MeasureDescriptor | null;
  /** Total in the dataset, for the "of N" line. */
  readonly totalRecords: number;
}

const PAGE_SIZE = 50;

type SortDirection = 'asc' | 'desc';

/** Cell rendering. Dates as ISO dates; nulls as an em dash, never as blank. */
function renderCell(value: CellValue): string {
  if (value === null) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value;
}

/** Comparator that keeps nulls last in both directions. */
function compare(a: CellValue, b: CellValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

export function DataTable({ records, columns, measure, totalRecords }: DataTableProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(0);

  // Empty columns are hidden here but not dropped from the dataset or the
  // export — a table of 14 columns of em dashes is noise, while the export
  // still needs to round-trip them.
  const visible = useMemo(
    () => columns.filter((column) => !column.isEmptyInSample),
    [columns],
  );

  const sorted = useMemo(() => {
    if (sortKey === null) return records;
    const factor = direction === 'asc' ? 1 : -1;
    return [...records].sort(
      (a, b) => factor * compare(a.values[sortKey as never] ?? null, b.values[sortKey as never] ?? null),
    );
  }, [records, sortKey, direction]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('asc');
    }
    setPage(0);
  };

  return (
    <section aria-label="Filtered records" className="flex min-h-0 flex-col">
      <header className="flex items-baseline justify-between gap-3 px-1 pb-2">
        <h2 className="text-xs font-semibold text-stone-700">Records</h2>
        <p className="text-[11px] tabular-nums text-stone-500">
          {records.length.toLocaleString('en-IN')} of{' '}
          {totalRecords.toLocaleString('en-IN')}
          {pageCount > 1 && (
            <>
              {' '}
              · page {safePage + 1} of {pageCount}
            </>
          )}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-stone-200 bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Filtered land records. Select a column header to sort by it.
          </caption>
          <thead className="sticky top-0 z-10 bg-stone-100">
            <tr>
              {visible.map((column) => {
                const key = column.normalizedKey as string;
                const active = sortKey === key;
                const isMeasure = effectiveRole(column) === 'measure';

                return (
                  <th
                    key={key}
                    scope="col"
                    // Communicates sort state to assistive tech, not only by
                    // the arrow glyph.
                    aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`whitespace-nowrap border-b border-stone-200 px-2 py-1.5 font-medium text-stone-600 ${
                      isMeasure ? 'text-right' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      className="inline-flex items-center gap-1 rounded px-0.5 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                    >
                      {column.displayLabel.trim()}
                      <span aria-hidden="true" className="text-[9px] text-stone-400">
                        {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {slice.map((record) => (
              <tr key={record.id} className="even:bg-stone-50/60 hover:bg-sky-50">
                {visible.map((column) => {
                  const isMeasure = effectiveRole(column) === 'measure';
                  const raw = record.values[column.normalizedKey] ?? null;

                  return (
                    <td
                      key={column.normalizedKey}
                      className={`max-w-[18rem] truncate border-b border-stone-100 px-2 py-1 text-stone-700 ${
                        isMeasure ? 'text-right tabular-nums' : ''
                      }`}
                      title={renderCell(raw)}
                    >
                      {/* The active measure's own column is formatted in its
                          unit so the table agrees with the legend. */}
                      {isMeasure &&
                      measure?.kind === 'sheet' &&
                      measure.columnKey === column.normalizedKey &&
                      typeof raw === 'number'
                        ? formatMeasureValue(measure, raw)
                        : renderCell(raw)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {slice.length === 0 && (
          <p className="p-4 text-center text-xs text-stone-500">
            No records match the current filters.
          </p>
        )}
      </div>

      {pageCount > 1 && (
        <nav
          aria-label="Table pages"
          className="flex items-center justify-end gap-2 px-1 pt-2"
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="rounded border border-stone-300 px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
            className="rounded border border-stone-300 px-2 py-0.5 text-[11px] text-stone-700 hover:bg-stone-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
