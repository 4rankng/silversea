import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { listSettlementOpsCompletionSummaries } from '../services/forwarder.service';

describe('forwarder admin settlement ops completion summaries', () => {
  const ids = {
    users: [] as number[],
    customers: [] as number[],
    routes: [] as number[],
    cargoTypes: [] as number[],
    trips: [] as number[],
    containers: [] as number[],
    expenses: [] as number[],
    requests: [] as number[],
    settlements: [] as number[],
  };

  let forwarderId: number;
  let accountantId: number;
  let tripId: number;
  let containerDoneId: number;
  let containerPendingId: number;
  let containerEmptyId: number;
  let settlementId: number;
  let requestId: number;

  async function insertExpense(options: { tripContainerId?: number | null; containerNumber?: string | null } = {}) {
    const [expense] = await db.insert(s.tripExpenses).values({
      tripId,
      forwarderId,
      expenseType: 'LIFTING',
      buyAmount: '100000',
      sellAmount: '100000',
      settlementMethod: 'OPS_ADVANCE',
      approvalStatus: 'PENDING',
      tripContainerId: options.tripContainerId ?? null,
      containerNumber: options.containerNumber ?? null,
    }).returning();
    ids.expenses.push(expense.id);
    return expense;
  }

  async function upsertScope(tripContainerId: number | null, status: 'IN_PROGRESS' | 'COMPLETED') {
    const scopeWhere = tripContainerId == null
      ? and(eq(s.tripExpenseCompletionScopes.tripId, tripId), isNull(s.tripExpenseCompletionScopes.tripContainerId))
      : eq(s.tripExpenseCompletionScopes.tripContainerId, tripContainerId);
    const [existing] = await db.select({ id: s.tripExpenseCompletionScopes.id })
      .from(s.tripExpenseCompletionScopes)
      .where(scopeWhere)
      .limit(1);
    if (existing) {
      await db.update(s.tripExpenseCompletionScopes).set({
        status,
        completedBy: status === 'COMPLETED' ? forwarderId : null,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      }).where(eq(s.tripExpenseCompletionScopes.id, existing.id));
      return;
    }
    await db.insert(s.tripExpenseCompletionScopes).values({
      tripId,
      tripContainerId,
      status,
      completedBy: status === 'COMPLETED' ? forwarderId : null,
      completedAt: status === 'COMPLETED' ? new Date() : null,
    });
  }

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users = await db.insert(s.users).values([
      { username: `fwd-admin-${suffix}`, passwordHash: 'x', fullName: 'Ops tổng hợp', role: 'FORWARDER' },
      { username: `kt-admin-${suffix}`, passwordHash: 'x', fullName: 'Kế toán tổng hợp', role: 'ACCOUNTANT' },
    ]).returning();
    [forwarderId, accountantId] = users.map((row) => row.id);
    ids.users.push(...users.map((row) => row.id));

    const [customer] = await db.insert(s.customers).values({ name: `Admin summary customer ${suffix}` }).returning();
    const [route] = await db.insert(s.routes).values({ name: `Admin summary route ${suffix}` }).returning();
    const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Admin summary cargo ${suffix}` }).returning();
    ids.customers.push(customer.id);
    ids.routes.push(route.id);
    ids.cargoTypes.push(cargoType.id);

    const [trip] = await db.insert(s.trips).values({
      tripCode: `OPS-${suffix}`.slice(0, 50),
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      status: 'COMPLETED',
      departureDate: '2026-07-22',
    }).returning();
    tripId = trip.id;
    ids.trips.push(trip.id);

    const [containerDone, containerPending, containerEmpty] = await db.insert(s.tripContainers).values([
      { tripId, containerNumber: `DONE-${suffix}`.slice(0, 50), createdBy: forwarderId },
      { tripId, containerNumber: `WAIT-${suffix}`.slice(0, 50), createdBy: forwarderId },
      { tripId, containerNumber: `EMPTY-${suffix}`.slice(0, 50), createdBy: forwarderId },
    ]).returning();
    containerDoneId = containerDone.id;
    containerPendingId = containerPending.id;
    containerEmptyId = containerEmpty.id;
    ids.containers.push(containerDone.id, containerPending.id, containerEmpty.id);

    const [request] = await db.insert(s.advanceRequests).values({
      requesterId: forwarderId,
      amount: '200000',
      reason: 'Phiếu tổng hợp tiến độ Ops',
      status: 'APPROVED',
      approvedBy: accountantId,
      approvedAt: new Date(),
    }).returning();
    requestId = request.id;
    ids.requests.push(request.id);
  });

  after(async () => {
    if (ids.settlements.length) {
      await db.delete(s.ledger).where(and(
        eq(s.ledger.txnType, TxnType.OPS_SETTLEMENT),
        inArray(s.ledger.txnId, ids.settlements),
      ));
      await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.settlementId, ids.settlements));
      await db.delete(s.advanceSettlementRequests).where(inArray(s.advanceSettlementRequests.settlementId, ids.settlements));
      await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, ids.settlements));
    }
    if (ids.expenses.length) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, ids.expenses));
    }
    if (ids.trips.length) {
      await db.delete(s.tripExpenseCompletionScopes).where(inArray(s.tripExpenseCompletionScopes.tripId, ids.trips));
    }
    if (ids.containers.length) await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, ids.containers));
    if (ids.trips.length) await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
    if (ids.requests.length) await db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, ids.requests));
    if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.cargoTypes.length) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
    if (ids.users.length) await db.delete(s.users).where(inArray(s.users.id, ids.users));
    await client.end();
  });

  test('summarizes mixed completed and in-progress container and general scopes per trip', async () => {
    const generalExpense = await insertExpense();
    const doneExpense = await insertExpense({ tripContainerId: containerDoneId });
    const pendingExpense = await insertExpense({ tripContainerId: containerPendingId });

    await upsertScope(null, 'COMPLETED');
    await upsertScope(containerDoneId, 'COMPLETED');

    const [settlement] = await db.insert(s.advanceSettlements).values({
      code: `OPS-SUM-${Date.now()}`.slice(0, 20),
      forwarderId,
      totalExpenseAmount: '200000',
      refundAmount: '0',
      status: 'PENDING',
    }).returning();
    settlementId = settlement.id;
    ids.settlements.push(settlement.id);

    await db.insert(s.advanceSettlementRequests).values({
      settlementId,
      advanceRequestId: requestId,
    });
    await db.insert(s.settlementExpenses).values([
      {
        settlementId,
        tripExpenseId: generalExpense.id,
        originalBuyAmount: generalExpense.buyAmount,
        adjustedBuyAmount: generalExpense.buyAmount,
        submittedSellAmount: generalExpense.sellAmount,
        originalSnapshot: { buyAmount: generalExpense.buyAmount },
        adjustedSnapshot: { buyAmount: generalExpense.buyAmount },
      },
      {
        settlementId,
        tripExpenseId: doneExpense.id,
        originalBuyAmount: doneExpense.buyAmount,
        adjustedBuyAmount: doneExpense.buyAmount,
        submittedSellAmount: doneExpense.sellAmount,
        originalSnapshot: { buyAmount: doneExpense.buyAmount },
        adjustedSnapshot: { buyAmount: doneExpense.buyAmount },
      },
    ]);

    const summaries = await listSettlementOpsCompletionSummaries([settlementId]);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.settlementId, settlementId);
    const summary = summaries[0]?.opsCompletion;
    assert.ok(summary);
    assert.equal(summary.tripCount, 1);
    assert.equal(summary.completedGroupCount, 2);
    assert.equal(summary.totalGroupCount, 4);

    const [tripSummary] = summary.trips;
    assert.ok(tripSummary);
    assert.equal(tripSummary.tripId, tripId);
    assert.match(tripSummary.tripCode ?? '', /^OPS-/);
    assert.equal(tripSummary.departureDate, '2026-07-22');
    assert.equal(tripSummary.completedGroupCount, 2);
    assert.equal(tripSummary.totalGroupCount, 4);

    const groupsByKey = new Map(
      tripSummary.groups.map((group) => [group.tripContainerId ?? 'general', group] as const),
    );
    assert.deepEqual(groupsByKey.get(containerDoneId), {
      tripContainerId: containerDoneId,
      containerNumber: groupsByKey.get(containerDoneId)?.containerNumber,
      expenseCount: 1,
      status: 'COMPLETED',
    });
    assert.match(groupsByKey.get(containerDoneId)?.containerNumber ?? '', /^DONE-/);
    assert.deepEqual(groupsByKey.get(containerPendingId), {
      tripContainerId: containerPendingId,
      containerNumber: groupsByKey.get(containerPendingId)?.containerNumber,
      expenseCount: 1,
      status: 'IN_PROGRESS',
    });
    assert.match(groupsByKey.get(containerPendingId)?.containerNumber ?? '', /^WAIT-/);
    assert.deepEqual(groupsByKey.get('general'), {
      tripContainerId: null,
      containerNumber: null,
      expenseCount: 1,
      status: 'COMPLETED',
    });
    assert.deepEqual(groupsByKey.get(containerEmptyId), {
      tripContainerId: containerEmptyId,
      containerNumber: groupsByKey.get(containerEmptyId)?.containerNumber,
      expenseCount: 0,
      status: 'IN_PROGRESS',
    });
    assert.match(groupsByKey.get(containerEmptyId)?.containerNumber ?? '', /^EMPTY-/);

    assert.equal(doneExpense.tripContainerId, containerDoneId);
    assert.equal(pendingExpense.tripContainerId, containerPendingId);
    assert.equal(generalExpense.tripContainerId, null);
  });
});
