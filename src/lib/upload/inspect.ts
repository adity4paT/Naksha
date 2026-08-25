/**
 * Turning a dropped file into either a preview or a typed error.
 *
 * Nothing here mutates application state. Inspection produces a candidate that
 * the user must explicitly accept — the commit is a separate action in a
 * separate module, which is the mechanism behind "never swap the dataset
 * silently". A malformed upload cannot blank the map because it never reaches
 * the map.
 *
 * Split into three layers so the expensive part can move off-thread while the
 * analysis stays synchronous and testable:
 *
 *   inspectUpload  — validate the file, parse in a Worker, analyse
 *   inspectBytes   — parse on this thread, analyse (tests, SSR)
 *   analyzeWorkbook — pure; no XLSX, no I/O
 */

import { bindColumns, parseWorkbook } from '@/lib/ingest';
import type { AliasMap, BoundaryIndex, RecordResolution, ResolutionReport } from '@/lib/geo';
import { buildResolutionReport, resolveRecord } from '@/lib/geo';
import { buildMeasureCatalogue } from '@/lib/measures';
import type { MeasureDescriptor, MeasureGroup } from '@/lib/measures';
import type { NormalizedKey, ParsedWorkbook } from '@/types/schema';
import type { CoordinateColumn } from './coordinates';
import { detectCoordinateColumns } from './coordinates';
import type { ColumnDriftReport } from './drift';
import { diffColumns } from './drift';
import type { UploadError } from './errors';
import {
  corruptWorkbook,
  fileTooLarge,
  hasAcceptedExtension,
  headerRowUndetectable,
  looksLikeZip,
  MAX_FILE_BYTES,
  noTabularSheet,
  notAZip,
  wrongFileType,
  zeroRowsAfterCleaning,
} from './errors';
import { parseWorkbookAsync } from './parseClient';

/** A parsed candidate, not yet loaded. */
export interface UploadPreview {
  readonly fileName: string;
  readonly fileBytes: number;
  readonly workbook: ParsedWorkbook;
  readonly resolutions: readonly RecordResolution[];
  readonly resolutionReport: ResolutionReport;
  readonly drift: ColumnDriftReport;
  /** Detected, reported, and deliberately unused. See `coordinates.ts`. */
  readonly coordinateColumns: readonly CoordinateColumn[];
  readonly measures: readonly MeasureDescriptor[];
  readonly measureGroups: readonly MeasureGroup[];
  readonly defaultMeasureId: string | null;
  /** Bound location columns, for the commit step. */
  readonly binding: {
    readonly stateKey: NormalizedKey | null;
    readonly districtKey: NormalizedKey | null;
    readonly siteKey: NormalizedKey | null;
    readonly areaKey: NormalizedKey | null;
  };
  /**
   * Blocking-severity concerns that do NOT prevent loading.
   *
   * Distinct from {@link UploadError}: these are things a user should read
   * before committing, not reasons to refuse. Header-row fallback is the main
   * one — a guessed header with 27 sensible columns and 130 rows is far more
   * useful shown than refused, and the preview is exactly where a wrong guess
   * becomes obvious.
   */
  readonly cautions: readonly string[];
}

export type UploadInspection =
  | { readonly ok: true; readonly preview: UploadPreview }
  | { readonly ok: false; readonly error: UploadError };

export interface InspectOptions {
  readonly boundaries: BoundaryIndex;
  readonly aliases: AliasMap;
  /** Currently loaded workbook, for the drift diff. Null on first upload. */
  readonly loaded: ParsedWorkbook | null;
  /** User override for which sheet to read. */
  readonly sheetName?: string;
  /** User override for the header row, zero-based. */
  readonly headerRowIndex?: number;
}

/** Validate the file itself, before any parsing is attempted. */
function validateFile(name: string, size: number, bytes: Uint8Array): UploadError | null {
  if (!hasAcceptedExtension(name)) return wrongFileType(name);
  if (size > MAX_FILE_BYTES) return fileTooLarge(size);
  // Checked before the parser sees it, so a renamed .xls or .csv gets a message
  // about what the file actually is rather than the parser's internal complaint
  // about a missing central directory.
  if (!looksLikeZip(bytes)) return notAZip(name);
  return null;
}

/**
 * Inspect a file, parsing in a Web Worker where one is available.
 *
 * The worker is what keeps a large upload from freezing the tab;
 * {@link MAX_FILE_BYTES} still bounds memory. See `parseClient.ts` for the
 * fallback path.
 */
