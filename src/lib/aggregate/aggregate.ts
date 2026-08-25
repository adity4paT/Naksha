/**
 * Aggregating resolved records into per-region figures for the choropleth.
 *
 * Two distinctions this module exists to preserve, both of which collapse under
 * the obvious implementation:
 *
 * 1. **No records ≠ zero.** A region with no records is simply absent from the
 *    output map; the map layer paints absence with the no-data hatch.
 * 2. **No computable value ≠ zero.** A region can have records and still have
 *    no figure — every one of its sites having zero total area makes utilisation
 *    undefined. So {@link RegionAggregate.value} is nullable, and `null` reaches
 *    the map as no-data rather than as 0%.
 */

import { aggregateMeasure, recordValue } from '@/lib/measures';
import type { MeasureDescriptor } from '@/lib/measures';
import type { RecordResolution } from '@/lib/geo';
import { parseMeasure } from '@/lib/ingest';
import type { CellValue, NormalizedKey, ParsedRecord } from '@/types/schema';

/** Aggregated figures for one administrative region. */
export interface RegionAggregate {
  /** Canonical boundary name. */
  readonly name: string;
  /** Parent state. Equals `name` at state level. */
  readonly state: string;
  readonly level: 'state' | 'district';
  /**
   * The active measure, aggregated by its own strategy.
   *
   * `null` means "cannot be computed here" — distinct both from zero and from
   * the region being absent entirely.
   */
  readonly value: number | null;
  /**
   * Acreage of the bound total-area column, regardless of the active measure.
   *
   * Kept separate because "how much land is this" is a different question from
   * "what does the current choropleth say", and the unmapped panel needs the
   * former even when the map is showing a percentage.
   */
  readonly acres: number;
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
  /** Keyed by canonical region name. Absent key means no records, never zero. */
  readonly byRegion: ReadonlyMap<string, RegionAggregate>;
  /** Records that resolved to no boundary at this level. */
  readonly unmapped: readonly UnmappedEntry[];
  /** Total ACREAGE in `unmapped`. Drives the panel's running total. */
  readonly unmappedTotal: number;
  /** Total ACREAGE placed on the map. */
  readonly mappedTotal: number;
}

/** A record that could not be placed, retained with its acreage. */
export interface UnmappedEntry {
  readonly recordId: string;
  readonly sourceRowNumber: number;
  readonly rawState: string | null;
  readonly rawDistrict: string | null;
  readonly siteName: string | null;
  /**
   * Acreage, from the bound total-area column — NOT the active measure.
   *
   * The panel's job is "how much land is missing from this map", and that is an
   * acreage question whatever the choropleth happens to be showing. Summing the
   * active measure would make the total read "12,430%" when a percentage is
   * selected, which is meaningless.
   */
  readonly acres: number;
  /** The active measure's value for this record, for the detail column. */
  readonly value: number | null;
  readonly reason: string;
}

/** Column bindings the aggregator needs. All discovered, none hardcoded. */
export interface AggregationColumns {
  readonly siteKey: NormalizedKey | null;
  readonly stateKey: NormalizedKey | null;
  readonly districtKey: NormalizedKey | null;
  /** Total-area column, for acreage totals independent of the active measure. */
  readonly areaKey: NormalizedKey | null;
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
  measure: MeasureDescriptor,
  level: 'state' | 'district',
): AggregationResult {
  const grouped = new Map<
    string,
    { state: string; records: ParsedRecord[]; sites: Set<string>; acres: number }
  >();
  const unmapped: UnmappedEntry[] = [];

  let mappedTotal = 0;
  let unmappedTotal = 0;

  const acresOf = (record: ParsedRecord): number =>
    columns.areaKey === null ? 0 : (parseMeasure(record.values[columns.areaKey]) ?? 0);

  records.forEach((record, index) => {
    const resolution = resolutions[index];
    if (resolution === undefined) return;

    const acres = acresOf(record);
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
        value: recordValue(measure, record.values),
        reason:
          level === 'state'
            ? resolution.state.detail
            : (resolution.district?.detail ?? 'No district value on this record.'),
      });
      return;
    }

    mappedTotal += acres;

    const bucket = grouped.get(match.name) ?? {
      state: match.state,
      records: [],
      sites: new Set<string>(),
      acres: 0,
    };

    bucket.records.push(record);
    // Fall back to the record id so a row with no site name still counts as one
    // site rather than vanishing from the badge.
    bucket.sites.add(siteName ?? record.id);
    bucket.acres += acres;

    grouped.set(match.name, bucket);
  });

  const byRegion = new Map<string, RegionAggregate>();

  for (const [name, bucket] of grouped) {
    // Aggregated from the region's records as a whole, not by combining
    // per-record results — which is what lets a ratio measure sum its
    // numerator and denominator separately and divide once.
    const { value } = aggregateMeasure(
      measure,
      bucket.records.map((record) => record.values),
    );

    byRegion.set(name, {
      name,
      state: bucket.state,
      level,
      value,
      acres: bucket.acres,
      recordCount: bucket.records.length,
      siteCount: bucket.sites.size,
      recordIds: bucket.records.map((record) => record.id),
    });
  }

  return { byRegion, unmapped, unmappedTotal, mappedTotal };
}

/**
 * Values for the scale, from regions where the measure is computable.
 *
 * Two exclusions, both deliberate. Regions absent from `byRegion` are not
 * contributed as zeros — feeding "no data" into the distribution as 0 would
 * drag every quantile break downward and make the map report the shape of our
 * ignorance rather than of the data. Regions present with a `null` value are
 * excluded for the same reason.
 */
export function scaleValuesFrom(result: AggregationResult): number[] {
  return [...result.byRegion.values()]
    .map((region) => region.value)
    .filter((value): value is number => value !== null);
}
