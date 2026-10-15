import { eq } from 'drizzle-orm';
import { Role, type ExpenseAccountingCreate } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { assertShipmentAccountingUnlocked, assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { assertActiveExpensePayer, ensureTripExpenseAccountingSource, upsertExpenseAccountingSource, type ExpenseAccountingSource } from './expense-accounting-source.service';
import { requireExpenseFinance, syncExpenseBillingSource, type ExpenseActor } from './expense-accounting-write.service';

export async function createAccountingExpense(tx: Tx, actor: ExpenseActor, input: ExpenseAccountingCreate): Promise<ExpenseAccountingSource> {
  requireExpenseFinance(actor);
  // Card 20261005 — a shipment-level expense needs NO trip: lô hàng chưa có
  // chuyến vận chuyển vẫn khai được chi phí. The lot branch writes the native
  // row + accounting source keyed by the lot only (tripId = null) and never
  // touches driver/trip-expense paths.
  if (input.tripId == null) return createShipmentLevelAccountingExpense(tx, actor, input);
  await lockTripFinancialAuthority(tx, [input.tripId]);
  await assertTripShipmentAccountingUnlocked(tx, input.tripId);
  const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, input.tripId)).for('update');
  if (!trip?.shipmentId || trip.deletedAt || trip.status === 'CANCELED') throw new ApiError(409, 'Chọn chuyến đang hoạt động và thuộc lô hàng.');
  if (input.costGroup === 'DRIVER_ROAD' && input.customerChargeAmount !== 0) throw new ApiError(400, 'Tiền đường không thu khách.');
  const [payer] = input.payerKind === 'USER' && input.payerUserId ? await tx.select().from(s.users).where(eq(s.users.id, input.payerUserId)) : [];
  if (input.payerKind === 'USER') {
    if (!payer || (payer.role !== Role.OPS && payer.role !== Role.DRIVER) || payer.status !== 'ACTIVE') throw new ApiError(400, 'Chọn nhân viên Ops hoặc lái xe đang hoạt động.');
  }
  const driverExpense = payer?.role === Role.DRIVER || ['DRIVER_ROAD', 'DRIVER_SHIPMENT'].includes(input.costGroup);
  if (driverExpense) {
      const [driver] = trip.driverId ? await tx.select().from(s.drivers).where(eq(s.drivers.id, trip.driverId)) : [];
      if (!driver || driver.status !== 'ACTIVE') throw new ApiError(400, 'Công việc chưa có lái xe đang hoạt động.');
      if (input.payerKind === 'SUPPLIER' || (input.payerKind === 'USER' && payer?.id !== driver.userId)) throw new ApiError(400, 'Chi phí lái xe phải do công ty hoặc lái xe được phân công thanh toán.');
      const companyPaid = input.payerKind === 'COMPANY';
      const [entry] = await tx.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id,
        costType: input.driverCostType ?? 'OTHER',
        payerKind: companyPaid ? 'COMPANY' : 'USER', costGroup: input.costGroup, feeName: input.feeName, amount: String(input.amount),
        driverEnteredAmount: String(input.amount),
        customerChargeAmount: String(input.customerChargeAmount), occurredAt: input.expenseDate,
        invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, note: input.note, recoveryNote: input.recoveryNote,
        recordedBy: actor.userId,
      }).returning();
      return upsertExpenseAccountingSource(tx, { sourceKind: 'DRIVER', sourceId: entry.id, shipmentId: trip.shipmentId,
        tripId: trip.id, customerId: trip.customerId, expenseTypeCode: entry.costType, costGroup: entry.costGroup,
        feeName: input.feeName, amount: input.amount, customerChargeAmount: input.customerChargeAmount,
        expenseDate: input.expenseDate, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate,
        payerKind: companyPaid ? 'COMPANY' : 'USER', payerUserId: companyPaid ? null : driver.userId,
        payableEntityType: companyPaid ? null : 'DRIVER', payableEntityId: companyPaid ? null : driver.id,
        recordedById: actor.userId, note: input.note, recoveryNote: input.recoveryNote });
  }
  if (input.driverCostType) throw new ApiError(400, 'Loại phí lái xe chỉ dùng cho khoản chi lái xe.');
  const [type] = await tx.select().from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.code, input.expenseTypeCode));
  if (!type || type.status !== 'ACTIVE') throw new ApiError(400, 'Loại chi phí không hoạt động.');
  if (input.payerKind === 'SUPPLIER') {
    const [supplier] = input.supplierId ? await tx.select().from(s.suppliers).where(eq(s.suppliers.id, input.supplierId)) : [];
    if (!supplier || supplier.status !== 'ACTIVE') throw new ApiError(400, 'Chọn nhà cung cấp đang hoạt động.');
  }
  if (input.payerKind === 'USER' && payer?.role === Role.OPS) {
    const [entry] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: trip.shipmentId,
      expenseTypeCode: input.expenseTypeCode, amount: String(input.amount), customerChargeAmount: String(input.customerChargeAmount),
      paidAt: input.expenseDate, paidById: payer.id, payerKind: 'USER', costGroup: input.costGroup,
      feeName: input.feeName, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate,
      recoveryNote: input.recoveryNote, approvalStatus: 'RECORDED', note: input.note }).returning();
    const source = await upsertExpenseAccountingSource(tx, { sourceKind: 'OPS', sourceId: entry.id,
      shipmentId: trip.shipmentId, tripId: trip.id, customerId: trip.customerId,
      expenseTypeCode: input.expenseTypeCode, costGroup: input.costGroup, feeName: input.feeName,
      amount: input.amount, customerChargeAmount: input.customerChargeAmount, expenseDate: input.expenseDate,
      invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, payerKind: 'USER', payerUserId: payer.id,
      payableEntityType: 'FORWARDER', payableEntityId: payer.id, recordedById: actor.userId,
      note: input.note, recoveryNote: input.recoveryNote });
    return syncExpenseBillingSource(tx, source, actor.userId);
  }
  const [entry] = await tx.insert(s.tripExpenses).values({ tripId: input.tripId, expenseType: input.expenseTypeCode,
    buyAmount: String(input.amount), sellAmount: String(input.customerChargeAmount),
    costGroup: input.costGroup, feeName: input.feeName, recoveryNote: input.recoveryNote,
    expenseDate: input.expenseDate, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate,
    settlementMethod: input.payerKind === 'USER' ? 'OPS_ADVANCE' : 'COMPANY_DIRECT',
    forwarderId: input.payerKind === 'USER' ? input.payerUserId : null,
    supplierId: input.payerKind === 'SUPPLIER' ? input.supplierId : null,
    approvalStatus: 'RECORDED', createdBy: actor.userId, note: input.note,
  }).returning();
  return ensureTripExpenseAccountingSource(tx, entry.id, actor.userId, { nativeRecordedNow: true });
}

