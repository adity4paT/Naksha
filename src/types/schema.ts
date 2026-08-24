/**
 * Core schema for the Land MIS dashboard.
 *
 * Two rules from CLAUDE.md are enforced structurally here rather than by
 * convention, because convention does not survive contact with a second
 * developer:
 *
 *  1. "Never hardcode column names from the sample into UI logic."
 *     Cell values are addressed by {@link NormalizedKey}, a branded string that
 *     can only be produced by the normalizer. A raw header like `'Used Land '`
 *     is not assignable to it, so `record.values['Used Land ']` fails to
 *     compile. Columns are discovered at upload time; see {@link ColumnDescriptor}.
 *
 *  2. "Leave these seams for V2."
 *     {@link LocationResult} and {@link AreaFigure} are declared as their full
 *     V1+V2 unions so every consumer writes an exhaustive switch today. The
 *     V2 arms are real members of the union — reachable to a reader, checked by
 *     the compiler — but no V1 producer can construct one, because V1 producers
 *     are typed to return the narrowed {@link V1LocationResult} /
 *     {@link V1AreaFigure} aliases. Adding V2 means widening one producer
 *     signature. It does not mean touching consumers.
 */

import type { Feature, MultiPolygon, Point, Polygon } from 'geojson';

/* -------------------------------------------------------------------------- */
/* Branded primitives                                                          */
/* -------------------------------------------------------------------------- */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * A column header reduced to a stable lookup key.
 *
 * The normalizer must collapse everything in the CLAUDE.md "Known dirt" list:
 * trailing spaces (`'Used Land '`), embedded newlines (the sample uses CRLF,
 * not the bare LF the spec quotes), NBSP (U+00A0), case, and runs of
 * whitespace. It deliberately does NOT fix typos — `'NA/ Coversion Done'`
 * normalizes to a key that still contains "coversion". Typo correction is a
 * mapping concern, not a normalization concern, and silently repairing headers
 * would make two genuinely different production columns collide.
 *
 * Only the normalizer may mint these. See `src/lib/normalize.ts` (not yet built).
 */
export type NormalizedKey = Brand<string, 'NormalizedKey'>;

/** Stable per-row identity, assigned at parse time. Not the sheet's `Sr No`. */
export type RecordId = Brand<string, 'RecordId'>;

/**
 * An administrative name exactly as it appears in the vendored GeoJSON.
 *
 * CLAUDE.md: "Boundary GeoJSON is the source of truth for administrative names.
 * Excel names are normalized ONTO GeoJSON names, never the reverse." Branding
 * this makes the direction of that mapping checkable — an Excel string cannot
 * be passed where a canonical name is required.
 */
export type CanonicalAdminName = Brand<string, 'CanonicalAdminName'>;

/* -------------------------------------------------------------------------- */
/* Cell values                                                                 */
/* -------------------------------------------------------------------------- */

/** Every value SheetJS can hand back for a populated cell. */
export type CellValue = string | number | boolean | Date | null;

/** Narrowed cell type for a column whose effective role is `'measure'`. */
export type MeasureValue = number | null;

/* -------------------------------------------------------------------------- */
/* Column descriptors                                                          */
/* -------------------------------------------------------------------------- */

/**
 * How a column participates in the dashboard.
 *
 * - `dimension` — groupable / filterable (State, District, Business, Site).
 * - `measure`   — numerically aggregatable; drives the choropleth ramp.
 * - `meta`      — carried through and shown in the table, but never grouped or
 *                 summed. Dates, Y/N flags, free text like Village, and the
 *                 `Sr No` index all land here.
 */
export type ColumnRole = 'dimension' | 'measure' | 'meta';

/** Why the inference engine chose the role it chose. Shown in the override UI. */
export type RoleInferenceReason =
  /** Numeric across every populated cell, and not a low-cardinality code. */
  | 'numeric-values'
  /** Cardinality low enough relative to row count to be worth grouping by. */
  | 'low-cardinality'
  /** Non-numeric and high-cardinality — carried, not aggregated. */
  | 'high-cardinality-text'
  /** Parsed as dates. */
  | 'temporal-values'
  /** Only two populated values, or Y/N-shaped. */
  | 'boolean-like'
  /** Entirely empty in this file, so nothing to infer from. See note below. */
  | 'empty-column'
  /** Header has no text at all (the sample has two such trailing columns). */
  | 'unnamed-column';

