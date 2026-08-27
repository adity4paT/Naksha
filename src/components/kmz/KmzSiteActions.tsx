'use client';

/**
 * The per-site action group: Show KMZ, Replace, Upload.
 *
 * ## Never a disabled "Show"
 *
 * A site with no boundary gets "Upload KMZ" WHERE Show would have been — not a
 * greyed-out Show. Those two read completely differently: a disabled control
 * says the feature is broken or the user lacks permission, and a person seeing
 * it goes looking for what they did wrong. "Upload KMZ" says the file is
 * missing and this is how you fix it. The information a user needs is which of
 * the two situations they are in, and only one of these designs tells them.
 *
 * ## Two ways out, ranked honestly
 *
 * Show KMZ downloads the real boundary, which then opens in Google Earth Pro —
 * usually with one extra click. Earth Web shows only a camera position — no
 * parcel outline, nothing surveyed. They are not alternatives, so they are not
 * styled as a pair: Show is primary, Earth Web is a small secondary link that
 * says "location" in its own label.
 *
 * ## "Downloads, then opens" — not "opens"
 *
 * A page cannot make the OS launch a desktop application on its own; that is a
 * deliberate browser sandbox boundary, not a gap in this code. `showKmz` (see
 * download.ts) does the only thing a page is allowed to do: save the bytes with
 * the KMZ media type and a `.kmz` name. What happens next depends on the
 * browser's OWN download UI, not on anything this app controls:
 *
 *   - Chrome/Edge show a small chip at the bottom of the window after every
 *     download; clicking the file name there launches the registered app.
 *     Right-clicking it offers "Always open files of this type", after which
 *     every future Show KMZ opens Earth Pro with no further click.
 *   - Firefox asks what to do with a KMZ the first time (Settings → General →
 *     Applications lets it be set to "Open in Google Earth Pro" permanently).
 *   - Either way, the file always lands in the Downloads folder too, so
 *     double-clicking it there works regardless of what the browser chip did.
 *
 * Every string in this file that mentions Earth Pro is written to reflect
 * that — "opens" without a qualifier over-promises something no web page can
 * deliver, and a user who takes it literally goes looking for a bug that
 * is not here when the real next step is one click in their downloads.
 */

import { useCallback, useRef, useState } from 'react';

import {
  EARTH_PRO_URL,
  earthWebUrlFor,
  earthWebConsented,
  grantEarthWebConsent,
  showKmz,
} from '@/lib/kmz';
import type { KmzAttachmentMeta } from '@/lib/kmz';
import { useKmzStore } from '@/store/kmz';
import type { KmzUploadOutcome } from '@/store/kmz';
import type { SiteKey } from '@/types/schema';

