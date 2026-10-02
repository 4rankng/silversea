import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { computeLotPayablesBreakdown } from '../services/lot-payables.service';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import { lockShipmentCost } from '../services/shipment-cost-lock.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { voidPhoiPhieuRow } from '../services/phoi-phieu-control.service';

// SIS22-ACC-019: exercise real producers, a real void, and the next frozen lock.
test('voided native fees and stale billing projections leave all live debit totals', async () => {
  const prefix = `voided-debit-${Date.now()}`;
  const [user] = await db.insert(s.users).values({ username: prefix, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
  const [payer] = await db.insert(s.users).values({ username: `${prefix}-ops`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
  const actor = { userId: user.id, role: Role.ACCOUNTANT, username: prefix, fullName: prefix, email: '' };
  const [customer] = await db.insert(s.customers).values({ name: prefix }).returning();
  const [route] = await db.insert(s.routes).values({ name: prefix }).returning();
  const lots = await db.insert(s.shipments).values([{ customerId: customer.id }, { customerId: customer.id }]).returning();
  const [lot, empty] = lots;
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({ shipmentId: lot.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 }).returning();
  const [trip] = await db.insert(s.trips).values({ shipmentId: lot.id, fulfillmentId: fulfillment.id, customerId: customer.id, routeId: route.id, departureDate: '2026-09-22', status: 'COMPLETED' }).returning();
  const [container] = await db.insert(s.shipmentContainers).values({ shipmentId: lot.id, containerNumber: prefix }).returning();
  const [link] = await db.insert(s.tripContainers).values({ tripId: trip.id, sourceShipmentId: lot.id, sourceShipmentContainerId: container.id, containerNumber: prefix }).returning();
  await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, externalFreightCost: '1000' });
  const types = await db.insert(s.forwarderExpenseTypes).values([
    { code: `${prefix}-HQGS`, name: 'Customs test', category: 'HQGS' },
    { code: `${prefix}-PS`, name: 'Incidental test', category: 'PHAT_SINH' },
  ]).returning();
  const nativeIds: number[] = []; const sourceIds: number[] = [];
  async function fee(amount: string, charge: string, type = types[0].code, containerId: number | null = null, status: (typeof s.opsExpenseEntries.$inferInsert)['approvalStatus'] = 'RECORDED', shipmentId = lot.id) {
    const [row] = await db.insert(s.opsExpenseEntries).values({ shipmentId, shipmentContainerId: containerId, expenseTypeCode: type,
      amount, customerChargeAmount: charge, costGroup: 'OPS_REGULAR', payerKind: 'USER', paidById: payer.id, paidAt: '2026-09-22', approvalStatus: status }).returning();
    nativeIds.push(row.id); return row;
  }
  try {
    const active = await fee('100', '10');
    await fee('200', '20', types[1].code, container.id);
    await fee('50', '5', types[0].code, container.id);
    await fee('900', '9000', types[0].code, container.id, 'VOIDED');
    await fee('800', '8000', types[1].code, null, 'VOIDED');
    await fee('700', '7000', types[0].code, null, 'VOIDED', empty.id);
    const staleNative = await fee('600', '6000');
    const expenses = await db.insert(s.tripExpenses).values([
      { tripId: trip.id, expenseType: 'CUSTOMS', buyAmount: '50', sellAmount: '0' },
      { tripId: trip.id, expenseType: 'OTHER', buyAmount: '999', sellAmount: '9999', approvalStatus: 'VOIDED' },
      { tripId: trip.id, expenseType: 'OTHER', buyAmount: '600', sellAmount: '6000', approvalStatus: 'RECORDED' },
    ]).returning();
    const [staleSource] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: staleNative.id,
      shipmentId: lot.id, tripId: trip.id, linkedTripExpenseId: expenses[2].id, status: 'VOIDED' }).returning();
    sourceIds.push(staleSource.id);
    const totals = await computeLotPayablesBreakdown(lot.id);
    assert.deepEqual(totals, { externalFreightCost: 1000, hqgsFee: 150, phatSinhFee: 200,
      unclassifiedFee: 0, opsExpenseTotal: 350, payableTotal: 1350 });
    const detail = await getShipmentDebitDetail(lot.id);
    assert.equal(detail.freightRows[0].customsFee, 50);
    assert.equal(detail.freightRows[0].customsCustomerCharge, 5);
    assert.equal(detail.freightRows[0].phatSinhFee, 200);
    assert.equal(detail.payables.hqgsCommonFee, 100);
    assert.equal(detail.payables.phatSinhCommonFee, 0);
    assert.deepEqual(detail.chiHoRows.flatMap(row => row.otherFees), []);
    assert.equal(detail.thuKhachTotal, 50);
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const row = summary.items.find(item => item.shipmentId === lot.id)!;
    assert.equal(row.receivableTotal, '85'); assert.equal(row.payableTotal, '1350'); assert.equal(row.chiHoTotal, '50');
    const emptyRow = summary.items.find(item => item.shipmentId === empty.id)!;
    assert.equal(emptyRow.receivableTotal, null); assert.equal(emptyRow.payableTotal, null);
    assert.equal((await computeLotPayablesBreakdown(empty.id)).opsExpenseTotal, null);

    // A current void synchronizes the projection while retaining all records.
    const toVoid = await fee('70', '90');
    const [projection] = await db.insert(s.tripExpenses).values({ tripId: trip.id, expenseType: 'OTHER', buyAmount: '70', sellAmount: '90', approvalStatus: 'RECORDED' }).returning();
    const [source] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: toVoid.id,
      shipmentId: lot.id, tripId: trip.id, linkedTripExpenseId: projection.id }).returning();
    sourceIds.push(source.id);
    await voidPhoiPhieuRow(trip.id, source.id, actor, 'owned void conservation');
    assert.equal((await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, projection.id)))[0].approvalStatus, 'VOIDED');
    assert.equal((await db.select().from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, toVoid.id)))[0].amount, '70');
    assert.equal((await db.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)))[0].status, 'VOIDED');
    // SIS22-ACC-021: confirmation creates a real billing projection, not revenue.
    const [activeSource] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: active.id,
      shipmentId: lot.id, tripId: trip.id }).returning();
    sourceIds.push(activeSource.id);
    await db.transaction(tx => confirmAccountingExpenses(tx, actor, [{ sourceKind: 'OPS', sourceId: active.id, expectedVersion: activeSource.version }]));
    const [confirmedSource] = await db.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, activeSource.id));
    assert.ok(confirmedSource.confirmedAt); assert.ok(confirmedSource.linkedTripExpenseId);
    const [billing] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, confirmedSource.linkedTripExpenseId!));
    assert.equal(billing.sellAmount, '10');
    assert.equal((await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' })).items.find(item => item.shipmentId === lot.id)!.receivableTotal, '85');
    const lock = await lockShipmentCost({ shipmentId: lot.id, actor, idempotencyKey: prefix });
    const [stored] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const snapshot = stored.costSnapshot as Record<string, unknown>;
    assert.equal(Number(snapshot.receivableTotal), 85); assert.equal(Number(snapshot.payableTotal), 1350);
    assert.equal(Number(snapshot.opsExpenseTotal), 350);
    await db.update(s.opsExpenseEntries).set({ amount: '99999', customerChargeAmount: '99999' }).where(eq(s.opsExpenseEntries.id, active.id));
    const frozen = (await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' })).items.find(item => item.shipmentId === lot.id)!;
    assert.equal(frozen.receivableTotal, '85'); assert.equal(frozen.payableTotal, '1350');
    assert.equal((await getShipmentDebitDetail(lot.id)).payables.payableTotal, 1350);
    assert.deepEqual((await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id)))[0].costSnapshot, snapshot);
  } finally {
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, lots.map(row => row.id)));
    await db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, user.id));
    await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, user.id));
    if (sourceIds.length) await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.id, sourceIds));
    await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.shipmentId, lots.map(row => row.id)));
    await db.delete(s.tripExpenses).where(eq(s.tripExpenses.tripId, trip.id));
    await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, trip.id));
    await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, trip.id));
    await db.delete(s.tripContainers).where(eq(s.tripContainers.id, link.id));
    await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    await db.delete(s.trips).where(eq(s.trips.id, trip.id));
    await db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    await db.delete(s.shipments).where(inArray(s.shipments.id, lots.map(row => row.id)));
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, types.map(row => row.id)));
    await db.delete(s.routes).where(eq(s.routes.id, route.id)); await db.delete(s.customers).where(eq(s.customers.id, customer.id));
    await db.delete(s.ledger).where(or(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customer.id)),
      and(eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, payer.id))));
    await db.delete(s.users).where(inArray(s.users.id, [user.id, payer.id]));
    await disconnectRedis(); await client.end();
  }
});