export async function inspectUpload(
  file: File,
  options: InspectOptions,
): Promise<UploadInspection> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const fileError = validateFile(file.name, file.size, bytes);
  if (fileError !== null) return { ok: false, error: fileError };

  let workbook: ParsedWorkbook;
  try {
    workbook = await parseWorkbookAsync(bytes, {
      fileName: file.name,
      ...(options.sheetName === undefined ? {} : { sheetName: options.sheetName }),
      ...(options.headerRowIndex === undefined
        ? {}
        : { headerRowIndex: options.headerRowIndex }),
    });
  } catch (error) {
    return {
      ok: false,
      error: corruptWorkbook(error instanceof Error ? error.message : String(error)),
    };
  }

  return analyzeWorkbook(workbook, file.name, file.size, options);
}

/** Synchronous path: parse on this thread, then analyse. Used by tests. */
export function inspectBytes(
  bytes: Uint8Array,
  fileName: string,
  fileBytes: number,
  options: InspectOptions,
): UploadInspection {
  let workbook: ParsedWorkbook;

  try {
    workbook = parseWorkbook(bytes, {
      fileName,
      ...(options.sheetName === undefined ? {} : { sheetName: options.sheetName }),
      ...(options.headerRowIndex === undefined
        ? {}
        : { headerRowIndex: options.headerRowIndex }),
    });
  } catch (error) {
    return {
      ok: false,
      error: corruptWorkbook(error instanceof Error ? error.message : String(error)),
    };
  }

  return analyzeWorkbook(workbook, fileName, fileBytes, options);
}

/**
 * Everything after the parse: validate the shape, resolve geography, diff.
 *
 * Pure and synchronous, so it runs identically whether the parse happened in a
 * worker or on this thread.
 */
export function analyzeWorkbook(
  workbook: ParsedWorkbook,
  fileName: string,
  fileBytes: number,
  options: InspectOptions,
): UploadInspection {
  const populatedSheets = workbook.sheets.filter((sheet) => sheet.populatedCellCount > 0);

  if (populatedSheets.length === 0) {
    return { ok: false, error: noTabularSheet(workbook.sheets.map((s) => s.name)) };
  }

  // Header detection genuinely failed only when the fallback also yielded no
  // usable columns. Fallback WITH columns is a caution, not a refusal.
  if (workbook.columns.length === 0) {
    const selected = workbook.sheets.find((sheet) => sheet.selected);
    return {
      ok: false,
      error: headerRowUndetectable(workbook.sheetName, selected?.rowCount ?? 0),
    };
  }

  const binding = bindColumns(workbook.columns);
  const locationColumn =
    binding.stateKey === null
      ? null
      : (workbook.columns.find((c) => c.normalizedKey === binding.stateKey)?.displayLabel ??
        null);

  if (workbook.records.length === 0) {
    return {
      ok: false,
      error: zeroRowsAfterCleaning(
        workbook.sheetName,
        workbook.droppedRows.length,
        locationColumn?.trim() ?? null,
      ),
    };
  }

  const resolutions = workbook.records.map((record) =>
    resolveRecord(
      binding.stateKey === null ? null : record.values[binding.stateKey],
      binding.districtKey === null ? null : record.values[binding.districtKey],
      options.boundaries,
      options.aliases,
    ),
  );

  const catalogue = buildMeasureCatalogue(workbook);
  const cautions: string[] = [];

  if (workbook.header.usedFallback) {
    cautions.push(
      `No row on "${workbook.sheetName}" clearly looked like a header, so row ${workbook.header.rowIndex + 1} was assumed. Every column below depends on that guess — check the names are right before loading.`,
    );
  }

  if (populatedSheets.length > 1) {
    cautions.push(
      `${populatedSheets.length} sheets contain data. "${workbook.sheetName}" was chosen as the densest.`,
    );
  }

  if (binding.stateKey === null) {
    cautions.push(
      'No column resembling a state was found, so no record can be placed on the map.',
    );
  }

  if (catalogue.measures.length === 0) {
    cautions.push('No column was inferred as a measure, so the choropleth has nothing to show.');
  }

  return {
    ok: true,
    preview: {
      fileName,
      fileBytes,
      workbook,
      resolutions,
      resolutionReport: buildResolutionReport(resolutions),
      drift: diffColumns(options.loaded, workbook),
      coordinateColumns: detectCoordinateColumns(workbook.columns),
      measures: catalogue.measures,
      measureGroups: catalogue.groups,
      defaultMeasureId: catalogue.defaultId,
      binding: {
        stateKey: binding.stateKey,
        districtKey: binding.districtKey,
        siteKey:
          workbook.columns.find((c) => /\bsite\b/.test(c.normalizedKey))?.normalizedKey ??
          null,
        areaKey: binding.measures.total ?? null,
      },
      cautions,
    },
  };
}
