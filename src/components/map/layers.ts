/**
 * Map layer registry.
 *
 * Layers are a LIST, built by a function, not a hardcoded sequence of
 * `map.addLayer` calls. CLAUDE.md: "Map layer registration is a list, so a
 * polygon layer can be appended without restructuring the map component."
 *
 * V2's surveyed-polygon layer is one more entry pushed into the array with an
 * `order` above the district fill. The map component iterates the list and
 * knows nothing about what is in it, so adding that layer touches this file and
 * nothing else.
 *
 * ## No basemap
 *
 * There are deliberately no raster tiles under these polygons. Every MapLibre
 * "default" style fetches tiles from a hosted provider, which would send the
 * viewport — and by extension which districts a user is inspecting — to a third
 * party on every pan. CLAUDE.md forbids exactly that: "no third-party API calls
 * carrying site names or place names."
 *
 * The map therefore renders vendored GeoJSON over a flat surface colour. For a
 * choropleth of administrative units this is not a compromise — coastlines and
 * roads under a filled polygon are noise, and their absence keeps attention on
 * the fill, which is the data.
 */

import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
} from 'maplibre-gl';

import type { BinnedScale } from '@/lib/color';
import type { ColorMode } from '@/lib/color';
import { CHROME, NO_DATA, ZERO_VALUE } from '@/lib/color';

/** Source ids. */
export const SOURCES = {
  states: 'boundaries-states',
  districts: 'boundaries-districts',
  /** Point source carrying one feature per district that has sites. */
  siteBadges: 'site-badges',
} as const;

/** Layer ids, stable so tests and event handlers can reference them. */
export const LAYER_IDS = {
  stateFill: 'state-fill',
  stateOutline: 'state-outline',
  stateSelected: 'state-selected',
  districtFill: 'district-fill',
  districtOutline: 'district-outline',
  districtSelected: 'district-selected',
  siteBadge: 'site-badge',
} as const;

/**
 * What a registered layer is, independent of MapLibre's own typing.
 *
 * `renderer` splits the list into layers MapLibre paints and layers React
 * paints as HTML over the canvas. Both live in the same ordered registry so the
 * map component still has exactly one list to walk, and V2's surveyed polygons
 * can be appended to it regardless of which renderer they need.
 */
export interface RegisteredLayer {
  readonly id: string;
  /**
   * Who draws it. HTML overlays exist because MapLibre `symbol` layers require
   * a glyph URL, and every hosted glyph endpoint is a third-party request that
   * CLAUDE.md forbids. Self-hosting glyph PBFs would be the alternative; an
   * HTML badge is lighter, natively focusable, and natively clickable.
   */
  readonly renderer: 'maplibre' | 'html';
  readonly kind:
    | 'choropleth'
    | 'boundary-outline'
    | 'selection'
    | 'site-badge'
    /** V2. Declared here so consumers switch exhaustively today. */
    | 'surveyed-polygon';
  /** Ascending paint order; later draws on top. */
  readonly order: number;
  readonly adminLevel?: 'state' | 'district';
  readonly visible: boolean;
  /** Whether hover and click handlers attach to this layer. */
  readonly interactive: boolean;
  /** Present only when `renderer` is `'maplibre'`. */
  readonly spec?:
    | FillLayerSpecification
    | LineLayerSpecification
    | CircleLayerSpecification;
}

/** Inputs the paint expressions need. */
export interface LayerBuildContext {
  readonly mode: ColorMode;
  readonly scale: BinnedScale;
  readonly ramp: readonly string[];
  readonly level: 'state' | 'district';
  readonly selectedState: string | null;
  readonly selectedDistrict: string | null;
}

/**
 * Fill colour expression, driven by feature state rather than by data joins.
 *
 * `feature-state` is set per feature after aggregation, so re-colouring on a
 * measure change is a state update rather than a source replacement — the
 * geometry never re-uploads to the GPU.
 *
 * Three-way branch, and the ordering is the whole point:
 *
 *   1. no `hasData` state → the no-data base colour, hatched by an overlay.
 *   2. `hasData` but the value is exactly 0 → the dedicated zero colour.
 *   3. otherwise → the bin colour.
 *
 * Cases 1 and 2 are different facts. A district with no computable figure and a
 * district with a recorded 0 must not render identically, and the natural
 * implementation — `coalesce(value, 0)` — collapses them.
 *
 * `hasData` is set only when the aggregate value is NON-NULL, so a region whose
 * sites all have zero total area lands in case 1 when a percentage is selected:
 * "no data", not "0% utilised".
 */
function fillColorExpression(context: LayerBuildContext): unknown[] {
  const { mode, ramp } = context;

  const binBranches: unknown[] = [];
  for (let i = 0; i < ramp.length; i += 1) {
    binBranches.push(i, ramp[i]!);
  }

  return [
    'case',
    // 1. No data.
    ['!=', ['feature-state', 'hasData'], true],
    NO_DATA[mode].base,
    // 2. Present, but zero.
    ['==', ['feature-state', 'total'], 0],
    ZERO_VALUE[mode],
    // 3. Binned value. The fallback should be unreachable — a region with data
    // always lands in a bin — but MapLibre requires a default branch.
    ['match', ['feature-state', 'binIndex'], ...binBranches, NO_DATA[mode].base],
  ];
}

/**
 * Build the ordered layer list.
 *
 * State and district layers both exist at all times; visibility toggles between
 * them. Keeping both registered means switching level is a paint-property
 * change rather than an add/remove cycle, which avoids the flash of an empty
 * map on every drill-down.
 */
