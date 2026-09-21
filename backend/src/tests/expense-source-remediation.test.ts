import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createExpenseReconciliation } from '../services/expense-accounting-reconciliation.service';
import { releaseExpenseReconciliation } from '../services/expense-reconciliation-release.service';
import { getExpenseReconciliation } from '../services/expense-accounting-reads.service';
import { and, eq } from 'drizzle-orm';
import { Role, DriverIncidentalCostType } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import type { Tx } from '../services/trip-shared';
import { upsertExpenseAccountingSource, hydrateExpenseAccountingSource } from '../services/expense-accounting-source.service';
import { confirmAccountingExpenses, updateAccountingExpense } from '../services/expense-accounting-write.service';
import { correctAccountingExpense } from '../services/expense-accounting-correction.service';
import { createOpsExpense, updateOpsExpense, deleteOpsExpense } from '../services/ops-expenses.service';
import { assertExpenseOwnerWriteScope, assertOpsExpenseAssignment } from '../services/expense-owner-scope.service';
import { updateTripExpense, deleteTripExpenseGuarded } from '../services/forwarder.service';
import { insertTripComposite, getTripCompositeInTx, upsertTripFinancialState } from '../services/trip-composite.service';

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

test('FIX17-S01 revoked OPS writes and evidence scope fail; finance remains available', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  const actor = { userId: ctx.user.id, role: Role.OPS };
  // The lot already carries the ops's own saved expense, so the truck-assignment
  // gate keeps the right here even with no live assignment — revocation only
  // removes lots never expensed. The blocked case moves to a fresh lot.
  await assertOpsExpenseAssignment(tx, ctx.user.id, ctx.shipment.id);
  const [fresh] = await tx.insert(s.shipments).values({ shipmentCode: `${ctx.shipment.shipmentCode}-fresh`, customerId: ctx.customer.id }).returning();
  await assert.rejects(createOpsExpense(ctx.user.id, { shipmentId: fresh.id, expenseTypeCode: 'OTHER', amount: 500, paidAt: '2026-09-16' }, tx), /Quản trị viên/);
  await assert.rejects(assertExpenseOwnerWriteScope(tx, actor, { ...source, shipmentId: fresh.id }), /Quản trị viên/);
  await tx.insert(s.userShipmentLinks).values({ userId: ctx.user.id, shipmentId: ctx.shipment.id });
  await assertExpenseOwnerWriteScope(tx, actor, source);
  await assert.rejects(updateOpsExpense(ctx.user.id, source.sourceId, { amount: 600, expectedVersion: source.version }, tx), /lý do/);
  await assertExpenseOwnerWriteScope(tx, ctx.actor, source);
}));
test('FIX17-S02 OPS receipt rows are authoritative over stale native JSON', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  await tx.update(s.opsExpenseEntries).set({ photoStorageKeys: ['stale-deleted.jpg'] }).where(eq(s.opsExpenseEntries.id, source.sourceId));
  await tx.insert(s.opsExpensePhotos).values({ opsExpenseId: source.sourceId, storageKey: 'current.jpg', uploadedById: ctx.user.id });
  const hydrated = await hydrateExpenseAccountingSource(tx, source);
  assert.deepEqual(hydrated.photoStorageKeys, ['current.jpg']);
}));
test('FIX17-S04 legacy edit and delete cannot mutate native billing mirrors', async () => fixture(async (tx, ctx) => {
  await trip(tx, ctx);
  const source = await ops(tx, ctx);
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: source.version }]);
  assert.ok(confirmed.linkedTripExpenseId);
  await assert.rejects(updateAccountingExpense(tx, ctx.actor, 'TRIP', confirmed.linkedTripExpenseId, { expectedVersion: confirmed.version, amount: 90000, reason: 'Legacy alias' }), /nguồn/);
  await assert.rejects(updateTripExpense(tx, confirmed.linkedTripExpenseId, { buyAmount: '90000', sellAmount: '80000' }), /nguồn Ops/);
  await assert.rejects(deleteTripExpenseGuarded(confirmed.tripId!, confirmed.linkedTripExpenseId, tx), /nguồn Ops/);
  const [mirror] = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, confirmed.linkedTripExpenseId));
  assert.equal(mirror.buyAmount, '500000'); assert.equal(mirror.sellAmount, '300000');
}));
test('FIX17-S06 confirmed OPS replacement preserves original, reverses obligation, and links history', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 1 }]);
  const after = await correctAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: confirmed.version, amount: 450000, customerChargeAmount: 200000, reason: 'Đối chiếu lại biên lai' });
  const [original] = await tx.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, source.sourceId));
  assert.equal(original.amount, '500000'); assert.equal(original.approvalStatus, 'VOIDED');
  assert.notEqual(after.id, confirmed.id); assert.equal(after.amount, '450000'); assert.ok(after.confirmedAt);
  const rows = await tx.select().from(s.ledger).where(eq(s.ledger.receiptId, `EXPENSE_SOURCE:${source.id}`));
  assert.equal(rows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0), 0);
  const [audit] = await tx.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, source.id), eq(s.auditLogs.message, 'EXPENSE_ACCOUNTING_CORRECTED')));
  assert.equal((audit.payload as { replacementSourceId: number }).replacementSourceId, after.id);
  await assert.rejects(correctAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: confirmed.version, amount: 1, reason: 'Thử lại phiên bản cũ' }), /đã thay đổi/);
}));
for (const status of ['CREATED', 'COMPLETED'] as const) test(`FIX17-S06 ${status} toll correction preserves allowances and replaces actual once`, async () => fixture(async (tx, ctx) => {
  const work = await trip(tx, ctx);
  const [driver] = await tx.insert(s.drivers).values({ name: 'Driver', userId: ctx.user.id }).returning();
  await tx.update(s.trips).set({ driverId: driver.id, status, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) }).where(eq(s.trips.id, work.id));
  await upsertTripFinancialState(tx, work.id, { totalRoadAllowance: '300000', vehicleShiftAllowance: '200000', tollCost: '100000', tollsStations: 1, tollPerStationApplied: '100000', totalCost: '600000', grossProfit: '-600000' });
  const [native] = await tx.insert(s.driverIncidentalCosts).values({ tripId: work.id, driverId: driver.id, costType: DriverIncidentalCostType.TOLL, amount: '80000', occurredAt: '2026-09-16' }).returning();
  const source = await upsertExpenseAccountingSource(tx, { sourceKind: 'DRIVER', sourceId: native.id, shipmentId: ctx.shipment.id, tripId: work.id, customerId: ctx.customer.id,
    expenseTypeCode: 'TOLL', costGroup: 'DRIVER_ROAD', feeName: 'Cầu đường', amount: 80000, customerChargeAmount: 0, expenseDate: '2026-09-16', payerKind: 'USER', payerUserId: ctx.user.id,
    payableEntityType: 'DRIVER', payableEntityId: driver.id, recordedById: ctx.user.id });
  const key = `expense-accounting/DRIVER/${native.id}/proof.jpg`;
  await tx.insert(s.expenseAccountingEvidence).values({ expenseAccountingSourceId: source.id, storageKey: key, uploadedById: ctx.user.id });
  await tx.update(s.driverIncidentalCosts).set({ photoStorageKeys: [key], receiptStorageKey: key }).where(eq(s.driverIncidentalCosts.id, native.id));
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'DRIVER', sourceId: native.id, expectedVersion: source.version }]);
  const corrected = await correctAccountingExpense(tx, ctx.actor, 'DRIVER', native.id, { expectedVersion: confirmed.version, amount: 70000, reason: 'Vé đúng là 70.000' });
  assert.deepEqual(corrected.photoStorageKeys, [key]);
  const [provenance] = await tx.select().from(s.expenseAccountingEvidence).where(eq(s.expenseAccountingEvidence.storageKey, key));
  assert.equal(provenance.expenseAccountingSourceId, source.id);
  const updated = await getTripCompositeInTx(tx, work.id);
  assert.equal(updated!.totalRoadAllowance, '300000'); assert.equal(updated!.vehicleShiftAllowance, '200000');
  assert.equal(updated!.tollCost, '70000'); assert.equal(updated!.totalCost, '570000');
  const obligations = await tx.select().from(s.ledger).where(and(eq(s.ledger.entityType, 'DRIVER'), eq(s.ledger.entityId, driver.id)));
  assert.equal(obligations.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0), -70000, 'one net expense obligation after posted or unposted correction');
  await tx.update(s.trips).set({ driverId: null }).where(eq(s.trips.id, work.id));
  await assert.rejects(assertExpenseOwnerWriteScope(tx, { userId: ctx.user.id, role: Role.DRIVER }, source), /phân công/);
}));

