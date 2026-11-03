/**
 * Pure selection law for the fixed-price (TABLE) pricing lookup — db-free so
 * the unit tree pins it (freight-lot-basis precedent). SIL-676.
 *
 * Selector law:
 *  - an EXPLICIT containerTypeId / rateKey ask resolves its exact bucket only;
 *    a miss stays MANUAL — never a cross-class guess (S676-R2);
 *  - a selector-LESS caller resolves the general row when one exists, else the
 *    lane's HEAD row (latest effectiveDate, lowest id on that date = the admin
 *    sheet's first class) so keyed-only lanes resolve their configured price
 *    instead of 0 (S676-R1 — restores the pre-6cee01b1f base-row behavior,
 *    deterministically).
 *
 * Class buckets keep the supersede order the SQL used to provide (latest
 * effectiveDate first, highest id breaks a date tie — the newest revision of
 * that selector wins); only the head-row lane keeps id ASCENDING so the tie
 * resolves to the sheet's first-entered class.
 */
export interface TablePricingRowShape {
  id: number;
  containerTypeId: number | null;
  rateKey: string | null;
  effectiveDate: string;
}

export interface TablePricingLaneBuckets<Row extends TablePricingRowShape> {
  /** Rows matching the requested containerTypeId — latest revision first. */
  container: Row[];
  /** Rows matching the requested rate key — latest revision first. */
  rateKey: Row[];
  /** Selector-free rows (both axes null) — latest revision first. */
  general: Row[];
  /** Every active lane row in head-row order (date desc, id asc). */
  laneHeadOrder: Row[];
}

export type TablePricingSource = 'CONTAINER' | 'RATE_KEY' | 'GENERAL' | 'LANE_HEAD';

export interface TablePricingSelection<Row extends TablePricingRowShape> {
  row: Row | null;
  source: TablePricingSource | null;
}

const byLatestRevision = (a: TablePricingRowShape, b: TablePricingRowShape): number =>
  a.effectiveDate === b.effectiveDate
    ? b.id - a.id
    : a.effectiveDate < b.effectiveDate ? 1 : -1;

const byHeadRow = (a: TablePricingRowShape, b: TablePricingRowShape): number =>
  a.effectiveDate === b.effectiveDate
    ? a.id - b.id
    : a.effectiveDate < b.effectiveDate ? 1 : -1;

/** Partition one lane's active rows into the selector buckets (pure). */
export function partitionTablePricingLane<Row extends TablePricingRowShape>(
  rows: readonly Row[],
  requestedContainerTypeId: number | null,
  requestedRateKey: string | null,
): TablePricingLaneBuckets<Row> {
  const container: Row[] = [];
  const rateKey: Row[] = [];
  const general: Row[] = [];
  for (const row of rows) {
    if (row.containerTypeId != null) {
      if (requestedContainerTypeId != null && row.containerTypeId === requestedContainerTypeId) container.push(row);
    } else if (row.rateKey != null) {
      if (requestedRateKey != null && row.rateKey === requestedRateKey) rateKey.push(row);
    } else {
      general.push(row);
    }
  }
  container.sort(byLatestRevision);
  rateKey.sort(byLatestRevision);
  general.sort(byLatestRevision);
  return { container, rateKey, general, laneHeadOrder: [...rows].sort(byHeadRow) };
}

export function pickTablePricingRow<Row extends TablePricingRowShape>(
  buckets: TablePricingLaneBuckets<Row>,
  requested: { containerTypeId: number | null; pricingRateKey: string | null },
): TablePricingSelection<Row> {
  if (requested.containerTypeId != null) {
    const row = buckets.container[0];
    return row ? { row, source: 'CONTAINER' } : { row: null, source: null };
  }
  if (requested.pricingRateKey != null) {
    const row = buckets.rateKey[0];
    return row ? { row, source: 'RATE_KEY' } : { row: null, source: null };
  }
  const general = buckets.general[0];
  if (general) return { row: general, source: 'GENERAL' };
  const head = buckets.laneHeadOrder[0];
  return head ? { row: head, source: 'LANE_HEAD' } : { row: null, source: null };
}
