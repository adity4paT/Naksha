/**
 * Minting {@link SiteKey} — the durable identity a KMZ attachment binds to.
 *
 * The key is derived from content (state, district, site name) and never from
 * row position. See the SiteKey doc in src/types/schema.ts for why: RecordId is
 * row-<n>, so a key built on it silently rebinds every boundary below an
 * inserted row to the wrong parcel.
 *
 * NORMALIZATION IS BORROWED, NOT REWRITTEN.
 * Every string here passes through normalizeHeader from src/lib/ingest. That
 * function is built for headers, not values, so using it on a site name is a
 * mild stretch of its purpose — but it performs exactly the transformation
 * matching needs (Unicode whitespace collapsed, lowercased, leading and
 * trailing punctuation stripped), and the alternative is a second normalizer
 * that drifts out of step with the first. One normalizer with a slightly wide
 * remit beats two that disagree.
 *
 * A consequence worth knowing: normalizeHeader keeps INTERNAL punctuation, by
 * design, because ingest must hold "NA/CLU Not require" and "NA/CLU Pending"
 * apart. So a file named "Plot-42_Kutch.kmz" will not match a site recorded as
 * "Plot 42 Kutch". That is a miss, not a mismatch — it falls through to manual
 * assignment, which is the designed backstop. src/lib/geo/normalize-place.ts
 * strips internal punctuation and would match those, at the cost of also
 * collapsing site names that are genuinely distinct. Fuzzier matching is a
 * decision to take deliberately, not a default to drift into.
 */

import { normalizeHeader } from '@/lib/ingest';
import type { NormalizedKey, ParsedRecord, RecordId, SiteKey } from '@/types/schema';

/** Column bindings needed to identify a site. Mirrors DatasetBinding. */
export interface SiteKeyColumns {
  readonly stateKey: NormalizedKey | null;
  readonly districtKey: NormalizedKey | null;
  readonly siteKey: NormalizedKey | null;
}

/**
 * Normalize any string for matching, via the ingest normalizer.
 *
 * Returns '' rather than null so callers can test falsiness without a null
 * check at every site. The brand is dropped deliberately: the result is a
 * comparison key, not a column key, and letting a NormalizedKey escape from
 * here would blur what that brand promises.
 */
export function normalizeForMatch(value: string): string {
  return (normalizeHeader(value) as string | null) ?? '';
}

/** Read a cell as a display string, or null when absent or blank. */
function cellText(record: ParsedRecord, key: NormalizedKey | null): string | null {
  if (key === null) return null;
  const raw = record.values[key];
  if (raw === null || raw === undefined) return null;
  const text = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
  return text.trim().length === 0 ? null : text;
}

/**
 * Build a key from already-known parts.
 *
 * Shape mirrors districtCompositeKey in src/lib/geo/boundaries.ts: pipe-joined,
 * normalized components, in widest-to-narrowest order. Missing parts become
 * empty segments rather than being omitted, so the segment count is fixed and
 * "Kutch||Plot 42" cannot collide with a key whose district happens to be
 * spelled "Plot 42".
 */
export function makeSiteKey(
  state: string | null,
  district: string | null,
  site: string | null,
): SiteKey {
  const parts = [state, district, site].map((part) =>
    part === null ? '' : normalizeForMatch(part),
  );
  return parts.join('|') as SiteKey;
}

/**
 * The key for one record, or null when it carries no site name at all.
 *
 * Null is not a failure to report loudly — a workbook with no site column is a
 * legitimate shape, it simply cannot carry per-site attachments. Callers skip
 * those records rather than inventing an identity for them.
 */
export function siteKeyForRecord(
  record: ParsedRecord,
  columns: SiteKeyColumns,
): SiteKey | null {
  const site = cellText(record, columns.siteKey);
  if (site === null) return null;
  return makeSiteKey(
    cellText(record, columns.stateKey),
    cellText(record, columns.districtKey),
    site,
  );
}

/** Human-readable label for a site row. Falls back to the source row number. */
export function siteLabelForRecord(
  record: ParsedRecord,
  columns: SiteKeyColumns,
): string {
  return cellText(record, columns.siteKey) ?? `Row ${record.sourceRowNumber}`;
}

/* -------------------------------------------------------------------------- */
/* The site index — and the collision problem it makes visible                 */
/* -------------------------------------------------------------------------- */

/** One distinct site key, and every record that resolves to it. */
export interface SiteIndexEntry {
  readonly siteKey: SiteKey;
  /** Display label, taken from the first record with this key. */
  readonly label: string;
  /**
   * Every record sharing this key. Length > 1 is a collision — see
   * {@link SiteIndex.collisions}.
   */
  readonly recordIds: readonly RecordId[];
  readonly sourceRowNumbers: readonly number[];
}

/**
 * Distinct sites in a workbook, keyed for attachment binding.
 */
export interface SiteIndex {
  readonly bySiteKey: ReadonlyMap<SiteKey, SiteIndexEntry>;
  readonly entries: readonly SiteIndexEntry[];

  /**
   * Keys claimed by more than one row.
   *
   * This is the open question from the type phase, and it resolves honestly
   * rather than cleverly: when two rows share a state, district and site name,
   * nothing in their content distinguishes them, so an attachment bound to that
   * key belongs to all of them. The alternative — appending an occurrence index
   * to break the tie — would silently reintroduce positional identity through
   * the back door and rebind on the next row insertion, which is the exact
   * failure the content-derived key exists to prevent.
   *
   * So: bind to all, and surface the collision. The fix is in the workbook (two
   * parcels sharing a name need distinguishing names), and the UI can only help
   * if it says which rows collided instead of quietly picking one.
   */
  readonly collisions: readonly SiteIndexEntry[];

  /** Records with no site name. They cannot hold attachments. */
  readonly recordsWithoutSiteName: number;
}

/** Build the index. Cheap enough to recompute on every dataset commit. */
export function indexSites(
  records: readonly ParsedRecord[],
  columns: SiteKeyColumns,
): SiteIndex {
  const bySiteKey = new Map<SiteKey, SiteIndexEntry>();
  let recordsWithoutSiteName = 0;

  for (const record of records) {
    const key = siteKeyForRecord(record, columns);
    if (key === null) {
      recordsWithoutSiteName += 1;
      continue;
    }

    const existing = bySiteKey.get(key);
    if (existing === undefined) {
      bySiteKey.set(key, {
        siteKey: key,
        label: siteLabelForRecord(record, columns),
        recordIds: [record.id],
        sourceRowNumbers: [record.sourceRowNumber],
      });
      continue;
    }

    bySiteKey.set(key, {
      ...existing,
      recordIds: [...existing.recordIds, record.id],
      sourceRowNumbers: [...existing.sourceRowNumbers, record.sourceRowNumber],
    });
  }

  const entries = [...bySiteKey.values()];
  return {
    bySiteKey,
    entries,
    collisions: entries.filter((entry) => entry.recordIds.length > 1),
    recordsWithoutSiteName,
  };
}
