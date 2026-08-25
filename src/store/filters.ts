/**
 * Filter and view state.
 *
 * The map and the filter controls are two views of this one store, which is
 * what makes them bidirectionally synced: clicking Gujarat on the map and
 * choosing Gujarat from a dropdown are the same action because both call
 * {@link FilterState.selectState}. Neither component holds selection state of
 * its own, so they cannot disagree.
 *
 * The map still owns genuinely cartographic state — current zoom, camera
 * position mid-flight — because that is a property of the viewport, not of the
 * user's filter. The one place the two meet is {@link FilterState.zoom}, which
 * the map pushes into the store so the district-level auto-activation rule can
 * be evaluated in one place.
 */

import { create } from 'zustand';

import type { BinningMethod } from '@/lib/color';
import type { BinCount, ScaleKind } from '@/lib/color';
import type { NormalizedKey } from '@/types/schema';

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
  /* ---- selection ---- */
  /** Canonical state name, or null for the whole country. */
  readonly selectedState: string | null;
  /** Canonical district name. Only meaningful with a state selected. */
  readonly selectedDistrict: string | null;

  /* ---- measure & scale ---- */
  /** Discovered column driving the choropleth. Null until a workbook loads. */
  readonly measureKey: NormalizedKey | null;
  readonly scaleKind: ScaleKind;
  readonly binningMethod: BinningMethod;
  readonly binCount: BinCount;

  /* ---- viewport ---- */
  readonly zoom: number;

  /* ---- panels ---- */
  /** Unmapped panel starts collapsed but is never removed. */
  readonly unmappedPanelOpen: boolean;
  /** Region whose site list is open in the side panel. */
  readonly siteListRegion: string | null;

  /* ---- actions ---- */
  selectState: (state: string | null) => void;
  selectDistrict: (district: string | null) => void;
  clearSelection: () => void;
  /** Jump to a breadcrumb depth: 0 = India, 1 = state, 2 = district. */
  navigateTo: (depth: 0 | 1 | 2) => void;
  setMeasure: (key: NormalizedKey) => void;
  setScaleKind: (kind: ScaleKind) => void;
  setBinningMethod: (method: BinningMethod) => void;
  setBinCount: (count: BinCount) => void;
  setZoom: (zoom: number) => void;
  toggleUnmappedPanel: () => void;
  openSiteList: (region: string | null) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  selectedState: null,
  selectedDistrict: null,

  measureKey: null,
  scaleKind: 'sequential',
  // Quantile reads well on first load. The toggle exists because trusting it
  // without ever seeing equal-interval is being misled by the default — this
  // dataset's long tail is precisely what quantile hides.
  binningMethod: 'quantile',
  binCount: 5,

  zoom: 4,

  unmappedPanelOpen: false,
  siteListRegion: null,

  selectState: (state) =>
    set((current) =>
      // Re-selecting the same state is a no-op rather than a reset. Clicking a
      // state you are already inside should not throw away your district.
      current.selectedState === state
        ? current
        : { selectedState: state, selectedDistrict: null, siteListRegion: null },
    ),

  selectDistrict: (district) => set({ selectedDistrict: district, siteListRegion: null }),

  clearSelection: () =>
    set({ selectedState: null, selectedDistrict: null, siteListRegion: null }),

  navigateTo: (depth) =>
    set((current) => {
      if (depth === 0) {
        return { selectedState: null, selectedDistrict: null, siteListRegion: null };
      }
      if (depth === 1) return { selectedDistrict: null, siteListRegion: null };
      return current;
    }),

  setMeasure: (measureKey) => set({ measureKey }),
  setScaleKind: (scaleKind) => set({ scaleKind }),
  setBinningMethod: (binningMethod) => set({ binningMethod }),
  setBinCount: (binCount) => set({ binCount }),
  setZoom: (zoom) => set({ zoom }),

  toggleUnmappedPanel: () =>
    set((current) => ({ unmappedPanelOpen: !current.unmappedPanelOpen })),

  openSiteList: (siteListRegion) => set({ siteListRegion }),
}));

/* -------------------------------------------------------------------------- */
/* Derived selectors                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Which level the choropleth should paint.
 *
 * District level activates on an explicit state selection OR at
 * {@link DISTRICT_ZOOM_THRESHOLD}. Two triggers because they serve different
 * intents: clicking a state is "show me inside this", while zooming in is
 * "I want more detail wherever I am looking", and the second must work without
 * committing the user to a filter they did not ask for.
 */
export function levelFor(state: Pick<FilterState, 'selectedState' | 'zoom'>): MapLevel {
  if (state.selectedState !== null) return 'district';
  return state.zoom >= DISTRICT_ZOOM_THRESHOLD ? 'district' : 'state';
}

/** Breadcrumb trail: India › Gujarat › Kutch. */
export function breadcrumbFor(
  state: Pick<FilterState, 'selectedState' | 'selectedDistrict'>,
): readonly BreadcrumbStep[] {
  const trail: BreadcrumbStep[] = [{ label: 'India', level: 'country' }];
  if (state.selectedState !== null) {
    trail.push({ label: state.selectedState, level: 'state' });
  }
  if (state.selectedDistrict !== null && state.selectedState !== null) {
    trail.push({ label: state.selectedDistrict, level: 'district' });
  }
  return trail;
}
