/**
 * Minimal KMZ/KML parsing: a representative point and a validity check.
 *
 * Deliberately narrow. This module does NOT compute area, does NOT resolve a
 * district from geometry, and does NOT compare anything against the sheet.
 * Those were considered and excluded from the requirement, and CLAUDE.md
 * independently forbids the first. A parser that quietly grew any of them would
 * put numbers on screen that no one asked for and no one validated.
 *
 * What it does:
 *   1. Opens the archive (or reads a bare .kml).
 *   2. Finds the root KML document by spec, not by convention.
 *   3. Converts to GeoJSON with togeojson.
 *   4. Takes one representative point.
 *   5. Reports what it found wrong, and never throws for bad input.
 *
 * TWO CHOICES WORTH DEFENDING
 *
 * Root document discovery. The KMZ spec says the root document is the first
 * .kml file at the archive root, and that is what {@link findRootKmlEntry}
 * implements. It is NOT doc.kml. Google Earth writes doc.kml, so hardcoding it
 * appears to work for years and then fails on the first archive exported by
 * QGIS, ArcGIS, or a surveyor's own toolchain — which is precisely the file
 * that matters here.
 *
 * Representative point. turf.pointOnFeature, never turf.centroid. A centroid is
 * the average of the coordinates and falls OUTSIDE its own polygon for any
 * concave shape — L-shaped plots, crescents, parcels wrapped around a
 * neighbour's holding. Land records are full of those. pointOnFeature
 * guarantees a point on the feature, which is the only property that makes the
 * point safe to use as a label anchor or a map fly-to target.
 */

import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import pointOnFeature from '@turf/point-on-feature';
import JSZip from 'jszip';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';

import type { KmzWarning, LatLng, ParsedKmzStatus } from './types';

/* -------------------------------------------------------------------------- */
/* Bounds                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Plausible coordinate bounds for India, from the requirement.
 *
 * Generous on purpose. This is a transposition detector and a paste-error
 * detector, not a border. Tightening it to actual national limits would start
 * rejecting legitimate files near the coast and in the far northeast for no
 * gain — the failure it is built to catch misses by tens of degrees, not
 * fractions.
 */
export const INDIA_BOUNDS = {
  minLat: 6,
  maxLat: 38,
  minLng: 68,
  maxLng: 98,
} as const;

const inBounds = (lat: number, lng: number): boolean =>
  lat >= INDIA_BOUNDS.minLat &&
  lat <= INDIA_BOUNDS.maxLat &&
  lng >= INDIA_BOUNDS.minLng &&
  lng <= INDIA_BOUNDS.maxLng;

/* -------------------------------------------------------------------------- */
/* Options and result                                                          */
/* -------------------------------------------------------------------------- */

/** The slice of DOMParser this module needs. Injected so node tests can run. */
export interface DomParserLike {
  parseFromString(source: string, mimeType: string): Document;
}

export interface KmzParseOptions {
  /**
   * Transpose every coordinate before use.
   *
   * Backs the swap toggle the UI offers when {@link KmzParseResult.suspectedCoordinateSwap}
   * is set. Off by default: a file is never silently corrected, because a
   * genuinely foreign coordinate and a transposed Indian one are
   * indistinguishable to this module, and guessing would relocate a parcel
   * without telling anyone.
   */
  readonly swapCoordinates?: boolean;
  /** Defaults to globalThis.DOMParser. Supplied by tests in a node environment. */
  readonly domParser?: DomParserLike;
}

export interface KmzParseResult {
  /** Never 'unparsed' — that status belongs to files this module has not seen. */
  readonly status: ParsedKmzStatus;
  readonly centroid: LatLng | null;
  readonly warnings: readonly KmzWarning[];
  /** Placemarks that carried geometry. Zero means unparseable. */
  readonly placemarkCount: number;
  /** Archive entry the geometry came from; null for a bare .kml upload. */
  readonly kmlEntryName: string | null;
  /**
   * True when coordinates fell out of range but land inside it when
   * transposed. The UI offers a swap toggle on this rather than a generic
   * failure, because lon,lat order is the single most common KML defect.
   */
  readonly suspectedCoordinateSwap: boolean;
}

/* -------------------------------------------------------------------------- */
/* Archive handling                                                            */
/* -------------------------------------------------------------------------- */

