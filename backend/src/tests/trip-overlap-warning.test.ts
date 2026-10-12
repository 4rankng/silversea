// Ticket 111026105630 (FB-038 / FB-072 reopen): the dispatch-side overlap
// guard family (assertPlanRowRigAvailable, card 101026043000) never covered
// the TRIP edit form — PUT /trips/:id/pre-departure|actuals lands truckId via
// updateTripFigures with no rig check, so assigning a tractor already
// dispatched the same window saved silently. The round-14 staging repro:
// /trips/153 'Chỉnh sửa' → picker 'Xe đầu kéo' → 15H-117.55 (already on
// /trips/160 the same day) → 'Lưu cập nhật' → toast, no warning.
//
// Same FB-038 law as the family: never a silent save. Strong evidence on both
// sides refuses (409); weak evidence (date-only windows, completed holders)
// warns once via RIG_OVERLAP_COMPLETED and the confirmed save proceeds.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { FuelMode, Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { updateTripFigures } from '../services/trip-figure-updates.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const truckIds: number[] = [];
const tripIds: number[] = [];

async function actor() {
  const [row] = await db.insert(s.users).values({
    username: `tow-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  userIds.push(row.id);
  return { userId: row.id, userRole: Role.ADMIN };
}

async function makeCustomer() {
  const [row] = await db.insert(s.customers).values({ name: `TOW KH ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(row.id);
  return row.id;
}

async function makeRoute() {
  const [row] = await db.insert(s.routes).values({ name: `TOW Tuyen ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(row.id);
  return row.id;
}

async function makeTruck() {
  const plate = `TOW${suffix.slice(-4)}${truckIds.length}`.toUpperCase();
  const [row] = await db.insert(s.trucks).values({ licensePlate: plate, status: 'ACTIVE' }).returning();
  truckIds.push(row.id);
  return { id: row.id, plate };
}

async function insertTrip(values: Omit<typeof s.trips.$inferInsert, 'customerId' | 'departureDate'> & {
  customerId: number; departureDate: string;
}) {
  const [row] = await db.insert(s.trips).values({
    tripCode: `TOW-TRIP-${suffix}-${tripIds.length}`,
    createdBy: userIds.at(-1)!,
    ...values,
  }).returning();
  tripIds.push(row.id);
  return row;
}

/** The saving window of an issued trip: a real timestamp claims 8h (card 363). */
const SLOT = new Date('2026-10-12T01:45:00.000Z');

function figuresPayload(truckId: number, version: number, extra: Record<string, unknown> = {}) {
  return {
    legs: [],
    fuelMode: FuelMode.AUTO,
    truckId,
    version,
    ...extra,
  };
}

describe('trip edit form claims the rig like every other surface (ticket 111026105630)', () => {
  test('assigning a tractor already dispatched in the same window refuses instead of saving silently', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const shared = await makeTruck();
    const other = await makeTruck();
    // The holder (/trips/160-shaped): an active trip riding `shared` at SLOT.
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: shared.id,
      plannedStartAt: SLOT, plannedEndAt: null, status: 'CREATED',
    });
    // The target (/trips/153-shaped): rides `other`, being edited onto `shared`.
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: other.id,
      plannedStartAt: new Date(SLOT.getTime() + 3600_000), plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => updateTripFigures(target.id, figuresPayload(shared.id, target.version, { userId: a.userId, userRole: a.userRole })),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected an overlap refusal, got: ${e.message}`);
        assert.equal(e.payload?.code, undefined, 'fully-evidenced overlap must keep the hard tier');
        assert.match(String(e.message), /trùng lặp/, 'the family overlap copy');
        return true;
      },
    );
  });

  test('a completed-trip overlap warns once and the confirmed retry proceeds (FB-038 ruling)', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const shared = await makeTruck();
    const other = await makeTruck();
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: shared.id,
      plannedStartAt: SLOT, plannedEndAt: null, status: 'COMPLETED',
    });
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: other.id,
      plannedStartAt: new Date(SLOT.getTime() + 3600_000), plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => updateTripFigures(target.id, figuresPayload(shared.id, target.version, { userId: a.userId, userRole: a.userRole })),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the warn refusal, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', 'warn-once family payload');
        assert.match(String(e.message), /Vẫn lưu/, 'the warn copy must invite the confirm');
        return true;
      },
    );

    const saved = await updateTripFigures(target.id, figuresPayload(shared.id, target.version, {
      userId: a.userId, userRole: a.userRole, confirmOverlap: true,
    }));
    assert.ok(saved, 'the confirmed retry must proceed (warning, not a hard block)');
    const [row] = await db.select({ truckId: s.trips.truckId }).from(s.trips).where(eq(s.trips.id, target.id));
    assert.equal(row.truckId, shared.id, 'the confirmed save really moved the tractor');
  });

  test('a date-only departure claims the displayed day at the warn tier (12fcf20d law)', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const shared = await makeTruck();
    const other = await makeTruck();
    // Holder without a planned timestamp: its departureDate claims the whole day.
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: shared.id,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: other.id,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => updateTripFigures(target.id, figuresPayload(shared.id, target.version, { userId: a.userId, userRole: a.userRole })),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the warn refusal, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', 'date-only evidence stays at the warn tier');
        return true;
      },
    );
  });

  test('no overlap, no warning — unrelated windows save untouched', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const shared = await makeTruck();
    const other = await makeTruck();
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: shared.id,
      plannedStartAt: SLOT, plannedEndAt: null, status: 'CREATED',
    });
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-20', truckId: other.id,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });

    const saved = await updateTripFigures(target.id, figuresPayload(shared.id, target.version, {
      userId: a.userId, userRole: a.userRole,
    }));
    assert.ok(saved, 'a different day must save without any warning');
  });
});

after(async () => {
  // Test rows carry unique suffixes; remove only this run's fixtures.
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (truckIds.length) await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
  await client.end();
  await disconnectRedis();
});
