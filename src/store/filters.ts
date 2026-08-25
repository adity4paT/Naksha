/**
 * Filter and view state.
 *
 * The map and the filter panel are two views of this one store, which is what
 * makes them bidirectionally synced: clicking Gujarat on the map and ticking
 * Gujarat in the panel are the same action because both write `selections.state`.
 * Neither component owns selection state, so they cannot disagree.
 *
 * ## Map drill-down and multi-select are the same field
 *
 * The map drills into one state at a time; the panel allows many. Rather than
 * keeping two fields and reconciling them — which is how they drift — the map's
 * drill-down *sets* `selections.state` to a single-element array, and reads
 * {@link focusedState}, which is non-null only when exactly one state is
 * selected. Selecting three states in the panel therefore leaves the map at
 * national level showing all three, which is the honest rendering of that
 * filter.
 *
 * ## Selections are retained, never pruned
 *
 * Nothing in this store removes a selection because it became unavailable. See
 * `src/lib/filters/types.ts` — active selections are derived, and orphaned ones
 * stay visible and restorable.
 */

import { create } from 'zustand';

import type { BinCount, BinningMethod, ScaleKind } from '@/lib/color';
import type { FilterDimension, FilterSelections, RangeSelection } from '@/lib/filters';
import { EMPTY_SELECTIONS } from '@/lib/filters';

/** Which administrative level the choropleth is painting. */
export type MapLevel = 'state' | 'district';

/**
 * Zoom at which district level activates without an explicit state selection.
 *
 * At this zoom a single state fills most of the viewport, so district polygons
 * are large enough to read and to click.
 */
export const DISTRICT_ZOOM_THRESHOLD = 6;

/** One step of the breadcrumb trail. */
export interface BreadcrumbStep {
  readonly label: string;
  readonly level: 'country' | 'state' | 'district';
}

export interface FilterState {
  /* ---- filters ---- */
  readonly selections: FilterSelections;

  /* ---- measure & scale ---- */
  /**
   * Catalogue id of the active measure, not a column key.
   *
   * An id because a derived measure has no column of its own — "Utilisation %"
   * is computed from three of them. Keying on a column would make the derived
   * measures unrepresentable in state and unshareable by URL.
   */
  readonly measureId: string | null;
  readonly scaleKind: ScaleKind;
  readonly binningMethod: BinningMethod;
  readonly binCount: BinCount;

  /* ---- viewport ---- */
  readonly zoom: number;

  /* ---- panels ---- */
  readonly unmappedPanelOpen: boolean;
  readonly siteListRegion: string | null;
  /** Selections dropped because the URL grew too long. Surfaced, never silent. */
  readonly urlTruncated: readonly string[];

  /* ---- actions ---- */
  toggleValue: (dimension: FilterDimension, value: string) => void;
  setValues: (dimension: FilterDimension, values: readonly string[]) => void;
  addValues: (dimension: FilterDimension, values: readonly string[]) => void;
  removeValue: (dimension: FilterDimension, value: string) => void;
  clearDimension: (dimension: FilterDimension) => void;
  /** Apply an orphan's restore action: widen every named upstream filter. */
  restoreOrphan: (restore: Readonly<Partial<Record<FilterDimension, readonly string[]>>>) => void;

  setRange: (key: string, range: RangeSelection) => void;
  clearRange: (key: string) => void;

  resetAll: () => void;
  hydrate: (partial: Partial<Pick<FilterState, 'selections' | 'measureId' | 'scaleKind' | 'binningMethod' | 'binCount'>>) => void;

  /* ---- map ---- */
  /** Drill into one state. Replaces the state selection rather than adding. */
  focusState: (state: string | null) => void;
  focusDistrict: (district: string | null) => void;
  navigateTo: (depth: 0 | 1 | 2) => void;

  setMeasure: (id: string) => void;
  setScaleKind: (kind: ScaleKind) => void;
  setBinningMethod: (method: BinningMethod) => void;
  setBinCount: (count: BinCount) => void;
  setZoom: (zoom: number) => void;
  toggleUnmappedPanel: () => void;
  openSiteList: (region: string | null) => void;
  setUrlTruncated: (dimensions: readonly string[]) => void;
}

const withDimension = (
  selections: FilterSelections,
  dimension: FilterDimension,
  values: readonly string[],
): FilterSelections => ({ ...selections, [dimension]: values });

