import { inArray } from 'drizzle-orm';
import type { ExpenseActor } from './expense-accounting-write.service';
import { listExpenseAccountingEntries } from './expense-accounting-reads.service';
import { expenseListQuerySchema } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
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

/**
 * 18/11 ticket 3.3 — the reconciliation table shows LIVE cost claims only.
 * Predicate over the two status fields that mark canceled/history rows
 * (verified against the write paths):
 * - `expenseAccountingSources.status` is the expense-accounting registry
 *   authority: 'RECORDED' (live) | 'VOIDED' (canceled/history). Every cancel
 *   path voids the registry link in the same transaction that cancels the
 *   native row (ops-expenses void, the reject twin, phoi-phieu control,
 *   corrections), and the list loader's filterExpenseEntries already drops
 *   `status !== 'RECORDED'` — restated here so this screen's contract does
 *   not depend on the loader's internals.
 * - Native owner rows hydrate with `approvalStatus`
 *   ('DRAFT'|'RECORDED'|'VOIDED'|'PENDING'|'APPROVED'|'REJECTED' on
 *   ops_expense_entries). A canceled ('VOIDED'/'REJECTED') native row whose
 *   registry link ever drifted back to RECORDED must not surface, so the
 *   native status must sit in the same live set the loader's OPS and TRIP
 *   fallback queries pin ({RECORDED, APPROVED}). Rows without a native
 *   approvalStatus (legacy fallback projections, INVOICE mirrors) pass on
 *   the registry status alone.
 */
const LIVE_NATIVE_APPROVAL_STATUSES: readonly string[] = ['RECORDED', 'APPROVED'];
export function costRowIsLive(row: Pick<ExpenseAccountingEntry, 'status'>): boolean {
  if (row.status !== 'RECORDED') return false;
  // Hydration spreads the native owner row (ops_expense_entries), which
  // carries approvalStatus even though the books projection's interface does
  // not declare it — narrow instead of casting.
  if (!('approvalStatus' in row) || typeof row.approvalStatus !== 'string') return true;
  return LIVE_NATIVE_APPROVAL_STATUSES.includes(row.approvalStatus);
}

/**
 * 18/11 ticket 3.3 — display-only enrichment the books projection does not
 * carry. The cost rows, their amounts and their confirmation facts still come
 * solely from the EXISTING expense-accounting list (no second read path for
 * money); these four columns are lot/fee-class attributes joined per page:
 * - factoryName: the lot's nhà máy (shipments.factory_name).
 * - declarationNumber: số tờ khai, per-container entry (card 261013200312 —
 *   shipment_containers.declaration_number is the CUS operational truth). A
 *   container-scoped row shows its container's number; a lot-scoped row shows
 *   the single lot declaration when all containers agree, else the distinct
 *   list.
 * - reconciliationCode: số phiếu quyết toán (expense_reconciliations.code)
 *   when the row is settled into one — the same linkage that flips progress
 *   to DA_LAP_PHIEU.
 * - noInvoice: phí không hóa đơn — the fee class is catalog-marked
 *   requires_invoice = false (forwarder_expense_types; the OPS entry dialog
 *   writes the flag from the tab the row was saved on). Missing catalog row
 *   keeps the flag false: the 'X' marker only asserts what the catalog says.
 */
