import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import { Role, DriverIncidentalCostType, TripStatus } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import type { Tx } from '../services/trip-shared';
import { upsertExpenseAccountingSource, ensureTripExpenseAccountingSource, ensureLegacyExpenseSource } from '../services/expense-accounting-source.service';
import { confirmAccountingExpenses, updateAccountingExpense, syncShipmentExpenseSources } from '../services/expense-accounting-write.service';
import { getExpenseAccountingEntry, listExpenseAccountingEntries, getExpenseAccountingReport } from '../services/expense-accounting-reads.service';
import { authorizeExpensePhoto } from '../services/photo-authz.service';
import { TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE } from '../services/trip-financial-authority-lock.service';
import { insertTripComposite, getTripCompositeInTx, upsertTripFinancialState } from '../services/trip-composite.service';
import { refreshExpenseTripCosts } from '../services/expense-trip-cost.service';
import { createAccountingExpense } from '../services/expense-accounting-create.service';
import { autoOffsetRecordedExpense } from '../services/advance-shared.service';
import { getAdvanceConsumedAmounts } from '../services/advance-consumption.service';
import { createExpenseReconciliation, recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { createExpenseVoucher } from '../services/expense-accounting-voucher.service';
import { applyTripPairLifecycleEffects, createTripPair } from '../services/trip-pairs.service';

after(async () => { await client.end(); });
async function fixture(run: (tx: Tx, ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const rollback = Symbol('rollback expense source fixture');
  try { await db.transaction(async tx => { await run(tx, await setup(tx)); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}
async function setup(tx: Tx) {
  const key = crypto.randomUUID();
  const [user] = await tx.insert(s.users).values({ username: key, passwordHash: 'fixture', role: Role.OPS }).returning();
  const [accountant] = await tx.insert(s.users).values({ username: `${key}-kt`, passwordHash: 'fixture', role: Role.ACCOUNTANT }).returning();
  const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
  const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: key, customerId: customer.id, createdBy: user.id }).returning();
  const [route] = await tx.insert(s.routes).values({ name: key }).returning();
  const [cargo] = await tx.insert(s.cargoTypes).values({ name: key }).returning();
  return { user, accountant, shipment, customer, route, cargo, actor: { userId: accountant.id, role: Role.ACCOUNTANT } };
}
async function ops(tx: Tx, ctx: Awaited<ReturnType<typeof setup>>, charge = 300_000) {
  const [native] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: ctx.shipment.id, expenseTypeCode: 'OTHER',
    amount: '500000', paidById: ctx.user.id, paidAt: '2026-09-16' }).returning();
  return upsertExpenseAccountingSource(tx, { sourceKind: 'OPS', sourceId: native.id, shipmentId: ctx.shipment.id,
    customerId: ctx.customer.id, expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR', feeName: 'Chi làm hàng', amount: 500_000,
    customerChargeAmount: charge, expenseDate: '2026-09-16', payerKind: 'USER', payerUserId: ctx.user.id,
    payableEntityType: 'FORWARDER', payableEntityId: ctx.user.id, recordedById: ctx.user.id });
}
async function trip(tx: Tx, ctx: Awaited<ReturnType<typeof setup>>) {
  const [container] = await tx.insert(s.shipmentContainers).values({ shipmentId: ctx.shipment.id, containerNumber: crypto.randomUUID().slice(0, 11) }).returning();
  const [fulfillment] = await tx.insert(s.shipmentFulfillments).values({ shipmentId: ctx.shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 }).returning();
  return insertTripComposite(tx, { tripCode: crypto.randomUUID(), shipmentId: ctx.shipment.id, customerId: ctx.customer.id,
    routeId: ctx.route.id, cargoTypeId: ctx.cargo.id, departureDate: '2026-09-16', status: 'CREATED', carrierType: 'OWN', fulfillmentId: fulfillment.id });
}
test('payables report names invoice suppliers from their canonical record, including inactive history', async () => fixture(async (tx, ctx) => {
  const [active, historical] = await tx.insert(s.suppliers).values([
    { name: 'A supplier still active', status: 'ACTIVE' },
    { name: 'Z supplier with historical invoices', status: 'ACTIVE' },
  ]).returning();
  for (const [supplierId, fee] of [[active.id, 50_000], [historical.id, 70_000], [historical.id, 30_000]]) {
    const [invoice] = await tx.insert(s.shipmentInvoiceRecords).values({ shipmentId: ctx.shipment.id, supplierId,
      invoiceNumber: crypto.randomUUID(), invoiceDate: '2026-09-16', faceAmount: '1000000', supplierFeeAmount: String(fee),
      createdBy: ctx.accountant.id, updatedBy: ctx.accountant.id }).returning();
    await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'INVOICE', sourceId: invoice.id,
      shipmentId: ctx.shipment.id, recordedById: ctx.accountant.id });
  }
  const query = { shipmentId: ctx.shipment.id, page: 1, limit: 100, direction: 'OUT' as const, asOfDate: '2026-09-16' };
  const activeReport = await getExpenseAccountingReport(ctx.actor, query, tx);
  assert.deepEqual(activeReport.items.map(row => ({ id: row.entityId, name: row.entityName, total: row.total })), [
    { id: active.id, name: active.name, total: 50_000 },
    { id: historical.id, name: historical.name, total: 100_000 },
  ]);
  await tx.update(s.suppliers).set({ status: 'INACTIVE' }).where(eq(s.suppliers.id, historical.id));
  const historicReport = await getExpenseAccountingReport(ctx.actor, query, tx);
  assert.deepEqual(historicReport.items, activeReport.items, 'inactive supplier names and invoice balances remain readable');
  assert.deepEqual(historicReport.totals, { lift: 0, drop: 0, other: 150_000, total: 150_000, settled: 0, outstanding: 150_000 });
}));

