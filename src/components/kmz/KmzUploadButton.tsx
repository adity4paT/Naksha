'use client';

/**
 * The per-site attachment control.
 *
 * One component serves both the site detail panel and the data table, because
 * they are the same affordance in two densities: attach a boundary to this
 * site, or show the one already attached. Two implementations would drift.
 *
 * The swap offer is the part worth noticing. When the parser reports coordinates
 * that land in India only when transposed, this does NOT silently fix them —
 * it stores the file, says what it found, and offers a button. A file that is
 * genuinely somewhere else and a file with lon/lat reversed are the same bytes
 * to us, and quietly "correcting" one would move a parcel across the country
 * without anyone being told.
 */

import { useCallback, useRef, useState } from 'react';

import { kmzStore } from '@/lib/kmz';
import type { KmzAttachmentMeta } from '@/lib/kmz';
import { useKmzStore } from '@/store/kmz';
import type { KmzUploadOutcome } from '@/store/kmz';
import type { SiteKey } from '@/types/schema';

export interface KmzUploadButtonProps {
  /** Null when the workbook has no site column; the control renders disabled. */
  readonly siteKey: SiteKey | null;
  readonly siteLabel: string;
  /** Table rows use the tighter layout. */
  readonly compact?: boolean;
}

/** Download the stored bytes, unmodified. */
async function downloadAttachment(siteKey: SiteKey, filename: string): Promise<void> {
  const bytes = await kmzStore.getBytes(siteKey);
  if (bytes === null) return;

  const url = URL.createObjectURL(bytes);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const STATUS_STYLE: Record<KmzAttachmentMeta['parseStatus'], string> = {
  parsed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  unparsed: 'bg-stone-100 text-stone-600 ring-stone-500/20',
  unparseable: 'bg-amber-50 text-amber-800 ring-amber-600/30',
};

const STATUS_LABEL: Record<KmzAttachmentMeta['parseStatus'], string> = {
  parsed: 'Boundary read',
  unparsed: 'Stored, not read',
  unparseable: 'Could not read',
};

export function KmzUploadButton({ siteKey, siteLabel, compact = false }: KmzUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<KmzUploadOutcome | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  const upload = useKmzStore((state) => state.upload);
  const remove = useKmzStore((state) => state.remove);
  const attachment = useKmzStore((state) =>
    siteKey === null ? undefined : state.attachments[siteKey],
  );

  const run = useCallback(
    async (file: File, swapCoordinates: boolean) => {
      if (siteKey === null) return;
      setBusy(true);
      setLastFile(file);
      setOutcome(await upload(siteKey, file, file.name, { swapCoordinates }));
      setBusy(false);
    },
    [siteKey, upload],
  );

  if (siteKey === null) {
    return (
      <span className="text-[11px] text-stone-400" title="This workbook has no site column, so files cannot be bound to rows.">
        No site column
      </span>
    );
  }

  return (
    <div className={compact ? 'flex items-center gap-1.5' : 'flex flex-col gap-1'}>
      <input
        ref={inputRef}
        type="file"
        accept=".kmz,.kml"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void run(file, false);
        }}
      />

      {attachment === undefined ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded border border-stone-300 px-2 py-0.5 text-[11px] font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-50"
          aria-label={`Upload KMZ for ${siteLabel}`}
        >
          {busy ? 'Reading…' : 'Upload KMZ'}
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${STATUS_STYLE[attachment.parseStatus]}`}
            title={
              attachment.parseWarnings.map((warning) => warning.message).join('\n') ||
              STATUS_LABEL[attachment.parseStatus]
            }
          >
            {STATUS_LABEL[attachment.parseStatus]}
          </span>
          <button
            type="button"
            onClick={() => void downloadAttachment(siteKey, attachment.filename)}
            className="max-w-[10rem] truncate text-[11px] text-stone-600 underline decoration-stone-300 underline-offset-2 hover:text-stone-900"
            title={`Download ${attachment.filename} — the original file, unmodified`}
          >
            {attachment.filename}
          </button>
          <button
            type="button"
            onClick={() => void remove(siteKey)}
            className="text-[11px] text-stone-400 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
            aria-label={`Remove KMZ from ${siteLabel}`}
          >
            ×
          </button>
        </div>
      )}

      {outcome?.suspectedCoordinateSwap === true && lastFile !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(lastFile, true)}
          className="self-start rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
        >
          Coordinates look transposed — retry with lat/lng swapped
        </button>
      )}
    </div>
  );
}
