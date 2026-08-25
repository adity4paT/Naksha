/**
 * End-to-end: the real spreadsheet, through the real parser, against the real
 * boundary files.
 *
 * This is the test that would catch an alias that looks right in isolation but
 * never fires because the ingest layer hands the resolver a differently-shaped
 * string. It also pins the overall resolution rate, so a regression in any
 * stage shows up as a number moving rather than as a subtly emptier map.
 */

import { describe, expect, it } from 'vitest';

import { parseWorkbook } from '@/lib/ingest';
import { effectiveRole } from '@/types/schema';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildResolutionReport, resolveRecord } from '..';
import { aliasMap, boundaryIndex, provenance } from './fixture';

function parseSample() {
  const bytes = new Uint8Array(
    readFileSync(fileURLToPath(new URL('../../../../Dummy land mis.xlsx', import.meta.url))),
  );
  return parseWorkbook(bytes, { fileName: 'Dummy land mis.xlsx' });
}

function resolveSample() {
  const workbook = parseSample();
  const index = boundaryIndex();
  const aliases = aliasMap();

  const stateColumn = workbook.columns.find(
    (column) => column.normalizedKey === 'state' && effectiveRole(column) === 'dimension',
  );
  const districtColumn = workbook.columns.find(
    (column) => column.normalizedKey === 'district',
  );

  const resolutions = workbook.records.map((record) =>
    resolveRecord(
      record.values[stateColumn!.normalizedKey],
      record.values[districtColumn!.normalizedKey],
      index,
      aliases,
    ),
  );

  return { workbook, resolutions, report: buildResolutionReport(resolutions) };
}

