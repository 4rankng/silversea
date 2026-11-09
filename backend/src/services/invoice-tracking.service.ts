// Invoice-tracking service (card 20260921_18) — THEO DÕI HÓA ĐƠN KẾT HỢP.
//
// One tracking row per combined invoice against a lot's container trip. The
// supplier payment mirrors into trip_expenses as "Chi phí hóa đơn" (expense
// type OTHER = the lot's Chi phí khác bucket) and stays in sync: updating
// the tracker payment updates the expense buy amount; deleting the tracker
// removes the expense unless accounting already consumed it (settlement).
// Cross-table FKs are application-level per project convention.
//
// SIL-762 (id 883): tích [Kết hợp] trên lô đồng bộ MỖI container của lô thành
// một dòng "Chưa lấy HĐ" (syncCombinedInvoiceTrackingInTx — idempotent, chỉ
// đụng dòng syncSource='AUTO_COMBINED'). Dữ liệu nhận diện lô (khách, nhà
// máy, Bill/tờ khai, hãng tàu, mã KH, MST) đọc LIVE từ shipments/customers
// lúc list. Chênh lệch = Số tiền thu − Số tiền trả − Số tiền trả KH. [Lưu và
// Ẩn] đặt noInvoice + hiddenAt/hiddenBy: rời danh sách làm việc, còn vết.

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { InvoiceTrackingCreateInput, InvoiceTrackingPatchInput } from '@tingting/shared';
import { round2dp } from '@tingting/shared';

const CHI_PHI_HOA_DON = 'Chi phí hóa đơn';

/** SIL-762 — marker for machine-synced rows; the sync never touches rows
 *  without it (accountant-created ones keep NULL). */
export const AUTO_SYNC_SOURCE = 'AUTO_COMBINED';

/** Amounts ride the wire as integer strings; display math uses Number(). */
function money(n: number): string {
  return String(Math.trunc(n));
}

/** The tracker wire row (amounts as integer strings; display math uses Number()). */
type TrackerRow = {
  id: number;
  shipmentId: number;
  /** SIL-762 — null trên dòng tự đồng bộ (chưa phát sinh chuyến). */
  tripId: number | null;
  containerNumber: string | null;
  /** Card 202605_383 — derived beside containerNumber, never stored. */
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
  /** Card 2026-10-05_384 — the COM amount. `difference` = invoice − paid − com
   *  (SIL-762 formula: thu − trả − trả KH). */
  comAmount: string | null;
  comNote: string | null;
  invoiceSentAt: string | null;
  note: string | null;
  progress: string;
  expenseDate: string;
  expenseId: number | null;
  /** SIL-762 — live lot facts for the 21-column board (never snapshotted). */
  transportDate: string | null;
  bookingRef: string | null;
  blNumber: string | null;
  factoryName: string | null;
  shippingLineName: string | null;
  customerCode: string | null;
  dnttNumbers: string[];
  isAutoSynced: boolean;
  noInvoice: boolean;
  hiddenAt: string | null;
};

