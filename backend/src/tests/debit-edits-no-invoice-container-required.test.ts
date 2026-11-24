// SIL-910 r2 — KB §5.4.2 (V17), audit 24/11 mục 5.7: QA bypassed f3271b2d
// through PUT /shipments/:id/debit-edits — the Chốt-giá-bán drawer's
// addOtherFees persisted a 'Phí không hóa đơn' tripExpenses row for a trip
// whose lot scope carries NO container number (R3N-T10-40, 21:50 24/11 on
// staging df7b2a73). The gate now lives inside saveDebitEdits' create
// transaction: a fee-add whose trip has no lot-sourced container number
// refuses 400 and persists NOTHING (the old failure was the surviving row on
// a fresh server fetch). Fixture shape mirrors
// ops-no-invoice-container-required.test.ts (real dev DB, tracked cleanup).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
import { saveDebitEdits } from '../services/shipment-debit-detail.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DEPARTURE = '2026-11-24';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

/** Lot + fulfillment + one active trip, like the R3N-T10-40 repro: the lot's
 * container row exists with NO number (SỐ CONT '—'). Returns the trip and a
 * helper linking it to lot containers via the snapshot shape
 * (sourceShipmentId + containerNumber copied from shipmentContainers). */
async function mkLotTrip() {
  const [user] = await db.insert(s.users).values({
    username: `s910r2-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.CUS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `S910r2 customer ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: 'S910r2 route' }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: DEPARTURE,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: null, // the repro's '—'
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    customerId: customer.id, routeId: route.id, shipmentId: shipment.id, fulfillmentId: fulfillment.id, departureDate: DEPARTURE,
  }).returning({ id: s.trips.id });
  track(s.trips, trip.id);
  const linkTripContainer = async (opts: { tripId?: number; containerNumber: string | null; containerId?: number }) => {
    const [link] = await db.insert(s.tripContainers).values({
      tripId: opts.tripId ?? trip.id,
      sourceShipmentId: shipment.id,
      sourceShipmentContainerId: opts.containerId ?? null,
      sourceShipmentVersion: 1,
      containerNumber: opts.containerNumber,
    }).returning({ id: s.tripContainers.id });
    track(s.tripContainers, link.id);
    return link.id;
  };
  /** A second active trip on the SAME lot (mixed-batch atomicity case). */
  const addTrip = async () => {
    const [nextFulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id, fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
    }).returning({ id: s.shipmentFulfillments.id });
    track(s.shipmentFulfillments, nextFulfillment.id);
    const [nextTrip] = await db.insert(s.trips).values({
      customerId: customer.id, routeId: route.id, shipmentId: shipment.id, fulfillmentId: nextFulfillment.id, departureDate: DEPARTURE,
    }).returning({ id: s.trips.id });
    track(s.trips, nextTrip.id);
    return { tripId: nextTrip.id };
  };
  return { userId: user.id, shipmentId: shipment.id, containerId: container.id, tripId: trip.id, linkTripContainer, addTrip };
}

async function expenseCount(tripId: number) {
  const rows = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
    .where(and(eq(s.tripExpenses.tripId, tripId), eq(s.tripExpenses.expenseType, 'OTHER')));
  return rows.length;
}

