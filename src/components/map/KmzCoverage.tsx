'use client';

/**
 * How much of the dataset has a surveyed boundary.
 *
 * "78 of 130 sites have KMZ" is a coverage statement, and coverage is the thing
 * a reader most easily gets wrong by extrapolating from what they clicked. Two
 * or three surveyed markers on screen suggest the whole dataset is surveyed;
 * this line is what stops that inference.
 *
 * Unreadable files are counted separately from missing ones because they are a
 * different problem with a different fix — re-export from the survey tool,
 * rather than chase the surveyor for a file they already sent.
 */

import type { SurveyedCoverage } from '@/components/kmz';

export interface KmzCoverageProps {
  readonly coverage: SurveyedCoverage;
}

export function KmzCoverage({ coverage }: KmzCoverageProps) {
  const { sites, totalSites, withKmz, unreadable } = coverage;

  if (totalSites === 0) return null;

  const percent = totalSites === 0 ? 0 : Math.round((withKmz / totalSites) * 100);

  return (
    <section
      aria-label="KMZ coverage"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[11px] text-stone-600"
    >
      <p>
        <span className="font-semibold tabular-nums text-stone-900">
          {withKmz.toLocaleString('en-IN')} of {totalSites.toLocaleString('en-IN')}
        </span>{' '}
        sites have KMZ
        <span className="ml-1 text-stone-400 tabular-nums">({percent}%)</span>
      </p>

      <div
        aria-hidden="true"
        className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200"
        title={`${percent}% of sites have an attached boundary`}
      >
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
      </div>

      {sites.length !== withKmz && (
        <p className="text-stone-500">
          <span className="tabular-nums">{sites.length}</span> plotted
        </p>
      )}

      {unreadable > 0 && (
        <p className="text-amber-700">
          <span className="tabular-nums">{unreadable}</span> could not be read
        </p>
      )}
    </section>
  );
}
