/**
 * The loaded dataset.
 *
 * Deliberately separate from the filter store. Filters describe a *view* and
 * survive a reload; the dataset is the thing being viewed and is replaced
 * wholesale. Keeping them apart is what lets {@link DatasetState.commit} swap
 * everything at once without a half-applied intermediate state where the map
 * holds new records and the filters still reference the old ones.
 *
 * Nothing writes here except an explicit commit from the preview screen. There
 * is no code path from a dropped file to this store that does not pass through
 * a user pressing "Load this data".
 */

import { create } from 'zustand';

import type { RecordResolution, ResolutionReport } from '@/lib/geo';
import type { MeasureDescriptor, MeasureGroup } from '@/lib/measures';
import type { NormalizedKey, ParsedWorkbook } from '@/types/schema';
import type { UploadPreview } from '@/lib/upload';

/** Location and measure columns the aggregator needs, resolved at commit. */
export interface DatasetBinding {
  readonly stateKey: NormalizedKey | null;
  readonly districtKey: NormalizedKey | null;
  readonly siteKey: NormalizedKey | null;
  readonly areaKey: NormalizedKey | null;
}

export interface DatasetState {
  readonly workbook: ParsedWorkbook | null;
  readonly resolutions: readonly RecordResolution[];
  readonly resolutionReport: ResolutionReport | null;
  readonly measures: readonly MeasureDescriptor[];
  readonly measureGroups: readonly MeasureGroup[];
  readonly binding: DatasetBinding;
  /** Filename of the loaded workbook, for display. Never transmitted. */
  readonly sourceFileName: string | null;
  /** ISO 8601 timestamp of the commit. */
  readonly loadedAt: string | null;

  /** Replace everything. The only write path into this store. */
  commit: (preview: UploadPreview) => void;
  /**
   * Discard the dataset.
   *
   * Backs the "Clear local data" control CLAUDE.md requires. Currently clears
   * memory only — nothing is persisted yet — so this is the whole of it.
   */
  clear: () => void;
}

const EMPTY_BINDING: DatasetBinding = {
  stateKey: null,
  districtKey: null,
  siteKey: null,
  areaKey: null,
};

export const useDatasetStore = create<DatasetState>((set) => ({
  workbook: null,
  resolutions: [],
  resolutionReport: null,
  measures: [],
  measureGroups: [],
  binding: EMPTY_BINDING,
  sourceFileName: null,
  loadedAt: null,

  commit: (preview) =>
    set({
      workbook: preview.workbook,
      resolutions: preview.resolutions,
      resolutionReport: preview.resolutionReport,
      measures: preview.measures,
      measureGroups: preview.measureGroups,
      binding: preview.binding,
      sourceFileName: preview.fileName,
      loadedAt: new Date().toISOString(),
    }),

  clear: () =>
    set({
      workbook: null,
      resolutions: [],
      resolutionReport: null,
      measures: [],
      measureGroups: [],
      binding: EMPTY_BINDING,
      sourceFileName: null,
      loadedAt: null,
    }),
}));

/** Whether anything is loaded. */
export function hasDataset(state: Pick<DatasetState, 'workbook'>): boolean {
  return state.workbook !== null;
}
