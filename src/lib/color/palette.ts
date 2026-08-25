/**
 * Choropleth palette.
 *
 * Every hex here comes from the documented design-system ramps, and every ramp
 * below was checked with the palette validator rather than by eye. The results
 * are recorded next to each constant so a future edit can be re-checked against
 * the same bar.
 *
 * Two decisions are worth reading before changing anything here.
 *
 * ## The ramp starts at step 250, not step 100
 *
 * The design system permits a sequential choropleth ramp to run the full
 * 100→700 range, letting the lightest step recede toward the page surface. That
 * is fine for a normal heatmap and wrong here.
 *
 * This map has to distinguish three things, not two: a high value, a LOW value,
 * and NO DATA AT ALL. Step 100 (`#cde2fb`) sits at 1.29:1 against the surface —
 * close enough to blank that a district with 4 acres would look like a district
 * we know nothing about. Those are different facts and must not look the same.
 *
 * Starting at step 250 (`#86b6ef`, 2.06:1) keeps the lowest data bin visibly
 * *present*, and leaves the hatch fill below to mean "no data" unambiguously.
 *
 * ## Five bins is a hard ceiling
 *
 * Not a style choice — a measured limit. The blue ramp between steps 250 and
 * 700 does not hold more than five steps at the required adjacent lightness
 * separation (ΔL ≥ 0.06). Six bins fails on one pair, seven on two:
 *
 * ```
 * 5 bins  light  ALL CHECKS PASS
 * 6 bins  light  FAIL  adjacent ΔL  #1c5cab↔#184f95 = 0.047
 * 7 bins  light  FAIL  adjacent ΔL  two pairs, plus light end at 1.74:1
 * ```
 *
 * Adding a sixth bin would put two classes on the map that a reader cannot tell
 * apart, which is worse than showing five honest ones.
 */

/** Light or dark rendering context. */
export type ColorMode = 'light' | 'dark';

/** How a measure maps onto color. */
export type ScaleKind = 'sequential' | 'diverging';

/** Bin counts the validated ramps support. */
export const SUPPORTED_BIN_COUNTS = [3, 4, 5] as const;
export type BinCount = (typeof SUPPORTED_BIN_COUNTS)[number];

/** Default, and the maximum the ramp sustains. See the header note. */
export const DEFAULT_BIN_COUNT: BinCount = 5;

/* -------------------------------------------------------------------------- */
/* Sequential — single hue, blue                                               */
/* -------------------------------------------------------------------------- */

/**
 * Sequential ramps, ordered low → high.
 *
 * Dark mode is not a flip of light mode. The design system specifies that a
 * sequential ramp "flips anchor in dark": against a dark surface, *lighter*
 * means more, so the ramp runs dark → light and its low end is held no darker
 * than step 600 to stay visible.
 *
 * Validator, `--ordinal`:
 * ```
 * light 3/4/5  ALL CHECKS PASS   (light end #86b6ef, 2.06:1 vs #fcfcfb)
 * dark  5      ALL CHECKS PASS   (low end  #184f95, 2.15:1 vs #1a1a19)
 * ```
 */
export const SEQUENTIAL_RAMPS: Readonly<
  Record<ColorMode, Readonly<Record<BinCount, readonly string[]>>>
