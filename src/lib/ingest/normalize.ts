/**
 * String normalization — the only place {@link NormalizedKey} values are minted.
 *
 * Every rule here exists because of something real in the sample file. The
 * CLAUDE.md "Known dirt" list is the specification; this module is its
 * implementation, and `normalize.test.ts` asserts each case individually so a
 * future refactor cannot quietly drop one.
 *
 * What this module deliberately does NOT do is fix typos. `'NA/ Coversion Done'`
 * normalizes to a key that still reads "coversion", and `'Acers'` stays
 * misspelled. Header repair belongs at the matching layer, where a wrong guess
 * mislabels one column, rather than here, where it would fuse two genuinely
 * distinct production columns into one key and silently discard a column of data.
 */

import type { NormalizedKey } from '@/types/schema';

/**
 * Unicode whitespace that Excel round-trips into cells and headers.
 *
 * U+00A0 is the one that actually bites: `'Nellore '` looks identical to
 * `'Nellore'` in every UI, compares unequal to it, and would otherwise resolve
 * to a different district. The rest are included because they cost nothing and
 * appear in files that have passed through a web page or a CSV converter.
 */
const UNICODE_WHITESPACE = new RegExp(
  // The surrounding [ ] are load-bearing. Joined without them these become a
  // literal sequence rather than an alternation, and the pattern then matches
  // only a string containing every one of these characters in this exact order
  // — i.e. nothing. `String.prototype.trim` hides that failure for a *trailing*
  // NBSP, because JS treats U+00A0 as whitespace, so the bug survives the
  // obvious test and shows up only on interior NBSP and on ZWSP, which trim
  // does not touch.
  `[${[
    '\\u00A0', // no-break space — present in the sample, in 'Nellore '
    '\\u1680', // ogham space mark
    '\\u2000-\\u200A', // en quad … hair space
    '\\u202F', // narrow no-break space
    '\\u205F', // medium mathematical space
    '\\u3000', // ideographic space
    '\\uFEFF', // zero-width no-break space / BOM
    '\\u200B-\\u200D', // zero-width space, non-joiner, joiner
  ].join('')}]`,
  'g',
);

/** Characters stripped from the end of a normalized key. */
const TRAILING_PUNCTUATION = /[\s:;,.\-_/|*#]+$/;

/** Characters stripped from the start of a normalized key. */
const LEADING_PUNCTUATION = /^[\s:;,.\-_|*#]+/;

/**
 * Collapse Unicode whitespace to ordinary spaces and trim.
 *
 * The base cleaner for every string that enters the app, header or value.
 * Applied before any comparison, so `'Goa '`, `'Mumbai '`, `'Kutch '`,
 * `'Nagpur '`, and `'Nellore '` all reduce to their bare names.
 *
 * Returns `null` for input that is empty or whitespace-only, because a cell
 * containing only a space carries no more information than an absent one.
 */
export function cleanString(input: string): string | null {
  const collapsed = input
    .replace(UNICODE_WHITESPACE, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * Reduce a header string to its lookup key.
 *
 * Pipeline: Unicode whitespace → spaces, CR/LF/tab → spaces, runs collapsed,
 * trimmed, lowercased, then leading and trailing punctuation stripped.
 *
 * Worked examples from the sample, both of which must survive:
 *
 * ```
 * 'Used Land '                      → 'used land'
 * 'NA/ Coversion Done\r\n(Acers) '  → 'na/ coversion done (acers)'
 * 'Sr No '                          → 'sr no'
 * 'Utilization percentage(%)'       → 'utilization percentage(%)'
 * ```
 *
 * Note what survives: internal `/`, `(`, `)`, and `%`. Stripping those would
 * collapse `'NA/CLU Not require (acres)'` and `'NA/CLU Pending (acres)'` toward
 * each other, and they are different columns. Only *trailing* punctuation goes,
 * which is what removes the dangling space-and-nothing from `'Sr No '`.
 *
 * Returns `null` for a header cell with no text — the sample's columns 27 and
 * 28. Callers decide whether to synthesize a key or discard the column.
 */
export function normalizeHeader(header: string): NormalizedKey | null {
  const cleaned = cleanString(header);
  if (cleaned === null) return null;

  const key = cleaned
    .toLowerCase()
    .replace(TRAILING_PUNCTUATION, '')
    .replace(LEADING_PUNCTUATION, '');

  return key.length === 0 ? null : (key as NormalizedKey);
}

/**
 * Mint a key for a column whose header cell was blank but which holds data.
 *
 * Positional and therefore unstable across files — a column inserted upstream
 * shifts it. That is acceptable only because such a column has no name to be
 * stable by. The `__col_` prefix keeps it from ever colliding with a real
 * header, since {@link normalizeHeader} strips leading punctuation.
 */
export function synthesizeKey(columnIndex: number): NormalizedKey {
  return `__col_${columnIndex}` as NormalizedKey;
}

/**
 * Disambiguate a key that another column already claimed.
 *
 * Two headers can normalize to the same key legitimately — `'Total Area'` and
 * `'Total Area '` differ only by the trailing space this module strips. The
 * later column gets a `__2` suffix rather than overwriting the earlier one,
 * because silently dropping a column of data is the worse failure. The caller
 * raises a `duplicate-normalized-key` warning so the collision stays visible.
 */
export function disambiguateKey(key: NormalizedKey, occurrence: number): NormalizedKey {
  return `${key}__${occurrence}` as NormalizedKey;
}

/**
 * Escape hatch for tests and for code that has independently established a
 * string is already normalized.
 *
 * Not exported from the module's public entry point. Production code should
 * obtain keys from {@link normalizeHeader} or from a
 * {@link import('@/types/schema').ColumnDescriptor}, never by asserting one here.
 */
export function unsafeKey(value: string): NormalizedKey {
  return value as NormalizedKey;
}
