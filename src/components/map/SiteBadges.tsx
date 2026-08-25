'use client';

/**
 * Site count badges, drawn as HTML over the map canvas.
 *
 * ## What this deliberately is not
 *
 * It is not one marker per site. This dataset has no per-site coordinates —
 * only the district a site sits in — so the single point available is that
 * district's centroid, and every site in the district shares it exactly.
 * Scattering or jittering them into distinct dots would render positions that
 * were never surveyed while looking indistinguishable from positions that were.
 * A reader cannot tell a fabricated point from a real one, which makes the fake
 * point worse than no point at all.
 *
 * So one badge per district, carrying a count: "6". Clicking it opens those six
 * records in the side panel, where they can be read as what they are — a list
 * of sites known to be in this district.
 *
 * ## Why HTML rather than a MapLibre symbol layer
 *
 * Rendering text in MapLibre needs a `glyphs` URL, and every hosted glyph
 * endpoint is a third-party request CLAUDE.md forbids. HTML also gets three
 * things free that a canvas-drawn badge would have to reimplement: it is
 * focusable, it is clickable, and it is readable by a screen reader.
 */

import { useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';

import type { AggregationResult } from '@/lib/aggregate';
import type { BoundaryIndex } from '@/lib/geo';

export interface SiteBadgesProps {
  readonly map: maplibregl.Map | null;
  readonly boundaries: BoundaryIndex;
  readonly aggregation: AggregationResult;
  readonly visible: boolean;
  /** Restrict to one state's districts when a state is selected. */
  readonly selectedState: string | null;
  readonly onOpenSiteList: (regionName: string) => void;
}

interface BadgeDatum {
  readonly name: string;
  readonly siteCount: number;
  readonly lngLat: readonly [number, number];
}

export function SiteBadges({
  map,
  boundaries,
  aggregation,
  visible,
  selectedState,
  onOpenSiteList,
}: SiteBadgesProps) {
  const [, setTick] = useState(0);

  // Reproject on every camera change. MapLibre gives no "projection changed"
  // event, so `move` is the honest hook — it fires continuously during a pan
  // and during the easing of a fitBounds, which is exactly when the badges
  // would otherwise lag behind their districts.
  useEffect(() => {
    if (map === null) return;
    const rerender = () => setTick((n) => n + 1);
    map.on('move', rerender);
    map.on('zoom', rerender);
    return () => {
      map.off('move', rerender);
      map.off('zoom', rerender);
    };
  }, [map]);

  const badges = useMemo<BadgeDatum[]>(() => {
    if (!visible) return [];

    const centroids = new Map<string, readonly [number, number]>();
    for (const entry of boundaries.districts) {
      if (selectedState !== null && entry.state !== selectedState) continue;
      centroids.set(entry.name, entry.feature.properties.centroid);
    }

    return [...aggregation.byRegion.values()]
      .filter((region) => region.siteCount > 0 && centroids.has(region.name))
      .map((region) => ({
        name: region.name,
        siteCount: region.siteCount,
        lngLat: centroids.get(region.name)!,
      }));
  }, [visible, aggregation, boundaries, selectedState]);

  if (map === null || !visible || badges.length === 0) return null;

  return (
    <div
      // The container ignores pointer events so panning still works between
      // badges; each badge re-enables them for itself.
      className="pointer-events-none absolute inset-0 z-10"
    >
      {badges.map((badge) => {
        const point = map.project(badge.lngLat as [number, number]);

        // Skip badges the camera has moved off-screen rather than rendering
        // hundreds of absolutely-positioned nodes outside the viewport.
        if (
          point.x < -40 ||
          point.y < -40 ||
          point.x > map.getCanvas().clientWidth + 40 ||
          point.y > map.getCanvas().clientHeight + 40
        ) {
          return null;
        }

        const label = `${badge.siteCount} site${badge.siteCount === 1 ? '' : 's'} in ${badge.name}`;

        return (
          <button
            key={badge.name}
            type="button"
            onClick={() => onOpenSiteList(badge.name)}
            title={label}
            aria-label={`${label}. Open the site list.`}
            className="pointer-events-auto absolute flex min-w-[1.75rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-500 bg-white/95 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-900 shadow-sm transition hover:scale-110 hover:border-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-neutral-400 dark:bg-neutral-900/95 dark:text-neutral-100 dark:hover:border-neutral-100"
            style={{ left: point.x, top: point.y }}
          >
            {badge.siteCount}
          </button>
        );
      })}
    </div>
  );
}
