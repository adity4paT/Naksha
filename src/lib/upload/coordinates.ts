/**
 * Detecting coordinate columns — to report them, never to use them.
 *
 * ## Why this module exists at all
 *
 * CLAUDE.md forbids per-site coordinates in V1: sites are located by their
 * district boundary and nothing else. So the correct handling of a workbook
 * that arrives carrying latitude and longitude is NOT to quietly ignore it —
 * a user who supplied coordinates and sees a district choropleth will
 * reasonably assume the app used them.
 *
 * Detecting and reporting them as **detected but unused** is the honest middle:
 * it tells the user we saw the columns, tells them we are not plotting from
 * them, and leaves V2 to handle real coordinates properly. Nothing in this
 * module produces geometry, and nothing downstream consumes its output beyond
 * the preview screen.
 *
 * There is no geocoding anywhere in this codebase and no external lookup of any
 * kind. This module reads column headers that are already in memory.
 */

import type { ColumnDescriptor, NormalizedKey } from '@/types/schema';

/** What kind of coordinate a column appears to hold. */
export type CoordinateKind = 'latitude' | 'longitude' | 'paired' | 'projected';

export interface CoordinateColumn {
  readonly key: NormalizedKey;
  readonly label: string;
  readonly kind: CoordinateKind;
  /** Non-null cells, so the preview can say whether it actually holds data. */
  readonly populatedCount: number;
}

/**
 * Header patterns, anchored to word boundaries.
 *
 * Substring matching is not safe here: `'long'` appears inside "Belonging" and
 * "Along", and `'lat'` inside "Plate" and "Related". Every pattern below
 * requires the token to stand alone, which is why they are regexes rather than
 * an `includes` list.
 */
const PATTERNS: readonly { kind: CoordinateKind; pattern: RegExp }[] = [
  { kind: 'latitude', pattern: /\blat(itude)?\b/ },
  { kind: 'longitude', pattern: /\blong(itude)?\b|\blng\b|\blon\b/ },
  {
    kind: 'paired',
    // The separator class includes `/` because "Lat/Long" is how spreadsheets
    // actually write this. Omitting it split the column into a latitude match
    // plus a longitude match, reporting one column twice.
    pattern: /\b(lat[\s_/-]?long(itude)?|latlng|coordinates?|geo[\s_/-]?point|wkt|geometry)\b/,
  },
  { kind: 'projected', pattern: /\b(easting|northing|utm|epsg|mgrs)\b/ },
];

/**
 * Find columns that look like coordinates.
 *
 * Ordered `paired` first so a `Lat/Long` column is reported once as a pair
 * rather than twice, as both a latitude and a longitude.
 */
export function detectCoordinateColumns(
  columns: readonly ColumnDescriptor[],
): readonly CoordinateColumn[] {
  const found: CoordinateColumn[] = [];

  for (const column of columns) {
    const haystack = column.normalizedKey.toLowerCase();

    const match =
      PATTERNS.find((entry) => entry.kind === 'paired' && entry.pattern.test(haystack)) ??
      PATTERNS.find((entry) => entry.pattern.test(haystack));

    if (match === undefined) continue;

    found.push({
      key: column.normalizedKey,
      label: column.displayLabel.trim(),
      kind: match.kind,
      populatedCount: column.rowCount - column.nullCount,
    });
  }

  return found;
}

/**
 * Message shown beside detected coordinates.
 *
 * Phrased to be unambiguous about the two things a user needs to know: we saw
 * them, and the map is not using them.
 */
export function coordinateNotice(columns: readonly CoordinateColumn[]): string {
  const populated = columns.filter((column) => column.populatedCount > 0);

  if (populated.length === 0) {
    return `${columns.length} coordinate column${columns.length === 1 ? '' : 's'} detected, all empty. Nothing is plotted from them.`;
  }

  return `${populated.length} coordinate column${populated.length === 1 ? '' : 's'} detected with data in ${populated.length === 1 ? 'it' : 'them'}. This version does NOT plot from coordinates — every site is placed by its district boundary. Surveyed positions arrive in V2.`;
}
