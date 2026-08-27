/**
 * Binding uploaded files to sites.
 *
 * Three strategies, tried in order, each weaker than the last:
 *
 *   1. FILENAME STEM. The file is called what the site is called. This is how
 *      surveyors actually name things, and it resolves the overwhelming
 *      majority of a bulk drop.
 *
 *   2. THE SHEET COLUMN. The workbook has a "KMZ Files" column. In the current
 *      sample it is entirely empty, and CLAUDE.md says not to build against it.
 *      So it is read as a HINT and nothing more: if it holds filenames, they are
 *      matched as filenames. It is never treated as a source of truth, and
 *      {@link KmzColumnHint.note} states plainly when it contributed nothing, so
 *      that no one reading the UI concludes the column is wired up when it is
 *      not.
 *
 *   3. MANUAL. Whatever is left. Not a failure mode — it is the designed
 *      backstop, and the reason matching is allowed to be strict rather than
 *      clever. A wrong automatic binding puts the wrong boundary on the wrong
 *      parcel and looks correct; an unmatched file sits in a list until someone
 *      says where it goes.
 *
 * AMBIGUITY IS NEVER RESOLVED BY GUESSING. When a filename matches two sites,
 * both are recorded and the file goes to manual. Picking the first would be
 * indistinguishable from a correct match at a glance, and wrong half the time.
 */

import type { NormalizedKey, ParsedRecord, SiteKey } from '@/types/schema';

import { normalizeForMatch } from './site-key';
import type { SiteIndex, SiteIndexEntry } from './site-key';

/** How a file came to be bound to a site. */
export type KmzMatchStrategy = 'filename' | 'sheet-column' | 'manual';

/** One file, and where matching thinks it belongs. */
export interface KmzMatchProposal {
  readonly filename: string;
  /** Null when nothing matched, or when the match was ambiguous. */
  readonly siteKey: SiteKey | null;
  readonly strategy: KmzMatchStrategy | null;
  /** Display label of the matched site, when there is one. */
  readonly siteLabel: string | null;
  /**
   * Sites this filename matched when it matched more than one.
   *
   * Non-empty means the file was deliberately left unmatched, not that matching
   * failed to find anything.
   */
  readonly ambiguousMatches: readonly SiteIndexEntry[];
}

/** What the "KMZ Files" column contributed, stated plainly. */
export interface KmzColumnHint {
  /** A column whose header mentions KMZ exists in the workbook. */
  readonly present: boolean;
  readonly key: NormalizedKey | null;
  /** Rows with a non-blank value. Zero in the current sample. */
  readonly populatedCount: number;
  /** Present AND populated. Only then does strategy 2 do anything. */
  readonly usable: boolean;
  /** One line for the UI and the console. Never silently omitted. */
  readonly note: string;
}

export interface KmzMatchResult {
  readonly proposals: readonly KmzMatchProposal[];
  readonly matched: readonly KmzMatchProposal[];
  readonly unmatched: readonly KmzMatchProposal[];
  /** Sites with no file in this batch and no attachment already stored. */
  readonly sitesWithoutFile: readonly SiteIndexEntry[];
  readonly columnHint: KmzColumnHint;
}

/* -------------------------------------------------------------------------- */
/* Filenames                                                                   */
/* -------------------------------------------------------------------------- */

/** Drop the extension and any directory prefix a zip entry carries. */
export function filenameStem(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.replace(/\.(kmz|kml)$/i, '');
}

/* -------------------------------------------------------------------------- */
/* The KMZ Files column                                                        */
/* -------------------------------------------------------------------------- */

/** Header keys that name the KMZ column. Discovered, never hardcoded to one. */
const KMZ_COLUMN_PATTERN = /\bkmz\b/;

/**
 * Inspect the workbook's KMZ column without depending on it.
 *
 * Returns a report even when the column is absent, because "there is no such
 * column" and "the column is empty" are different facts and the UI should be
 * able to say which one it is looking at.
 */
