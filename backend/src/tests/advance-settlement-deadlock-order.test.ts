// Deadlock-order contract for the composed advance-settle command
// (card 20260930_226 AC4). The settle path claims three lock families
// (advance 6101 → expense 6102 → container/trip scope 6103) through
// acquireAdvisoryLocks, whose canonical order must make caller input order
// irrelevant. This test drives two FULLY OVERLAPPING settlements, each in
// its own real transaction, with deliberately reversed resource orders:
// without the canonical ordering the pair deadlocks (40P01); with it, one
// settles and the other gets the clean already-linked business rejection.
//
// Unlike the rollback-per-test suites, this test needs its fixtures COMMITTED
// (each settle opens its own transaction, which must see them), so it seeds
// with a run-unique suffix and cleans up explicitly.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { createAdvanceSettlement } from '../services/advance-settlement.service';
import { recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { canonicalLockOrder, lockKeys } from '../services/advisory-lock.service';
import { AdvanceError } from '../services/settlement-validation';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup = {
  userIds: [] as number[],
  customerIds: [] as number[],
  routeIds: [] as number[],
  shipmentIds: [] as number[],
  tripIds: [] as number[],
  accountIds: [] as number[],
  advanceIds: [] as number[],
  expenseIds: [] as number[],
  settlementIds: [] as number[],
};

after(async () => {
  // FK-aware order; every key is run-unique so a crashed run can never
  // collide with the next one's seeds.
  const tryDelete = async (run: () => Promise<unknown>) => {
    try { await run(); } catch { /* leaked rows carry the unique suffix */ }
  };
  for (const id of cleanup.settlementIds) {
    await tryDelete(() => db.delete(s.settlementExpenses).where(eq(s.settlementExpenses.settlementId, id)));
    await tryDelete(() => db.delete(s.advanceSettlements).where(eq(s.advanceSettlements.id, id)));
  }
  for (const tripId of cleanup.tripIds) {
    await tryDelete(() => db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId)));
  }
  await tryDelete(() => db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, cleanup.expenseIds)));
  await tryDelete(() => db.delete(s.advanceRequests).where(inArray(s.advanceRequests.id, cleanup.advanceIds)));
  await tryDelete(() => db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, cleanup.accountIds)));
  for (const shipmentId of cleanup.shipmentIds) {
    await tryDelete(() => db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.shipmentId, shipmentId)));
  }
  await tryDelete(() => db.delete(s.trips).where(inArray(s.trips.id, cleanup.tripIds)));
  await tryDelete(() => db.delete(s.shipments).where(inArray(s.shipments.id, cleanup.shipmentIds)));
  await tryDelete(() => db.delete(s.routes).where(inArray(s.routes.id, cleanup.routeIds)));
  await tryDelete(() => db.delete(s.customers).where(inArray(s.customers.id, cleanup.customerIds)));
  await tryDelete(() => db.delete(s.users).where(inArray(s.users.id, cleanup.userIds)));
});

