/**
 * FB-092 — LCL lot grouping service contracts (COST dimension).
 *
 * Pins the cost group laws end-to-end at the service boundary (DB-backed):
 * assignment order → Lô 1..N, billing auto-copy from actual, the sourcing
 * rule (xe tải = 100% xe ngoài), and the money jump — members 2..N's live
 * trip external freight cost drops to 0.
 *
 * The rev dimension (FB-093), the debit note/board (FB-094) and the
 * promote-on-unmerge safety (FB-095) add their cases to this same file.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { upsertTripCarrierInfo } from '../services/trip-composite.service';
import { assignLclCostGroup } from '../services/lcl-grouping.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const actor = { userId: 1, role: 'ADMIN', actorName: 'FB092 test' };

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTripIds: number[] = [];
const createdPricingTableIds: number[] = [];

async function mkCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({ name: `FB092 route ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkLclLot(customerId: number, routeId: number, ref: string, extra: Partial<typeof s.shipments.$inferInsert> = {}) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    blNumber: ref,
    tradeDirection: 'IMPORT',
    cargoMode: 'LCL',
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: '2026-10-20',
    routeId,
    packageCount: 5,
    packageType: 'PALLET',
    cargoWeightKg: '1922.00',
    cargoVolumeCbm: '4.000',
    ...extra,
  }).returning();
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function mkTrip(shipmentId: number, customerId: number, routeId: number) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `FB092-${suffix.slice(-6)}-${createdTripIds.length + 1}-${shipmentId}`,
    customerId,
    routeId,
    departureDate: '2026-10-20',
    shipmentId,
    status: 'CREATED',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function vehicleClassByCode(code: string) {
  const [vehicleClass] = await db.select().from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, code)).limit(1);
  assert.ok(vehicleClass, `seeded vehicle class ${code} exists`);
  return vehicleClass;
}

async function liveTrip(shipmentId: number) {
  const [row] = await db.select({
    tripId: s.trips.id,
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
    revenue: s.tripFinancialState.revenue,
    revenueOriginal: s.tripFinancialState.revenueOriginal,
    revenueOverrideReason: s.tripFinancialState.revenueOverrideReason,
  }).from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(and(eq(s.trips.shipmentId, shipmentId), isNull(s.trips.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function groupAuditEvents(shipmentId: number) {
  const rows = await db.select({ payload: s.auditLogs.payload }).from(s.auditLogs)
    .where(and(eq(s.auditLogs.entityType, 'shipment'), eq(s.auditLogs.entityId, shipmentId)));
  return rows.map((row) => (row.payload as Record<string, unknown>).event as string);
}

describe('LCL grouping — FB-092 cost dimension', () => {
  test('assigns order 1..N, auto-copies billing BKS, and zeroes members 2..N freight (FB092-03/05)', async () => {
    const customer = await mkCustomer('FB092 cost');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB092-C1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB092-C2-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `FB092-C3-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(lot1.id, customer.id, route.id);
    const trip2 = await mkTrip(lot2.id, customer.id, route.id);
    const trip3 = await mkTrip(lot3.id, customer.id, route.id);
    await upsertTripCarrierInfo(db, trip1.id, { carrierType: 'EXTERNAL', externalFreightCost: '2400000' });
    await upsertTripCarrierInfo(db, trip2.id, { carrierType: 'EXTERNAL', externalFreightCost: '800000' });
    await upsertTripCarrierInfo(db, trip3.id, { carrierType: 'EXTERNAL', externalFreightCost: '600000' });

    const truckClass = await vehicleClassByCode('5T');
    const result = await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-123.45',
    }, actor);

    assert.equal(result.memberCount, 3);
    assert.deepEqual(result.members.map((member) => member.order), [1, 2, 3]);

    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id, lot3.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(lot1.id)!.costGroupOrder, 1);
    assert.equal(byId.get(lot2.id)!.costGroupOrder, 2);
    assert.equal(byId.get(lot3.id)!.costGroupOrder, 3);
    for (const row of rows) {
      assert.equal(row.costGroupId, result.groupId);
      assert.equal(row.costVehicleClassId, truckClass.id);
      assert.equal(row.actualTruckNo, '29C-123.45');
      // Billing auto-copies the actual BKS when the popup sends none.
      assert.equal(row.billingTruckNo, '29C-123.45');
    }

    // Money jump: principal keeps 100%; members' freight drops to 0₫.
    const t1 = await liveTrip(lot1.id);
    const t2 = await liveTrip(lot2.id);
    const t3 = await liveTrip(lot3.id);
    assert.equal(t1!.externalFreightCost, '2400000');
    assert.equal(t2!.externalFreightCost, '0');
    assert.equal(t3!.externalFreightCost, '0');

    const events = await groupAuditEvents(lot1.id);
    assert.ok(events.includes('SHIPMENT_LCL_COST_GROUP_ASSIGNED'));
  });

  test('blocks an internal-fleet BKS on a truck-tonnage class, allows it on a container class (FB092-04)', async () => {
    const customer = await mkCustomer('FB092 sourcing');
    const route = await mkRoute();
    const [internalTruck] = await db.insert(s.trucks).values({
      licensePlate: `31B-${suffix.slice(-4)}.99`,
    }).returning();
    try {
      const lot1 = await mkLclLot(customer.id, route.id, `FB092-S1-${suffix.slice(-6)}`);
      const lot2 = await mkLclLot(customer.id, route.id, `FB092-S2-${suffix.slice(-6)}`);
      const truckClass = await vehicleClassByCode('5T');
      await assert.rejects(
        assignLclCostGroup({
          shipmentIds: [lot1.id, lot2.id],
          vehicleSizeClassId: truckClass.id,
          actualTruckNo: internalTruck.licensePlate,
        }, actor),
        /100% xe ngoài/,
      );

      // CONT20 is internal-or-external: the same plate is accepted.
      const contClass = await vehicleClassByCode('CONT20');
      const result = await assignLclCostGroup({
        shipmentIds: [lot1.id, lot2.id],
        vehicleSizeClassId: contClass.id,
        actualTruckNo: internalTruck.licensePlate,
      }, actor);
      assert.equal(result.memberCount, 2);
    } finally {
      await db.delete(s.trucks).where(eq(s.trucks.id, internalTruck.id));
    }
  });

  test('rejects mixed-cargo groups, single-lot groups and re-grouping without un-merge (FB092-06)', async () => {
    const customer = await mkCustomer('FB092 guards');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB092-G1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB092-G2-${suffix.slice(-6)}`);
    const [fclLot] = await db.insert(s.shipments).values({
      customerId: customer.id,
      blNumber: `FB092-GF-${suffix.slice(-6)}`,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH',
      expectedDeliveryDate: '2026-10-20',
      routeId: route.id,
    }).returning();
    createdShipmentIds.push(fclLot.id);

    const truckClass = await vehicleClassByCode('5T');
    await assert.rejects(
      assignLclCostGroup({ shipmentIds: [lot1.id, fclLot.id], vehicleSizeClassId: truckClass.id, actualTruckNo: '29C-999.88' }, actor),
      /không phải hàng lẻ/,
    );
    await assert.rejects(
      assignLclCostGroup({ shipmentIds: [lot1.id], vehicleSizeClassId: truckClass.id, actualTruckNo: '29C-999.88' }, actor),
      /ít nhất 2 lô/,
    );

    await assignLclCostGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id, actualTruckNo: '29C-888.77' }, actor);
    await assert.rejects(
      assignLclCostGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id, actualTruckNo: '29C-888.77' }, actor),
      /đã thuộc nhóm ghép/,
    );
  });
});

after(async () => {
  // Trips first (FKs), then carrier/financial sidecars ride the trip delete,
  // then shipments, pricing tables, routes, customers.
  if (createdTripIds.length > 0) {
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdPricingTableIds.length > 0) {
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
  }
  if (createdShipmentIds.length > 0) {
    await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
});
