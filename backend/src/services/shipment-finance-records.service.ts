import { and, asc, count, desc, eq, gte, ilike, isNull, lt, lte, ne, or, type SQL } from 'drizzle-orm';
import { Role, type ContainerDepositInput, type ContainerDepositRecord, type ShipmentInvoiceRecordInput } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { assertExpenseSourceMutable, ensureTripExpenseAccountingSource, lockExpenseSource, upsertExpenseAccountingSource } from './expense-accounting-source.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { lockShipment } from './shipment-accounting-lock-shared.service';

const writers: Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];
const readers: Role[] = [...writers, Role.CUS];
export const canWriteShipmentFinance = (actor: Pick<AuthUser, 'role'>) => writers.includes(actor.role);

export function depositStatus(amount: string, recovered: string, submitted: string | null): ContainerDepositRecord['status'] {
  if (BigInt(recovered) >= BigInt(amount)) return 'REFUNDED';
  if (BigInt(recovered) > 0n) return 'PARTIAL';
  return submitted ? 'WAITING_REFUND' : 'WAITING_DOCUMENTS';
}

export interface ShipmentFinanceFilter {
  shipmentId?: number;
  search?: string;
  from?: string;
  to?: string;
  depositState?: 'OPEN' | 'REFUNDED';
  page: number;
  pageSize: number;
}

export async function listShipmentFinanceRecords(actor: AuthUser, filters: ShipmentFinanceFilter, transaction?: Tx) {
  const q = transaction ?? db;
  if (!readers.includes(actor.role) || (actor.role === Role.CUS && !filters.shipmentId)) {
    throw new ApiError(403, 'Bạn không có quyền xem sổ chi phí này.');
  }
  if (filters.shipmentId) {
    if (transaction) await assertActorCanAccessShipment(transaction, filters.shipmentId, actor);
    else await db.transaction((tx) => assertActorCanAccessShipment(tx, filters.shipmentId!, actor));
  }
  const canWrite = canWriteShipmentFinance(actor);
  const search = filters.search?.trim().replace(/[\\%_]/g, '\\$&');
  const pattern = search ? `%${search}%` : undefined;
  const common: SQL[] = [isNull(s.shipments.deletedAt)];
  if (filters.shipmentId) common.push(eq(s.shipments.id, filters.shipmentId));
  const invoiceWhere = and(...common,
    filters.from ? gte(s.shipmentInvoiceRecords.invoiceDate, filters.from) : undefined,
    filters.to ? lte(s.shipmentInvoiceRecords.invoiceDate, filters.to) : undefined,
    pattern ? or(ilike(s.shipmentInvoiceRecords.invoiceNumber, pattern), ilike(s.shipments.blNumber, pattern),
      ilike(s.shipments.shipmentCode, pattern), ilike(s.customers.name, pattern)) : undefined);
  const depositWhere = and(...common,
    filters.from ? gte(s.containerDepositRecords.depositDate, filters.from) : undefined,
    filters.to ? lte(s.containerDepositRecords.depositDate, filters.to) : undefined,
    filters.depositState === 'OPEN' ? lt(s.containerDepositRecords.recoveredAmount, s.containerDepositRecords.amount) : undefined,
    filters.depositState === 'REFUNDED' ? gte(s.containerDepositRecords.recoveredAmount, s.containerDepositRecords.amount) : undefined,
    pattern ? or(ilike(s.containerDepositRecords.billNumber, pattern), ilike(s.containerDepositRecords.shippingLineName, pattern),
      ilike(s.shipments.shipmentCode, pattern), ilike(s.customers.name, pattern)) : undefined);
  const offset = (filters.page - 1) * filters.pageSize;
  const [invoices, invoiceCount, deposits, depositCount] = await Promise.all([
    q.select({ record: s.shipmentInvoiceRecords, shipmentCode: s.shipments.shipmentCode, customerName: s.customers.name, supplierName: s.suppliers.name })
      .from(s.shipmentInvoiceRecords).innerJoin(s.shipments, eq(s.shipments.id, s.shipmentInvoiceRecords.shipmentId))
      .innerJoin(s.suppliers, eq(s.suppliers.id, s.shipmentInvoiceRecords.supplierId))
      .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId)).where(invoiceWhere)
      .orderBy(desc(s.shipmentInvoiceRecords.invoiceDate), desc(s.shipmentInvoiceRecords.id)).limit(filters.pageSize).offset(offset),
    q.select({ total: count() }).from(s.shipmentInvoiceRecords)
      .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentInvoiceRecords.shipmentId))
      .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId)).where(invoiceWhere),
    canWrite ? q.select({ record: s.containerDepositRecords, shipmentCode: s.shipments.shipmentCode, customerName: s.customers.name })
      .from(s.containerDepositRecords).innerJoin(s.shipments, eq(s.shipments.id, s.containerDepositRecords.shipmentId))
      .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId)).where(depositWhere)
      .orderBy(desc(s.containerDepositRecords.depositDate), desc(s.containerDepositRecords.id)).limit(filters.pageSize).offset(offset) : [],
    canWrite ? q.select({ total: count() }).from(s.containerDepositRecords)
      .innerJoin(s.shipments, eq(s.shipments.id, s.containerDepositRecords.shipmentId))
      .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId)).where(depositWhere) : [],
  ]);
  return {
    invoices: invoices.map(({ record, ...labels }) => ({ ...record, ...labels })),
    deposits: deposits.map(({ record, ...labels }) => ({ ...record, ...labels,
      outstandingAmount: (BigInt(record.amount) - BigInt(record.recoveredAmount)).toString(),
      status: depositStatus(record.amount, record.recoveredAmount, record.documentsSubmittedDate),
    })),
    canWrite, invoiceTotal: invoiceCount[0]?.total ?? 0, depositTotal: depositCount[0]?.total ?? 0,
    page: filters.page, pageSize: filters.pageSize,
  };
}

