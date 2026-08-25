# Boundary data

Vendored administrative boundaries for India. Both files are **generated** by
`scripts/build-geo.mjs` and committed. Do not hand-edit them — re-run
`npm run build:geo` instead.

## Files

| File | Features | Size | Contents |
|------|----------|------|----------|
| `india-states.geojson` | 36 | ~0.1 MB | States and Union Territories |
| `india-districts.geojson` | 724 | ~0.5 MB | Districts |
| `provenance.json` | — | — | Machine-readable build manifest |
| `aliases.json` | — | — | Hand-maintained name corrections (see below) |

## Source and vintage

- **Source:** <https://github.com/udit-001/india-maps-data>
- **Pinned commit:** `cc91a19ffbca10b7ca6872a1e9690b4e5fd3aa0a` (2026-07-13)
- **Path:** `geojson/india.geojson`
- **Vintage:** predominantly **Census 2011**, with later corrections applied
  piecemeal. The `vintage` property on each district records which: values seen
  are `2011_c`, `2012_c`, `2014_c`, `2015_c`, `2016_c`, `2017_c`, `2018`,
  `2019`, `update2014`, and `update2025`.

The commit is pinned rather than tracking `main`, deliberately. See the caveat
below for why that matters more here than it does for most vendored data.

## ⚠️ Caveat: these boundaries are approximate and they go stale

**Indian district boundaries change frequently.** States carve out new districts
every year — often several at once, sometimes a dozen in a single
administrative order. The pinned commit is itself titled *"split Banaskantha
into Banaskantha + Vav-Tharad district"*, which is a fair illustration of the
churn. A district that exists in your spreadsheet may not exist in this file,
and vice versa.

**Consequences you should expect:**

- A district created after this vintage will not match, and its records will
  appear in the unmapped panel. That is correct behaviour, not a bug.
- A district that was split will still be drawn at its *pre-split* extent, so
  its acreage is attributed to a larger polygon than reality.
- Spellings drift between vintages. Shravasti (Uttar Pradesh) appears here as
  **Shrawasti**, with a `w`. The resolver's fuzzy stage handles that one at
  0.889 similarity and flags it for review; other such variants may need an
  alias.

**External borders are disputed and sources disagree.** This dataset draws
Jammu and Kashmir and Ladakh as administered by India. Other sources — and
other governments — draw them differently. Nothing about this choice is a
statement of position; it is a property of the upstream data. If these maps are
shown outside India, check whether the depiction is appropriate for your
audience before publishing.

**These are not survey-grade.** Geometry is simplified (below) and is suitable
for a choropleth, not for anything cadastral. Per `CLAUDE.md`, V1 never computes
parcel area from this geometry — every area figure comes from the spreadsheet.

## Processing

1. Downloaded from the pinned commit.
2. **Filtered.** The source mixes 726 district polygons with 34 nameless
   state-outline features (one per state; Lakshadweep and Chandigarh have
   none). The outlines are dropped — kept, they would be phantom unnamed
   districts a fuzzy match could latch onto.
3. **Dissolved on `(district, st_nm)`.** Lakshadweep and Chandigarh each arrive
   as two features sharing one name. After this, `(state, name)` is unique
   across the district file, at 724 features.
4. **Simplified** with mapshaper, `interval=1100` metres ≈ 0.01°, with
   `keep-shapes` so small districts do not vanish. Coordinates rounded to
   0.0001° (~11 m).
5. **States derived by dissolving districts on `st_nm`**, rather than
   downloaded separately. Two independently sourced files would eventually
   disagree — a district whose parent state is missing from the state file, or
   an external border drawn differently at the two levels — and the resolver's
   state-scoped district lookup would then fail in ways that are painful to
   trace. Dissolving guarantees both levels share a border and a name set.
6. **Centroids and bboxes precomputed** and stored in feature properties, so
   nothing recomputes them per render.

## Feature properties

Every feature in both files carries the same shape:

```jsonc
{
  "name":     "Raigad",        // district name, or state name in the states file
  "state":    "Maharashtra",   // parent state; equals `name` in the states file
  "level":    "district",      // "district" | "state"
  "vintage":  "2011_c",        // source vintage marker, null for states
  "centroid": [73.217416, 18.516158],   // [lng, lat], area-weighted
  "bbox":     [72.7736, 17.8574, 73.7141, 19.1329]  // [w, s, e, n]
}
```

`state` is present on **every** district and is load-bearing. Five district
names occur in more than one state in this dataset:

| Name | States |
|------|--------|
| Aurangabad | Maharashtra, Bihar |
| Bilaspur | Chhattisgarh, Himachal Pradesh |
| Balrampur | Chhattisgarh, Uttar Pradesh |
| Hamirpur | Uttar Pradesh, Himachal Pradesh |
| Pratapgarh | Rajasthan, Uttar Pradesh |

Plus the near-miss pair that motivated all of this: **Raigad (Maharashtra)** and
**Raigarh (Chhattisgarh)** are 1,100 km apart and one letter different. Any
district lookup that is not scoped to a resolved parent state will eventually
put land in the wrong half of the country.

### Centroid caveat

Centroids are area-weighted over outer rings. For a strongly concave district
the point can fall outside the polygon. That is acceptable because V1 uses it
only as a label anchor and a map fly-to target — `CLAUDE.md` forbids plotting
per-site markers, so nothing is ever drawn at this coordinate as though it were
a surveyed position.

## `aliases.json`

Hand-maintained corrections from spreadsheet spellings to canonical boundary
names. It is served as a static asset, **not bundled**, so it can be edited and
reloaded without a rebuild. See the file's own `_readme` key for its schema.

Names are normalized *onto* these boundary names, never the reverse —
`CLAUDE.md` makes the GeoJSON the source of truth for administrative names.

## Refreshing

```bash
npm run build:geo
```

Requires network access to raw.githubusercontent.com. Bumping the pinned SHA in
`scripts/build-geo.mjs` is a deliberate act: review the resulting diff, and
re-run the geo tests, which assert the district count and the presence of every
alias target.
