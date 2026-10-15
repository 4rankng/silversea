/**
 * FB-092/093/094 — LCL lot grouping service contracts.
 *
 * Pins the group laws end-to-end at the service boundary (DB-backed):
 *   FB-092 cost group: assignment order → Lô 1..N, billing auto-copy from
 *   actual, sourcing rule (xe tải = 100% xe ngoài), and the money jump —
 *   members 2..N's live trip external freight cost drops to 0.
 *   FB-093 rev group: same-customer validation, principal AUTO re-price from
 *   the customer × route × class lane, member zeroing with reason
 *   "Ghép cước cùng Bill X", plus the settlement row projection.
 *   FB-094 debit note + board: the note prints the billing BKS (never the
 *   actual plate) and the accounting board row carries the LCL facts.
 *   FB-095 un-merge safety: a settled group refuses composition changes;
 *   leaving Lô 1 auto-promotes Lô 2 with 100% of the money (both dimensions),
 *   with audit; deleting the principal promotes inside the delete txn.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { upsertTripCarrierInfo, upsertTripFinancialState } from '../services/trip-composite.service';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import { getAccountingDebitBoard } from '../services/accounting-debit-close.service';
import { buildTripRenderData, vehicleTypeLabel } from '../services/billing-document.service';
import type { CustomerDebitTripCandidate } from '../services/billing-document-shared.service';
import {
  assignLclCostGroup,
  mergeLclRevGroup,
  unmergeLclLot,
} from '../services/lcl-grouping.service';
import { softDeleteShipment } from '../services/shipment-lifecycle.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const actor = { userId: 1, role: 'ADMIN', actorName: 'FB092 test' };

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTripIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdAccountingLockIds: number[] = [];
const createdBillingDocIds: number[] = [];

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

describe('LCL grouping — FB-093 rev dimension', () => {
  test('prices the principal AUTO from the class lane, zeroes members with the Bill note (FB-093)', async () => {
    const customer = await mkCustomer('FB093 rev');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB093-R1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB093-R2-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(lot1.id, customer.id, route.id);
    const trip2 = await mkTrip(lot2.id, customer.id, route.id);
    await upsertTripFinancialState(db, trip1.id, { revenue: '1000000' });
    await upsertTripFinancialState(db, trip2.id, { revenue: '700000' });

    const truckClass = await vehicleClassByCode('3.5T');
    const [pricingRow] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: truckClass.id,
      rateKey: truckClass.code,
      price: '3150000',
    }).returning();
    createdPricingTableIds.push(pricingRow.id);

    const result = await mergeLclRevGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
    }, actor);
    assert.equal(result.memberCount, 2);

    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id]));
    for (const row of rows) {
      assert.equal(row.revGroupId, result.groupId);
      assert.equal(row.revVehicleClassId, truckClass.id);
    }

    // Principal = 100% CƯỚC VẬN TẢI (AUTO from the lane); member = 0₫ with
    // the "Ghép cước cùng Bill X" stamp.
    const t1 = await liveTrip(lot1.id);
    const t2 = await liveTrip(lot2.id);
    assert.equal(t1!.revenue, '3150000');
    assert.equal(t2!.revenue, '0');
    assert.equal(t2!.revenueOriginal, '700000');
    assert.equal(t2!.revenueOverrideReason, `Ghép cước cùng Bill ${lot1.blNumber}`);

    const events = await groupAuditEvents(lot1.id);
    assert.ok(events.includes('SHIPMENT_LCL_REV_GROUP_MERGED'));
  });

  test('blocks merging lots of different customers (FB-093)', async () => {
    const customerA = await mkCustomer('FB093 cust A');
    const customerB = await mkCustomer('FB093 cust B');
    const route = await mkRoute();
    const lotA = await mkLclLot(customerA.id, route.id, `FB093-A-${suffix.slice(-6)}`);
    const lotB = await mkLclLot(customerB.id, route.id, `FB093-B-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');
    await assert.rejects(
      mergeLclRevGroup({ shipmentIds: [lotA.id, lotB.id], vehicleSizeClassId: truckClass.id }, actor),
      /cùng một khách hàng/,
    );
  });
});


describe('LCL grouping — FB-093 debit-summary projection', () => {
  test('rows carry cargoMode, both group facts, plates, class codes and the principal ref', async () => {
    const customer = await mkCustomer('FB093 summary');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB093S-1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB093S-2-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-321.65',
    }, actor);
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id }, actor);

    const summary = await getShipmentDebitSummary({ lockStatus: 'ALL' });
    const row1 = summary.items.find((item) => item.shipmentId === lot1.id);
    const row2 = summary.items.find((item) => item.shipmentId === lot2.id);
    assert.ok(row1 && row2, 'both grouped lots are on the board');
    for (const row of [row1, row2]) {
      assert.equal(row.cargoMode, 'LCL');
      assert.equal(row.actualTruckNo, '29C-321.65');
      assert.equal(row.billingTruckNo, '29C-321.65');
      assert.equal(row.costVehicleClassCode, '5T');
      assert.equal(row.revVehicleClassCode, '5T');
      assert.equal(row.costGroupMemberCount, 2);
      assert.equal(row.revGroupMemberCount, 2);
    }
    // The principal cites nobody; the member cites the principal's Bill.
    assert.equal(row1.revGroupOrder, 1);
    assert.equal(row1.revGroupPrincipalRef, null);
    assert.equal(row2.revGroupOrder, 2);
    assert.equal(row2.revGroupPrincipalRef, lot1.blNumber);
  });
});

describe('LCL grouping — FB-094 debit note + board', () => {
  test('the debit note prints billing_truck_no, never the actual plate', async () => {
    // Pure render rule (FB-094's absolute law): billing wins over both the
    // internal plate and the external carrier plate.
    const renderData = buildTripRenderData({
      trip: {
        tripCode: 'TC-1',
        departureDate: '2026-10-20',
        routeName: null,
        notes: null,
        truckPlate: '30A-111.22',
        externalPlateNumber: '29C-333.44',
        billingTruckNo: '30C-999.88',
      },
      containers: [],
    });
    assert.equal(renderData.truckPlate, '30C-999.88');
    // Without a billing BKS the historical precedence stands.
    const fallback = buildTripRenderData({
      trip: {
        tripCode: 'TC-1', departureDate: '2026-10-20', routeName: null, notes: null,
        truckPlate: '30A-111.22', externalPlateNumber: '29C-333.44', billingTruckNo: null,
      },
      containers: [],
    });
    assert.equal(fallback.truckPlate, '30A-111.22');
  });

  test('the debit note names the thu billing class as loại xe (FB094-01b)', async () => {
    // Pure label rule: an LCL row with a rev billing class prints that class
    // (name preferred, code fallback); a lot without one keeps 'LCL'.
    const candidate = {
      id: 1, tripCode: 'TC-1', customerId: 1, shipmentId: 1, fulfillmentId: null,
      status: 'COMPLETED', departureDate: '2026-10-20', completionDate: '2026-10-21',
      revenue: null, fuelSurchargeAmount: null, routeName: null, notes: null,
      truckPlate: null, trailerPlateNumber: null, externalPlateNumber: null,
      billingTruckNo: null,
      revVehicleClassName: 'Xe 3.5 tấn', revVehicleClassCode: '3.5T',
      version: 1, vatRate: '0', updatedAt: new Date(),
      financialPostingId: 1, financialPostingVersion: 1, financialPostingTripVersion: 1,
      financialPostingReason: 'COMPLETION', financialPostingEffectiveAt: new Date(),
      shipmentCustomerId: 1, tradeDirection: 'IMPORT', billNumber: 'BL-1',
      factoryName: null, expectedDeliveryDate: '2026-10-21',
      cargoVolumeCbm: '4', packageCount: 5, packageType: 'PALLET',
    } as const satisfies CustomerDebitTripCandidate;
    assert.equal(vehicleTypeLabel(candidate, []), 'Xe 3.5 tấn');
    assert.equal(vehicleTypeLabel({ ...candidate, revVehicleClassName: null }, []), '3.5T');
    assert.equal(vehicleTypeLabel({
      ...candidate, revVehicleClassName: null, revVehicleClassCode: null,
    }, []), 'LCL');
  });

  test('the accounting debit board carries the LCL label, plates and principal ref', async () => {
    const customer = await mkCustomer('FB094 board');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB094-1-${suffix.slice(-6)}`, { expectedDeliveryDate: '2026-10-21' });
    const lot2 = await mkLclLot(customer.id, route.id, `FB094-2-${suffix.slice(-6)}`, { expectedDeliveryDate: '2026-10-21' });
    const truckClass = await vehicleClassByCode('5T');
    const contClass = await vehicleClassByCode('CONT20');
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: contClass.id,
      actualTruckNo: '31B-456.78',
      billingTruckNo: '35C-000.01',
    }, actor);
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id }, actor);

    const board = await getAccountingDebitBoard({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    const member = board.items.find((row) => row.shipmentId === lot2.id);
    assert.ok(member, 'the grouped member is on the board');
    assert.ok(member.lcl, 'the LCL facts ride the row');
    assert.equal(member.lcl!.label, 'Lẻ · Thu: 5T · Trả: CONT20');
    assert.equal(member.lcl!.actualTruckNo, '31B-456.78');
    assert.equal(member.lcl!.billingTruckNo, '35C-000.01');
    assert.equal(member.lcl!.ghépCùngRef, lot1.blNumber);

    const principal = board.items.find((row) => row.shipmentId === lot1.id);
    assert.ok(principal?.lcl);
    assert.equal(principal.lcl!.ghépCùngRef, null, 'the principal cites nobody');
  });
});

describe('LCL grouping — FB-095 un-merge safety', () => {
  async function mkAccountingLock(shipmentId: number, shipmentVersion: number, customerId: number) {
    const [doc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customerId,
      entityName: `FB095 lock doc ${suffix}`,
      rangeFrom: '2026-10-01',
      rangeTo: '2026-10-31',
      totalInclVat: '0',
    }).returning();
    createdBillingDocIds.push(doc.id);
    const [lock] = await db.insert(s.shipmentAccountingLocks).values({
      shipmentId,
      billingDocumentId: doc.id,
      billingDocumentVersion: 1,
      billingPeriodSnapshot: {
        rangeFrom: '2026-10-01',
        rangeTo: '2026-10-31',
        issuedAt: '2026-10-31T00:00:00.000Z',
      },
      shipmentVersionAtLock: shipmentVersion,
      reason: 'FB095 settled-group guard fixture',
      activatedBy: actor.userId,
    }).returning();
    createdAccountingLockIds.push(lock.id);
    return lock;
  }

  test('un-merging Lô 1 (COST) promotes Lô 2 with 100% of the freight (FB095-01)', async () => {
    const customer = await mkCustomer('FB095 cost');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-C1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-C2-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `FB095-C3-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(lot1.id, customer.id, route.id);
    const trip2 = await mkTrip(lot2.id, customer.id, route.id);
    const trip3 = await mkTrip(lot3.id, customer.id, route.id);
    await upsertTripCarrierInfo(db, trip1.id, { carrierType: 'EXTERNAL', externalFreightCost: '2400000' });
    await upsertTripCarrierInfo(db, trip2.id, { carrierType: 'EXTERNAL', externalFreightCost: '800000' });
    await upsertTripCarrierInfo(db, trip3.id, { carrierType: 'EXTERNAL', externalFreightCost: '600000' });
    const truckClass = await vehicleClassByCode('5T');
    const group = await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-777.77',
    }, actor);

    const result = await unmergeLclLot({ shipmentId: lot1.id, dimension: 'COST' }, actor);
    assert.equal(result.promoted!.shipmentId, lot2.id);
    assert.equal(result.transferredAmount, '2400000');
    assert.equal(result.dissolved, false);
    assert.deepEqual(result.remaining.map((m) => [m.shipmentId, m.order]), [[lot2.id, 1], [lot3.id, 2]]);

    // The freight followed the crown; it never fell to 0₫.
    const t1 = await liveTrip(lot1.id);
    const t2 = await liveTrip(lot2.id);
    assert.equal(t1!.externalFreightCost, '0');
    assert.equal(t2!.externalFreightCost, '2400000');

    // Row facts: leaver ungrouped; survivors renumbered under the same group.
    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id, lot3.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(lot1.id)!.costGroupId, null);
    assert.equal(byId.get(lot2.id)!.costGroupId, group.groupId);
    assert.equal(byId.get(lot2.id)!.costGroupOrder, 1);
    assert.equal(byId.get(lot3.id)!.costGroupOrder, 2);

    const events = await groupAuditEvents(lot1.id);
    assert.ok(events.includes('SHIPMENT_LCL_GROUP_UNMERGED'));
  });

  test('un-merging Lô 1 (REV) transfers the bill money and dissolves a 2-lot group (FB095-02)', async () => {
    const customer = await mkCustomer('FB095 rev');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-R1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-R2-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(lot1.id, customer.id, route.id);
    const trip2 = await mkTrip(lot2.id, customer.id, route.id);
    await upsertTripFinancialState(db, trip1.id, { revenue: '3150000' });
    await upsertTripFinancialState(db, trip2.id, { revenue: '700000' });
    const truckClass = await vehicleClassByCode('3.5T');
    const [pricingRow] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: truckClass.id,
      rateKey: truckClass.code,
      price: '3150000',
    }).returning();
    createdPricingTableIds.push(pricingRow.id);
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id }, actor);

    const result = await unmergeLclLot({ shipmentId: lot1.id, dimension: 'REV' }, actor);
    assert.equal(result.promoted!.shipmentId, lot2.id);
    assert.equal(result.transferredAmount, '3150000');
    assert.equal(result.dissolved, true, 'a lone survivor is not a group');
    assert.deepEqual(result.remaining, []);

    const t1 = await liveTrip(lot1.id);
    const t2 = await liveTrip(lot2.id);
    assert.equal(t1!.revenue, '0');
    assert.equal(t2!.revenue, '3150000');
    assert.match(t2!.revenueOverrideReason!, /Đón cước chính khi tách nhóm/);
    assert.match(t1!.revenueOverrideReason!, /chuyển 100% cước/);

    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id]));
    for (const row of rows) {
      assert.equal(row.revGroupId, null, 'the group dissolved');
    }
  });

  test('a settled group refuses un-merge — an active accounting lock freezes it (FB095-03)', async () => {
    const customer = await mkCustomer('FB095 settled');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-S1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-S2-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(lot1.id, customer.id, route.id);
    await upsertTripCarrierInfo(db, trip1.id, { carrierType: 'EXTERNAL', externalFreightCost: '1500000' });
    const truckClass = await vehicleClassByCode('5T');
    const group = await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-666.66',
    }, actor);
    // The MEMBER (not even the leaver) is settled — the whole group freezes.
    await mkAccountingLock(lot2.id, (await db.select().from(s.shipments).where(eq(s.shipments.id, lot2.id)))[0]!.version, customer.id);

    await assert.rejects(
      unmergeLclLot({ shipmentId: lot1.id, dimension: 'COST' }, actor),
      /đã chốt kế toán/,
    );

    // Nothing changed: money, membership and ordering all still read grouped.
    const t1 = await liveTrip(lot1.id);
    assert.equal(t1!.externalFreightCost, '1500000');
    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id]));
    for (const row of rows) {
      assert.equal(row.costGroupId, group.groupId);
      assert.equal(row.costGroupOrder, row.id === lot1.id ? 1 : 2);
    }
  });

  test('a member leaving moves no money; renumbering + REV zero re-stamp apply (FB095-04)', async () => {
    const customer = await mkCustomer('FB095 member');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-M1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-M2-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `FB095-M3-${suffix.slice(-6)}`);
    for (const lot of [lot1, lot2, lot3]) {
      await mkTrip(lot.id, customer.id, route.id);
    }
    const t2 = await liveTrip(lot2.id);
    await upsertTripCarrierInfo(db, t2!.tripId, { carrierType: 'EXTERNAL', externalFreightCost: '800000' });
    await upsertTripFinancialState(db, t2!.tripId, { revenue: '700000' });
    const truckClass = await vehicleClassByCode('5T');
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-555.55',
    }, actor);
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id, lot3.id], vehicleSizeClassId: truckClass.id }, actor);

    const result = await unmergeLclLot({ shipmentId: lot2.id, dimension: 'COST' }, actor);
    assert.equal(result.promoted, null);
    assert.equal(result.transferredAmount, null);
    assert.deepEqual(result.remaining.map((m) => [m.shipmentId, m.order]), [[lot1.id, 1], [lot3.id, 2]]);
    const after2 = await liveTrip(lot2.id);
    assert.equal(after2!.externalFreightCost, '0', 'member cost stays zero');

    // REV member exit: the stale "Ghép cùng Bill X" stamp becomes current.
    const revResult = await unmergeLclLot({ shipmentId: lot2.id, dimension: 'REV' }, actor);
    assert.equal(revResult.promoted, null);
    const revAfter = await liveTrip(lot2.id);
    assert.equal(revAfter!.revenue, '0');
    assert.equal(revAfter!.revenueOverrideReason, 'Tách khỏi nhóm ghép — chờ định giá lại');
  });

  test('refuses to orphan the freight: promotee without a live trip blocks Lô 1 exit (FB095-05)', async () => {
    const customer = await mkCustomer('FB095 orphan');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-O1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-O2-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(lot1.id, customer.id, route.id);
    await upsertTripCarrierInfo(db, trip1.id, { carrierType: 'EXTERNAL', externalFreightCost: '2000000' });
    const truckClass = await vehicleClassByCode('5T');
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-444.44',
    }, actor);

    await assert.rejects(
      unmergeLclLot({ shipmentId: lot1.id, dimension: 'COST' }, actor),
      /chưa có chuyến live để giữ cước/,
    );
    const t1 = await liveTrip(lot1.id);
    assert.equal(t1!.externalFreightCost, '2000000', 'the money stayed on the principal');
  });

  test('deleting Lô 1 promotes the survivor inside the delete transaction (FB095-06)', async () => {
    const customer = await mkCustomer('FB095 delete');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-D1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-D2-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');
    // No trips at all — the delete boundary requires that.
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-333.33',
    }, actor);

    const [fresh1] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot1.id));
    await softDeleteShipment(lot1.id, { version: fresh1.version, deletedBy: actor.userId, actor });

    // The survivor was NOT left pointing at a headless group: with one member
    // left, the group dissolved and lot2 stands alone.
    const [after2] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot2.id));
    assert.equal(after2.costGroupId, null);
    assert.equal(after2.costGroupOrder, null);
    assert.equal(after2.deletedAt, null, 'the survivor lives on');
    const events = await groupAuditEvents(lot1.id);
    assert.ok(events.includes('SHIPMENT_LCL_GROUP_UNMERGED'), 'the promotion is audited');
  });
});

after(async () => {
  // Trips first (FKs), then carrier/financial sidecars ride the trip delete,
  // then shipments, pricing tables, routes, customers.
  if (createdAccountingLockIds.length > 0) {
    await db.delete(s.shipmentAccountingLocks).where(inArray(s.shipmentAccountingLocks.id, createdAccountingLockIds));
  }
  if (createdBillingDocIds.length > 0) {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, createdBillingDocIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdBillingDocIds));
  }
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