test('native OPS facts stay authoritative; confirmation creates no cash or fictitious trip', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  await tx.update(s.opsExpenseEntries).set({ amount: '510000' }).where(eq(s.opsExpenseEntries.id, source.sourceId));
  const read = await getExpenseAccountingEntry(ctx.actor, 'OPS', source.sourceId, tx);
  assert.equal(read.amount, 510_000);
  assert.equal(read.customerChargeAmount, 300_000);
  assert.equal(read.receivedAmount, 0);
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 1 }]);
  assert.equal(confirmed.tripId, null);
  assert.equal(confirmed.linkedTripExpenseId, null);
  assert.equal((await tx.select().from(s.trips).where(eq(s.trips.shipmentId, ctx.shipment.id))).length, 0);
  const ledger = await tx.select().from(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${source.id}`));
  assert.equal(ledger.length, 1); assert.equal(ledger[0].debit, '510000');
  assert.equal((await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.ledgerEntryId, ledger[0].id))).length, 0);
  await assert.rejects(confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 2 }]), /đã đối chiếu/);
}));

test('CUS retains companywide active shipment access but cannot read deleted lots or finance-only evidence', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  const cus = { userId: ctx.accountant.id, role: Role.CUS };
  const customer = { userId: ctx.accountant.id, role: Role.CUSTOMER };
  const active = await listExpenseAccountingEntries(cus, { page: 1, limit: 100 }, tx);
  assert.ok(active.items.some(row => row.sourceId === source.sourceId && row.sourceKind === 'OPS'), 'CUS sees a lot created by another staff member');
  assert.equal((await getExpenseAccountingEntry(cus, 'OPS', source.sourceId, tx)).shipmentId, ctx.shipment.id);
  const storageKey = `accounting-expense-photos/${source.id}/scope-fixture.jpg`;
  await tx.insert(s.expenseAccountingEvidence).values({ expenseAccountingSourceId: source.id, storageKey, uploadedById: ctx.accountant.id });
  assert.equal((await authorizeExpensePhoto(storageKey, cus, tx)).allow, false);
  assert.equal((await authorizeExpensePhoto(storageKey, ctx.actor, tx)).allow, true);
  await assert.rejects(listExpenseAccountingEntries(customer, { page: 1, limit: 100 }, tx), /quyền xem chi phí/);
  await assert.rejects(getExpenseAccountingEntry(customer, 'OPS', source.sourceId, tx), /quyền xem chi phí/);
  assert.equal((await authorizeExpensePhoto(storageKey, customer, tx)).allow, false);

  await tx.update(s.shipments).set({ deletedAt: new Date() }).where(eq(s.shipments.id, ctx.shipment.id));
  const deleted = await listExpenseAccountingEntries(cus, { page: 1, limit: 100 }, tx);
  assert.equal(deleted.items.some(row => row.sourceId === source.sourceId && row.sourceKind === 'OPS'), false);
  await assert.rejects(listExpenseAccountingEntries(cus, { shipmentId: ctx.shipment.id, page: 1, limit: 100 }, tx), /Không tìm thấy lô hàng/);
  await assert.rejects(listExpenseAccountingEntries(cus, { shipmentId: 2_147_483_647, page: 1, limit: 100 }, tx), /Không tìm thấy lô hàng/);
  await assert.rejects(getExpenseAccountingEntry(cus, 'OPS', source.sourceId, tx), /Không tìm thấy khoản chi/);
  await assert.rejects(updateAccountingExpense(tx, cus, 'OPS', source.sourceId, { expectedVersion: source.version, reason: 'Không sửa lô đã xóa', customerChargeAmount: 1 }), /Không tìm thấy lô hàng/);
}));

test('confirmation locks exact composite native keys when OPS and DRIVER IDs collide', async () => fixture(async (tx, ctx) => {
  const id = 2_146_000_000 + Math.floor(Math.random() * 100_000);
  const work = await trip(tx, ctx);
  const selectedWork = await trip(tx, ctx);
  const [driver] = await tx.insert(s.drivers).values({ name: crypto.randomUUID() }).returning();
  await tx.insert(s.opsExpenseEntries).values({ id, shipmentId: ctx.shipment.id, expenseTypeCode: 'OTHER', amount: '500000', paidById: ctx.user.id, paidAt: '2026-09-16' });
  const selected = await upsertExpenseAccountingSource(tx, { sourceKind: 'OPS', sourceId: id, shipmentId: ctx.shipment.id, tripId: selectedWork.id, customerId: ctx.customer.id,
    expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR', feeName: 'Selected fee', amount: 500000, customerChargeAmount: 0, expenseDate: '2026-09-16',
    payerKind: 'USER', payerUserId: ctx.user.id, payableEntityType: 'FORWARDER', payableEntityId: ctx.user.id, recordedById: ctx.user.id });
  await tx.insert(s.driverIncidentalCosts).values({ id, tripId: work.id, driverId: driver.id, costType: 'TOLL', amount: '80000', occurredAt: '2026-09-16' });
  await upsertExpenseAccountingSource(tx, { sourceKind: 'DRIVER', sourceId: id, shipmentId: ctx.shipment.id, tripId: work.id, customerId: ctx.customer.id,
    expenseTypeCode: 'TOLL', costGroup: 'DRIVER_ROAD', feeName: 'Unrelated fee', amount: 80000, customerChargeAmount: 0, expenseDate: '2026-09-16',
    payerKind: 'COMPANY', recordedById: ctx.accountant.id });
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: id, expectedVersion: selected.version }]);
  const locks = await tx.execute<{ objid: number }>(sql`SELECT objid::integer FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND classid = ${TRIP_FINANCIAL_AUTHORITY_LOCK_NAMESPACE}`);
  assert.equal(locks.some(lock => lock.objid === selectedWork.id), true, 'the selected OPS trip must hold its authority lock');
  assert.equal(locks.some(lock => lock.objid === work.id), false, 'unselected DRIVER trip must not be locked by an OPS serial-id collision');
}));

for (const sourceKind of ['DRIVER', 'TRIP'] as const) test(`historical ${sourceKind} source keeps cash history unknown after linkage`, async () => fixture(async (tx, ctx) => {
  const work = await trip(tx, ctx);
  const [driver] = await tx.insert(s.drivers).values({ name: crypto.randomUUID() }).returning();
  const [native] = sourceKind === 'DRIVER'
    ? await tx.insert(s.driverIncidentalCosts).values({ tripId: work.id, driverId: driver.id, costType: 'TOLL', amount: '80000', occurredAt: '2026-09-16' }).returning({ id: s.driverIncidentalCosts.id })
    : await tx.insert(s.tripExpenses).values({ tripId: work.id, expenseType: 'OTHER', buyAmount: '80000', sellAmount: '0', settlementMethod: 'COMPANY_DIRECT', approvalStatus: 'RECORDED' }).returning({ id: s.tripExpenses.id });
  const source = await ensureLegacyExpenseSource(tx, sourceKind, native.id, ctx.accountant.id);
  assert.equal(source.paymentHistoryUnattributed, true);
  const read = await getExpenseAccountingEntry(ctx.actor, sourceKind, native.id, tx);
  assert.equal(read.paidAmount, null); assert.equal(read.receivedAmount, null);
  await assert.rejects(confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind, sourceId: native.id, expectedVersion: source.version }]), /Lịch sử thu\/chi chưa được phân bổ/);
}));

test('linking a historical expense never invents zero paid or received balances', async () => fixture(async (tx, ctx) => {
  const [native] = await tx.insert(s.opsExpenseEntries).values({ shipmentId: ctx.shipment.id, expenseTypeCode: 'OTHER', amount: '500000',
    paidById: ctx.user.id, paidAt: '2026-09-16' }).returning();
  const before = await getExpenseAccountingEntry(ctx.actor, 'OPS', native.id, tx);
  assert.equal(before.receivedAmount, null); assert.equal(before.paidAmount, null);
  await ensureLegacyExpenseSource(tx, 'OPS', native.id, ctx.accountant.id);
  const linked = await getExpenseAccountingEntry(ctx.actor, 'OPS', native.id, tx);
  assert.equal(linked.receivedAmount, null); assert.equal(linked.paidAmount, null);
  assert.equal(linked.outstandingReceivable, null); assert.equal(linked.outstandingPayable, null);
  await assert.rejects(confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: native.id, expectedVersion: linked.version }]), /Lịch sử thu\/chi chưa được phân bổ/);
  await assert.rejects(createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.user.id, from: '2026-09-16', to: '2026-09-16',
    entries: [{ sourceKind: 'OPS', sourceId: native.id, expectedVersion: linked.version }], advances: [] }), /Lịch sử thu\/chi chưa được phân bổ/);
  for (const direction of ['IN', 'OUT'] as const) await assert.rejects(createExpenseVoucher(tx, ctx.actor, { direction,
    treasuryAccountId: 1, valueDate: '2026-09-16', physicalReference: crypto.randomUUID(),
    entries: [{ sourceKind: 'OPS', sourceId: native.id, expectedVersion: linked.version, amount: 100_000 }] }), /Lịch sử thu\/chi chưa được phân bổ/);
  assert.equal((await tx.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.opsUserId, ctx.user.id))).length, 0);
}));

test('an unrelated missing or deleted shipment source cannot poison valid expense list or detail reads', async () => fixture(async (tx, ctx) => {
  const valid = await ops(tx, ctx);
  await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: 2_145_999_999, shipmentId: 2_147_483_647 });
  const [deletedShipment] = await tx.insert(s.shipments).values({ shipmentCode: crypto.randomUUID(), customerId: ctx.customer.id,
    createdBy: ctx.user.id, deletedAt: new Date() }).returning();
  await tx.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: 2_145_999_998, shipmentId: deletedShipment.id });
  const list = await listExpenseAccountingEntries(ctx.actor, { page: 1, limit: 100, shipmentId: ctx.shipment.id }, tx);
  assert.equal(list.items.length, 1); assert.equal(list.items[0].sourceId, valid.sourceId);
  const all = await listExpenseAccountingEntries(ctx.actor, { page: 1, limit: 100 }, tx);
  assert.ok(all.items.some(row => row.sourceKind === 'OPS' && row.sourceId === valid.sourceId));
  assert.equal((await getExpenseAccountingEntry(ctx.actor, 'OPS', valid.sourceId, tx)).sourceId, valid.sourceId);
  await assert.rejects(getExpenseAccountingEntry(ctx.actor, 'OPS', 2_145_999_999, tx), /Không tìm thấy khoản chi/);
}));
test('dispatch binds a pre-trip source once; replay never creates a second trip expense', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx, 0);
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 1 }]);
  const work = await trip(tx, ctx);
  await syncShipmentExpenseSources(tx, ctx.shipment.id, ctx.accountant.id);
  await syncShipmentExpenseSources(tx, ctx.shipment.id, ctx.accountant.id);
  const read = await getExpenseAccountingEntry(ctx.actor, 'OPS', source.sourceId, tx);
  assert.equal(read.tripId, work.id);
  assert.ok(read.linkedTripExpenseId);
  const fees = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, work.id));
  assert.equal(fees.length, 1); assert.equal(fees[0].sellAmount, '0');
}));
test('multiple real trips require an explicit finance link, without overwriting confirmed money', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 1 }]);
  await trip(tx, ctx); const second = await trip(tx, ctx);
  await syncShipmentExpenseSources(tx, ctx.shipment.id, ctx.accountant.id);
  assert.equal((await getExpenseAccountingEntry(ctx.actor, 'OPS', source.sourceId, tx)).tripId, null);
  const linked = await updateAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: 2, reason: 'Chọn công việc chịu phí', tripId: second.id });
  assert.equal(linked.tripId, second.id); assert.equal(linked.amount, '500000');
  await assert.rejects(updateAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: 3, reason: 'Không sửa lịch sử', amount: 700_000 }), /không sửa đè/);
}));
test('company-paid expense does not create reimbursement liability and direct detail access respects ownership', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  const changed = await updateAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: 1, reason: 'Công ty đã chi trực tiếp', payerKind: 'COMPANY' });
  assert.equal(changed.payableEntityId, null);
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 2 }]);
  assert.equal((await tx.select().from(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${source.id}`))).length, 0);
  const own = await getExpenseAccountingEntry({ userId: ctx.user.id, role: Role.OPS }, 'OPS', source.sourceId, tx);
  assert.equal(own.outstandingPayable, 0);
  await assert.rejects(getExpenseAccountingEntry({ userId: ctx.accountant.id, role: Role.OPS }, 'OPS', source.sourceId, tx), /Không tìm thấy/);
}));
test('reconciled toll replaces estimated cost without changing agreed allowance or accumulating on replay', async () => fixture(async (tx, ctx) => {
  const [driverUser] = await tx.insert(s.users).values({ username: crypto.randomUUID(), passwordHash: 'fixture', role: Role.DRIVER }).returning();
  const [driver] = await tx.insert(s.drivers).values({ name: 'Fixture driver', userId: driverUser.id }).returning();
  const work = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), shipmentId: ctx.shipment.id, customerId: ctx.customer.id,
    routeId: ctx.route.id, cargoTypeId: ctx.cargo.id, departureDate: '2026-09-16', status: 'COMPLETED', completedAt: new Date('2026-09-16T09:00:00Z'), carrierType: 'OWN', driverId: driver.id,
    tollsStations: 1, tollPerStationApplied: '100000', tollCost: '100000', totalRoadAllowance: '200000', vehicleShiftAllowance: '150000', totalCost: '450000', grossProfit: '550000' });
  const [native] = await tx.insert(s.driverIncidentalCosts).values({ tripId: work.id, driverId: driver.id, costType: 'TOLL', amount: '80000', occurredAt: '2026-09-16', recordedBy: driverUser.id }).returning();
  const source = await upsertExpenseAccountingSource(tx, { sourceKind: 'DRIVER', sourceId: native.id, shipmentId: ctx.shipment.id, tripId: work.id,
    customerId: ctx.customer.id, expenseTypeCode: 'TOLL', costGroup: 'DRIVER_ROAD', feeName: 'Vé cầu đường', amount: 80000,
    customerChargeAmount: 0, expenseDate: '2026-09-16', payerKind: 'USER', payerUserId: driverUser.id,
    payableEntityType: 'DRIVER', payableEntityId: driver.id, recordedById: driverUser.id });
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'DRIVER', sourceId: native.id, expectedVersion: source.version }]);
  await refreshExpenseTripCosts(tx, work.id);
  const current = await getTripCompositeInTx(tx, work.id);
  assert.equal(current?.totalCost, '430000'); assert.equal(current?.totalRoadAllowance, '200000'); assert.equal(current?.vehicleShiftAllowance, '150000');
  assert.equal(current?.reconciledTollCost, '80000');
  const postings = await tx.select().from(s.tripFinancialPostings).where(eq(s.tripFinancialPostings.tripId, work.id));
  assert.equal(postings.filter(posting => posting.status === 'ACTIVE').length, 1);
  assert.equal(postings.length, 2, 'one historical completion and one governed correction; replay adds neither');
  const liability = await tx.select().from(s.ledger).where(and(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${source.id}`), eq(s.ledger.entityType, 'DRIVER')));
  assert.equal(liability.length, 1); assert.equal(liability[0].credit, '80000');
}));
test('accountant records company-paid driver toll in its native source without creating a driver reimbursement', async () => fixture(async (tx, ctx) => {
  const [driver] = await tx.insert(s.drivers).values({ name: 'Company-paid fixture' }).returning();
  const work = await trip(tx, ctx);
  await tx.update(s.trips).set({ driverId: driver.id }).where(eq(s.trips.id, work.id));
  const input = { tripId: work.id, expenseTypeCode: 'OTHER', amount: 80_000, customerChargeAmount: 0, expenseDate: '2026-09-16',
    costGroup: 'DRIVER_ROAD' as const, feeName: 'Vé cầu đường', payerKind: 'COMPANY' as const, driverCostType: DriverIncidentalCostType.TOLL };
  await assert.rejects(createAccountingExpense(tx, ctx.actor, { ...input, customerChargeAmount: 10_000 }), /Tiền đường không thu khách/);
  const entry = await createAccountingExpense(tx, ctx.actor, input);
  assert.equal(entry.sourceKind, 'DRIVER'); assert.equal(entry.payableEntityId, null); assert.equal(entry.recordedById, ctx.accountant.id);
  const [native] = await tx.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, entry.sourceId));
  assert.equal(native.payerKind, 'COMPANY'); assert.equal(native.costType, 'TOLL');
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'DRIVER', sourceId: entry.sourceId, expectedVersion: entry.version }]);
  assert.equal((await tx.select().from(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${entry.id}`))).length, 0);
}));

