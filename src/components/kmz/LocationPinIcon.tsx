/**
 * The one glyph that means "a surveyed site sits exactly here."
 *
 * Deliberately a single shared component rather than inline SVG duplicated at
 * each call site. It is drawn in two places — the map marker in
 * SurveyedSiteMarkers.tsx and the legend swatch in Legend.tsx that explains
 * what the marker means — and those two must never drift apart. A legend that
 * shows one shape while the map renders a slightly different one silently
 * breaks the promise a legend makes: that what you see described is what you
 * see on the map. One component makes that promise structural instead of a
 * habit two files have to remember to keep up.
 *
 * `fill="currentColor"` on the outer path, so colour is set by the caller via
 * a text-colour class rather than baked in here — the marker and the legend
 * swatch both do this, which is also what keeps them identical rather than
 * merely similar.
 */

export interface LocationPinIconProps {
  readonly className?: string;
}

export function LocationPinIcon({ className }: LocationPinIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {/*
        A teardrop, not a dropped square. The shape itself carries meaning a
        geometric marker doesn't: the point at the bottom IS the coordinate,
        the same convention every map application uses, so a reader never has
        to learn what this app's marker means — they already know.
      */}
      <path
        d="M11.54 22.351l.07.04.028.016a.76.76 0 00.723 0l.028-.015.071-.041a16.975 16.975 0 001.144-.742 19.58 19.58 0 002.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 00-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 002.682 2.282 16.975 16.975 0 001.145.742z"
        fill="currentColor"
        stroke="white"
        strokeWidth="0.75"
      />
      {/* The punched-out centre, so the pin reads instantly rather than as a solid blob. */}
      <circle cx="12" cy="10.2" r="2.4" fill="white" />
    </svg>
  );
}
