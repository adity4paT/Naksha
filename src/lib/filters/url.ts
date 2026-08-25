/**
 * Filter state ↔ URL query string.
 *
 * ## The whitelist is enforced structurally
 *
 * {@link SERIALIZABLE_KEYS} is the complete set of parameters this module will
 * read or write. Serialization iterates that list; deserialization ignores
 * everything not on it. There is no path by which a record, a measure value, or
 * anything else row-level reaches the URL, because nothing but these keys is
 * ever consulted.
 *
 * ## A confidentiality note worth reading
 *
 * A shareable filtered view necessarily encodes WHICH places and sites are
 * being looked at — that is what makes it shareable. So these URLs contain
 * state, district, and site names from commercial land-holding data, and should
 * be treated as carrying the same sensitivity as the data itself: they land in
 * browser history, in any chat they are pasted into, and in the referer header
 * of any external link clicked from the page.
 *
 * Nothing is transmitted by this module — it writes to `history.replaceState`,
 * which is local. But the resulting string is not innocuous, and a user
 * pasting it somewhere public is disclosing site names.
 *
 * Selection VALUES are unavoidable if the feature is to work. Selection
 * *counts*, acreages, and measure figures are not, and none appear.
 */

import type { FilterSelections, RangeSelection } from './types';
import { EMPTY_SELECTIONS } from './types';

/**
 * Every query parameter this module touches. The whitelist.
 *
 * Short keys because a district selection can run to dozens of names and URLs
 * have practical length limits — see {@link URL_LENGTH_BUDGET}.
 */
export const SERIALIZABLE_KEYS = {
  business: 'b',
  state: 's',
  district: 'd',
  site: 'si',
  ranges: 'r',
  measure: 'm',
  binning: 'bm',
  bins: 'bc',
  scale: 'sk',
} as const;

/** Everything the URL round-trips. */
export interface SerializableViewState {
  readonly selections: FilterSelections;
  readonly measureKey: string | null;
  readonly binningMethod: string | null;
  readonly binCount: number | null;
  readonly scaleKind: string | null;
}

/**
 * Practical URL ceiling.
 *
 * Browsers tolerate far more, but ~2,000 characters is where proxies, chat
 * clients, and mail gateways start truncating. Truncation is the dangerous
 * failure: a silently shortened URL restores a DIFFERENT filter state that
 * still looks plausible. Past this budget, serialization drops the largest
 * selection and flags it rather than emitting a string that may not survive.
 */
export const URL_LENGTH_BUDGET = 2000;

/** Multi-value separator. `~` is not used in any place name in this dataset. */
const SEP = '~';

const encodeList = (values: readonly string[]): string =>
  values.map((v) => encodeURIComponent(v)).join(SEP);

const decodeList = (raw: string | null): string[] =>
  raw === null || raw.length === 0
    ? []
    : raw
        .split(SEP)
        .map((v) => {
          try {
            return decodeURIComponent(v);
          } catch {
            // A hand-edited or truncated URL can carry a broken escape. Drop
            // that value rather than throwing away the whole filter state.
            return '';
          }
        })
        .filter((v) => v.length > 0);

const encodeRanges = (ranges: Readonly<Record<string, RangeSelection>>): string =>
  Object.entries(ranges)
    .map(([key, range]) => `${encodeURIComponent(key)}:${range.min}:${range.max}`)
    .join(SEP);

function decodeRanges(raw: string | null): Record<string, RangeSelection> {
  if (raw === null || raw.length === 0) return {};
  const ranges: Record<string, RangeSelection> = {};

  for (const part of raw.split(SEP)) {
    const pieces = part.split(':');
    if (pieces.length !== 3) continue;

    const [rawKey, rawMin, rawMax] = pieces;
    const min = Number(rawMin);
    const max = Number(rawMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) continue;

    try {
      ranges[decodeURIComponent(rawKey!)] = { min, max };
    } catch {
      // Same reasoning as decodeList: skip the malformed entry.
    }
  }

  return ranges;
}

