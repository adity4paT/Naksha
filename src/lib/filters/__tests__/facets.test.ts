/**
 * Cascade and orphan behaviour.
 *
 * The orphan tests carry most of the weight. Everything else here is ordinary
 * faceted search; retaining an invalidated selection instead of dropping it is
 * the part that is easy to get wrong and impossible to notice when it is wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  applyFilters,
  availableValues,
  buildAllFacets,
  buildFacetView,
  computeActive,
  EMPTY_SELECTIONS,
  isIndependent,
  measureBounds,
  restoreActionFor,
} from '..';
import type { FacetRow, FilterSelections } from '..';

/**
 * A miniature dataset with the shapes that matter: a business spanning two
 * states, a district name unique to one state, and a site under each district.
 */
const ROWS: FacetRow[] = [
  { recordId: 'r1', business: 'xyz', state: 'Gujarat', district: 'Kutch', site: 'Mundra', measures: { area: 3512 } },
  { recordId: 'r2', business: 'xyz', state: 'Gujarat', district: 'Kutch', site: 'Tuna', measures: { area: 800 } },
  { recordId: 'r3', business: 'xyz', state: 'Gujarat', district: 'Surat', site: 'Hazira', measures: { area: 1441 } },
  { recordId: 'r4', business: 'abc', state: 'Punjab', district: 'Ludhiana', site: 'Khanna', measures: { area: 250 } },
  { recordId: 'r5', business: 'abc', state: 'Punjab', district: 'Barnala', site: 'Sehna', measures: { area: 400 } },
  { recordId: 'r6', business: 'def', state: 'Bihar', district: 'Purnia', site: 'Purnea', measures: { area: 900 } },
  // Unresolved: no canonical geography. Can never match a state/district filter.
  { recordId: 'r7', business: 'def', state: null, district: null, site: 'Nowhere', measures: { area: 120 } },
];

const withSelections = (partial: Partial<FilterSelections>): FilterSelections => ({
  ...EMPTY_SELECTIONS,
  ...partial,
});

describe('cascade narrowing', () => {
  it('narrows the district list to the selected state only', () => {
    const selections = withSelections({ state: ['Gujarat'] });
    const active = computeActive(ROWS, selections);
    const districts = availableValues(ROWS, 'district', active, {});

    expect([...districts].sort()).toEqual(['Kutch', 'Surat']);
    expect(districts.has('Ludhiana')).toBe(false);
  });

  it('narrows the site list by both state and district', () => {
    const selections = withSelections({ state: ['Gujarat'], district: ['Kutch'] });
    const active = computeActive(ROWS, selections);

    expect([...availableValues(ROWS, 'site', active, {})].sort()).toEqual([
      'Mundra',
      'Tuna',
    ]);
  });

  it('narrows geography by business, since business is upstream', () => {
    const selections = withSelections({ business: ['abc'] });
    const active = computeActive(ROWS, selections);

    expect([...availableValues(ROWS, 'state', active, {})]).toEqual(['Punjab']);
  });

  it('excludes unresolved records from every geographic filter', () => {
    // r7 has no canonical state, so it lives in the unmapped panel, not a region.
    const selections = withSelections({ state: ['Bihar'] });
    expect(applyFilters(ROWS, selections).map((r) => r.recordId)).toEqual(['r6']);
  });

  it('treats an empty selection as no constraint', () => {
    expect(applyFilters(ROWS, EMPTY_SELECTIONS)).toHaveLength(7);
  });
});

describe('business independence', () => {
  it('is the only independent dimension', () => {
    expect(isIndependent('business')).toBe(true);
    expect(isIndependent('state')).toBe(false);
    expect(isIndependent('district')).toBe(false);
    expect(isIndependent('site')).toBe(false);
  });

  it('never narrows its own option list, whatever geography is selected', () => {
    // Selecting Gujarat leaves abc and def with zero matching records, but both
    // must stay on screen — that is what "cross-cutting" buys the user.
    const selections = withSelections({ state: ['Gujarat'] });
    const { views } = buildAllFacets(ROWS, selections);
    const business = views.find((v) => v.dimension === 'business')!;

    expect(business.options.map((o) => o.value).sort()).toEqual(['abc', 'def', 'xyz']);
  });

  it('keeps its counts live so the numbers still respond to geography', () => {
    const unfiltered = buildFacetView(ROWS, 'business', EMPTY_SELECTIONS, computeActive(ROWS, EMPTY_SELECTIONS));
    const selections = withSelections({ state: ['Gujarat'] });
    const filtered = buildFacetView(ROWS, 'business', selections, computeActive(ROWS, selections));

    const countOf = (view: typeof unfiltered, value: string) =>
      view.options.find((o) => o.value === value)?.count ?? -1;

    expect(countOf(unfiltered, 'abc')).toBe(2);
    // Still listed, now at zero — visible but empty, not removed.
    expect(countOf(filtered, 'abc')).toBe(0);
    expect(countOf(filtered, 'xyz')).toBe(3);
  });
});

