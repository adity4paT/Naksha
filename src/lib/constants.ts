/**
 * Unit conversion factors and the ingest invariants.
 *
 * CLAUDE.md: "All area math in acres internally. Convert only at the render
 * boundary." Nothing in this module converts on ingest — the converters exist
 * for the display layer to call, and for the parser to normalize a production
 * file that arrives stating hectares.
 *
 * The invariant predicates are deliberately numeric-only. They take numbers,
 * never column names, because columns are discovered at upload time and the
 * sample's headers must not leak into logic. Binding discovered columns to the
 * semantic roles below is the parser's job; see {@link AREA_COMPONENT_ROLES}.
 */

/* -------------------------------------------------------------------------- */
/* Conversion factors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Square metres in one international acre. Exact by definition:
 * 1 acre = 1/640 sq mi = 4046.8564224 m², since 1 international yard ≡ 0.9144 m.
 *
 * India's survey records historically used the Indian survey foot, whose acre
 * differs in about the ninth significant figure. Irrelevant at the precision
 * land MIS data is stated to, and we standardise on the international acre.
 */
export const SQUARE_METRES_PER_ACRE = 4046.8564224;

/** Hectares in one acre. Exact: 4046.8564224 / 10 000. */
export const HECTARES_PER_ACRE = 0.40468564224;

/** Square feet in one acre. Exact by definition. */
export const SQUARE_FEET_PER_ACRE = 43_560;

/** Square yards ("gaj") in one acre. Exact by definition. */
export const SQUARE_YARDS_PER_ACRE = 4_840;

/** Acres in one square kilometre. 1e6 / 4046.8564224. */
export const ACRES_PER_SQUARE_KILOMETRE = 247.10538146716533;

/**
 * Guntha in one acre. Exact by definition (1 guntha = 121 sq yd).
 * Standard across Maharashtra, Karnataka, Gujarat, and Andhra Pradesh records.
 */
export const GUNTHA_PER_ACRE = 40;

/**
 * Cents in one acre. Exact by definition. Standard in Tamil Nadu, Kerala,
 * Karnataka, and Andhra Pradesh records.
 */
export const CENTS_PER_ACRE = 100;

/**
 * Deliberately absent: bigha, katha, and biswa.
 *
 * These have no fixed value — a bigha is roughly 0.25 acre in West Bengal,
 * 0.625 in Uttar Pradesh, and 0.4 in Rajasthan, and varies again by district
 * within those states. Publishing a single factor would produce confidently
 * wrong acreage. If a production file arrives stating bigha, it needs a
 * per-state factor supplied by the user, not a constant here.
 */
export const REGIONALLY_VARIABLE_UNITS = ['bigha', 'katha', 'biswa'] as const;

/* -------------------------------------------------------------------------- */
/* Converters — call these at the render boundary, not during ingest           */
/* -------------------------------------------------------------------------- */

export const acresToHectares = (acres: number): number => acres * HECTARES_PER_ACRE;
export const hectaresToAcres = (hectares: number): number => hectares / HECTARES_PER_ACRE;

export const acresToSquareMetres = (acres: number): number => acres * SQUARE_METRES_PER_ACRE;
export const squareMetresToAcres = (m2: number): number => m2 / SQUARE_METRES_PER_ACRE;

export const acresToSquareKilometres = (acres: number): number =>
  acres / ACRES_PER_SQUARE_KILOMETRE;

export const acresToSquareFeet = (acres: number): number => acres * SQUARE_FEET_PER_ACRE;
export const acresToGuntha = (acres: number): number => acres * GUNTHA_PER_ACRE;
export const acresToCents = (acres: number): number => acres * CENTS_PER_ACRE;

/* -------------------------------------------------------------------------- */
/* Comparison tolerance                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Absolute tolerance, in acres, when comparing two area figures.
 *
 * 0.005 acres ≈ 20 m², half of the last place when a figure is stated to two
 * decimals. It absorbs the rounding in a source file without absorbing a real
 * data-entry error, which in this data is typically whole acres.
 *
 * Caveat for production files: the composition invariant sums four independently
 * rounded components, so worst-case legitimate rounding drift is four times this
 * bound. If real files start reporting spurious violations clustered just above
 * the threshold, this is the knob — and the fix is to widen it deliberately, not
 * to relax the invariant. Every figure in the current sample is a whole number
 * and both invariants hold exactly, so no allowance is being spent today.
 */
export const AREA_EPSILON_ACRES = 0.005;

/**
 * Relative tolerance, guarding float noise on large sums rather than data error.
 * At the sample's largest total (3,775 acres) this contributes well under a
 * millionth of an acre, so {@link AREA_EPSILON_ACRES} dominates in practice.
 */
