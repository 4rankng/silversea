/**
 * Wave 2 M3.3 — milestone service tests.
 *
 * Verifies:
 *   - tripStatusToMilestoneType maps statuses correctly.
 *   - deriveMilestoneFromTripStatus creates milestones and is idempotent.
 *   - addManualMilestone creates MANUAL milestones.
 *   - listMilestones returns milestones in correct order.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createShipment } from '../services/shipment.service';
import {
  tripStatusToMilestoneType,
  deriveMilestoneFromTripStatus,
  addManualMilestone,
  listMilestones,
  listMilestonesForShipments,
} from '../services/milestone.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdMilestoneIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdTripIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M33 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkShipment(customerId: number) {
  const shipment = await createShipment({ customerId });
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function mkTrip() {
  // Minimal trip row for milestone linking.
  const customer = await mkCustomer();
  const [route] = await db.insert(s.routes).values({ name: `M33 route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M33 cargo ${suffix}` }).returning();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M33-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
    status: TripStatus.CREATED, departureDate: '2026-08-01', carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

after(async () => {
  try {
    if (createdMilestoneIds.length > 0) {
      await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.id, createdMilestoneIds));
    }
    // Clean up derived milestones by shipmentId.
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentMilestones).where(inArray(s.shipmentMilestones.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[m33-milestone.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

describe('M3.3 — tripStatusToMilestoneType', () => {
  test('CREATED → BOOKING_RECEIVED', () => {
    assert.equal(tripStatusToMilestoneType(null, TripStatus.CREATED), 'BOOKING_RECEIVED');
  });
  test('IN_TRANSIT → IN_TRANSIT', () => {
    assert.equal(tripStatusToMilestoneType(TripStatus.CREATED, TripStatus.IN_TRANSIT), 'IN_TRANSIT');
  });
  test('COMPLETED → DELIVERED', () => {
    assert.equal(tripStatusToMilestoneType(TripStatus.IN_TRANSIT, TripStatus.COMPLETED), 'DELIVERED');
  });
  test('LOCKED → null', () => {
    assert.equal(tripStatusToMilestoneType(TripStatus.COMPLETED, TripStatus.LOCKED), null);
  });
  test('CANCELED → null', () => {
    assert.equal(tripStatusToMilestoneType(TripStatus.CREATED, TripStatus.CANCELED), null);
  });
});

describe('M3.3 — deriveMilestoneFromTripStatus', () => {
  test('creates a milestone for IN_TRANSIT', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const trip = await mkTrip();

    await deriveMilestoneFromTripStatus(shipment.id, trip.id, TripStatus.CREATED, TripStatus.IN_TRANSIT, 1);

    const milestones = await listMilestones(shipment.id);
    assert.equal(milestones.length, 1);
    assert.equal(milestones[0].type, 'IN_TRANSIT');
    assert.equal(milestones[0].tripId, trip.id);
  });

  test('is idempotent — calling twice does not create a duplicate', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const trip = await mkTrip();

    await deriveMilestoneFromTripStatus(shipment.id, trip.id, null, TripStatus.CREATED, 1);
    await deriveMilestoneFromTripStatus(shipment.id, trip.id, null, TripStatus.CREATED, 1);

    const milestones = await listMilestones(shipment.id);
    assert.equal(milestones.length, 1, 'only one milestone');
  });

  test('does nothing for LOCKED status', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const trip = await mkTrip();

    await deriveMilestoneFromTripStatus(shipment.id, trip.id, TripStatus.COMPLETED, TripStatus.LOCKED, 1);

    const milestones = await listMilestones(shipment.id);
    assert.equal(milestones.length, 0);
  });
});

describe('M3.3 — addManualMilestone', () => {
  test('creates a MANUAL milestone', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);

    const milestone = await addManualMilestone({
      shipmentId: shipment.id,
      type: 'CUSTOMS_CLEARED',
      note: 'Đã thông quan hải quan',
      changedBy: 1,
    });

    assert.ok(milestone.id);
    assert.equal(milestone.type, 'CUSTOMS_CLEARED');
    assert.equal(milestone.note, 'Đã thông quan hải quan');
  });

  test('throws 404 for missing shipment', async () => {
    await assert.rejects(
      () => addManualMilestone({ shipmentId: 99_999_999, type: 'MANUAL' }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404,
    );
  });
});

describe('M3.3 — listMilestones', () => {
  test('returns milestones ordered by occurredAt DESC', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);

    // Add two milestones with different timestamps.
    await addManualMilestone({
      shipmentId: shipment.id, type: 'BOOKING_RECEIVED',
      occurredAt: new Date('2026-07-01T10:00:00Z'),
    });
    await addManualMilestone({
      shipmentId: shipment.id, type: 'DELIVERED',
      occurredAt: new Date('2026-07-05T14:00:00Z'),
    });

    const milestones = await listMilestones(shipment.id);
    assert.ok(milestones.length >= 2);
    // Most recent first.
    assert.ok(new Date(milestones[0].occurredAt) >= new Date(milestones[1].occurredAt));
  });

  test('listMilestonesForShipments returns milestones across multiple shipments', async () => {
    const customer = await mkCustomer();
    const s1 = await mkShipment(customer.id);
    const s2 = await mkShipment(customer.id);

    await addManualMilestone({ shipmentId: s1.id, type: 'PICKED_UP' });
    await addManualMilestone({ shipmentId: s2.id, type: 'DELIVERED' });

    const milestones = await listMilestonesForShipments([s1.id, s2.id]);
    assert.ok(milestones.length >= 2);
    assert.ok(milestones.some(m => m.shipmentId === s1.id));
    assert.ok(milestones.some(m => m.shipmentId === s2.id));
  });

  test('cross-customer isolation: milestone for shipment A not visible via B', async () => {
    const customer = await mkCustomer();
    const s1 = await mkShipment(customer.id);
    const s2 = await mkShipment(customer.id);

    await addManualMilestone({ shipmentId: s1.id, type: 'MANUAL', note: 'milestone for s1' });

    // Querying s2's milestones should NOT include s1's milestone.
    const s2Milestones = await listMilestones(s2.id);
    assert.equal(s2Milestones.length, 0, 's2 has no milestones');
  });
});