export async function listInvoiceTracking(from: string, to: string, opts: { includeHidden?: boolean } = {}): Promise<{ rows: TrackerRow[]; totals: { invoice: number; paid: number; difference: number; com: number } }> {
  const rows = await db.select({
    id: s.invoiceTracking.id,
    shipmentId: s.invoiceTracking.shipmentId,
    tripId: s.invoiceTracking.tripId,
    storedContainerNumber: s.invoiceTracking.containerNumber,
    syncSource: s.invoiceTracking.syncSource,
    noInvoice: s.invoiceTracking.noInvoice,
    hiddenAt: s.invoiceTracking.hiddenAt,
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
    transportDate: s.shipments.expectedDeliveryDate,
    bookingRef: s.shipments.bookingRef,
    blNumber: s.shipments.blNumber,
    factoryName: s.shipments.factoryName,
    shippingLineName: s.shipments.shippingLineName,
    customerName: s.customers.name,
    customerCode: s.customers.code,
    customerTaxCode: s.customers.taxCode,
  }).from(s.invoiceTracking)
    // SIL-762: auto-synced rows have no trip yet → LEFT join. The shipment
    // join stays INNER — every tracker row is born from a shipment.
    .leftJoin(s.trips, eq(s.trips.id, s.invoiceTracking.tripId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.invoiceTracking.shipmentId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(
      gte(s.invoiceTracking.expenseDate, from),
      lte(s.invoiceTracking.expenseDate, to),
      // Q10 (card 20260922_78): soft-deleted trackers leave the list.
      isNull(s.invoiceTracking.deletedAt),
      // SIL-762: [Lưu và Ẩn] rows leave the WORKING list; the trace stays
      // reachable through the explicit hidden toggle.
      ...(opts.includeHidden ? [] : [isNull(s.invoiceTracking.hiddenAt)]),
    ))
    .orderBy(asc(s.invoiceTracking.expenseDate), asc(s.invoiceTracking.id));

  const tripIds = [...new Set(rows.map((r) => r.tripId).filter((id): id is number => id != null))];
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

  // SIL-762: auto-synced rows carry their container number on the ROW — its
  // type comes from the lot's shipment_containers line with the same number.
  const shipmentIds = [...new Set(rows.map((r) => r.shipmentId))];
  const lotContainers = shipmentIds.length > 0
    ? await db.select({
        shipmentId: s.shipmentContainers.shipmentId,
        containerNumber: s.shipmentContainers.containerNumber,
        containerTypeId: s.shipmentContainers.containerTypeId,
      })
      .from(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds))
    : [];
  const lotTypeIds = [...new Set(lotContainers.map((row) => row.containerTypeId).filter((v): v is number => v != null))];
  const lotTypeNames = lotTypeIds.length > 0
    ? await db.select({ id: s.containerTypes.id, name: s.containerTypes.name })
      .from(s.containerTypes).where(inArray(s.containerTypes.id, lotTypeIds))
    : [];
  const lotTypeNameById = new Map(lotTypeNames.map((t) => [t.id, t.name]));
  const typeByLotContainer = new Map(lotContainers.map((row) => [
    `${row.shipmentId}|${row.containerNumber ?? ''}`,
    row.containerTypeId == null ? null : lotTypeNameById.get(row.containerTypeId) ?? null,
  ]));

  // SIL-762 — "Số ĐNTT": the settlement codes (ops_settlements.code) of the
  // issued OPS settlement batches that froze this lot's expense entries.
  // DRAFT/VOIDED batches are not issued requests; voided entries are gone.
  const settlementCodesByShipment = await dnttCodesByShipment(shipmentIds);

  const wire = rows.map((r) => {
    const storedType = r.storedContainerNumber == null
      ? null
      : typeByLotContainer.get(`${r.shipmentId}|${r.storedContainerNumber}`) ?? null;
    const container = r.storedContainerNumber != null || r.tripId == null
      ? null
      : containerByTrip.get(r.tripId);
    const invoiceAmount = String(Number(r.invoiceAmount));
    const supplierPayment = String(Number(r.supplierPayment));
    const comAmount = r.comAmount == null ? null : String(Number(r.comAmount));
    return {
      id: r.id,
      shipmentId: r.shipmentId,
      tripId: r.tripId,
      containerNumber: r.storedContainerNumber ?? container?.containerNumber ?? null,
      containerType: storedType ?? container?.containerType ?? null,
      tradeDirection: r.tradeDirection ?? null,
      shipmentCode: r.shipmentCode,
      customerName: r.customerName,
      invoiceNumber: r.invoiceNumber,
      invoiceAmount,
      supplierPayment,
      // SIL-762 law: Chênh lệch = Số tiền thu − Số tiền trả − Số tiền trả KH.
      difference: String(Number(invoiceAmount) - Number(supplierPayment) - (comAmount == null ? 0 : Number(comAmount))),
      taxCode: r.taxCode ?? r.customerTaxCode,
      supplierName: r.supplierName,
      comAmount,
      comNote: r.comNote,
      invoiceSentAt: r.invoiceSentAt,
      note: r.note,
      progress: r.progress,
      expenseDate: r.expenseDate,
      expenseId: r.expenseId,
      transportDate: r.transportDate,
      bookingRef: r.bookingRef,
      blNumber: r.blNumber,
      factoryName: r.factoryName,
      shippingLineName: r.shippingLineName,
      customerCode: r.customerCode,
      dnttNumbers: settlementCodesByShipment.get(r.shipmentId) ?? [],
      isAutoSynced: r.syncSource === AUTO_SYNC_SOURCE,
      noInvoice: r.noInvoice,
      hiddenAt: r.hiddenAt == null ? null : r.hiddenAt.toISOString(),
    } satisfies TrackerRow;
  });
  const totals = {
    invoice: wire.reduce((sum, r) => sum + Number(r.invoiceAmount), 0),
    paid: wire.reduce((sum, r) => sum + Number(r.supplierPayment), 0),
    difference: wire.reduce((sum, r) => sum + Number(r.difference), 0),
    // Card 2026-10-05_384: COM is additive and independent of the three above.
    // A pre-card row contributes 0 (its `comAmount` is null, not `NaN`), and
    // the sum is rounded through the house helper like every other money total.
    com: round2dp(wire.reduce((sum, r) => sum + (r.comAmount == null ? 0 : Number(r.comAmount)), 0)),
  };
  return { rows: wire, totals };
}