/** ZIP local file header. Used to sniff content rather than trust the suffix. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

async function looksLikeZip(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return ZIP_MAGIC.every((byte, index) => head[index] === byte);
}

/**
 * The root KML document, per the KMZ spec: the first .kml at archive ROOT.
 *
 * "Root" means no path separator in the entry name. A .kml nested under
 * files/ or a folder of its own is a linked document, not the root, and
 * treating it as one would render whichever sub-document happened to sort
 * first. Comparison is case-insensitive because archives written on Windows
 * routinely carry Doc.KML or DOC.kml.
 *
 * JSZip preserves insertion order, so "first" is the archive's own order rather
 * than an alphabetical guess.
 */
export function findRootKmlEntry(zip: JSZip): string | null {
  const roots = Object.keys(zip.files).filter((name) => {
    const entry = zip.files[name];
    if (entry === undefined || entry.dir) return false;
    if (name.includes('/')) return false;
    return name.toLowerCase().endsWith('.kml');
  });
  return roots[0] ?? null;
}

/** Every root-level .kml, so a multi-document archive can be reported. */
function allRootKmlEntries(zip: JSZip): readonly string[] {
  return Object.keys(zip.files).filter((name) => {
    const entry = zip.files[name];
    if (entry === undefined || entry.dir) return false;
    return !name.includes('/') && name.toLowerCase().endsWith('.kml');
  });
}

/* -------------------------------------------------------------------------- */
/* Coordinate inspection                                                       */
/* -------------------------------------------------------------------------- */

/** Every position in a geometry, flattened. Handles all GeoJSON nesting. */
function* positionsOf(geometry: Geometry | null): Generator<Position> {
  if (geometry === null) return;
  if (geometry.type === 'GeometryCollection') {
    for (const inner of geometry.geometries) yield* positionsOf(inner);
    return;
  }
  const walk = function* (value: unknown): Generator<Position> {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      yield value as Position;
      return;
    }
    for (const item of value) yield* walk(item);
  };
  yield* walk(geometry.coordinates);
}

/** Transpose in place on a copy. GeoJSON positions are [lng, lat]. */
function swapGeometry<T extends Geometry>(geometry: T): T {
  const swap = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [a, b, ...rest] = value as number[];
      return [b, a, ...rest];
    }
    return value.map(swap);
  };
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map(swapGeometry) };
  }
  return { ...geometry, coordinates: swap(geometry.coordinates) } as T;
}

/* -------------------------------------------------------------------------- */
/* Parse                                                                       */
/* -------------------------------------------------------------------------- */

const warn = (code: KmzWarning['code'], message: string): KmzWarning => ({ code, message });

const unparseable = (
  warnings: readonly KmzWarning[],
  kmlEntryName: string | null = null,
  suspectedCoordinateSwap = false,
): KmzParseResult => ({
  status: 'unparseable',
  centroid: null,
  warnings,
  placemarkCount: 0,
  kmlEntryName,
  suspectedCoordinateSwap,
});

