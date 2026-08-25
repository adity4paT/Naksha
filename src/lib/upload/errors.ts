/**
 * Upload failures, each with a message naming what was expected.
 *
 * "Invalid file" tells a user nothing they can act on. Every code here names
 * the specific expectation that was not met and, where possible, what to do
 * about it — because the person hitting this is looking at a spreadsheet they
 * believe is fine, and the useful information is which of their beliefs is wrong.
 */

export type UploadErrorCode =
  /** Extension is not .xlsx or .xlsm. */
  | 'wrong-file-type'
  /** File is not a ZIP container, so it cannot be an OOXML workbook. */
  | 'not-a-zip'
  /** ZIP structure is damaged or the workbook parts are unreadable. */
  | 'corrupt-workbook'
  /** File exceeds the in-browser parsing budget. */
  | 'file-too-large'
  /** Parsed, but no sheet holds anything resembling a table. */
  | 'no-tabular-sheet'
  /** A sheet has content but no row could serve as a header. */
  | 'header-row-undetectable'
  /** Columns were found, but every data row was dropped. */
  | 'zero-rows-after-cleaning';

export interface UploadError {
  readonly code: UploadErrorCode;
  /** One sentence stating what was expected and what was found. */
  readonly message: string;
  /** What the user can do next. Omitted when there is nothing useful to say. */
  readonly remedy?: string;
  /** Supporting numbers, shown as a detail line. */
  readonly detail?: string;
}

/**
 * Largest file accepted, in bytes.
 *
 * Parsing runs on the main thread and holds the whole workbook in memory. At
 * roughly 60 MB the tab becomes unresponsive for long enough that a user
 * concludes the app has crashed — a clear refusal is better than an
 * indistinguishable hang. Raising this should come with moving the parse into
 * a worker, not just changing the number.
 */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;

/** Extensions this app can read. */
export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xlsm'] as const;

const humanBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;

export function wrongFileType(fileName: string): UploadError {
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? '(none)' : fileName.slice(dot).toLowerCase();

  return {
    code: 'wrong-file-type',
    message: `Expected an .xlsx or .xlsm workbook. This file's extension is ${extension}.`,
    remedy:
      extension === '.xls'
        ? 'This is the older binary Excel format. Open it in Excel and use Save As → Excel Workbook (.xlsx).'
        : extension === '.csv'
          ? 'CSV has no sheets and no column types. Open it in Excel and save as .xlsx.'
          : 'Open the file in Excel and use Save As → Excel Workbook (.xlsx).',
    detail: fileName,
  };
}

export function fileTooLarge(bytes: number): UploadError {
  return {
    code: 'file-too-large',
    message: `Expected a file under ${humanBytes(MAX_FILE_BYTES)}. This one is ${humanBytes(bytes)}.`,
    remedy:
      'Parsing runs entirely in this browser tab, so very large workbooks freeze it. Split the file, or remove sheets that are not the land MIS.',
  };
}

export function notAZip(fileName: string): UploadError {
  return {
    code: 'not-a-zip',
    message:
      'Expected an .xlsx file, which is a ZIP container. This file does not begin with a ZIP signature, so it is not one — whatever its name says.',
    remedy:
      'It may be an older .xls, a CSV, or a file that was renamed. Open it in Excel and use Save As → Excel Workbook (.xlsx).',
    detail: fileName,
  };
}

export function corruptWorkbook(reason: string): UploadError {
  return {
    code: 'corrupt-workbook',
    message:
      'Expected a readable workbook. The file is a ZIP, but its internal structure could not be read.',
    remedy:
      'The file is likely truncated or damaged in transfer. Try downloading or exporting it again.',
    detail: reason,
  };
}

export function noTabularSheet(sheetNames: readonly string[]): UploadError {
  return {
    code: 'no-tabular-sheet',
    message: `Expected at least one sheet containing a table of data. All ${sheetNames.length} sheet${sheetNames.length === 1 ? '' : 's'} in this workbook are empty.`,
    remedy:
      'Check that the data is on a worksheet rather than in a chart, a pivot cache, or an external link.',
    detail:
      sheetNames.length > 0 ? `Sheets found: ${sheetNames.join(', ')}` : 'No sheets found.',
  };
}

export function headerRowUndetectable(sheetName: string, rowCount: number): UploadError {
  return {
    code: 'header-row-undetectable',
    message: `Expected a header row on "${sheetName}" — a row of text labels with data of mixed types beneath it. None of its ${rowCount} row${rowCount === 1 ? '' : 's'} matched that shape.`,
    remedy:
      'Remove any title or banner rows above the column headers, and make sure the headers are text rather than merged cells.',
  };
}

export function zeroRowsAfterCleaning(
  sheetName: string,
  droppedCount: number,
  locationColumn: string | null,
): UploadError {
  return {
    code: 'zero-rows-after-cleaning',
    message: `Expected at least one usable data row on "${sheetName}". All ${droppedCount} row${droppedCount === 1 ? '' : 's'} were dropped.`,
    remedy:
      locationColumn === null
        ? 'No column resembling a state or location was found, so no row could be placed. Check that the location column has a recognisable header.'
        : `Rows are dropped when "${locationColumn}" is blank. Check that column in the source file.`,
    ...(droppedCount > 0 ? { detail: `${droppedCount} rows dropped` } : {}),
  };
}

/** Whether a filename carries an accepted extension. */
export function hasAcceptedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Whether the bytes begin with a ZIP local-file-header signature.
 *
 * Checked before handing anything to the parser so a renamed .xls or .csv gets
 * a message about what the file actually is, rather than the parser's internal
 * complaint about a missing central directory.
 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}
