'use client';

/**
 * Markers for sites that have a surveyed position.
 *
 * ## Why this is allowed now, when V1 forbade it
 *
 * V1's rule was "do NOT plot individual site markers", and it was right: the
 * only point available then was the district centroid, shared exactly by every
 * site in the district. Drawing a dot per site would have invented positions
 * that a reader could not tell apart from surveyed ones.
 *
 * That objection does not apply to these. Every marker here comes from a
 * polygon in a file a surveyor produced, and it sits where that polygon
 * actually is. Nothing is inferred, jittered, or averaged across sites.
 *
 * The rule survives in the filter one line below: only `parsed` attachments
 * reach this component. A stored-but-unread file has no coordinate and an
 * unreadable one has no trustworthy coordinate, so neither gets a dot.
 *
 * ## Styled to be unmistakable
 *
 * A square, filled, accent-coloured pin — deliberately nothing like the round
 * white district count badge. The two carry incompatible claims ("somewhere in
 * this district" versus "here"), so the one thing the design must never do is
 * let them be confused for one another at a glance.
 */

import { useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';

import { showKmz } from '@/lib/kmz';
import { useKmzStore } from '@/store/kmz';
import type { SurveyedSite } from './useSurveyedSites';

export interface SurveyedSiteMarkersProps {
  readonly map: maplibregl.Map | null;
  readonly sites: readonly SurveyedSite[];
  readonly visible: boolean;
}

export function SurveyedSiteMarkers({ map, sites, visible }: SurveyedSiteMarkersProps) {
  const [, setTick] = useState(0);
  const [openSite, setOpenSite] = useState<string | null>(null);
  const noteKmzShown = useKmzStore((state) => state.noteKmzShown);

  // Same reprojection hook as the district badges: MapLibre has no "projection
  // changed" event, so `move` and `zoom` are what keep HTML over the canvas in
  // step with the camera.
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

  const points = useMemo(() => (visible ? sites : []), [visible, sites]);

  if (map === null || !visible || points.length === 0) return null;

  const width = map.getCanvas().clientWidth;
  const height = map.getCanvas().clientHeight;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {points.map((site) => {
        const point = map.project([site.centroid.lng, site.centroid.lat]);
        if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) {
          return null;
        }

        const isOpen = openSite === site.siteKey;

        return (
          <div
            key={site.siteKey}
            className="pointer-events-none absolute"
            style={{ left: point.x, top: point.y }}
          >
            <button
              type="button"
              onClick={() => setOpenSite(isOpen ? null : site.siteKey)}
              aria-expanded={isOpen}
              aria-label={`${site.label} — surveyed boundary. Open actions.`}
              title={`${site.label} — surveyed position from ${site.filename}`}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border border-white bg-emerald-600 p-[5px] shadow-md transition hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            />

            {isOpen && (
              <div
                role="dialog"
                aria-label={`Actions for ${site.label}`}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full -top-3 z-30 w-52 rounded border border-stone-300 bg-white p-2 shadow-lg"
              >
                <p className="truncate text-[11px] font-semibold text-stone-900" title={site.label}>
                  {site.label}
                </p>
                <p className="mt-0.5 text-[10px] text-stone-500">
                  Surveyed boundary · {site.filename}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      noteKmzShown();
                      void showKmz(site.siteKey, site.label);
                    }}
                    className="rounded bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-stone-700"
                  >
                    Show KMZ
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenSite(null)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-stone-500 hover:bg-stone-100"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
