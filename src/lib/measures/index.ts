/** Public entry point for measure selection and evaluation. */

export {
  buildMeasureCatalogue,
  findMeasure,
  inferAggregation,
  inferUnit,
} from './catalog';

export {
  aggregateMeasure,
  formatMeasureValue,
  measureUnitLabel,
  recordValue,
} from './compute';
export type { RecordValues, RegionValue } from './compute';

export { DERIVED_MEASURE_IDS, isPercentMeasure, sheetMeasureId } from './types';
export type {
  AggregationStrategy,
  DerivedMeasure,
  MeasureDescriptor,
  MeasureGroup,
  MeasureUnit,
  SheetMeasure,
} from './types';
