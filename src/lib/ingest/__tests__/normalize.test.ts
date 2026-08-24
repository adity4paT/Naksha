/**
 * Unit tests for header and string normalization.
 *
 * Every case in CLAUDE.md's "Known dirt" list gets its own assertion, so a
 * regression names the specific piece of dirt it reintroduced rather than
 * failing an opaque aggregate count.
 *
 * Invisible characters are always written as escapes (` `), never as
 * literals. A literal NBSP in a source file is indistinguishable from a space
 * to a reviewer, which would make this suite look like it asserts something
 * far weaker than it does — and an expected value with a stray NBSP in it can
 * pass against a broken implementation.
 */

import { describe, expect, it } from 'vitest';

import { cleanString, disambiguateKey, normalizeHeader, synthesizeKey } from '../normalize';

const NBSP = ' ';
const ZWSP = '​';
const BOM = '﻿';
const NARROW_NBSP = ' ';

describe('cleanString', () => {
  it('strips ordinary trailing spaces seen in the sample values', () => {
    expect(cleanString('Goa ')).toBe('Goa');
    expect(cleanString('Mumbai ')).toBe('Mumbai');
    expect(cleanString('Kutch ')).toBe('Kutch');
    expect(cleanString('Nagpur ')).toBe('Nagpur');
  });

  it("cleans 'Nellore\\u00A0' — a NON-BREAKING space, not a regular one", () => {
    const raw = `Nellore${NBSP}`;

    // Guard the premise: if this ever stops being an NBSP, the assertion below
    // is no longer testing what it claims to.
    expect(raw.charCodeAt(raw.length - 1)).toBe(0x00a0);
    expect(raw).not.toBe('Nellore ');

    expect(cleanString(raw)).toBe('Nellore');
  });

  it('converts an interior NBSP to a regular space rather than deleting it', () => {
    // Deleting it would yield 'Jammu &Kashmir', which matches no boundary name.
    expect(cleanString(`Jammu${NBSP}&${NBSP}Kashmir`)).toBe('Jammu & Kashmir');
  });

  it('handles other invisible characters Excel round-trips into cells', () => {
    expect(cleanString(`Surat${ZWSP}`)).toBe('Surat');
    expect(cleanString(`${BOM}Business`)).toBe('Business');
    expect(cleanString(`Kanpur${NARROW_NBSP}Dehat`)).toBe('Kanpur Dehat');
  });

  it('collapses interior whitespace runs', () => {
    expect(cleanString('Bhaliana  0 OLD')).toBe('Bhaliana 0 OLD');
    expect(cleanString(' Ghudani Khurd')).toBe('Ghudani Khurd');
  });

  it('strips CR and LF', () => {
    expect(cleanString('NA/ Coversion Done\r\n(Acers) ')).toBe('NA/ Coversion Done (Acers)');
  });

  it('returns null for empty and whitespace-only input, never an empty string', () => {
    expect(cleanString('')).toBeNull();
    expect(cleanString('   ')).toBeNull();
    expect(cleanString(NBSP)).toBeNull();
    expect(cleanString('\r\n')).toBeNull();
  });

  it('leaves already-clean strings untouched', () => {
    expect(cleanString('Bhadrak')).toBe('Bhadrak');
  });
});

describe('normalizeHeader', () => {
  it("survives 'Used Land ' — trailing space in the header", () => {
    expect(normalizeHeader('Used Land ')).toBe('used land');
  });

  it("survives 'NA/ Coversion Done\\n(Acers) ' — embedded newline plus typos", () => {
    expect(normalizeHeader('NA/ Coversion Done\r\n(Acers) ')).toBe(
      'na/ coversion done (acers)',
    );
    // The bare-LF form the spec quotes must normalize identically to the CRLF
    // form actually in the file.
    expect(normalizeHeader('NA/ Coversion Done\n(Acers) ')).toBe(
      normalizeHeader('NA/ Coversion Done\r\n(Acers) '),
    );
  });

  it("strips the trailing space from 'Sr No '", () => {
    expect(normalizeHeader('Sr No ')).toBe('sr no');
  });

  it('preserves interior punctuation that distinguishes real columns', () => {
    const notRequire = normalizeHeader('NA/CLU Not require\r\n(acres)');
    const pending = normalizeHeader('NA/CLU Pending (acres) ');

    expect(notRequire).toBe('na/clu not require (acres)');
    expect(pending).toBe('na/clu pending (acres)');
    expect(notRequire).not.toBe(pending);
  });

  it('keeps the percent sign, which carries meaning', () => {
    expect(normalizeHeader('Utilization percentage(%)')).toBe('utilization percentage(%)');
  });

  it('does NOT repair typos — correction belongs at the matching layer', () => {
    const key = normalizeHeader('NA/ Coversion Done\r\n(Acers) ');
    expect(key).toContain('coversion');
    expect(key).toContain('acers');
  });

  it('returns null for a blank header cell', () => {
    expect(normalizeHeader('')).toBeNull();
    expect(normalizeHeader('   ')).toBeNull();
    expect(normalizeHeader('--')).toBeNull();
  });

  it('collapses headers differing only by trailing whitespace', () => {
    expect(normalizeHeader('Total Land Area')).toBe(normalizeHeader('Total Land Area '));
  });
});

describe('key minting', () => {
  it('synthesizes positional keys that cannot collide with real headers', () => {
    expect(synthesizeKey(27)).toBe('__col_27');
    // A real header could never produce this, since leading punctuation is stripped.
    expect(normalizeHeader('__col_27')).toBe('col_27');
  });

  it('suffixes duplicates rather than overwriting the first column', () => {
    const base = normalizeHeader('Total Land Area');
    expect(base).not.toBeNull();
    expect(disambiguateKey(base!, 2)).toBe('total land area__2');
  });
});
