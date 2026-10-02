/**
 * Dangling master refs on shipments (card 20260929_205).
 *
 * shipments.cargo_type_id / customer_id carry no DB foreign key (repo
 * convention: master-data integrity is app-layer — assertShipmentMasterRefsExist),
 * so QA/import debris can leave live lots pointing at catalog rows that do not
 * exist. Those lots could not be turned into trips: the error was either a
 * generic pricing 400 or a misleading "loại hàng không khớp" 409.
 *
 * Pins three layers:
 *   1. Census shape — the LEFT-JOIN census (scripts/qc-census-dangling-refs.mjs)
 *      reports a live shipment whose cargo_type_id points at a missing row.
 *   2. Trips write path — createTrip on such a lot is refused with an error
 *      that names the broken lot and the way out ("chỉnh lại loại hàng của lô"),
 *      and no trip row is written.
 *   3. Recurrence guards — the shipments path (existing master-refs check) and
 *      the trips path (direct create + cargo seeding into the lot) both refuse
 *      NEW dangling refs instead of persisting them.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createShipment } from '../services/shipment.service';
import { createTrip } from '../services/trip-mutations.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Each lot needs its own BL — active BL numbers are unique (partial index).
let blCounter = 0;
function nextBl(): string {
  blCounter += 1;
  return `DANGLE-BL-${suffix}-${blCounter}`;
}

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

/** An id guaranteed not to exist in cargo_types (max + offset, re-queried per run). */
async function phantomCargoTypeId(): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${s.cargoTypes.id})` }).from(s.cargoTypes);
  return Number(row?.max ?? 0) + 1000;
}

/** An id guaranteed not to exist in customers. */
async function phantomCustomerId(): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${s.customers.id})` }).from(s.customers);
  return Number(row?.max ?? 0) + 1000;
}

