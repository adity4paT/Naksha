'use client';

/**
 * Top 15 regions by the selected measure, as a horizontal bar chart.
 *
 * ## Form
 *
 * Horizontal bars because the categories are long place names — "Dadra and
 * Nagar Haveli and Daman and Diu" is unreadable rotated under a vertical axis,
 * and horizontal rows give each label a full line.
 *
 * ## Colour
 *
 * One hue for every bar. This is a single series, so colour has no identity
 * work to do, and colouring bars by their own value would spend the identity
 * channel re-encoding what bar length already shows. The hue is the same blue
 * the choropleth ramp is drawn from, so the two read as one system.
 *
 * No legend — a single series is named by the heading. Values are direct-labelled
 * at the end of each bar rather than carried on an axis, because fifteen rows
 * with a value each is exactly the case where direct labels beat a gridline the
 * eye has to travel back to.
 *
 * Built as plain HTML rather than SVG: the bars are rectangles, the labels are
 * text, and a `<div>` with a width percentage is both simpler and natively
 * accessible.
 */

import { useMemo } from 'react';

import type { RegionAggregate } from '@/lib/aggregate';
import { formatMeasureValue } from '@/lib/measures';
import type { MeasureDescriptor } from '@/lib/measures';

export interface TopRegionsChartProps {
  readonly regions: readonly RegionAggregate[];
  readonly measure: MeasureDescriptor | null;
  readonly level: 'state' | 'district';
  readonly onSelect: (name: string) => void;
  readonly selected: string | null;
}

const TOP_N = 15;

/**
 * Blue, step 450 of the sequential ramp — the same hue family the choropleth
 * uses, so the chart and the map belong to one visual system.
 */
const BAR = '#2a78d6';
const BAR_SELECTED = '#0d366b';

export function TopRegionsChart({
  regions,
  measure,
  level,
  onSelect,
  selected,
}: TopRegionsChartProps) {
  const top = useMemo(() => {
    // Regions with no computable value are excluded rather than ranked as
    // zero — they have no position in an ordering by magnitude.
    const ranked = regions
      .filter((region): region is RegionAggregate & { value: number } => region.value !== null)
      .sort((a, b) => b.value - a.value);

    return ranked.slice(0, TOP_N);
  }, [regions]);

  // Scaled against the largest bar, not the data maximum, so the longest row
  // always fills the track and the differences between rows stay visible.
  const max = top[0]?.value ?? 0;
  const withValues = regions.filter((r) => r.value !== null).length;

  if (measure === null || top.length === 0) {
    return (
      <section aria-label="Top regions" className="flex flex-col">
        <h2 className="px-1 pb-2 text-xs font-semibold text-stone-700">
          Top {level === 'state' ? 'states' : 'districts'}
        </h2>
        <p className="rounded-md border border-stone-200 bg-white p-4 text-center text-xs text-stone-500">
          Nothing to rank — no region has a value for this measure.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Top regions by selected measure" className="flex min-h-0 flex-col">
      <header className="flex items-baseline justify-between gap-3 px-1 pb-2">
        <h2 className="text-xs font-semibold text-stone-700">
          Top {Math.min(TOP_N, top.length)} {level === 'state' ? 'states' : 'districts'}
        </h2>
        <p className="text-[11px] text-stone-500">
          {measure.label}
          {withValues > TOP_N && (
            <span className="text-stone-400"> · of {withValues} with values</span>
          )}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-stone-200 bg-white p-2">
        <ol className="space-y-1">
          {top.map((region, index) => {
            const share = max > 0 ? (region.value / max) * 100 : 0;
            const isSelected = region.name === selected;

            return (
              <li key={region.name}>
                <button
                  type="button"
                  onClick={() => onSelect(region.name)}
                  // The whole row is the hit target, not just the bar — a 4px
                  // bar for a small region would otherwise be nearly unclickable.
                  className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  aria-label={`${region.name}, ${formatMeasureValue(measure, region.value)}, ${region.siteCount} sites`}
                >
                  <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-stone-400">
                    {index + 1}
                  </span>

                  <span
                    className={`w-28 shrink-0 truncate text-[11px] ${
                      isSelected ? 'font-semibold text-stone-900' : 'text-stone-700'
                    }`}
                    title={region.name}
                  >
                    {region.name}
                  </span>

                  <span className="relative h-3.5 flex-1 rounded-sm bg-stone-100">
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-250"
                      style={{
                        width: `${Math.max(share, 1.5)}%`,
                        backgroundColor: isSelected ? BAR_SELECTED : BAR,
                      }}
                    />
                  </span>

                  {/* Direct label. Text stays in an ink token rather than the
                      bar colour — the bar beside it already carries identity. */}
                  <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-stone-600">
                    {formatMeasureValue(measure, region.value)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