/** Read the KML text out of a .kmz archive or a bare .kml file. */
async function readKmlText(
  file: Blob,
  filename: string,
  warnings: KmzWarning[],
): Promise<{ text: string; entryName: string | null } | null> {
  if (!(await looksLikeZip(file))) {
    // A .kmz that is not a zip is worth naming precisely; a .kml that is not a
    // zip is simply a .kml.
    if (filename.toLowerCase().endsWith('.kmz')) {
      warnings.push(
        warn('not-a-zip', 'This file is named .kmz but is not a ZIP archive. It was read as plain KML instead.'),
      );
    }
    return { text: await file.text(), entryName: null };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch (error) {
    warnings.push(
      warn('not-a-zip', `The archive could not be opened: ${(error as Error).message}`),
    );
    return null;
  }

  const roots = allRootKmlEntries(zip);
  const entryName = roots[0];
  if (entryName === undefined) {
    warnings.push(
      warn(
        'no-kml-entry',
        'The archive opened but contains no .kml file at its root. A KMZ must carry its root document at the top level.',
      ),
    );
    return null;
  }

  if (roots.length > 1) {
    warnings.push(
      warn(
        'multiple-kml-entries',
        `The archive holds ${roots.length} root-level .kml files. The first, "${entryName}", was used, per the KMZ spec.`,
      ),
    );
  }

  const entry = zip.file(entryName);
  if (entry === null) {
    warnings.push(warn('unreadable', `Archive entry "${entryName}" could not be read.`));
    return null;
  }

  return { text: await entry.async('string'), entryName };
}

/**
 * Parse one KMZ or KML into a representative point plus a verdict.
 *
 * Never throws for bad input. Every failure comes back as an 'unparseable'
 * result carrying warnings, because these files arrive in bulk from third
 * parties and one malformed archive must not take down a 130-file import.
 */
export async function parseKmz(
  file: Blob,
  filename: string,
  options: KmzParseOptions = {},
): Promise<KmzParseResult> {
  const warnings: KmzWarning[] = [];

  const source = await readKmlText(file, filename, warnings);
  if (source === null) return unparseable(warnings);

  // NetworkLink is reported, never followed. Fetching it would reach out to a
  // third-party server from a page holding confidential land data, turning a
  // local file into a network request nobody authorised.
  if (/<\s*NetworkLink[\s>]/i.test(source.text)) {
    warnings.push(
      warn(
        'network-link',
        'This file contains a NetworkLink. Its external content is not fetched and will not appear — only geometry stored inside the file itself is used.',
      ),
    );
  }

  const parser: DomParserLike | undefined =
    options.domParser ??
    (typeof DOMParser === 'undefined' ? undefined : new DOMParser());
  if (parser === undefined) {
    warnings.push(warn('unreadable', 'No XML parser is available in this environment.'));
    return unparseable(warnings, source.entryName);
  }

  let collection: FeatureCollection;
  try {
    const doc = parser.parseFromString(source.text, 'application/xml');
    collection = kmlToGeoJson(doc) as FeatureCollection;
  } catch (error) {
    warnings.push(warn('unreadable', `The KML could not be parsed: ${(error as Error).message}`));
    return unparseable(warnings, source.entryName);
  }

  const withGeometry = collection.features.filter(
    (feature): feature is Feature<Geometry> => feature.geometry != null,
  );

  if (withGeometry.length === 0) {
    warnings.push(
      warn(
        'no-placemark-geometry',
        'No Placemark with geometry was found. The file may hold only styles, folders, or a NetworkLink.',
      ),
    );
    return unparseable(warnings, source.entryName);
  }

  /* --- Coordinate range, and the transposition it usually means ----------- */

  let outOfRange = 0;
  let swapWouldFix = 0;
  for (const feature of withGeometry) {
    for (const [lng, lat] of positionsOf(feature.geometry)) {
      if (lng === undefined || lat === undefined) continue;
      if (inBounds(lat, lng)) continue;
      outOfRange += 1;
      if (inBounds(lng, lat)) swapWouldFix += 1;
    }
  }

  const suspectedCoordinateSwap = outOfRange > 0 && swapWouldFix === outOfRange;

  if (outOfRange > 0 && options.swapCoordinates !== true) {
    warnings.push(
      warn(
        'coordinates-out-of-range',
        suspectedCoordinateSwap
          ? `Coordinates fall outside India (lat ${INDIA_BOUNDS.minLat}–${INDIA_BOUNDS.maxLat}, lng ${INDIA_BOUNDS.minLng}–${INDIA_BOUNDS.maxLng}), but every one of them lands inside it when transposed. KML stores longitude first, so this file almost certainly has latitude and longitude swapped. Use the swap toggle to correct it — nothing is changed automatically.`
          : `Coordinates fall outside India (lat ${INDIA_BOUNDS.minLat}–${INDIA_BOUNDS.maxLat}, lng ${INDIA_BOUNDS.minLng}–${INDIA_BOUNDS.maxLng}) and do not land inside it when transposed, so this is not a simple lat/lng swap. Check that the file covers the right area.`,
      ),
    );
    return unparseable(warnings, source.entryName, suspectedCoordinateSwap);
  }

  /* --- Representative point ----------------------------------------------- */

  const features =
    options.swapCoordinates === true
      ? withGeometry.map((feature) => ({
          ...feature,
          geometry: swapGeometry(feature.geometry),
        }))
      : withGeometry;

  let centroid: LatLng | null = null;
  try {
    // pointOnFeature, not centroid: see the module doc. On a FeatureCollection
    // it returns a point lying on one of the members, which is what a label
    // anchor needs.
    const point = pointOnFeature({ type: 'FeatureCollection', features });
    const [lng, lat] = point.geometry.coordinates;
    if (typeof lat === 'number' && typeof lng === 'number') {
      centroid = { lat, lng };
    }
  } catch (error) {
    warnings.push(
      warn('unreadable', `A representative point could not be derived: ${(error as Error).message}`),
    );
  }

  if (centroid === null) {
    return unparseable(warnings, source.entryName, suspectedCoordinateSwap);
  }

  return {
    status: 'parsed',
    centroid,
    warnings,
    placemarkCount: withGeometry.length,
    kmlEntryName: source.entryName,
    suspectedCoordinateSwap,
  };
}
