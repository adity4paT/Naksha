'use client';

/**
 * File drop zone.
 *
 * Drag-and-drop plus a real `<input type="file">` behind a label, not instead
 * of one. A div with drop handlers is invisible to the keyboard and to screen
 * readers; the input gives focus, Enter/Space activation, and the OS file
 * picker for free, and the drag handlers are an enhancement on top.
 *
 * Only the first file is read. Dropping several is far more likely to be a
 * mis-drag than a request to merge workbooks, and silently picking one of them
 * would be worse than saying so.
 */

import { useCallback, useId, useRef, useState } from 'react';

import { ACCEPTED_EXTENSIONS } from '@/lib/upload';

export interface DropZoneProps {
  readonly onFile: (file: File) => void;
  readonly busy: boolean;
  /** Shown when a dataset is already loaded, to set expectations. */
  readonly replacing: boolean;
}

export function DropZone({ onFile, busy, replacing }: DropZoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [multipleWarning, setMultipleWarning] = useState(false);
  // Nested dragenter/dragleave from child elements would otherwise flicker the
  // highlight; counting them keeps it stable.
  const dragDepth = useRef(0);

  const accept = ACCEPTED_EXTENSIONS.join(',');

  const take = useCallback(
    (files: FileList | null) => {
      if (files === null || files.length === 0) return;
      setMultipleWarning(files.length > 1);
      const first = files[0];
      if (first !== undefined) onFile(first);
    },
    [onFile],
  );

  return (
    <div className="w-full">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          // Without this the browser shows a "move" cursor and then navigates
          // away from the page when the file is dropped.
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (!busy) take(event.dataTransfer.files);
        }}
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragging
            ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30'
            : 'border-slate-300 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-900'
        }`}
      >
        <input
          id={inputId}
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(event) => {
            take(event.target.files);
            // Reset so re-selecting the same file fires change again — the
            // common case after fixing the file and trying once more.
            event.target.value = '';
          }}
          className="sr-only"
        />

        <label
          htmlFor={inputId}
          className={`inline-flex cursor-pointer flex-col items-center gap-1 ${
            busy ? 'cursor-wait opacity-60' : ''
          }`}
        >
          <span className="text-sm font-medium text-slate-900 dark:text-neutral-100">
            {busy
              ? 'Reading workbook…'
              : replacing
                ? 'Drop a workbook to replace the loaded data'
                : 'Drop a land MIS workbook here'}
          </span>
          <span className="text-xs text-slate-500 dark:text-neutral-400">
            or <span className="text-blue-600 underline dark:text-blue-400">browse</span> —
            .xlsx or .xlsm
          </span>
        </label>

        <p className="mt-3 text-[11px] leading-snug text-slate-500 dark:text-neutral-500">
          {/* Stated up front. Users handing over commercial land data should not
              have to infer where it goes. */}
          Parsed in this browser tab. The file is never uploaded anywhere.
        </p>

        {replacing && !busy && (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-neutral-500">
            You will see a preview before anything is replaced.
          </p>
        )}
      </div>

      {multipleWarning && (
        <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Several files were dropped. Only the first was read — this app loads one
          workbook at a time.
        </p>
      )}
    </div>
  );
}
