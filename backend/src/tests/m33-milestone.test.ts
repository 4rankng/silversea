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
import {
  createShipment,
  transitionShipmentStatus,
} from '../services/shipment.service';
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
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

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
  const [route] = await db.insert(s.routes).values({ name: `M33 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M33 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargo.id);
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
    if (createdShipmentIds.length > 0) {
      await db.delete(s.customerVisibleEvents).where(inArray(s.customerVisibleEvents.shipmentId, createdShipmentIds));
    }
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
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
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

  test('does nothing for a transition to a non-milestone status (CANCELED)', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const trip = await mkTrip();

    // O2C: the former LOCKED hop (which mapped to no milestone) is gone.
    // CANCELED is now the only status that maps to no milestone; deriving for
    // it must create nothing.
    await deriveMilestoneFromTripStatus(shipment.id, trip.id, TripStatus.IN_TRANSIT, TripStatus.CANCELED, 1);

    const milestones = await listMilestones(shipment.id);
    assert.equal(milestones.length, 0);
  });

  test('keeps per-trip IN_TRANSIT milestones but creates one shipment-scoped portal event', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const tripA = await mkTrip();
    const tripB = await mkTrip();

    await deriveMilestoneFromTripStatus(shipment.id, tripA.id, TripStatus.CREATED, TripStatus.IN_TRANSIT, 1);
    await deriveMilestoneFromTripStatus(shipment.id, tripB.id, TripStatus.CREATED, TripStatus.IN_TRANSIT, 1);

    const milestones = await listMilestones(shipment.id);
    assert.equal(milestones.filter((milestone) => milestone.type === 'IN_TRANSIT').length, 2);

    const beforeTransition = await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id));
    assert.equal(beforeTransition.length, 0);

    await transitionShipmentStatus(shipment.id, 'DISPATCHED', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT', { changedBy: 1 });

    const afterTransition = await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id));
    assert.equal(afterTransition.length, 1);
    assert.equal(afterTransition[0]?.contentSnapshot.title, 'Đang vận chuyển');
  });

  test('creates one shipment-scoped booking-received portal event across multiple trip creations', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const tripA = await mkTrip();
    const tripB = await mkTrip();

    await deriveMilestoneFromTripStatus(shipment.id, tripA.id, null, TripStatus.CREATED, 1);
    await deriveMilestoneFromTripStatus(shipment.id, tripB.id, null, TripStatus.CREATED, 1);

    const bookingEvents = (await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id)))
      .filter((event) => event.contentSnapshot.title === 'Đã tiếp nhận booking');
    assert.equal(bookingEvents.length, 1);
    assert.equal(bookingEvents[0]?.eventKey, `shipment:${shipment.id}:booking-received`);
  });

  test('re-entering IN_TRANSIT after a dispatch regression writes a second customer-visible event', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);

    await transitionShipmentStatus(shipment.id, 'DISPATCHED', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'DISPATCHED', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT', { changedBy: 1 });

    const inTransitEvents = (await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id)))
      .filter((event) => event.contentSnapshot.title === 'Đang vận chuyển');
    assert.equal(inTransitEvents.length, 2);
    assert.notEqual(inTransitEvents[0]?.eventKey, inTransitEvents[1]?.eventKey);
  });

  test('does not emit delivered portal event on first completed trip; shipment COMPLETED emits exactly one', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);
    const tripA = await mkTrip();
    const tripB = await mkTrip();

    await transitionShipmentStatus(shipment.id, 'DISPATCHED', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT', { changedBy: 1 });

    await deriveMilestoneFromTripStatus(shipment.id, tripA.id, TripStatus.IN_TRANSIT, TripStatus.COMPLETED, 1);

    const afterFirstTrip = await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id));
    assert.equal(afterFirstTrip.filter((event) => event.contentSnapshot.title === 'Đã giao hàng').length, 0);

    await deriveMilestoneFromTripStatus(shipment.id, tripB.id, TripStatus.IN_TRANSIT, TripStatus.COMPLETED, 1);
    await transitionShipmentStatus(shipment.id, 'PENDING_EXPENSE_APPROVAL', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'COMPLETED', { changedBy: 1 });
    await transitionShipmentStatus(shipment.id, 'COMPLETED', { changedBy: 1 });

    const deliveredMilestones = (await listMilestones(shipment.id))
      .filter((milestone) => milestone.type === 'DELIVERED');
    assert.equal(deliveredMilestones.length, 2);

    const deliveredEvents = (await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id)))
      .filter((event) => event.contentSnapshot.title === 'Đã giao hàng');
    assert.equal(deliveredEvents.length, 1);
    assert.equal(deliveredEvents[0]?.contentSnapshot.title, 'Đã giao hàng');
  });

  test('does not fabricate a customer-visible event creator when shipment transition has no actor', async () => {
    const customer = await mkCustomer();
    const shipment = await mkShipment(customer.id);

    await transitionShipmentStatus(shipment.id, 'DISPATCHED');
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT');

    const portalEvents = await db.select().from(s.customerVisibleEvents)
      .where(eq(s.customerVisibleEvents.shipmentId, shipment.id));
    assert.equal(portalEvents.length, 0);
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