export const AREA_RELATIVE_EPSILON = 1e-9;

/**
 * Whether two acreages are equal within tolerance.
 *
 * Combines an absolute and a relative bound: the absolute one keeps comparisons
 * near zero from being impossibly strict, the relative one keeps comparisons of
 * large values from being defeated by float representation.
 */
export function areaEquals(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(AREA_EPSILON_ACRES, AREA_RELATIVE_EPSILON * scale);
}

/* -------------------------------------------------------------------------- */
/* Semantic measure roles                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The four tenure components that must sum to the total area.
 *
 * These are semantic roles, not column names. The parser binds each to a
 * discovered {@link import('@/types/schema').NormalizedKey} at upload time, and
 * the user can correct the binding. Keeping the roles here and the column names
 * out of here is what lets the invariant survive a production file that spells
 * its headers differently.
 */
export const AREA_COMPONENT_ROLES = [
  'private-sale',
  'private-lease',
  'govt-revenue',
  'forest',
] as const;
export type AreaComponentRole = (typeof AREA_COMPONENT_ROLES)[number];

/** The two utilization roles that must sum to the total area. */
export const UTILIZATION_ROLES = ['used', 'unused'] as const;
export type UtilizationRole = (typeof UTILIZATION_ROLES)[number];

/** The role every other area role is checked against. */
export const TOTAL_AREA_ROLE = 'total' as const;

/* -------------------------------------------------------------------------- */
/* Invariant 1 — tenure composition                                            */
/* -------------------------------------------------------------------------- */

/**
 * INVARIANT 1: `Private Sale + Private Lease + Govt/revenue + Forest === Total Land Area`
 *
 * Holds for all 130 rows of the sample with zero drift.
 *
 * @param components Tenure component acreages, in any order. Conventionally the
 *   four {@link AREA_COMPONENT_ROLES}, but the predicate does not require four —
 *   a production file may split tenure differently, and the arithmetic is the
 *   same.
 * @param total The stated total acreage.
 * @returns `true` only when the sum matches within {@link areaEquals}. Non-finite
 *   input yields `false`; use {@link checkCompositionInvariant} when inputs may
 *   be null and you need to distinguish "violated" from "cannot be evaluated".
 */
export function satisfiesCompositionInvariant(
  components: readonly number[],
  total: number,
): boolean {
  if (components.length === 0) return false;
  if (!components.every(Number.isFinite)) return false;
  const sum = components.reduce((acc, value) => acc + value, 0);
  return areaEquals(sum, total);
}

/* -------------------------------------------------------------------------- */
/* Invariant 2 — utilization split                                             */
/* -------------------------------------------------------------------------- */

/**
 * INVARIANT 2: `Used Land + Unused Land === Total Land Area`
 *
 * Holds for all 130 rows of the sample with zero drift.
 *
 * Note the sample's one junk row satisfies this trivially (0 + 0 === null→0) yet
 * is still dropped, because it has no `State`. Dropping happens before invariant
 * checking, so a trivially-satisfied junk row never reaches this predicate.
 */
export function satisfiesUtilizationInvariant(
  used: number,
  unused: number,
  total: number,
): boolean {
  if (!Number.isFinite(used) || !Number.isFinite(unused)) return false;
  return areaEquals(used + unused, total);
}

/* -------------------------------------------------------------------------- */
/* Tri-state evaluation — the path the parser actually uses                     */
/* -------------------------------------------------------------------------- */

/**
 * Outcome of evaluating an invariant against possibly-incomplete data.
 *
 * `indeterminate` matters: 14 of the sample's columns are entirely empty and
 * production files will populate them unevenly. An invariant over a null
 * component is not violated, it is unevaluable, and reporting it as a violation
 * would bury real errors under noise.
 */
export type InvariantStatus = 'satisfied' | 'violated' | 'indeterminate';

export interface InvariantEvaluation {
  readonly status: InvariantStatus;
  /** The computed sum. Absent when `indeterminate`. */
  readonly observed?: number;
  /** The stated total. Absent when `indeterminate`. */
  readonly expected?: number;
  /** `observed - expected`. Signed. Absent when `indeterminate`. */
  readonly delta?: number;
  /** Set when `indeterminate`, explaining what was missing. */
  readonly indeterminateReason?: 'null-component' | 'null-total' | 'no-components';
}

const INDETERMINATE = (
  reason: NonNullable<InvariantEvaluation['indeterminateReason']>,
): InvariantEvaluation => ({ status: 'indeterminate', indeterminateReason: reason });