/** Serialize view state to a query string, without the leading `?`. */
export function serializeToQuery(state: SerializableViewState): {
  query: string;
  truncated: readonly string[];
} {
  const { selections } = state;
  const truncated: string[] = [];

  const build = (current: FilterSelections): string => {
    const params = new URLSearchParams();

    if (current.business.length > 0) {
      params.set(SERIALIZABLE_KEYS.business, encodeList(current.business));
    }
    if (current.state.length > 0) {
      params.set(SERIALIZABLE_KEYS.state, encodeList(current.state));
    }
    if (current.district.length > 0) {
      params.set(SERIALIZABLE_KEYS.district, encodeList(current.district));
    }
    if (current.site.length > 0) {
      params.set(SERIALIZABLE_KEYS.site, encodeList(current.site));
    }
    if (Object.keys(current.ranges).length > 0) {
      params.set(SERIALIZABLE_KEYS.ranges, encodeRanges(current.ranges));
    }
    if (state.measureKey !== null) params.set(SERIALIZABLE_KEYS.measure, state.measureKey);
    if (state.binningMethod !== null) {
      params.set(SERIALIZABLE_KEYS.binning, state.binningMethod);
    }
    if (state.binCount !== null) params.set(SERIALIZABLE_KEYS.bins, String(state.binCount));
    if (state.scaleKind !== null) params.set(SERIALIZABLE_KEYS.scale, state.scaleKind);

    return params.toString();
  };

  let working: FilterSelections = selections;
  let query = build(working);

  // Drop the largest selection list until the string fits. Dropping is visible
  // — the caller surfaces `truncated` — because a filter that silently fails to
  // travel is worse than one the user is told did not fit.
  while (query.length > URL_LENGTH_BUDGET) {
    const largest = (['site', 'district', 'state', 'business'] as const)
      .map((key) => ({ key, size: working[key].length }))
      .sort((a, b) => b.size - a.size)[0];

    if (largest === undefined || largest.size === 0) break;

    truncated.push(largest.key);
    working = { ...working, [largest.key]: [] };
    query = build(working);
  }

  return { query, truncated };
}

/**
 * Parse view state out of a query string.
 *
 * Never throws. A malformed or hand-edited URL yields whatever could be read
 * and defaults for the rest — the alternative is a blank page from a bad link.
 */
export function parseFromQuery(query: string): SerializableViewState {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);

  const readNumber = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  return {
    selections: {
      ...EMPTY_SELECTIONS,
      business: decodeList(params.get(SERIALIZABLE_KEYS.business)),
      state: decodeList(params.get(SERIALIZABLE_KEYS.state)),
      district: decodeList(params.get(SERIALIZABLE_KEYS.district)),
      site: decodeList(params.get(SERIALIZABLE_KEYS.site)),
      ranges: decodeRanges(params.get(SERIALIZABLE_KEYS.ranges)),
    },
    measureKey: params.get(SERIALIZABLE_KEYS.measure),
    binningMethod: params.get(SERIALIZABLE_KEYS.binning),
    binCount: readNumber(SERIALIZABLE_KEYS.bins),
    scaleKind: params.get(SERIALIZABLE_KEYS.scale),
  };
}

/**
 * Push state into the address bar without navigating.
 *
 * `replaceState`, not `pushState`: filter changes are continuous, and a history
 * entry per keystroke would make the back button useless for leaving the page.
 *
 * Non-whitelisted parameters already in the URL are preserved, so this can
 * coexist with anything else that uses the query string.
 */
export function writeToLocation(state: SerializableViewState): readonly string[] {
  if (typeof window === 'undefined') return [];

  const { query, truncated } = serializeToQuery(state);

  const existing = new URLSearchParams(window.location.search);
  const whitelist = new Set<string>(Object.values(SERIALIZABLE_KEYS));
  const merged = new URLSearchParams(query);

  for (const [key, value] of existing) {
    if (!whitelist.has(key)) merged.set(key, value);
  }

  const next = merged.toString();
  const url = `${window.location.pathname}${next.length > 0 ? `?${next}` : ''}${window.location.hash}`;

  window.history.replaceState(window.history.state, '', url);
  return truncated;
}

/** Read view state from the current address bar. */
export function readFromLocation(): SerializableViewState {
  if (typeof window === 'undefined') {
    return {
      selections: EMPTY_SELECTIONS,
      measureKey: null,
      binningMethod: null,
      binCount: null,
      scaleKind: null,
    };
  }
  return parseFromQuery(window.location.search);
}
