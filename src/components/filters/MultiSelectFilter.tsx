'use client';

/**
 * A searchable multi-select facet with orphan handling.
 *
 * ## The orphan section is the point of this component
 *
 * When an upstream change invalidates a selection, the value is NOT removed. It
 * moves to a section above the option list, struck through, badged "no longer
 * available", with a one-click restore that re-widens whichever upstream filter
 * is blocking it.
 *
 * Silently dropping it is the usual implementation and it is how cascading
 * filters lose a user's trust: they narrow by state, three districts disappear
 * from their selection, and nothing on screen ever says so. Later they read a
 * total that is missing data they believe they asked for. The failure is
 * invisible at the moment it happens and indistinguishable from correct
 * behaviour afterwards, which is exactly what makes it corrosive.
 *
 * Because active selections are *derived* rather than stored (see
 * `lib/filters/types.ts`), an orphan also revives by itself the moment the
 * upstream filter widens again — whether by the restore button or by the user
 * changing their mind independently.
 */

import { useDeferredValue, useId, useMemo, useState } from 'react';

import type { FacetView, FilterDimension, OrphanedSelection } from '@/lib/filters';
import { DIMENSION_LABELS } from '@/lib/filters';

export interface MultiSelectFilterProps {
  readonly view: FacetView;
  readonly onToggle: (dimension: FilterDimension, value: string) => void;
  readonly onSetValues: (dimension: FilterDimension, values: readonly string[]) => void;
  readonly onClear: (dimension: FilterDimension) => void;
  readonly onRestore: (orphan: OrphanedSelection) => void;
  readonly onRemoveOrphan: (dimension: FilterDimension, value: string) => void;
  /** Rendered smaller when nested inside the cascade group. */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

/** Above this, the list virtualises to a scroll box rather than growing. */
const SCROLL_AFTER = 8;

export function MultiSelectFilter({
  view,
  onToggle,
  onSetValues,
  onClear,
  onRestore,
  onRemoveOrphan,
  disabled = false,
  disabledReason,
}: MultiSelectFilterProps) {
  const [query, setQuery] = useState('');
  // Typing in a 124-entry site list re-filters on every keystroke; deferring
  // keeps the input responsive while the list catches up.
  const deferredQuery = useDeferredValue(query);
  const searchId = useId();

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (needle.length === 0) return view.options;
    return view.options.filter((option) => option.value.toLowerCase().includes(needle));
  }, [view.options, deferredQuery]);

  const label = DIMENSION_LABELS[view.dimension];
  const selectedCount = view.options.filter((o) => o.selected).length + view.orphaned.length;

  // Select-all applies to what is CURRENTLY VISIBLE, not to every option. After
  // a search for "Ludh", "Select all" that quietly selected 78 districts would
  // be a nasty surprise; the label says which it is.
  const selectAllTarget = filtered.filter((o) => !o.selected).map((o) => o.value);

  return (
    <fieldset
      className="rounded-md border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      disabled={disabled}
    >
      <legend className="sr-only">{label} filter</legend>

      <div className="flex items-baseline justify-between gap-2 px-2.5 pt-2">
        <span className="text-xs font-semibold text-slate-900 dark:text-neutral-100">
          {label}
          {selectedCount > 0 && (
            <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {selectedCount}
            </span>
          )}
        </span>
        <span className="text-[11px] tabular-nums text-slate-400 dark:text-neutral-500">
          {view.availableCount} available
        </span>
      </div>

      {disabled && disabledReason !== undefined && (
        <p className="px-2.5 pb-2 pt-1 text-[11px] text-slate-500 dark:text-neutral-400">
          {disabledReason}
        </p>
      )}

      {!disabled && (
        <>
          {/* ---- orphaned selections, above everything else ---- */}
          {view.orphaned.length > 0 && (
            <div
              role="status"
              className="mx-2.5 mt-2 rounded border border-amber-300 bg-amber-50 p-1.5 dark:border-amber-800/70 dark:bg-amber-950/40"
            >
              <p className="mb-1 text-[11px] font-medium text-amber-900 dark:text-amber-200">
                {view.orphaned.length} selection{view.orphaned.length === 1 ? '' : 's'} no
                longer available
              </p>

              <ul className="space-y-1">
                {view.orphaned.map((orphan) => (
                  <li key={orphan.value} className="flex items-center gap-1.5">
                    <span
                      className="flex-1 truncate text-[11px] text-amber-900 line-through decoration-amber-500 dark:text-amber-200"
                      title={orphan.reason}
                    >
                      {orphan.value}
                    </span>

                    <button
                      type="button"
                      onClick={() => onRestore(orphan)}
                      title={`Restore by widening: ${orphan.reason}`}
                      className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:bg-amber-900 dark:text-amber-100 dark:hover:bg-amber-800"
                    >
                      Restore
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemoveOrphan(view.dimension, orphan.value)}
                      aria-label={`Remove ${orphan.value} from the ${label} filter`}
                      className="shrink-0 rounded px-1 text-[11px] text-amber-700 hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:text-amber-300 dark:hover:bg-amber-900"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- search ---- */}
          <div className="px-2.5 pt-2">
            <label htmlFor={searchId} className="sr-only">
              Search {label}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:placeholder:text-neutral-500"
            />
          </div>

          {/* ---- bulk actions ---- */}
          <div className="flex gap-2 px-2.5 pt-1.5 text-[11px]">
            <button
              type="button"
              disabled={selectAllTarget.length === 0}
              onClick={() =>
                onSetValues(view.dimension, [
                  ...view.options.filter((o) => o.selected).map((o) => o.value),
                  ...selectAllTarget,
                ])
              }
              className="text-blue-600 hover:underline disabled:text-slate-300 disabled:no-underline dark:text-blue-400 dark:disabled:text-neutral-700"
            >
              {deferredQuery.trim().length > 0
                ? `Select ${selectAllTarget.length} matching`
                : 'Select all'}
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => onClear(view.dimension)}
              className="text-slate-500 hover:underline disabled:text-slate-300 disabled:no-underline dark:text-neutral-400 dark:disabled:text-neutral-700"
            >
              Clear
            </button>
          </div>

          {/* ---- options ---- */}
          <ul
            className={`mt-1 space-y-px px-1.5 pb-2 ${
              filtered.length > SCROLL_AFTER ? 'max-h-52 overflow-y-auto' : ''
            }`}
          >
            {filtered.length === 0 && (
              <li className="px-1 py-2 text-[11px] text-slate-400 dark:text-neutral-500">
                {view.options.length === 0
                  ? 'Nothing available under the filters above.'
                  : 'No matches.'}
              </li>
            )}

            {filtered.map((option) => (
              <li key={option.value}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50 dark:hover:bg-neutral-800 ${
                    // Zero-count options stay visible and selectable. Hiding
                    // them makes the list shift under the user mid-task, and
                    // "exists but not under your current filters" is useful.
                    option.count === 0 ? 'opacity-55' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={option.selected}
                    onChange={() => onToggle(view.dimension, option.value)}
                    className="h-3.5 w-3.5 shrink-0 accent-blue-600"
                  />
                  <span className="flex-1 truncate text-xs text-slate-700 dark:text-neutral-300">
                    {option.value}
                  </span>
                  <span
                    className="shrink-0 tabular-nums text-[11px] text-slate-400 dark:text-neutral-500"
                    aria-label={`${option.count} records`}
                  >
                    {option.count}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}
