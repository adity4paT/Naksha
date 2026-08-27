'use client';

/**
 * Composition root for the map view.
 *
 * Holds no selection state of its own — it reads the Zustand store and passes
 * callbacks down. That is what makes the map and the filter controls
 * bidirectionally synced: both are views of one store, so neither can drift.
 *
 * `MapView` is loaded with `next/dynamic({ ssr: false })` because MapLibre
 * touches `window` at import time and would break the server render.
 */

import dynamic from 'next/dynamic';
import { useMemo } from 'react';

import type { SurveyedCoverage } from '@/components/kmz';
import type { AggregationResult } from '@/lib/aggregate';
import type { BinnedScale, ColorMode } from '@/lib/color';
import type { BoundaryIndex } from '@/lib/geo';
import type { MeasureDescriptor, MeasureGroup } from '@/lib/measures';
import { formatMeasureValue, measureUnitLabel } from '@/lib/measures';
import type { MapLevel } from '@/store/filters';
import {
  breadcrumbFor,
  focusedDistrict,
  focusedState,
  useFilterStore,
} from '@/store/filters';
import { Breadcrumb } from './Breadcrumb';
import { Legend } from './Legend';
import { MeasurePicker } from './MeasurePicker';
import { KmzCoverage } from './KmzCoverage';
import { UnmappedPanel } from './UnmappedPanel';

const MapView = dynamic(() => import('./MapView').then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-500">
      Loading map…
    </div>
  ),
});

export interface MapDashboardProps {
  readonly boundaries: BoundaryIndex;
  /**
   * The active level's aggregate, already computed.
   *
   * Passed in rather than derived here so the map, table, and chart share one
   * computation — see useDerivedData. Computing it locally would create the
   * second query path that makes views disagree.
   */
  readonly aggregation: AggregationResult;
  /** Surveyed sites and the coverage counts, derived once by the shell. */
  readonly coverage: SurveyedCoverage;
  readonly scale: BinnedScale;
  readonly ramp: readonly string[];
  readonly level: MapLevel;
  /** Every measure the picker offers, pre-grouped. */
  readonly measureGroups: readonly MeasureGroup[];
  /** The active measure, resolved from the store's id by the caller. */
  readonly measure: MeasureDescriptor;
  /** Label of the sheet column superseding the active measure, if any. */
  readonly supersedingLabel?: string | null;
  readonly mode?: ColorMode;
}

export function MapDashboard({
  boundaries,
  aggregation,
  coverage,
  scale,
  ramp,
  level,
  measureGroups,
  measure,
  supersedingLabel = null,
  mode = 'light',
}: MapDashboardProps) {
  const selections = useFilterStore((s) => s.selections);
  const binningMethod = useFilterStore((s) => s.binningMethod);
  const unmappedPanelOpen = useFilterStore((s) => s.unmappedPanelOpen);
  const setMeasure = useFilterStore((s) => s.setMeasure);

  const focusState = useFilterStore((s) => s.focusState);
  const focusDistrict = useFilterStore((s) => s.focusDistrict);
  const navigateTo = useFilterStore((s) => s.navigateTo);
  const setBinningMethod = useFilterStore((s) => s.setBinningMethod);
  const setZoom = useFilterStore((s) => s.setZoom);
  const toggleUnmappedPanel = useFilterStore((s) => s.toggleUnmappedPanel);
  const openSiteList = useFilterStore((s) => s.openSiteList);

  // The map can only be "inside" one state at a time. With several selected in
  // the panel it stays national and shows them all, which is the honest
  // rendering of that filter — see focusedState in the store.
  const selectedState = focusedState(selections);
  const selectedDistrict = focusedDistrict(selections);
  const trail = breadcrumbFor(selections);

  // Formatting follows the measure's unit, so switching to a percentage stops
  // the legend and tooltips from appending "ac" to a figure that is not acres.
  const formatValue = useMemo(
    () => (value: number) => formatMeasureValue(measure, value),
    [measure],
  );
  const unitLabel = measureUnitLabel(measure);

  const { hasNoData, hasZero } = useMemo(() => {
    const entries = level === 'state' ? boundaries.states : boundaries.districts;
    const scoped =
      level === 'district' && selectedState !== null
        ? entries.filter((e) => e.state === selectedState)
        : entries;

    return {
      // Both flavours of no-data: region absent entirely, or present with a
      // value that could not be computed.
      hasNoData: scoped.some((e) => aggregation.byRegion.get(e.name)?.value == null),
      hasZero: [...aggregation.byRegion.values()].some((r) => r.value === 0),
    };
  }, [level, boundaries, aggregation, selectedState]);

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex shrink-0 items-baseline gap-3 px-1">
        <Breadcrumb trail={trail} onNavigate={navigateTo} />
        <p className="text-[11px] text-stone-500">
          {level === 'state' ? 'States' : 'Districts'} ·{' '}
          <span className="tabular-nums">
            {[...aggregation.byRegion.values()].filter((r) => r.value !== null).length}
          </span>{' '}
          with a value
        </p>
      </header>

      {/*
        Map and its controls sit SIDE BY SIDE, not stacked with the legend
        floating on top. An overlaid legend covers the north-east states at
        every viewport width, and those are exactly the small regions a reader
        has to squint at already. Giving the controls their own column costs
        256px of width — which this layout has — and buys back the whole map.
      */}
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-stone-200 bg-white">
          <MapView
            boundaries={boundaries}
            aggregation={aggregation}
            scale={scale}
            ramp={ramp}
            mode={mode}
            level={level}
            measureLabel={measure.label}
            formatValue={formatValue}
            selectedState={selectedState}
            selectedDistrict={selectedDistrict}
            onSelectState={focusState}
            onSelectDistrict={focusDistrict}
            onZoomChange={setZoom}
            onOpenSiteList={openSiteList}
            surveyedSites={coverage.sites}
          />
        </div>

        <aside
          aria-label="Map controls"
          className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto"
        >
          <MeasurePicker
            groups={measureGroups}
            selectedId={measure.id}
            onChange={setMeasure}
            selected={measure}
            supersedingLabel={supersedingLabel}
          />

          <Legend
            scale={scale}
            ramp={ramp}
            mode={mode}
            measureLabel={measure.label}
            unitLabel={unitLabel}
            formatValue={formatValue}
            method={binningMethod}
            onMethodChange={setBinningMethod}
            hasNoDataRegions={hasNoData}
            hasZeroRegions={hasZero}
            surveyedCount={coverage.sites.length}
            districtOnlyCount={Math.max(0, coverage.totalSites - coverage.sites.length)}
          />
        </aside>
      </div>

      {/*
        Always rendered. Never conditional on there being unmapped records — a
        panel that disappears when empty trains users to stop looking for it.
      */}
      {/*
        Coverage sits beside the unmapped panel because the two are the same
        kind of statement — how much of the data the map can actually place, and
        how precisely. Reading them apart would let someone conclude every site
        is surveyed because the ones they happened to click were.
      */}
      <KmzCoverage coverage={coverage} />

      <UnmappedPanel
        entries={aggregation.unmapped}
        mappedTotal={aggregation.mappedTotal}
        open={unmappedPanelOpen}
        onToggle={toggleUnmappedPanel}
      />
    </div>
  );
}
