import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { assertOpsExpenseAssignment } from '../services/expense-owner-scope.service';

after(async () => { await client.end(); });

// The ops expense gate grants the right through ANY of: a manual user↔shipment
// link, an active truck assignment whose truck hauls the lot (any non-canceled
// trip), or the ops's own saved (non-voided) expense on the lot. Revoking the
// truck assignment removes the right on lots the ops never expensed.
test('ops expense scope: truck assignment grants right on hauled lots, revoke + cross-ops stay blocked', async () => {
  const rollback = Symbol('rollback');
  try {
  const key = crypto.randomUUID().slice(0, 8);
  await db.transaction(async tx => {
    const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
    const [route] = await tx.insert(s.routes).values({ name: key }).returning();
    const [truckA, truckB] = await tx.insert(s.trucks).values([
      { licensePlate: `54A${key}` },
      { licensePlate: `54B${key}` },
    ]).returning();
    const [opsA, opsB] = await tx.insert(s.users).values([
      { username: `qa54a${key}`, passwordHash: 'x', role: 'OPS', fullName: 'QA54 Ops A' },
      { username: `qa54b${key}`, passwordHash: 'x', role: 'OPS', fullName: 'QA54 Ops B' },
    ]).returning();
    const lots = await tx.insert(s.shipments).values([
      { customerId: customer.id, shipmentCode: `${key}-LIVE` },
      { customerId: customer.id, shipmentCode: `${key}-CANCEL` },
      { customerId: customer.id, shipmentCode: `${key}-EXP` },
      { customerId: customer.id, shipmentCode: `${key}-NONE` },
      { customerId: customer.id, shipmentCode: `${key}-TRUCKB` },
    ]).returning();
    const [lotLive, lotCancel, lotExpensed, lotNone, lotTruckB] = lots;
    await tx.insert(s.trips).values([
      { truckId: truckA.id, shipmentId: lotLive.id, customerId: customer.id, routeId: route.id, departureDate: '2026-09-21', status: 'IN_TRANSIT' },
      { truckId: truckA.id, shipmentId: lotCancel.id, customerId: customer.id, routeId: route.id, departureDate: '2026-09-21', status: 'CANCELED' },
      { truckId: truckB.id, shipmentId: lotTruckB.id, customerId: customer.id, routeId: route.id, departureDate: '2026-09-21', status: 'CREATED' },
    ]);
    const [assignA] = await tx.insert(s.truckOpsAssignments).values([
      { truckId: truckA.id, opsUserId: opsA.id, isActive: true },
      { truckId: truckB.id, opsUserId: opsB.id, isActive: true },
    ]).returning();
    await tx.insert(s.opsExpenseEntries).values({
      shipmentId: lotExpensed.id, expenseTypeCode: 'OTHER', amount: '1000',
      paidById: opsA.id, paidAt: '2026-09-21', approvalStatus: 'RECORDED',
    });

    // Active assignment + live trip → right granted (the auto-link path).
    await assertOpsExpenseAssignment(tx, opsA.id, lotLive.id);
    // Cross-ops: ops B (own truck, different lots) stays blocked on A's lot.
    await assert.rejects(() => assertOpsExpenseAssignment(tx, opsB.id, lotLive.id),
      (e: unknown) => e instanceof Error && /Quản trị viên/.test(e.message));
    // A canceled trip never hauled anything → no grant.
    await assert.rejects(() => assertOpsExpenseAssignment(tx, opsA.id, lotCancel.id));
    // Own saved expense keeps the right even with no live truck chain.
    await assertOpsExpenseAssignment(tx, opsA.id, lotExpensed.id);
    // Nothing links ops A to this lot → blocked.
    await assert.rejects(() => assertOpsExpenseAssignment(tx, opsA.id, lotNone.id));

    // Revoke the assignment: rights on never-expensed lots disappear, the
    // expensed lot keeps its grandfathered right.
    await tx.update(s.truckOpsAssignments)
      .set({ isActive: false })
      .where(eq(s.truckOpsAssignments.id, assignA.id));
    await assert.rejects(() => assertOpsExpenseAssignment(tx, opsA.id, lotLive.id));
    await assertOpsExpenseAssignment(tx, opsA.id, lotExpensed.id);

    // The manual per-lot link (admin user form) keeps working.
    await tx.insert(s.userShipmentLinks).values({ userId: opsB.id, shipmentId: lotNone.id });
    await assertOpsExpenseAssignment(tx, opsB.id, lotNone.id);

    throw rollback;
  });
  } catch (error) { if (error !== rollback) throw error; }
});
