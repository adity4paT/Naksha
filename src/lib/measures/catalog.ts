/**
 * Building the measure catalogue from a parsed workbook.
 *
 * Nothing here hardcodes a column name from the sample. Sheet measures come
 * from whatever the profiler inferred as a measure; derived measures are built
 * on the semantic bindings the ingest layer already resolves, so a production
 * file that spells its headers differently still gets all three.
 */

import { bindColumns } from '@/lib/ingest';
import type { ColumnDescriptor, NormalizedKey, ParsedWorkbook } from '@/types/schema';
import { effectiveRole } from '@/types/schema';
import type {
  AggregationStrategy,
  DerivedMeasure,
  MeasureDescriptor,
  MeasureGroup,
  MeasureUnit,
  SheetMeasure,
} from './types';
import { DERIVED_MEASURE_IDS, sheetMeasureId } from './types';

/**
 * Aggregation for a sheet column, from its name.
 *
 * The rule the brief specified: mean for anything ending in `%` or containing
 * "rate", sum otherwise. Both patterns describe *intensive* quantities —
 * figures that are already normalised against something — and adding those up
 * produces a number with no meaning.
 */
export function inferAggregation(normalizedKey: string): AggregationStrategy {
  const key = normalizedKey.toLowerCase().trim();
  if (key.endsWith('%') || key.endsWith('(%)')) return 'mean';
  if (key.includes('rate')) return 'mean';
  if (key.includes('percent')) return 'mean';
  return 'sum';
}

/**
 * Unit for a sheet column, from its name.
 *
 * Separate from aggregation because they do not coincide: `Circle rate` is a
 * mean *and* a currency, while `Utilization percentage(%)` is a mean and a
 * percentage. Collapsing the two would render rupees with a `%` suffix.
 */
export function inferUnit(normalizedKey: string): MeasureUnit {
  const key = normalizedKey.toLowerCase();
  if (key.endsWith('%') || key.endsWith('(%)') || key.includes('percent')) {
    return 'percent';
  }
  if (key.includes('rate') || key.includes('value') || key.includes('cost') || key.includes('price')) {
    return 'currency-inr';
  }
  if (key.includes('acre') || key.includes('acer') || key.includes('area') || key.includes('land')) {
    return 'acre';
  }
  return 'number';
}

/** Turn a measure column into a descriptor. */
function toSheetMeasure(column: ColumnDescriptor): SheetMeasure {
  return {
    kind: 'sheet',
    id: sheetMeasureId(column.normalizedKey),
    label: column.displayLabel.trim(),
    columnKey: column.normalizedKey,
    aggregation: inferAggregation(column.normalizedKey),
    unit: inferUnit(column.normalizedKey),
    isEmpty: column.isEmptyInSample,
    rawHeader: column.name,
  };
}

/** A sheet measure that is populated and looks like a utilisation figure. */
function findUtilisationColumn(sheet: readonly SheetMeasure[]): SheetMeasure | undefined {
  return sheet.find(
    (measure) =>
      /utili[sz]ation/.test(measure.columnKey.toLowerCase()) && !measure.isEmpty,
  );
}

/**
 * Build the full catalogue: sheet measures plus whichever derived ones the
 * bound columns can support.
 */
export function buildMeasureCatalogue(workbook: ParsedWorkbook): {
  readonly measures: readonly MeasureDescriptor[];
  readonly groups: readonly MeasureGroup[];
  readonly defaultId: string | null;
} {
  const sheet = workbook.columns
    .filter((column) => effectiveRole(column) === 'measure')
    .map(toSheetMeasure);

  const binding = bindColumns(workbook.columns);
  const { total, used, forest: _forest, ...rest } = binding.measures;
  void _forest;

  const derived: DerivedMeasure[] = [];

  if (total !== undefined) {
    const utilisationColumn = findUtilisationColumn(sheet);

    if (used !== undefined) {
      derived.push({
        kind: 'derived',
        id: DERIVED_MEASURE_IDS.utilisation,
        // Labelled as calculated even when it is the only source, so a reader
        // never has to work out whether a figure came from the sheet.
        label: 'Utilisation %',
        aggregation: 'ratio',
        unit: 'percent',
        numeratorKeys: [used],
        denominatorKey: total,
        formula: 'Used Land ÷ Total Land Area × 100',
        // The sheet's own column wins when it holds data. Both stay in the
        // picker with distinct labels — CLAUDE.md's spirit throughout is that
        // a stated figure and a computed one are different facts.
        supersededBy: utilisationColumn?.id ?? null,
      });
    }

    const privateKeys = [rest['private-sale'], rest['private-lease']].filter(
      (key): key is NormalizedKey => key !== undefined,
    );

    if (privateKeys.length > 0) {
      derived.push({
        kind: 'derived',
        id: DERIVED_MEASURE_IDS.privateTenure,
        label: 'Private tenure %',
        aggregation: 'ratio',
        unit: 'percent',
        numeratorKeys: privateKeys,
        denominatorKey: total,
        formula: '(Private Sale + Private Lease) ÷ Total Land Area × 100',
        supersededBy: null,
      });
    }

    const govt = rest['govt-revenue'];
    if (govt !== undefined) {
      derived.push({
        kind: 'derived',
        id: DERIVED_MEASURE_IDS.govtTenure,
        label: 'Govt tenure %',
        aggregation: 'ratio',
        unit: 'percent',
        numeratorKeys: [govt],
        denominatorKey: total,
        formula: 'Govt/revenue ÷ Total Land Area × 100',
        supersededBy: null,
      });
    }
  }

  const groups: MeasureGroup[] = [];
  if (sheet.length > 0) groups.push({ label: 'From the sheet', measures: sheet });
  if (derived.length > 0) groups.push({ label: 'Calculated', measures: derived });

  return {
    measures: [...sheet, ...derived],
    groups,
    defaultId: pickDefault(sheet, derived),
  };
}

/**
 * Default selection.
 *
 * Total area first — it is the figure the sheet is fundamentally about, and the
 * one whose choropleth is legible without explanation. Falls back to the first
 * populated sheet measure, then to anything at all.
 *
 * An EMPTY column is never the default. It would paint the entire map as
 * no-data on first load, which reads as a broken app rather than an empty
 * column.
 */
function pickDefault(
  sheet: readonly SheetMeasure[],
  derived: readonly DerivedMeasure[],
): string | null {
  const populated = sheet.filter((measure) => !measure.isEmpty);

  const totalArea = populated.find(
    (measure) =>
      measure.columnKey.includes('total') &&
      (measure.columnKey.includes('area') || measure.columnKey.includes('land')),
  );
  if (totalArea !== undefined) return totalArea.id;

  return populated[0]?.id ?? derived[0]?.id ?? sheet[0]?.id ?? null;
}

/** Look a measure up by id. */
export function findMeasure(
  measures: readonly MeasureDescriptor[],
  id: string | null,
): MeasureDescriptor | null {
  if (id === null) return null;
  return measures.find((measure) => measure.id === id) ?? null;
}