/**
 * A column discovered in the header row, plus the profile used to infer its role.
 *
 * Note on empty columns: 14 of the sample's columns are entirely null, and
 * CLAUDE.md requires supporting them because production files will populate
 * them. An empty column yields no evidence, so `inferredRole` will be `'meta'`
 * with reason `'empty-column'` and `isEmptyInSample` set — a signal to the UI
 * to surface it as "role unknown, please confirm" rather than asserting a role
 * it cannot justify.
 */
export interface ColumnDescriptor {
  /** Zero-based position in the header row. Preserves original sheet order. */
  readonly index: number;

  /**
   * The header string verbatim, including trailing spaces, CRLF, and typos.
   * Display this in "raw header" affordances so users can match it against
   * their own spreadsheet. Never use it as a lookup key.
   *
   * `null` when the header cell itself is empty — the sample has two such
   * columns at indices 27 and 28, which the CLAUDE.md column count omits.
   */
  readonly name: string | null;

  /** The lookup key. Unique within a workbook; see {@link NormalizedKey}. */
  readonly normalizedKey: NormalizedKey;

  /**
   * Human-facing label: `name` tidied for display, or a synthesized
   * `"Column 28"` when the header is empty. Distinct from `name` (verbatim,
   * for matching) and `normalizedKey` (opaque, for lookup).
   */
  readonly displayLabel: string;

  /** What the profiler concluded, before any user override. */
  readonly inferredRole: ColumnRole;
  readonly inferenceReason: RoleInferenceReason;

  /**
   * Set only when the user has explicitly reassigned the role.
   * CLAUDE.md: "Measure vs dimension is inferred, then user-overridable."
   * Absent means "not overridden" — never store `undefined` explicitly, since
   * `exactOptionalPropertyTypes` is on.
   */
  readonly roleOverride?: ColumnRole;

  /** Cells with no value, out of `rowCount`. */
  readonly nullCount: number;
  /** Distinct non-null values. */
  readonly distinctCount: number;
  /** Rows profiled — the same for every column in a workbook. */
  readonly rowCount: number;

  /** True when `nullCount === rowCount`. Precomputed because the UI branches on it. */
  readonly isEmptyInSample: boolean;

  /**
   * Up to a handful of distinct values, for the override UI's preview.
   * Never the full distinct set — Site has 124 values and this ships to render.
   */
  readonly sampleValues: readonly CellValue[];

  /**
   * Unit for measure columns. CLAUDE.md: "All area math in acres internally.
   * Convert only at the render boundary." Every area column in the sample is
   * already acres, so ingest records `'acre'` and performs no conversion.
   * `'percent'` and `'currency-inr'` exist for `Utilization percentage(%)`,
   * `Circle rate`, and `Market Value tentative` once production populates them.
   */
  readonly unit?: MeasureUnit;
}

/** Units a measure column can carry. Area is always stored as acres internally. */
export type MeasureUnit = 'acre' | 'hectare' | 'square-metre' | 'percent' | 'currency-inr';

