import { eq } from 'drizzle-orm';
import { Role, type ExpenseAccountingCreate } from '@tingting/shared';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { ensureTripExpenseAccountingSource, upsertExpenseAccountingSource } from './expense-accounting-source.service';
import { requireExpenseFinance, syncExpenseBillingSource, type ExpenseActor } from './expense-accounting-write.service';

export async function createAccountingExpense(tx: Tx, actor: ExpenseActor, input: ExpenseAccountingCreate) {
  requireExpenseFinance(actor);
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
