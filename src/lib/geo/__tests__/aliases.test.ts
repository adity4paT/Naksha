/**
 * Alias coverage.
 *
 * Every alias seeded from the brief gets an assertion here, expressed as a full
 * resolution through the cascade rather than a map lookup — a lookup would pass
 * even if the alias pointed at a district that does not exist in the boundary
 * file, which is exactly the bug this suite is for.
 */

import { describe, expect, it } from 'vitest';

import { resolveDistrict, resolveRecord, resolveState } from '..';
import { aliasMap, aliasProblems, boundaryIndex, rawAliasFile } from './fixture';

const index = () => boundaryIndex();
const aliases = () => aliasMap();

describe('the alias file itself', () => {
  it('parses with no problems', () => {
    expect(aliasProblems()).toEqual([]);
  });

  it('has every district target present in the boundary file', () => {
    // The failure this guards against is a silent one: a typo'd target makes
    // the alias a no-op, the record falls through to unresolved, and it looks
    // like missing data rather than a broken correction.
    const districtNames = new Set(index().districts.map((entry) => entry.name));
    const byState = new Map<string, Set<string>>();
    for (const entry of index().districts) {
      const bucket = byState.get(entry.state) ?? new Set<string>();
      bucket.add(entry.name);
      byState.set(entry.state, bucket);
    }

    const broken = rawAliasFile().districts.filter((entry) =>
      entry.state === undefined
        ? !districtNames.has(entry.to)
        : !(byState.get(entry.state)?.has(entry.to) ?? false),
    );

    expect(broken.map((entry) => `${entry.from} -> ${entry.to}`)).toEqual([]);
  });

  it('has every state target present in the boundary file', () => {
    const stateNames = new Set(index().states.map((entry) => entry.name));
    const broken = Object.entries(rawAliasFile().states).filter(
      ([, to]) => !stateNames.has(to),
    );
    expect(broken).toEqual([]);
  });
});

describe('state aliases', () => {
  it.each([
    ['Pondichery', 'Puducherry'],
    ['Jammu', 'Jammu and Kashmir'],
  ])('resolves %s -> %s at stage 2', (input, expected) => {
    const result = resolveState(input, index(), aliases());
    expect(result.stage).toBe(2);
    expect(result.match?.name).toBe(expected);
    expect(result.confidence).toBe(1);
  });

  it("resolves 'Jammu' to the state, never to the district of the same name", () => {
    // 'Jammu' is BOTH a real district of Jammu and Kashmir and the sample's
    // (wrong) state value. The state alias must win at state level.
    const result = resolveState('Jammu', index(), aliases());
    expect(result.match?.feature.properties.level).toBe('state');
    expect(result.match?.name).toBe('Jammu and Kashmir');
  });
});

describe('district aliases', () => {
  // Every seed alias from the brief, corrected where the brief's target did not
  // exist in the boundary file. Each is [state, spreadsheet spelling, expected].
  it.each([
    ['Haryana', 'Gurgoan', 'Gurugram'],
    ['Kerala', 'Cochin', 'Ernakulam'],
    ['Haryana', 'Mewat', 'Nuh'],
    ['Kerala', 'Trivandrum', 'Thiruvananthapuram'],
    ['Uttar Pradesh', 'Sitpaur', 'Sitapur'],
    ['Punjab', 'Jallandhar', 'Jalandhar'],
    ['Uttar Pradesh', 'Raibareli', 'Rae Bareli'],
    ['Bihar', 'Purnea', 'Purnia'],
    ['Uttar Pradesh', 'Badaun', 'Budaun'],
    ['Haryana', 'Sonepat', 'Sonipat'],
    ['Andhra Pradesh', 'Nellore', 'S.P.S. Nellore'],
    ['Telangana', 'Yadadri Bhuvangiri', 'Yadadri Bhuvanagiri'],
    ['Punjab', 'Ludhiyana', 'Ludhiana'],
    ['Tamil Nadu', 'Tiruvallur', 'Thiruvallur'],
    ['Punjab', 'Mutksar', 'Sri Muktsar Sahib'],
    ['Punjab', 'Muktsar', 'Sri Muktsar Sahib'],
  ])('%s: %s -> %s', (state, input, expected) => {
    const result = resolveDistrict(input, state, index(), aliases());
    expect(result.match?.name).toBe(expected);
    expect(result.match?.state).toBe(state);
    expect(result.stage).toBeLessThanOrEqual(2);
  });

  it("resolves 'Kutch' at stage 1, with no alias needed", () => {
    // The brief seeded 'Kutch -> Kachchh'. The boundary file spells it 'Kutch',
    // so that alias would have broken a match that already worked. Asserting
    // stage 1 pins that it resolves WITHOUT the alias table.
    const result = resolveDistrict('Kutch', 'Gujarat', index(), aliases());
    expect(result.stage).toBe(1);
    expect(result.match?.name).toBe('Kutch');
  });

  it("resolves 'Thiruvallur' at stage 1 — the Th- form is canonical here", () => {
    // The brief had this alias pointing the other way. The sample contains both
    // spellings, so both must land on the same district by different stages.
    const th = resolveDistrict('Thiruvallur', 'Tamil Nadu', index(), aliases());
    const ti = resolveDistrict('Tiruvallur', 'Tamil Nadu', index(), aliases());

    expect(th.stage).toBe(1);
    expect(ti.stage).toBe(2);
    expect(th.match?.name).toBe('Thiruvallur');
    expect(ti.match?.name).toBe('Thiruvallur');
  });

  it('strips the NBSP from the sample’s Nellore before matching', () => {
    const withNbsp = 'Nellore ';
    expect(withNbsp.charCodeAt(withNbsp.length - 1)).toBe(0x00a0);

    const result = resolveDistrict(withNbsp, 'Andhra Pradesh', index(), aliases());
    expect(result.match?.name).toBe('S.P.S. Nellore');
  });
});

