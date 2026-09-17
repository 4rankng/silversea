import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { Role, type ExpenseAccountingEntry, type ExpenseWorkRow } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { listExpenseAccountingWork, filterExpenseWorkRow } from '../services/expense-accounting-work.service';
import { insertTripComposite } from '../services/trip-composite.service';
import { expenseAccountingReportRows } from '../services/expense-accounting-reads.service';

after(async () => { await client.end({ timeout: 5 }); });
const entry = (id: number, confirmed: boolean): ExpenseAccountingEntry => ({ sourceKind: 'OPS', sourceId: id, tripId: 1, status: 'RECORDED', confirmedAt: confirmed ? '2026-09-15T00:00:00Z' : null,
  costGroup: 'OPS_REGULAR', feeName: id === 1 ? 'Kiểm hóa đặc biệt' : 'Giao nhận', customerChargeAmount: 300, amount: 500, payerKind: 'USER', payableEntityId: 10,
  payerUserId: 10, customerId: 2, customerName: 'Khách A', receivedAmount: 100, outstandingReceivable: 200, carrierCode: null } as ExpenseAccountingEntry);
const work = { id: 'TRIP:1', tripId: 1, shipmentCode: 'S1', customerName: 'Khách A', factoryName: 'Nhà máy B', entries: [entry(1, true), entry(2, false)], scheduledAt: '2026-09-16T17:30:00Z' } as ExpenseWorkRow;
test('FIX-WS-14/15: shown Vietnam day, fee name, factory and confirmation constrain work and matching sources', () => {
  const base = { page: 1, limit: 25 };
  assert.equal(filterExpenseWorkRow(work, { ...base, from: '2026-09-17', to: '2026-09-17' }).length, 1);
  assert.equal(filterExpenseWorkRow(work, { ...base, to: '2026-09-16' }).length, 0);
  const matched = filterExpenseWorkRow(work, { ...base, confirmed: 'true', search: 'kiểm hóa' });
  assert.deepEqual(matched[0].entries.map(e => e.sourceId), [1]);
  assert.equal(matched[0].receivable, 300);
  assert.equal(matched[0].payable, 500);
  assert.equal(filterExpenseWorkRow(work, { ...base, confirmed: 'false', search: 'kiểm hóa' }).length, 0);
  assert.equal(filterExpenseWorkRow(work, { ...base, search: 'nhà máy b' }).length, 1);
});
test('FIX-WS-13: report groups expose exactly the contributing as-of entries without altering totals', () => {
  const rows = [entry(1, true), { ...entry(2, false), costGroup: 'INVOICED_LIFT' as const, customerChargeAmount: 200, receivedAmount: 0, outstandingReceivable: 200 }];
  const report = expenseAccountingReportRows(rows, 'IN');
  assert.deepEqual(report.items[0].entries, rows);
  assert.equal(report.items[0].total, 500);
  assert.equal(report.items[0].settled, 100);
  assert.equal(report.items[0].outstanding, 400);
});
test('FIX-WS-06/16: persisted canonical road totals and distinct factory include work without submitted expense', async () => {
  const rollback = Symbol('rollback own work fixture');
  try { await db.transaction(async tx => {
    const marker = `work-fix-${crypto.randomUUID()}`;
    const [customer] = await tx.insert(s.customers).values({ name: marker }).returning();
    const [shipment] = await tx.insert(s.shipments).values({ customerId: customer.id, shipmentCode: marker.slice(0, 50), factoryName: 'Distinct factory', plannedReturnAt: new Date('2026-09-20T01:30:00Z') }).returning();
    const [route] = await tx.insert(s.routes).values({ name: marker }).returning();
    const [cargo] = await tx.insert(s.cargoTypes).values({ name: marker }).returning();
    const trip = await insertTripComposite(tx, { tripCode: marker.slice(0, 50), customerId: customer.id, shipmentId: shipment.id, routeId: route.id, cargoTypeId: cargo.id, departureDate: '2026-09-16', carrierType: 'OWN', totalRoadAllowance: '300000', vehicleShiftAllowance: '200000', tollCost: '80000', reconciledTollCost: '80000', reconciledExtraCost: '20000' });
    const list = await listExpenseAccountingWork({ userId: 0, role: Role.ACCOUNTANT }, { page: 1, limit: 25, shipmentId: shipment.id, from: '2026-09-20', to: '2026-09-20' }, tx);
    assert.equal(list.items[0].tripId, trip.id); assert.equal(list.items[0].factoryName, 'Distinct factory');
    assert.equal(list.items[0].road, 600000); assert.equal(list.totals.road, 600000);
    assert.deepEqual(list.items[0].roadBreakdown, { roadAllowance: 300000, shiftAllowance: 200000, toll: 80000, extra: 20000, tollBasis: 'ACTUAL', sharedWithTripId: null });
    await tx.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, trip.id));
    const unknown = await listExpenseAccountingWork({ userId: 0, role: Role.ACCOUNTANT }, { page: 1, limit: 25, shipmentId: shipment.id }, tx);
    assert.equal(unknown.items[0].road, null, 'missing norm is not a fabricated zero');
    throw rollback;
  }); } catch (error) { if (error !== rollback) throw error; }
});

test('FIX-WS-INVOICE-GROUP: linked invoices keep supplier identity across internal and external transport work', () => {
  const invoice = { ...entry(3, false), sourceKind: 'INVOICE' as const, costGroup: 'INVOICE_SERVICE' as const, amount: 50000, customerChargeAmount: 0,
    payableEntityType: 'VENDOR' as const, payableEntityId: 17, carrierCode: 'SILVERSEA_INTERNAL', carrierName: 'SilverSea', paidAmount: 0, allocatedAdvanceAmount: 0, outstandingPayable: 50000 };
  const report = expenseAccountingReportRows([invoice, { ...invoice, sourceId: 4, carrierCode: 'SUPPLIER:12', carrierName: 'External carrier' }], 'OUT');
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].entityType, 'VENDOR'); assert.equal(report.items[0].entityId, 17);
  assert.equal(report.items[0].carrierCode, null); assert.equal(report.items[0].total, 100000);
});
