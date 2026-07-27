/**
 * Regression for D1 (2026-07-27 audit) — concurrent trip_expense approval.
 *
 * `transitionApproval` did a plain SELECT of approvalStatus with no row lock,
 * so two parallel POST /api/trips/:id/expenses/:eid/approve calls on the same
 * PENDING expense both read PENDING, both passed the guard, and both flipped
 * the row to APPROVED. `processExpenseApproval` has no second entity lock
 * (unlike `approveDebtOffset`), so nothing masked the race. Both callers got
 * 200 OK and the guards (`assertFuelReconClear` etc.) fired twice.
 *
 * The fix adds `.for('update')` to the status SELECT in transitionApproval,
 * forcing concurrent approvals to serialize on the row lock. The loser then
 * sees APPROVED and returns an explicit 409 conflict.
 *
 * We test the public `processExpenseApproval` (the route handler's entry
 * point) rather than `transitionApproval` directly, because that's the
 * actually-exposed code path.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { processExpenseApproval } from '../services/approval.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdUserIds: number[] = [];

async function mkTrip() {
  const [cust] = await db.insert(s.customers)
    .values({ name: `D1 cust ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(cust.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `D1 route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes)
    .values({ name: `D1 cargo ${suffix}-${createdCargoTypeIds.length}` })
    .returning();
  createdCargoTypeIds.push(cargo.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `D1-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: '2026-07-15', carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkPendingExpense(tripId: number, createdBy: number) {
  // Use an unknown FET code so the no-invoice-disbursement guard fails open
  // (returns early on unknown code) and the fuel-recon guard skips us (not
  // a fuel-typed expense). We're testing the race in transitionApproval,
  // not the guards themselves.
  const [e] = await db.insert(s.tripExpenses).values({
    tripId,
    createdBy,
    expenseType: `D1-UNKNOWN-${suffix}`,
    buyAmount: '100000',
    sellAmount: '0',
    supplierId: null,
    approvalStatus: 'PENDING',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

async function mkAdmin() {
  const [u] = await db.insert(s.users).values({
    username: `d1-admin-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x', role: 'ADMIN', status: 'ACTIVE',
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

after(async () => {
  const pat = `%${suffix}%`;
  try {
    if (createdExpenseIds.length) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length)    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdCargoTypeIds.length) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${pat}`);
    if (createdRouteIds.length)   await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${pat}`);
    if (createdCustomerIds.length) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${pat}`);
    if (createdUserIds.length)    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) { console.warn('[d1] cleanup:', (err as Error).message); }
  await client.end();
});

// `processExpenseApproval` returns `{ok:true}` for the inline trip/forwarder
// checks (status 404/400/409) but lets `transitionApproval`'s ApiError throw —
// the route's asyncHandler converts thrown ApiErrors to JSON. Both surfaces
// must be recognised as "rejected" by the test. Normalise to {ok} | {error}.
async function runApprove(tripId: number, expenseId: number, actorId: number) {
  try {
    return await processExpenseApproval(tripId, expenseId, actorId, 'ADMIN', 'APPROVED');
  } catch (e) {
    const err = e as Error & { statusCode?: number };
    return { error: err.message, status: err.statusCode ?? 500 };
  }
}

describe('D1 — concurrent trip_expense approval race', () => {
  test('two parallel approvals: exactly one wins, the other gets 409 APPROVED', async () => {
    const maker = await mkAdmin();
    const admin = await mkAdmin();
    const trip = await mkTrip();
    const expense = await mkPendingExpense(trip.id, maker.id);

    const results = await Promise.all([
      runApprove(trip.id, expense.id, admin.id),
      runApprove(trip.id, expense.id, admin.id),
    ]);

    const oks = results.filter(r => 'ok' in r);
    const errs = results.filter(r => 'error' in r);

    assert.equal(oks.length, 1,
      `expected exactly 1 approve to succeed, got ${oks.length}. results=${JSON.stringify(results)}`);
    assert.equal(errs.length, 1,
      `expected exactly 1 to be rejected, got ${errs.length}`);
    assert.equal(errs[0].status, 409, `expected 409 on losing approve, got ${errs[0].status}`);
    assert.match(errs[0].error, /APPROVED/,
      `expected "APPROVED" in message, got "${errs[0].error}"`);

    // Status really is APPROVED (no torn write).
    const [row] = await db.select({ approvalStatus: s.tripExpenses.approvalStatus })
      .from(s.tripExpenses).where(eq(s.tripExpenses.id, expense.id));
    assert.equal(row?.approvalStatus, 'APPROVED');
  });

  test('sequential: second approve after first commits also gets 409', async () => {
    // Sanity: the race fix must not break the sequential case.
    const maker = await mkAdmin();
    const admin = await mkAdmin();
    const trip = await mkTrip();
    const expense = await mkPendingExpense(trip.id, maker.id);

    const first  = await runApprove(trip.id, expense.id, admin.id);
    const second = await runApprove(trip.id, expense.id, admin.id);

    assert.ok('ok' in first, 'first approve wins');
    assert.ok('error' in second, 'second approve is rejected');
    assert.equal(second.status, 409);
  });
});
