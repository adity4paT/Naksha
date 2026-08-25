'use client';

/**
 * Filter summary chip bar.
 *
 * One chip per active constraint with its own X, plus "Reset all". The point is
 * that the complete filter state is legible without opening any panel — a user
 * looking at a total should be able to see, in one glance, everything that
 * total excludes.
 *
 * Orphaned selections get chips too, visually distinct. They are not filtering
 * anything, but they ARE part of the user's stated intent, and a chip bar that
 * showed only active filters would let an orphan sit unnoticed in a collapsed
 * panel.
 */

import type {
  FilterDimension,
  FilterSelections,
  MeasureBounds,
  OrphanedSelection,
} from '@/lib/filters';
import { DIMENSION_LABELS, isRangeActive } from '@/lib/filters';

export interface FilterChipsProps {
  readonly selections: FilterSelections;
  readonly active: Readonly<Record<FilterDimension, readonly string[]>>;
  readonly orphaned: readonly OrphanedSelection[];
  readonly bounds: readonly MeasureBounds[];
  readonly onRemove: (dimension: FilterDimension, value: string) => void;
  readonly onClearRange: (key: string) => void;
  readonly onResetAll: () => void;
  /** Records passing the current filters, out of the total. */
  readonly matched: number;
  readonly total: number;
}

const DIMENSIONS: readonly FilterDimension[] = ['business', 'state', 'district', 'site'];

export function FilterChips({
  selections,
  active,
  orphaned,
  bounds,
  onRemove,
  onClearRange,
  onResetAll,
  matched,
  total,
}: FilterChipsProps) {
  const orphanKeys = new Set(orphaned.map((o) => `${o.dimension}|${o.value}`));

  const activeRanges = Object.entries(selections.ranges).filter(([key, range]) => {
    const bound = bounds.find((b) => b.key === key);
    return bound !== undefined && isRangeActive(range, bound);
  });

  const chipCount =
    DIMENSIONS.reduce((sum, d) => sum + selections[d].length, 0) + activeRanges.length;

  if (chipCount === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-neutral-400">
        <span>No filters</span>
        <span className="tabular-nums">
          · showing all {total.toLocaleString('en-IN')} records
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs tabular-nums text-stone-600 dark:text-neutral-300">
        <strong className="font-semibold">{matched.toLocaleString('en-IN')}</strong> of{' '}
        {total.toLocaleString('en-IN')} records
      </span>

      <span aria-hidden="true" className="text-stone-300 dark:text-neutral-600">
        |
      </span>

      {DIMENSIONS.flatMap((dimension) =>
        selections[dimension].map((value) => {
          const isOrphan = orphanKeys.has(`${dimension}|${value}`);
          const isActive = active[dimension].includes(value);

          return (
            <span
              key={`${dimension}-${value}`}
              className={
                isOrphan
                  ? 'inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 py-0.5 pl-2 pr-1 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                  : 'inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-2 pr-1 text-[11px] text-stone-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
              }
              title={
                isOrphan
                  ? `${DIMENSIONS.includes(dimension) ? DIMENSION_LABELS[dimension] : dimension}: ${value} — no longer available under the current filters`
                  : undefined
              }
            >
              <span className="text-stone-500 dark:text-neutral-500">
                {DIMENSION_LABELS[dimension]}
              </span>
              <span className={isOrphan ? 'line-through decoration-amber-500' : ''}>
                {value}
              </span>
              {isOrphan && (
                <span className="rounded bg-amber-200 px-1 text-[9px] font-medium uppercase tracking-wide text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                  unavailable
                </span>
              )}
              {!isActive && !isOrphan && (
                <span className="text-[9px] text-stone-500">inactive</span>
              )}
              <button
                type="button"
                onClick={() => onRemove(dimension, value)}
                aria-label={`Remove ${DIMENSION_LABELS[dimension]} filter ${value}`}
                className="rounded-full px-1 text-stone-500 hover:bg-stone-200 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
              >
                ✕
              </button>
            </span>
          );
        }),
      )}

      {activeRanges.map(([key, range]) => {
        const bound = bounds.find((b) => b.key === key);
        return (
          <span
            key={`range-${key}`}
            className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 py-0.5 pl-2 pr-1 text-[11px] text-stone-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            <span className="text-stone-500 dark:text-neutral-500">
              {bound?.label ?? key}
            </span>
            <span className="tabular-nums">
              {range.min.toLocaleString('en-IN')}–{range.max.toLocaleString('en-IN')}
            </span>
            <button
              type="button"
              onClick={() => onClearRange(key)}
              aria-label={`Remove ${bound?.label ?? key} range filter`}
              className="rounded-full px-1 text-stone-500 hover:bg-stone-200 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
            >
              ✕
            </button>
          </span>
        );
      })}

      <button
        type="button"
        onClick={onResetAll}
        className="ml-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/40"
      >
        Reset all
      </button>
    </div>
  );
}
