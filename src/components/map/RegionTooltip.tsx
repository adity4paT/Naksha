'use client';

/**
 * Region tooltip, plus the keyboard path that makes the same content reachable
 * without a pointer.
 *
 * A MapLibre canvas is one element. Hovering a polygon is a hit-test against
 * pixels, and there is nothing for the tab key to land on — so a keyboard user
 * gets no tooltip at all unless something else provides one.
 *
 * {@link RegionKeyboardList} is that something: a real list of focusable
 * buttons, one per visible region, positioned off-screen but NOT hidden from
 * assistive technology (`sr-only`, not `display: none` or `aria-hidden`).
 * Focusing an entry announces the same figures the tooltip shows and highlights
 * the matching polygon; pressing Enter selects it, exactly as clicking would.
 *
 * This is deliberately not a `<canvas aria-label>` summarising the map. A
 * summary is not equivalent access — the sighted user can interrogate any
 * region and read its numbers, and so should everyone else.
 */

import type { RegionAggregate } from '@/lib/aggregate';

export interface TooltipDatum {
  readonly name: string;
  /** Parent state; omitted at state level where it repeats the name. */
  readonly state: string | null;
  /** Null when the region has no records — distinct from a total of 0. */
  readonly total: number | null;
  readonly siteCount: number;
  readonly recordCount: number;
}

/**
 * Formats one value in the active measure's unit.
 *
 * Injected rather than hardcoded: the map can now show acres or percentages,
 * and a tooltip that appended "ac" to a utilisation figure would be confidently
 * wrong in a way nobody double-checks.
 */
export type ValueFormatter = (value: number) => string;

export interface RegionTooltipProps {
  readonly datum: TooltipDatum | null;
  /** Viewport position, in px. Null when driven by keyboard focus. */
  readonly position: { x: number; y: number } | null;
  readonly measureLabel: string;
  readonly formatValue: ValueFormatter;
}

/** The sentence a region's figures reduce to. Shared by tooltip and a11y label. */
export function describeRegion(
  datum: TooltipDatum,
  measureLabel: string,
  formatValue: ValueFormatter,
): string {
  const sites = `${datum.siteCount} site${datum.siteCount === 1 ? '' : 's'}`;

  if (datum.total === null) {
    // Said explicitly. Silence here reads as zero.
    return `${datum.name}: no data`;
  }

  return `${datum.name}: ${formatValue(datum.total)} ${measureLabel}, ${sites}`;
}

export function RegionTooltip({
  datum,
  position,
  measureLabel,
  formatValue,
}: RegionTooltipProps) {
  if (datum === null || position === null) return null;

  return (
    <div
      role="tooltip"
      // Pointer events off: the tooltip follows the cursor, and letting it take
      // hits would make it flicker as it steals the hover it is describing.
      className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{
        left: position.x + 12,
        top: position.y + 12,
      }}
    >
      <p className="font-semibold text-slate-900 dark:text-neutral-100">{datum.name}</p>

      {datum.state !== null && datum.state !== datum.name && (
        <p className="text-[11px] text-slate-500 dark:text-neutral-400">{datum.state}</p>
      )}

      {datum.total === null ? (
        <p className="mt-1 text-slate-500 dark:text-neutral-400">
          No data
          <span className="block text-[11px]">
            {datum.recordCount > 0
              ? `${datum.recordCount} record${datum.recordCount === 1 ? '' : 's'} here, but this measure cannot be computed for them`
              : 'No records resolved to this region'}
          </span>
        </p>
      ) : (
        <dl className="mt-1 space-y-0.5">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500 dark:text-neutral-400">{measureLabel}</dt>
            <dd className="tabular-nums font-medium text-slate-900 dark:text-neutral-100">
              {formatValue(datum.total)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500 dark:text-neutral-400">Sites</dt>
            <dd className="tabular-nums text-slate-900 dark:text-neutral-100">
              {datum.siteCount}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

export interface RegionKeyboardListProps {
  readonly regions: readonly RegionAggregate[];
  /** Regions with geometry but no records, so they are reachable too. */
  readonly noDataRegions: readonly { name: string; state: string }[];
  readonly measureLabel: string;
  readonly formatValue: ValueFormatter;
  readonly onFocusRegion: (name: string | null) => void;
  readonly onSelectRegion: (name: string) => void;
  readonly levelLabel: string;
}

/**
 * Off-screen focusable list mirroring the map's regions.
 *
 * No-data regions are included on purpose. Omitting them would make the
 * keyboard experience quietly different from the visual one — a sighted user
 * can hover a hatched district and be told "no data", and that fact should not
 * be pointer-only.
 */
export function RegionKeyboardList({
  regions,
  noDataRegions,
  measureLabel,
  formatValue,
  onFocusRegion,
  onSelectRegion,
  levelLabel,
}: RegionKeyboardListProps) {
  return (
    <div className="sr-only">
      <h2>{levelLabel} regions on the map</h2>
      <p>
        {regions.length} with data, {noDataRegions.length} without. Focus an entry to
        hear its figures; press Enter to select it on the map.
      </p>

      <ul>
        {regions.map((region) => {
          const datum: TooltipDatum = {
            name: region.name,
            state: region.state,
            total: region.value,
            siteCount: region.siteCount,
            recordCount: region.recordCount,
          };

          return (
            <li key={region.name}>
              <button
                type="button"
                onFocus={() => onFocusRegion(region.name)}
                onBlur={() => onFocusRegion(null)}
                onClick={() => onSelectRegion(region.name)}
              >
                {describeRegion(datum, measureLabel, formatValue)}
              </button>
            </li>
          );
        })}

        {noDataRegions.map((region) => (
          <li key={`nodata-${region.name}`}>
            <button
              type="button"
              onFocus={() => onFocusRegion(region.name)}
              onBlur={() => onFocusRegion(null)}
              onClick={() => onSelectRegion(region.name)}
            >
              {region.name}: no data
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