/** SIL-762 — Số ĐNTT per shipment: distinct settlement codes of the issued
 *  (RECORDED/APPROVED) settlement batches that froze this lot's OPS expense
 *  entries. Never an exception on shipments with none — the column falls back
 *  to the house "—". */
async function dnttCodesByShipment(shipmentIds: number[]): Promise<Map<number, string[]>> {
  if (shipmentIds.length === 0) return new Map();
  const rows = await db.select({
    shipmentId: s.opsExpenseEntries.shipmentId,
    code: s.opsSettlements.code,
    createdAt: s.opsSettlements.createdAt,
  }).from(s.opsExpenseEntries)
    .innerJoin(s.opsSettlements, eq(s.opsSettlements.id, s.opsExpenseEntries.opsSettlementId))
    .where(and(
      inArray(s.opsExpenseEntries.shipmentId, shipmentIds),
      // The inner join already guarantees a settlement; drop voided entries.
      isNull(s.opsExpenseEntries.deletionReason),
      inArray(s.opsSettlements.status, ['RECORDED', 'APPROVED']),
    ))
    .orderBy(asc(s.opsSettlements.id));
  const byShipment = new Map<number, string[]>();
  for (const row of rows) {
    const codes = byShipment.get(row.shipmentId) ?? [];
    if (!codes.includes(row.code)) codes.push(row.code);
    byShipment.set(row.shipmentId, codes);
  }
  return byShipment;
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

// ─── SIL-762 — auto-sync từ lô [Kết hợp] ────────────────────────────────────
//
// "Khi CUS hoặc Điều vận tích chọn [Kết hợp], toàn bộ số container của lô tự
// động đổ sang bảng Theo dõi hóa đơn kết hợp ở trạng thái 'Chưa lấy HĐ'."
// Idempotent by design: gọi sau MỖI lần lưu lô / lưu container; chỉ chèn dòng
// còn thiếu, chỉ đụng dòng syncSource='AUTO_COMBINED'. Lô tắt cờ → không sinh
// dòng mới và KHÔNG xóa dòng cũ (dòng có thể đã có dữ liệu kế toán).

export interface CombinedSyncShipment {
  id: number;
  isCombined: boolean;
  cargoMode: string | null;
  deletedAt: Date | null;
  expectedDeliveryDate: string | null;
}

export interface CombinedSyncContainer {
  containerNumber: string | null;
}

export interface CombinedSyncExisting {
  containerNumber: string | null;
  deletedAt: Date | null;
}

/** The rows the sync still needs, in the lot's container order. Container
 *  lines without a number cannot render on the board — skipped. Duplicates a
 *  container number whose auto row was soft-deleted are re-created (the
 *  deleted row keeps its own trail). */
export function missingCombinedTrackingRows(
  shipment: CombinedSyncShipment,
  containers: ReadonlyArray<CombinedSyncContainer>,
  existingAutoRows: ReadonlyArray<CombinedSyncExisting>,
  today: string,
): Array<{ containerNumber: string; expenseDate: string }> {
  if (!shipment.isCombined || shipment.deletedAt != null) return [];
  // Only FCL lots carry container lines; LCL/KCL rows have no số container.
  if (shipment.cargoMode !== 'FCL') return [];
  const present = new Set(
    existingAutoRows
      .filter((row) => row.deletedAt == null && row.containerNumber != null)
      .map((row) => row.containerNumber),
  );
  const seen = new Set<string>();
  const plan: Array<{ containerNumber: string; expenseDate: string }> = [];
  for (const container of containers) {
    const number = container.containerNumber?.trim();
    if (!number || seen.has(number) || present.has(number)) continue;
    seen.add(number);
    plan.push({ containerNumber: number, expenseDate: shipment.expectedDeliveryDate ?? today });
  }
  return plan;
}

/** Sync one lot. Runs inside the caller's transaction (lot save + container
 *  reconcile + sync land atomically). `actorId` is the saving user — the
 *  trail of who pulled the lot onto the board. */
export async function syncCombinedInvoiceTrackingInTx(
  tx: Tx,
  shipmentId: number,
  actorId: number | null,
): Promise<number> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    isCombined: s.shipments.isCombined,
    cargoMode: s.shipments.cargoMode,
    deletedAt: s.shipments.deletedAt,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
  }).from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
  if (!shipment) return 0;
  const containers = await tx.select({ containerNumber: s.shipmentContainers.containerNumber })
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId))
    .orderBy(asc(s.shipmentContainers.id));
  const existingAutoRows = await tx.select({
    containerNumber: s.invoiceTracking.containerNumber,
    deletedAt: s.invoiceTracking.deletedAt,
  }).from(s.invoiceTracking)
    .where(and(eq(s.invoiceTracking.shipmentId, shipmentId), eq(s.invoiceTracking.syncSource, AUTO_SYNC_SOURCE)));
  const plan = missingCombinedTrackingRows(
    shipment,
    containers,
    existingAutoRows,
    new Date().toISOString().slice(0, 10),
  );
  if (plan.length === 0) return 0;
  await tx.insert(s.invoiceTracking).values(plan.map((entry) => ({
    shipmentId,
    tripId: null,
    invoiceNumber: null,
    invoiceAmount: money(0),
    supplierPayment: money(0),
    containerNumber: entry.containerNumber,
    syncSource: AUTO_SYNC_SOURCE,
    // "Chưa lấy HĐ": the row exists, the invoice does not — the accountant
    // fills supplier/invoice/amounts from the board when the paper arrives.
    progress: 'CHUA_GUI',
    expenseDate: entry.expenseDate,
    createdBy: actorId,
  })));
  return plan.length;
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
      // SIL-762 — [Lưu và Ẩn]: `noInvoice` ticks "Không lấy hóa đơn"; `hidden`
      // moves the row out of the working list (hiddenAt/hiddenBy = the trace)
      // or brings it back on Bỏ ẩn.
      ...(patch.noInvoice !== undefined ? { noInvoice: patch.noInvoice } : {}),
      ...(patch.hidden !== undefined
        ? { hiddenAt: patch.hidden ? new Date() : null, hiddenBy: patch.hidden ? userId : null }
        : {}),
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
