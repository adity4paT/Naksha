/**
 * Turning a dropped file into either a preview or a typed error.
 *
 * Nothing here mutates application state. Inspection produces a candidate that
 * the user must explicitly accept — the commit is a separate action in a
 * separate module, which is the mechanism behind "never swap the dataset
 * silently". A malformed upload cannot blank the map because it never reaches
 * the map.
 */

import * as XLSX from 'xlsx';

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

/**
 * Inspect a file.
 *
 * Async so the caller can render a progress state before the parse blocks the
 * main thread. The parse itself is synchronous — SheetJS offers no streaming
 * API — so a genuinely large workbook will still freeze the tab for its
 * duration; {@link MAX_FILE_BYTES} is what keeps that bounded. Moving this to a
 * Web Worker is the right fix if production files get big.
 */
export async function inspectUpload(
  file: File,
  options: InspectOptions,
): Promise<UploadInspection> {
  if (!hasAcceptedExtension(file.name)) {
    return { ok: false, error: wrongFileType(file.name) };
  }

  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: fileTooLarge(file.size) };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Checked before the parser sees it, so a renamed .xls or .csv gets a message
  // about what the file actually is rather than the parser's internal complaint
  // about a missing central directory.
  if (!looksLikeZip(bytes)) {
    return { ok: false, error: notAZip(file.name) };
  }

  return inspectBytes(bytes, file.name, file.size, options);
}

/** The parsing half, separated so tests can drive it from a buffer. */
export function inspectBytes(
  bytes: Uint8Array,
  fileName: string,
  fileBytes: number,
  options: InspectOptions,
): UploadInspection {
  let sheetNames: readonly string[] = [];

  try {
    // Read once up front purely to enumerate sheets, so an empty workbook can
    // be reported as such rather than surfacing later as "zero rows".
    const probe = XLSX.read(bytes, { type: 'array', bookSheets: true });
    sheetNames = probe.SheetNames ?? [];
  } catch (error) {
    return {
      ok: false,
      error: corruptWorkbook(error instanceof Error ? error.message : String(error)),
    };
  }

  if (sheetNames.length === 0) {
    return { ok: false, error: noTabularSheet([]) };
  }

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

  const populatedSheets = workbook.sheets.filter((sheet) => sheet.populatedCellCount > 0);
  if (populatedSheets.length === 0) {
    return { ok: false, error: noTabularSheet(sheetNames) };
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
