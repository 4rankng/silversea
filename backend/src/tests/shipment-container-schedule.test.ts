import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { batchUpsertShipmentContainers, createShipment } from '../services/shipment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const customerIds: number[] = [];
const containerTypeIds: number[] = [];
const routeIds: number[] = [];

async function makeRoute() {
  const [route] = await db.insert(s.routes)
    .values({ name: `Container route ${suffix}`, shortName: `Route ${suffix}` })
    .returning({ id: s.routes.id });
  routeIds.push(route.id);
  return route;
}

describe('shipment container schedule', () => {
  test('a scheduled container with no number makes the shipment dispatch-ready and creates a handoff', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `Container schedule customer ${suffix}` })
      .returning();
    customerIds.push(customer.id);
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CS${Math.random().toString(16).slice(2, 10)}`, name: `Container schedule ${suffix}` })
      .returning();
    containerTypeIds.push(containerType.id);
    const route = await makeRoute();

    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);
    assert.equal(shipment.status, 'PENDING_DATE');

    await batchUpsertShipmentContainers(shipment.id, null, [{
      containerTypeId: containerType.id,
      containerNumber: null,
      routeId: route.id,
      customerAppointmentAt: '2026-08-20T12:00:00.000Z',
    }]);

    const [savedShipment] = await db.select({ status: s.shipments.status })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id));
    const [savedContainer] = await db.select({
      containerNumber: s.shipmentContainers.containerNumber,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipment.id));
    const [handoff] = await db.select({ status: s.dispatchHandoffs.status })
      .from(s.dispatchHandoffs)
      .where(and(eq(s.dispatchHandoffs.shipmentId, shipment.id), eq(s.dispatchHandoffs.status, 'UNSEEN')));

    assert.equal(savedShipment.status, 'READY_FOR_DISPATCH');
    assert.equal(savedContainer.containerNumber, null);
    assert.equal(savedContainer.customerAppointmentAt?.toISOString(), '2026-08-20T12:00:00.000Z');
    assert.equal(handoff.status, 'UNSEEN');
  });

  test('a container appointment replaces the legacy lot date with the earliest container date', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `Container schedule explicit ${suffix}` })
      .returning();
    customerIds.push(customer.id);
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CS${Math.random().toString(16).slice(2, 10)}`, name: `Explicit ${suffix}` })
      .returning();
    containerTypeIds.push(containerType.id);
    const route = await makeRoute();

    const shipment = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-09-01',
    });
    shipmentIds.push(shipment.id);

    await batchUpsertShipmentContainers(shipment.id, null, [{
      containerTypeId: containerType.id,
      containerNumber: null,
      routeId: route.id,
      customerAppointmentAt: '2026-08-20T12:00:00.000Z',
    }]);

    const [savedShipment] = await db.select({ expectedDeliveryDate: s.shipments.expectedDeliveryDate })
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id));
    assert.equal(savedShipment.expectedDeliveryDate, '2026-08-20');
  });

  test('a second reconcile does not duplicate the handoff or status history', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `Container schedule idem ${suffix}` })
      .returning();
    customerIds.push(customer.id);
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CS${Math.random().toString(16).slice(2, 10)}`, name: `Idem ${suffix}` })
      .returning();
    containerTypeIds.push(containerType.id);
    const route = await makeRoute();

    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    const row = {
      containerTypeId: containerType.id,
      containerNumber: null,
      routeId: route.id,
      customerAppointmentAt: '2026-08-20T12:00:00.000Z',
    };
    await batchUpsertShipmentContainers(shipment.id, null, [row]);
    await batchUpsertShipmentContainers(shipment.id, null, [row]);

    const handoffs = await db.select({ id: s.dispatchHandoffs.id })
      .from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    const readyHistory = await db.select({ id: s.shipmentStatusHistory.id })
      .from(s.shipmentStatusHistory)
      .where(and(eq(s.shipmentStatusHistory.shipmentId, shipment.id), eq(s.shipmentStatusHistory.toStatus, 'READY_FOR_DISPATCH')));
    assert.equal(handoffs.length, 1);
    assert.equal(readyHistory.length, 1);
  });

  test('does not allow the last FCL appointment to be removed after readiness', async () => {
    const [customer] = await db.insert(s.customers)
      .values({ name: `Container schedule guard ${suffix}` })
      .returning();
    customerIds.push(customer.id);
    const [containerType] = await db.insert(s.containerTypes)
      .values({ code: `CS${Math.random().toString(16).slice(2, 10)}`, name: `Guard ${suffix}` })
      .returning();
    containerTypeIds.push(containerType.id);
    const route = await makeRoute();

    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);
    const scheduled = [{
      containerTypeId: containerType.id,
      containerNumber: null,
      routeId: route.id,
      customerAppointmentAt: '2026-08-20T12:00:00.000Z',
    }];
    await batchUpsertShipmentContainers(shipment.id, null, scheduled);

    await assert.rejects(
      batchUpsertShipmentContainers(shipment.id, null, []),
      /Không thể xóa lịch hẹn cuối cùng/,
    );
    const [savedShipment] = await db.select({
      status: s.shipments.status,
      expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    }).from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const savedContainers = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipment.id));
    assert.equal(savedShipment.status, 'READY_FOR_DISPATCH');
    assert.equal(savedShipment.expectedDeliveryDate, '2026-08-20');
    assert.equal(savedContainers.length, 1);
  });
});

after(async () => {
  if (shipmentIds.length > 0) {
    await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, shipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
    await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  }
  if (containerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  await client.end();
});
