'use client';

/**
 * The MapLibre choropleth.
 *
 * ## No basemap, on purpose
 *
 * The style below has no raster source. Every off-the-shelf MapLibre style
 * fetches tiles from a hosted provider, which sends the viewport — and by
 * extension which districts are being inspected — to a third party on every
 * pan. CLAUDE.md forbids that outright. Polygons render over a flat surface
 * colour instead, which for an administrative choropleth is also simply better:
 * roads and coastlines under a filled polygon are noise.
 *
 * ## Feature state, not source replacement
 *
 * Aggregates are pushed with `setFeatureState`. Changing measure, bin count, or
 * class method updates state on existing features; it never rebuilds the
 * source. Re-uploading 724 polygons to the GPU to recolour them would drop
 * frames on every legend interaction.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { AggregationResult, RegionAggregate } from '@/lib/aggregate';
import type { BinnedScale, ColorMode } from '@/lib/color';
import { binIndexOf, CHROME, NO_DATA } from '@/lib/color';
import type { BoundaryIndex } from '@/lib/geo';
import { SurveyedSiteMarkers } from '@/components/kmz';
import type { SurveyedSite } from '@/components/kmz';
import { LAYER_IDS, SOURCES, buildLayers } from './layers';
import type { LayerBuildContext } from './layers';
import { RegionKeyboardList, RegionTooltip } from './RegionTooltip';
import { SiteBadges } from './SiteBadges';
import type { TooltipDatum } from './RegionTooltip';

/** India, comfortably framed. */
const INITIAL_VIEW = { center: [82.8, 22.6] as [number, number], zoom: 3.6 };

/** Padding for fitBounds, so a zoomed state does not touch the panel edges. */
const FIT_PADDING = { top: 48, bottom: 48, left: 48, right: 320 };

export interface MapViewProps {
  readonly boundaries: BoundaryIndex;
  readonly aggregation: AggregationResult;
  readonly scale: BinnedScale;
  readonly ramp: readonly string[];
  readonly mode: ColorMode;
  readonly level: 'state' | 'district';
  readonly measureLabel: string;
  /** Formats a value in the active measure's unit. */
  readonly formatValue: (value: number) => string;
  readonly selectedState: string | null;
  readonly selectedDistrict: string | null;
  readonly onSelectState: (name: string) => void;
  readonly onSelectDistrict: (name: string) => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onOpenSiteList: (name: string) => void;
  /** Sites with a parsed KMZ. Only these have a real position to plot. */
  readonly surveyedSites: readonly SurveyedSite[];
}

