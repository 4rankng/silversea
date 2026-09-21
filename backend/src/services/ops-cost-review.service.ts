import type { ExpenseActor } from './expense-accounting-write.service';
import { listExpenseAccountingEntries } from './expense-accounting-reads.service';
import { expenseListQuerySchema } from '@tingting/shared';
import type { ExpenseAccountingEntry, ExpenseAccountingList, ExpenseListQuery } from '@tingting/shared';

export const OPS_REVIEW_PROGRESS = ['CHUA_XAC_NHAN', 'DA_XAC_NHAN', 'DA_LAP_PHIEU'] as const;
export type OpsReviewProgress = typeof OPS_REVIEW_PROGRESS[number];

export interface OpsCostReviewQuery {
  from?: string; to?: string; payerId?: number;
  progress?: OpsReviewProgress; page?: number; limit?: number;
}
export interface OpsCostReviewRow extends ExpenseAccountingEntry {
  progress: OpsReviewProgress;
  confirmRef: { sourceKind: 'OPS'; sourceId: number; expectedVersion: number };
}
export interface OpsCostReviewList {
  items: OpsCostReviewRow[];
  total: number; page: number; limit: number;
  totals: ExpenseAccountingList['totals'];
}

/** Card 20260921_10 — the accounting review table over OPS-entered costs.
 *  A thin projection over the EXISTING expense-accounting list (no second
 *  read path): OPS rows + progress classification + confirm refs. The tick
 *  action is the existing batch confirm (confirmRef feeds
 *  expenseConfirmSchema verbatim; tick-all = one POST /confirm), so Ngày-duyệt
 *  and the person who ticked ride confirmedAt/confirmedById — no forked
 *  confirmation path. Tiến độ TT (progress) maps to the confirmed filter when
 *  possible and the reconciliation linkage decides DA_XAC_NHAN vs
 *  DA_LAP_PHIEU. */
export async function listOpsCostReview(actor: ExpenseActor, query: OpsCostReviewQuery): Promise<OpsCostReviewList> {
  const baseQuery = expenseListQuerySchema.parse({
    sourceKind: 'OPS',
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.payerId ? { payerId: query.payerId } : {}),
    ...(query.progress === 'CHUA_XAC_NHAN' ? { confirmed: 'false' }
      : query.progress === 'DA_XAC_NHAN' || query.progress === 'DA_LAP_PHIEU' ? { confirmed: 'true' } : {}),
    page: String(query.page ?? 1),
    limit: String(query.limit ?? 25),
  });
  const list = await listExpenseAccountingEntries(actor, baseQuery);
  const progressOf = (row: ExpenseAccountingEntry): OpsReviewProgress =>
    row.confirmedAt == null ? 'CHUA_XAC_NHAN'
      : row.reconciliationId != null ? 'DA_LAP_PHIEU'
        : 'DA_XAC_NHAN';
  const items = query.progress
    ? list.items.filter((row) => progressOf(row) === query.progress)
    : list.items;
  return {
    items: items.map((row) => ({
      ...row,
      progress: progressOf(row),
      confirmRef: { sourceKind: 'OPS' as const, sourceId: row.sourceId, expectedVersion: row.version },
    })),
    total: list.total,
    page: list.page,
    limit: list.limit,
    totals: list.totals,
  };
}