export const useFilterStore = create<FilterState>((set) => ({
  selections: EMPTY_SELECTIONS,

  measureId: null,
  scaleKind: 'sequential',
  // Quantile reads well on first load. The toggle exists because trusting it
  // without ever seeing equal-interval is being misled by the default — this
  // dataset's long tail is precisely what quantile hides.
  binningMethod: 'quantile',
  binCount: 5,

  zoom: 4,

  unmappedPanelOpen: false,
  siteListRegion: null,
  urlTruncated: [],

  toggleValue: (dimension, value) =>
    set((current) => {
      const existing = current.selections[dimension];
      const next = existing.includes(value)
        ? existing.filter((v) => v !== value)
        : [...existing, value];
      return { selections: withDimension(current.selections, dimension, next) };
    }),

  setValues: (dimension, values) =>
    set((current) => ({
      selections: withDimension(current.selections, dimension, [...values]),
    })),

  addValues: (dimension, values) =>
    set((current) => ({
      selections: withDimension(current.selections, dimension, [
        ...new Set([...current.selections[dimension], ...values]),
      ]),
    })),

  removeValue: (dimension, value) =>
    set((current) => ({
      selections: withDimension(
        current.selections,
        dimension,
        current.selections[dimension].filter((v) => v !== value),
      ),
    })),

  clearDimension: (dimension) =>
    set((current) => ({ selections: withDimension(current.selections, dimension, []) })),

  restoreOrphan: (restore) =>
    set((current) => {
      let selections = current.selections;
      // Widen every blocking upstream filter in one update, so restore is a
      // single click and a single re-render rather than a visible cascade.
      for (const [dimension, values] of Object.entries(restore)) {
        if (values === undefined) continue;
        const key = dimension as FilterDimension;
        selections = withDimension(selections, key, [
          ...new Set([...selections[key], ...values]),
        ]);
      }
      return { selections };
    }),

  setRange: (key, range) =>
    set((current) => ({
      selections: {
        ...current.selections,
        ranges: { ...current.selections.ranges, [key]: range },
      },
    })),

  clearRange: (key) =>
    set((current) => {
      const ranges = { ...current.selections.ranges };
      delete ranges[key];
      return { selections: { ...current.selections, ranges } };
    }),

  resetAll: () =>
    set({ selections: EMPTY_SELECTIONS, siteListRegion: null, urlTruncated: [] }),

  hydrate: (partial) => set(partial),

  focusState: (state) =>
    set((current) => {
      // Re-focusing the state you are already in is a no-op, so clicking a
      // state twice does not throw away the district you drilled into.
      if (state !== null && current.selections.state.length === 1 && current.selections.state[0] === state) {
        return current;
      }
      return {
        selections: {
          ...current.selections,
          state: state === null ? [] : [state],
          // Drilling into a different state discards the district focus, which
          // belonged to the state being left. Districts are NOT retained here
          // as orphans: this is a navigation action, not a filter edit, and the
          // user is asking to look somewhere else.
          district: [],
        },
        siteListRegion: null,
      };
    }),

  focusDistrict: (district) =>
    set((current) => ({
      selections: withDimension(
        current.selections,
        'district',
        district === null ? [] : [district],
      ),
      siteListRegion: null,
    })),

  navigateTo: (depth) =>
    set((current) => {
      if (depth === 0) {
        return {
          selections: { ...current.selections, state: [], district: [], site: [] },
          siteListRegion: null,
        };
      }
      if (depth === 1) {
        return {
          selections: { ...current.selections, district: [], site: [] },
          siteListRegion: null,
        };
      }
      return current;
    }),

  setMeasure: (measureId) => set({ measureId }),
  setScaleKind: (scaleKind) => set({ scaleKind }),
  setBinningMethod: (binningMethod) => set({ binningMethod }),
  setBinCount: (binCount) => set({ binCount }),
  setZoom: (zoom) => set({ zoom }),

  toggleUnmappedPanel: () =>
    set((current) => ({ unmappedPanelOpen: !current.unmappedPanelOpen })),

  openSiteList: (siteListRegion) => set({ siteListRegion }),
  setUrlTruncated: (urlTruncated) => set({ urlTruncated: [...urlTruncated] }),
}));

/* -------------------------------------------------------------------------- */
/* Derived selectors                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The single state the map is drilled into, or null.
 *
 * Null when zero states are selected (national view) and also when several are
 * — the map cannot "be inside" three states at once, so it stays national and
 * shows all three highlighted.
 */
export function focusedState(selections: FilterSelections): string | null {
  return selections.state.length === 1 ? (selections.state[0] ?? null) : null;
}

/** The single district the map is drilled into, or null. */
export function focusedDistrict(selections: FilterSelections): string | null {
  return selections.district.length === 1 ? (selections.district[0] ?? null) : null;
}

/**
 * Which level the choropleth should paint.
 *
 * District level activates on any state selection OR at
 * {@link DISTRICT_ZOOM_THRESHOLD}. Two triggers because they serve different
 * intents: selecting a state is "show me inside this", while zooming in is
 * "more detail wherever I am looking", and the second must work without
 * committing the user to a filter they did not ask for.
 */
export function levelFor(state: Pick<FilterState, 'selections' | 'zoom'>): MapLevel {
  if (state.selections.state.length > 0) return 'district';
  return state.zoom >= DISTRICT_ZOOM_THRESHOLD ? 'district' : 'state';
}

/** Breadcrumb trail: India › Gujarat › Kutch. */
export function breadcrumbFor(selections: FilterSelections): readonly BreadcrumbStep[] {
  const trail: BreadcrumbStep[] = [{ label: 'India', level: 'country' }];

  const states = selections.state;
  if (states.length === 1) {
    trail.push({ label: states[0]!, level: 'state' });
  } else if (states.length > 1) {
    // Several states selected is a filter, not a location, and the breadcrumb
    // says so rather than picking one arbitrarily.
    trail.push({ label: `${states.length} states`, level: 'state' });
  }

  const districts = selections.district;
  if (states.length > 0 && districts.length === 1) {
    trail.push({ label: districts[0]!, level: 'district' });
  } else if (states.length > 0 && districts.length > 1) {
    trail.push({ label: `${districts.length} districts`, level: 'district' });
  }

  return trail;
}
