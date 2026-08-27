import { describe, expect, it } from 'vitest';

import type { CellValue, NormalizedKey, ParsedRecord, RecordId } from '@/types/schema';

import { filenameStem, inspectKmzColumn, matchFilesToSites } from '../match';
import { indexSites, makeSiteKey } from '../site-key';
import type { SiteKeyColumns } from '../site-key';

const key = (value: string): NormalizedKey => value as NormalizedKey;

const COLUMNS: SiteKeyColumns = {
  stateKey: key('state'),
  districtKey: key('district'),
  siteKey: key('site'),
};

const COLUMN_KEYS = [key('state'), key('district'), key('site'), key('kmz files')];

function record(
  row: number,
  values: Readonly<Record<string, CellValue>>,
): ParsedRecord {
  return {
    id: `row-${row}` as RecordId,
    sourceRowNumber: row,
    values: values as ParsedRecord['values'],
    warnings: [],
  };
}

const RECORDS: readonly ParsedRecord[] = [
  record(2, { state: 'Gujarat', district: 'Kutch', site: 'Plot 42' }),
  record(3, { state: 'Gujarat', district: 'Kutch', site: 'Riverside' }),
  record(4, { state: 'Maharashtra', district: 'Nagpur', site: 'Plot 42' }),
];

const INDEX = indexSites(RECORDS, COLUMNS);

describe('filenameStem', () => {
  it('drops the extension case-insensitively', () => {
    expect(filenameStem('Plot 42.KMZ')).toBe('Plot 42');
    expect(filenameStem('Riverside.kml')).toBe('Riverside');
  });

  it('drops a directory prefix from a zip entry', () => {
    expect(filenameStem('batch/2024/Riverside.kmz')).toBe('Riverside');
  });
});

