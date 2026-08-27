import { describe, expect, it } from 'vitest';

import { INDIA_BOUNDS, parseKmz } from '../parse';
import {
  C_SHAPED_COORDS,
  C_SHAPED_RING,
  FOREIGN_COORDS,
  SQUARE_COORDS,
  SWAPPED_COORDS,
  kmlWithPolygon,
  kmlWithoutGeometry,
  makeKml,
  makeKmz,
  pointInRing,
  testDomParser,
} from './fixture';

const opts = { domParser: testDomParser };

describe('root document discovery', () => {
  it('finds a root .kml that is not named doc.kml', async () => {
    const file = await makeKmz({ 'survey-2024.kml': kmlWithPolygon(SQUARE_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.status).toBe('parsed');
    expect(result.kmlEntryName).toBe('survey-2024.kml');
  });

  it('matches the .kml extension case-insensitively', async () => {
    const file = await makeKmz({ 'DOC.KML': kmlWithPolygon(SQUARE_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.status).toBe('parsed');
    expect(result.kmlEntryName).toBe('DOC.KML');
  });

  it('ignores nested .kml files and uses the one at the root', async () => {
    const file = await makeKmz({
      'files/nested.kml': kmlWithPolygon(FOREIGN_COORDS),
      'root.kml': kmlWithPolygon(SQUARE_COORDS),
    });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.kmlEntryName).toBe('root.kml');
    expect(result.status).toBe('parsed');
  });

  it('warns when several root documents exist and uses the first', async () => {
    const file = await makeKmz({
      'a.kml': kmlWithPolygon(SQUARE_COORDS),
      'b.kml': kmlWithPolygon(SQUARE_COORDS),
    });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.kmlEntryName).toBe('a.kml');
    expect(result.warnings.map((w) => w.code)).toContain('multiple-kml-entries');
  });

  it('reports an archive with no root .kml', async () => {
    const file = await makeKmz({ 'files/only-nested.kml': kmlWithPolygon(SQUARE_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.status).toBe('unparseable');
    expect(result.warnings.map((w) => w.code)).toContain('no-kml-entry');
  });
});

describe('bare .kml input', () => {
  it('parses a .kml that is not zipped', async () => {
    const result = await parseKmz(makeKml(kmlWithPolygon(SQUARE_COORDS)), 'plot.kml', opts);

    expect(result.status).toBe('parsed');
    expect(result.kmlEntryName).toBeNull();
  });

  it('notes a .kmz that turns out not to be a ZIP, and still reads it', async () => {
    const result = await parseKmz(makeKml(kmlWithPolygon(SQUARE_COORDS)), 'plot.kmz', opts);

    expect(result.status).toBe('parsed');
    expect(result.warnings.map((w) => w.code)).toContain('not-a-zip');
  });
});

describe('representative point', () => {
  it('returns a point INSIDE a concave parcel, which a centroid would not', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithPolygon(C_SHAPED_COORDS) });
    const result = await parseKmz(file, 'crescent.kmz', opts);

    expect(result.status).toBe('parsed');
    expect(result.centroid).not.toBeNull();

    const point = result.centroid as { lat: number; lng: number };
    expect(pointInRing([point.lng, point.lat], C_SHAPED_RING)).toBe(true);

    // Guard the guard: the naive vertex mean really is outside this shape, so
    // the assertion above is not passing by accident.
    const meanLng =
      C_SHAPED_RING.reduce((sum, [lng]) => sum + lng, 0) / C_SHAPED_RING.length;
    const meanLat =
      C_SHAPED_RING.reduce((sum, [, lat]) => sum + lat, 0) / C_SHAPED_RING.length;
    expect(pointInRing([meanLng, meanLat], C_SHAPED_RING)).toBe(false);
  });

  it('puts the point inside the India bounds for an in-range parcel', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithPolygon(SQUARE_COORDS) });
    const { centroid } = await parseKmz(file, 'plot.kmz', opts);

    expect(centroid).not.toBeNull();
    const point = centroid as { lat: number; lng: number };
    expect(point.lat).toBeGreaterThanOrEqual(INDIA_BOUNDS.minLat);
    expect(point.lat).toBeLessThanOrEqual(INDIA_BOUNDS.maxLat);
    expect(point.lng).toBeGreaterThanOrEqual(INDIA_BOUNDS.minLng);
    expect(point.lng).toBeLessThanOrEqual(INDIA_BOUNDS.maxLng);
  });
});

describe('coordinate validation', () => {
  it('detects a lat/lng transposition and says so', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithPolygon(SWAPPED_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.status).toBe('unparseable');
    expect(result.suspectedCoordinateSwap).toBe(true);

    const warning = result.warnings.find((w) => w.code === 'coordinates-out-of-range');
    expect(warning).toBeDefined();
    expect(warning?.message).toMatch(/transposed/i);
    expect(warning?.message).toMatch(/swap toggle/i);
  });

  it('parses the same file once the swap is applied', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithPolygon(SWAPPED_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', { ...opts, swapCoordinates: true });

    expect(result.status).toBe('parsed');
    const point = result.centroid as { lat: number; lng: number };
    expect(point.lat).toBeGreaterThanOrEqual(INDIA_BOUNDS.minLat);
    expect(point.lng).toBeGreaterThanOrEqual(INDIA_BOUNDS.minLng);
  });

  it('does not claim a swap for coordinates that are simply elsewhere', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithPolygon(FOREIGN_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.status).toBe('unparseable');
    expect(result.suspectedCoordinateSwap).toBe(false);
    const warning = result.warnings.find((w) => w.code === 'coordinates-out-of-range');
    expect(warning?.message).toMatch(/not a simple lat\/lng swap/i);
  });
});

describe('reported, never fetched', () => {
  it('warns about a NetworkLink without resolving it', async () => {
    const networkLink = `<NetworkLink><Link><href>https://example.invalid/live.kml</href></Link></NetworkLink>`;
    const file = await makeKmz({
      'doc.kml': kmlWithPolygon(SQUARE_COORDS, networkLink),
    });
    const result = await parseKmz(file, 'plot.kmz', opts);

    // Still parses: the local geometry is usable, the external part is not.
    expect(result.status).toBe('parsed');
    expect(result.warnings.map((w) => w.code)).toContain('network-link');
    expect(result.warnings.find((w) => w.code === 'network-link')?.message).toMatch(
      /not fetched/i,
    );
  });
});

describe('validity', () => {
  it('reports a document with no Placemark geometry', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithoutGeometry });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.status).toBe('unparseable');
    expect(result.warnings.map((w) => w.code)).toContain('no-placemark-geometry');
    expect(result.centroid).toBeNull();
  });

  it('never throws on a corrupt archive', async () => {
    const junk = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])]);
    const result = await parseKmz(junk, 'broken.kmz', opts);

    expect(result.status).toBe('unparseable');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('counts placemarks that carry geometry', async () => {
    const file = await makeKmz({ 'doc.kml': kmlWithPolygon(SQUARE_COORDS) });
    const result = await parseKmz(file, 'plot.kmz', opts);

    expect(result.placemarkCount).toBe(1);
  });
});
