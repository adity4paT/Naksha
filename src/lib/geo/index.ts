/**
 * Public entry point for boundary resolution.
 *
 * Typical use:
 * ```ts
 * const [index, aliases] = await Promise.all([loadBoundaryIndex(), loadAliasMap()]);
 * const resolutions = records.map((r) => resolveRecord(state(r), district(r), index, aliases.map));
 * const report = buildResolutionReport(resolutions, aliases.problems);
 * ```
 */

export {
  buildBoundaryIndex,
  districtCompositeKey,
  districtsIn,
  GEO_PATHS,
  loadBoundaryIndex,
} from './boundaries';
export type {
  BoundaryEntry,
  BoundaryFeature,
  BoundaryIndex,
  BoundaryProperties,
  GeoFetcher,
} from './boundaries';

export {
  EMPTY_ALIAS_MAP,
  loadAliasMap,
  lookupDistrictAlias,
  lookupStateAlias,
  parseAliasMap,
} from './aliases';
export type { AliasMap, AliasParseResult, DistrictAliasEntry } from './aliases';

export { levenshtein, similarityRatio } from './levenshtein';

export { isResolvablePlaceName, normalizePlaceName } from './normalize-place';

export {
  FUZZY_THRESHOLD,
  GEO_STAGE_LABELS,
  resolveDistrict,
  resolveRecord,
  resolveState,
} from './resolver';
export type { GeoStage, NameResolution, RecordResolution } from './resolver';

export { buildResolutionReport } from './report';
export type { ResolutionReport, ResolutionReportEntry } from './report';
