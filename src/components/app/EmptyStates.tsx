'use client';

/**
 * Empty and error states.
 *
 * Every one names the cause and the way out. A blank panel is the worst
 * possible outcome here: the user cannot tell an empty result from a broken
 * app, and the two demand completely different responses. "Zero records" after
 * a deliberate filter is success; "zero records" because the boundary file
 * failed to load is a failure, and they must never look alike.
 */

import type { ReactNode } from 'react';

interface StateProps {
  readonly title: string;
  readonly body: ReactNode;
  readonly tone?: 'neutral' | 'warning' | 'error';
  readonly action?: ReactNode;
}

function StatePanel({ title, body, tone = 'neutral', action }: StateProps) {
  const styles =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-stone-200 bg-white text-stone-700';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex h-full flex-col items-center justify-center gap-3 rounded-lg border p-8 text-center ${styles}`}
    >
      <div className="max-w-md space-y-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="text-xs leading-relaxed opacity-90">{body}</div>
      </div>
      {action}
    </div>
  );
}

/** Nothing uploaded yet. */
export function NoDatasetState({ onUpload }: { readonly onUpload: () => void }) {
  return (
    <StatePanel
      title="No workbook loaded"
      body={
        <>
          <p>
            Upload a land MIS workbook to see it on the map. Parsing happens in this
            browser tab — the file is never sent anywhere.
          </p>
          <p className="text-stone-500">
            You will see a preview of what was detected before anything loads.
          </p>
        </>
      }
      action={
        <button
          type="button"
          onClick={onUpload}
          className="rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-700 focus-visible:ring-offset-2"
        >
          Choose a workbook
        </button>
      }
    />
  );
}

/** Filters exclude everything. Success, not failure — worded accordingly. */
export function NoMatchesState({ onReset }: { readonly onReset: () => void }) {
  return (
    <StatePanel
      title="No records match these filters"
      body={
        <>
          <p>
            The workbook is loaded and intact — the current filter combination simply
            excludes every row.
          </p>
          <p className="text-stone-500">
            Remove a filter from the chip bar above, or reset them all.
          </p>
        </>
      }
      action={
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
        >
          Reset all filters
        </button>
      }
    />
  );
}

/** Records exist but none joined to a boundary. */
export function AllUnmappedState({
  recordCount,
  onOpenUnmapped,
}: {
  readonly recordCount: number;
  readonly onOpenUnmapped: () => void;
}) {
  return (
    <StatePanel
      tone="warning"
      title="No record could be placed on the map"
      body={
        <>
          <p>
            All {recordCount.toLocaleString('en-IN')} matching record
            {recordCount === 1 ? '' : 's'} failed to match a state or district boundary,
            so there is nothing to draw.
          </p>
          <p>
            {/* The likely cause first, then the fix, then where to look. */}
            This usually means the location column holds names the boundary file does not
            use — a different transliteration, or districts created after the boundary
            vintage.
          </p>
          <p className="opacity-80">
            The unmapped panel lists every one with the spelling from your file. Adding
            entries to <code className="rounded bg-amber-100 px-1">public/geo/aliases.json</code>{' '}
            fixes them without a rebuild.
          </p>
        </>
      }
      action={
        <button
          type="button"
          onClick={onOpenUnmapped}
          className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
        >
          Show unmapped records
        </button>
      }
    />
  );
}

/** The vendored GeoJSON did not load. */
export function BoundariesFailedState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <StatePanel
      tone="error"
      title="Map boundaries could not be loaded"
      body={
        <>
          <p>
            The app could not read its boundary files from{' '}
            <code className="rounded bg-rose-100 px-1">/geo/</code>. Without them there is
            no map to draw on.
          </p>
          <p>
            These are static files served with the app, not an external service — so this
            is a deployment or network problem, not a problem with your data.
          </p>
          <p className="font-mono text-[10px] opacity-80">{message}</p>
          <p className="opacity-80">
            Everything else still works: uploading, filtering, the table, and export.
          </p>
        </>
      }
      action={
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
        >
          Try again
        </button>
      }
    />
  );
}

/** Boundaries still loading. */
export function LoadingBoundariesState() {
  return (
    <StatePanel
      title="Loading map boundaries…"
      body={<p className="text-stone-500">724 districts and 36 states, read once and cached.</p>}
    />
  );
}
