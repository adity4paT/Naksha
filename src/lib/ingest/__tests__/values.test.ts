/**
 * Unit tests for cell cleaning and measure coercion.
 *
 * The null-vs-zero distinction gets the most coverage here, because it is the
 * one that decides whether the invariants can be trusted: coercing an absent
 * cell to 0 makes an unrecorded area indistinguishable from a recorded zero,
 * and lets a row pass the composition check that should have been flagged.
 */

import { describe, expect, it } from 'vitest';

import { cleanCell, isNullToken, parseMeasure, primitiveTypeOf } from '../values';

describe('cleanCell', () => {
  it('cleans strings and preserves real values', () => {
    expect(cleanCell('Bhadrak')).toBe('Bhadrak');
    expect(cleanCell('Goa ')).toBe('Goa');
    expect(cleanCell('Nellore ')).toBe('Nellore');
  });

  it('passes finite numbers through, including a genuine zero', () => {
    expect(cleanCell(2476)).toBe(2476);
    expect(cleanCell(0)).toBe(0);
    expect(cleanCell(-5.5)).toBe(-5.5);
  });

  it('rejects non-finite numbers rather than propagating them', () => {
    expect(cleanCell(Number.NaN)).toBeNull();
    expect(cleanCell(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('maps null-equivalent tokens to null, NOT to zero', () => {
    for (const token of ['', '   ', '-', '--', 'NA', 'N/A', 'n/a', 'NIL', '#N/A', 'TBD']) {
      expect(cleanCell(token), `token ${JSON.stringify(token)}`).toBeNull();
    }
  });

  it('preserves dates and rejects invalid ones', () => {
    const date = new Date('2024-03-15T00:00:00Z');
    expect(cleanCell(date)).toBe(date);
    expect(cleanCell(new Date('nonsense'))).toBeNull();
  });

  it('refuses to stringify unrecognised input', () => {
    expect(cleanCell({})).toBeNull();
    expect(cleanCell([])).toBeNull();
    expect(cleanCell(undefined)).toBeNull();
  });
});

describe('isNullToken', () => {
  it("treats a bare '-' as null but never a negative number", () => {
    expect(isNullToken('-')).toBe(true);
    expect(isNullToken('-5')).toBe(false);
    expect(isNullToken('-0.5')).toBe(false);
  });

  it('matches whole strings only, never substrings', () => {
    // 'NA' is a null token; a header containing it is not.
    expect(isNullToken('NA')).toBe(true);
    expect(isNullToken('NA/CLU Pending')).toBe(false);
    expect(isNullToken('Nagpur')).toBe(false);
  });
});

describe('parseMeasure', () => {
  it('passes real numbers through untouched', () => {
    expect(parseMeasure(2476)).toBe(2476);
    expect(parseMeasure(0)).toBe(0);
    expect(parseMeasure(1234.567)).toBe(1234.567);
  });

  it('parses plain numeric strings', () => {
    expect(parseMeasure('2476')).toBe(2476);
    expect(parseMeasure('  1520.5  ')).toBe(1520.5);
    expect(parseMeasure('.5')).toBe(0.5);
  });

  it('strips Western and Indian digit grouping', () => {
    expect(parseMeasure('1,234')).toBe(1234);
    expect(parseMeasure('12,34,567')).toBe(1234567);
    expect(parseMeasure('1,00,000')).toBe(100000);
  });

  it('strips currency symbols', () => {
    expect(parseMeasure('₹1,25,000')).toBe(125000);
    expect(parseMeasure('$4,500')).toBe(4500);
    expect(parseMeasure('Rs. 3,200')).toBe(3200);
  });

  it('strips unit words, longest form first', () => {
    expect(parseMeasure('2476 acres')).toBe(2476);
    expect(parseMeasure('2476 acre')).toBe(2476);
    expect(parseMeasure('35 ac')).toBe(35);
    expect(parseMeasure('12.5 hectares')).toBe(12.5);
    expect(parseMeasure('12.5 ha')).toBe(12.5);
  });

  it('reads percent at face value, matching the column that declares it', () => {
    expect(parseMeasure('85%')).toBe(85);
    expect(parseMeasure('61.4 %')).toBe(61.4);
  });

  it('reads accounting-style parentheses as negative', () => {
    expect(parseMeasure('(1,234)')).toBe(-1234);
    expect(parseMeasure('(50)')).toBe(-50);
  });

  it('returns null for null-equivalents, never zero', () => {
    for (const token of ['', '-', 'NA', 'N/A', 'nil', '#N/A', '   ']) {
      expect(parseMeasure(token), `token ${JSON.stringify(token)}`).toBeNull();
    }
  });

  it('rejects malformed numbers instead of salvaging a prefix', () => {
    // parseFloat would read these as 12, 1.2, and 5 respectively — turning a
    // corrupt cell into a plausible figure that the invariants would then
    // silently sum.
    expect(parseMeasure('12abc')).toBeNull();
    expect(parseMeasure('1.2.3')).toBeNull();
    expect(parseMeasure('5 - 10')).toBeNull();
    expect(parseMeasure('approx 500')).toBeNull();
  });

  it('rejects booleans and dates, which are not quantities', () => {
    expect(parseMeasure(true)).toBeNull();
    expect(parseMeasure(new Date())).toBeNull();
  });
});

describe('primitiveTypeOf', () => {
  it('classifies each cell type', () => {
    expect(primitiveTypeOf('Bhadrak')).toBe('string');
    expect(primitiveTypeOf(42)).toBe('number');
    expect(primitiveTypeOf(true)).toBe('boolean');
    expect(primitiveTypeOf(new Date())).toBe('date');
    expect(primitiveTypeOf(null)).toBeNull();
  });
});
