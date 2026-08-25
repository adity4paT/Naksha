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

import type { AggregationResult } from '@/lib/aggregate';
import { scaleValuesFrom } from '@/lib/aggregate';
import type { ColorMode } from '@/lib/color';
import { computeScale, rampFor } from '@/lib/color';
import type { BoundaryIndex } from '@/lib/geo';
import {
  breadcrumbFor,
  focusedDistrict,
  focusedState,
  levelFor,
  useFilterStore,
} from '@/store/filters';
import { Breadcrumb } from './Breadcrumb';
import { Legend } from './Legend';
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
  /** Aggregates for the state level. */
  readonly stateAggregation: AggregationResult;
  /** Aggregates for the district level. */
  readonly districtAggregation: AggregationResult;
  readonly measureLabel: string;
  readonly mode?: ColorMode;
}

export function MapDashboard({
  boundaries,
  stateAggregation,
  districtAggregation,
  measureLabel,
  mode = 'light',
}: MapDashboardProps) {
  const selections = useFilterStore((s) => s.selections);
  const zoom = useFilterStore((s) => s.zoom);
  const scaleKind = useFilterStore((s) => s.scaleKind);
  const binningMethod = useFilterStore((s) => s.binningMethod);
  const binCount = useFilterStore((s) => s.binCount);
  const unmappedPanelOpen = useFilterStore((s) => s.unmappedPanelOpen);

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
  const level = levelFor({ selections, zoom });
  const aggregation = level === 'state' ? stateAggregation : districtAggregation;

  /**
   * The scale is computed from the CURRENTLY VISIBLE regions only.
   *
   * Drilling into Gujarat re-bins against Gujarat's districts rather than
   * against all 724, so the ramp uses its full range on the data actually on
   * screen. Keeping a national scale would render most of a single state in one
   * shade and waste four of five classes.
   */
  const scaleValues = useMemo(() => {
    if (level === 'district' && selectedState !== null) {
      return [...aggregation.byRegion.values()]
        .filter((region) => region.state === selectedState)
        .map((region) => region.total);
    }
    return scaleValuesFrom(aggregation);
  }, [aggregation, level, selectedState]);

  const scale = useMemo(
    () => computeScale(scaleValues, binningMethod, binCount),
    [scaleValues, binningMethod, binCount],
  );

  const ramp = useMemo(() => rampFor(scaleKind, mode, binCount), [scaleKind, mode, binCount]);

  const trail = breadcrumbFor(selections);

  const { hasNoData, hasZero } = useMemo(() => {
    const entries = level === 'state' ? boundaries.states : boundaries.districts;
    const scoped =
      level === 'district' && selectedState !== null
        ? entries.filter((e) => e.state === selectedState)
        : entries;

    return {
      hasNoData: scoped.some((e) => !aggregation.byRegion.has(e.name)),
      hasZero: [...aggregation.byRegion.values()].some((r) => r.total === 0),
    };
  }, [level, boundaries, aggregation, selectedState]);

  return (
    <div className="flex h-full flex-col gap-2">
      <header className="flex items-center justify-between gap-4 px-1">
        <Breadcrumb trail={trail} onNavigate={navigateTo} />
        <p className="text-xs text-slate-500 dark:text-neutral-400">
          {level === 'state' ? 'States' : 'Districts'} ·{' '}
          <span className="tabular-nums">{aggregation.byRegion.size}</span> with data
        </p>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 dark:border-neutral-800">
        <MapView
          boundaries={boundaries}
          aggregation={aggregation}
          scale={scale}
          ramp={ramp}
          mode={mode}
          level={level}
          measureLabel={measureLabel}
          selectedState={selectedState}
          selectedDistrict={selectedDistrict}
          onSelectState={focusState}
          onSelectDistrict={focusDistrict}
          onZoomChange={setZoom}
          onOpenSiteList={openSiteList}
        />

        <div className="absolute right-3 top-3">
          <Legend
            scale={scale}
            ramp={ramp}
            mode={mode}
            measureLabel={measureLabel}
            method={binningMethod}
            onMethodChange={setBinningMethod}
            hasNoDataRegions={hasNoData}
            hasZeroRegions={hasZero}
          />
        </div>
      </div>

      {/*
        Always rendered. Never conditional on there being unmapped records — a
        panel that disappears when empty trains users to stop looking for it.
      */}
      <UnmappedPanel
        entries={aggregation.unmapped}
        mappedTotal={aggregation.mappedTotal}
        open={unmappedPanelOpen}
        onToggle={toggleUnmappedPanel}
      />
    </div>
  );
}
