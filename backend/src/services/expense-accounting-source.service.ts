import { and, eq, isNull } from 'drizzle-orm';
import { expenseVndSchema, expenseDateSchema, type ExpenseCostGroup, type ExpenseSourceKind } from '@tingting/shared';
import * as s from '../db/schema';
import { db } from '../db';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

export type ExpenseAccountingLink = typeof s.expenseAccountingSources.$inferSelect;
export type ExpenseAccountingSource = ExpenseAccountingLink & {
  paymentHistoryUnattributed: boolean;
  shipmentContainerId: number | null; truckId: number | null; customerId: number; expenseTypeCode: string;
  costGroup: ExpenseCostGroup | null; feeName: string; amount: string; customerChargeAmount: string | null;
  expenseDate: string; invoiceNumber: string | null; invoiceDate: string | null;
  payerKind: 'USER' | 'COMPANY' | 'SUPPLIER' | null; payerUserId: number | null;
  payableEntityType: 'FORWARDER' | 'DRIVER' | 'VENDOR' | 'CARRIER' | null; payableEntityId: number | null;
  note: string | null; recoveryNote: string | null; photoStorageKeys: string[];
};

export async function hydrateExpenseAccountingSource(executor: Tx | typeof db, link: ExpenseAccountingLink): Promise<ExpenseAccountingSource> {
  const [shipment] = await executor.select().from(s.shipments).where(eq(s.shipments.id, link.shipmentId));
  if (!shipment?.customerId) throw new ApiError(409, 'Nguồn chi phí không còn lô hàng/khách hàng hợp lệ.');
  const [legacyLink] = await executor.select({ id: s.auditLogs.id }).from(s.auditLogs).where(and(
    eq(s.auditLogs.entityType, 'expense_accounting_source'), eq(s.auditLogs.entityId, link.id), eq(s.auditLogs.message, 'EXPENSE_ACCOUNTING_LEGACY_LINKED'))).limit(1);
  const base = { ...link, paymentHistoryUnattributed: Boolean(legacyLink), shipmentContainerId: null, truckId: null, customerId: shipment.customerId,
    costGroup: null, invoiceNumber: null, invoiceDate: null, payerKind: null, payerUserId: null,
    payableEntityType: null, payableEntityId: null, note: null, recoveryNote: null, photoStorageKeys: [] };
  if (link.sourceKind === 'OPS') {
    const [e] = await executor.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, link.sourceId));
    if (!e) throw new ApiError(404, 'Khoản chi Ops không còn tồn tại.');
    const [trip] = link.tripId ? await executor.select().from(s.trips).where(eq(s.trips.id, link.tripId)) : [];
    return { ...base, ...e, ...link, truckId: trip?.truckId ?? null, customerId: shipment.customerId,
      feeName: e.feeName ?? e.expenseTypeCode, expenseDate: e.paidAt, payerKind: e.payerKind ?? 'USER', payerUserId: e.payerKind === 'COMPANY' ? null : e.paidById,
      payableEntityType: e.payerKind === 'COMPANY' ? null : 'FORWARDER', payableEntityId: e.payerKind === 'COMPANY' ? null : e.paidById };
  }
  if (link.sourceKind === 'DRIVER') {
    const [data] = await executor.select({ e: s.driverIncidentalCosts, t: s.trips, d: s.drivers }).from(s.driverIncidentalCosts)
      .innerJoin(s.trips, eq(s.trips.id, s.driverIncidentalCosts.tripId)).innerJoin(s.drivers, eq(s.drivers.id, s.driverIncidentalCosts.driverId))
      .where(eq(s.driverIncidentalCosts.id, link.sourceId));
    if (!data) throw new ApiError(404, 'Khoản chi lái xe không còn tồn tại.');
    const { e, t, d } = data;
    return { ...base, ...e, ...link, tripId: e.tripId, truckId: t.truckId, customerId: t.customerId,
      expenseTypeCode: e.costType, feeName: e.feeName ?? e.costType, expenseDate: e.occurredAt,
      payerKind: e.payerKind ?? 'USER', payerUserId: e.payerKind === 'COMPANY' ? null : d.userId, payableEntityType: e.payerKind === 'COMPANY' ? null : 'DRIVER', payableEntityId: e.payerKind === 'COMPANY' ? null : d.id,
      photoStorageKeys: e.photoStorageKeys.length ? e.photoStorageKeys : e.receiptStorageKey ? [e.receiptStorageKey] : [] };
  }
  if (link.sourceKind === 'INVOICE') {
    const [e] = await executor.select().from(s.shipmentInvoiceRecords).where(eq(s.shipmentInvoiceRecords.id, link.sourceId));
    if (!e) throw new ApiError(404, 'Hồ sơ hóa đơn không còn tồn tại.');
    return { ...base, ...link, expenseTypeCode: 'INVOICE_SERVICE', costGroup: 'INVOICE_SERVICE', feeName: 'Chi phí hóa đơn',
      amount: e.supplierFeeAmount, customerChargeAmount: '0', expenseDate: e.invoiceDate, invoiceDate: e.invoiceDate,
      invoiceNumber: e.invoiceNumber, payerKind: 'SUPPLIER', payableEntityType: 'VENDOR', payableEntityId: e.supplierId, note: e.note };
  }
  const [data] = await executor.select({ e: s.tripExpenses, t: s.trips }).from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId)).where(eq(s.tripExpenses.id, link.sourceId));
  if (!data) throw new ApiError(404, 'Chi phí chuyến không còn tồn tại.');
  const { e, t } = data;
  const photos = await executor.select({ key: s.tripExpensePhotos.storageKey }).from(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.tripExpenseId, e.id));
  return { ...base, ...link, tripId: t.id, truckId: t.truckId, customerId: t.customerId,
    expenseTypeCode: e.expenseType, costGroup: e.costGroup, feeName: e.feeName ?? e.expenseType,
    amount: e.buyAmount, customerChargeAmount: e.sellAmount, expenseDate: e.expenseDate ?? t.departureDate,
    invoiceNumber: e.invoiceNumber, invoiceDate: e.invoiceDate, note: e.note, recoveryNote: e.recoveryNote,
    payerKind: e.settlementMethod === 'OPS_ADVANCE' ? 'USER' : e.supplierId ? 'SUPPLIER' : 'COMPANY',
    payerUserId: e.forwarderId, payableEntityType: e.settlementMethod === 'OPS_ADVANCE' ? 'FORWARDER' : e.supplierId ? 'VENDOR' : null,
    payableEntityId: e.settlementMethod === 'OPS_ADVANCE' ? e.forwarderId : e.supplierId, photoStorageKeys: photos.map(p => p.key) };
}
export interface ExpenseAccountingSourceInput {
  sourceKind: ExpenseSourceKind; sourceId: number; shipmentId: number; shipmentContainerId?: number | null;
  tripId?: number | null; truckId?: number | null; customerId: number; expenseTypeCode: string; costGroup: ExpenseCostGroup | null;
  feeName: string; amount: number; customerChargeAmount: number | null; expenseDate: string;
  invoiceNumber?: string | null; invoiceDate?: string | null; payerKind: 'USER' | 'COMPANY' | 'SUPPLIER' | null;
  payerUserId?: number | null; payableEntityType?: 'FORWARDER' | 'DRIVER' | 'VENDOR' | 'CARRIER' | null; payableEntityId?: number | null;
  recordedById: number | null; note?: string | null; recoveryNote?: string | null; linkedTripExpenseId?: number | null; photoStorageKeys?: string[];
}

