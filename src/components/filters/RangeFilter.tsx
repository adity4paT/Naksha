'use client';

/**
 * Numeric range filter: two drag handles plus two typed entry boxes.
 *
 * Both input methods edit the same value. The sliders are for exploration —
 * seeing how the map responds as you sweep — and the boxes are for precision,
 * because dragging to exactly 1,500 acres on a 3,775-acre track is a pixel
 * hunt. Shipping only sliders makes an exact figure impossible; shipping only
 * boxes makes exploration tedious.
 *
 * Bounds come from the FULL dataset and never move. A track that rescaled as
 * other filters narrowed the data would relabel itself under the user's cursor,
 * and the handle they just placed would mean a different number a moment later.
 */

import { useEffect, useId, useState } from 'react';

import type { MeasureBounds, RangeSelection } from '@/lib/filters';

export interface RangeFilterProps {
  readonly bounds: MeasureBounds;
  /** Absent means unconstrained; the control shows the full bounds. */
  readonly range: RangeSelection | undefined;
  readonly onChange: (key: string, range: RangeSelection) => void;
  readonly onClear: (key: string) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Step fine enough to reach any whole acre without a 4,000-stop slider. */
function stepFor(min: number, max: number): number {
  const span = max - min;
  if (span <= 10) return 0.1;
  if (span <= 1000) return 1;
  return Math.max(1, Math.round(span / 1000));
}

export function RangeFilter({ bounds, range, onChange, onClear }: RangeFilterProps) {
  const active = range !== undefined;
  const current = range ?? { min: bounds.min, max: bounds.max };

  const minId = useId();
  const maxId = useId();

  // Text state is separate from committed state so a half-typed "15" on the way
  // to "1500" does not momentarily filter everything out.
  const [minText, setMinText] = useState(String(current.min));
  const [maxText, setMaxText] = useState(String(current.max));

  useEffect(() => {
    setMinText(String(current.min));
    setMaxText(String(current.max));
  }, [current.min, current.max]);

  const commit = (next: RangeSelection) => {
    // Handles that cross over are clamped rather than swapped. Swapping makes
    // the handle under the cursor jump to the other side, which feels like a
    // bug even when the resulting range is what you wanted.
    const min = clamp(next.min, bounds.min, bounds.max);
    const max = clamp(next.max, bounds.min, bounds.max);
    onChange(bounds.key, { min: Math.min(min, max), max: Math.max(min, max) });
  };

  const commitText = (which: 'min' | 'max', raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      // Reject the edit and restore the last good value rather than filtering
      // by NaN, which would empty the result set with no visible cause.
      setMinText(String(current.min));
      setMaxText(String(current.max));
      return;
    }
    commit(which === 'min' ? { ...current, min: parsed } : { ...current, max: parsed });
  };

  const step = stepFor(bounds.min, bounds.max);
  const span = bounds.max - bounds.min || 1;
  const leftPct = ((current.min - bounds.min) / span) * 100;
  const rightPct = ((current.max - bounds.min) / span) * 100;

  return (
    <div className="rounded-md border border-stone-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-stone-900 dark:text-neutral-100">
          {bounds.label}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onClear(bounds.key)}
            className="text-[11px] text-stone-500 hover:underline dark:text-neutral-400"
          >
            Reset
          </button>
        )}
      </div>

      {/* Dual-handle track. Two stacked range inputs rather than a custom
          pointer implementation, so keyboard support (arrows, Home/End) and
          screen-reader announcement come from the platform. */}
      <div className="relative mt-3 h-4">
        <div className="absolute inset-x-0 top-1.5 h-1 rounded bg-stone-200 dark:bg-neutral-700" />
        <div
          className="absolute top-1.5 h-1 rounded bg-blue-500"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <input
          type="range"
          aria-label={`${bounds.label} minimum`}
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={current.min}
          onChange={(event) => commit({ ...current, min: Number(event.target.value) })}
          className="pointer-events-none absolute inset-x-0 top-0 h-4 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-600 [&::-webkit-slider-thumb]:bg-white"
        />
        <input
          type="range"
          aria-label={`${bounds.label} maximum`}
          min={bounds.min}
          max={bounds.max}
          step={step}
          value={current.max}
          onChange={(event) => commit({ ...current, max: Number(event.target.value) })}
          className="pointer-events-none absolute inset-x-0 top-0 h-4 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-600 [&::-webkit-slider-thumb]:bg-white"
        />
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <label htmlFor={minId} className="sr-only">
          {bounds.label} minimum, in acres
        </label>
        <input
          id={minId}
          type="number"
          inputMode="decimal"
          value={minText}
          min={bounds.min}
          max={bounds.max}
          onChange={(event) => setMinText(event.target.value)}
          onBlur={(event) => commitText('min', event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitText('min', (event.target as HTMLInputElement).value);
          }}
          className="w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-right text-[11px] tabular-nums text-stone-900 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <span className="text-[11px] text-stone-500">to</span>
        <label htmlFor={maxId} className="sr-only">
          {bounds.label} maximum, in acres
        </label>
        <input
          id={maxId}
          type="number"
          inputMode="decimal"
          value={maxText}
          min={bounds.min}
          max={bounds.max}
          onChange={(event) => setMaxText(event.target.value)}
          onBlur={(event) => commitText('max', event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitText('max', (event.target as HTMLInputElement).value);
          }}
          className="w-full rounded border border-stone-300 bg-white px-1.5 py-1 text-right text-[11px] tabular-nums text-stone-900 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <p className="mt-1 text-[10px] tabular-nums text-stone-500 dark:text-neutral-500">
        data range {bounds.min.toLocaleString('en-IN')} –{' '}
        {bounds.max.toLocaleString('en-IN')} acres
      </p>
    </div>
  );
}