async function writableShipment(tx: Tx, shipmentId: number, actor: AuthUser) {
  if (!canWriteShipmentFinance(actor)) throw new ApiError(403, 'Chỉ kế toán hoặc quản lý được ghi hồ sơ tài chính.');
  const shipment = await assertActorCanAccessShipment(tx, shipmentId, actor, { write: true });
  await assertShipmentAccountingUnlocked(tx, shipmentId);
  return shipment;
}

async function auditRecord(tx: Tx, shipmentId: number, actor: AuthUser, kind: string, before: unknown, after: unknown) {
  await tx.insert(s.auditLogs).values({ userId: actor.userId, actorName: actor.fullName ?? actor.username,
    entityType: kind, entityId: shipmentId, message: `Cập nhật ${kind === 'container-deposit' ? 'cược container' : 'hóa đơn kết hợp'}`,
    payload: { before: before ?? null, after },
  });
}

export async function saveShipmentInvoiceRecord(tx: Tx, shipmentId: number, input: ShipmentInvoiceRecordInput, actor: AuthUser) {
  await assertActorCanAccessShipment(tx, shipmentId, actor, { write: true });
  const shipmentTrips = await tx.select({ id: s.trips.id }).from(s.trips).where(eq(s.trips.shipmentId, shipmentId));
  await lockTripFinancialAuthority(tx, shipmentTrips.map(trip => trip.id));
  const shipment = await writableShipment(tx, shipmentId, actor);
  if (!shipment.customerId) throw new ApiError(400, 'Chọn khách hàng cho lô trước khi ghi chi phí hóa đơn.');
  const [supplier] = await tx.select({ id: s.suppliers.id }).from(s.suppliers).where(and(
    eq(s.suppliers.id, input.supplierId), eq(s.suppliers.status, 'ACTIVE'), isNull(s.suppliers.deletedAt),
  )).limit(1);
  if (!supplier) throw new ApiError(400, 'Nhà cung cấp không còn hoạt động.');
  const [existing] = input.id ? await tx.select().from(s.shipmentInvoiceRecords).where(and(
    eq(s.shipmentInvoiceRecords.id, input.id), eq(s.shipmentInvoiceRecords.shipmentId, shipmentId),
  )).for('update') : [];
  if (input.id && (!existing || existing.version !== input.expectedVersion)) {
    throw new ApiError(409, 'Hồ sơ hóa đơn đã thay đổi. Tải lại trước khi sửa.');
  }
  if (existing && existing.sourceExpenseId !== (input.sourceExpenseId ?? null)) {
    throw new ApiError(409, 'Không thể đổi nguồn chi phí của hóa đơn đã ghi.');
  }
  if (existing && !existing.sourceExpenseId) {
    const source = await lockExpenseSource(tx, 'INVOICE', existing.id);
    if (source) await assertExpenseSourceMutable(tx, source);
  }
  const [duplicate] = await tx.select({ id: s.shipmentInvoiceRecords.id }).from(s.shipmentInvoiceRecords).where(and(
    eq(s.shipmentInvoiceRecords.shipmentId, shipmentId), eq(s.shipmentInvoiceRecords.supplierId, input.supplierId),
    eq(s.shipmentInvoiceRecords.invoiceNumber, input.invoiceNumber), input.id ? ne(s.shipmentInvoiceRecords.id, input.id) : undefined,
  )).limit(1);
  if (duplicate) throw new ApiError(409, 'Hóa đơn của nhà cung cấp này đã có trong lô.');
  if (input.sourceExpenseId) {
    const [expense] = await tx.select({ expense: s.tripExpenses, shipmentId: s.trips.shipmentId }).from(s.tripExpenses)
      .innerJoin(s.trips, and(eq(s.trips.id, s.tripExpenses.tripId), isNull(s.trips.deletedAt)))
      .where(eq(s.tripExpenses.id, input.sourceExpenseId)).for('update', { of: s.tripExpenses });
    if (!expense || expense.shipmentId !== shipmentId || expense.expense.supplierId !== input.supplierId
      || Number(expense.expense.buyAmount) !== input.supplierFeeAmount || !['RECORDED', 'APPROVED'].includes(expense.expense.approvalStatus)) {
      throw new ApiError(400, 'Chi phí nguồn phải cùng lô, nhà cung cấp, số phải trả và đã ghi nhận.');
    }
    const [linked] = await tx.select({ id: s.shipmentInvoiceRecords.id }).from(s.shipmentInvoiceRecords).where(and(
      eq(s.shipmentInvoiceRecords.sourceExpenseId, input.sourceExpenseId),
      input.id ? ne(s.shipmentInvoiceRecords.id, input.id) : undefined,
    )).limit(1);
    if (linked) throw new ApiError(409, 'Chi phí nguồn đã được liên kết với một hồ sơ hóa đơn khác.');
    await ensureTripExpenseAccountingSource(tx, input.sourceExpenseId, actor.userId);
  }
  const values = { shipmentId, supplierId: input.supplierId, invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate, faceAmount: String(input.faceAmount), supplierFeeAmount: String(input.supplierFeeAmount),
    sourceExpenseId: input.sourceExpenseId ?? null, note: input.note ?? null, updatedBy: actor.userId, updatedAt: new Date(),
  };
  const [record] = existing
    ? await tx.update(s.shipmentInvoiceRecords).set({ ...values, version: existing.version + 1 }).where(eq(s.shipmentInvoiceRecords.id, existing.id)).returning()
    : await tx.insert(s.shipmentInvoiceRecords).values({ ...values, createdBy: actor.userId }).returning();
  if (!input.sourceExpenseId) await upsertExpenseAccountingSource(tx, {
    sourceKind: 'INVOICE', sourceId: record.id, shipmentId, customerId: shipment.customerId,
    expenseTypeCode: 'INVOICE_SERVICE', costGroup: 'INVOICE_SERVICE', feeName: 'Chi phí hóa đơn',
    amount: input.supplierFeeAmount, customerChargeAmount: 0, expenseDate: input.invoiceDate,
    invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, payerKind: 'SUPPLIER',
    payableEntityType: 'VENDOR', payableEntityId: input.supplierId, recordedById: actor.userId,
    note: input.note, recoveryNote: 'Chi phí hóa đơn nội bộ, không thu khách.',
  });
  await auditRecord(tx, shipmentId, actor, 'shipment-invoice', existing, record);
  return record;
}

