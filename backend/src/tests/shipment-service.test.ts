/**
 * Wave 0 — shipment.service.ts integration tests.
 *
 * Hits the real Postgres DB (mirrors `carrier-payment-ledger.test.ts` /
 * `chiho-reconciliation.test.ts`), creates the minimum scaffolding rows
 * (customer / route / cargoType / trip / containerType) needed to exercise the
 * service, and tears everything down in reverse-FK order in `after`.
 *
 * Coverage:
 *   - createShipment: NEW row, generated unique code, initial history row.
 *   - getShipment / listShipments: 404 on missing; pagination + filters; excludes soft-deleted.
 *   - updateShipment: optimistic-lock bump; 409 on stale version.
 *   - transitionShipmentStatus: legal edges only; idempotent same-status; history rows; 404.
 *   - softDeleteShipment: blocked only while a live (non-canceled) trip is
 *     linked to the shipment; version-guarded.
 *   - snapshotContainersIntoTrip: copies rows once, idempotent on retry.
 *   - formatShipmentCode: pure unit checks.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role, ShipmentStatus } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import {
  createShipment,
  getShipment,
  listShipments,
  listShipmentsPaginated,
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
const createdPortIds: number[] = [];
const createdTripContainerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdUserIds: number[] = [];
const createdBusinessUnitIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `ShipmentSvc customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkCarrierCustomer() {
  const [c] = await db.insert(s.customers)
    .values({
      name: `ShipmentSvc carrier ${suffix}-${createdCustomerIds.length}`,
      isCarrier: true,
      status: 'ACTIVE',
    })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRouteAndCargo() {
  const [route] = await db.insert(s.routes)
    .values({ name: `ShipmentSvc route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `ShipmentSvc cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return { route, cargoType };
}

async function mkTrip(customerId: number) {
  // Minimal scaffolding: a route + cargo type are required (NOT NULL) on trips.
  const { route, cargoType } = await mkRouteAndCargo();
  const trip = await insertTripComposite(db, {
    tripCode: `SS-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'CREATED',
    departureDate: '2026-07-25',
    carrierType: 'OWN',
  });
  createdTripIds.push(trip.id);
  return trip;
}

async function mkTripForShipment(input: {
  customerId: number;
  shipmentId: number;
  fulfillmentId?: number | null;
  carrierType?: 'OWN' | 'EXTERNAL';
  truckId?: number | null;
  externalCarrierId?: number | null;
  externalPlateNumber?: string | null;
  status?: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED';
}) {
  const { route, cargoType } = await mkRouteAndCargo();
  const carrierType = input.carrierType ?? 'OWN';
  const trip = await insertTripComposite(db, {
    tripCode: `SS-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: input.customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: input.shipmentId,
    fulfillmentId: input.fulfillmentId ?? null,
    status: input.status ?? 'CREATED',
    departureDate: '2026-08-04',
    carrierType,
    truckId: carrierType === 'OWN' ? input.truckId ?? null : null,
    externalEntityId: carrierType === 'EXTERNAL' ? input.externalCarrierId ?? null : null,
    externalEntityType: carrierType === 'EXTERNAL' && input.externalCarrierId != null ? 'CUSTOMER' : null,
    externalPlateNumber: carrierType === 'EXTERNAL' ? input.externalPlateNumber ?? null : null,
  });
  createdTripIds.push(trip.id);
  return trip;
}

async function mkTruck() {
  const [truck] = await db.insert(s.trucks)
    .values({
      licensePlate: `51C-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      status: 'ACTIVE',
    })
    .returning();
  createdTruckIds.push(truck.id);
  return truck;
}

async function mkBusinessUnit() {
  const [unit] = await db.insert(s.businessUnits)
    .values({
      code: `SS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: `ShipmentSvc unit ${suffix}-${createdBusinessUnitIds.length}`,
      status: 'ACTIVE',
    })
    .returning();
  createdBusinessUnitIds.push(unit.id);
  return unit;
}

async function mkScopedClerk(customerId: number, businessUnitId: number) {
  const [user] = await db.insert(s.users).values({
    username: `shipment-svc-clerk-${suffix}-${createdUserIds.length}`,
    passwordHash: 'test-hash',
    role: Role.CUS,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);

  await db.insert(s.userCustomerLinks).values({ userId: user.id, customerId });
  await db.insert(s.userBusinessUnitLinks).values({ userId: user.id, businessUnitId });

  return {
    userId: user.id,
    username: user.username,
    email: null,
    fullName: null,
    role: Role.CUS,
    customerId,
    customerIds: [customerId],
  };
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
    await db.delete(s.shipmentFulfillments)
      .where(inArray(s.shipmentFulfillments.shipmentId, createdShipmentIds));
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
  if (createdPortIds.length > 0) {
    await db.delete(s.ports).where(inArray(s.ports.id, createdPortIds));
  }
  if (createdTruckIds.length > 0) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdUserIds));
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdUserIds));
    await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, createdUserIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  if (createdBusinessUnitIds.length > 0) {
    await db.delete(s.businessUnits).where(inArray(s.businessUnits.id, createdBusinessUnitIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  await client.end();
});

// ─── Pure unit ──────────────────────────────────────────────────────────────

describe('formatShipmentCode', () => {
  test('formats as SHP-YYMM-NNNNN from the monthly counter with 5-digit padding', () => {
    const code = formatShipmentCode(42, new Date('2026-07-25T00:00:00Z'));
    assert.equal(code, 'SHP-2607-00042');
  });

  test('has no id input at all — codes cannot derive from the row id (ruling 4b)', () => {
    // The signature takes the monthly counter only: there is no id parameter
    // to derive from, and the code is stable for a given counter + month.
    const a = formatShipmentCode(7, new Date('2026-09-20T10:00:00Z'));
    const b = formatShipmentCode(7, new Date('2026-09-20T10:05:00Z'));
    assert.equal(a, b);
    assert.notEqual(formatShipmentCode(8, new Date('2026-09-20T10:00:00Z')), a);
  });
});

// ─── DB-touching ────────────────────────────────────────────────────────────

describe('createShipment', () => {
  test('inserts a PENDING_DATE row with a unique code and initial history row', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({
      customerId: customer.id,
      bookingRef: `BK-${suffix}`,
      contactName: 'Nguyễn A',
    });
    createdShipmentIds.push(shipment.id);

    assert.equal(shipment.status, 'PENDING_DATE');
    assert.equal(shipment.version, 1);
    assert.ok(shipment.shipmentCode, 'shipmentCode generated');
    assert.match(shipment.shipmentCode!, /^SHP-\d{4}-\d{5,}$/);
    assert.equal(shipment.bookingRef, `BK-${suffix}`);

    // Initial history row written with fromStatus = null.
    const [hist] = await db.select().from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, shipment.id));
    assert.ok(hist, 'history row exists');
    assert.equal(hist.fromStatus, null);
    assert.equal(hist.toStatus, 'PENDING_DATE');
  });

  test('codes are unique across two shipments', async () => {
    const customer = await mkCustomer();
    const a = await createShipment({ customerId: customer.id });
    const b = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(a.id, b.id);
    assert.notEqual(a.shipmentCode, b.shipmentCode);
  });

  test('persists optional shipment operations fields on create', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({
      customerId: customer.id,
      tradeDirection: 'IMPORT',
      cargoMode: 'LCL',
      factoryName: `Factory ${suffix}`,
      shippingLineName: `Line ${suffix}`,
      customsCutoffAt: '2026-07-29T01:00:00.000Z',
      closingAt: '2026-07-29T02:30:00.000Z',
      plannedReturnAt: '2026-07-30T08:15:00.000Z',
      cargoWeightKg: 1234.5,
      cargoVolumeCbm: 45.678,
      packageCount: 12,
      packageType: 'Pallet',
      operationalNotes: 'First-pass dossier',
    });
    createdShipmentIds.push(shipment.id);

    assert.equal(shipment.tradeDirection, 'IMPORT');
    assert.equal(shipment.cargoMode, 'LCL');
    assert.equal(shipment.factoryName, `Factory ${suffix}`);
    assert.equal(shipment.shippingLineName, `Line ${suffix}`);
    assert.equal(shipment.customsCutoffAt?.toISOString(), '2026-07-29T01:00:00.000Z');
    assert.equal(shipment.closingAt?.toISOString(), '2026-07-29T02:30:00.000Z');
    assert.equal(shipment.plannedReturnAt?.toISOString(), '2026-07-30T08:15:00.000Z');
    assert.equal(Number(shipment.cargoWeightKg), 1234.5);
    assert.equal(Number(shipment.cargoVolumeCbm), 45.678);
    assert.equal(shipment.packageCount, 12);
    assert.equal(shipment.packageType, 'Pallet');
    assert.equal(shipment.operationalNotes, 'First-pass dossier');
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

  test('listShipments supports server-side search across code, customer, booking, BL, factory, and shipping line', async () => {
    const targetCustomer = await mkCustomer();
    const otherCustomer = await mkCustomer();
    // Import shipment carries the Bill; export shipment carries the Booking —
    // the document-reference invariant forbids both on one row.
    const target = await createShipment({
      customerId: targetCustomer.id,
      tradeDirection: 'IMPORT',
      bookingRef: null,
      blNumber: `BL-${suffix}`,
      factoryName: `Factory ${suffix}`,
      shippingLineName: `Shipping ${suffix}`,
    });
    const exportTarget = await createShipment({
      customerId: targetCustomer.id,
      tradeDirection: 'EXPORT',
      bookingRef: `BOOK-${suffix}`,
      blNumber: null,
      factoryName: `Factory ${suffix}`,
      shippingLineName: `Shipping ${suffix}`,
    });
    const other = await createShipment({
      customerId: otherCustomer.id,
      bookingRef: `OTHER-${suffix}`,
      factoryName: `Other Factory ${suffix}`,
      shippingLineName: `Other Shipping ${suffix}`,
    });
    createdShipmentIds.push(exportTarget.id);
    createdShipmentIds.push(target.id, other.id);

    const byCode = await listShipments({ q: target.shipmentCode! });
    const byCustomer = await listShipments({ q: targetCustomer.name });
    const byBooking = await listShipments({ q: `BOOK-${suffix}` });
    const byBl = await listShipments({ q: `BL-${suffix}` });
    const byFactory = await listShipments({ q: `Factory ${suffix}` });
    const byLine = await listShipments({ q: `Shipping ${suffix}` });

    for (const result of [byCode, byCustomer, byBooking, byBl, byFactory, byLine]) {
      assert.ok(result.some((row) => row.id === target.id || row.id === exportTarget.id), 'target shipment is searchable');
      assert.ok(!result.every((row) => row.id === other.id), 'search is not pinned to the distractor');
    }
  });
});

describe('listShipmentsPaginated', () => {
  test('includes legacy NEW rows in the PENDING_DATE filter bucket', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    await db.update(s.shipments).set({ status: 'NEW' }).where(eq(s.shipments.id, shipment.id));

    const result = await listShipmentsPaginated({
      customerId: customer.id,
      status: 'PENDING_DATE',
      page: 1,
      limit: 20,
    });

    assert.deepEqual(result.items.map((row) => row.id), [shipment.id]);
    assert.equal(result.total, 1);
  });

  test('dispatch master plan keeps a fully completed lot visible via the multi-status filter (regression 2026-09-05)', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);
    await db.update(s.shipments).set({ status: ShipmentStatus.COMPLETED }).where(eq(s.shipments.id, shipment.id));

    // The dispatch master plan passes the full operational range in one
    // request; a lot that finished its transport must survive that filter
    // instead of vanishing from Kế hoạch Tổng quát (2026-09-05 customer
    // report: single-container lot disappeared once its driver completed).
    const masterPlan = await listShipmentsPaginated({
      customerId: customer.id,
      status: [
        ShipmentStatus.READY_FOR_DISPATCH,
        ShipmentStatus.DISPATCHED,
        ShipmentStatus.IN_TRANSIT,
        ShipmentStatus.COMPLETED,
      ],
      page: 1,
      limit: 20,
    });
    assert.deepEqual(masterPlan.items.map((row) => row.id), [shipment.id]);
    assert.equal(masterPlan.total, 1);

    // The legacy single-status planning filter keeps its old semantics: a
    // completed lot is not READY_FOR_DISPATCH, so planning-only callers
    // still exclude it.
    const planningOnly = await listShipmentsPaginated({
      customerId: customer.id,
      status: ShipmentStatus.READY_FOR_DISPATCH,
      page: 1,
      limit: 20,
    });
    assert.equal(planningOnly.total, 0);
  });

  test('projects deterministic FCL summaries from containers, fulfillments, and live trips', async () => {
    const customer = await mkCustomer();
    const carrierA = await mkCarrierCustomer();
    const carrierB = await mkCarrierCustomer();
    const truck = await mkTruck();
    const shipment = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      shippingLineName: `Main Line ${suffix}`,
    });
    createdShipmentIds.push(shipment.id);

    const containers = await db.insert(s.shipmentContainers).values([
      {
        shipmentId: shipment.id,
        containerNumber: `MSKU${String(Date.now()).slice(-6)}1`,
        shippingLineName: `Main Line ${suffix}`,
      },
      {
        shipmentId: shipment.id,
        containerNumber: `TCLU${String(Date.now()).slice(-6)}2`,
        shippingLineName: `Line B ${suffix}`,
      },
    ]).returning();

    const [ownFulfillment, externalFulfillment, canceledFulfillment] = await db.insert(s.shipmentFulfillments).values([
      {
        shipmentId: shipment.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: containers[0]!.id,
        sourceShipmentVersion: shipment.version,
        siteSnapshot: {},
        plannedCarrierType: 'OWN',
      },
      {
        shipmentId: shipment.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: containers[1]!.id,
        sourceShipmentVersion: shipment.version,
        siteSnapshot: {},
        plannedCarrierType: 'EXTERNAL',
        plannedExternalCarrierId: carrierA.id,
      },
      {
        shipmentId: shipment.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        sourceShipmentVersion: shipment.version,
        siteSnapshot: {},
        plannedCarrierType: 'EXTERNAL',
        plannedExternalCarrierId: carrierB.id,
        canceledAt: new Date('2026-08-04T08:00:00Z'),
      },
    ]).returning();

    await mkTripForShipment({
      customerId: customer.id,
      shipmentId: shipment.id,
      fulfillmentId: ownFulfillment.id,
      carrierType: 'OWN',
      truckId: truck.id,
      status: 'CREATED',
    });
    await mkTripForShipment({
      customerId: customer.id,
      shipmentId: shipment.id,
      fulfillmentId: externalFulfillment.id,
      carrierType: 'EXTERNAL',
      externalCarrierId: carrierA.id,
      externalPlateNumber: '51H-222.22',
      status: 'IN_TRANSIT',
    });
    await mkTripForShipment({
      customerId: customer.id,
      shipmentId: shipment.id,
      fulfillmentId: canceledFulfillment.id,
      carrierType: 'EXTERNAL',
      externalCarrierId: carrierB.id,
      externalPlateNumber: '51H-999.99',
      // Deliberately inconsistent legacy state: the fulfillment is canceled
      // but its trip is still live. The list must trust the fulfillment.
      status: 'CREATED',
    });
    await mkTripForShipment({
      customerId: customer.id,
      shipmentId: shipment.id,
      carrierType: 'EXTERNAL',
      externalCarrierId: carrierB.id,
      externalPlateNumber: '51H-333.33',
      status: 'CREATED',
    });

    const result = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20 });
    const row = result.items.find((item) => item.id === shipment.id);
    assert.ok(row, 'shipment appears exactly once in the paginated list');
    assert.equal(result.items.filter((item) => item.id === shipment.id).length, 1);
    assert.equal(row!.cargoSummary, `2 cont: ${containers[0]!.containerNumber}, ${containers[1]!.containerNumber}`);
    assert.equal(row!.shippingLineSummary, `Main Line ${suffix}, Line B ${suffix}`);
    assert.equal(row!.carrierSummary, `SilverSea, ${carrierA.name}, ${carrierB.name}`);
    assert.equal(row!.vehiclePlateSummary, `${truck.licensePlate}, 51H-222.22, 51H-333.33`);
  });

  test('projects LCL package summary and falls back to planned carrier authority when unassigned', async () => {
    const customer = await mkCustomer();
    const carrier = await mkCarrierCustomer();
    const shipment = await createShipment({
      customerId: customer.id,
      cargoMode: 'LCL',
      packageCount: 12,
      packageType: 'Pallet',
      shippingLineName: `LCL Line ${suffix}`,
    });
    createdShipmentIds.push(shipment.id);

    await db.insert(s.shipmentFulfillments).values([
      {
        shipmentId: shipment.id,
        fulfillmentType: 'LCL_SHIPMENT',
        cargoMode: 'LCL',
        dispatchClassification: 'LCL',
        sourceShipmentVersion: shipment.version,
        siteSnapshot: {},
        plannedCarrierType: 'EXTERNAL',
        plannedExternalCarrierId: carrier.id,
      },
      {
        shipmentId: shipment.id,
        fulfillmentType: 'LCL_SHIPMENT',
        cargoMode: 'LCL',
        dispatchClassification: 'LCL',
        sourceShipmentVersion: shipment.version,
        siteSnapshot: {},
        plannedCarrierType: 'OWN',
        canceledAt: new Date('2026-08-04T09:00:00Z'),
      },
    ]);

    const result = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 20 });
    const row = result.items.find((item) => item.id === shipment.id);
    assert.ok(row);
    assert.equal(row!.cargoSummary, '12 Pallet');
    assert.equal(row!.shippingLineSummary, `LCL Line ${suffix}`);
    assert.equal(row!.carrierSummary, carrier.name);
    assert.equal(row!.vehiclePlateSummary, null);
  });

  test('returns every shipment regardless of assignment — projections stay deduplicated', async () => {
    const scopedCustomer = await mkCustomer();
    const otherCustomer = await mkCustomer();
    const scopedUnit = await mkBusinessUnit();
    const otherUnit = await mkBusinessUnit();
    const truck = await mkTruck();
    const actor = await mkScopedClerk(scopedCustomer.id, scopedUnit.id);

    const visible = await createShipment({
      customerId: scopedCustomer.id,
      responsibleUnitId: scopedUnit.id,
      cargoMode: 'FCL',
    });
    const hiddenWrongUnit = await createShipment({
      customerId: scopedCustomer.id,
      responsibleUnitId: otherUnit.id,
    });
    const hiddenWrongCustomer = await createShipment({
      customerId: otherCustomer.id,
      responsibleUnitId: scopedUnit.id,
    });
    createdShipmentIds.push(visible.id, hiddenWrongUnit.id, hiddenWrongCustomer.id);

    const visibleContainers = await db.insert(s.shipmentContainers).values([
      { shipmentId: visible.id, containerNumber: `CLERK-${Math.random().toString(36).slice(2, 7)}A` },
      { shipmentId: visible.id, containerNumber: `CLERK-${Math.random().toString(36).slice(2, 7)}B` },
    ]).returning();
    const [firstFulfillment, secondFulfillment] = await db.insert(s.shipmentFulfillments).values([
      {
        shipmentId: visible.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: visibleContainers[0]!.id,
        sourceShipmentVersion: visible.version,
        siteSnapshot: {},
        plannedCarrierType: 'OWN',
      },
      {
        shipmentId: visible.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: visibleContainers[1]!.id,
        sourceShipmentVersion: visible.version,
        siteSnapshot: {},
        plannedCarrierType: 'OWN',
      },
    ]).returning();
    await mkTripForShipment({
      customerId: scopedCustomer.id,
      shipmentId: visible.id,
      fulfillmentId: firstFulfillment.id,
      carrierType: 'OWN',
      truckId: truck.id,
    });
    await mkTripForShipment({
      customerId: scopedCustomer.id,
      shipmentId: visible.id,
      fulfillmentId: secondFulfillment.id,
      carrierType: 'OWN',
      truckId: truck.id,
    });

    const result = await listShipmentsPaginated({ actor, page: 1, limit: 200 });
    const ids = result.items.map((item: { id: number }) => item.id);
    assert.ok(ids.includes(visible.id), 'same-unit shipment is listed');
    assert.ok(ids.includes(hiddenWrongUnit.id), 'other-unit shipment is listed');
    assert.ok(ids.includes(hiddenWrongCustomer.id), 'other-customer shipment is listed');
    // Two fulfillments + two trips on `visible` must not duplicate its row.
    assert.equal(ids.filter((id: number) => id === visible.id).length, 1);
  });

  test('keeps pagination totals and page boundaries stable with multi-row projections', async () => {
    const customer = await mkCustomer();
    const truck = await mkTruck();
    const first = await createShipment({ customerId: customer.id, cargoMode: 'FCL' });
    const second = await createShipment({ customerId: customer.id });
    const third = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(first.id, second.id, third.id);

    const firstContainers = await db.insert(s.shipmentContainers).values([
      { shipmentId: first.id, containerNumber: `PAGE-${Math.random().toString(36).slice(2, 7)}1` },
      { shipmentId: first.id, containerNumber: `PAGE-${Math.random().toString(36).slice(2, 7)}2` },
    ]).returning();
    const fulfillments = await db.insert(s.shipmentFulfillments).values([
      {
        shipmentId: first.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: firstContainers[0]!.id,
        sourceShipmentVersion: first.version,
        siteSnapshot: {},
        plannedCarrierType: 'OWN',
      },
      {
        shipmentId: first.id,
        fulfillmentType: 'FCL_CONTAINER',
        cargoMode: 'FCL',
        shipmentContainerId: firstContainers[1]!.id,
        sourceShipmentVersion: first.version,
        siteSnapshot: {},
        plannedCarrierType: 'OWN',
      },
    ]).returning();
    for (const fulfillment of fulfillments) {
      await mkTripForShipment({
        customerId: customer.id,
        shipmentId: first.id,
        fulfillmentId: fulfillment.id,
        carrierType: 'OWN',
        truckId: truck.id,
      });
    }

    const page1 = await listShipmentsPaginated({ customerId: customer.id, page: 1, limit: 2 });
    const page2 = await listShipmentsPaginated({ customerId: customer.id, page: 2, limit: 2 });

    assert.equal(page1.total, 3);
    assert.equal(page1.items.length, 2);
    assert.equal(new Set(page1.items.map((item) => item.id)).size, page1.items.length);
    assert.equal(page2.total, 3);
    assert.equal(page2.items.length, 1);
    assert.equal(new Set(page2.items.map((item) => item.id)).size, page2.items.length);
    assert.equal(new Set([...page1.items, ...page2.items].map((item) => item.id)).size, 3);
  });
});

describe('listShipmentsPaginated (dispatch master-plan enrichment)', () => {
  async function mkContainerType(code: string, name: string) {
    const [ct] = await db.insert(s.containerTypes).values({ code, name }).returning();
    createdContainerTypeIds.push(ct.id);
    return ct;
  }

  async function mkContainer(
    shipmentId: number,
    containerTypeId: number,
    cargoWeightKg?: string,
    ports?: { pickupPortId: number; dropoffPortId: number },
  ) {
    const [row] = await db.insert(s.shipmentContainers).values({
      shipmentId,
      containerTypeId,
      containerNumber: `MPL-${Math.random().toString(36).slice(2, 9)}`,
      ...(cargoWeightKg != null ? { cargoWeightKg } : {}),
      ...(ports ?? {}),
    }).returning();
    return row;
  }

  async function mkPort(name: string) {
    const [port] = await db.insert(s.ports).values({ name }).returning();
    createdPortIds.push(port.id);
    return port;
  }

  async function mkCarrierFulfillment(
    shipmentId: number,
    shipmentContainerId: number,
    version: number,
    plannedCarrierType: 'OWN' | 'EXTERNAL' = 'OWN',
  ) {
    const [row] = await db.insert(s.shipmentFulfillments).values({
      shipmentId,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      shipmentContainerId,
      sourceShipmentVersion: version,
      siteSnapshot: {},
      plannedCarrierType,
    }).returning();
    return row;
  }

  test('READY_FOR_DISPATCH filter returns enriched rows and excludes PENDING_DATE', async () => {
    const customer = await mkCustomer();
    const tag = Math.random().toString(36).slice(2, 8);
    const ct20 = await mkContainerType(`20DC${tag}`, "20'DC");
    const ct40 = await mkContainerType(`40HC${tag}`, "40'HC");

    const ready = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
    });
    createdShipmentIds.push(ready.id);
    await mkContainer(ready.id, ct20.id, '12000.00');
    await mkContainer(ready.id, ct20.id, '8000.50');
    await mkContainer(ready.id, ct40.id, '21000.25');

    const pending = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(pending.id);

    const result = await listShipmentsPaginated({
      customerId: customer.id,
      status: 'READY_FOR_DISPATCH',
      page: 1,
      limit: 20,
    });

    const ids = result.items.map((row) => row.id);
    assert.ok(ids.includes(ready.id), 'ready shipment is listed');
    assert.ok(!ids.includes(pending.id), 'PENDING_DATE shipment is excluded');

    const row = result.items.find((item) => item.id === ready.id)!;
    assert.equal(row.containerCount20, 2);
    assert.equal(row.containerCount40, 1);
    assert.equal(row.containerTypeSummary, `2 x 20DC${tag} + 1 x 40HC${tag}`);
    assert.equal(row.totalCargoWeightKg, 41000.75);
    assert.equal(row.allocationStatus, 'NOT_ALLOCATED');
    assert.deepEqual(row.carrierAllocationSummary, []);
  });

  test('filters by a container port while returning every distinct per-container port pair', async () => {
    const customer = await mkCustomer();
    const tag = Math.random().toString(36).slice(2, 8);
    const type = await mkContainerType(`40DC${tag}`, "40'DC");
    const dropZonePort = await mkPort(`Cảng Lạch Huyện ${tag}`);
    const dinhVu = await mkPort(`Cảng Đình Vũ ${tag}`);
    const factory = await mkPort(`Nhà máy Bắc Giang ${tag}`);

    const matching = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
      // A legacy lot field must not influence either filter or projection.
      pickupLocation: 'Legacy location must not be displayed',
    });
    const legacyOnly = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
      pickupLocation: dropZonePort.name,
    });
    createdShipmentIds.push(matching.id, legacyOnly.id);

    await mkContainer(matching.id, type.id, undefined, {
      pickupPortId: dinhVu.id,
      dropoffPortId: dropZonePort.id,
    });
    await mkContainer(matching.id, type.id, undefined, {
      pickupPortId: dinhVu.id,
      dropoffPortId: factory.id,
    });

    const result = await listShipmentsPaginated({
      customerId: customer.id,
      portIds: [dropZonePort.id],
      includeDispatchSummary: true,
      page: 1,
      limit: 20,
    });

    assert.deepEqual(result.items.map((row) => row.id), [matching.id]);
    assert.deepEqual(result.items[0]!.containerPortGroups, [
      {
        pickupPortName: dinhVu.name,
        dropoffPortName: dropZonePort.name,
        localDate: null,
        containerSummary: `1 x 40DC${tag}`,
      },
      {
        pickupPortName: dinhVu.name,
        dropoffPortName: factory.name,
        localDate: null,
        containerSummary: `1 x 40DC${tag}`,
      },
    ]);
  });

  test('derives allocationStatus for zero-container, partial, and full allocation', async () => {
    const customer = await mkCustomer();
    const tag = Math.random().toString(36).slice(2, 8);
    const ct20 = await mkContainerType(`20DC${tag}`, "20'DC");
    const ct40 = await mkContainerType(`40HC${tag}`, "40'HC");

    // Zero containers → NOT_ALLOCATED.
    const empty = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
    });
    createdShipmentIds.push(empty.id);

    // Partial: two containers, only one has a planned carrier.
    const partial = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
    });
    createdShipmentIds.push(partial.id);
    const partialContainers = [
      await mkContainer(partial.id, ct40.id),
      await mkContainer(partial.id, ct40.id),
    ];
    await mkCarrierFulfillment(partial.id, partialContainers[0]!.id, partial.version);

    // Full: every container has a live planned carrier.
    const full = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
    });
    createdShipmentIds.push(full.id);
    const fullContainers = [
      await mkContainer(full.id, ct20.id),
      await mkContainer(full.id, ct40.id),
    ];
    await mkCarrierFulfillment(full.id, fullContainers[0]!.id, full.version);
    await mkCarrierFulfillment(full.id, fullContainers[1]!.id, full.version);

    const result = await listShipmentsPaginated({
      customerId: customer.id,
      page: 1,
      limit: 20,
    });
    const statusById = new Map(result.items.map((row) => [row.id, row.allocationStatus]));
    assert.equal(statusById.get(empty.id), 'NOT_ALLOCATED');
    assert.equal(statusById.get(partial.id), 'PARTIALLY_ALLOCATED');
    assert.equal(statusById.get(full.id), 'FULLY_ALLOCATED');

    const fullRow = result.items.find((row) => row.id === full.id)!;
    assert.deepEqual(fullRow.carrierAllocationSummary, [
      { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 1, count40: 1 },
    ]);
  });

  test('deliveryDateFrom/deliveryDateTo bound expectedDeliveryDate inclusively', async () => {
    const customer = await mkCustomer();
    const early = await createShipment({
      customerId: customer.id,
      expectedDeliveryDate: '2026-08-10',
    });
    const mid = await createShipment({
      customerId: customer.id,
      expectedDeliveryDate: '2026-08-15',
    });
    const late = await createShipment({
      customerId: customer.id,
      expectedDeliveryDate: '2026-08-20',
    });
    createdShipmentIds.push(early.id, mid.id, late.id);

    const exactBounds = await listShipmentsPaginated({
      customerId: customer.id,
      deliveryDateFrom: '2026-08-10',
      deliveryDateTo: '2026-08-20',
      page: 1,
      limit: 20,
    });
    assert.deepEqual(
      new Set(exactBounds.items.map((row) => row.id)),
      new Set([early.id, mid.id, late.id]),
      'both boundary dates are included',
    );

    const openFrom = await listShipmentsPaginated({
      customerId: customer.id,
      deliveryDateFrom: '2026-08-11',
      page: 1,
      limit: 20,
    });
    assert.deepEqual(
      new Set(openFrom.items.map((row) => row.id)),
      new Set([mid.id, late.id]),
      'deliveryDateFrom excludes the earlier boundary',
    );

    const openTo = await listShipmentsPaginated({
      customerId: customer.id,
      deliveryDateTo: '2026-08-19',
      page: 1,
      limit: 20,
    });
    assert.deepEqual(
      new Set(openTo.items.map((row) => row.id)),
      new Set([early.id, mid.id]),
      'deliveryDateTo excludes the later boundary',
    );
  });

  // Field-reported bug: the Kế hoạch tổng quát date filter used to match
  // strictly on shipments.expectedDeliveryDate, so FCL shipments whose
  // CUS-set container appointment sat on a different day than the shipment
  // EDD dropped out of the user's range — most visible after CUS had already
  // assigned a carrier (the page would show "Không có lô hàng nào cần phân xe"
  // for a day that did have plated, ready-to-dispatch lots). The filter now
  // includes the per-container customerAppointmentAt with EDD fallback.
  test('deliveryDateFrom/deliveryDateTo also match the per-container appointment date', async () => {
    const customer = await mkCustomer();
    const edd = '2026-08-10';
    const appointmentDay = '2026-08-25';

    const eddInRange = await createShipment({
      customerId: customer.id,
      expectedDeliveryDate: edd,
    });
    // FCL shipment: EDD on Aug-10, container appointment reappointed to
    // Aug-25. The old filter would only match Aug-10; the new filter must
    // also surface this row when the user filters by Aug-25.
    const fclReappointed = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: edd,
    });
    const fclContainer = await mkContainer(fclReappointed.id, (await mkContainerType(`40DC${Math.random().toString(36).slice(2, 6)}`, "40'DC")).id);
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: new Date(`${appointmentDay}T08:00:00+07:00`) })
      .where(eq(s.shipmentContainers.id, fclContainer.id));
    // FCL shipment: no appointment at all — should fall back to the EDD
    // filter the same way the CUS workspace contract does.
    const fclNoAppointment = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: edd,
    });
    await mkContainer(fclNoAppointment.id, (await mkContainerType(`20DC${Math.random().toString(36).slice(2, 6)}`, "20'DC")).id);
    // LCL shipment: no containers, only EDD.
    const lclInRange = await createShipment({
      customerId: customer.id,
      cargoMode: 'LCL',
      expectedDeliveryDate: edd,
    });
    // FCL shipment: EDD and appointment both outside the Aug-25 day — must
    // NOT show up under that filter.
    const fclBothOut = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-10',
    });
    const fclBothOutContainer = await mkContainer(
      fclBothOut.id,
      (await mkContainerType(`40DC${Math.random().toString(36).slice(2, 6)}`, "40'DC")).id,
    );
    await db.update(s.shipmentContainers)
      .set({ customerAppointmentAt: new Date('2026-08-12T08:00:00+07:00') })
      .where(eq(s.shipmentContainers.id, fclBothOutContainer.id));

    createdShipmentIds.push(
      eddInRange.id,
      fclReappointed.id,
      fclNoAppointment.id,
      lclInRange.id,
      fclBothOut.id,
    );

    const aug25 = await listShipmentsPaginated({
      customerId: customer.id,
      deliveryDateFrom: appointmentDay,
      deliveryDateTo: appointmentDay,
      page: 1,
      limit: 20,
    });
    assert.deepEqual(
      new Set(aug25.items.map((row) => row.id)),
      new Set([fclReappointed.id]),
      'FCL reappointed container surfaces the shipment under the appointment day',
    );
    assert.ok(
      !aug25.items.some((row) => row.id === fclBothOut.id),
      'FCL with both EDD and appointment out of range stays out',
    );
  });

  test('allocationStatus filter keeps totals and page boundaries consistent', async () => {
    const customer = await mkCustomer();
    const tag = Math.random().toString(36).slice(2, 8);
    const ct20 = await mkContainerType(`20DC${tag}`, "20'DC");

    const unallocated: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      const shipment = await createShipment({
        customerId: customer.id,
        cargoMode: 'FCL',
        expectedDeliveryDate: '2026-08-15',
      });
      createdShipmentIds.push(shipment.id);
      unallocated.push(shipment.id);
      await mkContainer(shipment.id, ct20.id);
    }

    const allocated = await createShipment({
      customerId: customer.id,
      cargoMode: 'FCL',
      expectedDeliveryDate: '2026-08-15',
    });
    createdShipmentIds.push(allocated.id);
    const container = await mkContainer(allocated.id, ct20.id);
    await mkCarrierFulfillment(allocated.id, container.id, allocated.version);

    const page1 = await listShipmentsPaginated({
      customerId: customer.id,
      allocationStatus: 'NOT_ALLOCATED',
      page: 1,
      limit: 1,
    });
    const page2 = await listShipmentsPaginated({
      customerId: customer.id,
      allocationStatus: 'NOT_ALLOCATED',
      page: 2,
      limit: 1,
    });

    assert.equal(page1.total, 2);
    assert.equal(page1.items.length, 1);
    assert.ok(unallocated.includes(page1.items[0]!.id));
    assert.equal(page2.total, 2);
    assert.equal(page2.items.length, 1);
    assert.ok(unallocated.includes(page2.items[0]!.id));
    assert.notEqual(page1.items[0]!.id, page2.items[0]!.id, 'page 2 is not a repeat of page 1');

    const allocatedOnly = await listShipmentsPaginated({
      customerId: customer.id,
      allocationStatus: 'FULLY_ALLOCATED',
      page: 1,
      limit: 10,
    });
    assert.deepEqual(allocatedOnly.items.map((row) => row.id), [allocated.id]);
    assert.equal(allocatedOnly.total, 1);
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

  test('promotes a pending shipment when its transport date is added', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const updated = await updateShipment(shipment.id, {
      version: shipment.version,
      expectedDeliveryDate: '2026-08-18',
      // BUG 5 wave: the date-driven readiness flip decomposes fulfillments,
      // which requires a concrete acting user.
      updatedBy: 1,
    });

    assert.equal(updated.expectedDeliveryDate, '2026-08-18');
    assert.equal(updated.status, 'READY_FOR_DISPATCH');

    const [handoff] = await db.select({ id: s.dispatchHandoffs.id })
      .from(s.dispatchHandoffs)
      .where(eq(s.dispatchHandoffs.shipmentId, shipment.id));
    assert.ok(handoff, 'a ready shipment has an active dispatch handoff');
  });

  test('persists CUS inline schedule and note edits directly after dispatch', async () => {
    const customer = await mkCustomer();
    const businessUnit = await mkBusinessUnit();
    const actor = await mkScopedClerk(customer.id, businessUnit.id);
    const shipment = await createShipment({
      customerId: customer.id,
      responsibleUnitId: businessUnit.id,
      expectedDeliveryDate: '2026-08-18',
    });
    createdShipmentIds.push(shipment.id);
    const dispatched = await transitionShipmentStatus(shipment.id, 'DISPATCHED');

    const updated = await updateShipment(shipment.id, {
      expectedVersion: dispatched.version,
      expectedDeliveryDate: '2026-08-19',
      closingAt: '2026-08-19T03:30:00.000Z',
      operationalNotes: 'Điều xe vào cổng số 2',
      customerNotes: 'Khách nhận lúc 10 giờ 30',
    }, actor);

    assert.equal(updated.changeMode, 'DIRECT');
    assert.equal(updated.expectedDeliveryDate, '2026-08-19');
    assert.equal(updated.closingAt?.toISOString(), '2026-08-19T03:30:00.000Z');
    assert.equal(updated.operationalNotes, 'Điều xe vào cổng số 2');
    assert.equal(updated.customerNotes, 'Khách nhận lúc 10 giờ 30');
  });

  test('throws 404 for a missing shipment', async () => {
    await assert.rejects(
      () => updateShipment(99_999_999, { version: 1 }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    );
  });

  test('round-trips optional shipment operations fields on update', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const updated = await updateShipment(shipment.id, {
      version: shipment.version,
      tradeDirection: 'EXPORT',
      cargoMode: 'FCL',
      factoryName: `Updated Factory ${suffix}`,
      shippingLineName: `Updated Line ${suffix}`,
      customsCutoffAt: '2026-07-29T05:00:00.000Z',
      closingAt: '2026-07-29T06:30:00.000Z',
      plannedReturnAt: '2026-07-31T04:45:00.000Z',
      cargoWeightKg: 876.54,
      // The closingAt here drives a readiness flip; the decomposition path
      // needs a concrete acting user (BUG 5 wave).
      updatedBy: 1,
      cargoVolumeCbm: 12.345,
      packageCount: 24,
      packageType: 'Carton',
      operationalNotes: 'Updated dossier note',
    });

    assert.equal(updated.tradeDirection, 'EXPORT');
    assert.equal(updated.cargoMode, 'FCL');
    assert.equal(updated.factoryName, `Updated Factory ${suffix}`);
    assert.equal(updated.shippingLineName, `Updated Line ${suffix}`);
    assert.equal(updated.customsCutoffAt?.toISOString(), '2026-07-29T05:00:00.000Z');
    assert.equal(updated.closingAt?.toISOString(), '2026-07-29T06:30:00.000Z');
    assert.equal(updated.plannedReturnAt?.toISOString(), '2026-07-31T04:45:00.000Z');
    assert.equal(Number(updated.cargoWeightKg), 876.54);
    assert.equal(Number(updated.cargoVolumeCbm), 12.345);
    assert.equal(updated.packageCount, 24);
    assert.equal(updated.packageType, 'Carton');
    assert.equal(updated.operationalNotes, 'Updated dossier note');
  });
});

describe('transitionShipmentStatus', () => {
  test('READY_FOR_DISPATCH → DISPATCHED → IN_TRANSIT → COMPLETED writes one history row each (PENDING_EXPENSE_APPROVAL retired 2026-09-05)', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id, closingAt: '2026-08-05T08:00:00.000Z' });
    createdShipmentIds.push(shipment.id);

    const inflight = await transitionShipmentStatus(shipment.id, 'DISPATCHED', {
      reason: 'Bắt đầu vận chuyển',
    });
    assert.equal(inflight.status, 'DISPATCHED');

    const running = await transitionShipmentStatus(shipment.id, 'IN_TRANSIT');
    assert.equal(running.status, 'IN_TRANSIT');

    // IN_TRANSIT now closes directly to COMPLETED (commit 4651f8f2 retired
    // PENDING_EXPENSE_APPROVAL as a new-shipment destination). The retired
    // stage is still kept in LEGAL_TRANSITIONS only so legacy rows parked
    // there can transition out — see shipment-status-transitions.service.ts
    // :50 and the deferred-expense-management comment there.
    const closed = await transitionShipmentStatus(shipment.id, 'COMPLETED');
    assert.equal(closed.status, 'COMPLETED');

    const history = await db.select().from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, shipment.id))
      .orderBy(s.shipmentStatusHistory.id);
    // 1 creation row + 3 transitions = 4
    assert.equal(history.length, 4);
    assert.deepEqual(
      history.map((h) => h.toStatus),
      ['READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED'],
    );
    assert.equal(history[1].reason, 'Bắt đầu vận chuyển');
  });

  test('idempotent same-status returns the row without a new history row', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const result = await transitionShipmentStatus(shipment.id, 'PENDING_DATE');
    assert.equal(result.status, 'PENDING_DATE');

    // Only the creation history row should exist — no duplicate.
    const history = await db.select().from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, shipment.id));
    assert.equal(history.length, 1);
  });

  test('rejects an illegal transition with 409', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    // PENDING_DATE → COMPLETED is not a legal edge (must pass through
    // READY_FOR_DISPATCH → DISPATCHED → IN_TRANSIT first).
    await assert.rejects(
      () => transitionShipmentStatus(shipment.id, 'COMPLETED'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );

    // COMPLETED has no outgoing edges — drive through the retired-then-collapsed
    // path used in the prior test, then attempt to leave COMPLETED.
    const ready = await updateShipment(shipment.id, {
      version: shipment.version,
      closingAt: '2026-08-05T08:00:00.000Z',
      // Readiness flip decomposes fulfillments; needs a concrete actor (BUG 5).
      updatedBy: 1,
    });
    assert.equal(ready.status, 'READY_FOR_DISPATCH');
    await transitionShipmentStatus(shipment.id, 'DISPATCHED');
    await transitionShipmentStatus(shipment.id, 'IN_TRANSIT');
    await transitionShipmentStatus(shipment.id, 'COMPLETED');
    await assert.rejects(
      () => transitionShipmentStatus(shipment.id, 'DISPATCHED'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('throws 404 for a missing shipment', async () => {
    await assert.rejects(
      () => transitionShipmentStatus(99_999_999, 'DISPATCHED'),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 404,
    );
  });
});

describe('softDeleteShipment', () => {
  test('removes a PENDING_DATE shipment by setting deletedAt', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const deleted = await softDeleteShipment(shipment.id, { version: shipment.version });
    assert.ok(deleted.deletedAt);

    // listShipments excludes soft-deleted rows.
    const rows = await listShipments({ customerId: customer.id });
    assert.ok(!rows.some((r) => r.id === shipment.id));
  });

  test('removes a READY_FOR_DISPATCH shipment (carrier allocated, nothing dispatched)', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id, closingAt: '2026-08-05T08:00:00.000Z' });
    createdShipmentIds.push(shipment.id);

    const ready = await transitionShipmentStatus(shipment.id, 'READY_FOR_DISPATCH');
    const deleted = await softDeleteShipment(shipment.id, { version: ready.version });
    assert.ok(deleted.deletedAt);
  });

  test('refuses with 409 while a live trip is linked to the shipment', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    await mkTripForShipment({ customerId: customer.id, shipmentId: shipment.id, status: 'CREATED' });
    await assert.rejects(
      () => softDeleteShipment(shipment.id, { version: shipment.version }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('refuses with 409 when the live trip is linked only through a fulfillment', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
      shipmentId: shipment.id,
      fulfillmentType: 'FCL_CONTAINER',
      cargoMode: 'FCL',
      sourceShipmentVersion: shipment.version,
      siteSnapshot: {},
      plannedCarrierType: 'OWN',
    }).returning();
    const trip = await mkTripForShipment({
      customerId: customer.id,
      shipmentId: shipment.id,
      fulfillmentId: fulfillment.id,
      status: 'IN_TRANSIT',
    });
    // Drop the direct link so the guard must resolve through the fulfillment.
    await db.update(s.trips).set({ shipmentId: null }).where(eq(s.trips.id, trip.id));
    await assert.rejects(
      () => softDeleteShipment(shipment.id, { version: shipment.version }),
      (err: unknown) => err instanceof Error && 'statusCode' in err && err.statusCode === 409,
    );
  });

  test('allows deletion when the only linked trips are CANCELED', async () => {
    const customer = await mkCustomer();
    const shipment = await createShipment({ customerId: customer.id });
    createdShipmentIds.push(shipment.id);

    await mkTripForShipment({ customerId: customer.id, shipmentId: shipment.id, status: 'CANCELED' });
    const deleted = await softDeleteShipment(shipment.id, { version: shipment.version });
    assert.ok(deleted.deletedAt);
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