for (const pairKind of ['KEP', 'KET_HOP']) test(`${pairKind}: one toll receipt is counted once across the paired work`, async () => fixture(async (tx, ctx) => {
  const [driverUser] = await tx.insert(s.users).values({ username: crypto.randomUUID(), passwordHash: 'fixture', role: Role.DRIVER }).returning();
  const [driver] = await tx.insert(s.drivers).values({ name: 'Paired fixture', userId: driverUser.id }).returning();
  const first = await trip(tx, ctx); const second = await trip(tx, ctx);
  const [pair] = await tx.insert(s.tripPairs).values({ firstTripId: first.id, secondTripId: second.id, pairKind }).returning();
  for (const work of [first, second]) {
    await tx.update(s.trips).set({ driverId: driver.id, activeTripPairId: pair.id }).where(eq(s.trips.id, work.id));
    await upsertTripFinancialState(tx, work.id, { totalRoadAllowance: '200000', tollCost: work.id === first.id ? '100000' : '0',
      tollDeduction: work.id === first.id ? '0' : '100000', totalCost: work.id === first.id ? '300000' : '200000' });
  }
  const fee = await createAccountingExpense(tx, ctx.actor, { tripId: first.id, expenseTypeCode: 'OTHER', amount: 80_000, customerChargeAmount: 0,
    expenseDate: '2026-09-16', costGroup: 'DRIVER_ROAD', feeName: 'Vé chung chuyến', payerKind: 'USER', payerUserId: driverUser.id, driverCostType: DriverIncidentalCostType.TOLL });
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: fee.sourceKind, sourceId: fee.sourceId, expectedVersion: fee.version }]);
  await refreshExpenseTripCosts(tx, second.id);
  const left = await getTripCompositeInTx(tx, first.id); const right = await getTripCompositeInTx(tx, second.id);
  assert.equal(left?.reconciledTollCost, '80000'); assert.equal(right?.reconciledTollCost, '0');
  assert.equal(Number(left?.totalCost) + Number(right?.totalCost), 480_000);
  assert.equal(left?.totalRoadAllowance, '200000'); assert.equal(right?.totalRoadAllowance, '200000');
}));

