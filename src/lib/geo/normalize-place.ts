/**
 * Place-name normalization for boundary matching.
 *
 * Distinct from `ingest/normalize.ts`, and deliberately more aggressive. Ingest
 * normalization must preserve enough of a header to keep two different columns
 * apart; this one only has to make two spellings of the same *place* collide,
 * so it can strip punctuation that ingest has to keep.
 *
 * `'S.P.S. Nellore'` and `'SPS Nellore'` must reduce to the same key, which is
 * why periods go. `'Jammu & Kashmir'` and `'Jammu and Kashmir'` must too, which
 * is why `&` becomes `and`.
 */

/** Unicode whitespace, as a character class. See ingest/normalize.ts for the trap. */
const UNICODE_WHITESPACE = /[   -   　﻿​-‍]/g;

/**
 * Punctuation removed entirely.
 *
 * Periods are the important ones: the boundary file writes `'S.P.S. Nellore'`
 * while every spreadsheet in the world writes `'SPSR Nellore'` or
 * `'SPS Nellore'`. Hyphens and apostrophes go for the same reason —
 * `'Vav-Tharad'` against `'Vav Tharad'`.
 */
const PUNCTUATION = /[.,;:'’`"“”()[\]{}\\/|!?*#_-]/g;

/**
 * Normalize a place name to a matching key.
 *
 * Pipeline: Unicode whitespace → space, `&` → `and`, punctuation removed,
 * whitespace collapsed, lowercased, trimmed.
 *
 * Examples that matter in this dataset:
 * ```
 * 'Nellore '      → 'nellore'
 * 'S.P.S. Nellore'     → 'sps nellore'
 * 'Jammu & Kashmir'    → 'jammu and kashmir'
 * 'Jammu and Kashmir'  → 'jammu and kashmir'
 * 'Rae Bareli'         → 'rae bareli'
 * 'Raibareli'          → 'raibareli'      (still distinct — needs an alias)
 * ```
 *
 * Note the last pair. Normalization removes *formatting* differences, never
 * *spelling* differences. `'Raibareli'` and `'Rae Bareli'` are genuinely
 * different strings and no amount of normalization should make them equal —
 * that is the alias table's job, and conflating the two responsibilities is
 * how a normalizer ends up quietly merging two real districts.
 *
 * Returns an empty string for input that normalizes to nothing, so callers can
 * test with a simple falsiness check.
 */
export function normalizePlaceName(input: string): string {
  return input
    .replace(UNICODE_WHITESPACE, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(PUNCTUATION, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Whether a value is usable as a place name at all.
 *
 * Guards the resolver against `null`, blanks, and the null-token strings the
 * ingest layer should already have removed — belt and braces, because a stray
 * `'-'` reaching the fuzzy matcher would score against every district in the
 * country.
 */
export function isResolvablePlaceName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizePlaceName(value);
  if (normalized.length === 0) return false;
  return !['na', 'n a', 'nil', 'none', 'null', 'nan', 'tbd', 'unknown'].includes(
    normalized,
  );
}