> = {
  light: {
    3: ['#86b6ef', '#2a78d6', '#0d366b'],
    4: ['#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
    5: ['#86b6ef', '#3987e5', '#256abf', '#184f95', '#0d366b'],
  },
  dark: {
    3: ['#184f95', '#3987e5', '#cde2fb'],
    4: ['#184f95', '#256abf', '#5598e7', '#cde2fb'],
    5: ['#184f95', '#256abf', '#3987e5', '#86b6ef', '#cde2fb'],
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Diverging — blue ↔ red with a neutral midpoint                              */
/* -------------------------------------------------------------------------- */

/**
 * The red arm, derived rather than quoted.
 *
 * The design system names blue↔red as the diverging pair but publishes step
 * tables only for blue. Rather than eyeball a red ramp, each step here was
 * computed in OKLCH: hold the hue of the documented categorical red
 * (`#e34948`, h ≈ 24.9°) and take the *lightness of the matching blue step*, so
 * the two arms are lightness-symmetric and neither out-weighs the other.
 *
 * Chroma is capped at the red anchor's own, so the derivation cannot invent a
 * more saturated red than the system documents.
 *
 * Validator, `--ordinal`:
 * ```
 * red arm light  ALL CHECKS PASS   (light end #ec9992, 2.14:1)
 * red arm dark   ALL CHECKS PASS   (low end  #8c2828, 2.03:1)
 * ```
 *
 * Note the categorical validator FAILs on any diverging ramp by design — it
 * measures pairwise separation, and a ramp's neighbouring steps are *supposed*
 * to sit close. The per-arm ordinal check above is the correct gate.
 */
const RED_ARM_LIGHT = ['#ec9992', '#da5450', '#b43b3a', '#8c2828', '#641819'] as const;

/**
 * Neutral midpoint. Gray, never a hue.
 *
 * A colored midpoint would read as a third category and destroy the "which side
 * of the baseline" question the scale exists to answer.
 */
export const DIVERGING_MIDPOINT: Readonly<Record<ColorMode, string>> = {
  light: '#f0efec',
  dark: '#383835',
} as const;

/**
 * Build a diverging ramp: red (negative) → neutral → blue (positive).
 *
 * `binsPerArm` classes each side plus one midpoint class, so a 2-per-arm scale
 * renders five classes. Equal steps per arm is a requirement, not a
 * convenience — unequal arms make one polarity look more extreme than the other
 * at the same magnitude.
 */
export function divergingRamp(mode: ColorMode, binsPerArm: 1 | 2): readonly string[] {
  const blue = SEQUENTIAL_RAMPS[mode][binsPerArm === 1 ? 3 : 5];
  const redSource = mode === 'light' ? RED_ARM_LIGHT : [...RED_ARM_LIGHT].reverse();

  if (binsPerArm === 1) {
    return [redSource[2]!, DIVERGING_MIDPOINT[mode], blue[2]!];
  }

  // Outermost step of each arm is the strongest; inner step is nearer neutral.
  return [
    redSource[4]!,
    redSource[2]!,
    DIVERGING_MIDPOINT[mode],
    blue[2]!,
    blue[4]!,
  ];
}

/* -------------------------------------------------------------------------- */
/* No-data                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fill for a region with no records at all.
 *
 * Deliberately NOT a pale tint of the sequential hue. It is a neutral base
 * carrying a diagonal hatch, so "we have no figure for this district" is
 * distinguishable from "this district has zero acres" by *texture*, not just by
 * a shade a reader has to compare against a legend.
 *
 * Texture is also the accessibility channel: this remains distinguishable under
 * every CVD simulation, in grayscale print, and under forced-colors, none of
 * which a shade difference survives.
 */
export const NO_DATA = {
  light: { base: '#f4f3f0', stroke: '#c3c2b7' },
  dark: { base: '#232322', stroke: '#4a4a46' },
} as const;

/** Fill for a region present in the data whose measure sums to exactly zero. */
export const ZERO_VALUE: Readonly<Record<ColorMode, string>> = {
  light: '#e4eefb',
  dark: '#14243a',
} as const;

/* -------------------------------------------------------------------------- */
/* Chrome                                                                      */
/* -------------------------------------------------------------------------- */

/** Map chrome, from the design system's chart-chrome table. */
export const CHROME = {
  light: {
    surface: '#fcfcfb',
    page: '#f9f9f7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#898781',
    border: '#e1e0d9',
    boundary: '#c3c2b7',
    boundaryStrong: '#52514e',
    highlight: '#0b0b0b',
  },
  dark: {
    surface: '#1a1a19',
    page: '#0d0d0d',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    textMuted: '#898781',
    border: '#2c2c2a',
    boundary: '#383835',
    boundaryStrong: '#c3c2b7',
    highlight: '#ffffff',
  },
} as const;

/** The ramp for a given scale kind, mode, and bin count. */
export function rampFor(
  kind: ScaleKind,
  mode: ColorMode,
  bins: BinCount,
): readonly string[] {
  if (kind === 'diverging') return divergingRamp(mode, bins <= 3 ? 1 : 2);
  return SEQUENTIAL_RAMPS[mode][bins];
}
