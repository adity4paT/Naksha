/**
 * IndexedDB storage for per-site KMZ attachments.
 *
 * Implements {@link KmzStore}. The contract and the reasoning behind the record
 * shape live in ./types.ts; this file is the mechanism.
 *
 * THE ONE RULE THAT SHAPES THIS FILE: the bytes that go in are the bytes that
 * come out. Nothing here re-serializes a KMZ from parsed GeoJSON. parse.ts
 * derives a centroid and a verdict and hands them back as metadata stored NEXT
 * TO the original Blob, never in place of it. A download reads that Blob
 * untouched, so what the user opens is the file their surveyor produced —
 * styling, ground overlays, embedded imagery and all.
 *
 * Blobs, not ArrayBuffers. IndexedDB stores a Blob as a disk-backed handle, so
 * reading a record does not pull its contents into the JS heap. Across ~130
 * files that is the difference between a listing that renders and a tab that
 * runs out of memory.
 *
 * Everything is lazily opened and guarded for SSR: this app is a static export,
 * so the module must not touch indexedDB at import time.
 */

import JSZip from 'jszip';

import type { SiteKey } from '@/types/schema';
import {
  KMZ_BUNDLE_FORMAT_VERSION,
  KMZ_DB_NAME,
  KMZ_DB_VERSION,
  KMZ_STORE_NAME,
} from './types';
import type {
  KmzAttachment,
  KmzAttachmentMeta,
  KmzBundleEntry,
  KmzBundleManifest,
  KmzImportConflictPolicy,
  KmzImportEntryResult,
  KmzImportReport,
  KmzParseOutcome,
  KmzStorageUsage,
  KmzStore,
} from './types';

/* -------------------------------------------------------------------------- */
/* IndexedDB plumbing                                                          */
/* -------------------------------------------------------------------------- */

/** Thrown only for genuine environment failures, never for bad user input. */
export class KmzStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KmzStoreUnavailableError';
  }
}

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new KmzStoreUnavailableError(
      'IndexedDB is unavailable. KMZ attachments cannot be stored in this environment.',
    );
  }
  return indexedDB;
}

const asPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = requireIndexedDb().open(KMZ_DB_NAME, KMZ_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KMZ_STORE_NAME)) {
        // keyPath is siteKey: one attachment per site, and a second put for the
        // same site replaces the first rather than accumulating.
        db.createObjectStore(KMZ_STORE_NAME, { keyPath: 'siteKey' });
      }
      // v1 -> v2 added the cached `geometry` field. No migration runs: the
      // field is optional, records written under v1 simply have none, and they
      // draw a marker without an outline until the file is uploaded again. The
      // alternative — re-parsing every stored archive inside an upgrade
      // transaction — would block the open on work that can fail, to rebuild a
      // cache the bytes can always regenerate.
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new KmzStoreUnavailableError(
          'Another tab is holding an older version of the KMZ database open. Close it and reload.',
        ),
      );
  });

  // A failed open must not be cached, or every later call inherits the failure.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(KMZ_STORE_NAME, mode);
    const request = run(tx.objectStore(KMZ_STORE_NAME));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** Testing seam: drop the cached connection so a fresh open happens. */
export function resetKmzStoreConnection(): void {
  dbPromise = null;
}

/* -------------------------------------------------------------------------- */
/* Hashing                                                                     */
/* -------------------------------------------------------------------------- */

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * FNV-1a over the bytes. Used only where crypto.subtle is unavailable.
 *
 * crypto.subtle requires a secure context, so a build served over plain http
 * would otherwise be unable to store anything. The prefix makes the weaker hash
 * unmistakable wherever it appears — a manifest carrying `fallback:` values
 * still detects truncation and corruption on import, which is what the field is
 * for here, but must not be read as a cryptographic guarantee.
 */
function fallbackHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fallback:${hash.toString(16).padStart(8, '0')}:${bytes.length}`;
}

async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  if (typeof crypto !== 'undefined' && crypto.subtle !== undefined) {
    return toHex(await crypto.subtle.digest('SHA-256', buffer));
  }
  return fallbackHash(new Uint8Array(buffer));
}

/* -------------------------------------------------------------------------- */
/* Record helpers                                                              */
/* -------------------------------------------------------------------------- */

const stripBytes = (record: KmzAttachment): KmzAttachmentMeta => {
  const { bytes: _bytes, ...meta } = record;
  return meta;
};

/** A file stored but never opened. The default when no parse is supplied. */
const UNPARSED: KmzParseOutcome = {
  centroid: null,
  parseStatus: 'unparsed',
  parseWarnings: [],
  geometry: null,
};

/* -------------------------------------------------------------------------- */
/* Bundle paths                                                                */
/* -------------------------------------------------------------------------- */

const MANIFEST_PATH = 'manifest.json';

/**
 * Path for one attachment inside a bundle.
 *
 * Named by content hash rather than by the original filename, which is neither
 * unique across sites nor safe as a zip path — real filenames arrive with
 * slashes, colons and non-ASCII characters that would either collide or escape
 * the intended directory. The display name is preserved in the manifest and
 * restored on import, so nothing is lost.
 */
const bundlePathFor = (sha256: string): string =>
  `files/${sha256.replace(/[^a-z0-9]/gi, '_')}.kmz`;

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

export const kmzStore: KmzStore = {
  async put(siteKey, bytes, filename, outcome = UNPARSED) {
    // The Blob is kept as-is. Not re-wrapped, not re-encoded, not round-tripped
    // through an ArrayBuffer copy that some future edit might "optimise" into a
    // transform. The filename is passed separately rather than read off a File,
    // because a bulk drop extracts entries from a .zip as bare Blobs and those
    // carry no name of their own. See the module doc.
    const sha256 = await hashBlob(bytes);
    const record: KmzAttachment = {
      siteKey,
      filename,
      bytes,
      sizeBytes: bytes.size,
      uploadedAt: new Date().toISOString(),
      centroid: outcome.centroid,
      parseStatus: outcome.parseStatus,
      parseWarnings: outcome.parseWarnings,
      geometry: outcome.geometry,
      sha256,
    };
    await withStore('readwrite', (store) => store.put(record));
    return stripBytes(record);
  },

  async get(siteKey) {
    const record = await withStore<KmzAttachment | undefined>('readonly', (store) =>
      store.get(siteKey),
    );
    return record ?? null;
  },

  async getBytes(siteKey) {
    const record = await this.get(siteKey);
    return record === null ? null : record.bytes;
  },

  async list() {
    const records = await withStore<KmzAttachment[]>('readonly', (store) => store.getAll());
    return records.map(stripBytes);
  },

  async listFor(siteKeys) {
    if (siteKeys.length === 0) return [];
    const wanted = new Set<string>(siteKeys);
    const all = await this.list();
    return all.filter((meta) => wanted.has(meta.siteKey));
  },

  async remove(siteKey) {
    await withStore('readwrite', (store) => store.delete(siteKey));
  },

  async clearAll() {
    await withStore('readwrite', (store) => store.clear());
  },

  async usage() {
    const metas = await this.list();
    const totalBytes = metas.reduce((sum, meta) => sum + meta.sizeBytes, 0);

    let usageBytes: number | null = null;
    let quotaBytes: number | null = null;
    let persisted = false;

    if (typeof navigator !== 'undefined' && navigator.storage !== undefined) {
      if (typeof navigator.storage.estimate === 'function') {
        try {
          const estimate = await navigator.storage.estimate();
          usageBytes = estimate.usage ?? null;
          quotaBytes = estimate.quota ?? null;
        } catch {
          // An unavailable estimate is not a failure worth surfacing; the exact
          // totalBytes above is the number the readout actually leads with.
        }
      }
      if (typeof navigator.storage.persisted === 'function') {
        try {
          persisted = await navigator.storage.persisted();
        } catch {
          persisted = false;
        }
      }
    }

    return { attachmentCount: metas.length, totalBytes, usageBytes, quotaBytes, persisted };
  },

  async requestPersistence() {
    if (
      typeof navigator === 'undefined' ||
      navigator.storage === undefined ||
      typeof navigator.storage.persist !== 'function'
    ) {
      return false;
    }
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  },

  async exportBundle() {
    const db = await openDb();
    const records = await new Promise<KmzAttachment[]>((resolve, reject) => {
      const tx = db.transaction(KMZ_STORE_NAME, 'readonly');
      const request = tx.objectStore(KMZ_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as KmzAttachment[]);
      request.onerror = () => reject(request.error);
    });

    const zip = new JSZip();
    const entries: KmzBundleEntry[] = [];

    for (const record of records) {
      const path = bundlePathFor(record.sha256);
      // The stored Blob goes in verbatim. JSZip is asked to STORE rather than
      // DEFLATE it: a KMZ is already a zip, so recompressing costs time and
      // saves nothing.
      zip.file(path, record.bytes, { compression: 'STORE' });
      entries.push({
        siteKey: record.siteKey,
        path,
        filename: record.filename,
        sizeBytes: record.sizeBytes,
        sha256: record.sha256,
        uploadedAt: record.uploadedAt,
        centroid: record.centroid,
        parseStatus: record.parseStatus,
        parseWarnings: record.parseWarnings,
        geometry: record.geometry ?? null,
      });
    }

    const manifest: KmzBundleManifest = {
      formatVersion: KMZ_BUNDLE_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      entries,
      totalSizeBytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
      containsConfidentialBoundaries: true,
    };
    zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

    return zip.generateAsync({ type: 'blob' });
  },

  async importBundle(bundle, policy, knownSiteKeys) {
    const zip = await JSZip.loadAsync(await bundle.arrayBuffer());

    const manifestEntry = zip.file(MANIFEST_PATH);
    if (manifestEntry === null) {
      throw new KmzStoreUnavailableError(
        'This file is not a KMZ bundle: it has no manifest.json at its root.',
      );
    }

    const manifest = JSON.parse(await manifestEntry.async('string')) as KmzBundleManifest;
    if (manifest.formatVersion !== KMZ_BUNDLE_FORMAT_VERSION) {
      // Refuse rather than guess. Half-reading a newer manifest would store
      // records with fields this build does not understand.
      throw new KmzStoreUnavailableError(
        `This bundle uses format version ${String(manifest.formatVersion)}, but this build understands version ${String(KMZ_BUNDLE_FORMAT_VERSION)}. Update the app before importing it.`,
      );
    }

    const results: KmzImportEntryResult[] = [];
    const orphanedSiteKeys: SiteKey[] = [];

    for (const entry of manifest.entries) {
      const file = zip.file(entry.path);
      if (file === null) {
        results.push({
          siteKey: entry.siteKey,
          filename: entry.filename,
          outcome: 'rejected-missing-file',
          detail: `The manifest lists "${entry.path}", which is not in the archive.`,
        });
        continue;
      }

      const blob = await file.async('blob');
      const actual = await hashBlob(blob);
      if (actual !== entry.sha256) {
        // The one promise this module makes is byte-identical round-tripping.
        // A mismatch means it was already broken, so storing the file anyway
        // would launder a corrupt boundary into the map.
        results.push({
          siteKey: entry.siteKey,
          filename: entry.filename,
          outcome: 'rejected-checksum',
          detail: 'The stored checksum does not match the file in this bundle. It was not imported.',
        });
        continue;
      }

      const existing = await this.get(entry.siteKey);
      if (existing !== null && policy === 'keep-existing') {
        results.push({
          siteKey: entry.siteKey,
          filename: entry.filename,
          outcome: 'skipped-conflict',
          detail: null,
        });
        continue;
      }

      const record: KmzAttachment = {
        siteKey: entry.siteKey,
        filename: entry.filename,
        bytes: blob,
        sizeBytes: entry.sizeBytes,
        uploadedAt: entry.uploadedAt,
        centroid: entry.centroid,
        parseStatus: entry.parseStatus,
        parseWarnings: entry.parseWarnings,
        geometry: entry.geometry ?? null,
        sha256: entry.sha256,
      };
      await withStore('readwrite', (store) => store.put(record));

      results.push({
        siteKey: entry.siteKey,
        filename: entry.filename,
        outcome: existing === null ? 'imported' : 'replaced',
        detail: null,
      });

      if (knownSiteKeys !== undefined && !knownSiteKeys.has(entry.siteKey)) {
        orphanedSiteKeys.push(entry.siteKey);
      }
    }

    const count = (outcome: KmzImportEntryResult['outcome']): number =>
      results.filter((result) => result.outcome === outcome).length;

    return {
      results,
      importedCount: count('imported'),
      replacedCount: count('replaced'),
      skippedCount: count('skipped-conflict'),
      rejectedCount: count('rejected-checksum') + count('rejected-missing-file'),
      orphanedSiteKeys,
    } satisfies KmzImportReport;
  },
};
