/**
 * KMZ attachment state.
 *
 * A thin, observable mirror of what IndexedDB holds, so React re-renders when
 * an attachment appears or goes away. IndexedDB is the durable record; this is
 * a cache of its metadata, never of its bytes — those stay on disk and are read
 * only when a download actually happens.
 *
 * Kept separate from the dataset store for the same reason the filter store is:
 * attachments outlive any one workbook. Re-uploading the sheet replaces every
 * record and resolution, and must not disturb the files bound to sites that are
 * still present.
 */

import { create } from 'zustand';

import { kmzStore, parseKmz } from '@/lib/kmz';
import type { KmzAttachmentMeta, KmzStorageUsage } from '@/lib/kmz';
import type { SiteKey } from '@/types/schema';

/** Result of one upload attempt, for the caller to surface. */
export interface KmzUploadOutcome {
  readonly siteKey: SiteKey;
  readonly filename: string;
  readonly meta: KmzAttachmentMeta | null;
  /** Set when the file was stored but could not be read. */
  readonly unparseable: boolean;
  /** True when the parser thinks lat/lng are transposed. Offer the toggle. */
  readonly suspectedCoordinateSwap: boolean;
  readonly messages: readonly string[];
}

export interface KmzState {
  /** Keyed by SiteKey. Metadata only — never bytes. */
  readonly attachments: Readonly<Record<string, KmzAttachmentMeta>>;
  readonly usage: KmzStorageUsage | null;
  readonly loading: boolean;
  readonly error: string | null;

  refresh: () => Promise<void>;
  upload: (
    siteKey: SiteKey,
    bytes: Blob,
    filename: string,
    options?: { readonly swapCoordinates?: boolean },
  ) => Promise<KmzUploadOutcome>;
  remove: (siteKey: SiteKey) => Promise<void>;
  clearAll: () => Promise<void>;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const useKmzStore = create<KmzState>((set, get) => ({
  attachments: {},
  usage: null,
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const metas = await kmzStore.list();
      const attachments: Record<string, KmzAttachmentMeta> = {};
      for (const meta of metas) attachments[meta.siteKey] = meta;
      set({ attachments, usage: await kmzStore.usage(), loading: false });
    } catch (error) {
      set({ error: messageOf(error), loading: false });
    }
  },

  async upload(siteKey, bytes, filename, options) {
    // Parse first, store second — but store EITHER WAY. A file we cannot read
    // is still the surveyor's file, and discarding it because our parser choked
    // would lose the only copy the user has here.
    const parsed = await parseKmz(bytes, filename, {
      swapCoordinates: options?.swapCoordinates ?? false,
    });

    try {
      const meta = await kmzStore.put(siteKey, bytes, filename, {
        centroid: parsed.centroid,
        parseStatus: parsed.status,
        parseWarnings: parsed.warnings,
      });

      set({
        attachments: { ...get().attachments, [siteKey]: meta },
        usage: await kmzStore.usage(),
      });

      return {
        siteKey,
        filename,
        meta,
        unparseable: parsed.status === 'unparseable',
        suspectedCoordinateSwap: parsed.suspectedCoordinateSwap,
        messages: parsed.warnings.map((warning) => warning.message),
      };
    } catch (error) {
      const message = messageOf(error);
      set({ error: message });
      return {
        siteKey,
        filename,
        meta: null,
        unparseable: true,
        suspectedCoordinateSwap: parsed.suspectedCoordinateSwap,
        messages: [message],
      };
    }
  },

  async remove(siteKey) {
    await kmzStore.remove(siteKey);
    const next = { ...get().attachments };
    delete next[siteKey];
    set({ attachments: next, usage: await kmzStore.usage() });
  },

  async clearAll() {
    await kmzStore.clearAll();
    set({ attachments: {}, usage: await kmzStore.usage() });
  },
}));
