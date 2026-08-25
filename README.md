# Naksha — Land MIS Geographic Dashboard

Ingests a land-holdings Excel MIS and renders it as a choropleth over an India
map, with cascading filters, a sortable record table, and a provenance-stamped
export.

Everything runs in the browser. There is no backend, no database, and no
external API call of any kind.

---

## ⚠️ V1 limitations — read this before quoting a number off the screen

Once this is projected in a meeting, people will read figures off it and treat
them as verified. They are not. Here is exactly what they are.

**Locations are district-level approximations.** This data contains no
coordinate for any individual site. Every site is placed at the polygon of the
district named in its row, and sites in the same district share that polygon
exactly. A site count badge reading "6" means six sites *somewhere* in that
district — it is not six positions. Nothing on the map has been surveyed, and
nothing on it should be used to identify where a parcel physically is.

**Every acreage comes from the spreadsheet, not from the map.** No area figure
is measured, computed, or inferred from boundary geometry. If a row says 2,476
acres, the map says 2,476 acres, and the map has no independent opinion about
whether that is true. The two invariant checks (below) test the spreadsheet's
internal arithmetic only.

**Boundaries are approximate and dated.** They are simplified to roughly 0.01°
and drawn from a Census-2011-era source with piecemeal later corrections.
Indian districts are created and renamed frequently; a district newer than the
boundary vintage will not match, and a district that has since been split is
still drawn at its pre-split extent. See [public/geo/README.md](public/geo/README.md).

**Some place names were matched by spelling, not exactly.** The resolver's
fuzzy stage guesses when a name is close but not identical. Every such match is
flagged in the upload preview and in the resolution report. In the sample file,
`Shravasti` is matched to `Shrawasti` this way. Check those before trusting a
region.

**Unmapped records are excluded from the map but not from reality.** Any row
that fails to match a boundary appears in the unmapped panel with its acreage
and is *not* counted in any region. The panel's running total is the number to
check before treating a map total as complete.

**Derived percentages are ratios of sums, not averages of percentages.** For
"Utilisation %" and the two tenure percentages, the numerator and denominator
are each summed across the region and divided once. This differs from averaging
per-site percentages by up to 6.8 points on the sample data. The picker states
which is in use.

---

## Setup

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build:geo` | Regenerate the boundary GeoJSON (needs network) |

Node 20+. No environment variables, no secrets, no services to provision.

---

## Expected Excel shape

Nothing below is hardcoded — columns are discovered from the header row at
upload time, and the upload preview shows exactly what was detected before
anything loads. This describes what the app can make sense of.

**Sheet.** Whichever sheet holds the most data. The sheet name is not assumed;
a picker is available if the wrong one is chosen.

**Header row.** Detected, not assumed to be row 1. A row qualifies when more
than 70% of its cells are non-empty text *and* the row beneath it mixes types.
A title banner above the header is skipped. If detection falls back, the
preview says so loudly.

**Location columns.** At minimum a column recognisable as `State`. A `District`
column enables the district-level choropleth. Rows with a blank state are
dropped, and the count is reported.

**Measure columns.** Any column whose populated cells are >80% numeric. Values
in acres.

**Dimension columns.** Text columns — `Business`, `Site`, `Village`, `District`,
`State`. These populate the filter cascade.

Headers are matched after normalisation, so trailing spaces, embedded newlines,
and non-breaking spaces are all tolerated. Typos are **not** silently corrected;
`Coversion` stays misspelled in the key and is handled by keyword matching
instead.

### Invariants checked on every ingest

1. `Private Sale + Private Lease + Govt/revenue + Forest == Total Land Area`
2. `Used Land + Unused Land == Total Land Area`

Violations are reported per row in the preview with the expected value, the
actual value, and the signed difference. **Nothing is auto-corrected.** A row
missing a component is reported as *unevaluable*, which is deliberately
distinct from *violated*.

---

## Editing the alias map

When a district name in a workbook does not match the boundary file, add an
entry to [`public/geo/aliases.json`](public/geo/aliases.json) and reload the
page. **No rebuild, no restart** — the file is served as a static asset and
fetched fresh on every load.

```jsonc
{
  "districts": [
    { "from": "gurgoan", "to": "Gurugram" },

    // State-scoped. Use this whenever the "from" spelling is ALSO a real
    // district somewhere else.
    {
      "from": "raigarh",
      "to": "Raigad",
      "state": "Maharashtra",
      "note": "Raigarh is a real district of Chhattisgarh, 1,100 km away."
    }
  ]
}
```

- **`from`** — the spreadsheet spelling, lowercase, no punctuation. It is
  normalised on load, so `"Gurgoan"` also works.
- **`to`** — the boundary name **exactly** as the GeoJSON spells it, punctuation
  included. `"S.P.S. Nellore"`, not `"SPS Nellore"`.
- **`state`** — optional. When present, the alias applies only to records
  already resolved to that state.

**When to scope an alias:** if the `from` name exists as a real district in more
than one state. Three such cases are live in the sample data — `Raigarh`,
`Balrampur`, and `Lakhimpur`. An unscoped alias for any of them would move
records across the country silently.

Direction is always spreadsheet → boundary. The GeoJSON is the source of truth
for administrative names; never rename a boundary to match a spreadsheet.

To find the exact spelling to use as `to`:

```bash
node -e "const d=require('./public/geo/india-districts.geojson'); \
  console.log(d.features.filter(f=>/nellore/i.test(f.properties.name)) \
  .map(f=>f.properties.name+' @ '+f.properties.state))"
