/**
 * Invariant validation.
 *
 * Three rules govern this module, all from CLAUDE.md:
 *
 * 1. **Never throw.** A file where all 130 rows violate an invariant must still
 *    load. The violations are the finding; refusing to parse hides them.
 * 2. **Never auto-correct.** Nothing here returns a repaired figure. The report
 *    carries `expected`, `actual`, and `delta`, and no field a consumer could
 *    mistake for a fix.
 * 3. **Never conflate unevaluable with violated.** A row missing a component is
 *    skipped and counted separately. With 14 empty columns in the sample and
 *    production files expected to populate them unevenly, folding skips into
 *    failures would bury the real violations under noise.
 */

import { checkCompositionInvariant, checkUtilizationInvariant } from '@/lib/constants';
import type {
  InvariantId,
  NormalizedKey,
  ParsedRecord,
  ValidationEntry,
  ValidationReport,
} from '@/types/schema';
import type { ColumnBinding } from './binding';
import { COMPOSITION_ROLES } from './binding';
import { parseMeasure } from './values';

/** Read a measure cell from a record, coercing as the measure parser would. */
function readMeasure(record: ParsedRecord, key: NormalizedKey | undefined): number | null {
  if (key === undefined) return null;
  return parseMeasure(record.values[key]);
}

/**
 * Check both invariants across every record.
 *
 * An invariant with no columns bound to it is reported in `unboundInvariants`
 * rather than silently producing zero violations. The distinction matters: "no
 * violations" and "never ran" look identical in a count, and only one of them
 * means the data is clean.
 */
export function validateRecords(
  records: readonly ParsedRecord[],
  binding: ColumnBinding,
): ValidationReport {
  const entries: ValidationEntry[] = [];
  const checked: Record<InvariantId, number> = { composition: 0, utilization: 0 };
  const skipped: Record<InvariantId, number> = { composition: 0, utilization: 0 };
  const unbound: InvariantId[] = [];

  const totalKey = binding.measures.total;
  const componentKeys = COMPOSITION_ROLES.map((role) => binding.measures[role]).filter(
    (key): key is NormalizedKey => key !== undefined,
  );
  const usedKey = binding.measures.used;
  const unusedKey = binding.measures.unused;

  const canCheckComposition = totalKey !== undefined && componentKeys.length > 0;
  const canCheckUtilization =
    totalKey !== undefined && (usedKey !== undefined || unusedKey !== undefined);

  if (!canCheckComposition) unbound.push('composition');
  if (!canCheckUtilization) unbound.push('utilization');

  records.forEach((record, rowIndex) => {
    const total = readMeasure(record, totalKey);

    if (canCheckComposition) {
      const components = componentKeys.map((key) => parseMeasure(record.values[key]));
      const result = checkCompositionInvariant(components, total);

      if (result.status === 'indeterminate') {
        skipped.composition += 1;
      } else {
        checked.composition += 1;
        if (result.status === 'violated') {
          entries.push({
            rowIndex,
            sourceRowNumber: record.sourceRowNumber,
            invariant: 'composition',
            expected: result.expected ?? 0,
            actual: result.observed ?? 0,
            delta: result.delta ?? 0,
            columns: [...componentKeys, ...(totalKey === undefined ? [] : [totalKey])],
          });
        }
      }
    }

    if (canCheckUtilization) {
      const used = readMeasure(record, usedKey);
      const unused = readMeasure(record, unusedKey);
      const result = checkUtilizationInvariant(used, unused, total);

      if (result.status === 'indeterminate') {
        skipped.utilization += 1;
      } else {
        checked.utilization += 1;
        if (result.status === 'violated') {
          entries.push({
            rowIndex,
            sourceRowNumber: record.sourceRowNumber,
            invariant: 'utilization',
            expected: result.expected ?? 0,
            actual: result.observed ?? 0,
            delta: result.delta ?? 0,
            columns: [
              ...(usedKey === undefined ? [] : [usedKey]),
              ...(unusedKey === undefined ? [] : [unusedKey]),
              ...(totalKey === undefined ? [] : [totalKey]),
            ],
          });
        }
      }
    }
  });

  return {
    entries,
    checkedByInvariant: checked,
    skippedByInvariant: skipped,
    unboundInvariants: unbound,
  };
}
