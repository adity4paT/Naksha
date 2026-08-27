'use client';

/**
 * The composition root.
 *
 * Loads boundaries once, wires the upload flow, the filter panel, the map, and
 * the supporting views onto one derivation pipeline, and owns nothing but
 * layout and a little local UI state.
 *
 * Every view here reads from {@link useDerivedData}. There is no second query
 * path anywhere — the table's row count, the chart's ranking, and the map's
 * shading are three renderings of one computation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { FilterPanel, useUrlSync } from '@/components/filters';
import { KmzBulkPanel } from '@/components/kmz';
import { MapDashboard } from '@/components/map';
import { UploadFlow } from '@/components/upload';
import { DataTable } from '@/components/views/DataTable';
import { TopRegionsChart } from '@/components/views/TopRegionsChart';
import { buildExportWorkbook, exportFileName } from '@/lib/export';
import type { AliasMap, BoundaryIndex } from '@/lib/geo';
import { loadAliasMap, loadBoundaryIndex } from '@/lib/geo';
import { useDatasetStore } from '@/store/dataset';
import { focusedState, useFilterStore } from '@/store/filters';
import { useKmzStore } from '@/store/kmz';
import {
  AllUnmappedState,
  BoundariesFailedState,
  LoadingBoundariesState,
  NoDatasetState,
  NoMatchesState,
} from './EmptyStates';
import { SitePanel } from './SitePanel';
import { useDerivedData } from './useDerivedData';

type BoundaryLoad =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly index: BoundaryIndex; readonly aliases: AliasMap }
  | { readonly status: 'failed'; readonly message: string };

type Tab = 'chart' | 'table';

export function AppShell() {
  const [boundaries, setBoundaries] = useState<BoundaryLoad>({ status: 'loading' });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [kmzOpen, setKmzOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chart');
  const [viewsOpen, setViewsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useUrlSync();

  const workbook = useDatasetStore((s) => s.workbook);
  const sourceFileName = useDatasetStore((s) => s.sourceFileName);
  const loadedAt = useDatasetStore((s) => s.loadedAt);
  const binding = useDatasetStore((s) => s.binding);
  const measureGroups = useDatasetStore((s) => s.measureGroups);
  const measures = useDatasetStore((s) => s.measures);
  const resolutionReport = useDatasetStore((s) => s.resolutionReport);
  const clearDataset = useDatasetStore((s) => s.clear);

  const selections = useFilterStore((s) => s.selections);
  const resetFilters = useFilterStore((s) => s.resetAll);
  const siteListRegion = useFilterStore((s) => s.siteListRegion);
  const openSiteList = useFilterStore((s) => s.openSiteList);
  const focusState = useFilterStore((s) => s.focusState);
  const focusDistrict = useFilterStore((s) => s.focusDistrict);
  const setUnmappedOpen = useFilterStore((s) => s.toggleUnmappedPanel);
  const unmappedOpen = useFilterStore((s) => s.unmappedPanelOpen);

  const derived = useDerivedData('light');

  /* ---- attachments, read once on mount ---------------------------------- */
  const refreshKmz = useKmzStore((s) => s.refresh);
  useEffect(() => {
    // IndexedDB outlives the workbook, so attachments are read at startup
    // rather than on commit. A browser with no IndexedDB simply reports an
    // error into the store and every upload control stays inert.
    void refreshKmz();
  }, [refreshKmz]);

  /* ---- boundaries, loaded once ----------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    setBoundaries({ status: 'loading' });

    void (async () => {
      try {
        // Both are same-origin static assets. Loaded in parallel because
        // neither depends on the other.
        const [index, aliases] = await Promise.all([loadBoundaryIndex(), loadAliasMap()]);
        if (cancelled) return;
        setBoundaries({ status: 'ready', index, aliases: aliases.map });
      } catch (error) {
        if (cancelled) return;
        setBoundaries({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /* ---- export ----------------------------------------------------------- */
  const handleExport = useCallback(() => {
    if (workbook === null || derived.measure === null) return;

    const bytes = buildExportWorkbook(derived.filteredRecords, workbook.columns, {
      sourceFileName,
      sourceLoadedAt: loadedAt,
      measure: derived.measure,
      selections,
      totalRecords: workbook.records.length,
      exportedRecords: derived.filteredRecords.length,
      unmappedRecords: derived.aggregation.unmapped.length,
      unmappedAcres: derived.aggregation.unmappedTotal,
      boundaryCommit: 'cc91a19ffbca10b7ca6872a1e9690b4e5fd3aa0a',
      boundaryVintage: 'Census 2011 with later corrections',
      invariantViolations: workbook.validation.entries.length,
      fuzzyMatchedNames: resolutionReport?.needsReview.length ?? 0,
    });

    // Object URL rather than a data URI: a 20,000-row export exceeds what some
    // browsers accept in a data: href.
    // `bytes.buffer` is typed as ArrayBufferLike, which includes
    // SharedArrayBuffer and is not a valid BlobPart. The slice both narrows the
    // type and copies only this view's range.
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFileName(sourceFileName);
    anchor.click();
    URL.revokeObjectURL(url);
  }, [workbook, derived, selections, sourceFileName, loadedAt, resolutionReport]);

  const siteRecords = useMemo(() => {
    if (siteListRegion === null) return [];
    const region = derived.aggregation.byRegion.get(siteListRegion);
    if (region === undefined) return [];
    const ids = new Set(region.recordIds);
    return derived.filteredRecords.filter((record) => ids.has(record.id));
  }, [siteListRegion, derived.aggregation, derived.filteredRecords]);

  const regions = useMemo(
    () => [...derived.aggregation.byRegion.values()],
    [derived.aggregation],
  );

  // Active constraint count, so collapsing the panel never hides the fact
  // that filters are applied. A user reading a total off a map they think is
  // unfiltered is the failure this guards against.
  const activeFilters =
    selections.business.length +
    selections.state.length +
    selections.district.length +
    selections.site.length +
    Object.keys(selections.ranges).length;

  const hasBoundaries = boundaries.status === 'ready';
  const selectedRegion = focusedState(selections);

  /* ---- what fills the main pane ----------------------------------------- */
  const mapPane = (() => {
    if (boundaries.status === 'loading') return <LoadingBoundariesState />;
    if (boundaries.status === 'failed') {
      return (
        <BoundariesFailedState
          message={boundaries.message}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      );
    }
    if (workbook === null) return <NoDatasetState onUpload={() => setUploadOpen(true)} />;
    if (derived.filteredToNothing) return <NoMatchesState onReset={resetFilters} />;
    if (derived.allUnmapped) {
      return (
        <AllUnmappedState
          recordCount={derived.filteredRecords.length}
          onOpenUnmapped={() => {
            if (!unmappedOpen) setUnmappedOpen();
          }}
        />
      );
    }
    if (derived.measure === null) {
      return (
        <div className="flex h-full items-center justify-center rounded-lg border border-stone-200 bg-white p-8 text-center text-xs text-stone-500">
          No column in this workbook was inferred as a measure, so there is nothing to
          shade the map by.
        </div>
      );
    }

    return (
      <MapDashboard
        boundaries={boundaries.index}
        aggregation={derived.aggregation}
        scale={derived.scale}
        ramp={derived.ramp}
        level={derived.level}
        measureGroups={measureGroups}
        measure={derived.measure}
        supersedingLabel={
          derived.measure.kind === 'derived' && derived.measure.supersededBy !== null
            ? (measures.find((m) => m.id === derived.measure?.id)?.label ?? null)
            : null
        }
      />
    );
  })();

  return (
    <div className="flex h-screen flex-col bg-stone-50 text-stone-900">
      {/* ---- header ---- */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-tight text-stone-900">Naksha</h1>
          <span className="text-[11px] text-stone-500">Land MIS</span>
        </div>

        {sourceFileName !== null && (
          <p className="hidden min-w-0 truncate text-[11px] text-stone-500 sm:block">
            {sourceFileName} ·{' '}
            <span className="tabular-nums">
              {workbook?.stats.parsedRecordCount.toLocaleString('en-IN')}
            </span>{' '}
            records
          </p>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={workbook === null || derived.filteredRecords.length === 0}
            className="rounded border border-stone-300 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
          >
            Export .xlsx
          </button>

          <button
            type="button"
            onClick={() => setUploadOpen((open) => !open)}
            className="rounded bg-sky-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-1"
          >
            {workbook === null ? 'Upload workbook' : 'Replace data'}
          </button>

          {workbook !== null && (
            <button
              type="button"
              onClick={() => setKmzOpen((open) => !open)}
              className="rounded border border-stone-300 px-2.5 py-1 text-[11px] font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              Attach KMZ
            </button>
          )}

          {workbook !== null && (
            <button
              type="button"
              onClick={() => {
                clearDataset();
                resetFilters();
              }}
              title="Remove the loaded workbook from this browser"
              className="rounded border border-stone-300 px-2.5 py-1 text-[11px] text-stone-600 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
            >
              Clear local data
            </button>
          )}
        </div>
      </header>

      {/* ---- upload drawer ---- */}
      {uploadOpen && (
        <div className="shrink-0 border-b border-stone-200 bg-stone-100 p-4">
          <div className="mx-auto max-w-5xl">
            {hasBoundaries ? (
              <UploadFlow
                boundaries={boundaries.index}
                aliases={boundaries.aliases}
                onCommitted={() => setUploadOpen(false)}
              />
            ) : (
              <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Boundaries are still loading. Uploading now would leave every record
                unmatched, so the upload waits for them.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- KMZ attachment drawer ---- */}
      {kmzOpen && workbook !== null && (
        <div className="shrink-0 border-b border-stone-200 bg-stone-100 p-4">
          <div className="mx-auto max-w-5xl rounded border border-stone-200">
            <KmzBulkPanel
              records={workbook.records}
              columnKeys={workbook.columns.map((column) => column.normalizedKey)}
              binding={binding}
              onClose={() => setKmzOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ---- body ---- */}
      <div className="flex min-h-0 flex-1">
        {/*
          Collapsible, because the map is the point of the screen and 288px of
          filters is a lot of it on a 13" laptop.

          Collapsed it becomes a rail rather than disappearing: the toggle stays
          reachable and the active-filter count stays visible. A panel that
          vanishes completely would let someone read a total off a map they
          believe is unfiltered.

          Hidden below tablet width rather than redesigned as a bottom sheet.
          This is a desk tool; a half-working phone layout is worse than none.
        */}
        {workbook !== null && (
          <div className="hidden md:flex">
            {filtersOpen ? (
              <div className="relative flex">
                <FilterPanel rows={derived.facetRows} measures={derived.rangeMeasures} />
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-expanded={true}
                  aria-controls="filter-panel"
                  title="Hide filters"
                  className="absolute right-0 top-2 z-10 rounded-l border border-r-0 border-stone-300 bg-white px-1 py-2 text-[10px] text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                >
                  ◀
                </button>
              </div>
            ) : (
              <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-stone-200 bg-stone-50 py-2">
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  aria-expanded={false}
                  aria-controls="filter-panel"
                  title="Show filters"
                  className="rounded border border-stone-300 bg-white px-1 py-2 text-[10px] text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                >
                  ▶
                </button>

                <span
                  className="text-[10px] font-semibold uppercase tracking-wide text-stone-500"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  Filters
                </span>

                {activeFilters > 0 && (
                  <span
                    title={`${activeFilters} filter${activeFilters === 1 ? '' : 's'} active`}
                    className="rounded-full bg-sky-700 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white"
                  >
                    {activeFilters}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/*
          min-h-0 is load-bearing, not defensive. A flex item defaults to
          min-height:auto, which means it refuses to shrink below its content
          — so without this <main> grows past the viewport, the panes below
          never get a bounded height, and their overflow-y-auto has nothing to
          scroll against.
        */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3">
          {/*
            The map gets the dominant share AND a hard floor. Sharing space
            3:2 with the supporting views left it about 340px tall on a laptop,
            which is not enough to read district shapes in — and flex alone
            would let the header and unmapped panel squeeze it further. The
            min-height is what stops that.
          */}
          <div className={`min-h-[26rem] ${viewsOpen ? 'flex-[5]' : 'flex-1'} min-w-0`}>
            {mapPane}
          </div>

          {workbook !== null && !derived.filteredToNothing && (
            <div className={`flex min-h-0 flex-col ${viewsOpen ? 'flex-[2]' : 'shrink-0'}`}>
              <div
                role="tablist"
                aria-label="Supporting views"
                className="flex shrink-0 items-center gap-1 pb-2"
              >
                {(['chart', 'table'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={tab === option}
                    onClick={() => setTab(option)}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 ${
                      tab === option
                        ? 'bg-stone-200 text-stone-900'
                        : 'text-stone-500 hover:bg-stone-100'
                    }`}
                  >
                    {option === 'chart' ? 'Top regions' : 'Records'}
                  </button>
                ))}

                {/*
                  Lets the map go full height. A desk tool gets used at 13"
                  as often as at 27", and on the small screen the choice
                  between "see the map" and "see the table" is a real one.
                */}
                <button
                  type="button"
                  onClick={() => setViewsOpen((open) => !open)}
                  aria-expanded={viewsOpen}
                  className="ml-auto rounded px-2 py-1 text-[11px] text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                >
                  {viewsOpen ? 'Hide panel ▾' : 'Show panel ▴'}
                </button>
              </div>

              {/*
                A flex container, so the view inside becomes a flex item with
                a bounded height. As a plain block its child would size to
                content and spill out of the panel.
              */}
              <div className={viewsOpen ? 'flex min-h-0 flex-1' : 'hidden'}>
                {tab === 'chart' ? (
                  <TopRegionsChart
                    regions={regions}
                    measure={derived.measure}
                    level={derived.level}
                    selected={derived.level === 'state' ? selectedRegion : null}
                    onSelect={derived.level === 'state' ? focusState : focusDistrict}
                  />
                ) : (
                  <DataTable
                    records={derived.filteredRecords}
                    columns={workbook.columns}
                    measure={derived.measure}
                    totalRecords={workbook.records.length}
                    siteColumns={binding}
                  />
                )}
              </div>
            </div>
          )}
        </main>

        {siteListRegion !== null && (
          <div className="hidden lg:block">
            <SitePanel
              regionName={siteListRegion}
              records={siteRecords}
              siteKey={binding.siteKey}
              areaKey={binding.areaKey}
              siteColumns={binding}
              measure={derived.measure}
              onClose={() => openSiteList(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