```

The test suite asserts that every `to` value exists in the boundary file, so a
typo fails `npm test` rather than silently becoming a no-op.

---

## Swapping the boundary GeoJSON

The files in `public/geo/` are generated and committed. To refresh them:

1. Edit `SOURCE_SHA` (and if needed `SOURCE_REPO` / `SOURCE_PATH`) in
   [`scripts/build-geo.mjs`](scripts/build-geo.mjs).
2. Run `npm run build:geo`.
3. Run `npm test` — the geo tests assert the district count, the uniqueness of
   every `(state, district)` pair, and the presence of every alias target.
4. Review the diff. A changed boundary changes which polygon records join to.

The commit is **pinned deliberately**, not tracking a branch. Indian district
boundaries change several times a year, and a moving source would silently
change what the choropleth reports under a deployed app.

To use a different source entirely, the pipeline needs the source to carry a
district name and a **parent state name** on every feature. The parent state is
load-bearing — see the collision list in
[public/geo/README.md](public/geo/README.md). Adjust the `SRC_DISTRICT` /
`SRC_STATE` constants to match the new property names; everything downstream
reads the normalised `name` / `state` properties the script writes.

---

## How it fits together

```
Upload  →  parse (Web Worker)  →  preview  →  [Load this data]  →  dataset store
                                                                         ↓
                                              resolve place names → boundaries
                                                                         ↓
   filters ──────────────────────────→  useDerivedData  ←────── measure picker
                                                ↓
                              ┌─────────────────┼─────────────────┐
                             map              table             chart
```

Every view reads from one derivation. There is no second query path, which is
why the table's row count and the map's totals cannot disagree.

| Module | Responsibility |
|---|---|
| `src/lib/ingest` | Parse, normalise, profile columns, check invariants |
| `src/lib/geo` | Resolve place names to boundaries (5-stage cascade) |
| `src/lib/measures` | Measure catalogue, aggregation strategies |
| `src/lib/filters` | Facet cascade, orphan retention, URL state |
| `src/lib/aggregate` | Per-region roll-up |
| `src/lib/color` | Validated ramps, class-interval methods |
| `src/lib/upload` | File validation, preview, column drift |
| `src/lib/export` | Extract with provenance sheet |

---

## Confidentiality

- Workbooks are parsed in the browser. **Nothing is uploaded.**
- Place-name resolution runs against vendored GeoJSON. There is **no geocoding**
  and no external location API.
- The map renders no basemap tiles, deliberately — every hosted tile or glyph
  provider would receive the viewport on every pan.
- Next.js telemetry is disabled. CI should set `NEXT_TELEMETRY_DISABLED=1`.
- `.gitignore` excludes `*.xlsx` / `*.xls` / `*.xlsm` / `*.kmz` so a production
  MIS cannot be committed by accident.

**One caveat about shareable URLs.** Filter state is serialised into the query
string so a filtered view can be shared. That string necessarily contains state,
district, and site names — treat a shared URL as carrying the same sensitivity
as the data itself. It lands in browser history and in whatever it is pasted
into. Only filter *values* are serialised; no acreage, count, or record-level
figure ever is.

---

## Known dependency issue

`xlsx@0.18.5` is the newest build on the npm registry and carries two unpatched
advisories. SheetJS moved distribution to its own CDN at 0.19.3, so npm will not
serve a fixed version. The exposure is narrow — the app parses a file the user
chose, in their own tab, with no server. The one-line fix once
`cdn.sheetjs.com` is reachable:

```jsonc
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

---

## What is not built

- **No persistence.** "Clear local data" clears memory; nothing is written to
  localStorage or IndexedDB yet.
- **No mobile layout.** The filter panel is hidden below tablet width. This is a
  desk tool; a half-working phone layout would be worse than none.
- **No KMZ / surveyed boundaries.** The seams exist (`LocationResult`,
  `AreaFigure`, resolver stage 0, the layer registry) but stage 0 is a
  documented no-op.
- **No PNG map export.** A shareable filtered URL covers the same need.
- **No column-role override UI.** A wrong inference is visible in the upload
  preview, which is where it gets caught and corrected at the source.
