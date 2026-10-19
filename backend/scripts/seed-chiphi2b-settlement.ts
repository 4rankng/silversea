// Seed ONE real phiếu hoàn ứng for the rung-3 UI drive of card 191026160000
// §3b (DUYỆT PHIẾU HOÀN ỨNG). Uses the REAL creation service path; rows carry
// the QA marker `chiphi2b-qa` for cleanup. Prints the settlement id + code.
// Cleanup: delete the seeded rows (see --cleanup below).
import { eq, inArray, like, and } from 'drizzle-orm';
import { db } from '../src/db';
import * as s from '../src/db/schema';
import { Role } from '@tingting/shared';
import { createAdvanceSettlement } from '../src/services/advance-settlement.service';
import { recordFundedOpsAdvance } from '../src/services/expense-accounting-reconciliation.service';

const MARK = 'chiphi2b-qa';

async function cleanup() {
  // Resolve fixtures by the QA users FIRST — the settlement code comes from
  // the shared generator (PT-…), so keying on a code prefix never matches.
  const users = await db.select({ id: s.users.id }).from(s.users).where(like(s.users.username, `${MARK}-%`));
  if (users.length > 0) {
    const ids = users.map((u) => u.id);
    const settlements = await db.select({ id: s.advanceSettlements.id }).from(s.advanceSettlements)
      .where(inArray(s.advanceSettlements.forwarderId, ids));
    for (const { id } of settlements) {
      await db.delete(s.settlementExpenses).where(eq(s.settlementExpenses.settlementId, id));
      await db.delete(s.advanceSettlementRequests).where(eq(s.advanceSettlementRequests.settlementId, id));
      await db.delete(s.ledger).where(and(eq(s.ledger.txnType, 'OPS_SETTLEMENT'), eq(s.ledger.txnId, id)));
      await db.delete(s.advanceSettlements).where(eq(s.advanceSettlements.id, id));
    }
    const accounts = await db.select({ id: s.treasuryAccounts.id }).from(s.treasuryAccounts)
      .where(inArray(s.treasuryAccounts.createdBy, ids));
    for (const { id } of accounts) await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, id));
    const advances = await db.select({ id: s.advanceRequests.id }).from(s.advanceRequests)
      .where(inArray(s.advanceRequests.requesterId, ids));
    for (const { id } of advances) {
      await db.delete(s.advanceSettlementRequests).where(eq(s.advanceSettlementRequests.advanceRequestId, id));
      await db.delete(s.advanceRequests).where(eq(s.advanceRequests.id, id));
    }
    const trips = await db.select({ id: s.trips.id }).from(s.trips).where(like(s.trips.tripCode, `${MARK}-%`));
    for (const { id } of trips) {
      await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, id));
      await db.delete(s.tripExpenses).where(eq(s.tripExpenses.tripId, id));
      await db.delete(s.trips).where(eq(s.trips.id, id));
    }
    const shipments = await db.select({ id: s.shipments.id }).from(s.shipments).where(like(s.shipments.shipmentCode, `${MARK}-%`));
    for (const { id } of shipments) {
      await db.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.shipmentId, id));
      await db.delete(s.shipments).where(eq(s.shipments.id, id));
    }
    await db.delete(s.customers).where(like(s.customers.name, `%${MARK}%`));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    console.log(`cleanup done (settlements removed: ${settlements.length})`);
    return;
  }
  console.log('cleanup: no QA fixtures found (already clean)');
}

if (process.argv.includes('--cleanup')) {
  await cleanup();
  process.exit(0);
}

// ── seed ──
const [kt] = await db.insert(s.users).values({ username: `${MARK}-kt`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE', fullName: 'KT chiphi2b QA' }).returning();
const [ops] = await db.insert(s.users).values({ username: `${MARK}-ops`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE', fullName: 'Ops chiphi2b QA' }).returning();
const [customer] = await db.insert(s.customers).values({ name: `Khách ${MARK}` }).returning();
const [route] = await db.insert(s.routes).values({ name: `Route ${MARK}` }).returning();
const [shipment] = await db.insert(s.shipments).values({ shipmentCode: `${MARK}-S1`, customerId: customer.id, status: 'DISPATCHED' }).returning();
const [trip] = await db.insert(s.trips).values({ tripCode: `${MARK}-T1`, customerId: customer.id, routeId: route.id, shipmentId: shipment.id, departureDate: '2026-10-18', status: 'COMPLETED' }).returning();
await db.insert(s.userShipmentLinks).values({ userId: ops.id, shipmentId: shipment.id });
const [account] = await db.insert(s.treasuryAccounts).values({ code: `${MARK}-ACC`, name: 'chiphi2b QA cash', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: kt.id, updatedBy: kt.id }).returning();
const advance = await db.transaction(async (tx) => recordFundedOpsAdvance(tx, { userId: kt.id, role: Role.ACCOUNTANT }, {
  opsUserId: ops.id, amount: 600, reason: `${MARK} funds`,
  treasuryAccountId: account.id, valueDate: '2026-10-18', physicalReference: `${MARK}-PH`,
}));
const [expense] = await db.insert(s.tripExpenses).values({ tripId: trip.id, forwarderId: ops.id, createdBy: ops.id, expenseType: 'OTHER', buyAmount: '500', sellAmount: '0', invoiceNumber: `${MARK}-INV`, approvalStatus: 'RECORDED', settlementMethod: 'OPS_ADVANCE' }).returning();
await db.insert(s.tripExpenseCompletionScopes).values({ tripId: trip.id, tripContainerId: null, status: 'COMPLETED', completedBy: kt.id, completedAt: new Date() });
const settlement = await createAdvanceSettlement(ops.id, {
  advanceRequestIds: [advance.id], tripExpenseIds: [expense.id], refundAmount: 100,
});
console.log(JSON.stringify({ settlementId: settlement.id, code: settlement.code, forwarderId: ops.id }));