async function assertRefused(promise: Promise<unknown>) {
  await assert.rejects(
    promise,
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Phí không hóa đơn bắt buộc chọn số container/);
      return true;
    },
  );
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-910 r2 — debit-edits chặn Phí không hóa đơn khi chuyến không có số container', () => {
  test('the QA bypass: numberless-lot trip (snapshot link, null number) refuses 400 and persists nothing', async () => {
    const fx = await mkLotTrip();
    await fx.linkTripContainer({ containerId: fx.containerId, containerNumber: null });
    await assertRefused(saveDebitEdits({
      shipmentId: fx.shipmentId,
      actorId: fx.userId,
      idempotencyKey: `s910r2-${suffix}-bypass`,
      payload: { addOtherFees: [{ tripId: fx.tripId, name: 'Phí không hóa đơn', amount: 10000 }] },
    }));
    // The old failure: the fee survived a fresh server fetch. Nothing may land.
    assert.equal(await expenseCount(fx.tripId), 0);
  });

  test('a trip with NO lot-sourced container link refuses the same way', async () => {
    const fx = await mkLotTrip();
    await assertRefused(saveDebitEdits({
      shipmentId: fx.shipmentId,
      actorId: fx.userId,
      idempotencyKey: `s910r2-${suffix}-orphan`,
      payload: { addOtherFees: [{ tripId: fx.tripId, name: 'Phí không hóa đơn', amount: 10000 }] },
    }));
    assert.equal(await expenseCount(fx.tripId), 0);
  });

  test('a blank (whitespace-only) container number is not a number — refuses', async () => {
    const fx = await mkLotTrip();
    await fx.linkTripContainer({ containerId: fx.containerId, containerNumber: '   ' });
    await assertRefused(saveDebitEdits({
      shipmentId: fx.shipmentId,
      actorId: fx.userId,
      idempotencyKey: `s910r2-${suffix}-blank`,
      payload: { addOtherFees: [{ tripId: fx.tripId, name: 'Phí khác', amount: 5000 }] },
    }));
    assert.equal(await expenseCount(fx.tripId), 0);
  });

  test('mixed batch (one scoped trip + one numberless trip) refuses atomically — no row lands on the valid trip either', async () => {
    const fx = await mkLotTrip();
    const [numbered] = await db.insert(s.shipmentContainers).values({
      shipmentId: fx.shipmentId, containerNumber: `S92U30543${cleanup.length % 10}`.slice(0, 11),
    }).returning({ id: s.shipmentContainers.id, containerNumber: s.shipmentContainers.containerNumber });
    track(s.shipmentContainers, numbered.id);
    await fx.linkTripContainer({ containerId: numbered.id, containerNumber: numbered.containerNumber });
    const bareTrip = await fx.addTrip();
    await fx.linkTripContainer({ tripId: bareTrip.tripId, containerId: fx.containerId, containerNumber: null });
    await assertRefused(saveDebitEdits({
      shipmentId: fx.shipmentId,
      actorId: fx.userId,
      idempotencyKey: `s910r2-${suffix}-mixed`,
      payload: { addOtherFees: [
        { tripId: fx.tripId, name: 'Phí rửa container', amount: 20000 },
        { tripId: bareTrip.tripId, name: 'Phí không hóa đơn', amount: 10000 },
      ] },
    }));
    assert.equal(await expenseCount(fx.tripId), 0);
    assert.equal(await expenseCount(bareTrip.tripId), 0);
  });

  test('a trip whose lot scope names a container still saves the fee (legit path)', async () => {
    const fx = await mkLotTrip();
    const [numbered] = await db.insert(s.shipmentContainers).values({
      shipmentId: fx.shipmentId, containerNumber: `S93U30543${cleanup.length % 10}`.slice(0, 11),
    }).returning({ id: s.shipmentContainers.id, containerNumber: s.shipmentContainers.containerNumber });
    track(s.shipmentContainers, numbered.id);
    await fx.linkTripContainer({ containerId: numbered.id, containerNumber: numbered.containerNumber });
    await saveDebitEdits({
      shipmentId: fx.shipmentId,
      actorId: fx.userId,
      idempotencyKey: `s910r2-${suffix}-legit`,
      payload: { addOtherFees: [{ tripId: fx.tripId, name: 'Phí không hóa đơn', amount: 80000, sellAmount: 450000 }] },
    });
    const [row] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.tripId, fx.tripId));
    track(s.tripExpenses, row.id);
    assert.equal(row.expenseType, 'OTHER');
    assert.equal(row.feeName, 'Phí không hóa đơn');
    assert.equal(row.buyAmount, '80000');
    assert.equal(row.sellAmount, '450000');
  });
});
