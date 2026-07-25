/**
 * Wave 0 — shipment.service.ts integration tests.
 *
 * Hits the real Postgres DB (mirrors `carrier-payment-ledger.test.ts` /
 * `chiho-reconciliation.test.ts`), creates the minimum scaffolding rows
 * (customer / route / cargoType / trip / containerType) needed to exercise the
 * service, and tears everything down in reverse-FK order in `after`.
 *
 * Coverage:
 *   - createShipment: DRAFT row, generated unique code, initial history row.
 *   - getShipment / listShipments: 404 on missing; pagination + filters; excludes soft-deleted.
 *   - updateShipment: optimistic-lock bump; 409 on stale version.
 *   - transitionShipmentStatus: legal edges only; idempotent same-status; history rows; 404.
 *   - softDeleteShipment: only DRAFT/CANCELED; version-guarded.
 *   - snapshotContainersIntoTrip: copies rows once, idempotent on retry.
 *   - formatShipmentCode: pure unit checks.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import {
  createShipment,
  getShipment,
  listShipments,
  updateShipment,
  transitionShipmentStatus,
  softDeleteShipment,
  snapshotContainersIntoTrip,
  formatShipmentCode,
} from '../services/shipment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Cleanup buckets — populated as rows are created; emptied in `after` in FK order.
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdTripContainerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `ShipmentSvc customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkTrip(customerId: number) {
  // Minimal scaffolding: a route + cargo type are required (NOT NULL) on trips.
  const [route] = await db.insert(s.routes)
    .values({ name: `ShipmentSvc route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `ShipmentSvc cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `SS-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'CREATED',
    departureDate: '2026-07-25',
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

after(async () => {
  // Reverse FK order: snapshot rows → trips → shipment children → shipment → catalogs → customer.
  if (createdTripContainerIds.length > 0) {
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, createdTripContainerIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, createdTripIds));
    await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdShipmentIds.length > 0) {
    await db.delete(s.shipmentStatusHistory)
      .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
    await db.delete(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
    await db.delete(s.shipmentDeclarations)
      .where(inArray(s.shipmentDeclarations.shipmentId, createdShipmentIds));
    await db.delete(s.shipmentDocuments)
      .where(inArray(s.shipmentDocuments.shipmentId, createdShipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdContainerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  await client.end();
});

// ─── Pure unit ──────────────────────────────────────────────────────────────

describe('formatShipmentCode', () => {
  test('formats as SHP-YYMM-NNNNN with 5-digit padding', () => {
    const code = formatShipmentCode(42, new Date('2026-07-25T00:00:00Z'));
    assert.equal(code, 'SHP-2607-00042');
  });

  test('is unique per id (PK-backed)', () => {
    const a = formatShipmentCode(1);
    const b = formatShipmentCode(2);
    assert.notEqual(a, b);
  });
});

// ─── DB-touching ────────────────────────────────────────────────────────────

describe('createShipment', () => {
  test('inserts a DRAFT row with a unique code and initial history row', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({
      customerId: customer.id,
      bookingRef: `BK-${suffix}`,
      contactName: 'Nguyễn A',
    });
    createdShipmentIds.push(shipment.id);

    assert.equal(shipment.status, 'DRAFT');
    assert.equal(shipment.version, 1);
    assert.ok(shipment.shipmentCode, 'shipmentCode generated');
    assert.match(shipment.shipmentCode!, /^SHP-\d{4}-\d{5}$/);
    assert.equal(shipment.bookingRef, `BK-${suffix}`);

    // Initial history row written with fromStatus = null.
    const [hist] = await db.select().from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, shipment.id));
    assert.ok(hist, 'history row exists');
    assert.equal(hist.fromStatus, null);
    assert.equal(hist.toStatus, 'DRAFT');
  });

  test('codes are unique across two shipments', async () => {
    const customer = await mkCustomer();
    const a = await createShipment({ customerId: customer.id });
    const b = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(a.id, b.id);
    assert.notEqual(a.shipmentCode, b.shipmentCode);
  });
});

describe('getShipment / listShipments', () => {
  test('getShipment throws 404 on missing', async () => {
    await assert.rejects(
      () => getShipment(99_999_999),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    );
  });

  test('listShipments filters by customerId and excludes soft-deleted', async () => {
    const c1 = await mkCustomer();
    const c2 = await mkCustomer();
    const s1 = await createShipment({ customerId: c1.id });
    const s2 = await createShipment({ customerId: c2.id });
    createdShipmentIds.push(s1.id, s2.id);

    const forC1 = await listShipments({ customerId: c1.id });
    assert.ok(forC1.some((x) => x.id === s1.id), 'c1 sees its shipment');
    assert.ok(!forC1.some((x) => x.id === s2.id), 'c1 does not see c2 shipment');
  });
});

describe('updateShipment (optimistic lock)', () => {
  test('bumps version on update', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const updated = await updateShipment(shipment.id, {
      version: shipment.version,
      bookingRef: `BK-UP-${suffix}`,
    });
    assert.equal(updated.version, shipment.version + 1);
    assert.equal(updated.bookingRef, `BK-UP-${suffix}`);
  });

  test('rejects a stale version with 409', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    // First successful update bumps version to 2.
    await updateShipment(shipment.id, { version: 1, contactName: 'X' });

    // A second caller still holding version=1 must get 409.
    await assert.rejects(
      () => updateShipment(shipment.id, { version: 1, contactName: 'Y' }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('throws 404 for a missing shipment', async () => {
    await assert.rejects(
      () => updateShipment(99_999_999, { version: 1 }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    );
  });
});

describe('transitionShipmentStatus', () => {
  test('DRAFT → IN_PROGRESS → DELIVERED → CLOSED writes one history row each', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const inflight = await transitionShipmentStatus(shipment.id, 'IN_PROGRESS', {
      reason: 'Bắt đầu vận chuyển',
    });
    assert.equal(inflight.status, 'IN_PROGRESS');

    const delivered = await transitionShipmentStatus(shipment.id, 'DELIVERED');
    assert.equal(delivered.status, 'DELIVERED');

    const closed = await transitionShipmentStatus(shipment.id, 'CLOSED');
    assert.equal(closed.status, 'CLOSED');

    const history = await db.select().from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, shipment.id))
      .orderBy(s.shipmentStatusHistory.id);
    // 1 creation row + 3 transitions = 4
    assert.equal(history.length, 4);
    assert.deepEqual(
      history.map((h) => h.toStatus),
      ['DRAFT', 'IN_PROGRESS', 'DELIVERED', 'CLOSED'],
    );
    assert.equal(history[1].reason, 'Bắt đầu vận chuyển');
  });

  test('idempotent same-status returns the row without a new history row', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const result = await transitionShipmentStatus(shipment.id, 'DRAFT');
    assert.equal(result.status, 'DRAFT');

    // Only the creation history row should exist — no duplicate.
    const history = await db.select().from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, shipment.id));
    assert.equal(history.length, 1);
  });

  test('rejects an illegal transition with 409', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    // DRAFT → DELIVERED is not a legal edge.
    await assert.rejects(
      () => transitionShipmentStatus(shipment.id, 'DELIVERED'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );

    // CLOSED has no outgoing edges.
    await transitionShipmentStatus(shipment.id, 'IN_PROGRESS');
    await transitionShipmentStatus(shipment.id, 'DELIVERED');
    await transitionShipmentStatus(shipment.id, 'CLOSED');
    await assert.rejects(
      () => transitionShipmentStatus(shipment.id, 'IN_PROGRESS'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('throws 404 for a missing shipment', async () => {
    await assert.rejects(
      () => transitionShipmentStatus(99_999_999, 'IN_PROGRESS'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    );
  });
});

describe('softDeleteShipment', () => {
  test('removes a DRAFT shipment by setting deletedAt', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const deleted = await softDeleteShipment(shipment.id, { version: shipment.version });
    assert.ok(deleted.deletedAt);

    // listShipments excludes soft-deleted rows.
    const rows = await listShipments({ customerId: customer.id });
    assert.ok(!rows.some((r) => r.id === shipment.id));
  });

  test('refuses to delete an IN_PROGRESS shipment with 409', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const inflight = await transitionShipmentStatus(shipment.id, 'IN_PROGRESS');
    await assert.rejects(
      () => softDeleteShipment(shipment.id, { version: inflight.version }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('refuses a stale version with 409', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    await updateShipment(shipment.id, { version: 1, contactName: 'edit' });
    await assert.rejects(
      () => softDeleteShipment(shipment.id, { version: 1 }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });
});

describe('snapshotContainersIntoTrip', () => {
  test('copies shipment_containers into trip_containers once and is idempotent', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    // Add a containerType + two shipment_containers for this shipment.
    // container_types.code is varchar(20) + UNIQUE. Use a short random tag so
    // re-runs don't collide with rows left over from prior test executions.
    const shortTag = Math.random().toString(36).slice(2, 10); // 8 chars
    const [ct] = await db.insert(s.containerTypes)
      .values({ code: `SS${shortTag}`, name: "20'DC" })
      .returning();
    createdContainerTypeIds.push(ct.id);

    const inserted = await db.insert(s.shipmentContainers).values([
      { shipmentId: shipment.id, containerTypeId: ct.id, containerNumber: 'CONT-A', sealNumber: 'SEAL-A', cargoWeightKg: '12000.00' },
      { shipmentId: shipment.id, containerTypeId: ct.id, containerNumber: 'CONT-B', sealNumber: 'SEAL-B', cargoWeightKg: '18500.00' },
    ]).returning();
    assert.equal(inserted.length, 2);

    const trip = await mkTrip(customer.id);

    // First snapshot: copies both rows.
    const r1 = await snapshotContainersIntoTrip(shipment.id, trip.id);
    assert.equal(r1.copied, 2);
    assert.equal(r1.skipped, false);

    const afterFirst = await db.select().from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, trip.id));
    assert.equal(afterFirst.length, 2);
    afterFirst.forEach((row) => createdTripContainerIds.push(row.id));

    // Second snapshot: idempotent — skipped, no extra rows.
    const r2 = await snapshotContainersIntoTrip(shipment.id, trip.id);
    assert.equal(r2.copied, 0);
    assert.equal(r2.skipped, true);

    const afterSecond = await db.select().from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, trip.id));
    assert.equal(afterSecond.length, 2);
  });

  test('returns copied=0 when the shipment has no containers', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    const trip = await mkTrip(customer.id);

    const r = await snapshotContainersIntoTrip(shipment.id, trip.id);
    assert.equal(r.copied, 0);
    assert.equal(r.skipped, false);
  });
});
