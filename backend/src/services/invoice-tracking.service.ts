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
import type { InvoiceTrackingCreateInput, InvoiceTrackingPatchInput } from '@tingting/shared';
import { round2dp } from '@tingting/shared';

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
  /** Card 20261005_383 — derived beside containerNumber, never stored. */
  containerType: string | null;
  /** Card 20261005_383 — shipments.tradeDirection verbatim; label comes from
   *  the shared TRADE_DIRECTION_LABELS map on the client. */
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  shipmentCode: string | null;
  customerName: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string;
  supplierPayment: string;
  difference: string;
  taxCode: string | null;
  supplierName: string | null;
  /** Card 2026-10-05_384 — the COM amount, DISPLAY-ONLY. `difference` above is
   *  untouched: COM is a customer-side deduction, while `difference` reconciles
   *  the invoice against the supplier payment — two different questions. */
  comAmount: string | null;
  comNote: string | null;
  invoiceSentAt: string | null;
  note: string | null;
  progress: string;
  expenseDate: string;
  expenseId: number | null;
};

export async function listInvoiceTracking(from: string, to: string): Promise<{ rows: TrackerRow[]; totals: { invoice: number; paid: number; difference: number; com: number } }> {
  const rows = await db.select({
    id: s.invoiceTracking.id,
    shipmentId: s.invoiceTracking.shipmentId,
    tripId: s.invoiceTracking.tripId,
    invoiceNumber: s.invoiceTracking.invoiceNumber,
    invoiceAmount: s.invoiceTracking.invoiceAmount,
    supplierPayment: s.invoiceTracking.supplierPayment,
    taxCode: s.invoiceTracking.taxCode,
    supplierName: s.invoiceTracking.supplierName,
    comAmount: s.invoiceTracking.comAmount,
    comNote: s.invoiceTracking.comNote,
    invoiceSentAt: s.invoiceTracking.invoiceSentAt,
    note: s.invoiceTracking.note,
    progress: s.invoiceTracking.progress,
    expenseDate: s.invoiceTracking.expenseDate,
    expenseId: s.invoiceTracking.expenseId,
    shipmentCode: s.shipments.shipmentCode,
    tradeDirection: s.shipments.tradeDirection,
    customerName: s.customers.name,
  }).from(s.invoiceTracking)
    .innerJoin(s.shipments, eq(s.shipments.id, s.invoiceTracking.shipmentId))
    .innerJoin(s.trips, eq(s.trips.id, s.invoiceTracking.tripId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(
      gte(s.invoiceTracking.expenseDate, from),
      lte(s.invoiceTracking.expenseDate, to),
      // Q10 (card 20260922_78): soft-deleted trackers leave the list.
      isNull(s.invoiceTracking.deletedAt),
    ))
    .orderBy(asc(s.invoiceTracking.expenseDate), asc(s.invoiceTracking.id));

  const tripIds = [...new Set(rows.map((r) => r.tripId))];
  // Card 20261005_383: the container-type catalog is resolved in a SECOND
  // query on purpose. Folding `containerTypes` into this select as a join
  // would leave "first container per trip wins" (see `containerOfTrip`)
  // at the mercy of the planner's join order; a separate id→name lookup
  // keeps the container row set — and the order `containerOfTrip` reads —
  // exactly as it was before the card, so no displayed container can move.
  const containerRows = tripIds.length > 0
    ? await db.select({
        tripId: s.tripContainers.tripId,
        containerNumber: s.tripContainers.containerNumber,
        containerTypeId: s.tripContainers.containerTypeId,
      })
      .from(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds))
      // Card 2026-10-05_383: `containerOfTrip` reads the FIRST row per trip, so
      // that pick has to be guaranteed by the query rather than left to the
      // planner — without this, "first container wins" is whatever row order
      // Postgres happens to return, and the same trip can display a different
      // container (and now a different container type) after a plan change.
      .orderBy(asc(s.tripContainers.id))
    : [];
  const typeNameById = await containerTypeNamesById(containerRows);
  const containerByTrip = containerOfTrip(containerRows, typeNameById);
  const wire = rows.map((r) => {
    const container = containerByTrip.get(r.tripId);
    return {
      id: r.id,
      shipmentId: r.shipmentId,
      tripId: r.tripId,
      containerNumber: container?.containerNumber ?? null,
      containerType: container?.containerType ?? null,
      tradeDirection: r.tradeDirection ?? null,
      shipmentCode: r.shipmentCode,
      customerName: r.customerName,
      invoiceNumber: r.invoiceNumber,
      invoiceAmount: String(Number(r.invoiceAmount)),
      supplierPayment: String(Number(r.supplierPayment)),
      difference: String(Number(r.invoiceAmount) - Number(r.supplierPayment)),
      taxCode: r.taxCode,
      supplierName: r.supplierName,
      comAmount: r.comAmount == null ? null : String(Number(r.comAmount)),
      comNote: r.comNote,
      invoiceSentAt: r.invoiceSentAt,
      note: r.note,
      progress: r.progress,
      expenseDate: r.expenseDate,
      expenseId: r.expenseId,
    };
  });
  const totals = {
    invoice: wire.reduce((sum, r) => sum + Number(r.invoiceAmount), 0),
    paid: wire.reduce((sum, r) => sum + Number(r.supplierPayment), 0),
    difference: wire.reduce((sum, r) => sum + (Number(r.invoiceAmount) - Number(r.supplierPayment)), 0),
    // Card 2026-10-05_384: COM is additive and independent of the three above.
    // A pre-card row contributes 0 (its `comAmount` is null, not `NaN`), and
    // the sum is rounded through the house helper like every other money total.
    com: round2dp(wire.reduce((sum, r) => sum + (r.comAmount == null ? 0 : Number(r.comAmount)), 0)),
  };
  return { rows: wire, totals };
}