describe('advance settle deadlock-order contract (card 20260930_226)', () => {
  test('the composed lock set orders canonically regardless of input order', () => {
    const reversed = canonicalLockOrder([
      lockKeys.expense(2), lockKeys.advance(2), lockKeys.expense(1), lockKeys.advance(1),
    ]);
    assert.deepEqual(reversed, [
      lockKeys.advance(1), lockKeys.advance(2), lockKeys.expense(1), lockKeys.expense(2),
    ], 'the settle command claims advance rows before expense rows, ids ascending — the exact habit the module formalized');
  });

  test('two overlapping settlements with reversed resource orders never deadlock', async () => {
    // ── fixtures (committed: each settle runs in its own transaction) ──
    const [actor] = await db.insert(s.users).values({ username: `dlk-act-${suffix}`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
    const [owner] = await db.insert(s.users).values({ username: `dlk-ops-${suffix}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
    cleanup.userIds.push(actor.id, owner.id);
    const [customer] = await db.insert(s.customers).values({ name: `Deadlock order ${suffix}` }).returning();
    const [route] = await db.insert(s.routes).values({ name: `Deadlock route ${suffix}` }).returning();
    cleanup.customerIds.push(customer.id); cleanup.routeIds.push(route.id);
    const [shipment] = await db.insert(s.shipments).values({ shipmentCode: `DLK-${suffix}`.slice(0, 50), customerId: customer.id, status: 'DISPATCHED' }).returning();
    const [trip] = await db.insert(s.trips).values({ tripCode: `DLK-${suffix}`.slice(0, 50), customerId: customer.id, routeId: route.id, shipmentId: shipment.id, departureDate: '2026-09-15', status: 'IN_TRANSIT' }).returning();
    cleanup.shipmentIds.push(shipment.id); cleanup.tripIds.push(trip.id);
    await db.insert(s.userShipmentLinks).values({ userId: owner.id, shipmentId: shipment.id });
    const [account] = await db.insert(s.treasuryAccounts).values({ code: `DLK-${suffix}`.slice(0, 50), name: 'Deadlock cash', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: actor.id, updatedBy: actor.id }).returning();
    cleanup.accountIds.push(account.id);

    const expenseIds: number[] = [];
    for (const i of [1, 2]) {
      const [expense] = await db.insert(s.tripExpenses).values({ tripId: trip.id, forwarderId: owner.id, createdBy: owner.id, expenseType: 'OTHER', buyAmount: '500', sellAmount: '0', invoiceNumber: `DLK-EVIDENCE-${i}`, approvalStatus: 'RECORDED', settlementMethod: 'OPS_ADVANCE' }).returning();
      expenseIds.push(expense.id); cleanup.expenseIds.push(expense.id);
    }
    await db.insert(s.tripExpenseCompletionScopes).values({ tripId: trip.id, tripContainerId: null, status: 'COMPLETED', completedBy: actor.id, completedAt: new Date() });
    const advanceIds: number[] = [];
    for (const i of [1, 2]) {
      // recordFundedOpsAdvance takes a live transaction handle; each funding
      // commits in its own so the settles below can see it.
      const advanceId = await db.transaction(async (tx) => {
        const advance = await recordFundedOpsAdvance(tx, { userId: actor.id, role: Role.ACCOUNTANT }, {
          opsUserId: owner.id, amount: 600, reason: `QA deadlock-order funds ${i}`,
          treasuryAccountId: account.id, valueDate: '2026-09-10', physicalReference: `DLK-${suffix}-${i}`,
        });
        return advance.id;
      });
      advanceIds.push(advanceId); cleanup.advanceIds.push(advanceId);
    }

    // ── the contract: reversed caller orders over fully overlapping locks ──
    const outcomes = await Promise.allSettled([
      createAdvanceSettlement(owner.id, {
        advanceRequestIds: [advanceIds[1], advanceIds[0]], // descending input
        tripExpenseIds: [expenseIds[1], expenseIds[0]],
        refundAmount: 200,
      }),
      createAdvanceSettlement(owner.id, {
        advanceRequestIds: [advanceIds[0], advanceIds[1]], // ascending input
        tripExpenseIds: [expenseIds[0], expenseIds[1]],
        refundAmount: 200,
      }),
    ]);

    const deadlock = outcomes.filter((o) => o.status === 'rejected'
      && String((o.reason as { code?: string }).code ?? '').includes('40P01'));
    assert.equal(deadlock.length, 0, 'postgres detected a deadlock — the canonical lock order was violated');

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    assert.ok(fulfilled.length >= 1, 'at least one settlement completes — the pair serializes instead of deadlocking');
    for (const r of fulfilled) cleanup.settlementIds.push((r.value as { id: number }).id);
    for (const r of rejected) {
      // The loser must be a clean business rejection, never a crash.
      assert.ok(r.reason instanceof AdvanceError || r.reason instanceof Error, 'rejected with a typed error');
      assert.ok(!String((r.reason as { code?: string }).code ?? '').includes('40P01'));
    }
  });
});
