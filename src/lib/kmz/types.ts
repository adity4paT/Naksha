/**
 * Per-site KMZ attachments — identity, storage shape, and bundle format.
 *
 * Phase one of the V2 KMZ work. It stores files and binds them to sites. It does
 * not parse them, does not extract geometry, and does not construct a
 * {@link SurveyedLocation}. Those come next; the type seam for them is already
 * open in `src/types/schema.ts`.
 *
 * Two rules shape everything below.
 *
 *  1. THE STORED BYTES ARE THE RECORD OF TRUTH.
 *     {@link KmzAttachment.bytes} is the surveyor's file, unmodified. Download
 *     returns exactly what was uploaded. We never re-serialize from parsed
 *     GeoJSON, because a KMZ is a zip container whose doc.kml sits alongside
 *     styling, ground overlays, embedded imagery and vendor extensions. A
 *     GeoJSON round-trip keeps the coordinates and silently discards the rest,
 *     handing the user a file that opens, looks approximately right, and is not
 *     the document their surveyor signed off. When parsed geometry eventually
 *     exists it is a derived cache stored next to the bytes, never a
 *     replacement for them.
 *
 *  2. BINDINGS MUST SURVIVE A RE-UPLOAD.
 *     Attachments are keyed by {@link SiteKey} — content-derived — and never by
 *     {@link RecordId}, which is row-<n> and therefore changes meaning the
 *     moment someone inserts a row in the workbook. See the SiteKey doc for why
 *     that distinction is a correctness concern and not a style preference.
 *
 * Storage is per-browser and per-origin. Nothing here is uploaded anywhere; the
 * bundle export exists precisely because the data cannot travel any other way.
 */

import type { RecordId, SiteKey, SurveyedLocation } from '@/types/schema';

/* -------------------------------------------------------------------------- */
/* Geometry primitives                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A point in degrees, named rather than positional.
 *
 * Deliberately not a GeoJSON Point, whose coordinates are [lng, lat] while every
 * map API in common use takes (lat, lng). Naming the components makes the axis
 * order unmistakable at the call site. Convert to a GeoJSON Point at the
 * boundary where {@link SurveyedLocation} is constructed — one explicit
 * conversion in one place, rather than an ordering convention every reader has
 * to hold in their head.
 */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/* -------------------------------------------------------------------------- */
/* Parse status — the next phase's seam                                        */
/* -------------------------------------------------------------------------- */

/**
 * How far the parser got with an attachment.
 *
 * unparsed    — stored, never opened. The only status phase one produces.
 * parsed      — geometry extracted; {@link KmzAttachment.centroid} is set.
 * unparseable — opened and rejected. The bytes are still kept: a file we cannot
 *               read is not a file the user should lose, and the fault is far
 *               more likely to be our parser than their data.
 *
 * The same seam idiom as LocationResult: the full union is declared so that
 * consumers switch exhaustively from day one, while producers in this phase are
 * typed to return the narrowed {@link UnparsedKmzStatus} and therefore cannot
 * invent a status no code path can yet justify.
 */
export type KmzParseStatus = 'unparsed' | 'parsed' | 'unparseable';

/**
 * A record that has been stored but not opened.
 *
 * No longer the only status a producer may emit — parsing landed on 2026-08-27
 * and src/lib/kmz/parse.ts returns {@link ParsedKmzStatus}. This alias survives
 * because the state it names is still real: a bundle exported before parsing
 * existed restores entries with no centroid, and they must round-trip rather
 * than be silently promoted to 'parsed'.
 */
export type UnparsedKmzStatus = Extract<KmzParseStatus, 'unparsed'>;

/**
 * What the parser may return.
 *
 * Never 'unparsed', which means "not yet opened" and is a statement about the
 * store rather than about a file. A parser that returned it would be reporting
 * that it had not run.
 */
export type ParsedKmzStatus = Exclude<KmzParseStatus, 'unparsed'>;