test('FIX17-S07 released reconciliation retains history and permits correction and re-reconciliation', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{sourceKind:'OPS',sourceId:source.sourceId,expectedVersion:1}]);
  const batch = await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.user.id, from: '2026-09-01', to: '2026-09-30', entries:[{sourceKind:'OPS',sourceId:source.sourceId,expectedVersion:confirmed.version}], advances:[] });
  await releaseExpenseReconciliation(tx, ctx.actor, batch.id, 'Điều chỉnh số chi thực tế');
  const history = await getExpenseReconciliation(ctx.actor, batch.id, tx);
  assert.ok(history.voidedAt); assert.equal(history.entries.length,1); assert.equal(history.remainingDifference,0);
  const [link] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id,source.id));
  assert.equal(link.reconciliationId,null); assert.equal(link.allocatedAdvanceAmount,'0');
  const corrected = await correctAccountingExpense(tx,ctx.actor,'OPS',source.sourceId,{expectedVersion:link.version,amount:450000,reason:'Biên lai mới'});
  const replacementBatch = await createExpenseReconciliation(tx,ctx.actor,{opsUserId:ctx.user.id,from:'2026-09-01',to:'2026-09-30',entries:[{sourceKind:'OPS',sourceId:corrected.sourceId,expectedVersion:corrected.version}],advances:[]});
  assert.equal(replacementBatch.amount,'450000'); assert.notEqual(replacementBatch.id,batch.id);
}));


