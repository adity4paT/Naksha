'use client';

/**
 * The site list opened by clicking a district's count badge.
 *
 * A badge reading "6" says six sites are somewhere in this district. This panel
 * is where that becomes six named rows — the only honest way to show them,
 * since the data contains no position for any individual site. A map marker per
 * site would have to invent one.
 */

import { useMemo } from 'react';

import { KmzSiteActions } from '@/components/kmz';
import { siteKeyForRecord } from '@/lib/kmz';
import type { SiteKeyColumns } from '@/lib/kmz';
import { formatMeasureValue } from '@/lib/measures';
import type { MeasureDescriptor } from '@/lib/measures';
import { recordValue } from '@/lib/measures';
import type { NormalizedKey, ParsedRecord } from '@/types/schema';

export interface SitePanelProps {
  readonly regionName: string;
  readonly records: readonly ParsedRecord[];
  readonly siteKey: NormalizedKey | null;
  readonly areaKey: NormalizedKey | null;
  /**
   * State/district/site columns, for deriving the durable attachment key.
   *
   * Distinct from siteKey above, which names the column holding site names.
   * This one identifies the row's subject. See the SiteKey doc in schema.ts.
   */
  readonly siteColumns: SiteKeyColumns;
  readonly measure: MeasureDescriptor | null;
  readonly onClose: () => void;
}

export function SitePanel({
  regionName,
  records,
  siteKey,
  areaKey,
  siteColumns,
  measure,
  onClose,
}: SitePanelProps) {
  const rows = useMemo(
    () =>
      records
        .map((record) => ({
          id: record.id,
          sourceRow: record.sourceRowNumber,
          name:
            siteKey === null
              ? `Row ${record.sourceRowNumber}`
              : ((record.values[siteKey] as string | null) ?? `Row ${record.sourceRowNumber}`),
          acres: areaKey === null ? null : (record.values[areaKey] as number | null),
          value: measure === null ? null : recordValue(measure, record.values),
          attachmentKey: siteKeyForRecord(record, siteColumns),
        }))
        .sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0)),
    [records, siteKey, areaKey, siteColumns, measure],
  );

  const totalAcres = rows.reduce((sum, row) => sum + (row.acres ?? 0), 0);

  return (
    <aside
      aria-label={`Sites in ${regionName}`}
      className="flex h-full w-72 shrink-0 flex-col border-l border-stone-200 bg-white"
    >
      <header className="flex items-start justify-between gap-2 border-b border-stone-200 p-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-stone-900">{regionName}</h2>
          <p className="text-[11px] tabular-nums text-stone-500">
            {rows.length} site{rows.length === 1 ? '' : 's'} ·{' '}
            {Math.round(totalAcres).toLocaleString('en-IN')} acres
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close site list"
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
        >
          ✕
        </button>
      </header>

      <p className="border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-[10px] leading-snug text-stone-500">
        {/* Said plainly, at the point a user is looking at individual sites and
            most likely to assume the map knows where each one is. */}
        These sites share one district. This data holds no coordinate for any of them
        individually.
      </p>

      <ul className="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id} className="px-3 py-2">
            <p className="truncate text-xs font-medium text-stone-800" title={row.name}>
              {row.name}
            </p>
            <p className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-stone-500">
              <span>Row {row.sourceRow}</span>
              <span className="text-stone-700">
                {measure !== null && row.value !== null
                  ? formatMeasureValue(measure, row.value)
                  : row.acres !== null
                    ? `${Math.round(row.acres).toLocaleString('en-IN')} ac`
                    : '—'}
              </span>
            </p>
            <div className="mt-1">
              <KmzSiteActions siteKey={row.attachmentKey} siteLabel={row.name} />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