async function mkCustomer() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `DanglingCargo customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes)
    .values({ name: `DanglingCargo route ${suffix}-${createdRouteIds.length}` })
    .returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargoType() {
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `DanglingCargo cargo ${suffix}-${createdCargoTypeIds.length}` })
    .returning();
  createdCargoTypeIds.push(cargoType.id);
  return cargoType;
}

/** A live lot inserted DIRECTLY (bypassing the service) with a dangling cargo
 * ref — exactly the debris shape the census found. */
async function mkDanglingLot(customerId: number, cargoTypeId: number | null, blNumber: string) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    cargoTypeId,
    status: 'READY_FOR_DISPATCH',
    blNumber,
    version: 1,
  }).returning();
  createdShipmentIds.push(shipment.id);
  return shipment;
}

function baseCreateTripInput(customerId: number, routeId: number) {
  return {
    customerId,
    routeId,
    departureDate: '2026-10-01',
    containerCount: 1,
  };
}

after(async () => {
  // Best-effort cleanup in reverse-FK order; no successful trip is ever created
  // by this suite (every create is expected to reject), so trips/containers
  // need no sweep.
  try {
    await db.transaction(async (tx) => {
      if (createdShipmentIds.length > 0) {
        await tx.delete(s.shipmentStatusHistory)
          .where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
        await tx.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
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
    });
  } catch (err) {
    console.warn('[dangling-cargo-type.test] cleanup partial:', (err as Error).message);
  }
  // Force-exit — postgres-js keeps the loop alive on this Node combination;
  // node:test has already recorded every assertion by then.
  process.exit(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Census shape
// ─────────────────────────────────────────────────────────────────────────────

describe('census: dangling master refs on live shipments', () => {
  test('the census LEFT JOIN reports a lot whose cargo_type_id is missing', async () => {
    const customer = await mkCustomer();
    const phantom = await phantomCargoTypeId();
    const lot = await mkDanglingLot(customer.id, phantom, nextBl());

    // Same join shape as scripts/qc-census-dangling-refs.mjs — a live row whose
    // cargo_type_id is set but joins to nothing is exactly what must be listed.
    const rows = await db.select({ lotId: s.shipments.id, joinedCargoId: s.cargoTypes.id })
      .from(s.shipments)
      .leftJoin(s.cargoTypes, eq(s.cargoTypes.id, s.shipments.cargoTypeId))
      .where(and(
        eq(s.shipments.id, lot.id),
        isNull(s.shipments.deletedAt),
        sql`${s.shipments.cargoTypeId} is not null`,
      ));
    assert.equal(rows.length, 1, 'the dangling lot is visible to the census join');
    assert.equal(rows[0]?.lotId, lot.id);
    assert.equal(rows[0]?.joinedCargoId, null, 'no cargo_types row joins — the lot is dangling');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Trips write path — the error the user actually sees (card AC2/AC4)
// ─────────────────────────────────────────────────────────────────────────────

describe('createTrip on a lot with a missing cargo type', () => {
  test('refuses with an error naming the lot and the fix, and writes no trip', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const phantom = await phantomCargoTypeId();
    const blNumber = nextBl();
    const lot = await mkDanglingLot(customer.id, phantom, blNumber);

    // Operator picks the lot and passes no trip-level cargo type: the lot's own
    // (phantom) authority is what surfaces.
    await assert.rejects(
      () => createTrip({ ...baseCreateTripInput(customer.id, route.id), shipmentId: lot.id }),
      (err: unknown) => {
        assert.ok(err instanceof Error && 'statusCode' in err, 'an ApiError is thrown');
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 409);
        assert.match(apiError.message, new RegExp(blNumber), 'the error names the broken lot by its display key');
        assert.match(apiError.message, /không còn tồn tại/i, 'the error says the cargo type no longer exists');
        assert.match(apiError.message, /chỉnh lại loại hàng của lô/i, 'the error names the corrective path');
        return true;
      },
    );

    const linkedTrips = await db.select({ id: s.trips.id })
      .from(s.trips)
      .where(eq(s.trips.shipmentId, lot.id));
    assert.equal(linkedTrips.length, 0, 'no trip row is written for the refused create');
  });

  test('a real trip cargo type must not produce the misleading mismatch error', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const realCargo = await mkCargoType();
    const phantom = await phantomCargoTypeId();
    // Old behaviour: passing a REAL cargo type fell into the mismatch branch
    // ("Loại hàng của chuyến không khớp...") — wrong diagnosis.
    const lot = await mkDanglingLot(customer.id, phantom, nextBl());

    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customer.id, route.id),
        cargoTypeId: realCargo.id,
        shipmentId: lot.id,
      }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 409);
        assert.doesNotMatch(apiError.message, /không khớp/i, 'the misleading mismatch wording is gone');
        assert.match(apiError.message, /không còn tồn tại/i);
        assert.match(apiError.message, /chỉnh lại loại hàng của lô/i);
        return true;
      },
    );
  });

  test('a genuine cargo mismatch (both types real) still rejects with the mismatch error', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const lotCargo = await mkCargoType();
    const otherCargo = await mkCargoType();
    const lot = await mkDanglingLot(customer.id, lotCargo.id, nextBl());

    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customer.id, route.id),
        cargoTypeId: otherCargo.id,
        shipmentId: lot.id,
      }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 409);
        assert.match(apiError.message, /không khớp/i, 'a real mismatch keeps the original diagnosis');
        return true;
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Recurrence guards — no NEW dangling ref can enter either write path (AC3)
// ─────────────────────────────────────────────────────────────────────────────

describe('recurrence guards: dangling refs cannot be written', () => {
  test('createShipment refuses a dangling cargo_type_id (existing master-refs guard)', async () => {
    const customer = await mkCustomer();
    const phantom = await phantomCargoTypeId();
    await assert.rejects(
      () => createShipment({ customerId: customer.id, cargoTypeId: phantom }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message, /Loại hàng không tồn tại/i);
        return true;
      },
    );
  });

  test('createShipment refuses a dangling customer_id (existing master-refs guard)', async () => {
    const route = await mkRoute();
    const phantom = await phantomCustomerId();
    await assert.rejects(
      () => createShipment({ customerId: phantom, routeId: route.id }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message, /Khách hàng không tồn tại/i);
        return true;
      },
    );
  });

  test('createTrip cannot seed a phantom cargo type into a lot that has none', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const phantom = await phantomCargoTypeId();
    const lot = await mkDanglingLot(customer.id, null, nextBl());

    await assert.rejects(
      () => createTrip({
        ...baseCreateTripInput(customer.id, route.id),
        cargoTypeId: phantom,
        shipmentId: lot.id,
      }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message, /không tồn tại/i);
        return true;
      },
    );

    const [reloaded] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot.id)).limit(1);
    assert.equal(reloaded?.cargoTypeId, null, 'the lot is not seeded with the phantom type');
    assert.equal(reloaded?.version, 1, 'the lot row was not modified');
  });

  test('createTrip without a shipment refuses a dangling cargo_type_id at the write path', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const phantom = await phantomCargoTypeId();
    await assert.rejects(
      () => createTrip({ ...baseCreateTripInput(customer.id, route.id), cargoTypeId: phantom }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message, /Loại hàng không tồn tại/i, 'the explicit write-path guard fires, not an incidental pricing lookup');
        return true;
      },
    );
  });

  test('createTrip refuses a dangling customer_id up front', async () => {
    const route = await mkRoute();
    const phantom = await phantomCustomerId();
    await assert.rejects(
      () => createTrip({ ...baseCreateTripInput(phantom, route.id) }),
      (err: unknown) => {
        const apiError = err as Error & { statusCode?: number };
        assert.equal(apiError.statusCode, 400);
        assert.match(apiError.message, /Khách hàng không tồn tại/i);
        return true;
      },
    );
  });
});