describe('filename matching', () => {
  it('binds a file whose stem matches a unique site name', () => {
    const result = matchFilesToSites(['Riverside.kmz'], {
      records: RECORDS,
      siteIndex: INDEX,
      columnKeys: COLUMN_KEYS,
    });

    const [proposal] = result.matched;
    expect(proposal?.strategy).toBe('filename');
    expect(proposal?.siteKey).toBe(makeSiteKey('Gujarat', 'Kutch', 'Riverside'));
  });

  it('ignores case and surrounding whitespace, via the ingest normalizer', () => {
    const result = matchFilesToSites(['  RIVERSIDE .kmz'], {
      records: RECORDS,
      siteIndex: INDEX,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched).toHaveLength(1);
  });

  it('refuses to guess when a name matches two sites', () => {
    const result = matchFilesToSites(['Plot 42.kmz'], {
      records: RECORDS,
      siteIndex: INDEX,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    // The ambiguity is reported, not swallowed: manual assignment needs to show
    // which two sites were in contention.
    expect(result.unmatched[0]?.ambiguousMatches).toHaveLength(2);
  });

  it('leaves an unrecognised filename for manual assignment', () => {
    const result = matchFilesToSites(['mystery.kmz'], {
      records: RECORDS,
      siteIndex: INDEX,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.unmatched[0]?.siteKey).toBeNull();
    expect(result.unmatched[0]?.ambiguousMatches).toHaveLength(0);
  });

  it('lists sites still lacking a file, excluding ones already attached', () => {
    const attached = new Set([makeSiteKey('Gujarat', 'Kutch', 'Plot 42')]);
    const result = matchFilesToSites(['Riverside.kmz'], {
      records: RECORDS,
      siteIndex: INDEX,
      columnKeys: COLUMN_KEYS,
      alreadyAttached: attached,
    });

    const labels = result.sitesWithoutFile.map((entry) => entry.label);
    expect(labels).toEqual(['Plot 42']);
    expect(result.sitesWithoutFile[0]?.sourceRowNumbers).toEqual([4]);
  });
});

describe('the KMZ Files column', () => {
  it('says plainly when the column is present but empty', () => {
    const hint = inspectKmzColumn(RECORDS, COLUMN_KEYS);

    expect(hint.present).toBe(true);
    expect(hint.populatedCount).toBe(0);
    expect(hint.usable).toBe(false);
    // The whole point: nobody should read the UI and conclude the column is
    // being used when it is empty.
    expect(hint.note).toMatch(/exists but is empty/i);
    expect(hint.note).toMatch(/contributed nothing/i);
  });

  it('says plainly when there is no such column', () => {
    const hint = inspectKmzColumn(RECORDS, [key('state'), key('site')]);

    expect(hint.present).toBe(false);
    expect(hint.note).toMatch(/no kmz column/i);
  });

  it('is not consulted while empty', () => {
    const result = matchFilesToSites(['anything.kmz'], {
      records: RECORDS,
      siteIndex: INDEX,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.columnHint.usable).toBe(false);
    expect(result.matched).toHaveLength(0);
  });

  it('matches on the column once it holds filenames', () => {
    const populated = [
      record(2, {
        state: 'Gujarat',
        district: 'Kutch',
        site: 'Plot 42',
        'kmz files': 'north-boundary.kmz',
      }),
      record(3, { state: 'Gujarat', district: 'Kutch', site: 'Riverside' }),
    ];
    const index = indexSites(populated, COLUMNS);

    const result = matchFilesToSites(['north-boundary.kmz'], {
      records: populated,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.columnHint.usable).toBe(true);
    expect(result.matched[0]?.strategy).toBe('sheet-column');
    expect(result.matched[0]?.siteKey).toBe(makeSiteKey('Gujarat', 'Kutch', 'Plot 42'));
  });

  it('splits a cell listing several files', () => {
    const populated = [
      record(2, {
        state: 'Gujarat',
        district: 'Kutch',
        site: 'Plot 42',
        'kmz files': 'north.kmz; south.kmz',
      }),
    ];
    const index = indexSites(populated, COLUMNS);

    const result = matchFilesToSites(['south.kmz'], {
      records: populated,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched[0]?.strategy).toBe('sheet-column');
  });

  it('prefers the filename match over the column when both apply', () => {
    const populated = [
      record(2, {
        state: 'Gujarat',
        district: 'Kutch',
        site: 'Plot 42',
        'kmz files': 'Riverside.kmz',
      }),
      record(3, { state: 'Gujarat', district: 'Kutch', site: 'Riverside' }),
    ];
    const index = indexSites(populated, COLUMNS);

    const result = matchFilesToSites(['Riverside.kmz'], {
      records: populated,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched[0]?.strategy).toBe('filename');
    expect(result.matched[0]?.siteKey).toBe(makeSiteKey('Gujarat', 'Kutch', 'Riverside'));
  });
});

describe('containsWholeSite matching (tier 2)', () => {
  it('binds the exact real-world case that motivated this tier', () => {
    const records = [
      record(2, { state: 'Haryana', district: 'Karnal', site: 'Village Mardan Heri' }),
    ];
    const index = indexSites(records, COLUMNS);

    const result = matchFilesToSites(['Assandh, Karnal - Village Mardan Heri.kmz'], {
      records,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.strategy).toBe('filename-contains');
    expect(result.matched[0]?.siteKey).toBe(
      makeSiteKey('Haryana', 'Karnal', 'Village Mardan Heri'),
    );
  });

  it('still prefers an exact match over a contains match when both are available', () => {
    const records = [
      record(2, { state: 'Gujarat', district: 'Kutch', site: 'Riverside' }),
      record(3, { state: 'Gujarat', district: 'Kutch', site: 'New Riverside Extension' }),
    ];
    const index = indexSites(records, COLUMNS);

    // "Riverside" is exactly one site's name, and also a substring of another.
    // Tier 1 must win outright — tier 2 is never even consulted here.
    const result = matchFilesToSites(['Riverside.kmz'], {
      records,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched[0]?.strategy).toBe('filename');
    expect(result.matched[0]?.siteKey).toBe(makeSiteKey('Gujarat', 'Kutch', 'Riverside'));
  });

  it('does not match a short site name as a fragment of a longer word', () => {
    const records = [
      record(2, { state: 'Gujarat', district: 'Anand', site: 'An' }),
    ];
    const index = indexSites(records, COLUMNS);

    // "an" is a substring of "anand", but not a whole-word occurrence — a
    // naive .includes() would wrongly bind this; \b must refuse it.
    const result = matchFilesToSites(['Anand Survey Block.kmz'], {
      records,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('still refuses to guess when two sites are both found inside the filename', () => {
    const records = [
      record(2, { state: 'Punjab', district: 'Ludhiana', site: 'North Block' }),
      record(3, { state: 'Punjab', district: 'Ludhiana', site: 'South Block' }),
    ];
    const index = indexSites(records, COLUMNS);

    // Deliberately contrived so both names could plausibly appear, proving
    // ambiguity at tier 2 is handled the same way as ambiguity at tier 1:
    // neither auto-binds, and both are reported.
    const result = matchFilesToSites(['North Block and South Block, survey.kmz'], {
      records,
      siteIndex: index,
      columnKeys: COLUMN_KEYS,
    });

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]?.ambiguousMatches).toHaveLength(2);
  });
});
