/**
 * Generate the synthetic KMZ test fixtures.
 *
 *   node scripts/build-kmz-fixtures.mjs
 *
 * EVERY NAME AND COORDINATE BELOW IS INVENTED. No real surveyed boundary is in
 * this repository and none may be added: CLAUDE.md treats surveyed parcels as
 * confidential, .gitignore blocks `*.kmz` outright, and the single exemption is
 * `!tests/fixtures/synthetic-*.kmz` — a fixed prefix inside one directory,
 * deliberately too narrow to admit a real file that happens to land there.
 *
 * The village names are fabrications chosen to sound plausible without naming
 * anywhere in particular. The coordinates sit in open country between roughly
 * 72-79E and 18-24N — inside the validator's India bounds, which is the only
 * property the tests depend on.
 *
 * This script exists so the binaries are reviewable. A committed .kmz is an
 * opaque zip; a reader who wants to know what is inside one should be able to
 * read this file instead of unzipping it.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import JSZip from 'jszip';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

/** KML is lon,lat — longitude FIRST. Every literal below follows that. */
const ring = (positions) => positions.map(([lng, lat]) => `${lng},${lat},0`).join(' ');

const SIMPLE = ring([
  [73.0, 21.0],
  [73.8, 21.0],
  [73.8, 21.8],
  [73.0, 21.8],
  [73.0, 21.0],
]);

const HOLE_OUTER = ring([
  [74.0, 20.0],
  [76.0, 20.0],
  [76.0, 22.0],
  [74.0, 22.0],
  [74.0, 20.0],
]);

const HOLE_INNER = ring([
  [74.5, 20.5],
  [75.5, 20.5],
  [75.5, 21.5],
  [74.5, 21.5],
  [74.5, 20.5],
]);

const MULTI_A = ring([
  [77.0, 20.0],
  [77.5, 20.0],
  [77.5, 20.5],
  [77.0, 20.5],
  [77.0, 20.0],
]);

const MULTI_B = ring([
  [78.5, 21.0],
  [79.0, 21.0],
  [79.0, 21.5],
  [78.5, 21.5],
  [78.5, 21.0],
]);

/**
 * A C-shaped parcel, concave enough that its own vertex mean lands in the
 * notch — outside the polygon. This is the shape that makes turf.pointOnFeature
 * necessary and turf.centroid wrong, and land records genuinely contain plots
 * wrapped around a neighbour's holding like this.
 */
const CRESCENT = ring([
  [72.0, 18.0],
  [78.0, 18.0],
  [78.0, 20.0],
  [74.0, 20.0],
  [74.0, 22.0],
  [78.0, 22.0],
  [78.0, 24.0],
  [72.0, 24.0],
  [72.0, 18.0],
]);

/**
 * The same parcel with latitude and longitude transposed.
 *
 * Written lat,lng where KML requires lng,lat. Read literally the longitudes
 * become 21.3-21.8 and the latitudes 75.4-75.9, which is nowhere; transposed,
 * it is an ordinary block of land. That asymmetry is what lets the parser tell
 * a swap apart from a genuinely foreign file.
 */
const SWAPPED = [
  [21.3, 75.4],
  [21.3, 75.9],
  [21.8, 75.9],
  [21.8, 75.4],
  [21.3, 75.4],
]
  .map(([lat, lng]) => `${lat},${lng},0`)
  .join(' ');

/** Brazil. Used only as a decoy — see the doc.kml note below. */
const DECOY = ring([
  [-47.0, -15.0],
  [-46.0, -15.0],
  [-46.0, -14.0],
  [-47.0, -14.0],
  [-47.0, -15.0],
]);

const polygon = (coords) =>
  `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;

const placemark = (name, geometry) =>
  `    <Placemark><name>${name}</name>${geometry}</Placemark>`;

const document = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${title}</name>
    <description>SYNTHETIC TEST DATA. Invented names and coordinates. Not a survey.</description>
${body}
  </Document>
</kml>
`;

