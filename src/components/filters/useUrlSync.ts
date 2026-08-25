'use client';

/**
 * Two-way sync between filter state and the address bar.
 *
 * Read once on mount, write debounced thereafter. The debounce matters more
 * than it looks: dragging a range slider fires dozens of updates a second, and
 * an un-debounced `replaceState` per frame is both wasteful and enough to make
 * some browsers throttle the History API entirely.
 *
 * `replaceState`, never `pushState` — a history entry per filter tweak would
 * mean twenty presses of Back to leave the page.
 */

import { useEffect, useRef } from 'react';

import type { BinCount, BinningMethod, ScaleKind } from '@/lib/color';
import { readFromLocation, writeToLocation } from '@/lib/filters';
import { useFilterStore } from '@/store/filters';

/** Debounce for URL writes, in ms. */
export const URL_DEBOUNCE_MS = 300;

const BINNING_METHODS = new Set(['quantile', 'equal-interval', 'jenks']);
const SCALE_KINDS = new Set(['sequential', 'diverging']);
const BIN_COUNTS = new Set([3, 4, 5]);

/**
 * Restore from the URL on mount, then keep the URL in step with the store.
 *
 * Call once, near the top of the client tree.
 */
export function useUrlSync(): void {
  const hydrate = useFilterStore((s) => s.hydrate);
  const setUrlTruncated = useFilterStore((s) => s.setUrlTruncated);

  const selections = useFilterStore((s) => s.selections);
  const measureId = useFilterStore((s) => s.measureId);
  const binningMethod = useFilterStore((s) => s.binningMethod);
  const binCount = useFilterStore((s) => s.binCount);
  const scaleKind = useFilterStore((s) => s.scaleKind);

  const hydrated = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- restore, once ----
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const parsed = readFromLocation();

    // Values from a URL are untrusted input — a hand-edited or stale link can
    // carry anything. Enum-shaped fields are validated against their allowed
    // sets rather than cast, so a bad value falls back to the default instead
    // of putting the store in a state no code path expects.
    hydrate({
      selections: parsed.selections,
      ...(parsed.measureKey !== null && parsed.measureKey.length > 0
        ? { measureId: parsed.measureKey }
        : {}),
      ...(parsed.binningMethod !== null && BINNING_METHODS.has(parsed.binningMethod)
        ? { binningMethod: parsed.binningMethod as BinningMethod }
        : {}),
      ...(parsed.scaleKind !== null && SCALE_KINDS.has(parsed.scaleKind)
        ? { scaleKind: parsed.scaleKind as ScaleKind }
        : {}),
      ...(parsed.binCount !== null && BIN_COUNTS.has(parsed.binCount)
        ? { binCount: parsed.binCount as BinCount }
        : {}),
    });
  }, [hydrate]);

  // ---- write, debounced ----
  useEffect(() => {
    // Skip the write that would otherwise fire immediately after hydration and
    // rewrite the URL the user arrived on.
    if (!hydrated.current) return;

    if (timer.current !== null) clearTimeout(timer.current);

    timer.current = setTimeout(() => {
      const truncated = writeToLocation({
        selections,
        measureKey: measureId,
        binningMethod,
        binCount,
        scaleKind,
      });
      setUrlTruncated(truncated);
    }, URL_DEBOUNCE_MS);

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [selections, measureId, binningMethod, binCount, scaleKind, setUrlTruncated]);
}