export async function saveContainerDepositRecord(tx: Tx, shipmentId: number, input: ContainerDepositInput, actor: AuthUser) {
  if (!canWriteShipmentFinance(actor)) throw new ApiError(403, 'Chỉ kế toán hoặc quản lý được ghi hồ sơ tài chính.');
  await assertActorCanAccessShipment(tx, shipmentId, actor, { write: true });
  await lockShipment(tx, shipmentId);
  const [existing] = input.id ? await tx.select().from(s.containerDepositRecords).where(and(
    eq(s.containerDepositRecords.id, input.id), eq(s.containerDepositRecords.shipmentId, shipmentId),
  )).for('update') : [];
  if (input.id && (!existing || existing.version !== input.expectedVersion)) {
    throw new ApiError(409, 'Hồ sơ cược đã thay đổi. Tải lại trước khi sửa.');
  }
  const changesPrincipal = !existing || existing.amount !== String(input.amount)
    || existing.billNumber !== input.billNumber || existing.shippingLineName !== input.shippingLineName
    || existing.depositDate !== input.depositDate;
  if (changesPrincipal) await assertShipmentAccountingUnlocked(tx, shipmentId);
  const values = { shipmentId, billNumber: input.billNumber, shippingLineName: input.shippingLineName,
    amount: String(input.amount), depositDate: input.depositDate, documentsSubmittedDate: input.documentsSubmittedDate ?? null,
    refundReceivedDate: input.refundReceivedDate ?? null, recoveredAmount: String(input.recoveredAmount),
    note: input.note ?? null, updatedBy: actor.userId, updatedAt: new Date(),
  };
  const [record] = existing
    ? await tx.update(s.containerDepositRecords).set({ ...values, version: existing.version + 1 }).where(eq(s.containerDepositRecords.id, existing.id)).returning()
    : await tx.insert(s.containerDepositRecords).values({ ...values, createdBy: actor.userId }).returning();
  await auditRecord(tx, shipmentId, actor, 'container-deposit', existing, record);
  return record;
}

