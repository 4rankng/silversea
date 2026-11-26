// SIL-1032 — KB §4.1.6 K4.27, QA 25/11 (xe 15H-104.03, lot TCLU9000144):
// a plan save for 11:00 onto a plate whose same-day holder ran 08:00–10:00
// landed SILENTLY. Root cause: planned_start_at is a NAIVE column storing
// UTC, and the guard's trip-side `(planned_start_at at time zone
// 'Asia/Ho_Chi_Minh')::date` read the UTC walls as VN walls — every morning
// trip (VN 07:00–13:59) dated to YESTERDAY, so both the IN_TRANSIT busy tier
// and the Trùng YẾU weak tier missed it. Fix: the repo's double conversion
// (`at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh'`) on the trip side,
// both scans, both guards (plan save + issue path).
//
// Real-DB pin through the atomic plan save (updateDispatchDetailPlanInTx —
// the exact Phân xe write path, guard + window resolution + visibility law
// included):
//  1. IN_TRANSIT holder 08:00–10:00, save 11:00 same day → warn-once 409
//     RIG_OVERLAP_COMPLETED 'Vẫn lưu?' (was: silent write);
//  2. CREATED holder 08:00–10:00, save 11:00 same day → the Trùng YẾU weak
//     copy (không trùng giờ chạy. Vẫn lưu?);
//  3. same-hours overlap keeps the proven-overlap refusal until the
//     dispatcher confirms (rigOverlapCompletedConfirmed retry proceeds);
//  4. holder on ANOTHER day → no warning, save proceeds.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role, TripStatus } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
import { updateDispatchDetailPlanInTx } from '../services/dispatch-planning-detail-plan.service';

const DAY = '2026-11-26';
const NEXT_DAY = '2026-11-27';
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** VN wall time → the UTC instant a naive UTC column stores for it. */
const vnInstant = (day: string, hhmm: string): Date => new Date(`${day}T${hhmm}:00+07:00`);

const tracked: {
  trips: number[];
  fulfillments: number[];
  containers: number[];
  shipments: number[];
  trucks: number[];
  routes: number[];
  customers: number[];
  users: number[];
} = {
  trips: [], fulfillments: [], containers: [], shipments: [],
  trucks: [], routes: [], customers: [], users: [],
};

after(async () => {
  if (tracked.trips.length) await db.delete(s.trips).where(inArray(s.trips.id, tracked.trips));
  if (tracked.fulfillments.length) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, tracked.fulfillments));
  if (tracked.containers.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, tracked.containers));
  if (tracked.shipments.length) await db.delete(s.shipments).where(inArray(s.shipments.id, tracked.shipments));
  if (tracked.trucks.length) await db.delete(s.trucks).where(inArray(s.trucks.id, tracked.trucks));
  if (tracked.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, tracked.routes));
  if (tracked.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, tracked.customers));
  if (tracked.users.length) await db.delete(s.users).where(inArray(s.users.id, tracked.users));
  await disconnectRedis();
});

interface CaseShape {
  holderStatus: TripStatus.CREATED | TripStatus.IN_TRANSIT;
  holderDay: string;
  /** VN wall time of the saving row's container appointment. */
  saveFrom: string;
  saveTo: string;
}

/** One plate-isolated repro: a holder trip (08:00–10:00 VN on holderDay) on
 *  its own tractor, plus the saving lot's row whose appointment is saveFrom. */
async function buildCase(shape: CaseShape) {
  const [user] = await db.insert(s.users).values({
    username: `s1032-${suffix}-${tracked.users.length}`, passwordHash: 't', role: Role.DISPATCHER, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  tracked.users.push(user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `S1032 customer ${suffix}-${tracked.customers.length}`,
  }).returning({ id: s.customers.id });
  tracked.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `S1032 route ${suffix}-${tracked.routes.length}` }).returning({ id: s.routes.id });
  tracked.routes.push(route.id);
  const plate = `S32-${suffix}${tracked.trucks.length}`.slice(0, 20);
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plate }).returning({ id: s.trucks.id });
  tracked.trucks.push(truck.id);

  // The holder lot + its issued trip on that tractor.
  const [holderLot] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: shape.holderDay,
  }).returning({ id: s.shipments.id });
  tracked.shipments.push(holderLot.id);
  const [holderFulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: holderLot.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  tracked.fulfillments.push(holderFulfillment.id);
  const [holderTrip] = await db.insert(s.trips).values({
    customerId: customer.id, routeId: route.id, shipmentId: holderLot.id, fulfillmentId: holderFulfillment.id,
    truckId: truck.id, tripCode: `S32-${suffix}H${tracked.trips.length}`.slice(0, 40),
    departureDate: shape.holderDay, status: shape.holderStatus,
    plannedStartAt: vnInstant(shape.holderDay, '08:00'), plannedEndAt: vnInstant(shape.holderDay, '10:00'),
  }).returning({ id: s.trips.id });
  tracked.trips.push(holderTrip.id);

  // The saving row: 11:00 VN appointment (strong window), plain ĐƠN row.
  const [savingLot] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'READY_FOR_DISPATCH', expectedDeliveryDate: DAY,
  }).returning({ id: s.shipments.id });
  tracked.shipments.push(savingLot.id);
  const [savingContainer] = await db.insert(s.shipmentContainers).values({
    shipmentId: savingLot.id, customerAppointmentAt: vnInstant(DAY, shape.saveFrom),
  }).returning({ id: s.shipmentContainers.id });
  tracked.containers.push(savingContainer.id);
  const [savingFulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: savingLot.id, shipmentContainerId: savingContainer.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  tracked.fulfillments.push(savingFulfillment.id);

  const input = {
    fulfillmentId: savingFulfillment.id,
    expectedFulfillmentVersion: 1,
    expectedShipmentVersion: 1,
    idempotencyKey: `s1032-${suffix}-${savingFulfillment.id}`,
    carrierType: 'OWN' as const,
    truckId: truck.id,
    plannedRevenue: null,
    plannedCarrierCost: null,
    plannedEndAt: `${DAY}T${shape.saveTo}:00+07:00`,
    actor: {
      userId: user.id, username: `s1032-${suffix}`, email: null, fullName: 'SIL-1032', role: Role.DISPATCHER as const,
    },
  };
  return { plate, truckId: truck.id, savingFulfillmentId: savingFulfillment.id, input };
}

