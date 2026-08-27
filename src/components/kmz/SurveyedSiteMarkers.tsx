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
 * A red map pin — deliberately nothing like the round white district count
 * badge. The two carry incompatible claims ("somewhere in this district"
 * versus "here"), so the one thing the design must never do is let them be
 * confused for one another at a glance. The pin shape carries extra meaning a
 * geometric marker wouldn't: its tip IS the coordinate, the same convention
 * every map application uses — see {@link LocationPinIcon}.
 *
 * Positioned by its TIP, not its centre. A pin floats above the ground it
 * marks; anchoring by the icon's bounding-box centre (as a symmetric shape
 * like a circle or diamond safely can) would leave the point hovering above
 * the actual coordinate instead of sitting on it.
 */

import { useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';

import { showKmz } from '@/lib/kmz';
import { useKmzStore } from '@/store/kmz';
import { LocationPinIcon } from './LocationPinIcon';
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
              // -translate-y-full, not -1/2: this is what puts the pin's tip
              // exactly on the coordinate rather than the icon's centre. See
              // the module doc. origin-bottom keeps the hover scale pivoting
              // around that same tip, so growing the pin never detaches it
              // from the point it marks.
              className="pointer-events-auto absolute origin-bottom -translate-x-1/2 -translate-y-full text-red-600 drop-shadow-md transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-1"
            >
              <LocationPinIcon className="h-7 w-7" />
            </button>

            {isOpen && (
              <div
                role="dialog"
                aria-label={`Actions for ${site.label}`}
                // -top-9 clears the full height of the pin above the point
                // (the marker itself renders up to 28px above the coordinate,
                // per -translate-y-full above) plus a small gap, so the popup
                // never overlaps the icon it belongs to.
                className="pointer-events-auto absolute -top-9 -translate-x-1/2 -translate-y-full z-30 w-52 rounded border border-stone-300 bg-white p-2 shadow-lg"
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
