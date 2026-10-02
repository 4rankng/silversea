import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { getAdvanceFundedAmounts } from './advance-funding.service';

type Snapshot = { id: number; allocatedAdvanceAmount: string | number };
function releaseSources(payload: unknown): Snapshot[] | null {
  if (!payload || typeof payload !== 'object' || !('sources' in payload) || !Array.isArray(payload.sources)) return null;
  const valid = payload.sources.every(row => row && typeof row === 'object' && Number.isInteger(row.id)
    && Number.isSafeInteger(Number(row.allocatedAdvanceAmount)) && Number(row.allocatedAdvanceAmount) >= 0);
  return valid ? payload.sources as Snapshot[] : null;
}

/** Payment cutoff over current expenses; preserved release snapshots retain past claims. */
export async function projectExpenseAdvancesAsOf(executor: Tx | typeof db, entries: ExpenseAccountingEntry[], asOfDate: string): Promise<ExpenseAccountingEntry[]> {
  const owners = [...new Set(entries.filter(row => row.payableEntityType === 'FORWARDER').map(row => row.payableEntityId).filter((id): id is number => id != null))];
  if (!owners.length) return entries;
  const cutoff = new Date(`${asOfDate}T23:59:59.999+07:00`);
  const batches = await executor.select().from(s.expenseReconciliations).where(and(inArray(s.expenseReconciliations.opsUserId, owners),
    lte(s.expenseReconciliations.createdAt, cutoff), or(isNull(s.expenseReconciliations.voidedAt), gt(s.expenseReconciliations.voidedAt, cutoff))));
  const amounts = new Map<number, number | null>();
  if (batches.length) {
    const batchIds = batches.map(batch => batch.id);
    const [current, history, advances] = await Promise.all([
      executor.select({ id: s.expenseAccountingSources.id, reconciliationId: s.expenseAccountingSources.reconciliationId, allocatedAdvanceAmount: s.expenseAccountingSources.allocatedAdvanceAmount }).from(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.reconciliationId, batchIds)),
      executor.select({ batchId: s.auditLogs.entityId, payload: s.auditLogs.payload }).from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'expense_reconciliation'), eq(s.auditLogs.message, 'EXPENSE_RECONCILIATION_RELEASED'), inArray(s.auditLogs.entityId, batchIds))),
      executor.select().from(s.expenseReconciliationAdvances).where(inArray(s.expenseReconciliationAdvances.reconciliationId, batchIds)),
    ]);
    const funded = await getAdvanceFundedAmounts(executor, advances.map(row => row.advanceRequestId), asOfDate);
    const claimedTotals = new Map<number, number>();
    for (const advance of advances) claimedTotals.set(advance.advanceRequestId, (claimedTotals.get(advance.advanceRequestId) ?? 0) + Number(advance.amount));
    for (const batch of batches) {
      const sources = batch.voidedAt ? releaseSources(history.find(row => row.batchId === batch.id)?.payload) : current.filter(row => row.reconciliationId === batch.id);
      // Every recorded source has an exact assigned amount; do not spread a partial
      // funding shortfall across unrelated expense rows without allocation evidence.
      const sufficientCash = advances.filter(row => row.reconciliationId === batch.id).every(row => (funded.get(row.advanceRequestId) ?? 0) >= (claimedTotals.get(row.advanceRequestId) ?? 0));
      if (!sources) {
        for (const row of entries.filter(entry => entry.payableEntityId === batch.opsUserId)) amounts.set(row.id, null);
        continue;
      }
      for (const source of sources) {
        if (!sufficientCash || amounts.has(source.id)) amounts.set(source.id, null);
        else amounts.set(source.id, Number(source.allocatedAdvanceAmount));
      }
    }
  }
  return entries.map(row => {
    if (row.payableEntityType !== 'FORWARDER' || row.isLegacy || row.paidAmount == null) return row;
    const amount = amounts.has(row.id) ? amounts.get(row.id)! : 0;
    return { ...row, allocatedAdvanceAmount: amount, outstandingPayable: amount == null || row.paidAmount == null ? null : row.amount - amount - row.paidAmount };
  });
}
