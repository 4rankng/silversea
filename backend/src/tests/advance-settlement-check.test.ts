// Card 191026160000 (§3b) — DUYỆT PHIẾU HOÀN ỨNG service contract.
// Creation leaves checked_by NULL (the submitter's own tick stays
// approved_by); checkAdvanceSettlement stamps the accountant's verification,
// bumps version, refuses double-duyệt and stale versions. Cases CP2-A1.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { createAdvanceSettlement, checkAdvanceSettlement } from '../services/advance-settlement.service';
import { recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { AdvanceError } from '../services/settlement-validation';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup = { userIds: [] as number[], accountIds: [] as number[], advanceIds: [] as number[], expenseIds: [] as number[], settlementIds: [] as number[], tripIds: [] as number[], shipmentIds: [] as number[], routeIds: [] as number[], customerIds: [] as number[] };

after(async () => {
  const tryDelete = async (run: () => Promise<unknown>) => {
    try { await run(); } catch { /* leaked rows carry the unique suffix */ }
  };
  for (const id of cleanup.settlementIds) {
    await tryDelete(() => db.delete(s.settlementExpenses).where(eq(s.settlementExpenses.settlementId, id)));
    await tryDelete(() => db.delete(s.advanceSettlementRequests).where(eq(s.advanceSettlementRequests.settlementId, id)));
    await tryDelete(() => db.delete(s.ledger).where(eq(s.ledger.txnType, 'OPS_SETTLEMENT')).then(() => undefined));
    await tryDelete(() => db.delete(s.advanceSettlements).where(eq(s.advanceSettlements.id, id)));
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

describe('DUYỆT PHIẾU HOÀN ỨNG (card 191026160000 §3b)', () => {
  test('creation leaves checked_by NULL; kế toán duyệt stamps the check once; double-duyệt and stale versions refuse', async () => {
    // ── fixtures (committed) ──
    const [kt] = await db.insert(s.users).values({ username: `chk-kt-${suffix}`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE', fullName: `Kế Toán ${suffix}` }).returning();
    const [ops] = await db.insert(s.users).values({ username: `chk-ops-${suffix}`, passwordHash: 'test', role: Role.OPS, status: 'ACTIVE' }).returning();
    cleanup.userIds.push(kt.id, ops.id);
    const [customer] = await db.insert(s.customers).values({ name: `Check duyệt ${suffix}` }).returning();
    const [route] = await db.insert(s.routes).values({ name: `Check route ${suffix}` }).returning();
    cleanup.customerIds.push(customer.id); cleanup.routeIds.push(route.id);
    const [shipment] = await db.insert(s.shipments).values({ shipmentCode: `CHK-${suffix}`.slice(0, 50), customerId: customer.id, status: 'DISPATCHED' }).returning();
    const [trip] = await db.insert(s.trips).values({ tripCode: `CHK-${suffix}`.slice(0, 50), customerId: customer.id, routeId: route.id, shipmentId: shipment.id, departureDate: '2026-10-10', status: 'COMPLETED' }).returning();
    cleanup.shipmentIds.push(shipment.id); cleanup.tripIds.push(trip.id);
    await db.insert(s.userShipmentLinks).values({ userId: ops.id, shipmentId: shipment.id });
    const [account] = await db.insert(s.treasuryAccounts).values({ code: `CHK-${suffix}`.slice(0, 50), name: 'Check cash', type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: kt.id, updatedBy: kt.id }).returning();
    cleanup.accountIds.push(account.id);

    const advanceId = await db.transaction(async (tx) => {
      const advance = await recordFundedOpsAdvance(tx, { userId: kt.id, role: Role.ACCOUNTANT }, {
        opsUserId: ops.id, amount: 600, reason: `QA check-duyet funds ${suffix}`,
        treasuryAccountId: account.id, valueDate: '2026-10-10', physicalReference: `CHK-${suffix}`,
      });
      return advance.id;
    });
    cleanup.advanceIds.push(advanceId);
    const [expense] = await db.insert(s.tripExpenses).values({ tripId: trip.id, forwarderId: ops.id, createdBy: ops.id, expenseType: 'OTHER', buyAmount: '500', sellAmount: '0', invoiceNumber: `CHK-EVIDENCE-${suffix}`, approvalStatus: 'RECORDED', settlementMethod: 'OPS_ADVANCE' }).returning();
    cleanup.expenseIds.push(expense.id);
    await db.insert(s.tripExpenseCompletionScopes).values({ tripId: trip.id, tripContainerId: null, status: 'COMPLETED', completedBy: kt.id, completedAt: new Date() });

    const created = await createAdvanceSettlement(ops.id, {
      advanceRequestIds: [advanceId], tripExpenseIds: [expense.id], refundAmount: 100,
    });
    cleanup.settlementIds.push(created.id);

    // Creation pin: the submitter's own tick is approved_by; checked_by waits
    // for kế toán (the §3b supersession of the Option B checked_by reading).
    assert.equal(created.approvedBy, ops.id, 'approved_by = the creating Ops (tự xác nhận)');
    assert.equal(created.checkedBy, null, 'checked_by NULL at creation — kế toán duyệt là một act riêng');
    assert.equal(created.status, 'RECORDED');

    // Duyệt stamps the accountant and bumps the version.
    const checked = await checkAdvanceSettlement(created.id, { actorId: kt.id });
    assert.equal(checked.checkedBy, kt.id, 'checked_by = kế toán after duyệt');
    assert.ok(checked.checkedAt != null, 'checked_at stamped');
    assert.ok(checked.version > created.version, 'version bumped (optimistic lock)');
    assert.equal(checked.checkerName != null, true, 'the enriched payload names the checker');

    // Double-duyệt refuses with the business language.
    await assert.rejects(
      () => checkAdvanceSettlement(created.id, { actorId: kt.id }),
      (error: unknown) => error instanceof AdvanceError && error.status === 409
        && /đã được kế toán duyệt/.test(error.message),
    );

    // A stale version refuses through the shared optimistic-lock guard.
    const [second] = await db.insert(s.users).values({ username: `chk-kt2-${suffix}`, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE', fullName: `KT Hai ${suffix}` }).returning();
    cleanup.userIds.push(second.id);
    await assert.rejects(
      () => checkAdvanceSettlement(created.id, { expectedVersion: created.version, actorId: second.id }),
      (error: unknown) => error instanceof AdvanceError && error.status === 409,
    );

    // Review F3 — same-actor double-submit is refused even in the legacy
    // signature (checked_by = the forwarder's own id): a duyệt by an
    // accountant who IS the phiếu's forwarder leaves checked_by ===
    // forwarder_id, which guard 1 cannot distinguish from the legacy stamp —
    // guard 2 refuses the SAME actor's repeated clicks so the row cannot loop
    // version bumps + notifications forever.
    await db.update(s.advanceSettlements).set({ checkedBy: ops.id, checkedAt: new Date() }).where(eq(s.advanceSettlements.id, created.id));
    await assert.rejects(
      () => checkAdvanceSettlement(created.id, { actorId: ops.id }),
      (error: unknown) => error instanceof AdvanceError && error.status === 409
        && /Bạn đã duyệt phiếu này rồi/.test(error.message),
    );

    // A DIFFERENT accountant may still take the legacy/pathological stamp
    // over — exactly once (their duyệt is then terminal by guard 1).
    const rechecked = await checkAdvanceSettlement(created.id, { actorId: second.id });
    assert.equal(rechecked.checkedBy, second.id, 'a submitter-stamped legacy row re-opens for kế toán duyệt');
  });
});
