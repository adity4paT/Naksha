'use client';

/**
 * Joining stored attachments back to the sites in the loaded workbook.
 *
 * The two halves live apart on purpose — attachments are keyed by
 * {@link SiteKey} in IndexedDB and outlive any one workbook, while records are
 * replaced wholesale on every upload. This is where they meet, and it is a
 * derivation rather than stored state so a re-upload cannot leave the map
 * showing markers for sites that are no longer in the data.
 */

import { useMemo } from 'react';

import { indexSites } from '@/lib/kmz';
import type { LatLng, SiteKeyColumns } from '@/lib/kmz';
import { useKmzStore } from '@/store/kmz';
import type { ParsedRecord, SiteKey } from '@/types/schema';
import type { Geometry } from 'geojson';

/** A site with a real, surveyed position. */
export interface SurveyedSite {
  readonly siteKey: SiteKey;
  readonly label: string;
  /** Never null: a site without a parsed centroid is not in this list. */
  readonly centroid: LatLng;
  /** Absent for records stored before geometry was cached. */
  readonly geometry: Geometry | null;
  readonly filename: string;
}

export interface SurveyedCoverage {
  /** Sites with a PARSED KMZ — the only ones that can be plotted. */
  readonly sites: readonly SurveyedSite[];
  /** Distinct sites in the workbook. */
  readonly totalSites: number;
  /** Sites holding a file, whatever its parse status. */
  readonly withKmz: number;
  /**
   * Sites holding a file we could not read.
   *
   * Reported separately because it is a different problem from a missing file
   * and needs a different fix — re-export from the survey tool, not chase the
   * surveyor for a file they already sent.
   */
  readonly unreadable: number;
}

/**
 * Sites that can be plotted, plus the coverage counts.
 *
 * Only `parsed` attachments produce a {@link SurveyedSite}. A stored-but-unread
 * file has no coordinate, and an unreadable one has no trustworthy coordinate;
 * neither may put a dot on a map. That restraint is the same rule V1 followed
 * when it refused to plot district centroids as sites.
 */
export function useSurveyedSites(
  records: readonly ParsedRecord[],
  binding: SiteKeyColumns,
): SurveyedCoverage {
  const attachments = useKmzStore((state) => state.attachments);

  return useMemo(() => {
    const index = indexSites(records, binding);
    const sites: SurveyedSite[] = [];
    let withKmz = 0;
    let unreadable = 0;

    for (const entry of index.entries) {
      const attachment = attachments[entry.siteKey];
      if (attachment === undefined) continue;

      withKmz += 1;
      if (attachment.parseStatus === 'unparseable') unreadable += 1;
      if (attachment.parseStatus !== 'parsed' || attachment.centroid === null) continue;

      sites.push({
        siteKey: entry.siteKey,
        label: entry.label,
        centroid: attachment.centroid,
        geometry: attachment.geometry ?? null,
        filename: attachment.filename,
      });
    }

    return { sites, totalSites: index.entries.length, withKmz, unreadable };
  }, [records, binding, attachments]);
}
