/**
 * Public entry point for KMZ attachments.
 *
 * Consumers import from here rather than reaching into individual modules,
 * matching the convention in src/lib/ingest and src/lib/geo.
 */

export { kmzStore, KmzStoreUnavailableError, resetKmzStoreConnection } from './store';

export { parseKmz, findRootKmlEntry, INDIA_BOUNDS } from './parse';
export type { DomParserLike, KmzParseOptions, KmzParseResult } from './parse';

export {
  indexSites,
  makeSiteKey,
  normalizeForMatch,
  siteKeyForRecord,
  siteLabelForRecord,
} from './site-key';
export type { SiteIndex, SiteIndexEntry, SiteKeyColumns } from './site-key';

export { filenameStem, inspectKmzColumn, matchFilesToSites } from './match';
export type {
  KmzColumnHint,
  KmzMatchProposal,
  KmzMatchResult,
  KmzMatchStrategy,
  MatchOptions,
} from './match';

export { expandDroppedFiles } from './bulk';
export type { DroppedKmzFile, ExpandResult, SkippedDrop } from './bulk';

export {
  KMZ_BUNDLE_FORMAT_VERSION,
  KMZ_DB_NAME,
  KMZ_DB_VERSION,
  KMZ_STORE_NAME,
} from './types';
export type {
  KmzAttachment,
  KmzAttachmentMeta,
  KmzBundleEntry,
  KmzBundleManifest,
  KmzImportConflictPolicy,
  KmzImportEntryResult,
  KmzImportOutcome,
  KmzImportReport,
  KmzParseOutcome,
  KmzParseStatus,
  KmzStorageUsage,
  KmzStore,
  KmzWarning,
  KmzWarningCode,
  LatLng,
  ParsedKmzStatus,
  UnparsedKmzStatus,
} from './types';
