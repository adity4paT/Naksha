/**
 * Build the vendored boundary GeoJSON in `public/geo/`.
 *
 * Run with `npm run build:geo`. Deliberately NOT part of `next build` — the
 * outputs are committed, so an ordinary build and an ordinary `npm ci` need no
 * network access and produce byte-identical maps. Re-run this only to refresh
 * the boundary vintage on purpose, and read `public/geo/README.md` first.
 *
 * Pipeline:
 *   1. Download the source district file at a PINNED COMMIT (never a branch).
 *   2. Simplify with mapshaper to ~0.01 degrees.
 *   3. Derive state polygons by dissolving districts on their parent state.
 *   4. Precompute a centroid and bbox for every feature.
 *   5. Write both files plus a provenance manifest.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'geo');
const TMP_DIR = join(ROOT, '.geo-build');

/* -------------------------------------------------------------------------- */
/* Source pin                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Source: https://github.com/udit-001/india-maps-data
 *
 * PINNED COMMIT — do not replace with `main`.
 *
 * The pin is the whole point. Indian district boundaries change several times a
 * year as states carve out new districts, and this repository tracks those
 * changes actively — the pinned commit is itself titled "split Banaskantha into
 * Banaskantha + Vav-Tharad district". Tracking a branch would let a district
 * appear, vanish, or be renamed underneath a deployed dashboard, silently
 * changing which polygon a land record joins to and therefore what acreage the
 * choropleth reports. Bumping this SHA should be a deliberate act with a diff
 * to review.
 */
const SOURCE_REPO = 'udit-001/india-maps-data';
const SOURCE_SHA = 'cc91a19ffbca10b7ca6872a1e9690b4e5fd3aa0a';
const SOURCE_PATH = 'geojson/india.geojson';
const SOURCE_DATE = '2026-07-13';
const SOURCE_URL = `https://raw.githubusercontent.com/${SOURCE_REPO}/${SOURCE_SHA}/${SOURCE_PATH}`;

/**
 * Simplification tolerance.
 *
 * The brief asked for ~0.01 degrees. mapshaper's `interval=` is metres for
 * geographic input, and 0.01 degrees of latitude is roughly 1,100 m, so that is
 * the figure used. `keep-shapes` stops small districts — Chandigarh,
 * Lakshadweep, the Delhi districts — from collapsing to nothing at this
 * tolerance, which is a real risk and would drop them from the map silently.
 */
const SIMPLIFY_INTERVAL_METRES = 1100;

/** Coordinate rounding, in degrees. ~11 m, well below the simplify tolerance. */
const COORDINATE_PRECISION = 0.0001;

/* -------------------------------------------------------------------------- */
/* Property names                                                              */
/* -------------------------------------------------------------------------- */

const SRC_DISTRICT = 'district';
const SRC_STATE = 'st_nm';
const SRC_YEAR = 'year';

/** Our output property names, kept stable even if the source renames its own. */
const OUT = {
  name: 'name',
  state: 'state',
  level: 'level',
  centroid: 'centroid',
  bbox: 'bbox',
  vintage: 'vintage',
};

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Area-weighted centroid of a single linear ring, via the shoelace formula. */
function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let area = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }

  area /= 2;

  if (area === 0) {
    // Degenerate ring (collinear or zero-area). Fall back to the mean vertex,
    // which is always defined, rather than emitting NaN into the output.
    const mean = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return { point: [mean[0] / ring.length, mean[1] / ring.length], area: 0 };
  }

  return { point: [x / (6 * area), y / (6 * area)], area: Math.abs(area) };
}

/**
 * Area-weighted centroid of a Polygon or MultiPolygon.
 *
 * Only outer rings contribute; holes are ignored, which nudges the point for
 * districts containing enclaves but never moves it out of the feature's general
 * area.
 *
 * Caveat worth knowing: for a strongly concave or crescent-shaped district the
 * area centroid can land outside the polygon. That is tolerable here because V1
 * uses this point only as a label anchor and a fly-to target — CLAUDE.md forbids
 * plotting per-site markers, so nothing is ever drawn at this coordinate as if
 * it were a surveyed position. If that ever changes, switch to a
 * pole-of-inaccessibility computation.
 */
function featureCentroid(geometry) {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];

  let x = 0;
  let y = 0;
  let total = 0;

  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer || outer.length < 3) continue;
    const { point, area } = ringCentroid(outer);
    if (area === 0) continue;
    x += point[0] * area;
    y += point[1] * area;
    total += area;
  }

  if (total === 0) {
    const box = featureBbox(geometry);
    return [round((box[0] + box[2]) / 2), round((box[1] + box[3]) / 2)];
  }

  return [round(x / total), round(y / total)];
}

/** Bounding box as `[west, south, east, north]`. */
function featureBbox(geometry) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const visit = (coords) => {
    if (typeof coords[0] === 'number') {
      west = Math.min(west, coords[0]);
      east = Math.max(east, coords[0]);
      south = Math.min(south, coords[1]);
      north = Math.max(north, coords[1]);
      return;
    }
    for (const child of coords) visit(child);
  };

  visit(geometry.coordinates);
  return [round(west), round(south), round(east), round(north)];
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                    */
/* -------------------------------------------------------------------------- */

