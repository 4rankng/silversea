/**
 * Card 20260928_166 AC2 — the driver-facing assignment flag.
 *
 * A driver must be able to learn "this truck has no phơi-phiếu accountant"
 * WITHOUT being able to read the assignment map: `listTruckAccountantAssignments`
 * sits behind `requireFinance`, and naming the assigned accountant would leak
 * the accounting rota. So the helper answers one boolean, for one trip.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { tripTruckHasActiveAccountant } from '../services/expense-accounting-reads.service';

const suffix = Math.random().toString(36).slice(2, 7);
const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkTrip(truckId: number | null) {
  const [customer] = await db.insert(s.customers).values({ name: `c166c ${suffix}${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `c166r ${suffix}${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `C166-${suffix}${cleanup.length}`,
    customerId: customer.id, routeId: route.id, truckId, status: 'CREATED',
    departureDate: '2026-09-29',
  }).returning({ id: s.trips.id });
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return trip;
}

async function mkTruck() {
  const [truck] = await db.insert(s.trucks).values({ licensePlate: `C166P${suffix}${cleanup.length}` }).returning({ id: s.trucks.id });
  track(async () => { await db.delete(s.trucks).where(eq(s.trucks.id, truck.id)); });
  return truck;
}

async function mkAccountant() {
  const [u] = await db.insert(s.users).values({
    username: `c166a-${suffix}${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning({ id: s.users.id });
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

describe('card 20260928_166 AC2 — tripTruckHasActiveAccountant', () => {
  test('true only while a live assignment row exists', async () => {
    const truck = await mkTruck();
    const accountant = await mkAccountant();
    const trip = await mkTrip(truck.id);
    assert.equal(await tripTruckHasActiveAccountant(trip.id), false, 'no assignment yet');

    const [assignment] = await db.insert(s.truckAccountantAssignments).values({
      truckId: truck.id, accountantId: accountant.id, version: 1, assignedById: accountant.id,
    }).returning({ id: s.truckAccountantAssignments.id });
    track(async () => { await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.id, assignment.id)); });
    assert.equal(await tripTruckHasActiveAccountant(trip.id), true, 'assigned');

    // Reassigning ends the old row; the truck is still covered, so the flag
    // must not flicker to false for the window between the two writes.
    await db.update(s.truckAccountantAssignments)
      .set({ endedAt: new Date() })
      .where(eq(s.truckAccountantAssignments.id, assignment.id));
    const [next] = await db.insert(s.truckAccountantAssignments).values({
      truckId: truck.id, accountantId: accountant.id, version: 2, assignedById: accountant.id,
    }).returning({ id: s.truckAccountantAssignments.id });
    track(async () => { await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.id, next.id)); });
    assert.equal(await tripTruckHasActiveAccountant(trip.id), true, 'reassigned, still covered');

    await db.update(s.truckAccountantAssignments)
      .set({ endedAt: new Date() })
      .where(eq(s.truckAccountantAssignments.id, next.id));
    assert.equal(await tripTruckHasActiveAccountant(trip.id), false, 'unassigned again');
  });

  test('a trip with no truck is not treated as assigned', async () => {
    const trip = await mkTrip(null);
    assert.equal(await tripTruckHasActiveAccountant(trip.id), false);
  });
});
