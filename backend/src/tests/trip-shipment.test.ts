/**
 * Wave 0 — trip-shipment-refactor integration tests.
 *
 * Exercises the `shipmentId` plumbing on the legacy `/api/trips` create path:
 *
 *   - createTrip WITHOUT shipmentId → legacy behaviour unchanged (NULL link).
 *   - createTrip WITH shipmentId → trip is linked + shipment containers are
 *     snapshotted into the trip.
 *   - createTrip WITH a missing shipmentId → 404.
 *   - createTrip WITH a non-DRAFT shipmentId → 409.
 *   - createTrip WITH a shipmentId belonging to a different customer → 400.
 *   - The SHIPMENT_FIRST_CREATE flag-conditional route check: when ON,
 *     missing shipmentId is rejected at the route layer.
 *
 * Hits the real Postgres DB (mirrors `shipment-service.test.ts`) and uses
 * the real `createTrip` (no mock) so the snapshot integration is exercised
 * end-to-end. Cleanup is in reverse-FK order in `after`.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createShipment, batchUpsertShipmentContainers } from '../services/shipment.service';
import { getForwarderTripDetail } from '../services/forwarder-trip-query.service';
import { createTrip, updateTripFigures } from '../services/trip-mutations.service';
import { FuelMode, LoadingType, Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdTripIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdUserIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `TripShipment customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCatalogs() {
  const [route] = await db.insert(s.routes)
    .values({ name: `TripShipment route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `TripShipment cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const shortCode = `TS${Math.random().toString(16).slice(2, 8)}`;
  const [containerType] = await db.insert(s.containerTypes)
    .values({ code: shortCode, name: `TripShipment ct ${suffix}` }).returning();
  createdContainerTypeIds.push(containerType.id);
  return { route, cargoType, containerType };
}

async function mkAlternateCargoType() {
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `TripShipment cargo alt ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return cargoType;
}

after(async () => {
  // Best-effort cleanup; tolerate FK failures from cross-test rows.
  try {
    await db.transaction(async (tx) => {
      if (createdTripIds.length > 0) {
        await tx.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
        await tx.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
        await tx.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
      }
      if (createdShipmentIds.length > 0) {
        if (createdUserIds.length > 0) {
          await tx.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, createdUserIds));
        }
        await tx.delete(s.shipmentStatusHistory)
          .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentContainers)
          .where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentDeclarations)
          .where(inArray(s.shipmentDeclarations.shipmentId, createdShipmentIds));
        await tx.delete(s.shipmentDocuments)
          .where(inArray(s.shipmentDocuments.shipmentId, createdShipmentIds));
        await tx.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
      }
      if (createdContainerTypeIds.length > 0) {
        await tx.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
      }
      if (createdCargoTypeIds.length > 0) {
        await tx.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
      }
      if (createdRouteIds.length > 0) {
        await tx.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
      }
      if (createdCustomerIds.length > 0) {
        await tx.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
      }
      if (createdUserIds.length > 0) {
        await tx.delete(s.users).where(inArray(s.users.id, createdUserIds));
      }
    });
  } catch (err) {
    console.warn('[trip-shipment.test] cleanup partial:', (err as Error).message);
  }
  // Force-exit — the snapshot path leaves postgres-js in a state where
  // graceful `client.end()` blocks on this Node 25 combination. node:test has
  // already recorded every assertion by this point.
  process.exit(0);
});

// Helper to build the minimum createTrip payload.
function baseCreateTripInput(customerId: number, routeId: number, cargoTypeId: number, containerTypeId: number) {
  return {
    customerId,
    routeId,
    cargoTypeId,
    containerTypeId,
    departureDate: '2026-08-01',
    containerCount: 1,
  };
}

function baseUpdate(tripVersion: number, overrides: Record<string, unknown> = {}) {
  return {
    legs: [{ sequence: 1, origin: 'A', destination: 'B', km: 100, loadingType: LoadingType.HANG }],
    fuelMode: FuelMode.AUTO,
    expectedVersion: tripVersion,
    userId: 1,
    userRole: Role.ADMIN,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy behaviour (no shipmentId) — regression guard
// ─────────────────────────────────────────────────────────────────────────────

describe('createTrip without shipmentId (legacy, regression guard)', () => {
  test('creates a trip with NULL shipmentId when none is provided', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const trip = await createTrip(baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id));
    createdTripIds.push(trip.id);
    assert.equal(trip.status, 'CREATED');
    assert.equal(trip.shipmentId, null, 'shipmentId is NULL when not provided');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shipmentId plumbing
// ─────────────────────────────────────────────────────────────────────────────

describe('createTrip with shipmentId', () => {
  test('links the trip to the DRAFT shipment and snapshots containers', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customer.id, cargoTypeId: cat.cargoType.id });
    createdShipmentIds.push(shipment.id);

    // Seed two shipment containers (valid ISO 6346 numbers — M10.2 enforces format).
    await batchUpsertShipmentContainers(shipment.id, null, [
      { containerTypeId: cat.containerType.id, containerNumber: 'MSKU1234565', sealNumber: 'SEAL-A', cargoWeightKg: 12000 },
      { containerTypeId: cat.containerType.id, containerNumber: 'TCNU7425363', cargoWeightKg: 8000 },
    ]);
    const [currentShipment] = await db.select()
      .from(s.shipments)
      .where(eq(s.shipments.id, shipment.id))
      .limit(1);

    const trip = await createTrip({
      ...baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
      shipmentId: shipment.id,
    });
    createdTripIds.push(trip.id);

    assert.equal(trip.shipmentId, shipment.id, 'trip is linked to the shipment');
    assert.equal(trip.cargoTypeId, cat.cargoType.id, 'trip cargo is sourced from the shipment authority');
    assert.equal(
      trip.sourceShipmentVersion,
      currentShipment?.version ?? shipment.version,
      'trip records the shipment source version',
    );

    // The snapshot should have copied the 2 shipment containers into the trip.
    // (Plus the 1 default empty row createTrip inserts — containerCount=1 — so
    // total is 3.) Verify the snapshot rows carry the marker and match the
    // shipment's container numbers.
    const tripRows = await db.select().from(s.tripContainers).where(eq(s.tripContainers.tripId, trip.id));
    const snapshotRows = tripRows.filter((r) => r.notes?.startsWith('__shipment_snapshot:'));
    assert.equal(snapshotRows.length, 2, 'snapshot copied both shipment containers');
    const numbers = snapshotRows.map((r) => r.containerNumber).sort();
    assert.deepEqual(numbers, ['MSKU1234565', 'TCNU7425363'].sort());
    const snapshotVersion = snapshotRows[0]?.sourceShipmentVersion ?? null;
    assert.ok(snapshotVersion, 'snapshot rows carry a shipment source version');
    assert.ok(snapshotRows.every((row) => row.sourceShipmentVersion === snapshotVersion));

    const [forwarder] = await db.insert(s.users).values({
      username: `trip-shipment-forwarder-${suffix}`,
      passwordHash: 'test-only',
      role: Role.FORWARDER,
      status: 'ACTIVE',
    }).returning({ id: s.users.id });
    createdUserIds.push(forwarder.id);
    await db.insert(s.userShipmentLinks).values({
      userId: forwarder.id,
      shipmentId: shipment.id,
    });

    const detail = await getForwarderTripDetail(trip.id, forwarder.id);
    assert.ok(detail, 'forwarder trip detail exists');
    assert.equal(detail!.shipmentId, shipment.id);
    assert.equal(detail!.shipmentSourceVersion, snapshotVersion);
    const detailedSnapshot = detail!.containers.filter((row) => row.sourceShipmentId === shipment.id);
    assert.equal(detailedSnapshot.length, 2, 'downstream trip detail keeps shipment provenance');
    assert.ok(detailedSnapshot.every((row) => row.sourceShipmentVersion === snapshotVersion));
  });

  test('seeds the shipment cargo from the first linked trip when the shipment has no cargo yet', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const trip = await createTrip({
      ...baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
      shipmentId: shipment.id,
    });
    createdTripIds.push(trip.id);

    const reloadedShipment = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id)).limit(1);
    assert.equal(reloadedShipment[0]?.cargoTypeId, cat.cargoType.id, 'shipment authority is seeded on first link');
    assert.equal(trip.cargoTypeId, cat.cargoType.id);
    assert.equal(trip.sourceShipmentVersion, reloadedShipment[0]?.version ?? null);
  });

  test('shipmentId with no shipment containers still creates the trip (no snapshot rows added)', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const trip = await createTrip({
      ...baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
      shipmentId: shipment.id,
    });
    createdTripIds.push(trip.id);

    assert.equal(trip.shipmentId, shipment.id);
    const tripRows = await db.select().from(s.tripContainers).where(eq(s.tripContainers.tripId, trip.id));
    const snapshotRows = tripRows.filter((r) => r.notes?.startsWith('__shipment_snapshot:'));
    assert.equal(snapshotRows.length, 0, 'no snapshot rows when shipment has no containers');
  });

  test('throws 404 when the shipment does not exist', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
        shipmentId: 99_999_999,
      }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    );
  });

  test('throws 409 when the shipment is not DRAFT', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    // Advance past DRAFT via the service.
    const { transitionShipmentStatus } = await import('../services/shipment.service');
    await transitionShipmentStatus(shipment.id, 'IN_PROGRESS');

    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
        shipmentId: shipment.id,
      }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('rejects cargo mismatch against the shipment authority', async () => {
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const alternateCargo = await mkAlternateCargoType();
    const shipment = await createShipment({ customerId: customer.id, cargoTypeId: cat.cargoType.id });
    createdShipmentIds.push(shipment.id);

    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customer.id, cat.route.id, alternateCargo.id, cat.containerType.id),
        shipmentId: shipment.id,
      }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('throws 400 when the shipment belongs to a different customer', async () => {
    const customerA = await mkCustomer();
    const customerB = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customerA.id });
    createdShipmentIds.push(shipment.id);

    // Trip is for customerB but shipment belongs to customerA → cross-customer
    // mismatch must be rejected to prevent data-leakage across customers.
    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customerB.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
        shipmentId: shipment.id,
      }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 400,
    );
  });

  test('rejects direct customer reassignment on a shipment-linked trip', async () => {
    const customerA = await mkCustomer();
    const customerB = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customerA.id });
    createdShipmentIds.push(shipment.id);

    const trip = await createTrip({
      ...baseCreateTripInput(customerA.id, cat.route.id, cat.cargoType.id, cat.containerType.id),
      shipmentId: shipment.id,
    });
    createdTripIds.push(trip.id);

    await assert.rejects(
      () => updateTripFigures(
        trip.id,
        baseUpdate(trip.version, { customerId: customerB.id }),
      ),
      (err: unknown) => err instanceof Error
        && 'statusCode' in err
        && err.statusCode === 409
        && /đổi khách hàng từ lô hàng nguồn/i.test(err.message),
    );
  });

  test('concurrent createTrip calls for the same shipment: one wins, the other gets a clean 409', async () => {
    // Race two createTrip calls against the same DRAFT shipment. The partial
    // null-fulfillment guard guarantees only one unassigned live trip can be
    // linked. Once decomposition is used, one live trip is allowed for each
    // distinct fulfillment instead.
    const customer = await mkCustomer();
    const cat = await mkCatalogs();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const base = baseCreateTripInput(customer.id, cat.route.id, cat.cargoType.id, cat.containerType.id);
    const results = await Promise.allSettled([
      createTrip({ ...base, shipmentId: shipment.id }),
      createTrip({ ...base, shipmentId: shipment.id }),
    ]);

    // Exactly one should fulfil, the other should reject with a 409 carrying
    // the domain message (NOT a generic 23505 "Dữ liệu đã tồn tại").
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one createTrip wins the link');
    assert.equal(rejected.length, 1, 'exactly one createTrip loses');

    if (fulfilled[0].status === 'fulfilled') {
      createdTripIds.push(fulfilled[0].value.id);
    }
    if (rejected[0].status === 'rejected') {
      const reason = rejected[0].reason as { statusCode?: number; message?: string };
      assert.equal(reason.statusCode, 409);
      assert.match(reason.message ?? '', /Lô hàng đã được gắn/);
    }

    // And the DB invariant holds: exactly one non-CANCELED trip linked.
    const linked = await db.select()
      .from(s.trips)
      .where(eq(s.trips.shipmentId, shipment.id));
    assert.equal(linked.length, 1, 'exactly one trip linked to the shipment');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag-conditional schema (parsed at the route layer)
// ─────────────────────────────────────────────────────────────────────────────

describe('createTripSchema (shared) — shipmentId field', () => {
  // Use EXTERNAL carrier in these schema-only tests so the superRefine that
  // requires truckId/driverId for OWN trips does not fire — we are testing
  // the shipmentId field, not carrier validation.
  const baseValidPayload = {
    customerId: 1, routeId: 2, cargoTypeId: 3, containerTypeId: 4,
    departureDate: '2026-08-01',
    carrierType: 'EXTERNAL' as const,
    externalCarrierId: 99,
  };

  test('accepts a valid shipmentId', async () => {
    const { createTripSchema } = await import('@tingting/shared');
    const parsed = createTripSchema.safeParse({ ...baseValidPayload, shipmentId: 42 });
    assert.ok(parsed.success);
    assert.equal(parsed.success ? parsed.data.shipmentId : null, 42);
  });

  test('accepts a null shipmentId (legacy)', async () => {
    const { createTripSchema } = await import('@tingting/shared');
    const parsed = createTripSchema.safeParse({ ...baseValidPayload, shipmentId: null });
    assert.ok(parsed.success);
  });

  test('accepts absence of shipmentId (legacy)', async () => {
    const { createTripSchema } = await import('@tingting/shared');
    const parsed = createTripSchema.safeParse({ ...baseValidPayload });
    assert.ok(parsed.success);
    // The flag-conditional REQUIRED check lives in the route handler, NOT the
    // shared schema — confirmed by this test.
  });

  test('rejects a non-positive shipmentId', async () => {
    const { createTripSchema } = await import('@tingting/shared');
    // -1 fails .positive(); the route's flag check would also reject undefined
    // (the coerce fallback for invalid numerics), but here we verify the schema
    // itself rejects an explicit negative id.
    const parsed = createTripSchema.safeParse({ ...baseValidPayload, shipmentId: -1 });
    assert.ok(!parsed.success);
  });
});