/**
 * Card 20261005 — khoản chi mức lô, không cần chuyến. The lot is the anchor:
 * the row lands in `ops_expense_entries` (the only native expense table keyed
 * by shipment alone) and its accounting source carries tripId = null, so
 * dispatch's later trip link (`syncShipmentExpenseSources`) is free to attach
 * real work without this path ever inventing one. `expenseTypeCode` is the
 * house 'OTHER' — the operator's `feeName` is the identity shown everywhere
 * (card 071026141580), and a machine type code has no meaning outside a
 * trip/Ops classification.
 */
async function createShipmentLevelAccountingExpense(tx: Tx, actor: ExpenseActor, input: ExpenseAccountingCreate): Promise<ExpenseAccountingSource> {
  const [shipment] = await tx.select().from(s.shipments).where(eq(s.shipments.id, input.shipmentId));
  if (!shipment || shipment.deletedAt || shipment.customerId == null) throw new ApiError(404, 'Không tìm thấy lô hàng.');
  await assertShipmentAccountingUnlocked(tx, input.shipmentId);
  // Same money invariant as the trip path: a road allowance is never charged back to the customer.
  if (input.costGroup === 'DRIVER_ROAD' && input.customerChargeAmount !== 0) throw new ApiError(400, 'Tiền đường không thu khách.');
  const paidUserId = input.payerKind === 'USER' ? input.payerUserId ?? null : null;
  if (input.payerKind === 'USER') {
    if (paidUserId == null) throw new ApiError(400, 'Chọn người thực chi.');
    await assertActiveExpensePayer(tx, paidUserId);
  }
  if (input.payerKind === 'SUPPLIER') {
    const [supplier] = input.supplierId ? await tx.select().from(s.suppliers).where(eq(s.suppliers.id, input.supplierId)) : [];
    if (!supplier || supplier.status !== 'ACTIVE') throw new ApiError(400, 'Chọn nhà cung cấp đang hoạt động.');
  }
  const [entry] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: input.shipmentId, shipmentContainerId: null,
    expenseTypeCode: 'OTHER', amount: String(input.amount), customerChargeAmount: String(input.customerChargeAmount),
    paidAt: input.expenseDate, paidById: paidUserId,
    // `payer_kind` is typed USER | COMPANY on the native row: a SUPPLIER payer
    // has no employee behind it, so it records like a direct company payment
    // (paidById stays NULL) and the supplier is named on the source below.
    payerKind: input.payerKind === 'SUPPLIER' ? null : input.payerKind,
    costGroup: input.costGroup, feeName: input.feeName, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate,
    recoveryNote: input.recoveryNote, approvalStatus: 'RECORDED', note: input.note }).returning();
  return upsertExpenseAccountingSource(tx, { sourceKind: 'OPS', sourceId: entry.id,
    shipmentId: input.shipmentId, shipmentContainerId: null, tripId: null,
    customerId: shipment.customerId, expenseTypeCode: entry.expenseTypeCode, costGroup: input.costGroup,
    feeName: input.feeName, amount: input.amount, customerChargeAmount: input.customerChargeAmount,
    expenseDate: input.expenseDate, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate,
    payerKind: input.payerKind, payerUserId: paidUserId,
    payableEntityType: input.payerKind === 'USER' ? 'FORWARDER' : input.payerKind === 'SUPPLIER' ? 'VENDOR' : null,
    payableEntityId: input.payerKind === 'USER' ? paidUserId : input.payerKind === 'SUPPLIER' ? input.supplierId ?? null : null,
    recordedById: actor.userId, note: input.note, recoveryNote: input.recoveryNote });
}