export async function lockExpenseSource(tx: Tx, kind: ExpenseSourceKind, id: number) {
  await lockApplicationOwnedUniqueness(tx, 'expense-accounting-source', [kind, id]);
  const [row] = await tx.select().from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, kind), eq(s.expenseAccountingSources.sourceId, id))).for('update');
  return row ? hydrateExpenseAccountingSource(tx, row) : undefined;
}

export async function assertExpenseSourceMutable(tx: Tx, row: ExpenseAccountingSource) {
  await assertShipmentAccountingUnlocked(tx, row.shipmentId);
  if (row.status !== 'RECORDED' || row.confirmedAt || row.reconciliationId) throw new ApiError(409, 'Khoản chi đã đối chiếu/quyết toán. Cần điều chỉnh có liên kết; không sửa đè.');
  const [allocation] = await tx.select({ id: s.expenseCashAllocations.id }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
    .where(and(eq(s.expenseCashAllocations.expenseAccountingSourceId, row.id), eq(s.expenseCashVouchers.status, 'RECORDED'))).limit(1);
  if (allocation) throw new ApiError(409, 'Khoản chi đã thu/chi tiền; không sửa đè.');
  if (row.linkedTripExpenseId) {
    const [claim] = await tx.select({ id: s.billingDocumentRecoverableClaims.id }).from(s.billingDocumentRecoverableClaims)
      .where(and(eq(s.billingDocumentRecoverableClaims.expenseId, row.linkedTripExpenseId), isNull(s.billingDocumentRecoverableClaims.releasedAt))).limit(1);
    if (claim) throw new ApiError(409, 'Khoản chi đang thuộc chứng từ khách hàng; cần xử lý chứng từ trước khi sửa.');
  }
}

export async function upsertExpenseAccountingSource(tx: Tx, input: ExpenseAccountingSourceInput) {
  expenseVndSchema.refine(n => n > 0).parse(input.amount);
  const charge = input.customerChargeAmount == null ? null : expenseVndSchema.parse(input.customerChargeAmount);
  expenseDateSchema.parse(input.expenseDate);
  if (input.invoiceDate) expenseDateSchema.parse(input.invoiceDate);
  const before = await lockExpenseSource(tx, input.sourceKind, input.sourceId);
  if (before) await assertExpenseSourceMutable(tx, before);
  const metadata = { payerKind: input.payerKind === 'SUPPLIER' ? null : input.payerKind, costGroup: input.costGroup, feeName: input.feeName, customerChargeAmount: charge == null ? null : String(charge),
    invoiceNumber: input.invoiceNumber?.trim() || null, invoiceDate: input.invoiceDate || null,
    recoveryNote: input.recoveryNote ?? null, photoStorageKeys: input.photoStorageKeys ?? before?.photoStorageKeys ?? [] };
  if (input.sourceKind === 'OPS') await tx.update(s.opsExpenseEntries).set(metadata).where(eq(s.opsExpenseEntries.id, input.sourceId));
  if (input.sourceKind === 'DRIVER') await tx.update(s.driverIncidentalCosts).set(metadata).where(eq(s.driverIncidentalCosts.id, input.sourceId));
  const values = { sourceKind: input.sourceKind, sourceId: input.sourceId, shipmentId: input.shipmentId,
    tripId: input.tripId ?? before?.tripId ?? null, linkedTripExpenseId: input.linkedTripExpenseId ?? before?.linkedTripExpenseId ?? null,
    recordedById: input.recordedById, updatedAt: new Date() };
  const [row] = before
    ? await tx.update(s.expenseAccountingSources).set({ ...values, version: before.version + 1 }).where(eq(s.expenseAccountingSources.id, before.id)).returning()
    : await tx.insert(s.expenseAccountingSources).values(values).returning();
  return hydrateExpenseAccountingSource(tx, row);
}

async function markLegacyExpenseLink(tx: Tx, source: ExpenseAccountingSource, actorId: number) {
  await tx.insert(s.auditLogs).values({ userId: actorId, message: 'EXPENSE_ACCOUNTING_LEGACY_LINKED',
    entityType: 'expense_accounting_source', entityId: source.id,
    payload: { sourceKind: source.sourceKind, sourceId: source.sourceId, paymentHistoryUnattributed: true } });
  return { ...source, paymentHistoryUnattributed: true };
}

export async function ensureTripExpenseAccountingSource(tx: Tx, expenseId: number, actorId: number, options: { nativeRecordedNow?: boolean } = {}) {
  const existing = await lockExpenseSource(tx, 'TRIP', expenseId);
  if (existing) return existing;
  const [alreadyLinked] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.linkedTripExpenseId, expenseId));
  if (alreadyLinked) return hydrateExpenseAccountingSource(tx, alreadyLinked);
  const [source] = await tx.select({ expense: s.tripExpenses, trip: s.trips }).from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId)).where(eq(s.tripExpenses.id, expenseId));
  if (!source?.trip.shipmentId) throw new ApiError(409, 'Chi phí phải liên kết lô hàng hợp lệ.');
  const e = source.expense;
  if (!['RECORDED', 'APPROVED'].includes(e.approvalStatus)) throw new ApiError(409, 'Chi phí nguồn chưa ghi nhận hoặc đã hủy.');
  const linked = await upsertExpenseAccountingSource(tx, {
    sourceKind: 'TRIP', sourceId: e.id, shipmentId: source.trip.shipmentId, tripId: source.trip.id, truckId: source.trip.truckId,
    customerId: source.trip.customerId, expenseTypeCode: e.expenseType, costGroup: e.costGroup, feeName: e.feeName ?? e.expenseType,
    amount: Number(e.buyAmount), customerChargeAmount: Number(e.sellAmount), expenseDate: e.expenseDate ?? String(source.trip.departureDate).slice(0, 10),
    invoiceNumber: e.invoiceNumber, invoiceDate: e.invoiceDate, payerKind: e.settlementMethod === 'OPS_ADVANCE' ? 'USER' : 'SUPPLIER',
    payerUserId: e.forwarderId, payableEntityType: e.settlementMethod === 'OPS_ADVANCE' ? 'FORWARDER' : e.supplierId ? 'VENDOR' : null,
    payableEntityId: e.settlementMethod === 'OPS_ADVANCE' ? e.forwarderId : e.supplierId,
    recordedById: e.createdBy, note: e.note, linkedTripExpenseId: e.id,
  });
  return options.nativeRecordedNow ? linked : markLegacyExpenseLink(tx, linked, actorId);
}

