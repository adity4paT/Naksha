/**
 * Boundary loading and indexing.
 *
 * The GeoJSON is fetched at runtime from `/geo/`, not imported. Bundling ~0.6 MB
 * of polygons into the JS payload would block first paint on data the map does
 * not need until a file is uploaded; as static assets they are cached by the
 * browser and fetched once.
 *
 * All fetches are same-origin. Per CLAUDE.md, no place name ever leaves the
 * browser — these requests carry no query, only a path.
 */

import type { Feature, MultiPolygon, Polygon } from 'geojson';

import { normalizePlaceName } from './normalize-place';

/** Properties every feature in `public/geo/` carries. Written by build-geo.mjs. */
export interface BoundaryProperties {
  readonly name: string;
  /** Parent state. Equals `name` in the states file. */
  readonly state: string;
  readonly level: 'state' | 'district';
  /** Source vintage marker, e.g. `'2011_c'`. Null for derived state polygons. */
  readonly vintage: string | null;
  /** `[lng, lat]`, area-weighted, precomputed at build time. */
  readonly centroid: readonly [number, number];
  /** `[west, south, east, north]`. */
  readonly bbox: readonly [number, number, number, number];
}

export type BoundaryFeature = Feature<Polygon | MultiPolygon, BoundaryProperties>;

/** One indexed boundary, with its match key precomputed. */
export interface BoundaryEntry {
  readonly feature: BoundaryFeature;
  /** Canonical name, exactly as the GeoJSON spells it. */
  readonly name: string;
  readonly state: string;
  /** {@link normalizePlaceName} of `name`. The stage-1 lookup key. */
  readonly key: string;
}

/**
 * Queryable index over the two boundary files.
 *
 * Built once per load. Every lookup below is O(1) or scoped to a single state's
 * districts, so the resolver never scans all 724.
 */
export interface BoundaryIndex {
  readonly states: readonly BoundaryEntry[];
  readonly districts: readonly BoundaryEntry[];
  /** Normalized state name → entry. */
  readonly stateByKey: ReadonlyMap<string, BoundaryEntry>;
  /** Canonical state name → its districts. The scope for stage 1 and stage 3. */
  readonly districtsByState: ReadonlyMap<string, readonly BoundaryEntry[]>;
  /** `"<canonical state>|<normalized district>"` → entry. */
  readonly districtByStateAndKey: ReadonlyMap<string, BoundaryEntry>;
}

/** Where the vendored files live. Same-origin, no query string. */
export const GEO_PATHS = {
  states: '/geo/india-states.geojson',
  districts: '/geo/india-districts.geojson',
  aliases: '/geo/aliases.json',
} as const;

function toEntries(features: readonly BoundaryFeature[]): BoundaryEntry[] {
  return features.map((feature) => ({
    feature,
    name: feature.properties.name,
    state: feature.properties.state,
    key: normalizePlaceName(feature.properties.name),
  }));
}

/** Build the index from two already-parsed FeatureCollections. */
export function buildBoundaryIndex(
  stateFeatures: readonly BoundaryFeature[],
  districtFeatures: readonly BoundaryFeature[],
): BoundaryIndex {
  const states = toEntries(stateFeatures);
  const districts = toEntries(districtFeatures);

  const stateByKey = new Map<string, BoundaryEntry>();
  for (const entry of states) {
    // First writer wins. A duplicate would mean the states file is malformed,
    // and silently overwriting would make which polygon you get depend on file
    // order — a bug that only shows up as a subtly wrong map.
    if (!stateByKey.has(entry.key)) stateByKey.set(entry.key, entry);
  }

  const districtsByState = new Map<string, BoundaryEntry[]>();
  const districtByStateAndKey = new Map<string, BoundaryEntry>();

  for (const entry of districts) {
    const bucket = districtsByState.get(entry.state);
    if (bucket === undefined) districtsByState.set(entry.state, [entry]);
    else bucket.push(entry);

    const composite = `${entry.state}|${entry.key}`;
    if (!districtByStateAndKey.has(composite)) {
      districtByStateAndKey.set(composite, entry);
    }
  }

  return { states, districts, stateByKey, districtsByState, districtByStateAndKey };
}

/** Composite key for {@link BoundaryIndex.districtByStateAndKey}. */
export function districtCompositeKey(canonicalState: string, districtKey: string): string {
  return `${canonicalState}|${districtKey}`;
}

/** Districts of one state, or an empty array. */
export function districtsIn(
  index: BoundaryIndex,
  canonicalState: string,
): readonly BoundaryEntry[] {
  return index.districtsByState.get(canonicalState) ?? [];
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/** Injectable fetch, so tests can load from disk without a server. */
export type GeoFetcher = (path: string) => Promise<unknown>;

const defaultFetcher: GeoFetcher = async (path) => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

function assertFeatureCollection(value: unknown, path: string): BoundaryFeature[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !Array.isArray((value as { features?: unknown }).features)
  ) {
    throw new Error(`${path} is not a GeoJSON FeatureCollection`);
  }
  return (value as { features: BoundaryFeature[] }).features;
}

/** Fetch and index both boundary files. */
export async function loadBoundaryIndex(
  fetcher: GeoFetcher = defaultFetcher,
): Promise<BoundaryIndex> {
  const [statesRaw, districtsRaw] = await Promise.all([
    fetcher(GEO_PATHS.states),
    fetcher(GEO_PATHS.districts),
  ]);

  return buildBoundaryIndex(
    assertFeatureCollection(statesRaw, GEO_PATHS.states),
    assertFeatureCollection(districtsRaw, GEO_PATHS.districts),
  );
}