test('breaking and reforming a pair reprojects its confirmed toll from the original native receipt', async () => fixture(async (tx, ctx) => {
  const [driver] = await tx.insert(s.drivers).values({ name: crypto.randomUUID() }).returning();
  const [truck] = await tx.insert(s.trucks).values({ licensePlate: crypto.randomUUID().slice(0, 18) }).returning();
  const [containerType] = await tx.insert(s.containerTypes).values({ code: `20DC-${crypto.randomUUID().slice(0, 8)}`, name: '20-foot fixture' }).returning();
  const first = await trip(tx, ctx); const second = await trip(tx, ctx); const third = await trip(tx, ctx);
  const prepare = async (id: number) => {
    await tx.update(s.trips).set({ truckId: truck.id, driverId: driver.id, plannedStartAt: new Date('2026-09-16T08:00:00Z'),
      plannedEndAt: new Date('2026-09-16T10:00:00Z'), canonicalOrigin: 'A', canonicalDestination: 'B', cargoWeightKg: '1000', vehicleCapacityKg: '10000', tollsStations: 1 }).where(eq(s.trips.id, id));
    await upsertTripFinancialState(tx, id, { tollPerStationApplied: '100000', tollCost: '100000', totalCost: '450000',
      totalRoadAllowance: '200000', vehicleShiftAllowance: '150000', revenue: '1000000', grossProfit: '550000' });
  };
  for (const work of [first, second, third]) await prepare(work.id);
  await tx.update(s.shipmentContainers).set({ containerTypeId: containerType.id }).where(eq(s.shipmentContainers.shipmentId, ctx.shipment.id));
  const pair = async (firstId: number, secondId: number) => {
    const a = (await getTripCompositeInTx(tx, firstId))!, b = (await getTripCompositeInTx(tx, secondId))!;
    const draft = (work: typeof a) => ({ plannedStartAt: work.plannedStartAt!.toISOString(), plannedEndAt: work.plannedEndAt!.toISOString(),
      canonicalOrigin: 'A', canonicalDestination: 'B', cargoWeightKg: 1000, vehicleCapacityKg: 10000, expectedVersion: work.version });
    return createTripPair({ firstTripId: firstId, secondTripId: secondId, pairKind: 'KEP', firstTrip: draft(a), secondTrip: draft(b) }, ctx.accountant.id, tx);
  };
  const original = await pair(first.id, second.id);
  const fee = await createAccountingExpense(tx, ctx.actor, { tripId: second.id, expenseTypeCode: 'TOLL', driverCostType: DriverIncidentalCostType.TOLL,
    amount: 80000, customerChargeAmount: 0, expenseDate: '2026-09-16', costGroup: 'DRIVER_ROAD', feeName: 'Vé gốc', payerKind: 'COMPANY' });
  await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: fee.sourceKind, sourceId: fee.sourceId, expectedVersion: fee.version }]);
  assert.equal((await getTripCompositeInTx(tx, first.id))?.reconciledTollCost, '80000');
  assert.equal((await getTripCompositeInTx(tx, second.id))?.reconciledTollCost, '0');
  await tx.update(s.trips).set({ status: 'CANCELED' }).where(eq(s.trips.id, first.id));
  await applyTripPairLifecycleEffects(tx, { tripId: first.id, activeTripPairId: original.id, activeTripPairOrder: 1, targetStatus: TripStatus.CANCELED, actorId: ctx.accountant.id });
  assert.equal((await getTripCompositeInTx(tx, second.id))?.reconciledTollCost, '80000');
  assert.equal((await getTripCompositeInTx(tx, second.id))?.tollCost, '80000');
  await pair(third.id, second.id);
  assert.equal((await getTripCompositeInTx(tx, third.id))?.reconciledTollCost, '80000');
  assert.equal((await getTripCompositeInTx(tx, second.id))?.reconciledTollCost, '0');
  assert.equal((await getTripCompositeInTx(tx, second.id))?.totalRoadAllowance, '200000');
  assert.equal((await getTripCompositeInTx(tx, second.id))?.vehicleShiftAllowance, '150000');
}));

