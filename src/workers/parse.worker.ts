/// <reference lib="webworker" />

/**
 * Excel parsing, off the main thread.
 *
 * SheetJS has no streaming API — `read` is synchronous and holds the whole
 * workbook in memory — so on the main thread a large upload freezes the tab for
 * its entire duration, with no way to paint a progress state. Moving it here
 * keeps the UI responsive regardless of file size.
 *
 * Only the PARSE runs here. Resolution stays on the main thread because it is
 * cheap (each record is matched against one state's districts, at most 76) and
 * because shipping the 0.6 MB boundary index into the worker on every upload
 * would cost more than the work it saves.
 *
 * The response is a plain `ParsedWorkbook`, which structured-clone handles: its
 * branded key types are strings at runtime and its only exotic values are
 * `Date`s, which clone natively.
 */

import { parseWorkbook } from '@/lib/ingest';
import type { ParseOptions } from '@/lib/ingest';
import type { ParsedWorkbook } from '@/types/schema';

export interface ParseRequest {
  readonly id: number;
  readonly bytes: ArrayBuffer;
  readonly options: ParseOptions;
}

export type ParseResponse =
  | { readonly id: number; readonly ok: true; readonly workbook: ParsedWorkbook }
  | { readonly id: number; readonly ok: false; readonly message: string };

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  const { id, bytes, options } = event.data;

  try {
    const workbook = parseWorkbook(new Uint8Array(bytes), options);
    const response: ParseResponse = { id, ok: true, workbook };
    self.postMessage(response);
  } catch (error) {
    // Errors do not survive structured-clone with their prototype intact, so
    // the message is extracted here and re-typed by the caller.
    const response: ParseResponse = {
      id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
});