type SaveInput = Parameters<typeof updateDispatchDetailPlanInTx>[1];

const saveInTx = (input: SaveInput, confirm = false) =>
  db.transaction(async (tx) => updateDispatchDetailPlanInTx(tx, confirm ? { ...input, rigOverlapCompletedConfirmed: true } : input));

describe('SIL-1032 — same-day non-overlapping plan save warns once (real DB)', () => {
  test('IN_TRANSIT holder 08:00–10:00 + save 11:00 same day → warn-once 409, never silent', async () => {
    const { input } = await buildCase({ holderStatus: TripStatus.IN_TRANSIT, holderDay: DAY, saveFrom: '11:00', saveTo: '15:00' });
    await assert.rejects(
      saveInTx(input),
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
        assert.equal(err.statusCode, 409);
        assert.equal((err.payload as { code?: string } | undefined)?.code, 'RIG_OVERLAP_COMPLETED');
        assert.match(err.message, /Vẫn lưu\?$/);
        assert.ok(!err.message.includes('không trùng giờ chạy'), 'the busy-rig tier, not the weak tier, owns an IN_TRANSIT holder');
        return true;
      },
    );
  });

  test('CREATED holder 08:00–10:00 + save 11:00 same day → Trùng YẾU weak copy', async () => {
    const { input } = await buildCase({ holderStatus: TripStatus.CREATED, holderDay: DAY, saveFrom: '11:00', saveTo: '15:00' });
    await assert.rejects(
      saveInTx(input),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal((err.payload as { code?: string } | undefined)?.code, 'RIG_OVERLAP_COMPLETED');
        assert.match(err.message, /\(không trùng giờ chạy\)\. Vẫn lưu\?$/);
        return true;
      },
    );
  });

  test('same-hours overlap keeps the proven-overlap refusal; the confirmed retry proceeds', async () => {
    const { plate, savingFulfillmentId, input } = await buildCase({
      holderStatus: TripStatus.IN_TRANSIT, holderDay: DAY, saveFrom: '08:30', saveTo: '12:00',
    });
    // 08:30 window overlaps the 08:00–10:00 holder → refuses before confirm…
    await assert.rejects(
      saveInTx(input),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 409);
        assert.equal((err.payload as { code?: string } | undefined)?.code, 'RIG_OVERLAP_COMPLETED');
        assert.match(err.message, /Vẫn lưu\?$/);
        assert.ok(!err.message.includes('không trùng giờ chạy'), 'a proven overlap is not the weak tier');
        return true;
      },
    );
    // …and the dispatcher's confirmed retry proceeds (the warn-once contract).
    const result = await saveInTx(input, true);
    assert.equal(result.fulfillmentId, savingFulfillmentId);
    const [row] = await db.select({ plate: s.shipmentFulfillments.plannedVehiclePlateNumber })
      .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, savingFulfillmentId));
    assert.equal(row?.plate, plate, 'the confirmed save landed the plate');
  });

  test('holder on ANOTHER day → no warning, save proceeds', async () => {
    const { plate, savingFulfillmentId, input } = await buildCase({
      holderStatus: TripStatus.IN_TRANSIT, holderDay: NEXT_DAY, saveFrom: '11:00', saveTo: '15:00',
    });
    await saveInTx(input);
    const [row] = await db.select({ plate: s.shipmentFulfillments.plannedVehiclePlateNumber })
      .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, savingFulfillmentId));
    assert.equal(row?.plate, plate, 'an other-day holder never blocks the save');
  });
});
