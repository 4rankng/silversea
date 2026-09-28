/**
 * Card 20260928_181 — red-first regression for the settlement-adjustment path.
 *
 * The stored `advance_settlements.total_expense_amount` is a TOTAL over the
 * phiếu's linked expense rows, and the PM rule says a row with a NEGATIVE
 * amount must make that total behave exactly as if the row did not exist.
 * `advance-settlement-reversal.service.ts` used to move the stored total by the
 * RAW row difference (`newBuyAmount - oldBuyAmount`). That is only correct while
 * a row cannot cross zero: driving a linked row from +1.000 to -2.000.000
 * changes its CONTRIBUTION to the total from 1.000 to 0, but the raw delta
 * subtracts 2.001.000 — and the balance guard does NOT catch it, because
 * `adjustSettlementExpense` compensates `refundAmount` with the same wrong
 * delta, so both sides drift together and the invariant still holds.
 *
 * The assertion is the PM's own: the stored total must equal
 * `sumExcludingNegative(linked rows)`. Before the fix this test is RED
 * (-2.000.000 instead of 0); after it is GREEN.
 *
 * The values are read inside the rolled-back transaction and asserted outside
 * it, so a failure is reported as a clean assertion rather than as an
 * unhandled rejection surfacing from a failing transaction.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { Role, sumExcludingNegative } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { Tx } from '../services/trip-shared';
import { recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { createAdvanceSettlement } from '../services/advance-settlement.service';
import { adjustSettlementExpense } from '../services/advance-settlement-reversal.service';

async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error('rollback test fixture');
  try { await db.transaction(async tx => { await run(tx); throw rollback; }); } catch (error) { if (error !== rollback) throw error; }
}

async function settlementFixture(tx: Tx) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [actor] = await tx.insert(s.users).values({ username: `signed-exp-adj-${suffix}`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
  const [owner] = await tx.insert(s.users).values({ username: `signed-exp-ops-${suffix}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
  const [customer] = await tx.insert(s.customers).values({ name: `Signed expense adjustment ${suffix}` }).returning();
  const [route] = await tx.insert(s.routes).values({ name: `Signed expense route ${suffix}` }).returning();
  const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: `SIGNED-${suffix}`.slice(0, 50), customerId: customer.id, status: 'DISPATCHED' }).returning();
  const [trip] = await tx.insert(s.trips).values({ tripCode: `SIGNED-${suffix}`.slice(0, 50), customerId: customer.id, routeId: route.id, shipmentId: shipment.id, departureDate: '2026-09-15', status: 'IN_TRANSIT' }).returning();
  await tx.insert(s.userShipmentLinks).values({ userId: owner.id, shipmentId: shipment.id });
  const [expense] = await tx.insert(s.tripExpenses).values({ tripId: trip.id, forwarderId: owner.id, createdBy: owner.id, expenseType: 'OTHER', buyAmount: '1000', sellAmount: '0', invoiceNumber: 'QA-EVIDENCE', approvalStatus: 'RECORDED', settlementMethod: 'OPS_ADVANCE' }).returning();
  const [account] = await tx.insert(s.treasuryAccounts).values({ code: `SIGNED-${owner.id}`, name: 'Signed expense cash', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: actor.id, updatedBy: actor.id }).returning();
  const advance = await recordFundedOpsAdvance(tx, { userId: actor.id, role: Role.ACCOUNTANT }, { opsUserId: owner.id, amount: 1500, reason: 'QA signed-expense funds', treasuryAccountId: account.id, valueDate: '2026-09-10', physicalReference: `SIGNED-${owner.id}` });
  await tx.insert(s.tripExpenseCompletionScopes).values({ tripId: trip.id, tripContainerId: null, status: 'COMPLETED', completedBy: actor.id, completedAt: new Date() });
  return { actor, owner, trip, shipment, expense, advance };
}

interface Crossing {
  /** The adjustment was applied — i.e. the balance guard did not reject it. */
  applied: boolean;
  /** The linked row really moved from positive to negative. */
  crossed: boolean;
  /** What the service stored. */
  storedTotal: number;
  /** sumExcludingNegative over the linked rows — what the PM rule demands. */
  ruleSum: number;
  /** What the raw-difference (pre-fix) arithmetic would have written. */
  rawDeltaTotal: number;
}

/** Runs the crossing scenario inside a transaction that is always rolled back. */
async function observeCrossing(): Promise<Crossing> {
  let observed: Crossing | null = null;
  await isolated(async tx => {
    const f = await settlementFixture(tx);
    const settlement = await createAdvanceSettlement(f.owner.id, { advanceRequestIds: [f.advance.id], tripExpenseIds: [f.expense.id], refundAmount: 500 }, tx);

    const linksBefore = await tx.select({ buyAmount: s.settlementExpenses.adjustedBuyAmount })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.settlementId, settlement.id));
    const [beforeRow] = await tx.select({ total: s.advanceSettlements.totalExpenseAmount })
      .from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlement.id));
    assert.equal(Number(beforeRow.total), sumExcludingNegative(linksBefore, (row) => row.buyAmount), 'baseline: the stored total is the exclusion-rule sum of its linked rows');

    const outcome = await adjustSettlementExpense(settlement.id, f.expense.id, f.actor.id, {
      expectedVersion: settlement.version,
      buyAmount: -2_000_000,
      sellAmount: 0,
      adjustmentReason: 'Điều chỉnh ngược dấu — kiểm chứng luật dòng âm',
    }, { transaction: tx, emitNotification: false, actorRole: Role.ACCOUNTANT });

    const linksAfter = await tx.select({ buyAmount: s.settlementExpenses.adjustedBuyAmount })
      .from(s.settlementExpenses).where(eq(s.settlementExpenses.settlementId, settlement.id));
    const [afterRow] = await tx.select({ total: s.advanceSettlements.totalExpenseAmount })
      .from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlement.id));

    observed = {
      applied: Boolean(outcome.governanceAction?.appliedAt),
      crossed: Number(linksAfter[0].buyAmount) < 0,
      storedTotal: Number(afterRow.total),
      ruleSum: sumExcludingNegative(linksAfter, (row) => row.buyAmount),
      rawDeltaTotal: Number(settlement.totalExpenseAmount) + (Number(linksAfter[0].buyAmount) - Number(linksBefore[0].buyAmount)),
    };
  });
  const result = observed as Crossing | null;
  assert.ok(result, 'the scenario produced an observation');
  return result;
}

test('card 20260928_181 — an adjustment driving a linked expense NEGATIVE keeps the stored settlement total at sum-excluding-negative', async () => {
  const crossing = await observeCrossing();

  assert.ok(crossing.applied, 'the adjustment applied — the balance guard does NOT catch the sign crossing (that is the defect this test pins)');
  assert.ok(crossing.crossed, 'the linked row really crossed zero');

  assert.equal(crossing.storedTotal, crossing.ruleSum, 'the stored total treats the negative row as absent (0 here)');
  assert.notEqual(crossing.storedTotal, crossing.rawDeltaTotal, 'and it is NOT the raw arithmetic delta the pre-fix code wrote');
});

after(async () => {
  await disconnectRedis();
  await client.end();
});