/** Why an attachment could not be fully read. */
export type KmzWarningCode =
  /** Not a zip container at all. Read as plain KML instead. */
  | 'not-a-zip'
  /** Zip opened, but holds no .kml at its root. */
  | 'no-kml-entry'
  /** More than one root-level .kml; the first was used, per the KMZ spec. */
  | 'multiple-kml-entries'
  /**
   * No Placemark carried geometry.
   *
   * Widened from 'no-polygon' when parsing landed on 2026-08-27. The validity
   * rule is "at least one Placemark with geometry", so a file of points or
   * paths is valid and yields a representative point like any other. Only a
   * file with no geometry at all fails, which is why the code no longer names
   * polygons specifically.
   */
  | 'no-placemark-geometry'
  /**
   * Coordinates outside plausible bounds for India.
   *
   * Usually a lat/lng transposition rather than a foreign file, since KML
   * stores longitude first. The parser distinguishes the two and says which.
   */
  | 'coordinates-out-of-range'
  /**
   * A NetworkLink is present.
   *
   * Reported, never followed. Fetching it would issue a request to a
   * third-party server from a page holding confidential land data.
   */
  | 'network-link'
  /** Anything else, with detail in the message. */
  | 'unreadable';

/** A single problem found in one attachment. Never a reason to drop the bytes. */
export interface KmzWarning {
  readonly code: KmzWarningCode;
  /** Human-readable, shown next to the attachment. */
  readonly message: string;
}

/* -------------------------------------------------------------------------- */
/* The stored record                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One KMZ bound to one site. The IndexedDB record, verbatim.
 *
 * siteKey is the primary key, so a site holds at most one attachment and a
 * second upload for the same site replaces the first. That matches the brief
 * (KMZ attachment per site), but note the sheet column is named "KMZ Files",
 * plural. If a site can genuinely have several, this needs a compound key
 * (siteKey + filename) and a change to every signature below — much cheaper to
 * settle now than after 130 files are stored.
 */
export interface KmzAttachment {
  readonly siteKey: SiteKey;

  /** The uploaded filename, for display and for the download attribute. */
  readonly filename: string;

  /**
   * The original file, byte for byte. See rule 1 in the module doc.
   *
   * Held as a Blob rather than an ArrayBuffer so the browser can keep it on disk
   * instead of in the JS heap — across ~130 files that is the difference between
   * a working tab and an out-of-memory one.
   */
  readonly bytes: Blob;

  /** bytes.size, denormalized so listings need not open every Blob. */
  readonly sizeBytes: number;

  /** ISO 8601. */
  readonly uploadedAt: string;

  /**
   * Representative point, once parsed. Always null in phase one, since nothing
   * opens the file — the field exists now so the record shape does not change
   * under an already-populated store when parsing lands.
   */
  readonly centroid: LatLng | null;

  readonly parseStatus: KmzParseStatus;
  readonly parseWarnings: readonly KmzWarning[];

  /**
   * SHA-256 of bytes, lowercase hex.
   *
   * NOT in the original spec — flagged for a keep-or-drop call. It earns its
   * place because byte-identical is a promise this module makes and otherwise
   * never checks: the bundle importer can verify a restored file matches what
   * was exported, so a truncated or re-encoded zip fails loudly at import rather
   * than surfacing as a wrong boundary on a map months later. Cost is one
   * crypto.subtle.digest per upload.
   */
  readonly sha256: string;
}

/**
 * An attachment without its bytes.
 *
 * Every listing, badge and storage readout uses this. Reading full records to
 * render a list would pull all 130 Blobs into memory to display filenames.
 */
export type KmzAttachmentMeta = Omit<KmzAttachment, 'bytes'>;

/**
 * What the store persists out of a parse.
 *
 * Declared here rather than imported from ./parse.ts so the storage contract
 * does not depend on the parser. The store's job is to keep whatever verdict it
 * is handed next to the bytes; it has no opinion on how that verdict was
 * reached, and a future parser rewrite should not ripple into this interface.
 */
export interface KmzParseOutcome {
  readonly centroid: LatLng | null;
  readonly parseStatus: KmzParseStatus;
  readonly parseWarnings: readonly KmzWarning[];
}

/* -------------------------------------------------------------------------- */
/* Storage usage                                                               */
/* -------------------------------------------------------------------------- */

/**
 * What the storage readout shows.
 *
 * usageBytes and quotaBytes come from navigator.storage.estimate() and are
 * origin-wide, not KMZ-only — they include the app shell and anything else this
 * origin stores. Present them as such rather than implying the KMZ store is the
 * whole of it.
 */