export function inspectKmzColumn(
  records: readonly ParsedRecord[],
  columnKeys: readonly NormalizedKey[],
): KmzColumnHint {
  const key = columnKeys.find((candidate) => KMZ_COLUMN_PATTERN.test(candidate)) ?? null;

  if (key === null) {
    return {
      present: false,
      key: null,
      populatedCount: 0,
      usable: false,
      note: 'No KMZ column found in this workbook. Files are matched by filename only.',
    };
  }

  const populatedCount = records.reduce((count, record) => {
    const value = record.values[key];
    if (value === null || value === undefined) return count;
    return String(value).trim().length === 0 ? count : count + 1;
  }, 0);

  if (populatedCount === 0) {
    return {
      present: true,
      key,
      populatedCount: 0,
      usable: false,
      // Stated in full because the failure this prevents is someone assuming the
      // column is doing work it is not. It is present, it is empty, and it
      // contributed nothing to matching.
      note: `The "${key}" column exists but is empty in all ${records.length} rows, so it contributed nothing to matching. Files were matched by filename only.`,
    };
  }

  return {
    present: true,
    key,
    populatedCount,
    usable: true,
    note: `The "${key}" column has values in ${populatedCount} of ${records.length} rows. They are read as filename hints only, never as a source of truth.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/** Group sites by their normalized name, so collisions become visible. */
function indexByNormalizedLabel(
  siteIndex: SiteIndex,
): ReadonlyMap<string, readonly SiteIndexEntry[]> {
  const byLabel = new Map<string, SiteIndexEntry[]>();
  for (const entry of siteIndex.entries) {
    const normalized = normalizeForMatch(entry.label);
    if (normalized === '') continue;
    const bucket = byLabel.get(normalized);
    if (bucket === undefined) byLabel.set(normalized, [entry]);
    else bucket.push(entry);
  }
  return byLabel;
}

/**
 * Map filename hints from the sheet column to their site keys.
 *
 * Only called when the column is populated. Values are normalized as filename
 * stems, so "Plot42.kmz" in a cell matches a file named "plot42.KMZ".
 */
function indexByColumnHint(
  records: readonly ParsedRecord[],
  siteIndex: SiteIndex,
  key: NormalizedKey,
): ReadonlyMap<string, readonly SiteIndexEntry[]> {
  const byHint = new Map<string, SiteIndexEntry[]>();
  const entryForRecord = new Map<string, SiteIndexEntry>();
  for (const entry of siteIndex.entries) {
    for (const recordId of entry.recordIds) entryForRecord.set(recordId, entry);
  }

  for (const record of records) {
    const raw = record.values[key];
    if (raw === null || raw === undefined) continue;
    const entry = entryForRecord.get(record.id);
    if (entry === undefined) continue;

    // A cell may list several files. Split on the separators that appear in
    // spreadsheet lists rather than assuming one value per cell.
    for (const piece of String(raw).split(/[,;|\n]/)) {
      const normalized = normalizeForMatch(filenameStem(piece.trim()));
      if (normalized === '') continue;
      const bucket = byHint.get(normalized);
      if (bucket === undefined) byHint.set(normalized, [entry]);
      else if (!bucket.includes(entry)) bucket.push(entry);
    }
  }
  return byHint;
}

export interface MatchOptions {
  readonly records: readonly ParsedRecord[];
  readonly siteIndex: SiteIndex;
  readonly columnKeys: readonly NormalizedKey[];
  /** Sites that already hold an attachment, excluded from sitesWithoutFile. */
  readonly alreadyAttached?: ReadonlySet<SiteKey>;
}

/**
 * Propose a binding for every filename in a batch.
 *
 * Pure: it touches no storage and parses nothing, so it can run on a drop
 * before a single byte is read. That is what lets the UI show the user what
 * will happen before it happens.
 */
export function matchFilesToSites(
  filenames: readonly string[],
  options: MatchOptions,
): KmzMatchResult {
  const { records, siteIndex, columnKeys, alreadyAttached } = options;

  const columnHint = inspectKmzColumn(records, columnKeys);
  const byLabel = indexByNormalizedLabel(siteIndex);
  const byHint =
    columnHint.usable && columnHint.key !== null
      ? indexByColumnHint(records, siteIndex, columnHint.key)
      : null;

  const proposals: KmzMatchProposal[] = filenames.map((filename) => {
    const stem = normalizeForMatch(filenameStem(filename));

    const attempt = (
      bucket: readonly SiteIndexEntry[] | undefined,
      strategy: KmzMatchStrategy,
    ): KmzMatchProposal | null => {
      if (bucket === undefined || bucket.length === 0) return null;
      if (bucket.length > 1) {
        return {
          filename,
          siteKey: null,
          strategy: null,
          siteLabel: null,
          ambiguousMatches: bucket,
        };
      }
      const entry = bucket[0] as SiteIndexEntry;
      return {
        filename,
        siteKey: entry.siteKey,
        strategy,
        siteLabel: entry.label,
        ambiguousMatches: [],
      };
    };

    // Strategy 1, then 2. Order matters: the filename is what the surveyor
    // controlled, the column is what someone typed into a spreadsheet later.
    return (
      attempt(byLabel.get(stem), 'filename') ??
      (byHint === null ? null : attempt(byHint.get(stem), 'sheet-column')) ?? {
        filename,
        siteKey: null,
        strategy: null,
        siteLabel: null,
        ambiguousMatches: [],
      }
    );
  });

  const matched = proposals.filter((proposal) => proposal.siteKey !== null);
  const claimed = new Set<string>(matched.map((proposal) => proposal.siteKey as string));

  const sitesWithoutFile = siteIndex.entries.filter(
    (entry) =>
      !claimed.has(entry.siteKey) && alreadyAttached?.has(entry.siteKey) !== true,
  );

  return {
    proposals,
    matched,
    unmatched: proposals.filter((proposal) => proposal.siteKey === null),
    sitesWithoutFile,
    columnHint,
  };
}