function evaluateSum(
  values: readonly (number | null | undefined)[],
  total: number | null | undefined,
): InvariantEvaluation {
  if (values.length === 0) return INDETERMINATE('no-components');
  if (total === null || total === undefined || !Number.isFinite(total)) {
    return INDETERMINATE('null-total');
  }
  const resolved: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return INDETERMINATE('null-component');
    }
    resolved.push(value);
  }
  const observed = resolved.reduce((acc, value) => acc + value, 0);
  return {
    status: areaEquals(observed, total) ? 'satisfied' : 'violated',
    observed,
    expected: total,
    delta: observed - total,
  };
}

/**
 * Evaluate {@link satisfiesCompositionInvariant} with null-tolerance, returning
 * the drift so a {@link import('@/types/schema').RowWarning} can report it.
 *
 * CLAUDE.md: "Surface violations as row-level warnings; do not silently correct
 * them." This returns the discrepancy; it never returns a repaired figure.
 */
export function checkCompositionInvariant(
  components: readonly (number | null | undefined)[],
  total: number | null | undefined,
): InvariantEvaluation {
  return evaluateSum(components, total);
}

/** Null-tolerant form of {@link satisfiesUtilizationInvariant}. */
export function checkUtilizationInvariant(
  used: number | null | undefined,
  unused: number | null | undefined,
  total: number | null | undefined,
): InvariantEvaluation {
  return evaluateSum([used, unused], total);
}

/* -------------------------------------------------------------------------- */
/* Sheet and header discovery thresholds                                       */
/* -------------------------------------------------------------------------- */

/**
 * Minimum share of a row's cells that must be non-empty strings for it to be
 * considered the header row.
 *
 * The sample's header is 27 non-empty strings across a 29-wide range — 93%,
 * comfortably clear. The two empty trailing cells are exactly the kind of slack
 * this threshold exists to tolerate.
 */
export const HEADER_STRING_DENSITY_THRESHOLD = 0.7;

/**
 * Distinct types the row below the header must show to corroborate detection.
 *
 * A header row is strings; a data row under it is usually a mix of strings and
 * numbers. Requiring two distinct types stops a second row of section labels
 * from being mistaken for data — which would otherwise let the real header be
 * skipped in favour of a title row.
 */
export const HEADER_CORROBORATION_MIN_TYPES = 2;

/**
 * How many rows below a candidate to scan before giving up on corroboration.
 * Small on purpose: the corroborating row should be immediately below.
 */
export const HEADER_LOOKAHEAD_ROWS = 1;

/** Rows scanned when searching for the header. Guards against a huge sheet. */
export const HEADER_SEARCH_MAX_ROWS = 25;

/* -------------------------------------------------------------------------- */
/* Role inference thresholds                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Share of populated cells that must coerce to a finite number for a column to
 * be a measure.
 *
 * Below 1.0 on purpose: a production measure column with a few "TBD" or "N/A"
 * cells is still a measure, and demoting it over a handful of stray strings
 * would drop it out of the choropleth entirely. All seven measure columns in
 * the sample parse at 1.0.
 */
export const MEASURE_NUMERIC_RATIO_THRESHOLD = 0.8;

/**
 * Cardinality ratio at or above which a dimension is flagged high-cardinality.
 *
 * IMPORTANT — this flag governs how a dimension is *offered*, not whether it is
 * one. A column at 95% distinct is a poor default grouping (124 legend entries
 * is not a choropleth) but it is still filterable and still belongs on the
 * table axis.
 *
 * This is a deliberate departure from a literal reading of the brief, which
 * demoted such columns to `meta`. Applied that way to this file it reclassifies
 * District (62% distinct) as meta — and District is the single most important
 * grouping in the app, the one the choropleth is built on. Site and Village go
 * with it. The threshold is retained here as a UI hint, which is the job it can
 * actually do well.
 */
export const HIGH_CARDINALITY_RATIO = 0.4;

/**
 * Header keywords that mark an all-empty column as a measure.
 *
 * Matched against the normalized key as substrings, so `'circle rate'` hits on
 * "rate" and `'market value tentative'` on "value".
 *
 * `'acer'` is in the list because the sample misspells "Acres" as "Acers" and
 * CLAUDE.md forbids repairing headers during normalization. The typo is handled
 * here, at the matching layer, where being wrong costs a mislabelled column
 * rather than a corrupted key.
 */
export const MEASURE_HEADER_KEYWORDS = [
  'acre',
  'acer',
  'area',
  'rate',
  'value',
  'percentage',
  'percent',
  'amount',
  'cost',
  'price',
] as const;

