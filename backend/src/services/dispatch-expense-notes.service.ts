import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';

/** Operational recovery notes only: no prices, payers or cash details enter the dispatch projection. */
export async function loadDispatchExpenseNotes(shipmentIds: number[], executor: Tx | typeof db = db) {
  const result = new Map<number, string[]>();
  if (!shipmentIds.length) return result;
  const ids = [...new Set(shipmentIds)];
  const [native, legacy] = await Promise.all([
    executor.select({ shipmentId: s.opsExpenseEntries.shipmentId, note: s.opsExpenseEntries.recoveryNote })
      .from(s.opsExpenseEntries).where(and(inArray(s.opsExpenseEntries.shipmentId, ids),
        inArray(s.opsExpenseEntries.approvalStatus, ['RECORDED', 'APPROVED']), isNotNull(s.opsExpenseEntries.recoveryNote))).orderBy(asc(s.opsExpenseEntries.id)),
    executor.select({ shipmentId: s.expenseAccountingSources.shipmentId, note: s.tripExpenses.recoveryNote })
      .from(s.expenseAccountingSources).innerJoin(s.tripExpenses, eq(s.tripExpenses.id, s.expenseAccountingSources.sourceId))
      .where(and(inArray(s.expenseAccountingSources.shipmentId, ids), eq(s.expenseAccountingSources.sourceKind, 'TRIP'),
        eq(s.expenseAccountingSources.status, 'RECORDED'), eq(s.tripExpenses.settlementMethod, 'OPS_ADVANCE'), isNotNull(s.tripExpenses.recoveryNote)))
      .orderBy(asc(s.expenseAccountingSources.id)),
  ]);
  for (const row of [...native, ...legacy]) {
    const note = row.note?.trim();
    if (!note) continue;
    const notes = result.get(row.shipmentId) ?? [];
    if (!notes.includes(note)) notes.push(note);
    result.set(row.shipmentId, notes);
  }
  return result;
}