export interface KmzStorageUsage {
  readonly attachmentCount: number;
  /** Sum of sizeBytes across attachments. Exact, unlike the estimate below. */
  readonly totalBytes: number;
  /** Origin-wide estimate, or null where the Storage API is unavailable. */
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  /**
   * Whether the origin has durable storage (navigator.storage.persisted()).
   *
   * This matters more than it looks. Without it the browser may evict the entire
   * store under disk pressure — no warning, no recovery, 130 confidential files
   * gone. The UI should request persistence and say plainly when it was refused,
   * because a refused request is exactly the moment the bundle export stops
   * being a convenience and becomes the only backup.
   */
  readonly persisted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Bundle export / import                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bumped whenever the manifest shape changes.
 *
 * The importer must refuse a version it does not recognise rather than guess at
 * the fields, so an older build cannot half-read a newer bundle.
 */
export const KMZ_BUNDLE_FORMAT_VERSION = 1;

/** One entry in the bundle manifest. */
export interface KmzBundleEntry {
  readonly siteKey: SiteKey;
  /** Path inside the zip, e.g. files/<sha256>.kmz. */
  readonly path: string;
  /** The original upload filename, restored on import. */
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly uploadedAt: string;
  readonly centroid: LatLng | null;
  readonly parseStatus: KmzParseStatus;
  readonly parseWarnings: readonly KmzWarning[];
}

/**
 * manifest.json at the root of an exported bundle.
 *
 * The bundle exists because storage is per-browser: without it every user on
 * every machine re-uploads all 130 files, and any storage eviction is
 * unrecoverable.
 */
export interface KmzBundleManifest {
  readonly formatVersion: typeof KMZ_BUNDLE_FORMAT_VERSION;
  /** ISO 8601. */
  readonly exportedAt: string;
  readonly entries: readonly KmzBundleEntry[];
  readonly totalSizeBytes: number;

  /**
   * Always true, and typed as the literal so it cannot be written otherwise.
   *
   * A bundle is one file containing every surveyed boundary the user holds — the
   * most concentrated form this confidential data ever takes, and the only form
   * that leaves the browser. The flag lives in the manifest so the warning
   * survives the file itself: an importer, a reviewer, or whoever finds the zip
   * on a shared drive can see what it holds without opening a single boundary.
   * CLAUDE.md confidentiality is why *.kmz is gitignored; this is that same rule
   * applied to the aggregate, which is strictly more sensitive than any part.
   *
   * The export UI must state this before the download starts, not after.
   */
  readonly containsConfidentialBoundaries: true;
}

/** What to do when an imported entry names a site that already has one. */
export type KmzImportConflictPolicy =
  /** Keep what is stored; count the incoming one as skipped. */
  | 'keep-existing'
  /** Overwrite with the incoming attachment. */
  | 'replace-existing';

/** Per-entry outcome, so the report can be specific rather than a bare count. */
export type KmzImportOutcome =
  | 'imported'
  | 'replaced'
  | 'skipped-conflict'
  /** sha256 did not match the bytes in the zip. Never stored. */
  | 'rejected-checksum'
  /** The manifest named a path the zip does not contain. */
  | 'rejected-missing-file';

export interface KmzImportEntryResult {
  readonly siteKey: SiteKey;
  readonly filename: string;
  readonly outcome: KmzImportOutcome;
  /** Set for the rejected outcomes, null otherwise. */
  readonly detail: string | null;
}

export interface KmzImportReport {
  readonly results: readonly KmzImportEntryResult[];
  readonly importedCount: number;
  readonly replacedCount: number;
  readonly skippedCount: number;
  readonly rejectedCount: number;
  /**
   * Entries whose siteKey matches no site in the loaded workbook.
   *
   * Not an error, and not dropped. A bundle may legitimately be imported before
   * the workbook, or hold sites from a wider dataset than the one loaded. They
   * are stored and surface as soon as a matching site appears. Retaining orphans
   * mirrors how the filter layer already treats values that match nothing.
   */
  readonly orphanedSiteKeys: readonly SiteKey[];
}

/* -------------------------------------------------------------------------- */
/* Store contract                                                              */
/* -------------------------------------------------------------------------- */

/** IndexedDB database name. Origin-scoped; nothing else writes to it. */
export const KMZ_DB_NAME = 'naksha-kmz';
/** Bump only alongside an onupgradeneeded migration. */
export const KMZ_DB_VERSION = 1;
/** Object store, keyed by {@link SiteKey}. */
export const KMZ_STORE_NAME = 'attachments';

/**
 * The storage API, implemented in ./store.ts.
 *
 * Declared as an interface so the UI depends on the contract rather than on the
 * IndexedDB code, and so tests can substitute an in-memory implementation
 * without standing up a fake IndexedDB.
 */
export interface KmzStore {
  /**
   * Store a file against a site, replacing any existing attachment.
   *
   * outcome carries what the parser derived. Omit it to store the bytes without
   * opening them, which lands the record as 'unparsed' — the state a bulk
   * import uses when it defers parsing, and the reason that status still exists.
   */
  put(
    siteKey: SiteKey,
    bytes: Blob,
    filename: string,
    outcome?: KmzParseOutcome,
  ): Promise<KmzAttachmentMeta>;

