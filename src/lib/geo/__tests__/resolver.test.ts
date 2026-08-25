/**
 * Cascade mechanics: stage ordering, fuzzy thresholds, and refusal to guess.
 */

import { describe, expect, it } from 'vitest';

import {
  buildBoundaryIndex,
  EMPTY_ALIAS_MAP,
  FUZZY_THRESHOLD,
  levenshtein,
  normalizePlaceName,
  parseAliasMap,
  resolveDistrict,
  resolveRecord,
  resolveState,
  similarityRatio,
} from '..';
import { aliasMap, boundaryIndex } from './fixture';

const index = () => boundaryIndex();
const aliases = () => aliasMap();

describe('normalizePlaceName', () => {
  it('collapses formatting differences', () => {
    expect(normalizePlaceName('  Goa  ')).toBe('goa');
    expect(normalizePlaceName('Nellore ')).toBe('nellore');
    expect(normalizePlaceName('S.P.S. Nellore')).toBe('sps nellore');
    expect(normalizePlaceName('Jammu & Kashmir')).toBe('jammu and kashmir');
    expect(normalizePlaceName('Jammu and Kashmir')).toBe('jammu and kashmir');
  });

  it('does NOT collapse spelling differences', () => {
    // Normalization removes formatting, never spelling. Making these equal is
    // the alias table's job; doing it here would silently merge real districts.
    expect(normalizePlaceName('Raibareli')).not.toBe(normalizePlaceName('Rae Bareli'));
    expect(normalizePlaceName('Raigarh')).not.toBe(normalizePlaceName('Raigad'));
  });
});

describe('similarity ratio calibration', () => {
  it('scores Raigarh vs Raigad BELOW the threshold', () => {
    // This is the single most important number in the module. If it ever rises
    // above the threshold, Chhattisgarh records start resolving to Maharashtra
    // whenever their state fails to resolve first.
    const score = similarityRatio('raigarh', 'raigad');
    expect(score).toBeLessThan(FUZZY_THRESHOLD);
    expect(score).toBeCloseTo(0.714, 2);
  });

  it('scores the Mutksar transposition below the threshold', () => {
    // Levenshtein (not Damerau) charges 2 for a transposition, deliberately, so
    // this must be handled by an explicit alias rather than guessed at.
    expect(similarityRatio('mutksar', 'muktsar')).toBeLessThan(FUZZY_THRESHOLD);
  });

  it('scores Ludhiyana vs Ludhiana at or above the threshold', () => {
    expect(similarityRatio('ludhiyana', 'ludhiana')).toBeGreaterThanOrEqual(
      FUZZY_THRESHOLD,
    );
  });

  it('is length-aware — one edit costs a short name more', () => {
    expect(similarityRatio('goa', 'gia')).toBeLessThan(
      similarityRatio('visakhapatnam', 'visakhapatnem'),
    );
  });

  it('computes distance symmetrically', () => {
    expect(levenshtein('raigarh', 'raigad')).toBe(levenshtein('raigad', 'raigarh'));
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
  });
});

describe('stage ordering', () => {
  it('prefers an exact match over an alias', () => {
    const result = resolveState('Punjab', index(), aliases());
    expect(result.stage).toBe(1);
    expect(result.confidence).toBe(1);
  });

  it('prefers an alias over a fuzzy match', () => {
    // 'Pondichery' would fuzzy-match Puducherry too; the alias must win, and
    // report confidence 1 rather than a similarity score.
    const result = resolveState('Pondichery', index(), aliases());
    expect(result.stage).toBe(2);
    expect(result.confidence).toBe(1);
  });

  it('falls to fuzzy only when exact and alias both miss', () => {
    // 'Maharastra' — the common missing-h misspelling. One edit in an 11-char
    // name scores 0.909, clearing the threshold.
    const result = resolveState('Maharastra', index(), aliases());
    expect(result.stage).toBe(3);
    expect(result.match?.name).toBe('Maharashtra');
    expect(result.confidence).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(result.confidence).toBeLessThan(1);
  });

  it('records the candidates it considered when it fuzzy-matches', () => {
    const result = resolveState('Maharastra', index(), aliases());
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.name).toBe('Maharashtra');
  });

  it('does NOT fuzzy-match one edit in a short name', () => {
    // 'Punjabb' vs 'Punjab' scores 0.857, below the threshold. This is the
    // deliberate cost of setting the bar above the Raigarh/Raigad band: some
    // real typos in short names go unresolved rather than risking a confident
    // wrong match. It surfaces for review, which is the right failure.
    const result = resolveState('Punjabb', index(), aliases());
    expect(result.stage).toBe(4);
    expect(result.candidates[0]?.name).toBe('Punjab');
  });
});

