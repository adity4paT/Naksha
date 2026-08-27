/**
 * Handing a stored boundary back to the user.
 *
 * DOWNLOAD, NOT NAVIGATE. The bytes go out through an object URL on a
 * temporary anchor carrying a `download` attribute, and the URL is revoked
 * immediately after. Navigating to the blob instead would leave the browser to
 * guess what to do with a binary it half-recognises — usually rendering
 * mojibake in a new tab — and would strip the filename, which is the part that
 * makes the file openable.
 *
 * The MIME type is what makes the rest work. Google Earth Pro registers itself
 * for application/vnd.google-earth.kmz on install, so a correctly typed blob
 * with a .kmz filename opens in Earth Pro with the parcel drawn. Serving the
 * same bytes as application/octet-stream gets a file the OS will not associate
 * with anything.
 */

import { kmzStore } from './store';
import type { SiteKey } from '@/types/schema';

/** Registered media types. The whole download flow depends on getting these right. */
export const KMZ_MIME = 'application/vnd.google-earth.kmz';
export const KML_MIME = 'application/vnd.google-earth.kml+xml';

/** Extension of the original upload, lowercased, defaulting to .kmz. */
export function extensionOf(filename: string): '.kmz' | '.kml' {
  return /\.kml$/i.test(filename) ? '.kml' : '.kmz';
}

export const mimeFor = (extension: '.kmz' | '.kml'): string =>
  extension === '.kml' ? KML_MIME : KMZ_MIME;

/**
 * Make a site name safe as a filename on Windows, macOS and Linux at once.
 *
 * Windows is the strict one and the one that matters here: it rejects
 * <>:"/\|?* outright, treats a trailing dot or space as a silent truncation,
 * and reserves device names like CON and LPT1 regardless of extension. Site
 * names in this data are free text typed into a spreadsheet, so all of those
 * are reachable.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows discards these silently rather than erroring, which would turn
    // "Plot 42." into "Plot 42" and quietly collide with a real neighbour.
    .replace(/[. ]+$/, '');

  if (cleaned.length === 0) return 'boundary';

  // Reserved DOS device names, with or without an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return `${cleaned}_`;

  // Long names are truncated rather than rejected: most filesystems cap a
  // single component at 255 bytes, and a site name plus extension can exceed it.
  return cleaned.slice(0, 120);
}

/** The filename handed to the browser: sanitized site name, original extension. */
export function downloadNameFor(siteLabel: string, storedFilename: string): string {
  return `${sanitizeFilename(siteLabel)}${extensionOf(storedFilename)}`;
}

export interface ShowKmzResult {
  readonly ok: boolean;
  readonly filename: string | null;
  readonly error: string | null;
}

/**
 * Read the stored bytes and hand them to the browser as a download.
 *
 * Re-wrapped in a new Blob purely to set the media type — the underlying bytes
 * are passed through untouched, never re-encoded. This is the read side of the
 * promise the store makes.
 */
export async function showKmz(siteKey: SiteKey, siteLabel: string): Promise<ShowKmzResult> {
  let record;
  try {
    record = await kmzStore.get(siteKey);
  } catch (error) {
    return { ok: false, filename: null, error: (error as Error).message };
  }

  if (record === null) {
    return { ok: false, filename: null, error: 'No KMZ is attached to this site.' };
  }

  const extension = extensionOf(record.filename);
  const filename = downloadNameFor(siteLabel, record.filename);
  const typed = new Blob([record.bytes], { type: mimeFor(extension) });
  const url = URL.createObjectURL(typed);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    // Appended before clicking: Firefox ignores a click on an anchor that is
    // not in the document.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked in a finally so a throw between create and click cannot leak the
    // URL — and with it a reference keeping the whole Blob alive in memory.
    URL.revokeObjectURL(url);
  }

  return { ok: true, filename, error: null };
}

/* -------------------------------------------------------------------------- */
/* Google Earth Web                                                            */
/* -------------------------------------------------------------------------- */

/** Free Google Earth Pro download page, for the one-time hint. */
export const EARTH_PRO_URL = 'https://www.google.com/earth/about/versions/#earth-pro';

/**
 * Deep link to a location in Google Earth Web.
 *
 * Shows the LOCATION only. The boundary is not sent and cannot be — this is a
 * camera position, nothing more. Presenting it as equivalent to Show KMZ would
 * be a lie a user only discovers after squinting at an empty hillside.
 *
 * Note what this URL costs: it puts a real surveyed coordinate into a
 * third-party request. CLAUDE.md forbids sending site or place names to third
 * parties, and a precise coordinate is strictly more identifying than a name.
 * So the caller must gate it behind an explicit confirmation that says what
 * gets sent — see the consent helper in the UI layer. This function only builds
 * the string; it deliberately does not open anything.
 */
export function earthWebUrlFor(lat: number, lng: number): string {
  return `https://earth.google.com/web/@${lat},${lng},0a,2000d,35y,0h,0t,0r`;
}
