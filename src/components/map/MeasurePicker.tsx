'use client';

/**
 * Measure picker.
 *
 * A native `<select>` with `<optgroup>`, deliberately. It gives grouping,
 * keyboard navigation, type-ahead, and mobile behaviour for free, and a custom
 * listbox would have to reimplement all of it to look slightly better.
 *
 * Two labelling jobs matter more than the control itself:
 *
 * - **Calculated measures are always marked as calculated**, even when they are
 *   the only available source. A reader should never have to work out whether a
 *   figure came from the spreadsheet or from us.
 * - **A superseded derived measure says so.** When the sheet has its own
 *   utilisation column and that column holds data, the sheet's figure is
 *   authoritative and the derived one is labelled a fallback. The two are never
 *   silently conflated, which is what the brief asks for and what stops a user
 *   comparing our arithmetic against their own and finding a mismatch nobody
 *   flagged.
 */

import { useId } from 'react';

import type { MeasureDescriptor, MeasureGroup } from '@/lib/measures';

export interface MeasurePickerProps {
  readonly groups: readonly MeasureGroup[];
  readonly selectedId: string | null;
  readonly onChange: (id: string) => void;
  /** The resolved selection, for the explanatory line beneath. */
  readonly selected: MeasureDescriptor | null;
  /** Label of the measure superseding the selection, when there is one. */
  readonly supersedingLabel: string | null;
}

/** Suffix marking a column the current file leaves empty. */
function optionLabel(measure: MeasureDescriptor): string {
  if (measure.kind === 'sheet') {
    return measure.isEmpty ? `${measure.label} — empty in this file` : measure.label;
  }
  return measure.supersededBy === null
    ? measure.label
    : `${measure.label} — fallback`;
}

export function MeasurePicker({
  groups,
  selectedId,
  onChange,
  selected,
  supersedingLabel,
}: MeasurePickerProps) {
  const selectId = useId();

  return (
    <div className="w-64">
      <label
        htmlFor={selectId}
        className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Showing
      </label>

      <select
        id={selectId}
        value={selectedId ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.measures.map((measure) => (
              <option key={measure.id} value={measure.id}>
                {optionLabel(measure)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {selected !== null && (
        <p className="mt-1 text-[10px] leading-snug text-slate-500 dark:text-neutral-500">
          {selected.kind === 'derived' ? (
            <>
              <span className="font-medium">Calculated:</span> {selected.formula}
              {/* Ratio of sums, not mean of ratios. Stated because the two
                  differ by up to 6.8 points on this data and a user comparing
                  against their own spreadsheet needs to know which we did. */}
              <span className="block">
                Regional figures sum the parts, then divide once — not an average
                of per-site percentages.
              </span>
            </>
          ) : (
            <>
              Aggregated by{' '}
              <span className="font-medium">
                {selected.aggregation === 'mean' ? 'mean' : 'sum'}
              </span>
              {selected.aggregation === 'mean' && (
                <span className="block">
                  Unweighted — each record counts equally, regardless of size.
                </span>
              )}
            </>
          )}
        </p>
      )}

      {supersedingLabel !== null && (
        <p
          role="status"
          className="mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] leading-snug text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          The sheet has its own <strong>{supersedingLabel}</strong> column with data in
          it. That column is the authoritative figure; this one is calculated from the
          area columns and may not agree with it.
        </p>
      )}
    </div>
  );
}
