import type { ExpenseActor } from './expense-accounting-write.service';
import { listExpenseAccountingEntries } from './expense-accounting-reads.service';
import { expenseListQuerySchema } from '@tingting/shared';
import type { CostReviewList, CostReviewRow, CostReviewTotals, ExpenseAccountingEntry, ExpenseReviewProgress } from '@tingting/shared';

export type CostReviewProgress = ExpenseReviewProgress;

/** Same classification law as ops-cost-review (card 20260921_10): the tick
 *  actions ride the EXISTING batch confirm — no forked confirmation path. */
export function costReviewProgressOf(row: Pick<ExpenseAccountingEntry, 'confirmedAt' | 'reconciliationId'>): CostReviewProgress {
  return row.confirmedAt == null ? 'CHUA_XAC_NHAN'
    : row.reconciliationId != null ? 'DA_LAP_PHIEU'
      : 'DA_XAC_NHAN';
}

/** Duplicate-cluster key: one lot + one normalized fee name + one amount. */
export function costReviewDuplicateKey(row: Pick<ExpenseAccountingEntry, 'shipmentId' | 'feeName' | 'amount'>): string {
  return `${row.shipmentId}|${row.feeName.trim().toLocaleLowerCase('vi')}|${row.amount}`;
}

export function costReviewClusterCounts(rows: ReadonlyArray<Pick<ExpenseAccountingEntry, 'shipmentId' | 'feeName' | 'amount'>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = costReviewDuplicateKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function costReviewTotals(rows: ReadonlyArray<CostReviewRow>): CostReviewTotals {
  let unconfirmedAmount = 0; let confirmedAmount = 0; let unconfirmedCount = 0; let duplicateRows = 0;
  for (const row of rows) {
    if (row.confirmedAt == null) { unconfirmedAmount += row.amount; unconfirmedCount += 1; }
    else confirmedAmount += row.amount;
    if (row.duplicateCount > 1) duplicateRows += 1;
  }
  return { unconfirmedAmount, confirmedAmount, unconfirmedCount, duplicateRows };
}

/** SIL-779 — the centralized cost reconciliation table (finance-only): rows
 *  from EVERY department-entered source (OPS khai, lái xe khai, chi phí
 *  chuyến) grouped for the accountant's chống-trùng-lặp review, with the same
 *  confirmRef contract as ops-cost-review so [Xác nhận chi phí] posts the
 *  EXISTING batch /confirm. Thin projection over the EXISTING
 *  expense-accounting list — no second read path. INVOICE rows are excluded:
 *  they mirror the billing document and are owned by invoice-tracking, not by
 *  a department's cost claim. The loader already drops VOIDED rows.
 *
 *  Honest scope limits (same as the ops-review projection): progress
 *  filtering and the INVOICE exclusion run over the loaded page, so a page
 *  can come back smaller than `limit`; duplicate clusters are computed within
 *  the loaded rows, so the flag points at duplicates visible in the current
 *  window — the accountant reviews per period/lô, which is the intended
 *  workflow. */
export async function listCostReconciliation(actor: ExpenseActor, query: {
  from?: string; to?: string; payerId?: number; shipmentId?: number; search?: string;
  progress?: CostReviewProgress; page?: number; limit?: number;
}): Promise<CostReviewList> {
  const baseQuery = expenseListQuerySchema.parse({
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.payerId ? { payerId: query.payerId } : {}),
    ...(query.shipmentId ? { shipmentId: query.shipmentId } : {}),
    ...(query.search ? { search: query.search } : {}),
    ...(query.progress === 'CHUA_XAC_NHAN' ? { confirmed: 'false' }
      : query.progress === 'DA_XAC_NHAN' || query.progress === 'DA_LAP_PHIEU' ? { confirmed: 'true' } : {}),
    page: String(query.page ?? 1),
    limit: String(query.limit ?? 25),
  });
  const list = await listExpenseAccountingEntries(actor, baseQuery);
  const items = list.items.filter((row) => row.sourceKind !== 'INVOICE');
  const scoped = query.progress
    ? items.filter((row) => costReviewProgressOf(row) === query.progress)
    : items;
  const clusters = costReviewClusterCounts(items);
  const reviewRows: CostReviewRow[] = scoped.map((row) => ({
    ...row,
    progress: costReviewProgressOf(row),
    confirmRef: { sourceKind: row.sourceKind, sourceId: row.sourceId, expectedVersion: row.version },
    duplicateCount: clusters.get(costReviewDuplicateKey(row)) ?? 1,
  }));
  return {
    items: reviewRows,
    total: list.total,
    page: list.page,
    limit: list.limit,
    totals: costReviewTotals(reviewRows),
  };
}
