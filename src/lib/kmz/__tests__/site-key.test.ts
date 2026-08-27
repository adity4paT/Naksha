import { describe, expect, it } from 'vitest';

import type { CellValue, NormalizedKey, ParsedRecord, RecordId } from '@/types/schema';

import { indexSites, makeSiteKey, siteKeyForRecord } from '../site-key';
import type { SiteKeyColumns } from '../site-key';

const key = (value: string): NormalizedKey => value as NormalizedKey;

const COLUMNS: SiteKeyColumns = {
  stateKey: key('state'),
  districtKey: key('district'),
  siteKey: key('site'),
};

function record(row: number, values: Readonly<Record<string, CellValue>>): ParsedRecord {
  return {
    id: `row-${row}` as RecordId,
    sourceRowNumber: row,
    values: values as ParsedRecord['values'],
    warnings: [],
  };
}

describe('makeSiteKey', () => {
  it('is stable across formatting differences the ingest normalizer removes', () => {
    expect(makeSiteKey('Gujarat ', 'Kutch', 'Plot 42')).toBe(
      makeSiteKey('gujarat', 'KUTCH', 'plot  42'),
    );
  });

  it('keeps a fixed segment count so parts cannot slide between positions', () => {
    // A missing district must not let the site name occupy the district slot.
    expect(makeSiteKey('Gujarat', null, 'Kutch')).not.toBe(
      makeSiteKey('Gujarat', 'Kutch', null),
    );
  });

  it('separates sites of the same name in different districts', () => {
    expect(makeSiteKey('Gujarat', 'Kutch', 'Plot 42')).not.toBe(
      makeSiteKey('Maharashtra', 'Nagpur', 'Plot 42'),
    );
  });
});

describe('siteKeyForRecord', () => {
  it('does not depend on row position', () => {
    const atRow2 = record(2, { state: 'Gujarat', district: 'Kutch', site: 'Plot 42' });
    const sameSiteAtRow99 = record(99, {
      state: 'Gujarat',
      district: 'Kutch',
      site: 'Plot 42',
    });

    // This is the whole reason SiteKey exists rather than RecordId: inserting
    // rows above a site must not change what its attachment binds to.
    expect(siteKeyForRecord(atRow2, COLUMNS)).toBe(siteKeyForRecord(sameSiteAtRow99, COLUMNS));
    expect(atRow2.id).not.toBe(sameSiteAtRow99.id);
  });

  it('returns null when the record carries no site name', () => {
    expect(siteKeyForRecord(record(2, { state: 'Gujarat' }), COLUMNS)).toBeNull();
  });
});

describe('indexSites', () => {
  it('reports rows that collide on one key instead of picking one', () => {
    const records = [
      record(2, { state: 'Gujarat', district: 'Kutch', site: 'Plot 42' }),
      record(3, { state: 'Gujarat', district: 'Kutch', site: 'Plot 42' }),
      record(4, { state: 'Gujarat', district: 'Kutch', site: 'Riverside' }),
    ];
    const index = indexSites(records, COLUMNS);

    expect(index.entries).toHaveLength(2);
    expect(index.collisions).toHaveLength(1);
    expect(index.collisions[0]?.sourceRowNumbers).toEqual([2, 3]);
  });

  it('counts records that can hold no attachment', () => {
    const index = indexSites([record(2, { state: 'Gujarat' })], COLUMNS);
    expect(index.recordsWithoutSiteName).toBe(1);
    expect(index.entries).toHaveLength(0);
  });
});
