/**
 * Cell value cleaning and numeric coercion.
 *
 * The load-bearing rule in this file: an absent value becomes `null`, never `0`.
 * See {@link NULL_EQUIVALENT_TOKENS} for why that distinction decides whether
 * the invariants can be trusted.
 */

import {
  CURRENCY_SYMBOLS,
  MEASURE_STRIP_TOKENS,
  NULL_EQUIVALENT_TOKENS,
} from '@/lib/constants';
import type { CellPrimitiveType, CellValue } from '@/types/schema';
import { cleanString } from './normalize';

/** Case-folded null tokens, built once. */
const NULL_TOKEN_SET: ReadonlySet<string> = new Set(NULL_EQUIVALENT_TOKENS);

/**
 * Strip tokens ordered longest-first.
 *
 * Order is load-bearing: matching `'ac'` before `'acres'` leaves `'res'` behind
 * and turns a parseable cell into a failed one.
 */
const STRIP_TOKENS_BY_LENGTH: readonly string[] = [...MEASURE_STRIP_TOKENS].sort(
  (a, b) => b.length - a.length,
);

/** Accounting-style negatives: `(1,234)` means −1234. */
const PARENTHESISED_NEGATIVE = /^\((.*)\)$/;

/**
 * Digit grouping, both Western and Indian.
 *
 * Indian grouping is not uniform — `12,34,567` groups by two above the
 * thousands — so this removes any comma sitting between digits rather than
 * trying to validate the grouping pattern. A comma NOT between digits is left
 * in place, so a decimal comma like `'1,5'`… is also caught by the digit test,
 * which is why {@link parseMeasure} verifies the result rather than trusting it.
 */
const DIGIT_GROUPING = /(?<=\d),(?=\d)/g;

/** What remains must look like a number for the parse to be accepted. */
const NUMERIC_SHAPE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Remove one known unit or currency token from the given end of a string.
 *
 * Longest-first, and at most one token per end, so a value that is nothing but
 * unit words cannot be whittled down to a spurious empty parse.
 */
function stripToken(text: string, end: 'start' | 'end'): string {
  for (const token of STRIP_TOKENS_BY_LENGTH) {
    if (end === 'start' ? text.startsWith(token) : text.endsWith(token)) {
      const stripped =
        end === 'start' ? text.slice(token.length) : text.slice(0, -token.length);
      return stripped.trim();
    }
  }
  return text;
}

/**
 * Normalize any raw cell into a {@link CellValue}.
 *
 * Strings are whitespace-cleaned (which is what turns `'Nellore '` into
 * `'Nellore'`) and null-token-tested. Numbers pass through unless non-finite.
 * Dates pass through as `Date`. Everything unrecognised becomes `null` rather
 * than being coerced to a string, so a stray object cannot masquerade as data.
 */
export function cleanCell(raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw === 'boolean') return raw;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === 'string') {
    const cleaned = cleanString(raw);
    if (cleaned === null) return null;
    return isNullToken(cleaned) ? null : cleaned;
  }

  return null;
}

/**
 * Whether a cleaned string means "no value".
 *
 * Compared as a whole string, never as a substring: `'-'` is null but `'-5'` is
 * negative five, and `'NA'` is null but `'NA/CLU Pending'` is a header.
 */
export function isNullToken(cleaned: string): boolean {
  return NULL_TOKEN_SET.has(cleaned.toLowerCase());
}

/**
 * Coerce a cell to a number for a measure column, or `null` if it cannot be.
 *
 * Handles, in order: real numbers, accounting negatives `(123)`, currency
 * symbols, digit grouping, trailing unit words, and a trailing `%`.
 *
 * Percent is taken at face value — `'85%'` becomes `85`, not `0.85` — because
 * the sample's `Utilization percentage(%)` column is declared in percent by its
 * own header. Rescaling it here would make the number disagree with the column
 * it came from.
 *
 * Returns `null` rather than `0` for anything unparseable, and rather than
 * `NaN`, so callers cannot accidentally propagate a poisoned value into a sum.
 */
export function parseMeasure(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw === 'boolean') return null;
  if (raw instanceof Date) return null;
  if (typeof raw !== 'string') return null;

  const cleaned = cleanString(raw);
  if (cleaned === null || isNullToken(cleaned)) return null;

  let text = cleaned.toLowerCase();
  let negate = false;

  const parenthesised = PARENTHESISED_NEGATIVE.exec(text);
  if (parenthesised?.[1] !== undefined) {
    negate = true;
    text = parenthesised[1].trim();
  }

  for (const symbol of CURRENCY_SYMBOLS) {
    text = text.split(symbol).join('');
  }

  text = text.replace(DIGIT_GROUPING, '');

  if (text.endsWith('%')) {
    text = text.slice(0, -1).trim();
  }

  // Strip unit and currency words from BOTH ends. A leading form is just as
  // common as a trailing one — "Rs. 3,200" and "3,200 acres" are both ordinary
  // ways to write a figure in this data — and checking only the tail silently
  // turns the leading form into an unparseable cell.
  text = stripToken(text, 'start');
  text = stripToken(text, 'end');

  text = text.trim();
  if (text.length === 0) return null;

  // Verify the shape before parsing. `parseFloat` would happily read '12abc' as
  // 12 and '1.2.3' as 1.2, turning a malformed cell into a plausible number —
  // exactly the kind of silent corruption the invariants exist to catch.
  if (!NUMERIC_SHAPE.test(text)) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;

  return negate ? -parsed : parsed;
}

/** The primitive type of a populated cell, for column profiling. */
export function primitiveTypeOf(value: CellValue): CellPrimitiveType | null {
  if (value === null) return null;
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Stable key for distinct-value counting.
 *
 * Dates are keyed by epoch millis so two `Date` objects for the same instant
 * count once; everything else by its string form. Cleaning has already run, so
 * `'Kutch'` and `'Kutch '` have converged by the time they arrive here — which
 * is what makes the sample's district count come out right.
 */
export function distinctKeyOf(value: Exclude<CellValue, null>): string {
  if (value instanceof Date) return `d:${value.getTime()}`;
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'boolean') return `b:${value}`;
  return `s:${value}`;
}
