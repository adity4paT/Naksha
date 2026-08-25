/** Public entry point for the upload pipeline. */

export {
  ACCEPTED_EXTENSIONS,
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
export type { UploadError, UploadErrorCode } from './errors';

export { diffColumns } from './drift';
export type { ColumnChange, ColumnDelta, ColumnDriftReport } from './drift';

export { coordinateNotice, detectCoordinateColumns } from './coordinates';
export type { CoordinateColumn, CoordinateKind } from './coordinates';

export { inspectBytes, inspectUpload } from './inspect';
export type { InspectOptions, UploadInspection, UploadPreview } from './inspect';
