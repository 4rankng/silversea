/**
 * Wave 4 M10.2 slice 2 — advisory dispatch-readiness check.
 *
 * Hits the real Postgres DB (mirrors `m102-container-validation.test.ts`):
 * creates the minimum scaffolding (customer + catalogs + shipment +
 * optional BL/container), and exercises `getDispatchReadiness`.
 *
 * Coverage (PRD M10-02-03 "mandatory fields defined before dispatch"):
 *   - ready when BL + ≥1 container are set.
 *   - missing BL → warning lists "Số vận đơn (B/L)".
 *   - missing containers → warning lists "Công-te-nơ (ít nhất một)".
 *   - missing both → both warnings, in a stable order.
 *   - 404 on missing shipment.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import {
  createShipment,
  batchUpsertShipmentContainers,
  getDispatchReadiness,
} from '../services/shipment.service';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M102-readiness customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `M102-readiness route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `M102-readiness cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const shortCode = `R1${Math.random().toString(16).slice(2, 10)}`;
  const [containerType] = await db.insert(s.containerTypes)
    .values({ code: shortCode, name: `M102-readiness ct ${suffix}` }).returning();
  createdContainerTypeIds.push(containerType.id);
  return { route, cargoType, containerType };
}

async function mkShipment(blNumber?: string) {
  const customer = await mkCustomer();
  const shipment = await createShipment({ customerId: customer.id, blNumber });
  createdShipmentIds.push(shipment.id);
  return shipment;
}

let catalogs: { route: { id: number }; cargoType: { id: number }; containerType: { id: number } };

before(async () => {
  catalogs = await mkCatalogs();
});

describe('M10.2 slice 2 — getDispatchReadiness (advisory)', () => {
  test('ready when BL number + ≥1 container are set', async () => {
    const shipment = await mkShipment('BL-READY-1');
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId: catalogs.containerType.id, containerNumber: 'MSKU1234565' },
    ]);
    const result = await getDispatchReadiness(shipment.id);
    assert.equal(result.ready, true);
    assert.deepEqual(result.missing, []);
  });

  test('missing BL number → warning lists "Số vận đơn (B/L)"', async () => {
    const shipment = await mkShipment(); // no BL
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId: catalogs.containerType.id, containerNumber: 'TCNU7425363' },
    ]);
    const result = await getDispatchReadiness(shipment.id);
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, ['Số vận đơn (B/L)']);
  });

  test('missing containers → warning lists "Công-te-nơ (ít nhất một)"', async () => {
    const shipment = await mkShipment('BL-NO-CONT');
    // No containers seeded.
    const result = await getDispatchReadiness(shipment.id);
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, ['Công-te-nơ (ít nhất một)']);
  });

  test('missing both → both warnings, BL first then container (stable order)', async () => {
    const shipment = await mkShipment(); // no BL, no containers
    const result = await getDispatchReadiness(shipment.id);
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, ['Số vận đơn (B/L)', 'Công-te-nơ (ít nhất một)']);
  });

  test('404 on missing shipment', async () => {
    await assert.rejects(
      () => getDispatchReadiness(99_999_999),
      (err: unknown) => err instanceof ApiError && err.statusCode === 404,
    );
  });

  test('a blank/whitespace BL is treated as missing', async () => {
    const shipment = await mkShipment('   ');
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId: catalogs.containerType.id, containerNumber: 'OOLU8312661' },
    ]);
    const result = await getDispatchReadiness(shipment.id);
    assert.equal(result.ready, false);
    assert.deepEqual(result.missing, ['Số vận đơn (B/L)']);
  });
});

after(async () => {
  try {
    if (createdTripIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdShipmentIds.length > 0) {
      await db.delete(s.shipmentContainers)
        .where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
      await db.delete(s.shipmentStatusHistory)
        .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[m102-dispatch-readiness.test] cleanup partial:', (err as Error).message);
  }
  // Force-exit — dispatch leaves shared ioredis + postgres.js clients in a
  // state where graceful shutdown blocks (same rationale as shipment-routes.test.ts).
  try { await client.end(); } catch { /* ignore */ }
  process.exit(0);
});