const MAPSHAPER_BIN = join(ROOT, 'node_modules', 'mapshaper', 'bin', 'mapshaper');

function mapshaper(args) {
  execFileSync(process.execPath, [MAPSHAPER_BIN, ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

async function download(url, dest) {
  process.stdout.write(`  fetching ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(dest, buffer);
  return buffer.length;
}

/** Rewrite a mapshaper output into our stable property shape. */
function decorate(path, level) {
  const collection = JSON.parse(readFileSync(path, 'utf8'));
  const vintages = new Set();

  collection.features = collection.features.map((feature) => {
    const props = feature.properties ?? {};
    const name = level === 'district' ? props[SRC_DISTRICT] : props[SRC_STATE];
    if (props[SRC_YEAR]) vintages.add(String(props[SRC_YEAR]));

    return {
      type: 'Feature',
      properties: {
        [OUT.name]: String(name ?? '').trim(),
        // Every district carries its parent state. District names repeat across
        // states — Raigad in Maharashtra against Raigarh in Chhattisgarh being
        // the pair that actually bites this dataset — and without the parent
        // there is no way to tell them apart.
        [OUT.state]: String(props[SRC_STATE] ?? '').trim(),
        [OUT.level]: level,
        [OUT.vintage]: props[SRC_YEAR] ? String(props[SRC_YEAR]) : null,
        // Precomputed at build time, never per render. Recomputing centroids
        // for ~760 polygons on every paint is pure waste.
        [OUT.centroid]: featureCentroid(feature.geometry),
        [OUT.bbox]: featureBbox(feature.geometry),
      },
      geometry: feature.geometry,
    };
  });

  writeFileSync(path, JSON.stringify(collection));
  return { count: collection.features.length, vintages: [...vintages].sort() };
}

async function main() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const rawPath = join(TMP_DIR, 'source.geojson');
  const rawBytes = await download(SOURCE_URL, rawPath);
  console.log(`  source: ${(rawBytes / 1024 / 1024).toFixed(2)} MB`);

  const districtsPath = join(OUT_DIR, 'india-districts.geojson');
  const statesPath = join(OUT_DIR, 'india-states.geojson');

  // The source file is a MIX: 726 district polygons plus one nameless
  // state-outline feature per state (34 of them; Lakshadweep and Chandigarh
  // have none, being single-district UTs). Those outlines carry st_nm but no
  // district, and their bboxes match the union of their own districts exactly.
  //
  // They must be filtered out or they become 34 phantom nameless "districts"
  // that a fuzzy match could latch onto. Filtering before simplifying also
  // stops them from overlapping the real districts while mapshaper builds
  // topology.
  console.log('  filtering + simplifying districts...');
  mapshaper([
    rawPath,
    '-filter',
    'district != null && String(district).trim().length > 0',
    // Collapse features that share a (district, state) pair. Lakshadweep and
    // Chandigarh each arrive as two features under one name, and without this
    // the index would hold two candidates for one real district — an exact
    // match would then be ambiguous for no good reason. After this step,
    // (state, district) is unique, which the boundary tests assert.
    '-dissolve',
    `${SRC_DISTRICT},${SRC_STATE}`,
    `copy-fields=${SRC_YEAR}`,
    '-simplify',
    `interval=${SIMPLIFY_INTERVAL_METRES}`,
    'keep-shapes',
    '-o',
    `precision=${COORDINATE_PRECISION}`,
    districtsPath,
  ]);

  // State polygons are DERIVED from the districts rather than downloaded
  // separately. Two independently sourced files would eventually disagree — a
  // district whose parent state is missing from the state file, or an external
  // border drawn differently at the two levels — and the cascade's state-scoped
  // district lookup would then fail in ways that are painful to trace.
  // Dissolving guarantees both levels share a border and a name set.
  console.log('  dissolving states from districts...');
  mapshaper([
    districtsPath,
    '-dissolve',
    SRC_STATE,
    `copy-fields=${SRC_STATE}`,
    '-o',
    `precision=${COORDINATE_PRECISION}`,
    statesPath,
  ]);

  console.log('  computing centroids...');
  const districts = decorate(districtsPath, 'district');
  const states = decorate(statesPath, 'state');

  const sizeOf = (p) => (readFileSync(p).length / 1024 / 1024).toFixed(2);

  writeFileSync(
    join(OUT_DIR, 'provenance.json'),
    `${JSON.stringify(
      {
        source: `https://github.com/${SOURCE_REPO}`,
        commit: SOURCE_SHA,
        commitDate: SOURCE_DATE,
        path: SOURCE_PATH,
        generatedBy: 'scripts/build-geo.mjs',
        simplifyIntervalMetres: SIMPLIFY_INTERVAL_METRES,
        coordinatePrecisionDegrees: COORDINATE_PRECISION,
        districtCount: districts.count,
        stateCount: states.count,
        districtVintages: districts.vintages,
      },
      null,
      2,
    )}\n`,
  );

  rmSync(TMP_DIR, { recursive: true, force: true });

  console.log('');
  console.log(`  districts: ${districts.count} features, ${sizeOf(districtsPath)} MB`);
  console.log(`  states:    ${states.count} features, ${sizeOf(statesPath)} MB`);
  console.log(`  vintages:  ${districts.vintages.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
