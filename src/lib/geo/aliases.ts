/**
 * Alias map loading.
 *
 * `public/geo/aliases.json` is a static asset, never an import. That is what
 * makes it hot-reloadable: a user edits the file, reloads the page, and the new
 * mapping takes effect with no rebuild and no restart. Importing it would inline
 * it into the bundle and make every correction a deploy.
 */

import { normalizePlaceName } from './normalize-place';
import type { GeoFetcher } from './boundaries';
import { GEO_PATHS } from './boundaries';

/** One district alias as written in the JSON file. */
export interface DistrictAliasEntry {
  /** Spreadsheet spelling, in normalized form. */
  readonly from: string;
  /** Boundary name, spelled EXACTLY as the GeoJSON spells it. */
  readonly to: string;
  /**
   * Canonical parent state. When present the alias applies only to records
   * already resolved to that state.
   *
   * This is the field that stops `raigarh → Raigad` from relocating
   * Chhattisgarh records to Maharashtra. Any `from` that is also a real
   * district elsewhere MUST carry it.
   */
  readonly state?: string;
  /** Free text explaining the entry. Surfaced in the resolution report. */
  readonly note?: string;
}

/** The parsed file. */
export interface AliasMap {
  readonly version: number;
  /** Normalized spreadsheet spelling → canonical state name. */
  readonly states: ReadonlyMap<string, string>;
  /** Normalized spelling → entries. Multiple entries mean state-scoped variants. */
  readonly districts: ReadonlyMap<string, readonly DistrictAliasEntry[]>;
}

/** An alias map with nothing in it. Used when the file is absent or unreadable. */
export const EMPTY_ALIAS_MAP: AliasMap = {
  version: 0,
  states: new Map(),
  districts: new Map(),
};

interface RawAliasFile {
  version?: unknown;
  states?: unknown;
  districts?: unknown;
}

/**
 * Parse the raw JSON into lookup maps.
 *
 * Tolerant by design. A hand-edited file WILL sometimes be malformed, and the
 * failure mode has to be "that entry is ignored", not "the map does not load".
 * Malformed entries are reported through {@link AliasParseResult.problems} so
 * the UI can show them rather than dropping them silently.
 *
 * `from` keys are re-normalized on load, so an entry written as `'Gurgoan'`
 * works even though the file documents lowercase. `to` values are NEVER
 * normalized — they must match the GeoJSON exactly, punctuation included, which
 * is why `'S.P.S. Nellore'` keeps its periods.
 */
export function parseAliasMap(raw: unknown): AliasParseResult {
  const problems: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return { map: EMPTY_ALIAS_MAP, problems: ['aliases.json is not an object'] };
  }

  const file = raw as RawAliasFile;
  const states = new Map<string, string>();
  const districts = new Map<string, DistrictAliasEntry[]>();

  if (file.states !== undefined) {
    if (typeof file.states !== 'object' || file.states === null) {
      problems.push('"states" is not an object; ignored');
    } else {
      for (const [from, to] of Object.entries(file.states as Record<string, unknown>)) {
        if (typeof to !== 'string' || to.trim().length === 0) {
          problems.push(`state alias "${from}" has a non-string target; ignored`);
          continue;
        }
        states.set(normalizePlaceName(from), to.trim());
      }
    }
  }

  if (file.districts !== undefined) {
    if (!Array.isArray(file.districts)) {
      problems.push('"districts" is not an array; ignored');
    } else {
      for (const [index, value] of file.districts.entries()) {
        const entry = value as Partial<DistrictAliasEntry>;

        if (typeof entry?.from !== 'string' || typeof entry?.to !== 'string') {
          problems.push(`district alias #${index} is missing "from" or "to"; ignored`);
          continue;
        }

        const key = normalizePlaceName(entry.from);
        if (key.length === 0) {
          problems.push(`district alias #${index} has an empty "from"; ignored`);
          continue;
        }

        const parsed: DistrictAliasEntry = {
          from: key,
          to: entry.to.trim(),
          ...(typeof entry.state === 'string' && entry.state.trim().length > 0
            ? { state: entry.state.trim() }
            : {}),
          ...(typeof entry.note === 'string' ? { note: entry.note } : {}),
        };

        const bucket = districts.get(key);
        if (bucket === undefined) districts.set(key, [parsed]);
        else bucket.push(parsed);
      }
    }
  }

  // State-scoped entries are sorted ahead of unscoped ones within each key, so
  // the resolver's "most specific wins" rule is a simple find() rather than a
  // second pass. Without this, an unscoped alias declared earlier in the file
  // would shadow a scoped one declared later — order in a hand-edited file
  // should not change behaviour.
  for (const bucket of districts.values()) {
    bucket.sort((a, b) => Number(b.state !== undefined) - Number(a.state !== undefined));
  }

  return {
    map: {
      version: typeof file.version === 'number' ? file.version : 0,
      states,
      districts,
    },
    problems,
  };
}

/** Parse outcome, including anything that had to be skipped. */
export interface AliasParseResult {
  readonly map: AliasMap;
  readonly problems: readonly string[];
}

/**
 * Fetch and parse the alias map.
 *
 * A missing or unreadable file is NOT fatal — it degrades to an empty map, and
 * resolution continues with stages 1, 3, and 4. The alias table is a correction
 * layer, and losing it should cost accuracy, not availability.
 */
export async function loadAliasMap(
  fetcher?: GeoFetcher,
  path: string = GEO_PATHS.aliases,
): Promise<AliasParseResult> {
  const load: GeoFetcher =
    fetcher ??
    (async (target) => {
      // `cache: 'no-cache'` revalidates on every load. Without it a browser
      // will happily serve a stale alias file from disk cache, and the "edit
      // and reload" workflow this file exists for would appear not to work.
      const response = await fetch(target, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    });

  try {
    return parseAliasMap(await load(path));
  } catch (error) {
    return {
      map: EMPTY_ALIAS_MAP,
      problems: [
        `Could not load ${path}: ${error instanceof Error ? error.message : String(error)}. ` +
          `Continuing without aliases — expect more unresolved names.`,
      ],
    };
  }
}

/**
 * Look up a district alias, preferring a state-scoped entry.
 *
 * Resolution order:
 *   1. An entry whose `state` matches the resolved parent state.
 *   2. An entry with no `state` at all.
 *
 * An entry scoped to a *different* state is never returned. That is the rule
 * that keeps `raigarh` in Chhattisgarh unresolved rather than being relocated
 * to Maharashtra's Raigad.
 */
export function lookupDistrictAlias(
  map: AliasMap,
  normalizedName: string,
  canonicalState: string | null,
): DistrictAliasEntry | null {
  const bucket = map.districts.get(normalizedName);
  if (bucket === undefined) return null;

  if (canonicalState !== null) {
    const scoped = bucket.find((entry) => entry.state === canonicalState);
    if (scoped !== undefined) return scoped;
  }

  return bucket.find((entry) => entry.state === undefined) ?? null;
}

/** Look up a state alias. */
export function lookupStateAlias(map: AliasMap, normalizedName: string): string | null {
  return map.states.get(normalizedName) ?? null;
}
