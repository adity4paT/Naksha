# Project: Land MIS Geographic Dashboard (V1)

## What this is
A web app that ingests a land-holdings Excel MIS and renders it as a choropleth
over an India map, with cascading State → District filters and user-selectable
measures.

## V1 scope boundary — read before proposing features
Location is resolved to ADMINISTRATIVE BOUNDARIES ONLY: state and district
polygons from vendored GeoJSON. There are no per-site coordinates in this data
and V1 does not invent any.

Specifically forbidden in V1:
- Do NOT geocode. No Nominatim, no Google, no external location API. Every
  place lookup resolves against local GeoJSON.
- Do NOT plot individual site markers. Multiple sites share a district and the
  only available point is that district's centroid; scattering them would
  render fabricated positions that look surveyed. Sites appear as a count badge
  on the district and in the data table.
- Do NOT compute or display parcel area from geometry. The only area figures in
  V1 are the ones stated in the spreadsheet.

Surveyed boundaries arrive in V2 via KMZ upload. Build the seams (below), not
the feature.

## Source data contract (derived from Dummy_land_mis.xlsx)
- Sheet name is `Sheet2`, NOT `Sheet1`. Header is row 1. 130 data rows.
- 27 columns. Only 13 are populated; 14 are entirely empty in this sample but
  MUST still be supported, because production files will populate them.

### Dimension columns
| Column     | Notes                                      |
|------------|--------------------------------------------|
| `Sr No `   | trailing space in header. Float. Ignore.   |
| `Business` | 3 values in sample: xyz, abc, def          |
| `Site`     | 124 distinct — effectively the record name |
| `State`    | 18 distinct                                |
| `Village`  | free text, sometimes "3 Villages"          |
| `District` | 80 distinct raw strings                    |

### Measure columns (all in ACRES, all populated)
`Private Sale`, `Private Lease`, `Govt/revenue`, `Forest`,
`Total Land Area`, `Used Land ` (trailing space), `Unused Land`

### Empty-in-sample columns (support but expect null)
`Mutation done`, `Mutation (Not Require)`, `Mutation Pending`,
`NA/ Coversion Done\n(Acers) `, `NA/CLU Not require\n(acres)`,
`NA/CLU Pending (acres) `, `Utilization percentage(%)`, `Purchase Date `,
`Original Docs Y/N`, `Circle rate`, `Market Value tentative `, `KMZ Files`,
`Railway Docs Y/N`, `Govt Allocated /Free Holding`

Note: `KMZ Files` is empty and stays unused in V1. Do not build against it yet.

## Invariants — assert these on every ingest
1. `Private Sale + Private Lease + Govt/revenue + Forest == Total Land Area`
2. `Used Land + Unused Land == Total Land Area`
Both hold exactly in the sample. Surface violations as row-level warnings; do
not silently correct them.

## Known dirt — the parser must handle all of this
- Header strings contain trailing spaces, embedded `\n`, and typos
  ("Coversion", "Acers"). Never match headers by exact string; normalize first.
- One trailing junk row: `Sr No` blank, `Used Land`/`Unused Land` = 0. Drop rows
  where `State` is null.
- `'Nellore\u00a0'` contains a NON-BREAKING SPACE (U+00A0), not a regular space.
- Trailing spaces in values: `'Goa '`, `'Mumbai '`, `'Kutch '`, `'Nagpur '`.
- Same district spelled two ways: Ludhiana/Ludhiyana, Raigad/Raigarh,
  Tiruvallur/Thiruvallur, Muktsar/Mutksar.
- `State` = `Pondichery` is a Union Territory (Puducherry), not a state.
- `State` = `Jammu` is wrong — it is a district. Real state/UT is Jammu & Kashmir.

## Forward compatibility — leave these seams for V2
Build these abstractions now even though V1 has only one implementation each.
Retrofitting them later means touching every consumer.
- `LocationResult { geometry, precision: 'district-centroid' | 'surveyed-polygon',
  source: 'admin-boundary' | 'kmz' }`. V1 only ever emits the first of each.
- `AreaFigure { acres, source: 'sheet' | 'surveyed' }`. V1 only emits 'sheet'.
- The resolver cascade reserves stage 0 for geometry-based resolution. Number
  the V1 stages 1–4 and leave stage 0 documented but unimplemented.
- Map layer registration is a list, so a polygon layer can be appended without
  restructuring the map component.

## Confidentiality
This is commercial land-holding data. Parse in-browser, no server round-trip,
no telemetry, no third-party API calls carrying site names or place names.
Persist only to localStorage/IndexedDB with a visible "Clear local data" control.

## Non-negotiable engineering rules
- Never hardcode column names from the sample into UI logic. Columns are
  discovered at upload time from the header row.
- Measure vs dimension is inferred, then user-overridable. Not hardcoded.
- All area math in acres internally. Convert only at the render boundary.
- Boundary GeoJSON is the source of truth for administrative names. Excel names
  are normalized ONTO GeoJSON names, never the reverse.
- Any row that fails to join to a boundary must appear in a visible "unmapped
  records" panel with its acreage. Never drop it silently.