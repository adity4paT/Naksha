'use client';

/**
 * The one derivation pipeline every view reads from.
 *
 * ## Single source of truth
 *
 * The map, the table, and the chart all consume THIS hook's output. None of
 * them re-derives a filtered set of its own. That is what stops the three from
 * disagreeing — a table showing 47 rows beside a map summing 52 is the classic
 * symptom of parallel query paths, and it is unfixable once it exists because
 * there is no single place that is right.
 *
 * ## Memoisation
 *
 * The pipeline is a chain of `useMemo`s with narrowing dependencies, so a
 * change part-way down does not recompute the stages above it:
 *
 * ```
 * facetRows      ← workbook, resolutions        (only on a new dataset)
 * filtered       ← facetRows, selections        (on any filter change)
 * records        ← filtered                     (index lookup, cheap)
 * aggregation    ← records, measure, level      (on filter/measure/drill)
 * scale          ← aggregation, method, bins    (on legend changes)
 * ```
 *
 * The expensive stage is aggregation, and it is deliberately computed for the
 * ACTIVE LEVEL ONLY. Computing both state and district aggregates on every
 * change doubled the work to keep a value that is discarded the moment the user
 * is not looking at it.
 */

import { useMemo } from 'react';

import type { AggregationResult } from '@/lib/aggregate';
import { aggregateByRegion, scaleValuesFrom } from '@/lib/aggregate';
import type { BinnedScale } from '@/lib/color';
import { computeScale, rampFor } from '@/lib/color';
import type { FacetRow } from '@/lib/filters';
import { applyFilters, buildAllFacets, measureBounds } from '@/lib/filters';
import type { RecordResolution } from '@/lib/geo';
import { recordValue } from '@/lib/measures';
import type { MeasureDescriptor } from '@/lib/measures';
import { useDatasetStore } from '@/store/dataset';
import type { MapLevel } from '@/store/filters';
import { focusedState, levelFor, useFilterStore } from '@/store/filters';
import type { NormalizedKey, ParsedRecord } from '@/types/schema';
import { effectiveRole } from '@/types/schema';

export interface DerivedData {
  readonly hasDataset: boolean;
  readonly measure: MeasureDescriptor | null;
  readonly level: MapLevel;

  /** Every record, flattened for filtering. */
  readonly facetRows: readonly FacetRow[];
  /** Records surviving the active filters. */
  readonly filteredRecords: readonly ParsedRecord[];
  readonly filteredResolutions: readonly RecordResolution[];

  readonly aggregation: AggregationResult;
  readonly scale: BinnedScale;
  readonly ramp: readonly string[];

  /** Measure columns offered as range filters. */
  readonly rangeMeasures: readonly { key: string; label: string }[];
  readonly facets: ReturnType<typeof buildAllFacets>;

  /** True when a dataset is loaded but the filters exclude everything. */
  readonly filteredToNothing: boolean;
  /** True when records exist but none resolved to a boundary. */
  readonly allUnmapped: boolean;
}

const EMPTY_AGGREGATION: AggregationResult = {
  byRegion: new Map(),
  unmapped: [],
  unmappedTotal: 0,
  mappedTotal: 0,
};

const EMPTY_SCALE: BinnedScale = {
  method: 'quantile',
  bins: [],
  breaks: [],
  min: 0,
  max: 0,
};