describe('refusing to guess', () => {
  it('returns stage 4 for a name nothing resembles', () => {
    const result = resolveState('Wakanda', index(), aliases());
    expect(result.stage).toBe(4);
    expect(result.match).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('explains WHY it failed, with the best score it saw', () => {
    const result = resolveState('Wakanda', index(), aliases());
    expect(result.detail).toMatch(/below the 88% threshold/);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('refuses when two candidates tie above the threshold', () => {
    // A synthetic index with two near-identical districts. Taking the higher
    // score here would be a coin flip rendered as a confident polygon.
    const twin = (name: string) => ({
      type: 'Feature' as const,
      properties: {
        name,
        state: 'Testland',
        level: 'district' as const,
        vintage: null,
        centroid: [77, 28] as [number, number],
        bbox: [76, 27, 78, 29] as [number, number, number, number],
      },
      geometry: { type: 'Polygon' as const, coordinates: [[[76, 27], [78, 27], [78, 29], [76, 27]]] },
    });

    const state = {
      ...twin('Testland'),
      properties: { ...twin('Testland').properties, level: 'state' as const },
    };

    // Both candidates are one edit from the input across 9 characters, so both
    // score 0.889 and both clear the 0.88 threshold. An earlier version of this
    // test used 8-character names, where one edit scores 0.875 — below the bar,
    // so nothing cleared and it was silently exercising the no-match branch
    // instead of the tie branch it claims to test.
    const synthetic = buildBoundaryIndex([state], [twin('Sitapuran'), twin('Sitapurar')]);

    const result = resolveDistrict('Sitapuram', 'Testland', synthetic, EMPTY_ALIAS_MAP);

    expect(result.match).toBeNull();
    expect(result.stage).toBe(4);
    expect(result.detail).toMatch(/Ambiguous/);
    // The tied candidates are surfaced so a user can fix it with one alias.
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('treats null-ish values as unresolvable rather than fuzzy-matching them', () => {
    for (const value of [null, undefined, '', '   ', '-', 'NA', 'N/A']) {
      const result = resolveState(value, index(), aliases());
      expect(result.stage, `value ${JSON.stringify(value)}`).toBe(4);
      expect(result.match).toBeNull();
    }
  });
});

describe('state-before-district ordering', () => {
  it('refuses a district outright when its state did not resolve', () => {
    // Widening to all 724 districts would be the intuitive fallback and is
    // precisely the bug the design prevents.
    const result = resolveDistrict('Raigarh', null, index(), aliases());

    expect(result.match).toBeNull();
    expect(result.stage).toBe(4);
    expect(result.detail).toMatch(/no safe scope/);
  });

  it('propagates that refusal through resolveRecord', () => {
    const record = resolveRecord('Wakanda', 'Raigarh', index(), aliases());

    expect(record.resolvedToState).toBe(false);
    expect(record.resolvedToDistrict).toBe(false);
    expect(record.district?.detail).toMatch(/Parent state did not resolve/);
  });

  it('reports a record at the WEAKER of its two stages', () => {
    // Fuzzy state + exact district is a fuzzy result. Reporting it as exact
    // would hide the guess that carries the actual risk.
    const record = resolveRecord('Maharastra', 'Nagpur', index(), aliases());

    expect(record.state.stage).toBe(3);
    expect(record.district?.stage).toBe(1);
    expect(record.stage).toBe(3);
  });

  it('handles a record with a state but no district', () => {
    const record = resolveRecord('Goa', null, index(), aliases());

    expect(record.resolvedToState).toBe(true);
    expect(record.resolvedToDistrict).toBe(false);
    expect(record.district).toBeNull();
  });
});

describe('alias map parsing', () => {
  it('degrades to an empty map on malformed input rather than throwing', () => {
    expect(parseAliasMap(null).map.districts.size).toBe(0);
    expect(parseAliasMap('nonsense').problems.length).toBeGreaterThan(0);
    expect(parseAliasMap({ districts: 'not an array' }).problems.length).toBeGreaterThan(0);
  });

  it('skips a malformed entry but keeps the good ones', () => {
    const result = parseAliasMap({
      districts: [{ from: 'good', to: 'Good' }, { from: 'broken' }, { to: 'orphan' }],
    });

    expect(result.map.districts.has('good')).toBe(true);
    expect(result.problems).toHaveLength(2);
  });

  it('normalizes "from" keys but never "to" values', () => {
    const result = parseAliasMap({
      districts: [{ from: '  GurGoan ', to: 'S.P.S. Nellore' }],
    });

    expect(result.map.districts.has('gurgoan')).toBe(true);
    // The target must match the GeoJSON exactly, punctuation included.
    expect(result.map.districts.get('gurgoan')?.[0]?.to).toBe('S.P.S. Nellore');
  });

  it('sorts state-scoped entries ahead of unscoped ones regardless of file order', () => {
    // Order in a hand-edited file must not change behaviour.
    const result = parseAliasMap({
      districts: [
        { from: 'x', to: 'Unscoped' },
        { from: 'x', to: 'Scoped', state: 'Maharashtra' },
      ],
    });

    expect(result.map.districts.get('x')?.[0]?.state).toBe('Maharashtra');
  });

  it('reports a broken alias target instead of silently falling through', () => {
    const broken = parseAliasMap({
      districts: [{ from: 'somewhere', to: 'Nonexistent District' }],
    }).map;

    const result = resolveDistrict('Somewhere', 'Punjab', index(), broken);

    expect(result.match).toBeNull();
    expect(result.detail).toMatch(/no district by that name/);
  });
});
