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
import { reassignTrip } from '../services/trip-lifecycle-ops.service';

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

const driverIds: number[] = [];

async function makeDriver() {
  const [row] = await db.insert(s.drivers).values({ name: `TOW TX ${suffix}-${driverIds.length}`, status: 'ACTIVE' }).returning();
  driverIds.push(row.id);
  return row.id;
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

// Round-17 sweep (overlap warning missing, P3): the trip-side guard scanned
// the tractor's PLATE only, so the SAME driver double-booked across two
// DIFFERENT tractors saved silently on the direct create/edit path (local
// repro: truck A + driver X, then truck B + driver X the same window → 201,
// no warning). FB-038 ruling: WARN once, never a new hard block — the family
// payload (RIG_OVERLAP_COMPLETED) rides the existing confirm plumbing.
describe('the driver claim warns like the rig claim (round-17 sweep)', () => {
  test('same driver on another tractor in the same window warns, and the confirmed retry proceeds', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const truckA = await makeTruck();
    const truckB = await makeTruck();
    const driverX = await makeDriver();
    const driverY = await makeDriver();
    // Holder: driverX rides truckA at SLOT.
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckA.id, driverId: driverX,
      plannedStartAt: SLOT, plannedEndAt: null, status: 'CREATED',
    });
    // Target: driverY on truckB, being edited onto driverX — the exact
    // cross-tractor double-booking the plate scans cannot see.
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckB.id, driverId: driverY,
      plannedStartAt: new Date(SLOT.getTime() + 3600_000), plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => updateTripFigures(target.id, figuresPayload(truckB.id, target.version, {
        userId: a.userId, userRole: a.userRole, driverId: driverX,
      })),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the driver warn refusal, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', 'warn-once family payload');
        assert.match(String(e.message), /Tài xế đã có .* chuyến khác trùng khung giờ/, 'the driver warn copy');
        return true;
      },
    );

    const saved = await updateTripFigures(target.id, figuresPayload(truckB.id, target.version, {
      userId: a.userId, userRole: a.userRole, driverId: driverX, confirmOverlap: true,
    }));
    assert.ok(saved, 'the confirmed retry must proceed (warning, not a hard block)');
    const [row] = await db.select({ driverId: s.trips.driverId }).from(s.trips).where(eq(s.trips.id, target.id));
    assert.equal(row.driverId, driverX, 'the confirmed save really moved the driver');
  });

  test('sequential same-day windows for one driver stay silent when the timestamps prove no overlap', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const truckA = await makeTruck();
    const truckB = await makeTruck();
    const driverX = await makeDriver();
    const driverY = await makeDriver();
    // Holder: driverX 08:45–12:45 on truckA (an explicit end bounds the claim).
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckA.id, driverId: driverX,
      plannedStartAt: SLOT, plannedEndAt: new Date(SLOT.getTime() + 4 * 3600_000), status: 'CREATED',
    });
    // Target: driverY on truckB being edited onto driverX with a 14:45 start —
    // provably after the holder's explicit end, so no driver warn may fire.
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckB.id, driverId: driverY,
      plannedStartAt: new Date(SLOT.getTime() + 6 * 3600_000), plannedEndAt: new Date(SLOT.getTime() + 10 * 3600_000), status: 'CREATED',
    });

    const saved = await updateTripFigures(target.id, figuresPayload(truckB.id, target.version, {
      userId: a.userId, userRole: a.userRole, driverId: driverX,
    }));
    assert.ok(saved, 'a provably sequential afternoon trip is not a driver overlap');
    const [row] = await db.select({ driverId: s.trips.driverId }).from(s.trips).where(eq(s.trips.id, target.id));
    assert.equal(row.driverId, driverX);
  });

  test('control: another driver on another tractor in the same window stays silent', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const truckA = await makeTruck();
    const truckB = await makeTruck();
    const driverX = await makeDriver();
    const driverY = await makeDriver();
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckA.id, driverId: driverX,
      plannedStartAt: SLOT, plannedEndAt: null, status: 'CREATED',
    });
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckB.id, driverId: driverY,
      plannedStartAt: new Date(SLOT.getTime() + 3600_000), plannedEndAt: null, status: 'CREATED',
    });

    const saved = await updateTripFigures(target.id, figuresPayload(truckB.id, target.version, {
      userId: a.userId, userRole: a.userRole, driverId: driverY,
    }));
    assert.ok(saved, 'a different driver on a different tractor is nobody\'s overlap');
  });

  // Round-18 review sweep (§2 sibling consumers): the fallback reassignment
  // path — no resolvable fulfillment, staged times never landed — wrote
  // truck+driver with no overlap guard. It now claims the pair through the
  // same trip-side warn.
  test('the legacy reassignTrip fallback warns on a driver double-booking and the confirmed retry proceeds', async () => {
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const truckA = await makeTruck();
    const truckB = await makeTruck();
    const driverX = await makeDriver();
    const driverY = await makeDriver();
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckA.id, driverId: driverX,
      plannedStartAt: SLOT, plannedEndAt: null, status: 'CREATED',
    });
    // No staged times + no fulfillment: exactly the trip shape the route
    // routes to the legacy fallback.
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckB.id, driverId: driverY,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => reassignTrip(target.id, { carrierType: 'OWN', truckId: truckB.id, driverId: driverX }),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the fallback driver warn, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', 'warn-once family payload on the fallback path');
        assert.match(String(e.message), /Tài xế đã có .* chuyến khác trùng khung giờ/, 'the driver warn copy');
        return true;
      },
    );

    const reassigned = await reassignTrip(target.id, {
      carrierType: 'OWN', truckId: truckB.id, driverId: driverX, confirmOverlap: true,
    });
    assert.equal(reassigned.driverId, driverX, 'the confirmed retry really moved the driver');
  });

  test('a legacy completed trip without timestamps cannot prove a driver overlap and stays silent', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const truckA = await makeTruck();
    const truckB = await makeTruck();
    const driverX = await makeDriver();
    const driverY = await makeDriver();
    // Completed + no staged start: the review harmonization — the completed
    // tier requires a provable window, same as the completed-plate scan.
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckA.id, driverId: driverX,
      plannedStartAt: null, plannedEndAt: null, status: 'COMPLETED',
    });
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckB.id, driverId: driverY,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });

    const saved = await updateTripFigures(target.id, figuresPayload(truckB.id, target.version, {
      userId: a.userId, userRole: a.userRole, driverId: driverX,
    }));
    assert.ok(saved, 'a completed date-only holder proves nothing — no warn');
  });
});