/** The row shape before enrichment fills the four display columns in. */
type CostReviewBaseRow = Omit<CostReviewRow, 'factoryName' | 'declarationNumber' | 'reconciliationCode' | 'noInvoice'>;
async function enrichCostReviewRows(items: CostReviewBaseRow[]): Promise<CostReviewRow[]> {
  if (items.length === 0) return [];
  const shipmentIds = [...new Set(items.map(row => row.shipmentId))];
  const typeCodes = [...new Set(items.map(row => row.expenseTypeCode))];
  const reconciliationIds = [...new Set(items.map(row => row.reconciliationId).filter((id): id is number => id != null))];
  const [factoryRows, containerRows, typeRows, reconciliationRows] = await Promise.all([
    db.select({ id: s.shipments.id, factoryName: s.shipments.factoryName }).from(s.shipments).where(inArray(s.shipments.id, shipmentIds)),
    db.select({ id: s.shipmentContainers.id, shipmentId: s.shipmentContainers.shipmentId, declarationNumber: s.shipmentContainers.declarationNumber })
      .from(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds)),
    db.select({ code: s.forwarderExpenseTypes.code, requiresInvoice: s.forwarderExpenseTypes.requiresInvoice })
      .from(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.code, typeCodes)),
    reconciliationIds.length
      ? db.select({ id: s.expenseReconciliations.id, code: s.expenseReconciliations.code }).from(s.expenseReconciliations).where(inArray(s.expenseReconciliations.id, reconciliationIds))
      : Promise.resolve([] as Array<{ id: number; code: string }>),
  ]);
  const declarationOf = (row: CostReviewBaseRow): string | null => {
    const lotNumbers = [...new Set(containerRows.filter(container => container.shipmentId === row.shipmentId)
      .map(container => container.declarationNumber?.trim()).filter((value): value is string => Boolean(value)))];
    const scoped = row.shipmentContainerId != null
      ? containerRows.find(container => container.id === row.shipmentContainerId)?.declarationNumber?.trim()
      : undefined;
    const value = scoped || (lotNumbers.length === 1 ? lotNumbers[0] : lotNumbers.join(', '));
    return value || null;
  };
  return items.map((row) => ({
    ...row,
    factoryName: factoryRows.find(factory => factory.id === row.shipmentId)?.factoryName?.trim() || null,
    declarationNumber: declarationOf(row),
    reconciliationCode: row.reconciliationId != null
      ? reconciliationRows.find(reconciliation => reconciliation.id === row.reconciliationId)?.code ?? null
      : null,
    noInvoice: typeRows.find(type => type.code === row.expenseTypeCode)?.requiresInvoice === false,
  }));
}

/** SIL-779 — the centralized cost reconciliation table (finance-only): rows
 *  from EVERY department-entered source (OPS khai, lái xe khai, chi phí
 *  chuyến) grouped for the accountant's chống-trùng-lặp review, with the same
 *  confirmRef contract as ops-cost-review so [Xác nhận chi phí] posts the
 *  EXISTING batch /confirm. Thin projection over the EXISTING
 *  expense-accounting list — no second read path for the money. INVOICE rows
 *  are excluded: they mirror the billing document and are owned by
 *  invoice-tracking, not by a department's cost claim. Canceled/voided/history
 *  rows are excluded by costRowIsLive (see its predicate documentation).
 *
 *  Honest scope limits (same as the ops-review projection): progress
 *  filtering, the INVOICE exclusion and the live-row guard run over the
 *  loaded page, so a page can come back smaller than `limit`; duplicate
 *  clusters are computed within the loaded rows, so the flag points at
 *  duplicates visible in the current window — the accountant reviews per
 *  period/lô, which is the intended workflow. */
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
  const items = list.items.filter((row) => row.sourceKind !== 'INVOICE' && costRowIsLive(row));
  const scoped = query.progress
    ? items.filter((row) => costReviewProgressOf(row) === query.progress)
    : items;
  const clusters = costReviewClusterCounts(items);
  const reviewRows = await enrichCostReviewRows(scoped.map((row) => ({
    ...row,
    progress: costReviewProgressOf(row),
    confirmRef: { sourceKind: row.sourceKind, sourceId: row.sourceId, expectedVersion: row.version },
    duplicateCount: clusters.get(costReviewDuplicateKey(row)) ?? 1,
  })));
  return {
    items: reviewRows,
    total: list.total,
    page: list.page,
    limit: list.limit,
    totals: costReviewTotals(reviewRows),
  };
}
