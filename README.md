# Naksha — Land MIS Geographic Dashboard

Ingests a land-holdings Excel MIS and renders it as a choropleth over an India
map, with cascading State → District filters and user-selectable measures.

Everything runs in the browser. There is no backend and no database. See
[CLAUDE.md](CLAUDE.md) for the scope boundary, the source-data contract, and the
engineering rules this codebase is held to.

## Stack

| Concern        | Choice                                                     |
|----------------|------------------------------------------------------------|
| Framework      | Next.js 14 (App Router), statically exported pages          |
| Language       | TypeScript, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| Styling        | Tailwind CSS 3                                              |
| Filter state   | Zustand                                                     |
| Excel parsing  | SheetJS (`xlsx`), in-browser                                |
| Map            | MapLibre GL JS                                              |

MapLibre rather than Google Maps: it renders GeoJSON polygons natively, needs no
API key, bills nothing per load, and — the reason that matters here — never sends
place names or site names to a third-party tile or geocoding service.

## Status

Scaffold and type layer only. The parser, resolver, store, and UI are not built.

- [x] Project scaffold, building clean
- [x] `src/types/schema.ts` — record, column descriptor, workbook result, and the
      V2 seams
- [x] `src/lib/constants.ts` — conversion factors and the two ingest invariants
- [ ] Normalizer and parser
- [ ] Boundary GeoJSON and the resolver cascade
- [ ] Zustand filter store
- [ ] Map and table UI

## Commands

```bash
npm run dev        # dev server on :3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm test           # vitest
```

## Confidentiality

This repository handles commercial land-holding data.

- Workbooks are parsed in the browser. Nothing is uploaded.
- Place-name resolution runs against vendored GeoJSON. There is no geocoding
  call, so no site or district name reaches an external host.
- `.gitignore` excludes `*.xlsx` / `*.xls` / `*.xlsm` / `*.kmz` so a real MIS
  cannot be committed by accident. `Dummy land mis.xlsx` is explicitly
  re-included as the sample fixture — do not extend that exemption.
- Next.js build telemetry has been disabled on this machine
  (`npx next telemetry disable`). CI should also set `NEXT_TELEMETRY_DISABLED=1`,
  since the opt-out is stored per-machine and does not travel with the repo.

## Known dependency issue: `xlsx`

`xlsx@0.18.5` is the newest build published to the npm registry, and it carries
two unpatched advisories — prototype pollution (GHSA-4r6h-8v6p-xvw6) and a ReDoS
(GHSA-5pgg-2g8v-p4x9). SheetJS moved distribution to its own CDN at 0.19.3, so
npm will not serve a fixed version.

The exposure here is narrow: the app parses a file the user selected themselves,
in their own browser tab, with no server and no other tenant's data in the
process. It is still worth closing. The fix is a one-line change once
`cdn.sheetjs.com` is reachable from your network:

```jsonc
// package.json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

That host was blocked from the environment this scaffold was built in, which is
why the registry build is pinned for now.
