import { describe, expect, it } from 'vitest';

import {
  KML_MIME,
  KMZ_MIME,
  downloadNameFor,
  earthWebUrlFor,
  extensionOf,
  mimeFor,
  sanitizeFilename,
} from '../download';

describe('media types', () => {
  it('maps each extension to the type Google Earth registers for', () => {
    expect(mimeFor('.kmz')).toBe(KMZ_MIME);
    expect(mimeFor('.kml')).toBe(KML_MIME);
    // The exact strings matter: the OS file association is keyed on them, and
    // application/octet-stream would produce a file nothing opens.
    expect(KMZ_MIME).toBe('application/vnd.google-earth.kmz');
    expect(KML_MIME).toBe('application/vnd.google-earth.kml+xml');
  });

  it('reads the extension case-insensitively and defaults to .kmz', () => {
    expect(extensionOf('survey.KML')).toBe('.kml');
    expect(extensionOf('survey.kmz')).toBe('.kmz');
    expect(extensionOf('survey')).toBe('.kmz');
  });
});

describe('sanitizeFilename', () => {
  it('strips characters Windows rejects outright', () => {
    expect(sanitizeFilename('Plot 42: North/South')).toBe('Plot 42 North South');
    expect(sanitizeFilename('a<b>c:d"e|f?g*h')).toBe('a b c d e f g h');
  });

  it('removes a trailing dot or space, which Windows drops silently', () => {
    // Left in place, "Plot 42." would be saved as "Plot 42" and collide with a
    // genuinely different site.
    expect(sanitizeFilename('Plot 42.')).toBe('Plot 42');
    expect(sanitizeFilename('Plot 42   ')).toBe('Plot 42');
  });

  it('escapes reserved DOS device names', () => {
    expect(sanitizeFilename('CON')).toBe('CON_');
    expect(sanitizeFilename('lpt1')).toBe('lpt1_');
  });

  it('falls back rather than producing an empty name', () => {
    expect(sanitizeFilename('///')).toBe('boundary');
    expect(sanitizeFilename('   ')).toBe('boundary');
  });

  it('truncates a name too long for a filesystem component', () => {
    expect(sanitizeFilename('x'.repeat(400))).toHaveLength(120);
  });
});

describe('downloadNameFor', () => {
  it('uses the site name with the stored extension', () => {
    expect(downloadNameFor('Riverside Plot', 'north-boundary.kmz')).toBe(
      'Riverside Plot.kmz',
    );
    expect(downloadNameFor('Riverside Plot', 'north-boundary.KML')).toBe(
      'Riverside Plot.kml',
    );
  });

  it('sanitizes the site name, not the stored filename', () => {
    expect(downloadNameFor('Plot 42/A', 'x.kmz')).toBe('Plot 42 A.kmz');
  });
});

describe('earthWebUrlFor', () => {
  it('builds the documented camera URL', () => {
    expect(earthWebUrlFor(21.5, 75.25)).toBe(
      'https://earth.google.com/web/@21.5,75.25,0a,2000d,35y,0h,0t,0r',
    );
  });

  it('is a location link only — no boundary can travel in it', () => {
    const url = earthWebUrlFor(21.5, 75.25);
    expect(url).not.toMatch(/kmz|kml|boundary/i);
  });
});
