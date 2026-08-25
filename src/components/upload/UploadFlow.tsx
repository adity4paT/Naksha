'use client';

/**
 * The upload flow: drop → inspect → preview → explicit commit.
 *
 * The commit is the only path into {@link useDatasetStore}, and it is behind a
 * button the user has to press after seeing what the file contains. There is no
 * branch anywhere that loads a workbook without rendering the preview first.
 *
 * That ordering is the whole point of this screen. A malformed upload that
 * instantly blanks the map is worse than a preview with a warning on it,
 * because the user cannot tell a broken file from a broken app — and the state
 * they were working in is already gone by the time they find out.
 */

import { useCallback, useState } from 'react';

import type { AliasMap, BoundaryIndex } from '@/lib/geo';
import type { UploadError, UploadPreview } from '@/lib/upload';
import { inspectUpload } from '@/lib/upload';
import { useDatasetStore } from '@/store/dataset';
import { useFilterStore } from '@/store/filters';
import { DropZone } from './DropZone';
import {
  ColumnDriftPanel,
  ColumnRoleTable,
  CoordinatePanel,
  DetectionSummary,
  ResolutionSummary,
  ValidationSummary,
} from './PreviewPanels';

export interface UploadFlowProps {
  readonly boundaries: BoundaryIndex;
  readonly aliases: AliasMap;
  /** Called after a successful commit, so the host can close the dialog. */
  readonly onCommitted?: () => void;
}

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading'; readonly fileName: string }
  | { readonly kind: 'error'; readonly error: UploadError; readonly fileName: string }
  | { readonly kind: 'preview'; readonly preview: UploadPreview };

