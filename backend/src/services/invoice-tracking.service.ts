// Invoice-tracking service (card 20260921_18) — THEO DÕI HÓA ĐƠN KẾT HỢP.
//
// One tracking row per combined invoice against a lot's container trip. The
// supplier payment mirrors into trip_expenses as "Chi phí hóa đơn" (expense
// type OTHER = the lot's Chi phí khác bucket) and stays in sync: updating
// the tracker payment updates the expense buy amount; deleting the tracker
// removes the expense unless accounting already consumed it (settlement).
// Cross-table FKs are application-level per project convention.

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { AuthUser } from '../middleware/auth';
import type { InvoiceTrackingCreateInput, InvoiceTrackingPatchInput } from '@tingting/shared';

const CHI_PHI_HOA_DON = 'Chi phí hóa đơn';

/** Amounts ride the wire as integer strings; display math uses Number(). */
function money(n: number): string {
  return String(Math.trunc(n));
}

/** The tracker wire row (amounts as integer strings; display math uses Number()). */
type TrackerRow = {
  id: number;
  shipmentId: number;
  tripId: number;
  containerNumber: string | null;
  shipmentCode: string | null;
  customerName: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string;
  supplierPayment: string;
  difference: string;
  taxCode: string | null;
  supplierName: string | null;
  comNote: string | null;
  invoiceSentAt: string | null;
  note: string | null;
  progress: string;
  expenseDate: string;
  expenseId: number | null;
};

export async function listInvoiceTracking(from: string, to: string): Promise<{ rows: TrackerRow[]; totals: { invoice: number; paid: number; difference: number } }> {
  const rows = await db.select({
    id: s.invoiceTracking.id,
    shipmentId: s.invoiceTracking.shipmentId,
    tripId: s.invoiceTracking.tripId,
    invoiceNumber: s.invoiceTracking.invoiceNumber,
    invoiceAmount: s.invoiceTracking.invoiceAmount,
    supplierPayment: s.invoiceTracking.supplierPayment,
    taxCode: s.invoiceTracking.taxCode,
    supplierName: s.invoiceTracking.supplierName,
    comNote: s.invoiceTracking.comNote,
    invoiceSentAt: s.invoiceTracking.invoiceSentAt,
    note: s.invoiceTracking.note,
    progress: s.invoiceTracking.progress,
    expenseDate: s.invoiceTracking.expenseDate,
    expenseId: s.invoiceTracking.expenseId,
    shipmentCode: s.shipments.shipmentCode,
    customerName: s.customers.name,
  }).from(s.invoiceTracking)
    .innerJoin(s.shipments, eq(s.shipments.id, s.invoiceTracking.shipmentId))
    .innerJoin(s.trips, eq(s.trips.id, s.invoiceTracking.tripId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(gte(s.invoiceTracking.expenseDate, from), lte(s.invoiceTracking.expenseDate, to)))
    .orderBy(asc(s.invoiceTracking.expenseDate), asc(s.invoiceTracking.id));

  const tripIds = [...new Set(rows.map((r) => r.tripId))];
  const containerRows = tripIds.length > 0
    ? await db.select({ tripId: s.tripContainers.tripId, containerNumber: s.tripContainers.containerNumber })
      .from(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds))
    : [];
  const containerByTrip = containerNumberByTrip(containerRows);
  const wire = rows.map((r) => ({
    id: r.id,
    shipmentId: r.shipmentId,
    tripId: r.tripId,
    containerNumber: containerByTrip.get(r.tripId) ?? null,
    shipmentCode: r.shipmentCode,
    customerName: r.customerName,
    invoiceNumber: r.invoiceNumber,
    invoiceAmount: String(Number(r.invoiceAmount)),
    supplierPayment: String(Number(r.supplierPayment)),
    difference: String(Number(r.invoiceAmount) - Number(r.supplierPayment)),
    taxCode: r.taxCode,
    supplierName: r.supplierName,
    comNote: r.comNote,
    invoiceSentAt: r.invoiceSentAt,
    note: r.note,
    progress: r.progress,
    expenseDate: r.expenseDate,
    expenseId: r.expenseId,
  }));
  const totals = {
    invoice: wire.reduce((sum, r) => sum + Number(r.invoiceAmount), 0),
    paid: wire.reduce((sum, r) => sum + Number(r.supplierPayment), 0),
    difference: wire.reduce((sum, r) => sum + (Number(r.invoiceAmount) - Number(r.supplierPayment)), 0),
  };
  return { rows: wire, totals };
}

/** Resolve the trip's first container number (wire display). */
function containerNumberByTrip(tripContainers: Array<{ tripId: number; containerNumber: string | null }>): Map<number, string | null> {
  const map = new Map<number, string | null>();
  for (const row of tripContainers) {
    if (!map.has(row.tripId)) map.set(row.tripId, row.containerNumber);
  }
  return map;
}

