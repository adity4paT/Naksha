/**
 * Shared fixture loader for the real sample workbook.
 *
 * These tests run against `Dummy land mis.xlsx` itself rather than a synthetic
 * stand-in. That is the point: the value of this suite is that it exercises the
 * actual NBSP, the actual CRLF headers, and the actual junk row. A hand-built
 * fixture would encode what we *believe* is in the file, and the belief is the
 * thing most likely to be wrong.
 *
 * Note the filename has spaces — it is `Dummy land mis.xlsx` on disk, not the
 * `Dummy_land_mis.xlsx` the project docs refer to.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseWorkbook } from '../parse';
import type { ParsedWorkbook } from '@/types/schema';

const FIXTURE_URL = new URL('../../../../Dummy land mis.xlsx', import.meta.url);

export const FIXTURE_FILE_NAME = 'Dummy land mis.xlsx';

/** Raw bytes of the sample workbook. */
export function readFixtureBytes(): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(FIXTURE_URL)));
}

let cached: ParsedWorkbook | undefined;

/**
 * Parse the sample once and share it across tests.
 *
 * Parsing is deterministic apart from `parsedAt`, and no test asserts on that,
 * so caching is safe and keeps the suite fast.
 */
export function parseFixture(): ParsedWorkbook {
  cached ??= parseWorkbook(readFixtureBytes(), { fileName: FIXTURE_FILE_NAME });
  return cached;
}

/** Look up a column by its display label, for readable assertions. */
export function columnByLabel(workbook: ParsedWorkbook, label: string) {
  return workbook.columns.find((column) => column.displayLabel.trim() === label.trim());
}

/** Look up a column by its normalized key. */
export function columnByKey(workbook: ParsedWorkbook, key: string) {
  return workbook.columns.find((column) => column.normalizedKey === key);
}
