'use client';

/**
 * Choropleth legend.
 *
 * Shows bin thresholds as ACTUAL NUMBERS, not a bare gradient bar. A gradient
 * tells a reader that darker means more, which they already assumed; it does
 * not tell them whether the darkest class starts at 500 acres or 5,000. With
 * quantile bins the breaks are arbitrary-looking values like 1,447.5, and those
 * are the only thing that makes a colour interpretable.
 *
 * The method toggle sits with the legend rather than in a settings menu,
 * because changing it changes what the legend says — they are one control.
 */

import { useMemo } from 'react';

import type { BinnedScale, BinningMethod, ColorMode } from '@/lib/color';
import { BINNING_METHOD_LABELS, BINNING_METHODS, NO_DATA, ZERO_VALUE } from '@/lib/color';

export interface LegendProps {
  readonly scale: BinnedScale;
  readonly ramp: readonly string[];
  readonly mode: ColorMode;
  /** Measure name for the legend title. */
  readonly measureLabel: string;
  /** Unit word for the subtitle, e.g. "acres" or "percent". */
  readonly unitLabel: string;
  /** Formats a bin edge in the active measure's unit. */
  readonly formatValue: (value: number) => string;
  readonly method: BinningMethod;
  readonly onMethodChange: (method: BinningMethod) => void;
  /** True when at least one visible region has no data. */
  readonly hasNoDataRegions: boolean;
  /** True when at least one visible region totals exactly zero. */
  readonly hasZeroRegions: boolean;
  /** Sites plotted from a surveyed KMZ boundary. */
  readonly surveyedCount: number;
  /** Sites known only to the district level, with no surveyed position. */
  readonly districtOnlyCount: number;
}

export function Legend({
  scale,
  ramp,
  mode,
  measureLabel,
  unitLabel,
  formatValue,
  method,
  onMethodChange,
  hasNoDataRegions,
  hasZeroRegions,
  surveyedCount,
  districtOnlyCount,
}: LegendProps) {
  const rows = useMemo(
    () =>
      scale.bins.map((bin, index) => ({
        color: ramp[index] ?? ramp[ramp.length - 1] ?? '#888',
        // The last bin is closed; the rest are half-open. Rendering them all
        // the same way would claim the maximum belongs to no class.
        label:
          index === scale.bins.length - 1
            ? `${formatValue(bin.min)} – ${formatValue(bin.max)}`
            : `${formatValue(bin.min)} – <${formatValue(bin.max)}`,
        count: bin.count,
      })),
    [scale, ramp, formatValue],
  );

  return (
    <section
      aria-label="Map legend"
      className="w-full shrink-0 rounded-lg border border-stone-200 bg-white p-3 text-xs"
    >
      <h2 className="mb-0.5 font-semibold text-slate-900 dark:text-neutral-100">
        {measureLabel}
      </h2>
      <p className="mb-2 text-[11px] text-slate-500 dark:text-neutral-400">{unitLabel}</p>

      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
              style={{ backgroundColor: row.color }}
            />
            <span className="flex-1 tabular-nums text-slate-700 dark:text-neutral-300">
              {row.label}
            </span>
            <span className="tabular-nums text-slate-400 dark:text-neutral-500">
              {row.count}
            </span>
          </li>
        ))}

        {/*
          Zero and no-data are separate rows, always, when either is present.
          Folding them together is the single most common way a choropleth
          lies: "we hold no land here" and "we have no record for here" are
          different claims and a reader cannot recover the difference from one
          swatch.
        */}
        {hasZeroRegions && (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
              style={{ backgroundColor: ZERO_VALUE[mode] }}
            />
            <span className="flex-1 text-slate-700 dark:text-neutral-300">
              Exactly {formatValue(0)}
            </span>
          </li>
        )}

        {hasNoDataRegions && (
          <li className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-black/10 dark:ring-white/10"
              style={{
                backgroundColor: NO_DATA[mode].base,
                // The hatch is the point: texture survives colourblindness,
                // grayscale print, and forced-colors mode, none of which a
                // shade difference does.
                backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 2px, ${NO_DATA[mode].stroke} 2px, ${NO_DATA[mode].stroke} 3px)`,
              }}
            />
            <span className="flex-1 text-slate-700 dark:text-neutral-300">No data</span>
          </li>
        )}
      </ul>

      {/*
        Site symbols, kept visually separate from the choropleth classes above
        because they answer a different question. The classes say how much;
        these say how precisely we know where.

        The distinction between the two rows is the point of the whole section.
        A district badge is an ADMINISTRATIVE fact — these sites are somewhere
        in this district — and a marker is a SURVEYED one. Rendering them in a
        way that let a reader mistake the first for the second would put
        invented precision on the map, which is the failure V1 refused a site
        marker entirely to avoid.
      */}
      {(surveyedCount > 0 || districtOnlyCount > 0) && (
        <div className="mt-3 border-t border-slate-200 pt-2 dark:border-neutral-800">
          <p className="mb-1.5 font-medium text-slate-600 dark:text-neutral-300">Sites</p>
          <ul className="flex flex-col gap-1.5">
            {surveyedCount > 0 && (
              <li className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px] border border-white bg-emerald-600 shadow-sm"
                />
                <span className="flex-1 text-slate-700 dark:text-neutral-300">
                  <span className="tabular-nums">{surveyedCount}</span> surveyed —
                  exact boundary from an uploaded KMZ, shown at zoom 10 and above.
                </span>
              </li>
            )}
            {districtOnlyCount > 0 && (
              <li className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-slate-500 bg-white text-[7px] font-semibold text-slate-900 dark:border-neutral-400 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  6
                </span>
                <span className="flex-1 text-slate-700 dark:text-neutral-300">
                  <span className="tabular-nums">{districtOnlyCount}</span> district-level
                  only — counted in the district badge. No surveyed position exists for
                  these; the badge is not a location.
                </span>
              </li>
            )}
          </ul>
        </div>
      )}

      {scale.reducedFrom !== undefined && (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-neutral-400">
          Showing {scale.bins.length} of {scale.reducedFrom} classes — the data has
          too few distinct values to fill the rest.
        </p>
      )}

      <fieldset className="mt-3 border-t border-slate-200 pt-2 dark:border-neutral-800">
        <legend className="sr-only">Class interval method</legend>
        <div
          role="radiogroup"
          aria-label="Class interval method"
          className="flex flex-col gap-0.5"
        >
          {BINNING_METHODS.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50 dark:hover:bg-neutral-800"
            >
              <input
                type="radio"
                name="binning-method"
                value={option}
                checked={method === option}
                onChange={() => onMethodChange(option)}
                className="h-3 w-3 accent-blue-600"
              />
              <span className="text-slate-700 dark:text-neutral-300">
                {BINNING_METHOD_LABELS[option]}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-neutral-400">
          {method === 'quantile'
            ? 'Equal count per class. Reads evenly, but hides how far apart the values actually are.'
            : method === 'equal-interval'
              ? 'Equal value width per class. Shows the real spread — expect most regions in the lowest class.'
              : 'Classes chosen to minimise variation within each.'}
        </p>
      </fieldset>
    </section>
  );
}
