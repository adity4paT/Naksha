/**
 * Binding discovered columns to semantic roles.
 *
 * The invariants are arithmetic over specific quantities — a total, four tenure
 * components, a used/unused split — but CLAUDE.md forbids hardcoding the
 * sample's column names into logic. This module is the seam between the two: it
 * matches *patterns* against normalized keys and produces a binding that the
 * validator consumes.
 *
 * Everything here is a default. The binding is data, and the UI is expected to
 * let a user repoint any role at any column — which is the escape hatch for a
 * production file that names its columns something these patterns never
 * anticipated. A wrong binding must be correctable without a code change.
 */

import type { AreaComponentRole } from '@/lib/constants';
import type { ColumnDescriptor, NormalizedKey } from '@/types/schema';
import { effectiveRole } from '@/types/schema';

/** A role a measure column can fill in the invariants. */
export type MeasureSemanticRole =
  | AreaComponentRole
  | 'total'
  | 'used'
  | 'unused';

/**
 * Patterns tested in array order, first match winning.
 *
 * Order is load-bearing in exactly one place, and it is the kind of bug that
 * would otherwise survive review: `'unused land'` contains the substring
 * `'used'`. Testing `used` first binds the Unused Land column to the `used`
 * role, and the utilization invariant then checks `unused + unused === total`
 * — which fails on every row of a perfectly clean file. `unused` is therefore
 * tested first and `used` is additionally guarded by a negative lookbehind.
 */
const MEASURE_ROLE_PATTERNS: readonly { role: MeasureSemanticRole; pattern: RegExp }[] = [
  { role: 'total', pattern: /\btotal\b.*\b(land|area)\b|\b(land|area)\b.*\btotal\b/ },
  { role: 'unused', pattern: /\bun[\s-]?used\b/ },
  { role: 'used', pattern: /(?<!un)(?<!un[\s-])\bused\b/ },
  { role: 'private-sale', pattern: /\bprivate\b.*\bsale\b|\bsale\b.*\bprivate\b/ },
  { role: 'private-lease', pattern: /\bprivate\b.*\bleas/ },
  { role: 'govt-revenue', pattern: /\bgovt\b|\bgovernment\b|\brevenue\b/ },
  { role: 'forest', pattern: /\bforest\b/ },
];

/**
 * Patterns identifying the administrative dimensions.
 *
 * `state` is matched on the whole key first, then on a word boundary. The
 * two-stage test exists because a bare `includes('state')` also matches "Real
 * Estate" and "Statement", either of which would silently become the column
 * every row is dropped against.
 */
const STATE_PATTERNS: readonly RegExp[] = [/^state$/, /^state[\s/_-]/, /\bstate\b/];
const DISTRICT_PATTERNS: readonly RegExp[] = [/^district$/, /\bdistrict\b/, /\bdist\b/];

/** Columns bound to the roles the invariants and the resolver need. */
export interface ColumnBinding {
  readonly measures: Readonly<Partial<Record<MeasureSemanticRole, NormalizedKey>>>;
  /** The column whose emptiness drops a row. `null` when none was found. */
  readonly stateKey: NormalizedKey | null;
  readonly districtKey: NormalizedKey | null;
}

function firstMatch(
  columns: readonly ColumnDescriptor[],
  patterns: readonly RegExp[],
): NormalizedKey | null {
  for (const pattern of patterns) {
    const hit = columns.find((column) => pattern.test(column.normalizedKey));
    if (hit !== undefined) return hit.normalizedKey;
  }
  return null;
}

/**
 * Derive a default binding from discovered columns.
 *
 * Measure roles are drawn only from columns whose effective role is `measure`,
 * so a stray dimension cannot be summed. Each role binds at most once, and a
 * column already claimed cannot be claimed again — without that, `'Total Land
 * Area'` would match both `total` and, through a looser pattern, a component,
 * and the invariant would compare the total against itself.
 */
export function bindColumns(columns: readonly ColumnDescriptor[]): ColumnBinding {
  const measureColumns = columns.filter((column) => effectiveRole(column) === 'measure');
  const dimensionColumns = columns.filter((column) => effectiveRole(column) !== 'measure');

  const measures: Partial<Record<MeasureSemanticRole, NormalizedKey>> = {};
  const claimed = new Set<NormalizedKey>();

  for (const { role, pattern } of MEASURE_ROLE_PATTERNS) {
    if (measures[role] !== undefined) continue;

    const hit = measureColumns.find(
      (column) => !claimed.has(column.normalizedKey) && pattern.test(column.normalizedKey),
    );

    if (hit !== undefined) {
      measures[role] = hit.normalizedKey;
      claimed.add(hit.normalizedKey);
    }
  }

  return {
    measures,
    stateKey: firstMatch(dimensionColumns, STATE_PATTERNS),
    districtKey: firstMatch(dimensionColumns, DISTRICT_PATTERNS),
  };
}

/** The four tenure components, in the order the composition invariant sums them. */
export const COMPOSITION_ROLES: readonly MeasureSemanticRole[] = [
  'private-sale',
  'private-lease',
  'govt-revenue',
  'forest',
];

/** The two utilization roles. */
export const UTILIZATION_BINDING_ROLES: readonly MeasureSemanticRole[] = ['used', 'unused'];