export function useDerivedData(mode: 'light' | 'dark' = 'light'): DerivedData {
  const workbook = useDatasetStore((s) => s.workbook);
  const resolutions = useDatasetStore((s) => s.resolutions);
  const measures = useDatasetStore((s) => s.measures);
  const binding = useDatasetStore((s) => s.binding);

  const selections = useFilterStore((s) => s.selections);
  const measureId = useFilterStore((s) => s.measureId);
  const binningMethod = useFilterStore((s) => s.binningMethod);
  const binCount = useFilterStore((s) => s.binCount);
  const scaleKind = useFilterStore((s) => s.scaleKind);
  const zoom = useFilterStore((s) => s.zoom);

  const measure = useMemo(
    () => measures.find((m) => m.id === measureId) ?? measures[0] ?? null,
    [measures, measureId],
  );

  const level = levelFor({ selections, zoom });
  const selectedState = focusedState(selections);

  /* -- stage 1: flatten. Only changes when a new dataset is committed. ----- */
  const facetRows = useMemo<FacetRow[]>(() => {
    if (workbook === null || measure === null) return [];

    const read = (record: ParsedRecord, key: NormalizedKey | null): string | null => {
      if (key === null) return null;
      const value = record.values[key];
      return typeof value === 'string' ? value : value == null ? null : String(value);
    };

    const measureKeys = workbook.columns
      .filter((column) => effectiveRole(column) === 'measure')
      .map((column) => column.normalizedKey);

    const businessKey =
      workbook.columns.find((c) => /\bbusiness\b/.test(c.normalizedKey))?.normalizedKey ??
      null;

    return workbook.records.map((record, index) => {
      const resolution = resolutions[index];
      const values: Record<string, number | null> = {};
      for (const key of measureKeys) {
        values[key] = recordValue(
          { kind: 'sheet', id: key, label: key, columnKey: key, aggregation: 'sum', unit: 'acre', isEmpty: false, rawHeader: null },
          record.values,
        );
      }

      return {
        recordId: record.id,
        business: read(record, businessKey),
        // Canonical names, so the filter panel and the map talk about the same
        // regions. Null for records that failed to resolve.
        state: resolution?.state.match?.name ?? null,
        district: resolution?.district?.match?.name ?? null,
        site: read(record, binding.siteKey),
        measures: values,
      };
    });
  }, [workbook, resolutions, binding.siteKey, measure]);

  /* -- stage 2: filter. Changes on any filter edit. ------------------------ */
  const filteredIds = useMemo(() => {
    const rows = applyFilters(facetRows, selections);
    return new Set(rows.map((row) => row.recordId));
  }, [facetRows, selections]);

  const { filteredRecords, filteredResolutions } = useMemo(() => {
    if (workbook === null) {
      return { filteredRecords: [] as ParsedRecord[], filteredResolutions: [] as RecordResolution[] };
    }

    const records: ParsedRecord[] = [];
    const resolved: RecordResolution[] = [];

    // Kept index-aligned: aggregateByRegion pairs records with resolutions by
    // position, so filtering one without the other would silently mis-attribute
    // every record after the first exclusion.
    workbook.records.forEach((record, index) => {
      if (!filteredIds.has(record.id)) return;
      records.push(record);
      const resolution = resolutions[index];
      if (resolution !== undefined) resolved.push(resolution);
    });

    return { filteredRecords: records, filteredResolutions: resolved };
  }, [workbook, resolutions, filteredIds]);

  /* -- stage 3: aggregate. The expensive one; active level only. ----------- */
  const aggregation = useMemo(() => {
    if (measure === null || filteredRecords.length === 0) return EMPTY_AGGREGATION;
    return aggregateByRegion(
      filteredRecords,
      filteredResolutions,
      {
        siteKey: binding.siteKey,
        stateKey: binding.stateKey,
        districtKey: binding.districtKey,
        areaKey: binding.areaKey,
      },
      measure,
      level,
    );
  }, [filteredRecords, filteredResolutions, binding, measure, level]);

  /* -- stage 4: scale. Changes on legend interaction. ---------------------- */
  const scale = useMemo(() => {
    if (aggregation.byRegion.size === 0) return EMPTY_SCALE;

    // Re-binned against the regions currently VISIBLE, so drilling into one
    // state uses the full ramp on its districts rather than wasting four of
    // five classes on a national range.
    const values =
      level === 'district' && selectedState !== null
        ? [...aggregation.byRegion.values()]
            .filter((region) => region.state === selectedState)
            .map((region) => region.value)
            .filter((value): value is number => value !== null)
        : scaleValuesFrom(aggregation);

    return computeScale(values, binningMethod, binCount);
  }, [aggregation, level, selectedState, binningMethod, binCount]);

  const ramp = useMemo(
    () => rampFor(scaleKind, mode, binCount),
    [scaleKind, mode, binCount],
  );

  const rangeMeasures = useMemo(
    () =>
      (workbook?.columns ?? [])
        .filter((column) => effectiveRole(column) === 'measure' && !column.isEmptyInSample)
        .map((column) => ({
          key: column.normalizedKey as string,
          label: column.displayLabel.trim(),
        })),
    [workbook],
  );

  const facets = useMemo(
    () => buildAllFacets(facetRows, selections),
    [facetRows, selections],
  );

  // Referenced so the memo above is not mistaken for dead code by a reader;
  // bounds are derived inside FilterPanel from the same rows.
  void measureBounds;

  return {
    hasDataset: workbook !== null,
    measure,
    level,
    facetRows,
    filteredRecords,
    filteredResolutions,
    aggregation,
    scale,
    ramp,
    rangeMeasures,
    facets,
    filteredToNothing: workbook !== null && facetRows.length > 0 && filteredRecords.length === 0,
    allUnmapped:
      filteredRecords.length > 0 && aggregation.byRegion.size === 0,
  };
}
