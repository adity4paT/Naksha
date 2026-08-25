'use client';

/**
 * The unmapped records panel.
 *
 * CLAUDE.md: "Any row that fails to join to a boundary must appear in a visible
 * 'unmapped records' panel with its acreage. Never drop it silently."
 *
 * Three properties this component is built to guarantee:
 *
 * 1. **It is always present.** Collapsed by default, never removed. There is no
 *    prop that hides it and no early return that omits it — when the count is
 *    zero it renders a green "all records mapped" state instead. A panel that
 *    disappears when empty trains users to stop looking for it, and then a
 *    later upload with six unmapped rows arrives in a place nobody checks.
 *
 * 2. **The total is always visible**, in the collapsed header, without
 *    expanding anything. "6 records / 12,430 acres not shown on map" is the
 *    number that tells a user whether the map they are reading is complete.
 *
 * 3. **Acreage is never optional.** Every row carries it, so the panel total
 *    and the map total reconcile against the workbook total exactly.
 */

import { useMemo } from 'react';

import type { UnmappedEntry } from '@/lib/aggregate';

export interface UnmappedPanelProps {
  readonly entries: readonly UnmappedEntry[];
  /** Acreage placed on the map, for the share calculation. */
  readonly mappedTotal: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}

function formatAcres(value: number): string {
  return Math.round(value).toLocaleString('en-IN');
}

export function UnmappedPanel({
  entries,
  mappedTotal,
  open,
  onToggle,
}: UnmappedPanelProps) {
  const unmappedTotal = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.acres, 0),
    [entries],
  );

  const grandTotal = mappedTotal + unmappedTotal;
  const share = grandTotal > 0 ? (unmappedTotal / grandTotal) * 100 : 0;
  const isClean = entries.length === 0;

  return (
    <section
      aria-label="Unmapped records"
      className={
        isClean
          ? 'rounded-lg border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/30'
          : 'rounded-lg border border-red-300 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30'
      }
    >
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="unmapped-panel-body"
          disabled={isClean}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-default"
        >
          {!isClean && (
            <span
              aria-hidden="true"
              className={`text-xs text-red-700 transition-transform dark:text-red-300 ${open ? 'rotate-90' : ''}`}
            >
              ▶
            </span>
          )}

          {isClean ? (
            <span className="font-medium text-emerald-800 dark:text-emerald-300">
              All records mapped — nothing missing from this view
            </span>
          ) : (
            <>
              <span className="font-medium text-red-800 dark:text-red-200">
                {entries.length} record{entries.length === 1 ? '' : 's'} /{' '}
                <span className="tabular-nums">{formatAcres(unmappedTotal)}</span> acres
                not shown on map
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-xs text-red-700 dark:text-red-300">
                {share.toFixed(1)}% of total
              </span>
            </>
          )}
        </button>
      </h2>

      {open && !isClean && (
        <div id="unmapped-panel-body" className="border-t border-red-200 dark:border-red-900/60">
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">
                Records that could not be matched to a boundary, with their acreage
              </caption>
              <thead className="sticky top-0 bg-red-100/90 text-red-900 dark:bg-red-950/80 dark:text-red-200">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">Row</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Site</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">State</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">District</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">Acres</th>
                  <th scope="col" className="px-3 py-1.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-200/70 dark:divide-red-900/40">
                {entries.map((entry) => (
                  <tr key={entry.recordId} className="align-top">
                    <td className="px-3 py-1.5 tabular-nums text-slate-500 dark:text-neutral-400">
                      {entry.sourceRowNumber}
                    </td>
                    <td className="px-3 py-1.5 text-slate-800 dark:text-neutral-200">
                      {entry.siteName ?? '—'}
                    </td>
                    {/*
                      Raw spreadsheet spellings, not canonical names. The user
                      has to find these strings in their own file to fix them,
                      and showing a normalized form would send them looking for
                      text that is not there.
                    */}
                    <td className="px-3 py-1.5 text-slate-800 dark:text-neutral-200">
                      {entry.rawState ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-800 dark:text-neutral-200">
                      {entry.rawDistrict ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800 dark:text-neutral-200">
                      {formatAcres(entry.acres)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 dark:text-neutral-400">
                      {entry.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-red-300 bg-red-100/70 font-medium dark:border-red-800 dark:bg-red-950/60">
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-red-900 dark:text-red-200">
                    Total not shown
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-red-900 dark:text-red-200">
                    {formatAcres(unmappedTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="border-t border-red-200 px-3 py-2 text-[11px] leading-snug text-red-800 dark:border-red-900/60 dark:text-red-300">
            These rows are counted in no region on the map. Add an entry to{' '}
            <code className="rounded bg-red-200/60 px-1 dark:bg-red-900/50">
              public/geo/aliases.json
            </code>{' '}
            to map a spelling, then reload — no rebuild required.
          </p>
        </div>
      )}
    </section>
  );
}
