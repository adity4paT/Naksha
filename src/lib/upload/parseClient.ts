/**
 * Client-side entry to the parser, using a Web Worker when one is available.
 *
 * Falls back to a synchronous main-thread parse when Workers are unavailable —
 * during SSR, in a test runner, or under a Content-Security-Policy that blocks
 * worker construction. The fallback is genuinely equivalent, just blocking, so
 * a missing Worker degrades responsiveness rather than functionality.
 */

import { parseWorkbook } from '@/lib/ingest';
import type { ParseOptions } from '@/lib/ingest';
import type { ParsedWorkbook } from '@/types/schema';
import type { ParseRequest, ParseResponse } from '@/workers/parse.worker';

let worker: Worker | null = null;
let nextId = 1;
/** Set once construction has failed, so we do not retry it on every upload. */
let workerUnavailable = false;

function getWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker !== null) return worker;
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

  try {
    // `new URL(..., import.meta.url)` is the form bundlers recognise for worker
    // entry points; a string path would not be traced and would 404 in a build.
    worker = new Worker(new URL('../../workers/parse.worker.ts', import.meta.url), {
      type: 'module',
    });
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/**
 * Parse a workbook, off-thread where possible.
 *
 * Rejects with a plain `Error` on failure, so callers can treat worker and
 * main-thread failures identically.
 */
export async function parseWorkbookAsync(
  bytes: Uint8Array,
  options: ParseOptions,
): Promise<ParsedWorkbook> {
  const active = getWorker();

  if (active === null) {
    return parseWorkbook(bytes, options);
  }

  const id = nextId++;

  return new Promise<ParsedWorkbook>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ParseResponse>) => {
      // One worker serves every upload, so responses must be matched by id
      // rather than assumed to belong to the latest request.
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data.workbook);
      else reject(new Error(event.data.message));
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      // A worker that errors at the top level is broken for every future
      // request too, so drop it and let the next call fall back.
      worker?.terminate();
      worker = null;
      workerUnavailable = true;
      reject(new Error(event.message || 'The parsing worker failed to start.'));
    };

    function cleanup() {
      active?.removeEventListener('message', onMessage as EventListener);
      active?.removeEventListener('error', onError as EventListener);
    }

    active.addEventListener('message', onMessage as EventListener);
    active.addEventListener('error', onError as EventListener);

    // The buffer is transferred rather than copied — a 40 MB workbook would
    // otherwise be duplicated in memory just to hand it over.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    const request: ParseRequest = { id, bytes: buffer, options };
    active.postMessage(request, [buffer]);
  });
}
