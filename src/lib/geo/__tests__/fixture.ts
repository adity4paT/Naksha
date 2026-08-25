/**
 * Loads the real vendored boundary files from disk.
 *
 * Tests run against `public/geo/` itself, not a synthetic stand-in. That is what
 * makes them able to catch the failure that actually matters here: an alias
 * whose target does not exist in the boundary file. A mock index would happily
 * contain whatever the test author assumed was there.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AliasMap, BoundaryFeature, BoundaryIndex } from '..';
import { buildBoundaryIndex, parseAliasMap } from '..';

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));

const PUBLIC_GEO = '../../../../public/geo/';

let cachedIndex: BoundaryIndex | undefined;
let cachedAliases: { map: AliasMap; problems: readonly string[] } | undefined;

/** The real boundary index, built once and shared. */
export function boundaryIndex(): BoundaryIndex {
  if (cachedIndex === undefined) {
    const states = readJson(`${PUBLIC_GEO}india-states.geojson`) as {
      features: BoundaryFeature[];
    };
    const districts = readJson(`${PUBLIC_GEO}india-districts.geojson`) as {
      features: BoundaryFeature[];
    };
    cachedIndex = buildBoundaryIndex(states.features, districts.features);
  }
  return cachedIndex;
}

/** The real alias map. */
export function aliasMap(): AliasMap {
  cachedAliases ??= parseAliasMap(readJson(`${PUBLIC_GEO}aliases.json`));
  return cachedAliases.map;
}

/** Problems reported while parsing the real alias file. Should always be empty. */
export function aliasProblems(): readonly string[] {
  cachedAliases ??= parseAliasMap(readJson(`${PUBLIC_GEO}aliases.json`));
  return cachedAliases.problems;
}

/** The raw alias JSON, for tests that assert on the file's own structure. */
export function rawAliasFile(): {
  states: Record<string, string>;
  districts: { from: string; to: string; state?: string; note?: string }[];
} {
  return readJson(`${PUBLIC_GEO}aliases.json`) as ReturnType<typeof rawAliasFile>;
}

/** The build manifest. */
export function provenance(): Record<string, unknown> {
  return readJson(`${PUBLIC_GEO}provenance.json`) as Record<string, unknown>;
}
