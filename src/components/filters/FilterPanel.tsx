'use client';

/**
 * The filter panel.
 *
 * Layout mirrors the data model, deliberately:
 *
 * - **Business** sits in its own group at the top, separated by a rule and
 *   labelled as cross-cutting. It is not a geographic level and never narrows,
 *   so grouping it with State/District/Site would misrepresent how it behaves.
 * - **The geographic cascade** follows, indented and connected, with each level
 *   showing what it is narrowed by. The visual nesting is the explanation for
 *   why the district list has 22 entries instead of 724.
 * - **Measure ranges** last, since they cut across everything.
 *
 * All of it reads from one Zustand store, which is the same store the map
 * reads. Ticking Gujarat here and clicking Gujarat on the map are the same
 * write.
 */

import { useMemo } from 'react';

import type { FacetRow, FilterDimension, OrphanedSelection } from '@/lib/filters';
import {
  applyFilters,
  buildAllFacets,
  DIMENSION_LABELS,
  measureBounds,
} from '@/lib/filters';
import { useFilterStore } from '@/store/filters';
import { FilterChips } from './FilterChips';
import { MultiSelectFilter } from './MultiSelectFilter';
import { RangeFilter } from './RangeFilter';

export interface FilterPanelProps {
  /** One row per parsed record, already joined to canonical region names. */
  readonly rows: readonly FacetRow[];
  /** Measure columns offered as range filters, discovered at upload. */
  readonly measures: readonly { key: string; label: string }[];
}

export function FilterPanel({ rows, measures }: FilterPanelProps) {
  const selections = useFilterStore((s) => s.selections);
  const toggleValue = useFilterStore((s) => s.toggleValue);
  const setValues = useFilterStore((s) => s.setValues);
  const removeValue = useFilterStore((s) => s.removeValue);
  const clearDimension = useFilterStore((s) => s.clearDimension);
  const restoreOrphan = useFilterStore((s) => s.restoreOrphan);
  const setRange = useFilterStore((s) => s.setRange);
  const clearRange = useFilterStore((s) => s.clearRange);
  const resetAll = useFilterStore((s) => s.resetAll);
  const urlTruncated = useFilterStore((s) => s.urlTruncated);

  const { active, views } = useMemo(
    () => buildAllFacets(rows, selections),
    [rows, selections],
  );

  const bounds = useMemo(() => measureBounds(rows, measures), [rows, measures]);
  const matched = useMemo(() => applyFilters(rows, selections).length, [rows, selections]);

  const byDimension = useMemo(
    () => new Map(views.map((view) => [view.dimension, view])),
    [views],
  );

  const allOrphans: OrphanedSelection[] = useMemo(
    () => views.flatMap((view) => view.orphaned),
    [views],
  );

  const handleRestore = (orphan: OrphanedSelection) => restoreOrphan(orphan.restore);

  /** What the cascade level below is narrowed by, for the hint line. */
  const narrowedBy = (dimension: FilterDimension): string | null => {
    const parts: string[] = [];
    if (dimension !== 'business' && active.business.length > 0) {
      parts.push(`${active.business.length} business`);
    }
    if ((dimension === 'district' || dimension === 'site') && active.state.length > 0) {
      parts.push(`${active.state.length} state${active.state.length === 1 ? '' : 's'}`);
    }
    if (dimension === 'site' && active.district.length > 0) {
      parts.push(
        `${active.district.length} district${active.district.length === 1 ? '' : 's'}`,
      );
    }
    return parts.length === 0 ? null : `narrowed by ${parts.join(', ')}`;
  };

  const business = byDimension.get('business');

  return (
    <aside
      id="filter-panel"
      aria-label="Filters"
      className="flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-stone-200 bg-stone-50 p-3 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <FilterChips
        selections={selections}
        active={active}
        orphaned={allOrphans}
        bounds={bounds}
        onRemove={removeValue}
        onClearRange={clearRange}
        onResetAll={resetAll}
        matched={matched}
        total={rows.length}
      />

      {urlTruncated.length > 0 && (
        <p
          role="status"
          className="rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          The shareable link was too long, so{' '}
          {urlTruncated.map((d) => DIMENSION_LABELS[d as FilterDimension] ?? d).join(', ')}{' '}
          {urlTruncated.length === 1 ? 'was' : 'were'} left out of it. Your filters here
          are unaffected.
        </p>
      )}

      {/* ---- independent group ---- */}
      {business !== undefined && (
        <section aria-labelledby="filters-independent">
          <h2
            id="filters-independent"
            className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-neutral-400"
          >
            Cross-cutting
          </h2>
          <MultiSelectFilter
            view={business}
            onToggle={toggleValue}
            onSetValues={setValues}
            onClear={clearDimension}
            onRestore={handleRestore}
            onRemoveOrphan={removeValue}
          />
          <p className="mt-1 px-0.5 text-[10px] leading-snug text-stone-500 dark:text-neutral-500">
            Applies across all geography. This list never narrows — only its counts change.
          </p>
        </section>
      )}

      <hr className="border-stone-200 dark:border-neutral-800" />

      {/* ---- geographic cascade ---- */}
      <section aria-labelledby="filters-cascade">
        <h2
          id="filters-cascade"
          className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-neutral-400"
        >
          Geography
        </h2>

        <div className="space-y-2">
          {(['state', 'district', 'site'] as const).map((dimension, index) => {
            const view = byDimension.get(dimension);
            if (view === undefined) return null;
            const hint = narrowedBy(dimension);

            return (
              <div
                key={dimension}
                // Progressive indent, with a connecting rule, so the dependency
                // direction is visible rather than something to be inferred
                // from behaviour.
                style={{ marginLeft: index * 8 }}
                className={
                  index > 0
                    ? 'border-l-2 border-stone-200 pl-2 dark:border-neutral-800'
                    : undefined
                }
              >
                <MultiSelectFilter
                  view={view}
                  onToggle={toggleValue}
                  onSetValues={setValues}
                  onClear={clearDimension}
                  onRestore={handleRestore}
                  onRemoveOrphan={removeValue}
                />
                {hint !== null && (
                  <p className="mt-0.5 px-0.5 text-[10px] text-stone-500 dark:text-neutral-500">
                    {hint}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- measures ---- */}
      {bounds.length > 0 && (
        <>
          <hr className="border-stone-200 dark:border-neutral-800" />
          <section aria-labelledby="filters-measures">
            <h2
              id="filters-measures"
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-neutral-400"
            >
              Measures (acres)
            </h2>
            <div className="space-y-2">
              {bounds.map((bound) => (
                <RangeFilter
                  key={bound.key}
                  bounds={bound}
                  range={selections.ranges[bound.key]}
                  onChange={setRange}
                  onClear={clearRange}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
