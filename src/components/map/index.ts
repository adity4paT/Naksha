/**
 * Public entry point for the map view.
 *
 * MapView is a client component that pulls in MapLibre GL, which touches
 * `window` at import time. Consumers should load it with `next/dynamic` and
 * `ssr: false` rather than importing it into a server component.
 */

export { MapView } from './MapView';
export type { MapViewProps } from './MapView';

export { Legend } from './Legend';
export type { LegendProps } from './Legend';

export { Breadcrumb } from './Breadcrumb';
export type { BreadcrumbProps } from './Breadcrumb';

export { UnmappedPanel } from './UnmappedPanel';
export type { UnmappedPanelProps } from './UnmappedPanel';

export { describeRegion, RegionKeyboardList, RegionTooltip } from './RegionTooltip';
export type { RegionTooltipProps, TooltipDatum } from './RegionTooltip';

export { buildLayers, LAYER_IDS, SOURCES } from './layers';
export type { LayerBuildContext, RegisteredLayer } from './layers';

export { SiteBadges } from './SiteBadges';
export type { SiteBadgesProps } from './SiteBadges';

export { MapDashboard } from './MapDashboard';
export type { MapDashboardProps } from './MapDashboard';

export { MeasurePicker } from './MeasurePicker';
export type { MeasurePickerProps } from './MeasurePicker';