describe('Raigarh / Raigad — the state-scoping case', () => {
  it("resolves 'Raigarh' to Raigad ONLY under Maharashtra", () => {
    const result = resolveDistrict('Raigarh', 'Maharashtra', index(), aliases());

    expect(result.stage).toBe(2);
    expect(result.match?.name).toBe('Raigad');
    expect(result.match?.state).toBe('Maharashtra');
  });

  it("resolves 'Raigarh' to Raigarh under Chhattisgarh, NOT to Raigad", () => {
    // The whole point. Chhattisgarh's Raigarh is a real district 1,100 km from
    // Maharashtra's Raigad. An unscoped alias would relocate it.
    const result = resolveDistrict('Raigarh', 'Chhattisgarh', index(), aliases());

    expect(result.stage).toBe(1);
    expect(result.match?.name).toBe('Raigarh');
    expect(result.match?.state).toBe('Chhattisgarh');
  });

  it('never lets the Maharashtra alias leak into another state', () => {
    // Odisha has neither district. The scoped alias must not fire, and the
    // fuzzy stage must not rescue it either.
    const result = resolveDistrict('Raigarh', 'Odisha', index(), aliases());
    expect(result.match).toBeNull();
    expect(result.stage).toBe(4);
  });

  it('places the two districts ~1,100 km apart, confirming the stakes', () => {
    const raigad = resolveDistrict('Raigad', 'Maharashtra', index(), aliases()).match;
    const raigarh = resolveDistrict('Raigarh', 'Chhattisgarh', index(), aliases()).match;

    const [lng1, lat1] = raigad!.feature.properties.centroid;
    const [lng2, lat2] = raigarh!.feature.properties.centroid;

    // Rough great-circle distance; precision is irrelevant, the magnitude is
    // the assertion.
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.sqrt(a));

    expect(km).toBeGreaterThan(900);
  });

  it('resolves a full Maharashtra record end to end', () => {
    // The sample's Dighi Port rows are spelled 'Raigarh' under Maharashtra.
    const record = resolveRecord('Maharashtra', 'Raigarh', index(), aliases());

    expect(record.resolvedToDistrict).toBe(true);
    expect(record.district?.match?.name).toBe('Raigad');
    expect(record.district?.match?.state).toBe('Maharashtra');
  });
});

describe('Balrampur — the other live collision', () => {
  it('resolves to the correct state on each side', () => {
    // Balrampur exists in BOTH Uttar Pradesh and Chhattisgarh, and the sample
    // has one under UP. Exact matching alone gets this right only because it is
    // state-scoped.
    const up = resolveDistrict('Balrampur', 'Uttar Pradesh', index(), aliases());
    const cg = resolveDistrict('Balrampur', 'Chhattisgarh', index(), aliases());

    expect(up.match?.state).toBe('Uttar Pradesh');
    expect(cg.match?.state).toBe('Chhattisgarh');
    expect(up.match?.feature.properties.centroid).not.toEqual(
      cg.match?.feature.properties.centroid,
    );
  });
});
