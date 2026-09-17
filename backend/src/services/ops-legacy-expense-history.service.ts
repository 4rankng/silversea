import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import type { OpsExpenseListRow } from './ops-expenses.service';
import { loadExpenseAccountingEntries } from './expense-accounting-reads.service';

/** Keep pre-existing accounting proxies visible without copying their money. */
export async function listLegacyOpsExpenseHistory(userId: number, status?: string): Promise<OpsExpenseListRow[]> {
  if (status && status !== 'RECORDED' && status !== 'APPROVED') return [];
  const entries = (await loadExpenseAccountingEntries({ userId, role: Role.OPS }, { page: 1, limit: 100 }, db))
    .filter(row => row.sourceKind === 'TRIP' && row.payerUserId === userId && row.payerKind === 'USER');
  if (!entries.length) return [];
  const native = await db.select({ id: s.tripExpenses.id, createdAt: s.tripExpenses.createdAt }).from(s.tripExpenses)
    .where(inArray(s.tripExpenses.id, entries.map(row => row.sourceId)));
  return entries.map(row => ({ id: -row.sourceId, sourceId: row.sourceId, sourceKind: 'TRIP',
    version: row.version, confirmedAt: row.confirmedAt, costGroup: row.costGroup, feeName: row.feeName,
    invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate,
    customerChargeAmount: row.customerChargeAmount == null ? null : String(row.customerChargeAmount), recoveryNote: row.recoveryNote,
    shipmentId: row.shipmentId, shipmentCode: row.shipmentCode, containerNumber: row.containerNumber,
    expenseTypeCode: row.expenseTypeCode, expenseTypeName: row.feeName,
    requiresInvoice: row.costGroup?.startsWith('INVOICED_') ?? null, amount: String(row.amount), paidAt: row.expenseDate,
    note: row.note, approvalStatus: 'RECORDED', rejectionReason: null, opsSettlementId: null,
    hasPhoto: row.photoStorageKeys.length > 0, paidById: userId, paidByName: row.payerName,
    createdAt: native.find(item => item.id === row.sourceId)!.createdAt.toISOString(),
  }));
}