export function UploadFlow({ boundaries, aliases, onCommitted }: UploadFlowProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const loadedWorkbook = useDatasetStore((s) => s.workbook);
  const loadedFileName = useDatasetStore((s) => s.sourceFileName);
  const commit = useDatasetStore((s) => s.commit);
  const setMeasure = useFilterStore((s) => s.setMeasure);
  const resetFilters = useFilterStore((s) => s.resetAll);

  const handleFile = useCallback(
    async (file: File) => {
      setStage({ kind: 'reading', fileName: file.name });

      // Yield a frame so the "Reading workbook…" state paints before the
      // synchronous parse blocks the main thread. Without this the UI appears
      // frozen with no explanation for the whole parse.
      await new Promise((resolve) => setTimeout(resolve, 0));

      try {
        const result = await inspectUpload(file, {
          boundaries,
          aliases,
          loaded: loadedWorkbook,
        });

        setStage(
          result.ok
            ? { kind: 'preview', preview: result.preview }
            : { kind: 'error', error: result.error, fileName: file.name },
        );
      } catch (error) {
        // inspectUpload returns typed errors for everything it anticipates.
        // Reaching here means something genuinely unexpected happened, and
        // saying so beats a generic message that implies the file is at fault.
        setStage({
          kind: 'error',
          fileName: file.name,
          error: {
            code: 'corrupt-workbook',
            message: 'The file could not be read, and the failure was not one this app anticipates.',
            remedy: 'This is likely a bug. The technical detail below is worth reporting.',
            detail: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
    [boundaries, aliases, loadedWorkbook],
  );

  const handleCommit = useCallback(() => {
    if (stage.kind !== 'preview') return;

    commit(stage.preview);

    // Filters reference values from the OLD dataset. Carrying them across would
    // leave a district selected that this file may not contain — which the
    // cascade would correctly report as orphaned, but showing a user four
    // "no longer available" badges the instant they load a file is a confusing
    // way to start. A new dataset is a new question.
    resetFilters();

    if (stage.preview.defaultMeasureId !== null) {
      setMeasure(stage.preview.defaultMeasureId);
    }

    setStage({ kind: 'idle' });
    onCommitted?.();
  }, [stage, commit, resetFilters, setMeasure, onCommitted]);

  const isFirstLoad = loadedWorkbook === null;

  return (
    <div className="flex flex-col gap-4">
      {stage.kind !== 'preview' && (
        <DropZone
          onFile={(file) => void handleFile(file)}
          busy={stage.kind === 'reading'}
          replacing={!isFirstLoad}
        />
      )}

      {loadedFileName !== null && stage.kind === 'idle' && (
        <p className="text-xs text-slate-500 dark:text-neutral-400">
          Currently loaded: <span className="font-medium">{loadedFileName}</span> —{' '}
          {loadedWorkbook?.stats.parsedRecordCount ?? 0} records
        </p>
      )}

      {stage.kind === 'error' && (
        <ErrorPanel
          error={stage.error}
          fileName={stage.fileName}
          onDismiss={() => setStage({ kind: 'idle' })}
        />
      )}

      {stage.kind === 'preview' && (
        <PreviewScreen
          preview={stage.preview}
          isFirstLoad={isFirstLoad}
          loadedFileName={loadedFileName}
          onCommit={handleCommit}
          onCancel={() => setStage({ kind: 'idle' })}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error                                                                       */
/* -------------------------------------------------------------------------- */

function ErrorPanel({
  error,
  fileName,
  onDismiss,
}: {
  readonly error: UploadError;
  readonly fileName: string;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-red-900 dark:text-red-200">
            Could not read {fileName}
          </p>
          {/* The message names the specific expectation that was not met. */}
          <p className="mt-1 text-xs text-red-800 dark:text-red-300">{error.message}</p>

          {error.remedy !== undefined && (
            <p className="mt-1.5 text-xs text-red-800 dark:text-red-300">
              <span className="font-medium">What to try: </span>
              {error.remedy}
            </p>
          )}

          {error.detail !== undefined && (
            <p className="mt-1.5 break-words font-mono text-[10px] text-red-700 dark:text-red-400">
              {error.detail}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded px-2 py-1 text-xs text-red-700 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:text-red-300 dark:hover:bg-red-900"
        >
          Dismiss
        </button>
      </div>

      <p className="mt-2 border-t border-red-200 pt-2 text-[11px] text-red-700 dark:border-red-900 dark:text-red-400">
        Nothing was changed. Any data already loaded is still loaded.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

function PreviewScreen({
  preview,
  isFirstLoad,
  loadedFileName,
  onCommit,
  onCancel,
}: {
  readonly preview: UploadPreview;
  readonly isFirstLoad: boolean;
  readonly loadedFileName: string | null;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <section
      aria-label="Upload preview"
      className="rounded-lg border border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-950"
    >
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-3 dark:border-neutral-800">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">
            {preview.fileName}
          </h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            Nothing has been loaded yet — this is a preview.
            {!isFirstLoad && loadedFileName !== null && (
              <> Loading will replace {loadedFileName}.</>
            )}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCommit}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
          >
            Load this data
          </button>
        </div>
      </header>

      {preview.cautions.length > 0 && (
        <div
          role="status"
          className="border-b border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
        >
          <p className="mb-1 text-xs font-medium text-amber-900 dark:text-amber-200">
            Read before loading
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-xs text-amber-900 dark:text-amber-200">
            {preview.cautions.map((caution) => (
              <li key={caution}>{caution}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 p-3">
        <DetectionSummary preview={preview} />
        <ColumnDriftPanel drift={preview.drift} isFirstLoad={isFirstLoad} />
        <ColumnRoleTable columns={preview.workbook.columns} />
        <ValidationSummary validation={preview.workbook.validation} />
        <ResolutionSummary report={preview.resolutionReport} />
        <CoordinatePanel columns={preview.coordinateColumns} />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-slate-200 p-3 dark:border-neutral-800">
        <p className="text-[11px] text-slate-500 dark:text-neutral-500">
          Loading replaces the current dataset and clears active filters.
        </p>
        <button
          type="button"
          onClick={onCommit}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
        >
          Load this data
        </button>
      </footer>
    </section>
  );
}
