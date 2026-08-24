/**
 * Public entry point for the ingest pipeline.
 *
 * Consumers should import from here rather than reaching into individual
 * modules. `unsafeKey` is deliberately not re-exported — obtaining a
 * {@link import('@/types/schema').NormalizedKey} by assertion is a test-only
 * affordance, and keeping it off the public surface is what makes the branded
 * key worth having.
 */

export { parseWorkbook } from './parse';
export type { ParseOptions } from './parse';

export { bindColumns, COMPOSITION_ROLES, UTILIZATION_BINDING_ROLES } from './binding';
export type { ColumnBinding, MeasureSemanticRole } from './binding';

export { validateRecords } from './validate';

export { cleanString, normalizeHeader, synthesizeKey } from './normalize';

export { cleanCell, isNullToken, parseMeasure } from './values';

export {
  cardinalityRatioOf,
  describeColumn,
  inferRole,
  inferRoleFromHeader,
  isSerialIndex,
  profileColumn,
} from './profile';
export type { ColumnProfile, RoleInference } from './profile';

export { detectHeaderRow, selectSheet } from './sheet';
export type { SheetMatrix } from './sheet';
