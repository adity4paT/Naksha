'use client';

/**
 * Bulk KMZ attachment: drop many files, review what matched, bind the rest.
 *
 * The shape of this screen follows from one decision made in src/lib/kmz/match.ts
 * — matching is strict and never guesses. That makes an unmatched file the
 * normal case rather than an error, so manual assignment is not a fallback
 * buried behind a link. It is half the UI: files on the left, sites without a
 * boundary on the right, one click to bind.
 *
 * Nothing is written until the user commits. A drop is expanded, matched and
 * previewed entirely in memory, so what the panel shows before the button is
 * pressed is exactly what pressing it will do.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { expandDroppedFiles, indexSites, matchFilesToSites } from '@/lib/kmz';
import type { DroppedKmzFile, KmzMatchStrategy, SiteIndexEntry, SiteKeyColumns } from '@/lib/kmz';
import { useKmzStore } from '@/store/kmz';
import type { NormalizedKey, ParsedRecord, SiteKey } from '@/types/schema';

export interface KmzBulkPanelProps {
  readonly records: readonly ParsedRecord[];
  readonly columnKeys: readonly NormalizedKey[];
  readonly binding: SiteKeyColumns;
  readonly onClose: () => void;
}

interface StagedFile {
  readonly file: DroppedKmzFile;
  readonly siteKey: SiteKey | null;
  readonly strategy: KmzMatchStrategy | null;
  readonly siteLabel: string | null;
  readonly ambiguous: readonly SiteIndexEntry[];
}

const STRATEGY_LABEL: Record<KmzMatchStrategy, string> = {
  filename: 'by filename',
  // Deliberately distinguished from the exact match above. A contains match
  // is still auto-bound, but it is a weaker claim — the filename carries the
  // site's name plus something else the sheet didn't say — and the label
  // should let a reviewer spot which rows in the matched list are worth a
  // second look, without having to distrust the whole list.
  'filename-contains': 'by filename (partial)',
  'sheet-column': 'by sheet column',
  manual: 'assigned by you',
};

export function KmzBulkPanel({ records, columnKeys, binding, onClose }: KmzBulkPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged] = useState<readonly StagedFile[] | null>(null);
  const [skipped, setSkipped] = useState<readonly { filename: string; reason: string }[]>([]);
  const [columnNote, setColumnNote] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const attachments = useKmzStore((state) => state.attachments);
  const upload = useKmzStore((state) => state.upload);

  const siteIndex = useMemo(() => indexSites(records, binding), [records, binding]);

  const alreadyAttached = useMemo(
    () => new Set<SiteKey>(Object.keys(attachments) as SiteKey[]),
    [attachments],
  );

  const accept = useCallback(
    async (files: readonly File[]) => {
      const expanded = await expandDroppedFiles(files);
      const match = matchFilesToSites(
        expanded.files.map((file) => file.filename),
        { records, siteIndex, columnKeys, alreadyAttached },
      );

      setStaged(
        expanded.files.map((file, index) => {
          const proposal = match.proposals[index];
          return {
            file,
            siteKey: proposal?.siteKey ?? null,
            strategy: proposal?.strategy ?? null,
            siteLabel: proposal?.siteLabel ?? null,
            ambiguous: proposal?.ambiguousMatches ?? [],
          };
        }),
      );
      setSkipped(expanded.skipped);
      // Always surfaced, including — especially — when the column did nothing.
      setColumnNote(match.columnHint.note);
      setSelectedFile(null);
      setProgress(null);
    },
    [records, siteIndex, columnKeys, alreadyAttached],
  );

  const bind = useCallback(
    (filename: string, entry: SiteIndexEntry) => {
      setStaged((current) =>
        current === null
          ? current
          : current.map((item) =>
              item.file.filename === filename
                ? {
                    ...item,
                    siteKey: entry.siteKey,
                    strategy: 'manual' as const,
                    siteLabel: entry.label,
                    ambiguous: [],
                  }
                : item,
            ),
      );
      setSelectedFile(null);
    },
    [],
  );

  const commit = useCallback(async () => {
    if (staged === null) return;
    const bound = staged.filter((item) => item.siteKey !== null);
    setCommitting(true);
    setProgress({ done: 0, total: bound.length });

    for (const [index, item] of bound.entries()) {
      await upload(item.siteKey as SiteKey, item.file.blob, item.file.filename);
      setProgress({ done: index + 1, total: bound.length });
    }

    setCommitting(false);
    setStaged(null);
    onClose();
  }, [staged, upload, onClose]);

  const matchedCount = staged?.filter((item) => item.siteKey !== null).length ?? 0;
  const unmatched = staged?.filter((item) => item.siteKey === null) ?? [];

  const openSites = useMemo(() => {
    if (staged === null) return [];
    const claimed = new Set(staged.map((item) => item.siteKey).filter(Boolean) as SiteKey[]);
    return siteIndex.entries.filter(
      (entry) => !claimed.has(entry.siteKey) && !alreadyAttached.has(entry.siteKey),
    );
  }, [staged, siteIndex, alreadyAttached]);

  return (
    <section
      aria-label="Bulk KMZ upload"
      className="flex h-full w-full flex-col gap-3 overflow-y-auto bg-white p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Attach KMZ boundaries</h2>
          <p className="text-[11px] text-stone-500">
            Drop .kmz or .kml files, or a .zip containing them. Nothing is stored until you
            confirm.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-900"
        >
          Close
        </button>
      </header>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".kmz,.kml,.zip"
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) void accept(files);
        }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const files = [...event.dataTransfer.files];
          if (files.length > 0) void accept(files);
        }}
        className={`rounded border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-stone-500 bg-stone-50' : 'border-stone-300'
        }`}
      >
        <p className="text-xs text-stone-600">Drop files here</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 rounded border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
        >
          Choose files
        </button>
      </div>

      {columnNote !== null && (
        <p className="rounded bg-stone-50 px-3 py-2 text-[11px] text-stone-600 ring-1 ring-inset ring-stone-200">
          {columnNote}
        </p>
      )}

      {skipped.length > 0 && (
        <ul className="space-y-1 text-[11px] text-amber-800">
          {skipped.map((item) => (
            <li key={item.filename}>
              <span className="font-medium">{item.filename}</span> — {item.reason}
            </li>
          ))}
        </ul>
      )}

      {staged !== null && (
        <>
          <p className="text-[11px] tabular-nums text-stone-500">
            {matchedCount} of {staged.length} matched · {unmatched.length} need assignment
          </p>

          {matchedCount > 0 && (
            <ul className="divide-y divide-stone-100 rounded ring-1 ring-inset ring-stone-200">
              {staged
                .filter((item) => item.siteKey !== null)
                .map((item) => (
                  <li
                    key={item.file.filename}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]"
                  >
                    <span className="truncate text-stone-700">{item.file.filename}</span>
                    <span className="shrink-0 text-stone-500">
                      → {item.siteLabel}{' '}
                      <span className="text-stone-400">
                        ({item.strategy === null ? '' : STRATEGY_LABEL[item.strategy]})
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          )}

          {unmatched.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Unmatched files
                </h3>
                <ul className="space-y-1">
                  {unmatched.map((item) => (
                    <li key={item.file.filename}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedFile(
                            selectedFile === item.file.filename ? null : item.file.filename,
                          )
                        }
                        aria-pressed={selectedFile === item.file.filename}
                        className={`w-full truncate rounded px-2 py-1 text-left text-[11px] ring-1 ring-inset transition-colors ${
                          selectedFile === item.file.filename
                            ? 'bg-stone-800 text-white ring-stone-800'
                            : 'bg-white text-stone-700 ring-stone-200 hover:bg-stone-50'
                        }`}
                      >
                        {item.file.filename}
                        {item.ambiguous.length > 0 && (
                          <span className="ml-1 text-amber-600">
                            (matches {item.ambiguous.length} sites)
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Sites without a boundary
                </h3>
                {selectedFile === null ? (
                  <p className="text-[11px] text-stone-400">
                    Select a file to bind it to a site.
                  </p>
                ) : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {openSites.map((entry) => (
                      <li key={entry.siteKey}>
                        <button
                          type="button"
                          onClick={() => bind(selectedFile, entry)}
                          className="w-full truncate rounded px-2 py-1 text-left text-[11px] text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-emerald-50 hover:ring-emerald-300"
                        >
                          {entry.label}
                          {entry.recordIds.length > 1 && (
                            <span className="ml-1 text-amber-600">
                              ({entry.recordIds.length} rows share this name)
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-3">
            <p className="text-[11px] text-stone-500">
              {progress === null
                ? `${matchedCount} file${matchedCount === 1 ? '' : 's'} ready to store`
                : `Storing ${progress.done} of ${progress.total}…`}
            </p>
            <button
              type="button"
              disabled={committing || matchedCount === 0}
              onClick={() => void commit()}
              className="rounded bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-700 disabled:opacity-40"
            >
              Store {matchedCount} file{matchedCount === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