// Card 171026121100 (FB-038/072 verify-fail 3): the completed tier required a
// staged plannedStartAt, so a COMPLETED trip that only carried its departure
// day (staging: 15H-061.14 · BLCUSa24BB · 01/10/2026) was invisible — both
// the trip edit and the "Phân xe lại" fallback saved the same-day rig
// double-booking silently. The RIG claim now measures the displayed day like
// every other holder (12fcf20d law); the DRIVER harmonization above is
// untouched (a date-only finished row still proves no driver occupancy).
describe('a completed date-only trip claims its displayed day on the RIG (card 171026121100)', () => {
  test('the trip edit warns once when the rig already ran a completed trip that day, and the confirmed retry proceeds', async () => {
    const a = await actor();
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const shared = await makeTruck();
    const other = await makeTruck();
    // Holder: COMPLETED, no staged timestamps — only its departure day.
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: shared.id,
      plannedStartAt: null, plannedEndAt: null, status: 'COMPLETED',
    });
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: other.id,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => updateTripFigures(target.id, figuresPayload(shared.id, target.version, { userId: a.userId, userRole: a.userRole })),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the completed warn, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', 'warn-once family payload');
        assert.match(String(e.message), /Vẫn lưu/, 'warn copy must invite the confirm');
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

  test('the "Phân xe lại" fallback warns on the same-day completed rig and the confirmed retry proceeds (staging repro)', async () => {
    const customerId = await makeCustomer();
    const routeId = await makeRoute();
    const truckA = await makeTruck();
    const truckB = await makeTruck();
    const driverY = await makeDriver();
    // The completed holder: date-only, riding truckA (the 15H-061.14 shape).
    await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckA.id,
      plannedStartAt: null, plannedEndAt: null, status: 'COMPLETED',
    });
    // No staged times + no fulfillment: exactly the trip shape the reassign
    // route sends to the legacy fallback.
    const target = await insertTrip({
      customerId, routeId, departureDate: '2026-10-12', truckId: truckB.id, driverId: driverY,
      plannedStartAt: null, plannedEndAt: null, status: 'CREATED',
    });

    await assert.rejects(
      () => reassignTrip(target.id, { carrierType: 'OWN', truckId: truckA.id, driverId: driverY }),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the fallback rig warn, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED', 'warn-once family payload on the fallback path');
        assert.match(String(e.message), /Vẫn lưu/, 'warn copy must invite the confirm');
        return true;
      },
    );

    const reassigned = await reassignTrip(target.id, {
      carrierType: 'OWN', truckId: truckA.id, driverId: driverY, confirmOverlap: true,
    });
    assert.equal(reassigned.truckId, truckA.id, 'the confirmed retry really moved the tractor');
  });
});

after(async () => {
  // Test rows carry unique suffixes; remove only this run's fixtures.
  if (tripIds.length) await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (truckIds.length) await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
  if (driverIds.length) await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  await client.end();
  await disconnectRedis();
});
