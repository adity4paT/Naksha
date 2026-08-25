/**
 * Levenshtein distance and the similarity ratio the fuzzy stage thresholds on.
 *
 * Two-row dynamic programming: O(n·m) time, O(min(n,m)) space. The resolver
 * compares one name against at most the districts of a single state — 76 in the
 * worst case, Uttar Pradesh — so this is never hot enough to warrant anything
 * cleverer.
 */

/**
 * Edit distance between two strings.
 *
 * Counts single-character insertions, deletions, and substitutions. Not
 * Damerau — a transposition costs 2, not 1. That is the conservative choice
 * here, and it is load-bearing: `'Mutksar'` → `'Muktsar'` is a pure
 * transposition, and scoring it as distance 2 keeps it *below* the fuzzy
 * threshold so it must be handled by an explicit, reviewable alias rather than
 * being silently guessed at. Transposition typos are exactly the class where a
 * confident wrong guess is most plausible.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Iterate over the shorter string to keep the row small.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];

  let previous = new Array<number>(short.length + 1);
  let current = new Array<number>(short.length + 1);

  for (let i = 0; i <= short.length; i += 1) previous[i] = i;

  for (let j = 1; j <= long.length; j += 1) {
    current[0] = j;
    const longChar = long.charCodeAt(j - 1);

    for (let i = 1; i <= short.length; i += 1) {
      const cost = short.charCodeAt(i - 1) === longChar ? 0 : 1;
      const deletion = (previous[i] ?? 0) + 1;
      const insertion = (current[i - 1] ?? 0) + 1;
      const substitution = (previous[i - 1] ?? 0) + cost;
      current[i] = Math.min(deletion, insertion, substitution);
    }

    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[short.length] ?? 0;
}

/**
 * Similarity in `[0, 1]`: `1 - distance / maxLength`.
 *
 * 1 means identical, 0 means nothing in common. The resolver's stage-3
 * threshold is expressed against this.
 *
 * Dividing by the longer length is what makes the ratio length-aware, and that
 * matters for short names. One wrong letter in `'Goa'` scores 0.67 and is
 * rejected; one wrong letter in `'Visakhapatnam'` scores 0.92 and is accepted.
 * That asymmetry is correct — a single edit is a much larger share of a short
 * name, and short names have many more plausible near-neighbours.
 */
export function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}