export interface KmzSiteActionsProps {
  /** Null when the workbook has no site column. */
  readonly siteKey: SiteKey | null;
  readonly siteLabel: string;
  /** Table rows use the tighter layout. */
  readonly compact?: boolean;
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

export function KmzSiteActions({ siteKey, siteLabel, compact = false }: KmzSiteActionsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<KmzUploadOutcome | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [askingEarthWeb, setAskingEarthWeb] = useState(false);

  const upload = useKmzStore((state) => state.upload);
  const remove = useKmzStore((state) => state.remove);
  const noteKmzShown = useKmzStore((state) => state.noteKmzShown);
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

  const handleShow = useCallback(async () => {
    if (siteKey === null) return;
    // Surfaces the one-time Earth Pro hint the first time a file actually
    // leaves the app, which is the moment it becomes useful information.
    noteKmzShown();
    await showKmz(siteKey, siteLabel);
  }, [siteKey, siteLabel, noteKmzShown]);

  const openEarthWeb = useCallback(() => {
    const centroid = attachment?.centroid;
    if (centroid == null) return;
    grantEarthWebConsent();
    setAskingEarthWeb(false);
    window.open(earthWebUrlFor(centroid.lat, centroid.lng), '_blank', 'noopener,noreferrer');
  }, [attachment]);

  const handleEarthWebClick = useCallback(() => {
    if (earthWebConsented()) openEarthWeb();
    else setAskingEarthWeb(true);
  }, [openEarthWeb]);

  if (siteKey === null) {
    return (
      <span
        className="text-[11px] text-stone-400"
        title="This workbook has no site column, so files cannot be bound to rows."
      >
        No site column
      </span>
    );
  }

  const hasCentroid = attachment?.centroid != null;

  return (
    <div className={compact ? 'flex flex-col gap-1' : 'flex flex-col gap-1'}>
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

      <div className="flex flex-wrap items-center gap-1.5">
        {attachment === undefined ? (
          /* No boundary: Upload takes Show's place. Not a disabled Show. */
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
          <>
            <button
              type="button"
              onClick={() => void handleShow()}
              className="rounded bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
              aria-label={`Show KMZ boundary for ${siteLabel}. Downloads the original file.`}
              title="Downloads the original file, unmodified. Open it from your downloads (or click the download notification) to view it in Google Earth Pro."
            >
              Show KMZ
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded border border-stone-300 px-2 py-0.5 text-[11px] text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 disabled:opacity-50"
              aria-label={`Replace the KMZ attached to ${siteLabel}`}
            >
              {busy ? 'Reading…' : 'Replace'}
            </button>

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
              onClick={() => void remove(siteKey)}
              className="text-[11px] text-stone-400 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
              aria-label={`Remove KMZ from ${siteLabel}`}
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Secondary, and only where a coordinate actually exists. */}
      {hasCentroid && (
        <button
          type="button"
          onClick={handleEarthWebClick}
          className="self-start text-[10px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
          title="Opens Google Earth Web at this parcel's location. The boundary itself is not shown."
        >
          Open location in Google Earth Web
        </button>
      )}

      {askingEarthWeb && (
        <div
          role="dialog"
          aria-label="Confirm sending coordinates to Google"
          className="rounded border border-amber-300 bg-amber-50 p-2 text-[10px] leading-snug text-amber-900"
        >
          <p className="font-semibold">This sends a coordinate to Google.</p>
          <p className="mt-0.5">
            Opening Earth Web puts this parcel&apos;s exact latitude and longitude
            {attachment?.centroid != null && (
              <>
                {' '}(
                <span className="tabular-nums">
                  {attachment.centroid.lat.toFixed(5)}, {attachment.centroid.lng.toFixed(5)}
                </span>
                )
              </>
            )}{' '}
            into a google.com URL. The boundary file is not sent, and the outline is not
            shown — only the location. Show KMZ keeps everything on this machine.
          </p>
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              onClick={openEarthWeb}
              className="rounded bg-amber-800 px-2 py-0.5 font-medium text-white hover:bg-amber-900"
            >
              Send and open
            </button>
            <button
              type="button"
              onClick={() => setAskingEarthWeb(false)}
              className="rounded border border-amber-400 px-2 py-0.5 text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
          <p className="mt-1 text-amber-700">Asked once per session.</p>
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

/**
 * The one-time hint, rendered once at app level rather than per row.
 *
 * Two things it has to teach in one line, because a user only reads it once:
 * that Show KMZ downloads rather than opens (a page cannot launch a desktop
 * app on its own — see the module doc), and the one click that turns it into
 * "opens" from then on. Skip either half and a user without Earth Pro reads a
 * silently-downloaded file as the app being broken, while a user WITH it never
 * discovers the one-time setting that would have saved them a click on every
 * future boundary they open.
 */
export function EarthProHint() {
  const visible = useKmzStore((state) => state.earthProHintVisible);
  const dismiss = useKmzStore((state) => state.dismissEarthProHint);

  if (!visible) return null;

  return (
    <div className="flex items-start justify-between gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2 text-[11px] text-sky-900">
      <p>
        <strong>Show KMZ</strong> downloads the boundary — it does not open automatically.
        Click the download notification (or the file in your Downloads folder) to view it in{' '}
        <strong>Google Earth Pro</strong>. Choosing &ldquo;Always open files of this
        type&rdquo; there makes every future one open with no extra click. Nothing happening
        at all usually means Earth Pro is not installed —{' '}
        <a
          href={EARTH_PRO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-sky-400 underline-offset-2 hover:text-sky-700"
        >
          it is free to download
        </a>
        .
      </p>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded px-1.5 py-0.5 text-sky-700 hover:bg-sky-100"
        aria-label="Dismiss the Google Earth Pro hint"
      >
        Dismiss
      </button>
    </div>
  );
}