test('confirmation leaves new-flow advances untouched until explicit reconciliation; legacy unbridged offset still works', async () => fixture(async (tx, ctx) => {
  const work = await trip(tx, ctx);
  const [account] = await tx.insert(s.treasuryAccounts).values({ code: crypto.randomUUID(), name: 'Source test fund', type: 'BANK', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: ctx.accountant.id, updatedBy: ctx.accountant.id }).returning();
  const advance = await recordFundedOpsAdvance(tx, ctx.actor, { opsUserId: ctx.user.id, amount: 1_000_000, reason: 'Ứng fixture',
    treasuryAccountId: account.id, valueDate: '2026-09-16', physicalReference: crypto.randomUUID() });
  const [legacy] = await tx.insert(s.tripExpenses).values({ tripId: work.id, expenseType: 'OTHER', buyAmount: '50000', sellAmount: '0',
    settlementMethod: 'OPS_ADVANCE', forwarderId: ctx.user.id, approvalStatus: 'RECORDED', expenseDate: '2026-09-16', createdBy: ctx.user.id }).returning();
  const cashBeforeOffset = await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, account.id));
  await autoOffsetRecordedExpense(tx, legacy.id);
  assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id), 50_000);
  const [offset] = await tx.select().from(s.advanceSettlements).where(eq(s.advanceSettlements.autoOffsetExpenseId, legacy.id));
  assert.equal(offset.status, 'RECORDED');
  assert.doesNotMatch(offset.note ?? '', /duyệt/i);
  const offsetEntries = await tx.select().from(s.ledger).where(and(eq(s.ledger.txnType, 'OPS_SETTLEMENT'), eq(s.ledger.txnId, offset.id)));
  assert.equal(offsetEntries.length, 1);
  assert.match(offsetEntries[0].note ?? '', /ghi nhận/);
  assert.doesNotMatch(offsetEntries[0].note ?? '', /duyệt/i);
  await autoOffsetRecordedExpense(tx, legacy.id);
  assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id), 50_000, 'repeat recording never allocates twice');
  assert.deepEqual(await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, account.id)), cashBeforeOffset, 'reconciliation never creates another cash movement');
  const [native] = await tx.insert(s.tripExpenses).values({ tripId: work.id, expenseType: 'OTHER', buyAmount: '300000', sellAmount: '0',
    costGroup: 'OPS_REGULAR', feeName: 'Chi hộ mới', settlementMethod: 'OPS_ADVANCE', forwarderId: ctx.user.id,
    approvalStatus: 'RECORDED', expenseDate: '2026-09-16', createdBy: ctx.user.id }).returning();
  const source = await ensureTripExpenseAccountingSource(tx, native.id, ctx.accountant.id, { nativeRecordedNow: true });
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: source.sourceKind, sourceId: source.sourceId, expectedVersion: source.version }]);
  const liability = await tx.select().from(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${source.id}`));
  assert.equal(liability.length, 1); assert.equal(liability[0].debit, '300000');
  assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id), 50_000, 'confirmation must not select advances automatically');
  await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.user.id, from: '2026-09-16', to: '2026-09-16',
    entries: [{ sourceKind: confirmed.sourceKind, sourceId: confirmed.sourceId, expectedVersion: confirmed.version }], advances: [{ advanceRequestId: advance.id, amount: 300_000 }] });
  assert.equal((await getAdvanceConsumedAmounts(tx, [advance.id])).get(advance.id), 350_000);
}));