test('FIX17-S07 cash must be reversed before reconciliation release or confirmed correction', async () => fixture(async (tx, ctx) => {
  const source = await ops(tx, ctx);
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 1 }]);
  const batch = await createExpenseReconciliation(tx, ctx.actor, { opsUserId: ctx.user.id, from: '2026-09-01', to: '2026-09-30', entries: [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: confirmed.version }], advances: [] });
  const [voucher] = await tx.insert(s.expenseCashVouchers).values({ code: crypto.randomUUID(), counterpartyType: 'USER', counterpartyId: ctx.user.id, treasuryMovementId: 999999, reconciliationId: batch.id, createdById: ctx.actor.userId }).returning();
  await tx.insert(s.expenseCashAllocations).values({ voucherId: voucher.id, expenseAccountingSourceId: source.id, sourceVersion: confirmed.version + 1, amount: '100000' });
  await assert.rejects(releaseExpenseReconciliation(tx, ctx.actor, batch.id, 'Sửa biên lai'), /Hoàn tác phiếu tiền/);
  const [unchanged] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id));
  assert.equal(unchanged.reconciliationId, batch.id);
  await tx.update(s.expenseCashVouchers).set({ status: 'REVERSED' }).where(eq(s.expenseCashVouchers.id, voucher.id));
  await releaseExpenseReconciliation(tx, ctx.actor, batch.id, 'Phiếu tiền đã đảo');
  const [released] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id));
  await tx.update(s.expenseCashVouchers).set({ status: 'RECORDED', reconciliationId: null }).where(eq(s.expenseCashVouchers.id, voucher.id));
  await assert.rejects(correctAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: released.version, amount: 450000, reason: 'Sửa' }), /phiếu/);
  const history = await getExpenseReconciliation(ctx.actor, batch.id, tx);
  assert.equal(history.paidAmount, 0, 'later payment must not rewrite the released reconciliation');
}));


test('FIX17-S07 active legacy settlement blocks correction until its explicit reversal', async () => fixture(async (tx, ctx) => {
  await trip(tx, ctx);
  const source = await ops(tx, ctx);
  const [confirmed] = await confirmAccountingExpenses(tx, ctx.actor, [{ sourceKind: 'OPS', sourceId: source.sourceId, expectedVersion: 1 }]);
  const [legacy] = await tx.insert(s.advanceSettlements).values({ code: crypto.randomUUID().slice(0, 20), forwarderId: ctx.user.id, totalExpenseAmount: '500000' }).returning();
  await tx.insert(s.settlementExpenses).values({ settlementId: legacy.id, tripExpenseId: confirmed.linkedTripExpenseId!, originalBuyAmount: '500000', adjustedBuyAmount: '500000', originalSnapshot: {}, adjustedSnapshot: {} });
  await assert.rejects(correctAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: confirmed.version, amount: 450000, reason: 'Sửa biên lai' }), /Hoàn tác phiếu hoàn ứng/);
  await tx.update(s.advanceSettlements).set({ status: 'VOIDED' }).where(eq(s.advanceSettlements.id, legacy.id));
  const corrected = await correctAccountingExpense(tx, ctx.actor, 'OPS', source.sourceId, { expectedVersion: confirmed.version, amount: 450000, reason: 'Sửa sau hoàn tác' });
  assert.equal(corrected.amount, '450000');
}));
