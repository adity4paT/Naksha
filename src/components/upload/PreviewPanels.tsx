'use client';

/**
 * The panels that make up the preview screen.
 *
 * Split out so each answers one question a user has before committing:
 * what was detected, what changed, what is wrong, and what did not resolve.
 */

import type { ColumnDriftReport, CoordinateColumn, UploadPreview } from '@/lib/upload';
import { coordinateNotice } from '@/lib/upload';
import type { ResolutionReport } from '@/lib/geo';
import type { ColumnDescriptor, ValidationReport } from '@/types/schema';
import { effectiveRole } from '@/types/schema';

/* -------------------------------------------------------------------------- */
/* Detection summary                                                           */
/* -------------------------------------------------------------------------- */

export function DetectionSummary({ preview }: { readonly preview: UploadPreview }) {
  const { workbook } = preview;
  const selected = workbook.sheets.find((sheet) => sheet.selected);

  const stats: readonly { label: string; value: string; caution?: boolean }[] = [
    {
      label: 'Sheet',
      value: workbook.sheetName,
      caution: workbook.sheets.filter((s) => s.populatedCellCount > 0).length > 1,
    },
    {
      // 1-based, matching what Excel shows in its row gutter. Reporting the
      // zero-based index would send a user looking at the wrong row.
      label: 'Header row',
      value: `Row ${workbook.header.rowIndex + 1}`,
      caution: workbook.header.usedFallback,
    },
    { label: 'Columns', value: String(workbook.stats.columnCount) },
    { label: 'Rows', value: String(workbook.stats.parsedRecordCount) },
    {
      label: 'Dropped',
      value: String(workbook.stats.droppedRowCount),
      caution: workbook.stats.droppedRowCount > 0,
    },
    { label: 'Measures', value: String(workbook.stats.measureCount) },
    { label: 'Dimensions', value: String(workbook.stats.dimensionCount) },
    {
      label: 'Empty columns',
      value: String(workbook.stats.emptyColumnCount),
      caution: workbook.stats.emptyColumnCount > 0,
    },
  ];

  return (
    <section aria-labelledby="preview-detected">
      <h3
        id="preview-detected"
        className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Detected
      </h3>

      <dl className="grid grid-cols-4 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded border p-2 ${
              stat.caution === true
                ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
                : 'border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
            }`}
          >
            <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-neutral-400">
              {stat.label}
            </dt>
            <dd className="truncate text-sm font-medium tabular-nums text-slate-900 dark:text-neutral-100">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {selected !== undefined && workbook.sheets.length > 1 && (
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-neutral-500">
          Chosen from {workbook.sheets.length} sheets by density (
          {selected.populatedCellCount.toLocaleString('en-IN')} populated cells).
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Column roles                                                                */
/* -------------------------------------------------------------------------- */

const ROLE_STYLES: Record<string, string> = {
  measure: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  dimension: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  meta: 'bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300',
};

export function ColumnRoleTable({
  columns,
}: {
  readonly columns: readonly ColumnDescriptor[];
}) {
  return (
    <section aria-labelledby="preview-columns">
      <h3
        id="preview-columns"
        className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Column roles ({columns.length})
      </h3>

      <div className="max-h-64 overflow-y-auto rounded border border-slate-200 dark:border-neutral-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-medium">Column</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Role</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Filled</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Distinct</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Basis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
            {columns.map((column) => {
              const role = effectiveRole(column);
              const filled = column.rowCount - column.nullCount;

              return (
                <tr
                  key={column.normalizedKey}
                  className={column.inferredFromNameOnly ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}
                >
                  <td className="max-w-[16rem] truncate px-2 py-1 text-slate-800 dark:text-neutral-200">
                    {column.displayLabel.trim()}
                  </td>
                  <td className="px-2 py-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_STYLES[role]}`}>
                      {role}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-neutral-400">
                    {filled}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-neutral-400">
                    {column.distinctCount}
                  </td>
                  <td className="px-2 py-1 text-[11px] text-slate-500 dark:text-neutral-500">
                    {column.inferredFromNameOnly ? (
                      // The guess most likely to be wrong, marked as a guess.
                      <span className="text-amber-700 dark:text-amber-300">
                        header text only
                      </span>
                    ) : (
                      column.inferenceReason
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Column drift                                                                */
/* -------------------------------------------------------------------------- */

const DELTA_STYLES: Record<string, string> = {
  'role-changed': 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  'became-populated': 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100',
  'became-empty': 'bg-slate-200 text-slate-700 dark:bg-neutral-700 dark:text-neutral-200',
  added: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  removed: 'bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100',
};

export function ColumnDriftPanel({
  drift,
  isFirstLoad,
}: {
  readonly drift: ColumnDriftReport;
  readonly isFirstLoad: boolean;
}) {
  if (isFirstLoad) {
    return (
      <section aria-labelledby="preview-drift">
        <h3
          id="preview-drift"
          className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
        >
          Changes
        </h3>
        <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          Nothing loaded yet, so there is nothing to compare against. All{' '}
          {drift.addedCount} columns are new.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="preview-drift">
      <h3
        id="preview-drift"
        className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Changes from the loaded dataset
      </h3>

      {drift.identical ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          Same column set, same roles. This file has the shape the loaded one has.
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-[11px] text-slate-600 dark:text-neutral-400">
            {drift.addedCount} added · {drift.removedCount} removed ·{' '}
            {drift.roleChangedCount} role change
            {drift.roleChangedCount === 1 ? '' : 's'} · {drift.becamePopulatedCount} newly
            populated
          </p>

          <div className="max-h-52 overflow-y-auto rounded border border-slate-200 dark:border-neutral-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-300">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium">Column</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Change</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Why it matters</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {drift.needsAttention.map((change) => (
                  <tr key={`${change.key}-${change.delta}`} className="align-top">
                    <td className="max-w-[14rem] truncate px-2 py-1 text-slate-800 dark:text-neutral-200">
                      {change.label}
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${DELTA_STYLES[change.delta]}`}
                      >
                        {change.delta.replace(/-/g, ' ')}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-[11px] text-slate-600 dark:text-neutral-400">
                      {change.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export function ValidationSummary({
  validation,
}: {
  readonly validation: ValidationReport;
}) {
  const failed = validation.entries.length;
  const unbound = validation.unboundInvariants;

  return (
    <section aria-labelledby="preview-validation">
      <h3
        id="preview-validation"
        className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Invariants
      </h3>

      {unbound.length > 0 && (
        <p className="mb-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {/* "Never ran" and "no violations" look identical in a count of zero.
              Saying which is the difference between a clean file and an
              unchecked one. */}
          The {unbound.join(' and ')} invariant{unbound.length === 1 ? '' : 's'} could not
          run — no column matched the roles needed. This is not a clean result; the check
          never executed.
        </p>
      )}

      {failed === 0 ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          No violations across{' '}
          <span className="tabular-nums">{validation.checkedByInvariant.composition}</span>{' '}
          rows checked for tenure composition and{' '}
          <span className="tabular-nums">{validation.checkedByInvariant.utilization}</span>{' '}
          for the used/unused split.
          {validation.skippedByInvariant.composition +
            validation.skippedByInvariant.utilization >
            0 && (
            <span className="block">
              {validation.skippedByInvariant.composition +
                validation.skippedByInvariant.utilization}{' '}
              row-checks skipped as unevaluable — a missing component is not a violation.
            </span>
          )}
        </p>
      ) : (
        <div className="rounded border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
          <p className="p-2 text-xs font-medium text-red-900 dark:text-red-200">
            {failed} violation{failed === 1 ? '' : 's'} across{' '}
            {new Set(validation.entries.map((e) => e.rowIndex)).size} row
            {new Set(validation.entries.map((e) => e.rowIndex)).size === 1 ? '' : 's'}.
            Figures are reported as found and have not been corrected.
          </p>
          <div className="max-h-40 overflow-y-auto border-t border-red-200 dark:border-red-900">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200">
                <tr>
                  <th scope="col" className="px-2 py-1 font-medium">Row</th>
                  <th scope="col" className="px-2 py-1 font-medium">Invariant</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Expected</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Actual</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-200/60 dark:divide-red-900/50">
                {validation.entries.slice(0, 50).map((entry) => (
                  <tr key={`${entry.rowIndex}-${entry.invariant}`}>
                    <td className="px-2 py-1 tabular-nums">{entry.sourceRowNumber}</td>
                    <td className="px-2 py-1">{entry.invariant}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {entry.expected.toLocaleString('en-IN')}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {entry.actual.toLocaleString('en-IN')}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {entry.delta > 0 ? '+' : ''}
                      {entry.delta.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {validation.entries.length > 50 && (
              <p className="p-2 text-[11px] text-red-800 dark:text-red-300">
                Showing the first 50 of {validation.entries.length}.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

export function ResolutionSummary({ report }: { readonly report: ResolutionReport }) {
  const unmatched = report.needsReview;

  return (
    <section aria-labelledby="preview-resolution">
      <h3
        id="preview-resolution"
        className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Place names
      </h3>

      <p className="mb-1.5 text-[11px] text-slate-600 dark:text-neutral-400">
        <span className="tabular-nums">{report.recordsResolvedToDistrict}</span> of{' '}
        <span className="tabular-nums">{report.totalRecords}</span> records matched a
        district
        {report.recordsResolvedToStateOnly > 0 && (
          <> · {report.recordsResolvedToStateOnly} matched only a state</>
        )}
        {report.recordsUnresolved > 0 && (
          <> · {report.recordsUnresolved} matched nothing</>
        )}
      </p>

      {unmatched.length === 0 ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          Every name matched exactly or through a known alias. Nothing was guessed.
        </p>
      ) : (
        <div className="max-h-52 overflow-y-auto rounded border border-amber-300 dark:border-amber-800">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <tr>
                <th scope="col" className="px-2 py-1 font-medium">Name in file</th>
                <th scope="col" className="px-2 py-1 font-medium">Matched to</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Rows</th>
                <th scope="col" className="px-2 py-1 font-medium">How</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-200/70 dark:divide-amber-900/50">
              {unmatched.map((entry) => (
                <tr
                  key={`${entry.level}-${entry.parentState}-${entry.input}`}
                  className="align-top"
                >
                  <td className="px-2 py-1 font-medium text-amber-900 dark:text-amber-200">
                    {entry.input}
                    {entry.parentState !== null && (
                      <span className="block text-[10px] font-normal text-amber-700 dark:text-amber-400">
                        in {entry.parentState}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-amber-900 dark:text-amber-200">
                    {entry.matchedName ?? (
                      <span className="font-medium text-red-700 dark:text-red-300">
                        no match
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-amber-900 dark:text-amber-200">
                    {entry.recordCount}
                  </td>
                  <td className="px-2 py-1 text-amber-800 dark:text-amber-300">
                    {entry.stage === 3
                      ? `fuzzy, ${(entry.confidence * 100).toFixed(0)}%`
                      : 'unresolved'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unmatched.length > 0 && (
        <p className="mt-1 text-[10px] leading-snug text-slate-500 dark:text-neutral-500">
          Fuzzy matches were guessed from spelling. Add an entry to{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-neutral-800">
            public/geo/aliases.json
          </code>{' '}
          to make one exact — no rebuild needed.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Coordinates                                                                 */
/* -------------------------------------------------------------------------- */

export function CoordinatePanel({
  columns,
}: {
  readonly columns: readonly CoordinateColumn[];
}) {
  if (columns.length === 0) return null;

  return (
    <section aria-labelledby="preview-coordinates">
      <h3
        id="preview-coordinates"
        className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400"
      >
        Coordinates — detected, not used
      </h3>

      <div className="rounded border border-slate-300 bg-slate-50 p-2 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-xs text-slate-700 dark:text-neutral-300">
          {coordinateNotice(columns)}
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {columns.map((column) => (
            <li
              key={column.key}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
            >
              {column.label}
              <span className="ml-1 text-slate-400 dark:text-neutral-500">
                {column.kind} · {column.populatedCount} filled
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