export function MapView({
  boundaries,
  aggregation,
  scale,
  ramp,
  mode,
  level,
  measureLabel,
  formatValue,
  selectedState,
  selectedDistrict,
  onSelectState,
  onSelectDistrict,
  onZoomChange,
  onOpenSiteList,
  surveyedSites,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<{ source: string; id: string | number } | null>(null);
  const [ready, setReady] = useState(false);
  // Mirrors mapRef into state so child overlays re-render once the map exists;
  // a ref alone would not trigger that.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [tooltip, setTooltip] = useState<TooltipDatum | null>(null);
  const [tooltipAt, setTooltipAt] = useState<{ x: number; y: number } | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Sources                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Feature collections, with a numeric `id` per feature.
   *
   * `setFeatureState` requires a stable feature id, and GeoJSON features from
   * disk have none — so index-based ids are assigned once here. They must stay
   * stable for the lifetime of the source, which is why this is memoised on the
   * boundary index rather than recomputed per render.
   */
  const collections = useMemo(() => {
    const withIds = (entries: BoundaryIndex['states']) => ({
      type: 'FeatureCollection' as const,
      features: entries.map((entry, index) => ({
        ...entry.feature,
        id: index,
        properties: { ...entry.feature.properties },
      })),
    });

    return {
      states: withIds(boundaries.states),
      districts: withIds(boundaries.districts),
    };
  }, [boundaries]);

  /** Name → feature id, for pushing aggregates onto the right feature. */
  const idByName = useMemo(() => {
    const states = new Map<string, number>();
    const districts = new Map<string, number>();
    collections.states.features.forEach((f, i) => states.set(f.properties.name, i));
    collections.districts.features.forEach((f, i) => districts.set(f.properties.name, i));
    return { states, districts };
  }, [collections]);

  /* ---------------------------------------------------------------------- */
  /* Init                                                                    */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) return;

    const style: StyleSpecification = {
      version: 8,
      // No `glyphs` entry at all. A glyph URL is what MapLibre needs to render
      // `symbol` text, and every hosted glyph endpoint is a third-party request
      // CLAUDE.md forbids. Site-count labels are HTML overlays instead, so no
      // text is ever rasterised by MapLibre and nothing needs fetching.
      sources: {},
      layers: [
        {
          id: 'surface',
          type: 'background',
          paint: { 'background-color': CHROME[mode].page },
        },
      ],
    };

    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      attributionControl: false,

      // Scroll-to-zoom, explicitly. It is MapLibre's default, but the default
      // is easy to lose to a stray option and it is the first thing a user
      // reaches for on a map.
      scrollZoom: true,
      boxZoom: false,
      // A choropleth of administrative units has no reason to rotate or tilt,
      // and an accidental two-finger twist that leaves India at an angle is
      // pure confusion with no way back short of reloading.
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,

      // Zoom floor and ceiling. Without a floor, maxBounds makes MapLibre
      // derive one from the viewport — and in a short, wide container that
      // derived floor can land on top of the initial zoom, so scrolling out
      // does nothing and the map feels broken.
      minZoom: 3,
      // Raised from 10 when surveyed boundaries landed. A parcel outline
      // appears at zoom 10 (zoom 10), so a ceiling of 10 made
      // it reachable only at the very last notch of the zoom range — visible in
      // principle, useless in practice for looking at a parcel a few hundred
      // metres across. 16 is close enough to read one boundary against another.
      maxZoom: 16,

      // The data is Indian administrative boundaries; there is nothing to see
      // outside these bounds. Padded well beyond the coastline so panning at
      // low zoom does not feel like hitting a wall.
      maxBounds: [
        [55, -5],
        [110, 45],
      ],
    });

    // Double-click zoom interferes with double-clicking a district to drill in.
    map.doubleClickZoom.disable();

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => setReady(true));
    map.on('zoomend', () => onZoomChange(map.getZoom()));

    // MapLibre listens for WINDOW resize but not for its own container
    // changing size. This layout changes it often — collapsing the supporting
    // views, hiding the filter panel, opening the site list — and without this
    // the canvas keeps its old dimensions and the map renders letterboxed
    // inside a container that has already grown.
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);

    mapRef.current = map;
    setMapInstance(map);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
    // Intentionally mount-only. Mode and zoom changes are applied by the
    // effects below rather than by tearing down the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Sources + layers                                                        */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) return;

    const upsert = (id: string, data: GeoJSON.FeatureCollection) => {
      const existing = map.getSource(id) as GeoJSONSource | undefined;
      if (existing === undefined) {
        map.addSource(id, { type: 'geojson', data });
      } else {
        existing.setData(data);
      }
    };

    upsert(SOURCES.states, collections.states as GeoJSON.FeatureCollection);
    upsert(SOURCES.districts, collections.districts as GeoJSON.FeatureCollection);
    // Registered empty so the outline layer always has a source to attach to.
    // Its data arrives in the effect below, which can fire before or after the
    // first attachment is stored.
    upsert(SOURCES.surveyed, { type: 'FeatureCollection', features: [] });
  }, [ready, collections]);

  /**
   * Surveyed boundary geometry.
   *
   * Sites whose cached geometry is missing — records written before it was
   * stored — are simply absent from this collection. They still get a marker
   * from their centroid; they just have no outline until the file is uploaded
   * again.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) return;
    const source = map.getSource(SOURCES.surveyed) as GeoJSONSource | undefined;
    if (source === undefined) return;

    source.setData({
      type: 'FeatureCollection',
      features: surveyedSites
        .filter((site) => site.geometry !== null)
        .map((site) => ({
          type: 'Feature' as const,
          geometry: site.geometry as GeoJSON.Geometry,
          properties: { siteKey: site.siteKey, label: site.label },
        })),
    });
  }, [ready, surveyedSites]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) return;
    if (map.getSource(SOURCES.states) === undefined) return;

    const context: LayerBuildContext = {
      mode,
      scale,
      ramp,
      level,
      selectedState,
      selectedDistrict,
    };

    // Iterate the registry. The component does not know what layers exist —
    // which is what lets V2 append a surveyed-polygon layer by editing
    // layers.ts alone.
    for (const layer of buildLayers(context)) {
      // HTML-rendered entries (the site badge) are drawn by React below. They
      // stay in the same registry so ordering is declared in one place.
      if (layer.renderer !== 'maplibre' || layer.spec === undefined) continue;
      if (map.getLayer(layer.id) !== undefined) map.removeLayer(layer.id);
      map.addLayer(layer.spec as never);
    }
  }, [ready, mode, scale, ramp, level, selectedState, selectedDistrict]);

  /* ---------------------------------------------------------------------- */
  /* Push aggregates as feature state                                        */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) return;
    if (map.getSource(SOURCES.states) === undefined) return;

    const source = level === 'state' ? SOURCES.states : SOURCES.districts;
    const lookup = level === 'state' ? idByName.states : idByName.districts;

    // Clear first. Without this, a region that had data under the previous
    // measure and has none under the new one keeps its old colour — the map
    // would show a figure that is no longer being displayed anywhere.
    map.removeFeatureState({ source });

    for (const [name, id] of lookup) {
      const region = aggregation.byRegion.get(name);
      // A region with records but a NULL value is deliberately left without
      // feature state, so the fill expression treats it as no-data. That is the
      // case where every site has zero total area and a percentage is
      // undefined — "no data", never "0%".
      if (region === undefined || region.value === null) continue;

      map.setFeatureState(
        { source, id },
        {
          hasData: true,
          total: region.value,
          binIndex: binIndexOf(scale, region.value),
          siteCount: region.siteCount,
        },
      );
    }
  }, [ready, aggregation, scale, level, idByName]);

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                             */
  /* ---------------------------------------------------------------------- */

  const datumFor = useCallback(
    (name: string, state: string): TooltipDatum => {
      const region: RegionAggregate | undefined = aggregation.byRegion.get(name);
      return {
        name,
        state,
        // null, not 0. Covers both "no records here" and "records but no
        // computable figure" — the tooltip says "no data" for each, which is
        // accurate for both and false for neither.
        total: region?.value ?? null,
        siteCount: region?.siteCount ?? 0,
        recordCount: region?.recordCount ?? 0,
      };
    },
    [aggregation],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (map === null || !ready) return;
    if (map.getLayer(LAYER_IDS.stateFill) === undefined) return;

    const fillLayer = level === 'state' ? LAYER_IDS.stateFill : LAYER_IDS.districtFill;
    const source = level === 'state' ? SOURCES.states : SOURCES.districts;

    const clearHover = () => {
      if (hoveredRef.current !== null) {
        map.setFeatureState(hoveredRef.current, { hover: false });
        hoveredRef.current = null;
      }
    };

    const onMove = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
      if (feature?.id === undefined) return;

      if (hoveredRef.current?.id !== feature.id) {
        clearHover();
        hoveredRef.current = { source, id: feature.id };
        map.setFeatureState(hoveredRef.current, { hover: true });
      }

      const props = feature.properties as { name: string; state: string };
      setTooltip(datumFor(props.name, props.state));
      setTooltipAt({ x: event.point.x, y: event.point.y });
      map.getCanvas().style.cursor = 'pointer';
    };

    const onLeave = () => {
      clearHover();
      setTooltip(null);
      setTooltipAt(null);
      map.getCanvas().style.cursor = '';
    };

    const onClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (feature === undefined) return;
      const props = feature.properties as { name: string; state: string };

      if (level === 'state') {
        // Zoom to the clicked state AND push it into the store. The store is
        // what the filter controls read, so this one click updates both — the
        // map and the filters cannot drift apart because neither owns the
        // selection.
        onSelectState(props.name);
        const entry = boundaries.states.find((s) => s.name === props.name);
        if (entry !== undefined) {
          const [w, s, e, n] = entry.feature.properties.bbox;
          map.fitBounds(
            [
              [w, s],
              [e, n],
            ],
            { padding: FIT_PADDING, duration: 600 },
          );
        }
      } else {
        onSelectDistrict(props.name);
      }
    };

    map.on('mousemove', fillLayer, onMove);
    map.on('mouseleave', fillLayer, onLeave);
    map.on('click', fillLayer, onClick);

    return () => {
      map.off('mousemove', fillLayer, onMove);
      map.off('mouseleave', fillLayer, onLeave);
      map.off('click', fillLayer, onClick);
    };
  }, [ready, level, datumFor, boundaries, onSelectState, onSelectDistrict]);

  /* ---------------------------------------------------------------------- */
  /* Keyboard focus mirrors hover                                            */
  /* ---------------------------------------------------------------------- */

  const handleFocusRegion = useCallback(
    (name: string | null) => {
      const map = mapRef.current;
      if (name === null) {
        setTooltip(null);
        setTooltipAt(null);
        return;
      }

      const entries = level === 'state' ? boundaries.states : boundaries.districts;
      const entry = entries.find((e) => e.name === name);
      if (entry === undefined) return;

      setTooltip(datumFor(name, entry.state));
      // Anchor to the region's centroid so the tooltip appears where the
      // polygon is, not parked in a corner.
      if (map !== null) {
        const point = map.project(entry.feature.properties.centroid as [number, number]);
        setTooltipAt({ x: point.x, y: point.y });
      }
    },
    [level, boundaries, datumFor],
  );

  const noDataRegions = useMemo(() => {
    const entries = level === 'state' ? boundaries.states : boundaries.districts;
    const scoped =
      level === 'district' && selectedState !== null
        ? entries.filter((e) => e.state === selectedState)
        : entries;

    return scoped
      .filter((e) => aggregation.byRegion.get(e.name)?.value == null)
      .map((e) => ({ name: e.name, state: e.state }));
  }, [level, boundaries, aggregation, selectedState]);

  const visibleRegions = useMemo(
    () =>
      [...aggregation.byRegion.values()].sort(
        (a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity),
      ),
    [aggregation],
  );

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ backgroundColor: CHROME[mode].page }}
      />

      {/*
        The hatch pattern for no-data regions is an SVG overlay rather than a
        MapLibre fill-pattern, because a fill-pattern needs a raster image
        loaded into the style and this stays resolution-independent.
      */}
      <svg aria-hidden="true" className="pointer-events-none absolute h-0 w-0">
        <defs>
          <pattern
            id="no-data-hatch"
            width="6"
            height="6"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="6" height="6" fill={NO_DATA[mode].base} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke={NO_DATA[mode].stroke}
              strokeWidth="2"
            />
          </pattern>
        </defs>
      </svg>

      <SiteBadges
        map={mapInstance}
        boundaries={boundaries}
        aggregation={aggregation}
        visible={level === 'district'}
        selectedState={selectedState}
        onOpenSiteList={onOpenSiteList}
      />

      {/*
        Drawn over the district badges (z-20 against z-10). Where both land on
        the same pixel the precise thing should win — a badge means "somewhere
        in this district" and a marker means "here", and the marker is the
        stronger claim.
      */}
      <SurveyedSiteMarkers map={mapInstance} sites={surveyedSites} visible />

      <RegionTooltip
        datum={tooltip}
        position={tooltipAt}
        measureLabel={measureLabel}
        formatValue={formatValue}
      />

      <RegionKeyboardList
        regions={visibleRegions}
        noDataRegions={noDataRegions}
        measureLabel={measureLabel}
        formatValue={formatValue}
        levelLabel={level === 'state' ? 'State' : 'District'}
        onFocusRegion={handleFocusRegion}
        onSelectRegion={level === 'state' ? onSelectState : onSelectDistrict}
      />
    </div>
  );
}