/* -------------------------------------------------------------------------- */
/* synthetic-parcels.kmz                                                       */
/* -------------------------------------------------------------------------- */

const parcelsKml = document(
  'Synthetic parcels',
  [
    placemark('Anandpur Block A', polygon(SIMPLE)),
    // A parcel with an excluded pond in the middle. The hole is the point: a
    // representative point must land in the ring, never in the void.
    placemark(
      'Beharwadi Estate',
      `<Polygon>` +
        `<outerBoundaryIs><LinearRing><coordinates>${HOLE_OUTER}</coordinates></LinearRing></outerBoundaryIs>` +
        `<innerBoundaryIs><LinearRing><coordinates>${HOLE_INNER}</coordinates></LinearRing></innerBoundaryIs>` +
        `</Polygon>`,
    ),
    // One holding recorded as two disjoint plots either side of a road.
    placemark(
      'Chandroli North and South',
      `<MultiGeometry>${polygon(MULTI_A)}${polygon(MULTI_B)}</MultiGeometry>`,
    ),
    // No area at all — a surveyor's marker peg. Valid KML, and the validator
    // must accept it: the rule is "a Placemark with geometry", not "a polygon".
    placemark(
      'Devgadh Marker',
      `<Point><coordinates>76.5,23.0,0</coordinates></Point>`,
    ),
    placemark('Ekalpur Crescent', polygon(CRESCENT)),
  ].join('\n'),
);

/**
 * The root document is NOT called doc.kml, and a decoy that IS sits nested one
 * directory down holding coordinates in Brazil.
 *
 * A parser that looks up "doc.kml" by name finds the decoy and fails the
 * coordinate check. One that follows the KMZ spec — first .kml at the archive
 * ROOT — finds the real document. The decoy is what turns a passing test into
 * a meaningful one: without it, both implementations would pass.
 */
/**
 * A fixed entry timestamp.
 *
 * Without one JSZip stamps every entry with the current time, so regenerating
 * the fixtures produces different bytes and a diff on files whose content never
 * changed. Note the limit of the guarantee: a ZIP stores DOS timestamps in
 * LOCAL time, so byte-identity holds for regeneration within one timezone. It
 * is enough to keep `git status` quiet, which is what it is for.
 */
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');
const add = (zip, name, content) => zip.file(name, content, { date: FIXED_DATE });

const parcels = new JSZip();
add(parcels, 'parcels-survey-2026.kml', parcelsKml);
add(parcels, 'files/doc.kml', document('Decoy, must not be read', placemark('Elsewhere', polygon(DECOY))));
add(parcels, 'files/style.xml', '<Style/>');

/* -------------------------------------------------------------------------- */
/* synthetic-crescent.kmz and synthetic-swapped.kmz                            */
/* -------------------------------------------------------------------------- */

/**
 * The crescent alone.
 *
 * Separate from the multi-placemark file for a specific reason: parseKmz runs
 * pointOnFeature across the WHOLE collection and returns a point on one member
 * of it. Asserting "the point is inside the crescent" against a file with five
 * placemarks would be asserting which member turf happened to pick, which is
 * not a promise the parser makes. With one placemark the claim is exact.
 */
const crescent = new JSZip();
add(crescent, 'ekalpur-crescent.kml', document('Ekalpur Crescent', placemark('Ekalpur Crescent', polygon(CRESCENT))));

const swapped = new JSZip();
add(swapped, 'gopalpur-transposed.kml', document('Gopalpur, transposed', placemark('Gopalpur Field 7', polygon(SWAPPED))));

const targets = [
  ['synthetic-parcels.kmz', parcels],
  ['synthetic-crescent.kmz', crescent],
  ['synthetic-swapped.kmz', swapped],
];

for (const [name, zip] of targets) {
  // Fixed compression level, alongside the fixed entry dates above, so
  // regenerating produces no diff unless the content actually changed.
  const bytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  writeFileSync(join(OUT_DIR, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}
