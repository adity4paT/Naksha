/**
 * Synthetic KMZ/KML fixtures.
 *
 * Everything here is invented. No real surveyed boundary is committed to this
 * repository — see the confidentiality rule in CLAUDE.md and the narrow
 * `!tests/fixtures/synthetic-*.kmz` exemption in .gitignore.
 */

import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

import type { DomParserLike } from '../parse';

/** xmldom stands in for the browser DOMParser under the node test env. */
export const testDomParser = new DOMParser() as unknown as DomParserLike;

/** Wrap coordinate text in a single-Placemark KML document. */
export function kmlWithPolygon(coordinates: string, extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${extra}
    <Placemark>
      <name>Synthetic parcel</name>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>
        ${coordinates}
      </coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>`;
}

/** A KML with no geometry at all — styles and folders only. */
export const kmlWithoutGeometry = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Style id="s"><LineStyle><width>2</width></LineStyle></Style>
    <Folder><name>Empty</name></Folder>
  </Document>
</kml>`;

/**
 * A square well inside India. lng,lat order, as KML requires.
 */
export const SQUARE_COORDS = '75,20,0 76,20,0 76,21,0 75,21,0 75,20,0';

/**
 * A C-shaped parcel: concave enough that its vertex mean falls in the notch,
 * outside the polygon. This is the shape that makes pointOnFeature necessary.
 *
 *   lng 72..78, lat 18..24, with a bite taken out of lng 74..78, lat 20..22.
 */
export const C_SHAPED_COORDS = [
  '72,18,0',
  '78,18,0',
  '78,20,0',
  '74,20,0',
  '74,22,0',
  '78,22,0',
  '78,24,0',
  '72,24,0',
  '72,18,0',
].join(' ');

/** The same square with latitude and longitude transposed. */
export const SWAPPED_COORDS = '20,75,0 20,76,0 21,76,0 21,75,0 20,75,0';

/** Coordinates in Brazil — out of range, and still out of range when swapped. */
export const FOREIGN_COORDS = '-47,-15,0 -46,-15,0 -46,-14,0 -47,-14,0 -47,-15,0';

/** Build a .kmz Blob from a map of archive paths to file contents. */
export async function makeKmz(entries: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob' });
}

/** A plain .kml Blob. */
export function makeKml(content: string): Blob {
  return new Blob([content], { type: 'application/vnd.google-earth.kml+xml' });
}

/**
 * Ray-casting point-in-polygon, so the pointOnFeature test proves containment
 * rather than asserting it. Deliberately independent of turf.
 */
export function pointInRing(
  point: readonly [number, number],
  ring: readonly (readonly [number, number])[],
): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Parse the C-shape fixture back into a ring for the containment check. */
export const C_SHAPED_RING: readonly (readonly [number, number])[] = C_SHAPED_COORDS
  .split(' ')
  .map((triple) => {
    const [lng, lat] = triple.split(',').map(Number);
    return [lng as number, lat as number] as const;
  });