/** The role actually in effect: an explicit override wins over inference. */
export function effectiveRole(column: ColumnDescriptor): ColumnRole {
  return column.roleOverride ?? column.inferredRole;
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One data row.
 *
 * `values` is keyed by {@link NormalizedKey}, so reading a field requires
 * resolving a {@link ColumnDescriptor} first. That indirection is the point:
 * it is what stops `record.values['Total Land Area']` from ever being written.
 */
export interface ParsedRecord {
  readonly id: RecordId;

  /**
   * 1-based row number in the source sheet, header included — so the first data
   * row is 2. Used verbatim in warnings so a user can jump to the row in Excel.
   */
  readonly sourceRowNumber: number;

  readonly values: Readonly<Partial<Record<NormalizedKey, CellValue>>>;

  /** Invariant failures and coercion problems scoped to this row. */
  readonly warnings: readonly RowWarning[];
}

/* -------------------------------------------------------------------------- */
/* Warnings                                                                    */
/* -------------------------------------------------------------------------- */

export type RowWarningCode =
  /** `Private Sale + Private Lease + Govt/revenue + Forest !== Total Land Area`. */
  | 'composition-invariant-violated'
  /** `Used Land + Unused Land !== Total Land Area`. */
  | 'utilization-invariant-violated'
  /** A measure column held something non-numeric. */
  | 'non-numeric-measure'
  /** A required dimension was blank on an otherwise populated row. */
  | 'missing-dimension'
  /** Negative area, which is never meaningful. */
  | 'negative-area';

/**
 * A per-row problem.
 *
 * CLAUDE.md: "Surface violations as row-level warnings; do not silently
 * correct them." Nothing in this type permits a corrected value — it carries
 * only what was observed and what was expected.
 */
export interface RowWarning {
  readonly code: RowWarningCode;
  readonly message: string;
  /** Columns implicated, for highlighting cells in the table. */
  readonly columns: readonly NormalizedKey[];
  /** Present for the two arithmetic invariants. */
  readonly observed?: number;
  readonly expected?: number;
  /** `observed - expected`. Signed, so the UI can show direction of drift. */
  readonly delta?: number;
}

export type IngestWarningCode =
  /** Sheet name was not the expected one; parser fell back. */
  | 'unexpected-sheet-name'
  /** Two headers normalized to the same key; the later one was suffixed. */
  | 'duplicate-normalized-key'
  /** Header cell was blank — sample columns 27 and 28. */
  | 'unnamed-column'
  /** Rows dropped for having no `State`. */
  | 'rows-dropped'
  /** No column could be inferred as a measure — the choropleth has nothing to ramp. */
  | 'no-measure-columns';

/** A problem with the file as a whole rather than with one row. */
export interface IngestWarning {
  readonly code: IngestWarningCode;
  readonly message: string;
  readonly affectedRowCount?: number;
  readonly affectedColumns?: readonly NormalizedKey[];
}

/**
 * A row excluded before it became a {@link ParsedRecord}.
 *
 * CLAUDE.md drops rows where `State` is null (the sample's one trailing junk
 * row). Dropped rows are retained rather than discarded so the ingest summary
 * can report "130 of 131 rows parsed, 1 dropped" and show which.
 */
export interface DroppedRow {
  readonly sourceRowNumber: number;
  readonly reason: 'null-state' | 'fully-empty';
  /** The raw cells, for display in the drop report. */
  readonly rawValues: Readonly<Partial<Record<NormalizedKey, CellValue>>>;
}

/* -------------------------------------------------------------------------- */
/* Parsed workbook                                                             */
/* -------------------------------------------------------------------------- */

/** Aggregate counts for the post-ingest summary panel. */
export interface IngestStats {
  /** Data rows present in the sheet, excluding the header. */
  readonly totalRowsInSheet: number;
  /** Rows that became records. */
  readonly parsedRecordCount: number;
  readonly droppedRowCount: number;
  /** Records carrying at least one {@link RowWarning}. */
  readonly recordsWithWarnings: number;
  readonly columnCount: number;
  readonly emptyColumnCount: number;
}

/** The result of parsing one uploaded workbook. */
export interface ParsedWorkbook {
  /** Sheet actually read. The sample's data lives on `Sheet2`, not `Sheet1`. */
  readonly sheetName: string;
  /** Every sheet in the file, so the UI can offer a switcher. */
  readonly availableSheets: readonly string[];

  /** In original sheet order. */
  readonly columns: readonly ColumnDescriptor[];
  readonly records: readonly ParsedRecord[];
  readonly droppedRows: readonly DroppedRow[];

  /** File-level problems. Row-level ones live on each record. */
  readonly warnings: readonly IngestWarning[];
  readonly stats: IngestStats;

  /** ISO 8601. Shown next to the "Clear local data" control. */
  readonly parsedAt: string;
  /** Original filename, for display only. Never uploaded anywhere. */
  readonly sourceFileName: string;
}

/* -------------------------------------------------------------------------- */
/* Area figures — V2 seam                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where an area number came from.
 *
 * `'sheet'`    — stated in the spreadsheet. The only V1 source.
 * `'surveyed'` — computed from a surveyed KMZ polygon. V2 only.
 *
 * CLAUDE.md: "Do NOT compute or display parcel area from geometry." V1 has no
 * code path that produces `'surveyed'`, which is why V1 producers return
 * {@link V1AreaFigure}.
 */
export type AreaSource = 'sheet' | 'surveyed';

/** An area, always in acres. Convert at the render boundary, never before. */
export interface AreaFigure {
  readonly acres: number;
  readonly source: AreaSource;
}

/** What V1 code may construct. Accept {@link AreaFigure}; return this. */
export type V1AreaFigure = AreaFigure & { readonly source: 'sheet' };

/* -------------------------------------------------------------------------- */
/* Location results — V2 seam                                                  */
/* -------------------------------------------------------------------------- */

/** How precisely a record is positioned. */
export type LocationPrecision = 'district-centroid' | 'surveyed-polygon';

/** What produced the geometry. */
export type LocationSource = 'admin-boundary' | 'kmz';

/** Which administrative level the match landed on. */
export type AdminLevel = 'state' | 'district';

interface LocationResultBase {
  /**
   * The polygon to fill on the choropleth.
   *
   * Note this is a polygon in both variants — the difference between them is
   * provenance, not shape. `precision` describes how much to trust it.
   */
  readonly geometry: Polygon | MultiPolygon;

  /**
   * Representative point. For `admin-boundary` this is the polygon's centroid,
   * which is a label anchor and nothing more.
   *
   * CLAUDE.md: "Do NOT plot individual site markers." Multiple sites share a
   * district and therefore share this exact point. Rendering one dot per record
   * here would fabricate positions that look surveyed. Use it for label
   * placement and map fly-to only.
   */
  readonly centroid: Point;

  /** Bounding box `[west, south, east, north]`, for fitting the viewport. */
  readonly bbox: readonly [number, number, number, number];
}

/** V1's only outcome: a match against vendored administrative GeoJSON. */
export interface AdminBoundaryLocation extends LocationResultBase {
  readonly precision: 'district-centroid';
  readonly source: 'admin-boundary';

  /**
   * Whether the record matched a district polygon or fell back to its state.
   *
   * A caveat worth knowing: when this is `'state'`, `precision` still reads
   * `'district-centroid'` because CLAUDE.md fixes the union to two values.
   * Treat `precision` as "administrative centroid, not surveyed" and read this
   * field for the actual level. Widening `precision` to add a
   * `'state-centroid'` member would be the cleaner fix if the spec can move.
   */
  readonly adminLevel: AdminLevel;

  /** GeoJSON's name, not Excel's. See {@link CanonicalAdminName}. */
  readonly canonicalName: CanonicalAdminName;
  /** Set when `adminLevel` is `'district'`. */
  readonly canonicalStateName: CanonicalAdminName;

  /** Which cascade stage matched. Never `0` in V1 — see {@link ResolverStage}. */
  readonly resolvedByStage: Exclude<ResolverStage, 0>;
}

/**
 * V2 only: geometry from an uploaded KMZ.
 *
 * Present in the {@link LocationResult} union so consumers handle it today.
 * Nothing in V1 constructs one — the KMZ column exists in the sheet but is
 * empty, and CLAUDE.md says not to build against it yet.
 */
export interface SurveyedLocation extends LocationResultBase {
  readonly precision: 'surveyed-polygon';
  readonly source: 'kmz';
  /** Name of the KMZ the polygon came from. */
  readonly sourceFileName: string;
  /** The full feature, so V2 keeps KML properties the app has no schema for. */
  readonly feature: Feature<Polygon | MultiPolygon>;
}

/**
 * Where a record sits on the map.
 *
 * Switch on `source` (or `precision`) exhaustively. Both arms are live members
 * of the union; only the first is constructible in V1.
 */
export type LocationResult = AdminBoundaryLocation | SurveyedLocation;

/** What V1 code may construct. Accept {@link LocationResult}; return this. */
export type V1LocationResult = Extract<LocationResult, { source: 'admin-boundary' }>;

/* -------------------------------------------------------------------------- */
/* Resolver cascade                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Stages of the Excel-name → GeoJSON-boundary resolver, tried in order.
 *
 * - `0` — RESERVED, UNIMPLEMENTED. Geometry-based resolution: when a record
 *         carries its own surveyed polygon (V2 KMZ), that geometry wins and no
 *         name matching runs at all. Numbered 0 so it sorts ahead of every name
 *         strategy without renumbering them later. V1 must never emit it.
 * - `1` — Exact match on the canonical name after whitespace/NBSP/case
 *         normalization. Catches `'Goa '`, `'Mumbai '`, `'Nellore '`.
 * - `2` — Known-alias table. Catches the transliteration and typo pairs:
 *         Ludhiana/Ludhiyana, Raigad/Raigarh, Tiruvallur/Thiruvallur,
 *         Muktsar/Mutksar, plus the two state-level corrections CLAUDE.md
 *         calls out — `Pondichery` → Puducherry (a UT), and `Jammu`, which is a
 *         district rather than a state, → Jammu & Kashmir.
 * - `3` — Fuzzy match within the already-resolved parent state, above a
 *         confidence floor. Scoping to the parent is what makes fuzzy matching
 *         safe here.
 * - `4` — State-level fallback: district unresolved, so attribute the record to
 *         its state polygon and mark `adminLevel: 'state'`.
 *
 * Failing every stage is not a stage. It produces an {@link UnmappedRecord},
 * because CLAUDE.md forbids dropping such a row silently.
 */
export type ResolverStage = 0 | 1 | 2 | 3 | 4;

/** Human-readable stage labels for the resolution-report UI. */
export const RESOLVER_STAGE_LABELS: Readonly<Record<ResolverStage, string>> = {
  0: 'Surveyed geometry (V2 — not implemented)',
  1: 'Exact name match',
  2: 'Known alias',
  3: 'Fuzzy match within state',
  4: 'State-level fallback',
} as const;

/** Why a name could not be resolved to any boundary. */
export type UnmappedReason =
  /** Neither the district nor its state matched anything. */
  | 'no-boundary-match'
  /** State matched but the district did not, and fallback was disabled. */
  | 'district-unmatched'
  /** The row had no place name to resolve. */
  | 'missing-location-fields';

/**
 * A record that reached the resolver and came out without geometry.
 *
 * CLAUDE.md: "Any row that fails to join to a boundary must appear in a visible
 * 'unmapped records' panel with its acreage. Never drop it silently." The
 * acreage is required, not optional, so the panel can always reconcile the
 * unmapped total against the grand total.
 */
export interface UnmappedRecord {
  readonly recordId: RecordId;
  readonly sourceRowNumber: number;
  readonly reason: UnmappedReason;
  /** The raw Excel strings that failed, for display. */
  readonly rawState: string | null;
  readonly rawDistrict: string | null;
  /** Acreage of the active measure. Never omitted. */
  readonly area: AreaFigure;
}

/** A record joined to a boundary, ready to aggregate into the choropleth. */
export interface ResolvedRecord {
  readonly recordId: RecordId;
  readonly location: LocationResult;
  readonly area: AreaFigure;
}

/** Everything the resolver produced, including its failures. */
export interface ResolutionResult {
  readonly resolved: readonly ResolvedRecord[];
  readonly unmapped: readonly UnmappedRecord[];
  /** Records resolved per stage, for the resolution-quality report. */
  readonly countsByStage: Readonly<Record<ResolverStage, number>>;
}

/* -------------------------------------------------------------------------- */
/* Map layers — V2 seam                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A map layer, registered into an ordered list.
 *
 * CLAUDE.md: "Map layer registration is a list, so a polygon layer can be
 * appended without restructuring the map component." V1 registers the state and
 * district choropleths; V2 appends a surveyed-polygon layer by pushing one more
 * entry, with no change to the map component itself.
 */
export interface MapLayerRegistration {
  readonly id: string;
  readonly kind: 'choropleth' | 'boundary-outline' | 'label' | 'surveyed-polygon';
  /** Ascending paint order. Later layers draw on top. */
  readonly order: number;
  readonly adminLevel?: AdminLevel;
  /** Layers may be registered but hidden — e.g. district fill while zoomed out. */
  readonly visible: boolean;
}

/* -------------------------------------------------------------------------- */
/* V1 reachability guards                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Compile-time proof that the V2 arms are real union members and the V1 aliases
 * genuinely exclude them. If someone later collapses the unions to a single
 * variant, or widens `V1LocationResult` to admit KMZ, one of these fails to
 * compile and the seam's loss is caught at build time rather than in review.
 */
type Assert<T extends true> = T;
type Equals<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
  ? true
  : false;

export type _V1LocationExcludesKmz = Assert<Equals<V1LocationResult, AdminBoundaryLocation>>;
export type _V2LocationArmExists = Assert<
  Equals<Extract<LocationResult, { source: 'kmz' }>, SurveyedLocation>
>;
export type _V1AreaExcludesSurveyed = Assert<Equals<V1AreaFigure['source'], 'sheet'>>;
export type _V2AreaArmExists = Assert<Equals<AreaFigure['source'], AreaSource>>;
