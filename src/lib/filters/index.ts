/** Public entry point for the filter cascade. */

export {
  CASCADE_LEVELS,
  DIMENSION_LABELS,
  EMPTY_SELECTIONS,
  FILTER_DIMENSIONS,
  isIndependent,
  upstreamOf,
} from './types';
export type {
  CascadeLevel,
  FacetOption,
  FacetRow,
  FacetView,
  FilterDimension,
  FilterSelections,
  MeasureBounds,
  OrphanedSelection,
  RangeSelection,
} from './types';

export {
  activeFilterCount,
  applyFilters,
  availableValues,
  buildAllFacets,
  buildFacetView,
  CASCADE_ORDER,
  computeActive,
  isRangeActive,
  matchesRanges,
  measureBounds,
  restoreActionFor,
  rowsMatching,
} from './facets';

export {
  parseFromQuery,
  readFromLocation,
  serializeToQuery,
  SERIALIZABLE_KEYS,
  URL_LENGTH_BUDGET,
  writeToLocation,
} from './url';
export type { SerializableViewState } from './url';
