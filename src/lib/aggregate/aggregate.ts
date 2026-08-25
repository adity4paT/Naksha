/**
 * Aggregating resolved records into per-region figures for the choropleth.
 *
 * The distinction this module exists to preserve: a region with **no records**
 * is not a region with **zero acres**. Both would sum to 0, and collapsing them
 * would make the map assert a fact the data does not contain. Regions with no
 * records simply never appear in the output map, and the map layer paints
 * whatever is absent with the no-data hatch.
 */

import type { RecordResolution } from '@/lib/geo';
import type { CellValue, NormalizedKey, ParsedRecord } from '@/types/schema';
import { parseMeasure } from '@/lib/ingest';

/** Aggregated figures for one administrative region. */
export interface RegionAggregate {
  /** Canonical boundary name. */
  readonly name: string;
  /** Parent state. Equals `name` at state level. */
  readonly state: string;
  readonly level: 'state' | 'district';
  /** Sum of the active measure, in acres. */
  readonly total: number;
  /** Records contributing. */
  readonly recordCount: number;
  /**
   * Distinct sites, for the count badge.
   *
   * Distinct rather than a row count because the sample repeats a few site
   * names across rows — 124 distinct names over 130 rows — and a badge reading
   * "6 sites" should mean six places, not six spreadsheet lines.
   */
  readonly siteCount: number;
  /** Record ids, so clicking the badge can open exactly these in the panel. */
  readonly recordIds: readonly string[];
}

/** Everything the map needs for one level, plus what it could not place. */
export interface AggregationResult {
  /** Keyed by canonical region name. Absent key means no data, never zero. */
  readonly byRegion: ReadonlyMap<string, RegionAggregate>;
  /** Records that resolved to no boundary at this level. */
  readonly unmapped: readonly UnmappedEntry[];
  /** Total acreage in `unmapped`. Drives the panel's running total. */
  readonly unmappedTotal: number;
  /** Total acreage placed on the map. */
  readonly mappedTotal: number;
}

/** A record that could not be placed, retained with its acreage. */
export interface UnmappedEntry {
  readonly recordId: string;
  readonly sourceRowNumber: number;
  /** Raw spreadsheet state value. */
  readonly rawState: string | null;
  /** Raw spreadsheet district value. */
  readonly rawDistrict: string | null;
  /** Site name, when the workbook has a site column. */
  readonly siteName: string | null;
  /** Acreage of the active measure. Never omitted — the panel must total it. */
  readonly acres: number;
  /** Why it could not be placed, for display. */
  readonly reason: string;
}

/** Column bindings the aggregator needs. All discovered, none hardcoded. */
export interface AggregationColumns {
  readonly measureKey: NormalizedKey;
  readonly siteKey: NormalizedKey | null;
  readonly stateKey: NormalizedKey | null;
  readonly districtKey: NormalizedKey | null;
}

const asString = (value: CellValue | undefined): string | null =>
  typeof value === 'string' ? value : value == null ? null : String(value);

/**
 * Aggregate records to one administrative level.
 *
 * `level` selects which part of each resolution is used. At `'state'` every
 * record with a resolved state contributes, including those whose district
 * failed — a record we can place in Gujarat but not in a specific district is
 * still Gujarat's acreage, and dropping it from the state view would make the
 * state totals disagree with the data table.
 */
export function aggregateByRegion(
  records: readonly ParsedRecord[],
  resolutions: readonly RecordResolution[],
  columns: AggregationColumns,
  level: 'state' | 'district',
): AggregationResult {
  const byRegion = new Map<string, RegionAggregate>();
  const siteSets = new Map<string, Set<string>>();
  const unmapped: UnmappedEntry[] = [];

  let mappedTotal = 0;
  let unmappedTotal = 0;

  records.forEach((record, index) => {
    const resolution = resolutions[index];
    if (resolution === undefined) return;

    const acres = parseMeasure(record.values[columns.measureKey]) ?? 0;
    const siteName =
      columns.siteKey === null ? null : asString(record.values[columns.siteKey]);

    const match = level === 'state' ? resolution.state.match : resolution.district?.match;

    if (match == null) {
      unmappedTotal += acres;
      unmapped.push({
        recordId: record.id,
        sourceRowNumber: record.sourceRowNumber,
        rawState:
          columns.stateKey === null ? null : asString(record.values[columns.stateKey]),
        rawDistrict:
          columns.districtKey === null
            ? null
            : asString(record.values[columns.districtKey]),
        siteName,
        acres,
        reason:
          level === 'state'
            ? resolution.state.detail
            : (resolution.district?.detail ?? 'No district value on this record.'),
      });
      return;
    }

    mappedTotal += acres;

    const key = match.name;
    const existing = byRegion.get(key);

    const sites = siteSets.get(key) ?? new Set<string>();
    // Fall back to the record id so a row with no site name still counts as one
    // site rather than vanishing from the badge.
    sites.add(siteName ?? record.id);
    siteSets.set(key, sites);

    byRegion.set(key, {
      name: key,
      state: match.state,
      level,
      total: (existing?.total ?? 0) + acres,
      recordCount: (existing?.recordCount ?? 0) + 1,
      siteCount: sites.size,
      recordIds: [...(existing?.recordIds ?? []), record.id],
    });
  });

  return { byRegion, unmapped, unmappedTotal, mappedTotal };
}

/**
 * Values for the scale, from regions that actually have data.
 *
 * Regions absent from `byRegion` are deliberately NOT contributed as zeros.
 * Feeding "no data" into the distribution as 0 would drag every quantile break
 * downward and change what colour real districts are painted — the map would
 * be reporting the shape of our ignorance rather than the shape of the data.
 */
export function scaleValuesFrom(result: AggregationResult): number[] {
  return [...result.byRegion.values()].map((region) => region.total);
}