export async function createInvoiceTracking(
  userId: number,
  input: InvoiceTrackingCreateInput,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, input.shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    const [trip] = await tx.select().from(s.trips)
      .where(and(eq(s.trips.id, input.tripId), isNull(s.trips.deletedAt)))
      .limit(1);
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến');
    if (trip.shipmentId !== input.shipmentId) {
      throw new ApiError(409, 'Chuyến không thuộc lô hàng đã chọn');
    }
    const [row] = await tx.insert(s.invoiceTracking).values({
      shipmentId: input.shipmentId,
      tripId: input.tripId,
      invoiceNumber: input.invoiceNumber,
      invoiceAmount: money(input.invoiceAmount),
      supplierPayment: money(input.supplierPayment),
      taxCode: input.taxCode ?? null,
      supplierName: input.supplierName ?? null,
      comNote: input.comNote ?? null,
      invoiceSentAt: input.invoiceSentAt ?? null,
      note: input.note ?? null,
      progress: input.progress,
      expenseDate: input.expenseDate ?? new Date().toISOString().slice(0, 10),
      createdBy: userId,
    }).returning();

    const [expense] = await tx.insert(s.tripExpenses).values({
      tripId: input.tripId,
      expenseType: 'OTHER',
      feeName: CHI_PHI_HOA_DON,
      buyAmount: money(input.supplierPayment),
      invoiceNumber: input.invoiceNumber,
      expenseDate: input.expenseDate ?? new Date().toISOString().slice(0, 10),
      createdBy: userId,
    }).returning();

    await tx.update(s.invoiceTracking)
      .set({ expenseId: expense.id })
      .where(eq(s.invoiceTracking.id, row.id));

    return { ...row, expenseId: expense.id };
  };
  return runInTx(transaction, execute);
}

/** Update keeps the mirrored expense in sync (payment amount + invoice no.). */
export async function updateInvoiceTracking(
  userId: number,
  id: number,
  patch: InvoiceTrackingPatchInput,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.invoiceTracking)
      .where(eq(s.invoiceTracking.id, id))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy dòng theo dõi');
    const [updated] = await tx.update(s.invoiceTracking).set({
      ...(patch.invoiceNumber !== undefined ? { invoiceNumber: patch.invoiceNumber } : {}),
      ...(patch.invoiceAmount !== undefined ? { invoiceAmount: money(patch.invoiceAmount) } : {}),
      ...(patch.supplierPayment !== undefined ? { supplierPayment: money(patch.supplierPayment) } : {}),
      ...(patch.taxCode !== undefined ? { taxCode: patch.taxCode ?? null } : {}),
      ...(patch.supplierName !== undefined ? { supplierName: patch.supplierName ?? null } : {}),
      ...(patch.comNote !== undefined ? { comNote: patch.comNote ?? null } : {}),
      ...(patch.invoiceSentAt !== undefined ? { invoiceSentAt: patch.invoiceSentAt ?? null } : {}),
      ...(patch.note !== undefined ? { note: patch.note ?? null } : {}),
      ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      ...(patch.expenseDate !== undefined ? { expenseDate: patch.expenseDate } : {}),
      updatedAt: new Date(),
    }).where(eq(s.invoiceTracking.id, id)).returning();

    if (existing.expenseId != null && patch.supplierPayment !== undefined) {
      await tx.update(s.tripExpenses)
        .set({ buyAmount: money(patch.supplierPayment), updatedAt: new Date() })
        .where(eq(s.tripExpenses.id, existing.expenseId));
    }
    if (existing.expenseId != null && patch.invoiceNumber !== undefined) {
      await tx.update(s.tripExpenses)
        .set({ invoiceNumber: patch.invoiceNumber, updatedAt: new Date() })
        .where(eq(s.tripExpenses.id, existing.expenseId));
    }
    void userId;
    return updated;
  };
  return runInTx(transaction, execute);
}

/** Delete removes the mirrored expense too — unless accounting already
 * settled it, in which case the tracker row is locked (409). */
export async function deleteInvoiceTracking(userId: number, id: number, transaction?: Tx) {
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.invoiceTracking)
      .where(eq(s.invoiceTracking.id, id))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy dòng theo dõi');
    // Tracker row first: invoice_tracking.expense_id holds a real FK to
    // trip_expenses, so the mirror deletes after the referencing row is gone.
    await tx.delete(s.invoiceTracking).where(eq(s.invoiceTracking.id, id));
    if (existing.expenseId != null) {
      await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, existing.expenseId));
    }
    void userId;
    return { ok: true };
  };
  return runInTx(transaction, execute);
}