/** Catalog names for the container types the listed containers reference.
 *  Missing ids are simply absent from the map — a container pointing at a
 *  deleted/unknown type then derives `null`, never an exception. */
async function containerTypeNamesById(
  tripContainers: Array<{ containerTypeId: number | null }>,
): Promise<Map<number, string>> {
  const typeIds = [...new Set(tripContainers.map((row) => row.containerTypeId).filter((v): v is number => v != null))];
  if (typeIds.length === 0) return new Map();
  const types = await db.select({ id: s.containerTypes.id, name: s.containerTypes.name })
    .from(s.containerTypes).where(inArray(s.containerTypes.id, typeIds));
  return new Map(types.map((t) => [t.id, t.name]));
}

/** Resolve the trip's first container (wire display) and that container's
 *  type. Card 20261005_383: the type rides the SAME container that produced
 *  the number, so the pre-existing "first row wins" rule is untouched. A trip
 *  with no container is simply absent from the map (the caller reads `null`);
 *  a container with a null/unknown `containerTypeId` yields a number with a
 *  null type. */
function containerOfTrip(
  tripContainers: Array<{ tripId: number; containerNumber: string | null; containerTypeId: number | null }>,
  typeNameById: ReadonlyMap<number, string>,
): Map<number, { containerNumber: string | null; containerType: string | null }> {
  const map = new Map<number, { containerNumber: string | null; containerType: string | null }>();
  for (const row of tripContainers) {
    if (!map.has(row.tripId)) {
      map.set(row.tripId, {
        containerNumber: row.containerNumber,
        containerType: row.containerTypeId == null ? null : typeNameById.get(row.containerTypeId) ?? null,
      });
    }
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
      comAmount: input.comAmount == null ? null : money(input.comAmount),
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
      ...(patch.comAmount !== undefined ? { comAmount: patch.comAmount == null ? null : money(patch.comAmount) } : {}),
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

/** Q10 delete (card 20260922_78): BOTH the tracker row and its mirrored fee
 * row survive — soft-voided with a mandatory free-text reason, actor and
 * timestamp. The physical delete (and the FK-order dance it forced) is gone;
 * settled trackers stay locked (409). */
export async function deleteInvoiceTracking(userId: number, id: number, reason: string, transaction?: Tx) {
  if (!reason || !reason.trim()) throw new ApiError(400, 'Lý do xóa là bắt buộc.');
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.invoiceTracking)
      .where(eq(s.invoiceTracking.id, id))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy dòng theo dõi');
    const now = new Date();
    await tx.update(s.invoiceTracking).set({
      deletionReason: reason.trim(),
      deletedAt: now,
      deletedBy: userId,
      updatedAt: now,
    }).where(eq(s.invoiceTracking.id, id));
    if (existing.expenseId != null) {
      await tx.update(s.tripExpenses).set({
        approvalStatus: 'VOIDED',
        deletionReason: reason.trim(),
        deletedAt: now,
        deletedBy: userId,
        updatedAt: now,
      }).where(eq(s.tripExpenses.id, existing.expenseId));
    }
    return { ok: true };
  };
  return runInTx(transaction, execute);
}
