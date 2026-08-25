/**
 * URL serialization tests.
 *
 * Two properties matter most: the whitelist genuinely bounds what can be
 * written, and a hostile or damaged query string never throws.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTIONS,
  parseFromQuery,
  SERIALIZABLE_KEYS,
  serializeToQuery,
  URL_LENGTH_BUDGET,
} from '..';
import type { SerializableViewState } from '..';

const state = (partial: Partial<SerializableViewState> = {}): SerializableViewState => ({
  selections: EMPTY_SELECTIONS,
  measureKey: null,
  binningMethod: null,
  binCount: null,
  scaleKind: null,
  ...partial,
});

describe('round-tripping', () => {
  it('preserves every filter dimension', () => {
    const original = state({
      selections: {
        business: ['xyz', 'abc'],
        state: ['Gujarat'],
        district: ['Kutch', 'Surat'],
        site: ['Mundra (SEZ)'],
        ranges: { 'total land area': { min: 100, max: 2000 } },
      },
      measureKey: 'total land area',
      binningMethod: 'jenks',
      binCount: 4,
      scaleKind: 'sequential',
    });

    const parsed = parseFromQuery(serializeToQuery(original).query);

    expect(parsed.selections).toEqual(original.selections);
    expect(parsed.measureKey).toBe('total land area');
    expect(parsed.binningMethod).toBe('jenks');
    expect(parsed.binCount).toBe(4);
  });

  it('survives names with spaces, parentheses, and ampersands', () => {
    const original = state({
      selections: {
        ...EMPTY_SELECTIONS,
        state: ['Jammu and Kashmir', 'Dadra and Nagar Haveli and Daman and Diu'],
        district: ['S.P.S. Nellore', 'Mundra (SEZ) & Others'],
      },
    });

    const parsed = parseFromQuery(serializeToQuery(original).query);
    expect(parsed.selections.state).toEqual(original.selections.state);
    expect(parsed.selections.district).toEqual(original.selections.district);
  });

  it('emits nothing for an empty state', () => {
    expect(serializeToQuery(state()).query).toBe('');
  });
});

describe('the whitelist', () => {
  it('writes only whitelisted keys', () => {
    const { query } = serializeToQuery(
      state({
        selections: {
          business: ['xyz'],
          state: ['Gujarat'],
          district: ['Kutch'],
          site: ['Mundra'],
          ranges: { area: { min: 1, max: 2 } },
        },
        measureKey: 'area',
        binningMethod: 'quantile',
        binCount: 5,
        scaleKind: 'sequential',
      }),
    );

    const allowed = new Set<string>(Object.values(SERIALIZABLE_KEYS));
    for (const key of new URLSearchParams(query).keys()) {
      expect(allowed.has(key), `unexpected key ${key}`).toBe(true);
    }
  });

  it('ignores unknown keys when parsing', () => {
    // A URL carrying extra parameters must not smuggle them into filter state.
    const parsed = parseFromQuery('?s=Gujarat&recordIds=r1~r2&acres=99999&evil=1');

    expect(parsed.selections.state).toEqual(['Gujarat']);
    expect(Object.keys(parsed.selections)).toEqual([
      'business',
      'state',
      'district',
      'site',
      'ranges',
    ]);
  });

  it('never serializes anything row-level', () => {
    // The whitelist is the mechanism; this asserts the outcome. No record id,
    // acreage, or measure value appears anywhere in the output.
    const { query } = serializeToQuery(
      state({ selections: { ...EMPTY_SELECTIONS, state: ['Gujarat'] } }),
    );

    expect(query).not.toMatch(/record/i);
    expect(query).not.toMatch(/acre/i);
    expect(query).toBe('s=Gujarat');
  });
});

describe('malformed input', () => {
  it('never throws', () => {
    for (const query of [
      '',
      '?',
      '?s=',
      '?s=%',
      '?s=%E0%A4',
      '?r=nonsense',
      '?r=area:notanumber:5',
      '?bc=abc',
      '?d=~~~',
      '?'.padEnd(5000, 'x'),
    ]) {
      expect(() => parseFromQuery(query), `query ${query}`).not.toThrow();
    }
  });

  it('drops a value with a broken escape but keeps the rest', () => {
    const parsed = parseFromQuery('?d=Kutch~%~Surat');
    expect(parsed.selections.district).toEqual(['Kutch', 'Surat']);
  });

  it('rejects a range whose min exceeds its max', () => {
    expect(parseFromQuery('?r=area:900:100').selections.ranges).toEqual({});
  });

  it('rejects a non-numeric bin count', () => {
    expect(parseFromQuery('?bc=lots').binCount).toBeNull();
  });
});

describe('length budget', () => {
  it('stays within budget and reports what it dropped', () => {
    // 400 long site names would blow past any practical URL limit. Truncation
    // is reported rather than silent, because a shortened URL restores a
    // DIFFERENT filter state that still looks plausible.
    const sites = Array.from({ length: 400 }, (_, i) => `Very Long Site Name Number ${i}`);
    const { query, truncated } = serializeToQuery(
      state({ selections: { ...EMPTY_SELECTIONS, state: ['Gujarat'], site: sites } }),
    );

    expect(query.length).toBeLessThanOrEqual(URL_LENGTH_BUDGET);
    expect(truncated).toContain('site');
    // The smaller selection survives.
    expect(parseFromQuery(query).selections.state).toEqual(['Gujarat']);
  });

  it('reports nothing dropped when everything fits', () => {
    const { truncated } = serializeToQuery(
      state({ selections: { ...EMPTY_SELECTIONS, state: ['Gujarat'] } }),
    );
    expect(truncated).toEqual([]);
  });
});
