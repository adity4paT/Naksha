/** Public entry point for choropleth colour and classification. */

export {
  CHROME,
  DEFAULT_BIN_COUNT,
  DIVERGING_MIDPOINT,
  divergingRamp,
  NO_DATA,
  rampFor,
  SEQUENTIAL_RAMPS,
  SUPPORTED_BIN_COUNTS,
  ZERO_VALUE,
} from './palette';
export type { BinCount, ColorMode, ScaleKind } from './palette';

export {
  binIndexOf,
  BINNING_METHOD_LABELS,
  BINNING_METHODS,
  computeScale,
} from './binning';
export type { Bin, BinnedScale, BinningMethod } from './binning';