  /** Full record including bytes. Null when the site has no attachment. */
  get(siteKey: SiteKey): Promise<KmzAttachment | null>;

  /** The original bytes, for download. See rule 1 in the module doc. */
  getBytes(siteKey: SiteKey): Promise<Blob | null>;

  /** Every attachment as metadata, without bytes. */
  list(): Promise<readonly KmzAttachmentMeta[]>;

  /** Metadata for many sites at once, for rendering attachment badges. */
  listFor(siteKeys: readonly SiteKey[]): Promise<readonly KmzAttachmentMeta[]>;

  remove(siteKey: SiteKey): Promise<void>;

  /** Backs the Clear all KMZ data control. Irreversible without a bundle. */
  clearAll(): Promise<void>;

  usage(): Promise<KmzStorageUsage>;

  /**
   * Ask the browser for durable storage. Idempotent; returns the resulting
   * state. See {@link KmzStorageUsage.persisted}.
   */
  requestPersistence(): Promise<boolean>;

  /** Zip of every attachment plus manifest.json. */
  exportBundle(): Promise<Blob>;

  /**
   * Restore a bundle.
   *
   * knownSiteKeys is the set of sites the loaded workbook contains, used only
   * to populate {@link KmzImportReport.orphanedSiteKeys}. Omit it and nothing is
   * reported as orphaned: the store cannot know which sites exist, and guessing
   * would be worse than declining to answer.
   */
  importBundle(
    bundle: Blob,
    policy: KmzImportConflictPolicy,
    knownSiteKeys?: ReadonlySet<SiteKey>,
  ): Promise<KmzImportReport>;
}

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The same tripwire idiom as src/types/schema.ts, for the same reason: a seam is
 * only real if something fails the build when it silently closes.
 *
 * _ParserProducesTerminalStatus replaced _PhaseOneStatusIsUnparsedOnly on
 * 2026-08-27, when parsing landed. The original guard asserted that the only
 * constructible status was 'unparsed', which was true while nothing opened a
 * file. It is now false, and worth noting that it would NOT have failed the
 * build on its own: it constrained the alias rather than the producer, so
 * widening what the parser emits left it quietly passing. Weak guards read
 * exactly like strong ones in a diff. Its replacement pins the parser's actual
 * range, so collapsing 'unparseable' into 'parsed' — the plausible edit that
 * would turn every broken file into a silently valid one — fails to compile.
 *
 * _ParsedArmExists fails if the union is collapsed back to a single member,
 * which would delete the seam outright.
 *
 * _AttachmentIsNotKeyedByRecordId is the one worth reading twice. It fails if
 * siteKey is ever retyped to {@link RecordId} — the positional key — an easy and
 * plausible edit that would compile cleanly everywhere else while silently
 * rebinding surveyed boundaries to the wrong parcels on the next workbook that
 * has a row inserted. There is no runtime symptom for that failure, which is
 * exactly why it needs a compile-time one.
 */
type Assert<T extends true> = T;
type Equals<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
  ? true
  : false;

export type _ParserProducesTerminalStatus = Assert<
  Equals<ParsedKmzStatus, 'parsed' | 'unparseable'>
>;
export type _ParsedArmExists = Assert<Equals<Extract<KmzParseStatus, 'parsed'>, 'parsed'>>;
export type _AttachmentIsNotKeyedByRecordId = Assert<
  Equals<Equals<KmzAttachment['siteKey'], RecordId>, false>
>;
