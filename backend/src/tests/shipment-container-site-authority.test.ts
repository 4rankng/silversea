import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { batchUpsertShipmentContainers, createShipment } from '../services/shipment.service';
import { reconcileShipmentContainersInTx } from '../services/shipment-containers.service';
import { runInTx } from '../lib/tx';
import { classifyClerkContainerChange } from '../services/shipment-edit-boundary.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const shipmentIds: number[] = [];
const siteIds: number[] = [];
const customerIds: number[] = [];
const containerTypeIds: number[] = [];
const fulfillmentIds: number[] = [];
const routeIds: number[] = [];

async function makeCustomer(name: string) {
  const [row] = await db.insert(s.customers)
    .values({ name: `${name} ${suffix}` })
    .returning({ id: s.customers.id });
  customerIds.push(row.id);
  return row;
}

async function makeFactorySite(customerId: number, code: string, routeId?: number) {
  const [row] = await db.insert(s.operationalSites)
    .values({
      customerId,
      code,
      name: `Nhà máy ${code} ${suffix}`,
      siteType: 'FACTORY',
      routeId,
      address: `Địa chỉ ${code} ${suffix}`,
      isActive: true,
    })
    .returning({ id: s.operationalSites.id });
  siteIds.push(row.id);
  return row;
}

async function makeContainerType(code: string) {
  const [row] = await db.insert(s.containerTypes)
    .values({ code: `${code}${Math.random().toString(16).slice(2, 8)}`, name: `Type ${code} ${suffix}` })
    .returning({ id: s.containerTypes.id });
  containerTypeIds.push(row.id);
  return row;
}

async function makeRoute(code: string) {
  const [row] = await db.insert(s.routes)
    .values({ name: `Tuyến ${code} ${suffix}`, shortName: `Tuyến ${code}` })
    .returning({ id: s.routes.id });
  routeIds.push(row.id);
  return row;
}