describe('facet counts', () => {
  it('excludes a dimension’s own selection, showing what adding a value would gain', () => {
    // With Gujarat selected, Punjab's count must still be 2 — otherwise the
    // user cannot tell what ticking it would add.
    const selections = withSelections({ state: ['Gujarat'] });
    const view = buildFacetView(ROWS, 'state', selections, computeActive(ROWS, selections));

    expect(view.options.find((o) => o.value === 'Punjab')?.count).toBe(2);
    expect(view.options.find((o) => o.value === 'Gujarat')?.count).toBe(3);
  });

  it('respects other dimensions when counting', () => {
    const selections = withSelections({ business: ['xyz'] });
    const view = buildFacetView(ROWS, 'state', selections, computeActive(ROWS, selections));

    expect(view.options.find((o) => o.value === 'Gujarat')?.count).toBe(3);
  });
});

describe('orphaned selections — the critical behaviour', () => {
  it('retains a district selection that an upstream state change invalidates', () => {
    // Select Kutch under Gujarat, then switch the state filter to Punjab.
    const selections = withSelections({ state: ['Punjab'], district: ['Kutch'] });
    const { views } = buildAllFacets(ROWS, selections);
    const district = views.find((v) => v.dimension === 'district')!;

    // NOT silently dropped: still in the store, reported as orphaned.
    expect(selections.district).toContain('Kutch');
    expect(district.orphaned.map((o) => o.value)).toEqual(['Kutch']);
    // And absent from the options, since Punjab has no Kutch.
    expect(district.options.map((o) => o.value)).not.toContain('Kutch');
  });

  it('does not let an orphaned selection filter records', () => {
    // The danger case: if orphaned Kutch still constrained the result set, the
    // user would see zero records with no visible cause.
    const selections = withSelections({ state: ['Punjab'], district: ['Kutch'] });
    const rows = applyFilters(ROWS, selections);

    expect(rows.map((r) => r.recordId).sort()).toEqual(['r4', 'r5']);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('reports the exact upstream widening that would restore it', () => {
    const selections = withSelections({ state: ['Punjab'], district: ['Kutch'] });
    const active = computeActive(ROWS, selections);
    const orphan = restoreActionFor(ROWS, 'district', 'Kutch', selections, active);

    expect(orphan.restore.state).toEqual(['Gujarat']);
    expect(orphan.reason).toMatch(/State filter excludes Gujarat/);
  });

  it('revives automatically once the upstream filter widens', () => {
    // This is what retaining the selection buys: applying the restore action
    // re-activates the orphan with no re-selection.
    const orphaned = withSelections({ state: ['Punjab'], district: ['Kutch'] });
    expect(computeActive(ROWS, orphaned).district).toEqual([]);

    const restored = withSelections({ state: ['Punjab', 'Gujarat'], district: ['Kutch'] });
    expect(computeActive(ROWS, restored).district).toEqual(['Kutch']);
    // Only the Kutch rows, because the district filter is now doing its job.
    // Widening the state filter revives the district selection; it does not
    // discard it.
    expect(applyFilters(ROWS, restored).map((r) => r.recordId).sort()).toEqual(['r1', 'r2']);
  });

  it('restores only the blocking dimension, leaving unrelated filters alone', () => {
    // Needs a business that genuinely spans both states, so the Punjab
    // selection stays ACTIVE and is the thing blocking Kutch. (In the shared
    // fixture xyz has no Punjab rows, so a Punjab selection would itself be
    // orphaned — see the test below.)
    const spanning: FacetRow[] = [
      ...ROWS,
      { recordId: 'r8', business: 'xyz', state: 'Punjab', district: 'Moga', site: 'Moga', measures: { area: 300 } },
    ];

    const selections = withSelections({
      business: ['xyz'],
      state: ['Punjab'],
      district: ['Kutch'],
    });
    const active = computeActive(spanning, selections);
    const orphan = restoreActionFor(spanning, 'district', 'Kutch', selections, active);

    // Business already permits Kutch's rows, so restore must not touch it — a
    // restore that resets unrelated filters is its own kind of surprise.
    expect(orphan.restore.state).toEqual(['Gujarat']);
    expect(orphan.restore.business).toBeUndefined();
  });

  it('an orphaned upstream selection stops constraining, un-orphaning below it', () => {
    // Business xyz has no Punjab rows, so selecting both orphans PUNJAB. An
    // orphaned selection filters nothing, so the district list falls back to
    // xyz's own districts and Kutch is available again.
    //
    // Worth pinning: the alternative — an orphaned selection that still
    // constrained — would empty the result set with nothing on screen to
    // explain why.
    const selections = withSelections({
      business: ['xyz'],
      state: ['Punjab'],
      district: ['Kutch'],
    });
    const { views } = buildAllFacets(ROWS, selections);

    expect(views.find((v) => v.dimension === 'state')!.orphaned.map((o) => o.value)).toEqual([
      'Punjab',
    ]);
    expect(views.find((v) => v.dimension === 'district')!.orphaned).toEqual([]);
    expect(applyFilters(ROWS, selections).map((r) => r.recordId)).toEqual(['r1', 'r2']);
  });

  it('names every blocking dimension when more than one is at fault', () => {
    // Kutch needs BOTH business xyz and state Gujarat; neither is selected.
    const selections = withSelections({
      business: ['abc'],
      state: ['Punjab'],
      district: ['Kutch'],
    });
    const active = computeActive(ROWS, selections);
    const orphan = restoreActionFor(ROWS, 'district', 'Kutch', selections, active);

    expect(orphan.restore.business).toEqual(['xyz']);
    expect(orphan.restore.state).toEqual(['Gujarat']);
  });

  it('cascades orphaning down the chain', () => {
    // Orphaning a district also orphans the sites beneath it.
    const selections = withSelections({
      state: ['Punjab'],
      district: ['Kutch'],
      site: ['Mundra'],
    });
    const { views } = buildAllFacets(ROWS, selections);

    expect(views.find((v) => v.dimension === 'district')!.orphaned).toHaveLength(1);
    expect(views.find((v) => v.dimension === 'site')!.orphaned.map((o) => o.value)).toEqual([
      'Mundra',
    ]);
  });

  it('explains a range-caused orphan rather than offering a useless restore', () => {
    // No upstream widening can fix this, and the reason says so.
    const selections = withSelections({
      district: ['Kutch'],
      ranges: { area: { min: 0, max: 10 } },
    });
    const active = computeActive(ROWS, selections);
    const orphan = restoreActionFor(ROWS, 'district', 'Kutch', selections, active);

    expect(Object.keys(orphan.restore)).toHaveLength(0);
    expect(orphan.reason).toMatch(/measure range/i);
  });

  it('reports no orphans when everything is consistent', () => {
    const selections = withSelections({ state: ['Gujarat'], district: ['Kutch'] });
    const { views } = buildAllFacets(ROWS, selections);
    expect(views.every((v) => v.orphaned.length === 0)).toBe(true);
  });
});

describe('range filters', () => {
  it('derives bounds from the full dataset', () => {
    const bounds = measureBounds(ROWS, [{ key: 'area', label: 'Total Land Area' }]);

    expect(bounds).toHaveLength(1);
    expect(bounds[0]?.min).toBe(120);
    expect(bounds[0]?.max).toBe(3512);
  });

  it('filters rows to the range', () => {
    const selections = withSelections({ ranges: { area: { min: 800, max: 1500 } } });
    expect(applyFilters(ROWS, selections).map((r) => r.recordId).sort()).toEqual([
      'r2',
      'r3',
      'r6',
    ]);
  });

  it('excludes rows with a null measure rather than treating null as in range', () => {
    // "Between X and Y" cannot be true of an unrecorded figure.
    const rows: FacetRow[] = [
      { recordId: 'a', business: null, state: null, district: null, site: null, measures: { area: 50 } },
      { recordId: 'b', business: null, state: null, district: null, site: null, measures: { area: null } },
    ];
    const selections = withSelections({ ranges: { area: { min: 0, max: 100 } } });

    expect(applyFilters(rows, selections).map((r) => r.recordId)).toEqual(['a']);
  });

  it('ignores a measure with no finite values', () => {
    const rows: FacetRow[] = [
      { recordId: 'a', business: null, state: null, district: null, site: null, measures: { empty: null } },
    ];
    expect(measureBounds(rows, [{ key: 'empty', label: 'Empty' }])).toEqual([]);
  });
});
