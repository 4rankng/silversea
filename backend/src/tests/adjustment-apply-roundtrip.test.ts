import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { runInTx } from '../lib/tx';
import { createAdjustment } from '../services/financial.service';
import { getTripAdjustments } from '../services/financial.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdUserIds: number[] = [];
const createdTripIds: number[] = [];
let tripId = 0;
let customerId = 0;

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Adj apply ${suffix}`, status: 'ACTIVE' }).returning();
  customerId = customer.id;
  createdCustomerIds.push(customer.id);
  const [maker] = await db.insert(s.users).values({ username: `adj-apply-${suffix}`, passwordHash: 'x', role: 'MANAGER', status: 'ACTIVE' }).returning();
  createdUserIds.push(maker.id);
  const [route] = await db.insert(s.routes).values({ name: `Adj route ${suffix}` }).returning();
  const [trip] = await db.insert(s.trips).values({
    customerId,
    routeId: route.id,
    departureDate: '2026-09-14',
    status: 'COMPLETED',
  }).returning();
  tripId = trip.id;
  createdTripIds.push(tripId);
  (globalThis as Record<string, unknown>).__adjMaker = { id: maker.id, role: 'MANAGER' };
});

after(async () => {
  await db.delete(s.ledger).where(and(eq(s.ledger.txnType, 'ADJUSTMENT'), eq(s.ledger.txnId, tripId)));
  if (createdTripIds.length) {
    await db.delete(s.trips).where(eq(s.trips.id, tripId));
    await db.delete(s.routes).where(eq(s.routes.name, `Adj route ${suffix}`));
  }
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.users).where(eq(s.users.id, createdUserIds[0]!));
  await client.end();
});

const maker = () => (globalThis as unknown as { __adjMaker: { id: number; role: string } }).__adjMaker;

// Staging round-5 regression: POST /trips/:id/adjustment returned 201 but the
// ledger never moved (GET adjustments [] — revenue unchanged). The make stage
// only built the action; the apply must post the ADJUSTMENT entry in-request.
describe('adjustment apply roundtrip', () => {
  test('createAdjustment posts the ledger entry the adjustments readback returns', async () => {
    const before = await getTripAdjustments(tripId);
    assert.equal(before.length, 0);

    const action = await runInTx(undefined, (tx) => createAdjustment({
      tripId,
      amount: 2_000_000,
      note: `QA roundtrip ${suffix}`,
      signedAgreementRef: `BB-${suffix}`,
      makerId: maker().id,
      makerRole: maker().role,
      expectedTripVersion: 1,
      transaction: tx,
    }));

    assert.ok(action, 'apply returns the applied action');
    const rows = await getTripAdjustments(tripId);
    assert.equal(rows.length, 1, 'GET adjustments readback must list the posted entry');
    const [entry] = rows;
    assert.equal(Number(entry.debit), 2_000_000, 'positive adjustment posts a debit on the customer');
    assert.ok(String(entry.note).includes(`BB-${suffix}`), 'agreement reference rides the note');
  });
});
