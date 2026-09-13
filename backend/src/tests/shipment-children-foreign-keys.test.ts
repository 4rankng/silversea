import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { after, test } from 'node:test';
import { db } from '../db';
import * as s from '../db/schema';

/**
 * Migration 0073 — shipment-child foreign keys. The FKs exist so a hard
 * shipment delete can never strand orphan fulfillments/containers (the
 * 2026-09-13 dev DB held 154 of them, invisible to every inner-join read),
 * and so a live trip blocks deleting the fulfillment under it.
 */
test('shipment children foreign keys: cascade cleanup and trip protection', async (t) => {
  const [customer] = await db.insert(s.customers).values({
    name: `FK customer ${Date.now()}`,
    shortName: `FK ${Date.now()}`,
    status: 'ACTIVE',
  }).returning();

  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    cargoMode: 'FCL',
    shipmentCode: `FK-${Date.now()}`,
    status: 'READY_FOR_DISPATCH',
    createdBy: 1,
  }).returning();

  const [containerType] = await db.select({ id: s.containerTypes.id })
    .from(s.containerTypes).limit(1);
  assert.ok(containerType, 'seed must provide a container type');

  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId: containerType.id,
    containerNumber: 'FKCU0000001',
    createdBy: 1,
  }).returning();

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    plannedCarrierType: 'OWN',
    createdBy: 1,
  }).returning();

  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [trip] = await db.insert(s.trips).values({
    customerId: customer.id,
    routeId: route?.id ?? null,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    status: 'CREATED',
    departureDate: '2026-09-13',
  }).returning();

  // Cleanup runs even when an assertion fails mid-test, so a RESTRICT left
  // behind by a failing assertion never wedges the rest of the file.
  t.after(async () => {
    await db.delete(s.trips).where(eq(s.trips.id, trip.id));
    await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id));
    await db.delete(s.customers).where(eq(s.customers.id, customer.id));
  });

  await t.test('a live trip RESTRICTs fulfillment deletion', async () => {
    await assert.rejects(
      () => db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)),
      (error: unknown) => {
        // postgres.js wraps the driver error: the constraint name rides the
        // cause chain, so flatten message + causes before matching.
        let chain = '';
        for (let e = error; e; e = (e as { cause?: unknown }).cause) {
          chain += `${String((e as Error).message ?? e)}\n`;
        }
        assert.ok(chain.includes('trips_fulfillment_id_fkey'), chain);
        return true;
      },
    );
  });

  await t.test('shipment hard delete cascades children once the trip is gone', async () => {
    await db.delete(s.trips).where(eq(s.trips.id, trip.id));
    await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id));

    const [leftFulfillment] = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id));
    const [leftContainer] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id));
    assert.equal(leftFulfillment, undefined, 'fulfillment must cascade with its shipment');
    assert.equal(leftContainer, undefined, 'container must cascade with its shipment');
  });
});

after(async () => {
  await db.$client.end();
});