/**
 * Header keywords that mark an all-empty column as meta, checked BEFORE
 * {@link MEASURE_HEADER_KEYWORDS}.
 *
 * Order matters. `'Purchase Date '` contains no measure keyword, but a column
 * like "Valuation Date" contains "value" and would otherwise be called a
 * measure. Dates, document flags, and file references are never aggregable, so
 * they win the match.
 */
export const META_HEADER_KEYWORDS = [
  'date',
  'y/n',
  'yes/no',
  'doc',
  'file',
  'kmz',
  'remark',
  'comment',
  'status',
  'name',
  'number',
  'id',
] as const;

/* -------------------------------------------------------------------------- */
/* Null-equivalent value tokens                                                */
/* -------------------------------------------------------------------------- */

/**
 * Strings that mean "no value" and must become `null`, never `0`.
 *
 * The distinction is not cosmetic. A `0` in a measure column is a real figure —
 * `Private Lease` legitimately holds 0 across many rows of the sample, and
 * `Forest` holds 0 on all but four. Coercing an empty cell to 0 would make an
 * unrecorded area indistinguishable from a recorded absence, silently inflate
 * the row count behind every average, and let the composition invariant pass on
 * a row that should have been flagged as incomplete.
 *
 * Compared case-insensitively after {@link WHITESPACE_TO_NORMALIZE} handling and
 * trimming. A bare `'-'` is a null token; `'-5'` is negative five, and the
 * exact-match comparison is what keeps those apart.
 */
export const NULL_EQUIVALENT_TOKENS = [
  '',
  '-',
  '--',
  '---',
  'na',
  'n/a',
  'n.a.',
  'n.a',
  'nil',
  'none',
  'null',
  'nan',
  '#n/a',
  '#value!',
  '#ref!',
  '#div/0!',
  'tbd',
  'not applicable',
  'not available',
] as const;

/**
 * Symbols and unit words stripped from a measure cell before parsing.
 *
 * Ordered longest-first at use so `'acres'` is consumed before `'ac'` — matching
 * the short form first would leave a trailing `'res'` and fail the parse.
 */
export const MEASURE_STRIP_TOKENS = [
  'square metres',
  'square meters',
  'square feet',
  'hectares',
  'hectare',
  'sq. ft.',
  'sq ft',
  'sq.m.',
  'sq m',
  'acres',
  'acre',
  'guntha',
  'cents',
  'cent',
  'rs.',
  'rs',
  'inr',
  'ha',
  'ac',
] as const;

/** Currency symbols stripped from a measure cell before parsing. */
export const CURRENCY_SYMBOLS = ['₹', '$', '€', '£', '¥'] as const;

/* -------------------------------------------------------------------------- */
/* Ingest expectations                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Shape facts about the sample workbook, used for a soft sanity check on upload.
 *
 * These are expectations, not requirements: a production file with a different
 * sheet name or column count is valid and must still parse. Divergence raises an
 * {@link import('@/types/schema').IngestWarning}, never a hard failure.
 */
export const SAMPLE_WORKBOOK_SHAPE = {
  /** The sample's data is on `Sheet2`; there is no `Sheet1`. */
  sheetName: 'Sheet2',
  /** Header occupies row 1; data begins at row 2. */
  headerRowNumber: 1,
  /** Data rows before the junk row is dropped. */
  totalDataRows: 131,
  /** Data rows after dropping rows with a null `State`. */
  expectedRecordCount: 130,
  /**
   * Header cells present, including the two trailing cells with empty headers.
   * CLAUDE.md states 27, which counts only the named columns — SheetJS reports
   * 29 and the parser must tolerate the unnamed pair.
   */
  headerCellCount: 29,
  /** Columns with a non-empty header string. */
  namedColumnCount: 27,
  /** Named columns with at least one populated cell. */
  populatedColumnCount: 13,
  /** Named columns that are entirely null in this sample. */
  emptyColumnCount: 14,
} as const;

/**
 * Characters the header/value normalizer must neutralise before matching.
 *
 * Drawn from the CLAUDE.md "Known dirt" list and confirmed against the file:
 * `'Nellore '` carries a non-breaking space, `'Goa '`/`'Mumbai '`/`'Kutch '`/
 * `'Nagpur '` carry ordinary trailing spaces, and two headers embed a CRLF —
 * `\r\n`, not the bare `\n` the spec quotes.
 */
export const WHITESPACE_TO_NORMALIZE = {
  /** U+00A0 NO-BREAK SPACE. */
  NBSP: ' ',
  /** U+200B ZERO WIDTH SPACE — not in the sample, but survives Excel round-trips. */
  ZERO_WIDTH_SPACE: '​',
  /** U+FEFF BYTE ORDER MARK, seen leading the first header of CSV-derived files. */
  BOM: '﻿',
} as const;