export async function shipmentFinanceOptions(actor: AuthUser, shipmentId?: number) {
  if (!canWriteShipmentFinance(actor)) throw new ApiError(403, 'Bạn không có quyền ghi chi phí.');
  const suppliers = await db.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers)
    .where(and(eq(s.suppliers.status, 'ACTIVE'), isNull(s.suppliers.deletedAt))).orderBy(asc(s.suppliers.name));
  if (shipmentId) await db.transaction((tx) => assertActorCanAccessShipment(tx, shipmentId, actor));
  const expenses = shipmentId ? await db.select({ id: s.tripExpenses.id, supplierId: s.tripExpenses.supplierId,
    buyAmount: s.tripExpenses.buyAmount, expenseType: s.tripExpenses.expenseType, invoiceNumber: s.tripExpenses.invoiceNumber,
  }).from(s.tripExpenses).innerJoin(s.trips, and(eq(s.trips.id, s.tripExpenses.tripId), isNull(s.trips.deletedAt)))
    .where(and(eq(s.trips.shipmentId, shipmentId), or(eq(s.tripExpenses.approvalStatus, 'RECORDED'), eq(s.tripExpenses.approvalStatus, 'APPROVED'))))
    .orderBy(desc(s.tripExpenses.id)) : [];
  return { suppliers, expenses };
}