describe('boundary files', () => {
  it('match the provenance manifest', () => {
    const manifest = provenance();
    expect(boundaryIndex().districts).toHaveLength(manifest.districtCount as number);
    expect(boundaryIndex().states).toHaveLength(manifest.stateCount as number);
    expect(manifest.commit).toBe('cc91a19ffbca10b7ca6872a1e9690b4e5fd3aa0a');
  });

  it('have 36 states and a unique (state, district) pair for every district', () => {
    const index = boundaryIndex();
    expect(index.states).toHaveLength(36);

    const pairs = index.districts.map((entry) => `${entry.state}|${entry.key}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('carry a parent state on every district', () => {
    expect(boundaryIndex().districts.every((entry) => entry.state.length > 0)).toBe(true);
  });

  it('carry a precomputed centroid inside India for every feature', () => {
    const all = [...boundaryIndex().states, ...boundaryIndex().districts];

    for (const entry of all) {
      const [lng, lat] = entry.feature.properties.centroid;
      expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);
      expect(lng).toBeGreaterThan(67);
      expect(lng).toBeLessThan(98);
      expect(lat).toBeGreaterThan(6);
      expect(lat).toBeLessThan(38);
    }
  });
});

describe('resolving the real sample', () => {
  it('resolves every one of the 18 states in the sample', () => {
    const { resolutions } = resolveSample();
    const unresolved = resolutions.filter((r) => !r.resolvedToState);
    expect(unresolved.map((r) => r.state.input)).toEqual([]);
  });

  it('resolves all 130 records to a district polygon', () => {
    const { resolutions } = resolveSample();
    const resolved = resolutions.filter((r) => r.resolvedToDistrict);

    expect(resolutions).toHaveLength(130);
    expect(resolved).toHaveLength(130);
  });

  it('resolves Shravasti to Shrawasti via the fuzzy stage', () => {
    // The boundary file spells this with a 'w'. No alias anticipated it, and
    // the fuzzy stage earned its place by catching it at 0.889 — this is the
    // only stage-3 match in the whole sample, and the concrete argument for
    // having stage 3 at all.
    const { resolutions } = resolveSample();
    const shravasti = resolutions.find((r) => r.district?.input === 'Shravasti');

    expect(shravasti).toBeDefined();
    expect(shravasti?.district?.stage).toBe(3);
    expect(shravasti?.district?.match?.name).toBe('Shrawasti');
    expect(shravasti?.district?.match?.state).toBe('Uttar Pradesh');
    expect(shravasti?.district?.confidence).toBeLessThan(1);
    expect(shravasti?.district?.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it('puts every Maharashtra "Raigarh" row in Raigad, Maharashtra', () => {
    const { resolutions } = resolveSample();
    const rows = resolutions.filter((r) => r.district?.input === 'Raigarh');

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state.match?.name).toBe('Maharashtra');
      expect(row.district?.match?.name).toBe('Raigad');
      expect(row.district?.match?.state).toBe('Maharashtra');
    }
  });

  it('never places a record in a state other than the one it resolved to', () => {
    // The global safety property. If any district's parent state disagrees with
    // the record's resolved state, scoping has failed somewhere.
    const { resolutions } = resolveSample();

    const misplaced = resolutions.filter(
      (r) =>
        r.district?.match != null &&
        r.state.match != null &&
        r.district.match.state !== r.state.match.name,
    );

    expect(misplaced).toEqual([]);
  });
});

describe('the resolution report', () => {
  it('reports on distinct names, not on rows', () => {
    const { report } = resolveSample();
    // 130 records resolve through far fewer distinct names; a user fixing a
    // mismatch fixes it once.
    expect(report.entries.length).toBeLessThan(130);
    expect(report.totalRecords).toBe(130);
  });

  it('accounts for every record exactly once', () => {
    const { report } = resolveSample();
    expect(
      report.recordsResolvedToDistrict +
        report.recordsResolvedToStateOnly +
        report.recordsUnresolved,
    ).toBe(report.totalRecords);
  });

  it('flags stage 3 and stage 4 for review, and nothing else', () => {
    const { report } = resolveSample();

    expect(report.needsReview.every((entry) => entry.stage >= 3)).toBe(true);
    for (const entry of report.entries) {
      expect(entry.needsReview).toBe(entry.stage >= 3);
    }
  });

  it('surfaces the fuzzy-matched Shravasti entry for review', () => {
    // The brief's requirement: a fuzzy match is drawn on the map identically to
    // an exact one, so if it is not surfaced it is invisible. This is the whole
    // reason needsReview includes stage 3 and not just stage 4.
    const { report } = resolveSample();
    const entry = report.needsReview.find((e) => e.input === 'Shravasti');

    expect(entry).toBeDefined();
    expect(entry?.stage).toBe(3);
    expect(entry?.matchedName).toBe('Shrawasti');
    expect(entry?.needsReview).toBe(true);
    // Candidates are listed so the user can judge the match for themselves.
    expect(entry?.candidates.length).toBeGreaterThan(0);
    expect(entry?.detail).toMatch(/Fuzzy match/);
  });

  it('reports every other name as exact or aliased', () => {
    // Exactly one entry needs review in this sample. If that number grows, a
    // stage regressed; if it drops to zero, the review path is untested.
    const { report } = resolveSample();
    expect(report.needsReview).toHaveLength(1);
    expect(report.countsByStage[4]).toBe(0);
  });

  it('keys district entries by parent state so collisions do not merge', () => {
    const { report } = resolveSample();
    const districtEntries = report.entries.filter((e) => e.level === 'district');
    expect(districtEntries.every((e) => e.parentState !== null)).toBe(true);
  });

  it('sorts the worst problems first', () => {
    const { report } = resolveSample();
    const stages = report.entries.map((e) => e.stage);
    expect([...stages].sort((a, b) => b - a)).toEqual(stages);
  });

  it('records how many rows ride on each name', () => {
    const { report } = resolveSample();
    const total = report.entries
      .filter((e) => e.level === 'state')
      .reduce((sum, e) => sum + e.recordCount, 0);

    expect(total).toBe(130);
  });
});
