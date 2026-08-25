/**
 * Sheet selection and header-row detection.
 *
 * Neither is assumed. The sample happens to keep its data on `Sheet2` with the
 * header on row 1, but a production MIS will not reliably do either — a cover
 * sheet, a title row above the header, or a renamed tab are all ordinary. Both
 * decisions are therefore detected, reported, and overridable.
 */

import {
  HEADER_CORROBORATION_MIN_TYPES,
  HEADER_LOOKAHEAD_ROWS,
  HEADER_SEARCH_MAX_ROWS,
  HEADER_STRING_DENSITY_THRESHOLD,
} from '@/lib/constants';
import type { CellPrimitiveType, HeaderDetection, SheetCandidate } from '@/types/schema';
import { cleanString } from './normalize';
import { cleanCell, primitiveTypeOf } from './values';

/** A sheet as a dense row-major matrix. Ragged rows are permitted. */
export type SheetMatrix = readonly (readonly unknown[])[];

/** Width of the widest row — the sheet's effective column count. */
export function matrixWidth(matrix: SheetMatrix): number {
  return matrix.reduce((widest, row) => Math.max(widest, row.length), 0);
}

/** Cells in the matrix that hold a value after cleaning. */
export function countPopulatedCells(matrix: SheetMatrix): number {
  let count = 0;
  for (const row of matrix) {
    for (const cell of row) {
      if (cleanCell(cell) !== null) count += 1;
    }
  }
  return count;
}

/**
 * Score every sheet and pick the one with the most populated cells.
 *
 * Density beats name-matching because a name can be anything, whereas the data
 * sheet is almost always the biggest thing in the file. The weakness is real
 * and worth stating: a workbook whose summary tab is denser than its data tab
 * will be scored wrong. That is precisely why the full scored list is returned
 * rather than just the winner — the UI must offer a picker, and the scores are
 * what let a user see why the parser chose as it did.
 *
 * Ties break toward the earlier sheet, matching Excel's own tab order.
 *
 * @param preferredSheet A user override. Selected unconditionally when it names
 *   a real sheet, regardless of score.
 */
export function selectSheet(
  matricesByName: ReadonlyMap<string, SheetMatrix>,
  preferredSheet?: string,
): readonly SheetCandidate[] {
  const scored = [...matricesByName.entries()].map(([name, matrix]) => ({
    name,
    populatedCellCount: countPopulatedCells(matrix),
    rowCount: matrix.length,
    columnCount: matrixWidth(matrix),
    headerRowIndex: detectHeaderRow(matrix).rowIndex,
  }));

  const override =
    preferredSheet !== undefined
      ? scored.find((candidate) => candidate.name === preferredSheet)
      : undefined;

  const best = scored.reduce<(typeof scored)[number] | undefined>(
    (winner, candidate) =>
      winner === undefined || candidate.populatedCellCount > winner.populatedCellCount
        ? candidate
        : winner,
    undefined,
  );

  const chosen = override ?? best;

  return scored.map((candidate) => ({
    ...candidate,
    headerRowIndex: candidate.populatedCellCount === 0 ? null : candidate.headerRowIndex,
    selected: candidate.name === chosen?.name,
  }));
}

/** Distinct primitive types among a row's populated cells. */
function rowTypes(row: readonly unknown[]): CellPrimitiveType[] {
  const seen = new Set<CellPrimitiveType>();
  for (const cell of row) {
    const type = primitiveTypeOf(cleanCell(cell));
    if (type !== null) seen.add(type);
  }
  return [...seen];
}

/** Share of a row's cells, across the sheet's full width, that are non-empty strings. */
function stringDensity(row: readonly unknown[], width: number): number {
  if (width === 0) return 0;
  let strings = 0;
  for (const cell of row) {
    if (typeof cell === 'string' && cleanString(cell) !== null) strings += 1;
  }
  return strings / width;
}

/**
 * Locate the header row.
 *
 * A row qualifies when more than {@link HEADER_STRING_DENSITY_THRESHOLD} of its
 * cells are non-empty strings AND the row below shows at least
 * {@link HEADER_CORROBORATION_MIN_TYPES} distinct types.
 *
 * The second condition carries most of the weight. String density alone would
 * match a title row, a merged banner, or a second row of column sub-labels just
 * as readily as the real header. Requiring the row below to be *mixed* is what
 * distinguishes "labels above data" from "labels above more labels" — a data
 * row under a real header nearly always mixes text dimensions with numeric
 * measures, as the sample's does.
 *
 * Density is measured against the sheet's full width, not the row's own length,
 * so trailing empty cells count against a candidate. The sample's header scores
 * 27/29 = 93%, well clear of the 70% floor even with its two blank trailing cells.
 *
 * When nothing qualifies — a single-row sheet, or one whose columns are entirely
 * uniform in type — this falls back to the first populated row and sets
 * `usedFallback`. Falling back beats refusing to parse, but the flag must reach
 * the UI so the user can correct it, because every column in the file is wrong
 * if this is wrong.
 */
export function detectHeaderRow(matrix: SheetMatrix): HeaderDetection {
  const width = matrixWidth(matrix);
  const searchLimit = Math.min(matrix.length, HEADER_SEARCH_MAX_ROWS);

  for (let rowIndex = 0; rowIndex < searchLimit; rowIndex += 1) {
    const row = matrix[rowIndex];
    if (row === undefined) continue;

    const density = stringDensity(row, width);
    if (density <= HEADER_STRING_DENSITY_THRESHOLD) continue;

    for (let offset = 1; offset <= HEADER_LOOKAHEAD_ROWS; offset += 1) {
      const below = matrix[rowIndex + offset];
      if (below === undefined) break;

      const types = rowTypes(below);
      if (types.length >= HEADER_CORROBORATION_MIN_TYPES) {
        return {
          rowIndex,
          stringDensity: density,
          rowBelowTypes: types,
          usedFallback: false,
        };
      }
    }
  }

  const firstPopulated = matrix.findIndex((row) =>
    row.some((cell) => cleanCell(cell) !== null),
  );
  const fallbackIndex = firstPopulated === -1 ? 0 : firstPopulated;
  const fallbackRow = matrix[fallbackIndex];
  const below = matrix[fallbackIndex + 1];

  return {
    rowIndex: fallbackIndex,
    stringDensity: fallbackRow === undefined ? 0 : stringDensity(fallbackRow, width),
    rowBelowTypes: below === undefined ? [] : rowTypes(below),
    usedFallback: true,
  };
}