describe('shipment container site authority (SILVER L1 P2)', () => {
  test('persists per-container factory authority through the batch upsert', async () => {
    const customer = await makeCustomer('Site authority');
    const route = await makeRoute('SITE-A');
    const factory = await makeFactorySite(customer.id, 'SITE-A', route.id);
    const containerType = await makeContainerType('SA');
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    await batchUpsertShipmentContainers(shipment.id, null, [
      {
        containerTypeId: containerType.id,
        containerNumber: 'AAAU1000001',
        operationalSiteId: factory.id,
        customerAppointmentAt: '2026-08-24T04:00:00.000Z',
      },
      {
        containerTypeId: containerType.id,
        containerNumber: 'BBHU2001007',
        operationalSiteId: null,
      },
    ]);

    const rows = await db.select({
      containerNumber: s.shipmentContainers.containerNumber,
      operationalSiteId: s.shipmentContainers.operationalSiteId,
      routeId: s.shipmentContainers.routeId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipment.id));
    const byNumber = new Map(rows.map((row) => [row.containerNumber, row]));
    assert.equal(byNumber.get('AAAU1000001')?.operationalSiteId, factory.id);
    assert.equal(byNumber.get('AAAU1000001')?.routeId, null, 'factory selection must not derive a route');
    assert.equal(byNumber.get('AAAU1000001')?.customerAppointmentAt?.toISOString(), '2026-08-24T04:00:00.000Z');
    assert.equal(byNumber.get('BBHU2001007')?.operationalSiteId, null);
  });

  test('persists distinct FCL routes and appointments on their own containers', async () => {
    const customer = await makeCustomer('Route authority');
    const containerType = await makeContainerType('RA');
    const routeA = await makeRoute('RA-A');
    const routeB = await makeRoute('RA-B');
    const factoryA = await makeFactorySite(customer.id, 'RA-A', routeA.id);
    const factoryB = await makeFactorySite(customer.id, 'RA-B', routeB.id);
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL', routeId: null });
    shipmentIds.push(shipment.id);

    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId: containerType.id, containerNumber: 'AAAU1000001', operationalSiteId: factoryA.id, routeId: routeA.id, customerAppointmentAt: '2026-08-24T04:00:00.000Z' },
      { containerTypeId: containerType.id, containerNumber: 'BBHU2001007', operationalSiteId: factoryB.id, routeId: routeB.id, customerAppointmentAt: '2026-08-26T07:30:00.000Z' },
    ]);

    const [savedShipment] = await db.select({ routeId: s.shipments.routeId, expectedDeliveryDate: s.shipments.expectedDeliveryDate })
      .from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const rows = await db.select({
      containerNumber: s.shipmentContainers.containerNumber,
      routeId: s.shipmentContainers.routeId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipment.id));
    const byNumber = new Map(rows.map((row) => [row.containerNumber, row]));

    assert.equal(savedShipment.routeId, null, 'FCL shipment root cannot become the route authority');
    assert.equal(savedShipment.expectedDeliveryDate, '2026-08-24', 'root date is only the earliest-container projection');
    assert.equal(byNumber.get('AAAU1000001')?.routeId, routeA.id);
    assert.equal(byNumber.get('AAAU1000001')?.customerAppointmentAt?.toISOString(), '2026-08-24T04:00:00.000Z');
    assert.equal(byNumber.get('BBHU2001007')?.routeId, routeB.id);
    assert.equal(byNumber.get('BBHU2001007')?.customerAppointmentAt?.toISOString(), '2026-08-26T07:30:00.000Z');
  });

  test('persists a route chosen independently from the container factory mapping', async () => {
    const customer = await makeCustomer('Factory route match');
    const routeA = await makeRoute('MATCH-A');
    const routeB = await makeRoute('MATCH-B');
    const factory = await makeFactorySite(customer.id, 'MATCH', routeA.id);
    const containerType = await makeContainerType('MATCH');
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    await batchUpsertShipmentContainers(shipment.id, null, [{
      containerTypeId: containerType.id,
      containerNumber: 'CCCU2002008',
      operationalSiteId: factory.id,
      routeId: routeB.id,
    }]);

    const [saved] = await db.select({
      operationalSiteId: s.shipmentContainers.operationalSiteId,
      routeId: s.shipmentContainers.routeId,
    }).from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipment.id));
    assert.equal(saved?.operationalSiteId, factory.id);
    assert.equal(saved?.routeId, routeB.id);
  });

  test('rejects an inactive route at the container reconciliation choke point', async () => {
    const customer = await makeCustomer('Inactive route');
    const route = await makeRoute('INACTIVE');
    const factory = await makeFactorySite(customer.id, 'INACTIVE');
    const containerType = await makeContainerType('INACTIVE');
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);
    await db.update(s.routes).set({ deletedAt: new Date() }).where(eq(s.routes.id, route.id));

    await assert.rejects(
      () => batchUpsertShipmentContainers(shipment.id, null, [{
        containerTypeId: containerType.id,
        containerNumber: 'DDDU3003005',
        operationalSiteId: factory.id,
        routeId: route.id,
      }]),
      /Tuyến đường của container không còn hiệu lực/,
    );
  });

  test('rejects a cross-customer factory on the reconcile choke point (IDOR)', async () => {
    const customerA = await makeCustomer('Site scope A');
    const customerB = await makeCustomer('Site scope B');
    const foreignFactory = await makeFactorySite(customerB.id, 'SITE-B');
    const containerType = await makeContainerType('SB');
    const shipment = await createShipment({ customerId: customerA.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    await assert.rejects(
      () => runInTx(undefined, async (tx) => reconcileShipmentContainersInTx(tx, shipment.id, null, [{
        id: undefined,
        containerTypeId: containerType.id,
        containerNumber: 'CCCU2002008',
        operationalSiteId: foreignFactory.id,
      }])),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /không còn hiệu lực hoặc không thuộc khách hàng/);
        return true;
      },
    );
  });

  test('rejects a WAREHOUSE site as container factory authority', async () => {
    const customer = await makeCustomer('Site type guard');
    const containerType = await makeContainerType('SW');
    const [warehouse] = await db.insert(s.operationalSites)
      .values({
        customerId: customer.id,
        code: `WH-${Math.random().toString(16).slice(2, 8)}`,
        name: `Kho ${suffix}`,
        siteType: 'WAREHOUSE',
        address: `Địa chỉ kho ${suffix}`,
        isActive: true,
      })
      .returning({ id: s.operationalSites.id });
    siteIds.push(warehouse.id);
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    await assert.rejects(
      () => runInTx(undefined, async (tx) => reconcileShipmentContainersInTx(tx, shipment.id, null, [{
        containerTypeId: containerType.id,
        containerNumber: 'DDDU3003005',
        operationalSiteId: warehouse.id,
      }])),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /không còn hiệu lực hoặc không thuộc khách hàng/);
        return true;
      },
    );
  });

  test('an appointment-only post-handoff container edit classifies REQUESTED, never NOOP', async () => {
    const customer = await makeCustomer('Edit boundary');
    const containerType = await makeContainerType('EB');
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    // createShipment starts with no containers — create the current row the
    // classifier compares against.
    await batchUpsertShipmentContainers(shipment.id, null, [{
      containerTypeId: containerType.id,
      containerNumber: 'EEEU4004002',
      customerAppointmentAt: '2026-08-24T04:00:00.000Z',
    }]);
    const [row] = await db.select().from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipment.id)).limit(1);

    const result = classifyClerkContainerChange(
      [{ ...row, operationalSiteId: row.operationalSiteId ?? null }],
      [{
        id: row.id,
        containerTypeId: row.containerTypeId,
        containerNumber: row.containerNumber,
        sealNumber: row.sealNumber,
        cargoWeightKg: row.cargoWeightKg,
        shippingLineName: row.shippingLineName,
        pickupPortId: row.pickupPortId,
        dropoffPortId: row.dropoffPortId,
        operationalSiteId: row.operationalSiteId,
        // Only the appointment moved.
        customerAppointmentAt: '2026-08-26T04:00:00.000Z',
        notes: row.notes,
      }],
    );
    assert.equal(result.mode, 'REQUESTED');
  });

  test('decomposition snapshots carry per-container factory authority; re-decompose after a site change shows the new factory', async () => {
    const customer = await makeCustomer('Snapshot refresh');
    const factoryA = await makeFactorySite(customer.id, 'SITE-RF-A');
    const factoryB = await makeFactorySite(customer.id, 'SITE-RF-B');
    const containerType = await makeContainerType('RF');
    const shipment = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    shipmentIds.push(shipment.id);

    await batchUpsertShipmentContainers(shipment.id, null, [{
      containerTypeId: containerType.id,
      containerNumber: 'FFFU5005000',
      operationalSiteId: factoryA.id,
    }]);

    // Decompose: the FCL fulfillment's snapshot must carry factory A (the
    // container's authority), not the shipment-level (null) site.
    const { ensureShipmentFulfillmentsInTx } = await import('../services/shipment-fulfillment.service');
    const first = await runInTx(undefined, (tx) => ensureShipmentFulfillmentsInTx(tx, {
      shipmentId: shipment.id,
      actorId: 1,
      allowClerkIntake: true,
    }));
    fulfillmentIds.push(...first.map((row) => row.id));
    assert.equal(first.length, 1);
    const firstDelivery = (first[0]!.siteSnapshot as { deliverySite?: { id?: number } }).deliverySite;
    assert.equal(firstDelivery?.id, factoryA.id, 'decompose snapshot must carry the container factory');

    // Guarded reconcile moves the container to factory B — pre-trip, this
    // cancels the fulfillment; the next decomposition rebuilds with B.
    const { reconcileShipmentContainersWithFulfillmentGuard } = await import('../services/shipment-containers.service');
    const [container] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, shipment.id)).limit(1);
    await runInTx(undefined, async (tx) => {
      await reconcileShipmentContainersWithFulfillmentGuard(tx, shipment.id, null, [{
        id: container.id,
        containerTypeId: containerType.id,
        containerNumber: 'FFFU5005000',
        operationalSiteId: factoryB.id,
      }]);
    });

    const second = await runInTx(undefined, (tx) => ensureShipmentFulfillmentsInTx(tx, {
      shipmentId: shipment.id,
      actorId: 1,
      allowClerkIntake: true,
    }));
    fulfillmentIds.push(...second.map((row) => row.id));
    assert.equal(second.length, 1);
    const secondDelivery = (second[0]!.siteSnapshot as { deliverySite?: { id?: number } }).deliverySite;
    assert.equal(secondDelivery?.id, factoryB.id, 're-decompose must show the NEW container factory');
    assert.notEqual(second[0]!.id, first[0]!.id, 'the stale fulfillment must have been replaced');
  });
});

after(async () => {
  if (fulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, fulfillmentIds));
  }
  if (shipmentIds.length > 0) {
    await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, shipmentIds));
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
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
  if (siteIds.length > 0) {
    await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, siteIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  await client.end();
});
