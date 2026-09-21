import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';

/** Operational recovery notes only: no prices, payers or cash details enter
 *  the dispatch projection. Card 20260921_5: no-invoice ops fees whose Thực-thu
 *  side was set (> 0) surface by FEE NAME so cus/accounting can tick them into
 *  the debit — the amount itself stays off the plan (standing ruling). */
export async function loadDispatchExpenseNotes(shipmentIds: number[], executor: Tx | typeof db = db) {
  const result = new Map<number, string[]>();
  if (!shipmentIds.length) return result;
  const ids = [...new Set(shipmentIds)];
  const [native, charged, legacy] = await Promise.all([
    executor.select({ shipmentId: s.opsExpenseEntries.shipmentId, note: s.opsExpenseEntries.recoveryNote })
      .from(s.opsExpenseEntries).where(and(inArray(s.opsExpenseEntries.shipmentId, ids),
        inArray(s.opsExpenseEntries.approvalStatus, ['RECORDED', 'APPROVED']), isNotNull(s.opsExpenseEntries.recoveryNote))).orderBy(asc(s.opsExpenseEntries.id)),
    executor.select({
      shipmentId: s.opsExpenseEntries.shipmentId,
      feeName: s.opsExpenseEntries.feeName,
      typeName: s.forwarderExpenseTypes.name,
    })
      .from(s.opsExpenseEntries)
      .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
      .where(and(inArray(s.opsExpenseEntries.shipmentId, ids),
        inArray(s.opsExpenseEntries.approvalStatus, ['RECORDED', 'APPROVED']),
        gt(s.opsExpenseEntries.customerChargeAmount, '0'))).orderBy(asc(s.opsExpenseEntries.id)),
    executor.select({ shipmentId: s.expenseAccountingSources.shipmentId, note: s.tripExpenses.recoveryNote })
      .from(s.expenseAccountingSources).innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.expenseAccountingSources.sourceId))
      .where(and(inArray(s.expenseAccountingSources.shipmentId, ids), eq(s.expenseAccountingSources.sourceKind, 'TRIP'),
        eq(s.expenseAccountingSources.status, 'RECORDED'), eq(s.tripExpenses.settlementMethod, 'OPS_ADVANCE'), isNotNull(s.tripExpenses.recoveryNote)))
      .orderBy(asc(s.expenseAccountingSources.id)),
  ]);
  const push = (shipmentId: number, note: string | null) => {
    const trimmed = note?.trim();
    if (!trimmed) return;
    const notes = result.get(shipmentId) ?? [];
    if (!notes.includes(trimmed)) notes.push(trimmed);
    result.set(shipmentId, notes);
  };
  for (const row of charged) {
    push(row.shipmentId, `Thu khách: ${row.feeName?.trim() || row.typeName || 'phí không hóa đơn'}`);
  }
  for (const row of [...native, ...legacy]) {
    push(row.shipmentId, row.note);
  }
  return result;
}