export async function ensureLegacyExpenseSource(tx: Tx, kind: ExpenseSourceKind, id: number, actorId: number) {
  const existing = await lockExpenseSource(tx, kind, id);
  if (existing) return existing;
  if (kind === 'TRIP') return ensureTripExpenseAccountingSource(tx, id, actorId);
  if (kind === 'OPS') {
    const [data] = await tx.select({ expense: s.opsExpenseEntries, shipment: s.shipments }).from(s.opsExpenseEntries)
      .innerJoin(s.shipments, eq(s.shipments.id, s.opsExpenseEntries.shipmentId)).where(eq(s.opsExpenseEntries.id, id));
    if (!data || !['RECORDED', 'APPROVED'].includes(data.expense.approvalStatus)) throw new ApiError(404, 'Không tìm thấy khoản chi đang ghi nhận.');
    const e = data.expense;
    if (!data.shipment.customerId) throw new ApiError(409, 'Lô hàng chưa có khách hàng.');
    if (e.opsSettlementId) throw new ApiError(409, 'Chi phí cũ đã quyết toán, chỉ được xem lịch sử.');
    const linked = await upsertExpenseAccountingSource(tx, { sourceKind: kind, sourceId: id, shipmentId: e.shipmentId,
      shipmentContainerId: e.shipmentContainerId, customerId: data.shipment.customerId, expenseTypeCode: e.expenseTypeCode,
      costGroup: null, feeName: e.expenseTypeCode, amount: Number(e.amount), customerChargeAmount: null, expenseDate: e.paidAt,
      payerKind: 'USER', payerUserId: e.paidById, payableEntityType: 'FORWARDER', payableEntityId: e.paidById,
      recordedById: null, note: e.note });
    return markLegacyExpenseLink(tx, linked, actorId);
  }
  if (kind === 'DRIVER') {
    const [data] = await tx.select({ expense: s.driverIncidentalCosts, trip: s.trips }).from(s.driverIncidentalCosts)
      .innerJoin(s.trips, eq(s.trips.id, s.driverIncidentalCosts.tripId)).where(eq(s.driverIncidentalCosts.id, id));
    if (!data?.trip.shipmentId) throw new ApiError(404, 'Không tìm thấy chi phí thuộc lô.');
    const [driver] = await tx.select({ userId: s.drivers.userId }).from(s.drivers).where(eq(s.drivers.id, data.expense.driverId));
    const e = data.expense;
    const linked = await upsertExpenseAccountingSource(tx, { sourceKind: kind, sourceId: id, shipmentId: data.trip.shipmentId,
      tripId: e.tripId, truckId: data.trip.truckId, customerId: data.trip.customerId, expenseTypeCode: e.costType,
      costGroup: e.costGroup, feeName: e.feeName ?? e.costType, amount: Number(e.amount),
      customerChargeAmount: e.customerChargeAmount == null ? null : Number(e.customerChargeAmount), expenseDate: e.occurredAt,
      invoiceNumber: e.invoiceNumber, invoiceDate: e.invoiceDate, recoveryNote: e.recoveryNote,
      payerKind: e.payerKind ?? 'USER', payerUserId: e.payerKind === 'COMPANY' ? null : driver?.userId,
      payableEntityType: e.payerKind === 'COMPANY' ? null : 'DRIVER', payableEntityId: e.payerKind === 'COMPANY' ? null : e.driverId,
      recordedById: e.recordedBy, note: e.note,
      photoStorageKeys: e.photoStorageKeys.length ? e.photoStorageKeys : e.receiptStorageKey ? [e.receiptStorageKey] : [] });
    const [nativeRecord] = await tx.select({ id: s.auditLogs.id }).from(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'driver_incidental_cost'), eq(s.auditLogs.entityId, e.id),
      eq(s.auditLogs.message, 'DRIVER_INCIDENTAL_COST_RECORDED'))).limit(1);
    return nativeRecord ? linked : markLegacyExpenseLink(tx, linked, actorId);
  }
  throw new ApiError(404, 'Không tìm thấy nguồn chi phí.');
}

export async function assertActiveExpensePayer(tx: Tx, userId: number) {
  const [user] = await tx.select().from(s.users).where(and(eq(s.users.id, userId), eq(s.users.status, 'ACTIVE'))).limit(1);
  if (!user) throw new ApiError(400, 'Người thực chi không hoạt động.');
  return user;
}