export function buildLayers(context: LayerBuildContext): readonly RegisteredLayer[] {
  const { mode, level, selectedState, selectedDistrict } = context;
  const chrome = CHROME[mode];
  const showDistricts = level === 'district';

  const layers: RegisteredLayer[] = [
    {
      id: LAYER_IDS.stateFill,
      renderer: 'maplibre',
      kind: 'choropleth',
      order: 10,
      adminLevel: 'state',
      visible: !showDistricts,
      interactive: !showDistricts,
      spec: {
        id: LAYER_IDS.stateFill,
        type: 'fill',
        source: SOURCES.states,
        layout: { visibility: !showDistricts ? 'visible' : 'none' },
        paint: {
          'fill-color': fillColorExpression(context) as never,
          // Animate recolouring rather than swapping instantly. Changing the
          // measure repaints every region at once, and a hard cut gives the eye
          // nothing to track — 250ms is long enough to see WHICH regions moved
          // and short enough not to feel like waiting.
          'fill-color-transition': { duration: 250, delay: 0 },
          // Hover is a fill-opacity lift rather than a colour change, so the
          // bin a region belongs to stays readable while pointing at it.
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.85,
            1,
          ] as never,
        },
      },
    },
    {
      id: LAYER_IDS.stateOutline,
      renderer: 'maplibre',
      kind: 'boundary-outline',
      order: 20,
      adminLevel: 'state',
      visible: true,
      interactive: false,
      spec: {
        id: LAYER_IDS.stateOutline,
        type: 'line',
        source: SOURCES.states,
        paint: {
          'line-color': chrome.boundary,
          // State borders stay visible under the district fill, so a user can
          // still see which state they are inside after drilling in.
          'line-width': showDistricts ? 1.2 : 0.6,
        },
      },
    },
    {
      id: LAYER_IDS.districtFill,
      renderer: 'maplibre',
      kind: 'choropleth',
      order: 30,
      adminLevel: 'district',
      visible: showDistricts,
      interactive: showDistricts,
      spec: {
        id: LAYER_IDS.districtFill,
        type: 'fill',
        source: SOURCES.districts,
        layout: { visibility: showDistricts ? 'visible' : 'none' },
        // With a state selected, show only that state's districts. Without one
        // — the zoom-triggered case — show all of them, because the user has
        // not told us where to look.
        ...(selectedState !== null ? { filter: ['==', ['get', 'state'], selectedState] } : {}),
        paint: {
          'fill-color': fillColorExpression(context) as never,
          // Animate recolouring rather than swapping instantly. Changing the
          // measure repaints every region at once, and a hard cut gives the eye
          // nothing to track — 250ms is long enough to see WHICH regions moved
          // and short enough not to feel like waiting.
          'fill-color-transition': { duration: 250, delay: 0 },
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.85,
            1,
          ] as never,
        },
      },
    },
    {
      id: LAYER_IDS.districtOutline,
      renderer: 'maplibre',
      kind: 'boundary-outline',
      order: 40,
      adminLevel: 'district',
      visible: showDistricts,
      interactive: false,
      spec: {
        id: LAYER_IDS.districtOutline,
        type: 'line',
        source: SOURCES.districts,
        layout: { visibility: showDistricts ? 'visible' : 'none' },
        ...(selectedState !== null ? { filter: ['==', ['get', 'state'], selectedState] } : {}),
        paint: { 'line-color': chrome.boundary, 'line-width': 0.4 },
      },
    },
    {
      id: LAYER_IDS.stateSelected,
      renderer: 'maplibre',
      kind: 'selection',
      order: 50,
      adminLevel: 'state',
      visible: selectedState !== null,
      interactive: false,
      spec: {
        id: LAYER_IDS.stateSelected,
        type: 'line',
        source: SOURCES.states,
        // No selection means match nothing. An explicit `false` is clearer
        // than a sentinel string, and cannot collide with a real region name.
        filter: selectedState === null ? false : ['==', ['get', 'name'], selectedState],
        paint: { 'line-color': chrome.boundaryStrong, 'line-width': 2 },
      },
    },
    {
      id: LAYER_IDS.districtSelected,
      renderer: 'maplibre',
      kind: 'selection',
      order: 60,
      adminLevel: 'district',
      visible: selectedDistrict !== null,
      interactive: false,
      spec: {
        id: LAYER_IDS.districtSelected,
        type: 'line',
        source: SOURCES.districts,
        filter: selectedDistrict === null ? false : ['==', ['get', 'name'], selectedDistrict],
        paint: { 'line-color': chrome.highlight, 'line-width': 2 },
      },
    },
    /**
     * Site count badge.
     *
     * A COUNT on the district centroid — never one marker per site. There are
     * no per-site coordinates in this data; the only point available is the
     * district's centroid, and every site in a district shares it. Scattering
     * or jittering them would draw positions that were never surveyed but look
     * exactly like positions that were. A badge reading "6 sites" says
     * precisely what is known: six sites, somewhere in this district.
     *
     * Rendered as HTML rather than a MapLibre symbol layer — see
     * {@link RegisteredLayer.renderer}.
     */
    {
      id: LAYER_IDS.siteBadge,
      renderer: 'html',
      kind: 'site-badge',
      order: 70,
      adminLevel: 'district',
      visible: showDistricts,
      interactive: showDistricts,
    },
  ];

  // V2 appends here. `order` above 80 puts surveyed polygons over everything.

  return layers.sort((a, b) => a.order - b.order);
}
