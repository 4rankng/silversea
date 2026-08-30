/**
 * Advance-settlement read paths (P6): listAdvanceSettlements full-set
 * (no limit → full array + enrichment) and listAdvanceSettlementsPaginated
 * (SQL pagination + full-set aggregates). Creation/approval workflows are
 * covered by forwarder-settlement-workflow.test.ts.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { createAdvanceSettlement, listAdvanceSettlements, listAdvanceSettlementsPaginated } from '../services/advance.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ids = {
  users: [] as number[],
  customers: [] as number[],
  routes: [] as number[],
  cargoTypes: [] as number[],
  shipments: [] as number[],
  trips: [] as number[],
  containers: [] as number[],
  expenses: [] as number[],
  scopes: [] as number[],
  requests: [] as number[],
  settlements: [] as number[],
};

let forwarderId = 0;
let accountantId = 0;
let tripId = 0;
const mySettlementIds: number[] = [];

before(async () => {
  const users = await db.insert(s.users).values([
    { username: `asr-fwd-${suffix}`, passwordHash: 'x', fullName: 'Đọc test', role: 'DRIVER' },
    { username: `asr-kt-${suffix}`, passwordHash: 'x', fullName: 'Kế toán đọc', role: 'ACCOUNTANT' },
  ]).returning();
  [forwarderId, accountantId] = users.map((row) => row.id);
  ids.users.push(...users.map((row) => row.id));

  const [customer] = await db.insert(s.customers).values({ name: `ASR customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `ASR route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `ASR cargo ${suffix}` }).returning();
  ids.customers.push(customer.id);
  ids.routes.push(route.id);
  ids.cargoTypes.push(cargoType.id);

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `ASR-SHIP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    cargoTypeId: cargoType.id,
    status: 'DISPATCHED',
  }).returning();
  ids.shipments.push(shipment.id);
  await db.insert(s.userShipmentLinks).values({ userId: forwarderId, shipmentId: shipment.id });

  const [trip] = await db.insert(s.trips).values({
    tripCode: `ASR-${suffix}`.slice(0, 50),
    shipmentId: shipment.id,
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT',
    departureDate: '2026-07-11',
  }).returning();
  tripId = trip.id;
  ids.trips.push(trip.id);

  const [container] = await db.insert(s.tripContainers).values({
    tripId, containerNumber: `ASR-CONT-${suffix}`.slice(0, 50), createdBy: forwarderId,
  }).returning();
  ids.containers.push(container.id);

  const [expense] = await db.insert(s.tripExpenses).values({
    tripId, forwarderId, createdBy: forwarderId, tripContainerId: container.id,
    expenseType: 'LIFTING', buyAmount: '100000', sellAmount: '120000',
  }).returning();
  ids.expenses.push(expense.id);
  const [scope] = await db.insert(s.tripExpenseCompletionScopes).values({
    tripId, tripContainerId: container.id, status: 'COMPLETED',
    completedBy: forwarderId, completedAt: new Date(),
  }).returning();
  ids.scopes.push(scope.id);

  const requests = await db.insert(s.advanceRequests).values([
    { requesterId: forwarderId, amount: '1000000', reason: 'ASR tạm ứng 1', status: 'APPROVED', approvedBy: accountantId, approvedAt: new Date() },
    { requesterId: forwarderId, amount: '500000', reason: 'ASR tạm ứng 2', status: 'APPROVED', approvedBy: accountantId, approvedAt: new Date() },
    { requesterId: forwarderId, amount: '250000', reason: 'ASR tạm ứng 3', status: 'APPROVED', approvedBy: accountantId, approvedAt: new Date() },
  ]).returning();
  ids.requests.push(...requests.map((row) => row.id));

  // Two PENDING settlements: one links two requests, one links a request and
  // the completed expense. listAdvanceSettlements full-set must enrich both.
  const settlementOne = await createAdvanceSettlement(forwarderId, {
    advanceRequestIds: [requests[0]!.id, requests[1]!.id],
    refundAmount: 0,
  });
  const settlementTwo = await createAdvanceSettlement(forwarderId, {
    advanceRequestIds: [requests[2]!.id],
    tripExpenseIds: [expense.id],
    refundAmount: 0,
  });
  mySettlementIds.push(settlementOne.id, settlementTwo.id);
  ids.settlements.push(settlementOne.id, settlementTwo.id);
});

after(async () => {
  try {
    if (ids.settlements.length > 0) {
      // Children first: expense links, then request links, then settlements.
      await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.settlementId, ids.settlements));
      await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, ids.settlements));
      await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, ids.settlements));
    }
    if (ids.scopes.length > 0) await db.delete(s.tripExpenseCompletionScopes).where(inArray(s.tripExpenseCompletionScopes.id, ids.scopes));
    if (ids.expenses.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, ids.expenses));
    if (ids.containers.length > 0) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, ids.containers));
    if (ids.trips.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.shipments.length > 0) await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.shipmentId, ids.shipments));
    if (ids.shipments.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.requests.length > 0) await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, ids.requests));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.cargoTypes.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } catch (err) { console.warn('[asr] cleanup:', (err as Error).message); }
  await client.end();
});

describe('advance settlement read paths', () => {
  test('full-set listing enriches linkedRequests and linkedExpenses', async () => {
    const all = await listAdvanceSettlements();
    const mine = all.filter((row) => mySettlementIds.includes(row.id));
    assert.equal(mine.length, 2);

    const withRequests = mine.find((row) => row.id === mySettlementIds[0])!;
    assert.ok(Array.isArray((withRequests as any).linkedRequests));
    const linkedAmounts = (withRequests as any).linkedRequests.map((r: any) => r.amount);
    assert.ok(linkedAmounts.includes('1000000'));
    assert.ok(linkedAmounts.includes('500000'));

    const withExpenses = mine.find((row) => row.id === mySettlementIds[1])!;
    const linkedExpenses = (withExpenses as any).linkedExpenses as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(linkedExpenses));
    assert.equal(linkedExpenses.length, 1);
    // buyAmount = the adjusted (or original) snapshot amount, re-pinned after
    // the snapshot overlay by design; the overlay intentionally wins over the
    // joined container number, so only shape is pinned here, not that value.
    assert.equal(linkedExpenses[0]!['buyAmount'], '100000');
    assert.ok('containerNumber' in linkedExpenses[0]!);
  });

  test('paginated listing returns SQL pagination + full-set aggregates', async () => {
    const page = await listAdvanceSettlementsPaginated({ page: 1, limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.page, 1);
    assert.equal(page.limit, 1);
    assert.ok(page.total >= 2);
    assert.equal(page.totalPages, Math.ceil(page.total / 1));
    assert.ok((page.statusCounts['PENDING'] ?? 0) >= 2);
    assert.ok(page.statusAmounts['PENDING'] >= 1_500_000);
    assert.ok(page.totals.totalExpenseAmount >= 100_000);
    assert.ok(page.totals.pendingCount >= 2);
  });

  test('status filter narrows items but keeps full-set statusCounts', async () => {
    const page = await listAdvanceSettlementsPaginated({ status: 'PENDING', page: 1, limit: 50 });
    assert.ok(page.items.every((row) => row.status === 'PENDING'));
    assert.ok((page.statusCounts['PENDING'] ?? 0) >= 2);
  });

  test('unknown status label rejects with 400 (enum vocabulary)', async () => {
    await assert.rejects(
      listAdvanceSettlements({ status: 'BOGUS' } as never),
      /Trạng thái tất toán không hợp lệ/,
    );
  });
});
