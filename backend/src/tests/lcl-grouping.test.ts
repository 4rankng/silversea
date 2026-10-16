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
 *   F-2 (card 161026113900, ruling b): both money boards read the
 *   trip_financial_state.revenue override channel for REV-grouped or
 *   override-stamped lots — merged 100%/0₫ lands on the money columns while
 *   ungrouped lots keep the freight-snapshot grain byte-for-byte.
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
  unmergeLclGroup,
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
const createdFreightSnapshotIds: number[] = [];
const createdFulfillmentIds: number[] = [];

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

/** F-2 — a per-trip freight-rate snapshot (the boards' historical channel),
 * split freight vs surcharge so the phuPs contract is assertable. */
async function mkFreightSnapshot(shipmentId: number, tripId: number, freight: string, surcharge = '0') {
  const [row] = await db.insert(s.freightRateSnapshots).values({
    shipmentId,
    tripId,
    freightAmount: freight, surchargeAmount: surcharge,
    totalAmount: String(Number(freight) + Number(surcharge)),
    rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
    billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
  }).returning();
  createdFreightSnapshotIds.push(row.id);
  return row;
}

/** F-2 — a board-visible trip: the money boards count per-trip money only
 * for fulfillment-linked live trips (card 20260924_2 shadow rule), so the
 * F-2 fixtures ride an LCL fulfillment exactly like dispatched production
 * lots do. */
async function mkBoardTrip(shipmentId: number, customerId: number, routeId: number) {
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: 1,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  const trip = await mkTrip(shipmentId, customerId, routeId);
  await db.update(s.trips).set({ fulfillmentId: fulfillment.id }).where(eq(s.trips.id, trip.id));
  return { ...trip, fulfillmentId: fulfillment.id };
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

async function latestSnapshot(shipmentId: number) {
  const rows = await db.select({ totalAmount: s.freightRateSnapshots.totalAmount })
    .from(s.freightRateSnapshots)
    .where(and(eq(s.freightRateSnapshots.shipmentId, shipmentId), isNull(s.freightRateSnapshots.tripId)))
    .orderBy(s.freightRateSnapshots.id);
  const row = rows.at(-1);
  return row ? Number(row.totalAmount) : null;
}

async function groupAuditPayloads(shipmentId: number) {
  const rows = await db.select({ payload: s.auditLogs.payload }).from(s.auditLogs)
    .where(and(eq(s.auditLogs.entityType, 'shipment'), eq(s.auditLogs.entityId, shipmentId)));
  return rows.map((row) => row.payload as Record<string, unknown>);
}

async function groupAuditEvents(shipmentId: number) {
  return (await groupAuditPayloads(shipmentId)).map((payload) => payload.event as string);
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

  test('blocks merging lots of different customers with clear error naming the conflict and changes nothing (GAP 2, spec line 66)', async () => {
    const customerA = await mkCustomer('GAP2 cust A');
    const customerB = await mkCustomer('GAP2 cust B');
    const route = await mkRoute();
    const lotA = await mkLclLot(customerA.id, route.id, `GAP2-A-${suffix.slice(-6)}`);
    const lotB = await mkLclLot(customerB.id, route.id, `GAP2-B-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');

    const [beforeA] = await db.select().from(s.shipments).where(eq(s.shipments.id, lotA.id));
    const [beforeB] = await db.select().from(s.shipments).where(eq(s.shipments.id, lotB.id));

    await assert.rejects(
      mergeLclRevGroup({ shipmentIds: [lotA.id, lotB.id], vehicleSizeClassId: truckClass.id }, actor),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'is an Error');
        assert.match(err.message, /CÙNG 1 KHÁCH HÀNG/);
        assert.match(err.message, /xung đột/);
        assert.ok(err.message.includes(lotA.blNumber!), 'names lot A');
        assert.ok(err.message.includes(lotB.blNumber!), 'names lot B');
        assert.ok(err.message.includes(customerA.name), 'names customer A');
        assert.ok(err.message.includes(customerB.name), 'names customer B');
        return true;
      },
    );

    // Assert database state is completely unchanged:
    const [afterA] = await db.select().from(s.shipments).where(eq(s.shipments.id, lotA.id));
    const [afterB] = await db.select().from(s.shipments).where(eq(s.shipments.id, lotB.id));
    assert.equal(afterA.revGroupId, null, 'lotA revGroupId remains null');
    assert.equal(afterA.revGroupOrder, null, 'lotA revGroupOrder remains null');
    assert.equal(afterA.revVehicleClassId, null, 'lotA revVehicleClassId remains null');
    assert.equal(afterA.version, beforeA.version, 'lotA version unchanged');

    assert.equal(afterB.revGroupId, null, 'lotB revGroupId remains null');
    assert.equal(afterB.revGroupOrder, null, 'lotB revGroupOrder remains null');
    assert.equal(afterB.revVehicleClassId, null, 'lotB revVehicleClassId remains null');
    assert.equal(afterB.version, beforeB.version, 'lotB version unchanged');

    const snapA = await latestSnapshot(lotA.id);
    const snapB = await latestSnapshot(lotB.id);
    assert.equal(snapA, null, 'no snapshot created for lotA');
    assert.equal(snapB, null, 'no snapshot created for lotB');

    const eventsA = await groupAuditEvents(lotA.id);
    const eventsB = await groupAuditEvents(lotB.id);
    assert.equal(eventsA.length, 0, 'no audit events for lotA');
    assert.equal(eventsB.length, 0, 'no audit events for lotB');
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

describe('F-2 (card 161026113900) — money boards read the override channel (ruling b)', () => {
  // FB-093 writes the 100%/0₫ jump to trip_financial_state.revenue; the
  // boards' cước-thu columns must read that channel for REV-grouped or
  // override-stamped lots (owner ruling option (b)), while everything else
  // keeps the freight-snapshot grain byte-for-byte.
  async function seedMergedPair(label: string) {
    const customer = await mkCustomer(`F2 ${label}`);
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `F2-${label}1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `F2-${label}2-${suffix.slice(-6)}`);
    const trip1 = await mkBoardTrip(lot1.id, customer.id, route.id);
    const trip2 = await mkBoardTrip(lot2.id, customer.id, route.id);
    // Each lot's OWN auto freight on the snapshot channel — the stale money
    // the defect kept showing after a merge.
    await mkFreightSnapshot(lot1.id, trip1.id, '1200000', '50000');
    await mkFreightSnapshot(lot2.id, trip2.id, '900000', '30000');
    await upsertTripFinancialState(db, trip1.id, { revenue: '1200000' });
    await upsertTripFinancialState(db, trip2.id, { revenue: '900000' });
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
    return { customer, lot1, lot2, lanePrice: '3150000' };
  }

  test('CUS board: principal reads the lane price, member 0₫ + reason note (F2-01)', async () => {
    const { customer, lot1, lot2, lanePrice } = await seedMergedPair('a');
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const principal = summary.items.find((row) => row.shipmentId === lot1.id)!;
    const member = summary.items.find((row) => row.shipmentId === lot2.id)!;
    // The override channel wins over each lot's own snapshot freight.
    assert.equal(principal.freightAuto, lanePrice, 'principal = 100% (lane price, not its own 1.250.000 snapshot)');
    assert.equal(member.freightAuto, '0', 'member = 0₫ (not its own 930.000 snapshot)');
    assert.equal(member.freightOverrideReason, `Ghép cước cùng Bill ${lot1.blNumber}`);
    assert.equal(principal.freightOverrideReason, null, 'the un-marked principal carries no note');
    // Spec §3.2: chỉ Cước vận tải = 0 — the receivable addend follows the
    // effective freight (0 freight still reads as a known 0, not null).
    assert.equal(member.receivableTotal, '0');
    assert.equal(principal.receivableTotal, lanePrice);
    // No chi-hộ rows exist ⇒ chi hộ unknown ⇒ profit null (PRD null law),
    // even though chiHoTotal renders a truthful '0' because trips exist.
    assert.equal(member.profit, null);
    assert.equal(principal.profit, null);
  });

  test('accounting board: thu.cuocThu follows the group law, phuPs stays snapshot (F2-02)', async () => {
    const { customer, lot1, lot2, lanePrice } = await seedMergedPair('b');
    const board = await getAccountingDebitBoard({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    const principal = board.items.find((row) => row.shipmentId === lot1.id && row.customerId === customer.id)!;
    const member = board.items.find((row) => row.shipmentId === lot2.id && row.customerId === customer.id)!;
    assert.equal(principal.thu.cuocThu, lanePrice, 'Lô 1 hiện 100% tiền cước nhóm');
    assert.equal(member.thu.cuocThu, '0', 'lô phụ hiện 0 ₫');
    // Phụ ps reads the snapshot surcharge channel — the merge owns only the
    // freight/revenue figure (spec: chỉ phần Cước vận tải = 0).
    assert.equal(principal.thu.phuPs, '50000');
    assert.equal(member.thu.phuPs, '30000');
    assert.equal(principal.thu.tongThu, '3200000', 'tổng thu = effective freight + phu ps');
    assert.equal(member.thu.tongThu, '30000');
  });

  test('un-merge keeps both boards on the override channel via the stamp (F2-03)', async () => {
    const { customer, lot1, lot2, lanePrice } = await seedMergedPair('c');
    await unmergeLclLot({ shipmentId: lot1.id, dimension: 'REV' }, actor);

    // FB-095 transferred the bill money to lot2 and the group dissolved —
    // the survivor is UNGROUPED, so only its override stamp keeps the boards
    // on the channel where the money actually moved.
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const leaver = summary.items.find((row) => row.shipmentId === lot1.id)!;
    const survivor = summary.items.find((row) => row.shipmentId === lot2.id)!;
    assert.equal(survivor.freightAuto, lanePrice, 'the promoted survivor keeps 100% of the bill money');
    assert.equal(leaver.freightAuto, '0', 'the leaver reads its stamped 0₫, not its old snapshot');
    assert.equal(leaver.freightOverrideReason, `Tách nhóm — chuyển 100% cước cho Bill ${lot2.blNumber}`);

    const board = await getAccountingDebitBoard({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    const boardLeaver = board.items.find((row) => row.shipmentId === lot1.id && row.customerId === customer.id)!;
    const boardSurvivor = board.items.find((row) => row.shipmentId === lot2.id && row.customerId === customer.id)!;
    assert.equal(boardSurvivor.thu.cuocThu, lanePrice);
    assert.equal(boardLeaver.thu.cuocThu, '0');
  });

  test('ungrouped, un-overridden lots keep the snapshot channel byte-for-byte (F2-04)', async () => {
    const customer = await mkCustomer('F2 control');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `F2-CTL-${suffix.slice(-6)}`);
    const trip = await mkBoardTrip(lot.id, customer.id, route.id);
    await mkFreightSnapshot(lot.id, trip.id, '1234000', '60000');
    // Trip revenue DELIBERATELY differs from the snapshot total — the lot is
    // ungrouped and unstamped, so the assertion below proves the snapshot
    // wins (a broken always-override precedence would read 999000).
    await upsertTripFinancialState(db, trip.id, { revenue: '999000' });

    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const row = summary.items.find((item) => item.shipmentId === lot.id)!;
    assert.equal(row.freightAuto, '1294000', 'no group + no stamp ⇒ snapshot total (freight + surcharge)');
    assert.equal(row.freightOverrideReason, null);
    const board = await getAccountingDebitBoard({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    const boardRow = board.items.find((item) => item.shipmentId === lot.id && item.customerId === customer.id)!;
    assert.equal(boardRow.thu.cuocThu, '1234000', 'snapshot freight component');
    assert.equal(boardRow.thu.phuPs, '60000', 'snapshot surcharge component');
  });

  test('an override-stamped FCL lot stays on the snapshot channel (F2-05 BE)', async () => {
    // Review C1: the stamp clause is scoped to LCL — an operator M2.1 revenue
    // edit on an FCL lot must not flip the boards' money (FCL semantics and
    // the freight/phuPs split stay untouched by the ruling).
    const customer = await mkCustomer('F2 fcl stamp');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `F2-FCL-${suffix.slice(-6)}`, { cargoMode: 'FCL' });
    const trip = await mkBoardTrip(lot.id, customer.id, route.id);
    await mkFreightSnapshot(lot.id, trip.id, '2000000', '0');
    await upsertTripFinancialState(db, trip.id, {
      revenue: '2500000',
      revenueOverriddenAt: new Date(),
      revenueOverrideReason: 'Khách hàng thoả thuận giá mới',
    });

    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const row = summary.items.find((item) => item.shipmentId === lot.id)!;
    assert.equal(row.freightAuto, '2000000', 'stamped FCL keeps the snapshot channel');
    assert.equal(row.freightOverrideReason, null, 'no note outside the LCL domain');
    const board = await getAccountingDebitBoard({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    const boardRow = board.items.find((item) => item.shipmentId === lot.id && item.customerId === customer.id)!;
    assert.equal(boardRow.thu.cuocThu, '2000000');
  });
});

describe('161026204709 (TC-A12) — merged-but-undispatched LCL lots materialize the merge money', () => {
  // The customer's reported state: 2 same-customer LCL lots, NO live trip
  // (chưa phân bổ xe), a class-lane price configured — the merge dialog
  // promises "Lô 1 giữ 100% tiền vận tải (tự động), các lô còn lại 0đ" but
  // the boards used to stay blank because FB-093's money writes all ride the
  // trip. The merge now persists shipment-level (trip-less) freight
  // snapshots, and the boards' override read falls back to that channel when
  // the lot qualifies with no override total.
  async function seedUndispatchedPair(label: string, { withLane = true } = {}) {
    const customer = await mkCustomer(`A12 ${label}`);
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `A12-${label}1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `A12-${label}2-${suffix.slice(-6)}`);
    let lanePrice: string | null = null;
    if (withLane) {
      const truckClass = await vehicleClassByCode('3.5T');
      const [pricingRow] = await db.insert(s.pricingTables).values({
        customerId: customer.id,
        routeId: route.id,
        vehicleSizeClassId: truckClass.id,
        rateKey: truckClass.code,
        price: '2800000',
      }).returning();
      createdPricingTableIds.push(pricingRow.id);
      lanePrice = '2800000';
      await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id }, actor);
      return { customer, lot1, lot2, lanePrice };
    }
    const anyClass = await vehicleClassByCode('3.5T');
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: anyClass.id }, actor);
    return { customer, lot1, lot2, lanePrice: null };
  }

  test('CUS board: principal = lane price, member = 0₫ + group note (A12-01)', async () => {
    const { customer, lot1, lot2, lanePrice } = await seedUndispatchedPair('a');
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const principal = summary.items.find((row) => row.shipmentId === lot1.id)!;
    const member = summary.items.find((row) => row.shipmentId === lot2.id)!;
    assert.equal(principal.freightAuto, lanePrice, 'Lô 1 hiện 100% tiền thu (merge snapshot lane price)');
    assert.equal(member.freightAuto, '0', 'lô ghép hiện 0₫');
    assert.equal(member.freightOverrideReason, `Ghép cước cùng Bill ${lot1.blNumber}`);
    assert.equal(principal.receivableTotal, lanePrice, 'receivable addend follows the effective freight');
    assert.equal(member.receivableTotal, '0');
  });

  test('accounting board: thu.cuocThu follows the same law (A12-02)', async () => {
    const { customer, lot1, lot2, lanePrice } = await seedUndispatchedPair('b');
    const board = await getAccountingDebitBoard({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    const principal = board.items.find((row) => row.shipmentId === lot1.id && row.customerId === customer.id)!;
    const member = board.items.find((row) => row.shipmentId === lot2.id && row.customerId === customer.id)!;
    assert.equal(principal.thu.cuocThu, lanePrice, 'Kế toán board: Lô 1 hiện 100%');
    assert.equal(member.thu.cuocThu, '0', 'Kế toán board: lô ghép 0₫');
  });

  test('un-merge transfers the merge snapshot money to the survivor (A12-03)', async () => {
    const { customer, lot1, lot2, lanePrice } = await seedUndispatchedPair('c');
    await unmergeLclLot({ shipmentId: lot1.id, dimension: 'REV' }, actor);
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const leaver = summary.items.find((row) => row.shipmentId === lot1.id)!;
    const survivor = summary.items.find((row) => row.shipmentId === lot2.id)!;
    assert.equal(survivor.freightAuto, lanePrice, 'the promoted survivor keeps 100% via its transfer snapshot');
    assert.equal(leaver.freightAuto, '0', 'the leaver reads its cited transfer zero');
    // Residual by design: a trip-less leaver is ungrouped AND unstamped, so
    // no note rides the row (the citation lives on the snapshot's formula
    // text for auditors) — the trip-ful FB-095 leaver shows the same zero
    // WITH its stamp because trips carry a reason column.
    assert.equal(leaver.freightOverrideReason, null);
  });

  test('a trip-less member leaving keeps its cited zero as stale-priced (A12-04)', async () => {
    const { customer, lot2 } = await seedUndispatchedPair('d');
    await unmergeLclLot({ shipmentId: lot2.id, dimension: 'REV' }, actor);
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const leaver = summary.items.find((row) => row.shipmentId === lot2.id)!;
    assert.equal(leaver.freightAuto, '0', 'the ex-member reads its re-cited snapshot zero');
  });

  test('lane miss keeps the principal MANUAL/blank, member still 0₫ (A12-05)', async () => {
    const { customer, lot1, lot2 } = await seedUndispatchedPair('e', { withLane: false });
    const summary = await getShipmentDebitSummary({ customerId: customer.id, lockStatus: 'ALL' });
    const principal = summary.items.find((row) => row.shipmentId === lot1.id)!;
    const member = summary.items.find((row) => row.shipmentId === lot2.id)!;
    assert.equal(principal.freightAuto, null, 'no lane ⇒ Chưa xác định, never a fabricated number');
    assert.equal(member.freightAuto, '0', 'the member zero is still a cited value');
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

  test('the lone survivor of a dissolved group keeps its vehicle class (QA C-1)', async () => {
    // FB-095 contract: "a lone survivor dissolves the group (ungrouped, keeps
    // class + BKS + money)". The dissolved branch used to reuse the leaver's
    // patch and null *VehicleClassId too, so the dispatch/accounting boards
    // and the Debit Note lost the survivor's loại xe (staging QA 2026-10-16,
    // api-matrix T3c/T7b: cls:null). Only the membership fields may go.
    const customer = await mkCustomer('FB095 dissolve');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-L1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-L2-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');
    const vanClass = await vehicleClassByCode('3.5T');

    // COST: a 2-lot group whose principal leaves dissolves.
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-222.22',
    }, actor);
    const costResult = await unmergeLclLot({ shipmentId: lot1.id, dimension: 'COST' }, actor);
    assert.equal(costResult.dissolved, true);
    const [costSurvivor] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot2.id));
    assert.equal(costSurvivor.costGroupId, null, 'the group dissolved');
    assert.equal(costSurvivor.costGroupOrder, null);
    assert.equal(costSurvivor.costVehicleClassId, truckClass.id, 'the survivor keeps its cost vehicle class');

    // REV: the same dissolve shape on the revenue dimension.
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: vanClass.id }, actor);
    const revResult = await unmergeLclLot({ shipmentId: lot1.id, dimension: 'REV' }, actor);
    assert.equal(revResult.dissolved, true);
    const [revSurvivor] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot2.id));
    assert.equal(revSurvivor.revGroupId, null, 'the group dissolved');
    assert.equal(revSurvivor.revGroupOrder, null);
    assert.equal(revSurvivor.revVehicleClassId, vanClass.id, 'the survivor keeps its rev vehicle class');
  });

  test('a member leaving a 2-lot group dissolves it — survivor ungrouped, keeps class, re-merge OK (QA C-2)', async () => {
    // Staging 2026-10-16 round 2, finding C-2(a): the member-exit branch only
    // cleared the leaver — the survivor kept a ghost revGroupId, so a re-merge
    // 409'd with "đã thuộc nhóm ghép" while the response claimed dissolved.
    const customer = await mkCustomer('FB095 c2 rev');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-N1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-N2-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `FB095-N3-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');
    await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: truckClass.id }, actor);

    // Member (order 2) exits: no promotion, no money moves, one survivor
    // cannot stay a group.
    const result = await unmergeLclLot({ shipmentId: lot2.id, dimension: 'REV' }, actor);
    assert.equal(result.promoted, null);
    assert.equal(result.transferredAmount, null);
    assert.equal(result.dissolved, true, 'one survivor is not a group');
    assert.deepEqual(result.remaining, []);

    // The response must be the DB post-state: survivor ungrouped (no ghost
    // id) yet keeps its class (C-1 law); leaver fully cleared incl. class.
    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const survivor = byId.get(lot1.id)!;
    assert.equal(survivor.revGroupId, null, 'survivor left the group — no ghost id (QA C-2)');
    assert.equal(survivor.revGroupOrder, null);
    assert.equal(survivor.revVehicleClassId, truckClass.id, 'survivor keeps its rev vehicle class');
    const leaver = byId.get(lot2.id)!;
    assert.equal(leaver.revGroupId, null);
    assert.equal(leaver.revGroupOrder, null);
    assert.equal(leaver.revVehicleClassId, null, 'leaver fully cleared incl. vehicle class (FB-095)');

    // The audit payload rides the same post-state as the response.
    const unmerged = (await groupAuditPayloads(lot2.id))
      .filter((payload) => payload.event === 'SHIPMENT_LCL_GROUP_UNMERGED');
    assert.equal(unmerged.length, 1);
    assert.equal(unmerged[0]!.dissolved, true);
    assert.deepEqual(unmerged[0]!.remaining, []);

    // The staging 409 itself: re-merging the survivor with a fresh lot must
    // now succeed — no stale revGroupId survives to trip assertGroupable.
    const remerge = await mergeLclRevGroup({
      shipmentIds: [lot1.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
    }, actor);
    assert.equal(remerge.memberCount, 2);
    const [remerged1] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot1.id));
    assert.equal(remerged1.revGroupId, remerge.groupId);
    assert.equal(remerged1.revGroupOrder, 1);
  });

  test('a middle member leaving a 3-lot group renumbers survivors contiguously — response = DB (QA C-2)', async () => {
    // Staging 2026-10-16 round 2, finding C-2(b): the response claimed
    // [{I,1},{J,2}] while the DB kept orders 1 and 3 with a gap.
    const customer = await mkCustomer('FB095 c2 cost');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `FB095-E1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `FB095-E2-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `FB095-E3-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('5T');
    await assignLclCostGroup({
      shipmentIds: [lot1.id, lot2.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-121.21',
    }, actor);

    // The middle member (order 2) exits: orders 1 and 3 must close up.
    const result = await unmergeLclLot({ shipmentId: lot2.id, dimension: 'COST' }, actor);
    assert.equal(result.promoted, null);
    assert.equal(result.transferredAmount, null);
    assert.equal(result.dissolved, false);
    assert.deepEqual(result.remaining.map((m) => [m.shipmentId, m.order]), [[lot1.id, 1], [lot3.id, 2]]);

    // The renumbered remaining list is the actual DB post-state — no gap.
    const rows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id, lot3.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(lot1.id)!.costGroupId, result.groupId);
    assert.equal(byId.get(lot1.id)!.costGroupOrder, 1);
    assert.equal(byId.get(lot3.id)!.costGroupId, result.groupId);
    assert.equal(byId.get(lot3.id)!.costGroupOrder, 2, 'no order gap (QA C-2)');
    const leaver = byId.get(lot2.id)!;
    assert.equal(leaver.costGroupId, null);
    assert.equal(leaver.costGroupOrder, null);
    assert.equal(leaver.costVehicleClassId, null, 'leaver fully cleared incl. vehicle class (FB-095)');

    // The audit claims exactly the same post-state the DB reached.
    const unmerged = (await groupAuditPayloads(lot2.id))
      .filter((payload) => payload.event === 'SHIPMENT_LCL_GROUP_UNMERGED');
    assert.equal(unmerged.length, 1);
    assert.equal(unmerged[0]!.dissolved, false);
    assert.deepEqual(unmerged[0]!.remaining, result.remaining);
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

    // QA C-2: the renumbered remaining list must be the DB post-state, not an
    // unexecuted response claim (the old member-exit path never rewrote rows).
    const costRows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot2.id, lot3.id]));
    const costById = new Map(costRows.map((row) => [row.id, row]));
    assert.equal(costById.get(lot1.id)!.costGroupId, result.groupId);
    assert.equal(costById.get(lot1.id)!.costGroupOrder, 1);
    assert.equal(costById.get(lot3.id)!.costGroupId, result.groupId);
    assert.equal(costById.get(lot3.id)!.costGroupOrder, 2);
    assert.equal(costById.get(lot2.id)!.costGroupId, null);

    // REV member exit: the stale "Ghép cùng Bill X" stamp becomes current.
    const revResult = await unmergeLclLot({ shipmentId: lot2.id, dimension: 'REV' }, actor);
    assert.equal(revResult.promoted, null);
    const revAfter = await liveTrip(lot2.id);
    assert.equal(revAfter!.revenue, '0');
    assert.equal(revAfter!.revenueOverrideReason, 'Tách khỏi nhóm ghép — chờ định giá lại');

    // QA C-2: the REV survivors renumber in the DB too.
    const revRows = await db.select().from(s.shipments).where(inArray(s.shipments.id, [lot1.id, lot3.id]));
    const revById = new Map(revRows.map((row) => [row.id, row]));
    assert.equal(revById.get(lot1.id)!.revGroupId, revResult.groupId);
    assert.equal(revById.get(lot1.id)!.revGroupOrder, 1);
    assert.equal(revById.get(lot3.id)!.revGroupId, revResult.groupId);
    assert.equal(revById.get(lot3.id)!.revGroupOrder, 2);
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
    assert.equal(after2.costVehicleClassId, truckClass.id, 'the survivor keeps its cost vehicle class (QA C-1)');
    assert.equal(after2.deletedAt, null, 'the survivor lives on');
    const events = await groupAuditEvents(lot1.id);
    assert.ok(events.includes('SHIPMENT_LCL_GROUP_UNMERGED'), 'the promotion is audited');
  });
});

describe('GAP 1 — money safety on unshipping / deleting a group (spec line 92)', () => {
  test('un-merging the whole group strictly conserves the total group freight (both REV and COST)', async () => {
    // 1. REV dimension (undispatched lots, snapshot money channel)
    const customer = await mkCustomer('GAP1 unmerge REV');
    const route = await mkRoute();
    const truckClass = await vehicleClassByCode('3.5T');
    const [pricing] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: truckClass.id,
      rateKey: truckClass.code,
      price: '3600000',
    }).returning();
    createdPricingTableIds.push(pricing.id);

    const rLot1 = await mkLclLot(customer.id, route.id, `GAP1-UR1-${suffix.slice(-6)}`);
    const rLot2 = await mkLclLot(customer.id, route.id, `GAP1-UR2-${suffix.slice(-6)}`);
    const rLot3 = await mkLclLot(customer.id, route.id, `GAP1-UR3-${suffix.slice(-6)}`);

    const revMergeResult = await mergeLclRevGroup({
      shipmentIds: [rLot1.id, rLot2.id, rLot3.id],
      vehicleSizeClassId: truckClass.id,
    }, actor);

    const revBefore1 = await latestSnapshot(rLot1.id);
    const revBefore2 = await latestSnapshot(rLot2.id);
    const revBefore3 = await latestSnapshot(rLot3.id);
    assert.equal(revBefore1, 3600000, 'Lô 1 holds 100% of freight before unmerge');
    assert.equal(revBefore2, 0, 'Lô 2 holds 0₫ before unmerge');
    assert.equal(revBefore3, 0, 'Lô 3 holds 0₫ before unmerge');
    const totalRevBefore = (revBefore1 ?? 0) + (revBefore2 ?? 0) + (revBefore3 ?? 0);
    assert.equal(totalRevBefore, 3600000);

    // Unmerge whole REV group
    const revUnmerge = await unmergeLclGroup({ groupId: revMergeResult.groupId, dimension: 'REV' }, actor);
    assert.equal(revUnmerge.dissolved, true);
    assert.equal(revUnmerge.memberCount, 3);

    const [afterRLot1] = await db.select().from(s.shipments).where(eq(s.shipments.id, rLot1.id));
    const [afterRLot2] = await db.select().from(s.shipments).where(eq(s.shipments.id, rLot2.id));
    const [afterRLot3] = await db.select().from(s.shipments).where(eq(s.shipments.id, rLot3.id));
    assert.equal(afterRLot1.revGroupId, null);
    assert.equal(afterRLot2.revGroupId, null);
    assert.equal(afterRLot3.revGroupId, null);

    const revAfter1 = await latestSnapshot(rLot1.id);
    const revAfter2 = await latestSnapshot(rLot2.id);
    const revAfter3 = await latestSnapshot(rLot3.id);
    const totalRevAfter = (revAfter1 ?? 0) + (revAfter2 ?? 0) + (revAfter3 ?? 0);
    assert.equal(totalRevAfter, totalRevBefore, 'REV group total freight is strictly conserved after un-merging the whole group');
    assert.equal(revAfter1, 3600000, 'Lô 1 retained 100% of the freight');

    // 2. COST dimension (trips with carrier cost)
    const cLot1 = await mkLclLot(customer.id, route.id, `GAP1-UC1-${suffix.slice(-6)}`);
    const cLot2 = await mkLclLot(customer.id, route.id, `GAP1-UC2-${suffix.slice(-6)}`);
    const cLot3 = await mkLclLot(customer.id, route.id, `GAP1-UC3-${suffix.slice(-6)}`);
    const trip1 = await mkTrip(cLot1.id, customer.id, route.id);
    const trip2 = await mkTrip(cLot2.id, customer.id, route.id);
    const trip3 = await mkTrip(cLot3.id, customer.id, route.id);
    await upsertTripCarrierInfo(db, trip1.id, { carrierType: 'EXTERNAL', externalFreightCost: '2100000' });
    await upsertTripCarrierInfo(db, trip2.id, { carrierType: 'EXTERNAL', externalFreightCost: '700000' });
    await upsertTripCarrierInfo(db, trip3.id, { carrierType: 'EXTERNAL', externalFreightCost: '500000' });

    const costMergeResult = await assignLclCostGroup({
      shipmentIds: [cLot1.id, cLot2.id, cLot3.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '29C-555.55',
    }, actor);

    const costT1Before = await liveTrip(cLot1.id);
    const costT2Before = await liveTrip(cLot2.id);
    const costT3Before = await liveTrip(cLot3.id);
    const totalCostBefore = Number(costT1Before!.externalFreightCost) + Number(costT2Before!.externalFreightCost) + Number(costT3Before!.externalFreightCost);
    assert.equal(totalCostBefore, 2100000, 'COST group total is 2.1M before unmerge');

    // Unmerge whole COST group
    const costUnmerge = await unmergeLclGroup({ groupId: costMergeResult.groupId, dimension: 'COST' }, actor);
    assert.equal(costUnmerge.dissolved, true);

    const [afterCLot1] = await db.select().from(s.shipments).where(eq(s.shipments.id, cLot1.id));
    const [afterCLot2] = await db.select().from(s.shipments).where(eq(s.shipments.id, cLot2.id));
    const [afterCLot3] = await db.select().from(s.shipments).where(eq(s.shipments.id, cLot3.id));
    assert.equal(afterCLot1.costGroupId, null);
    assert.equal(afterCLot2.costGroupId, null);
    assert.equal(afterCLot3.costGroupId, null);

    const costT1After = await liveTrip(cLot1.id);
    const costT2After = await liveTrip(cLot2.id);
    const costT3After = await liveTrip(cLot3.id);
    const totalCostAfter = Number(costT1After!.externalFreightCost) + Number(costT2After!.externalFreightCost) + Number(costT3After!.externalFreightCost);
    assert.equal(totalCostAfter, totalCostBefore, 'COST group total freight is strictly conserved after un-merging the whole group');
    assert.equal(Number(costT1After!.externalFreightCost), 2100000, 'Lô 1 retained 100% of vendor freight');
  });

  test('deleting the primary lot atomically promotes the next lot and transfers 100% freight (spec line 92)', async () => {
    const customer = await mkCustomer('GAP1 delete L1');
    const route = await mkRoute();
    const truckClass = await vehicleClassByCode('5T');
    const [pricing] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: truckClass.id,
      rateKey: truckClass.code,
      price: '4200000',
    }).returning();
    createdPricingTableIds.push(pricing.id);

    const lot1 = await mkLclLot(customer.id, route.id, `GAP1-DL1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `GAP1-DL2-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `GAP1-DL3-${suffix.slice(-6)}`);

    const mergeResult = await mergeLclRevGroup({
      shipmentIds: [lot1.id, lot2.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
    }, actor);

    const snap1Before = await latestSnapshot(lot1.id);
    const snap2Before = await latestSnapshot(lot2.id);
    const snap3Before = await latestSnapshot(lot3.id);
    assert.equal(snap1Before, 4200000, 'Lot 1 holds 100% before delete');
    assert.equal(snap2Before, 0);
    assert.equal(snap3Before, 0);
    const totalBefore = (snap1Before ?? 0) + (snap2Before ?? 0) + (snap3Before ?? 0);
    assert.equal(totalBefore, 4200000);

    // Atomically delete Lô 1 (primary lot)
    const [fresh1] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot1.id));
    await softDeleteShipment(lot1.id, { version: fresh1.version, deletedBy: actor.userId, actor });

    // Lot 2 was promoted to primary (order 1), Lot 3 renumbered to order 2
    const [after2] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot2.id));
    const [after3] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot3.id));
    assert.equal(after2.revGroupId, mergeResult.groupId, 'Lot 2 remains in group');
    assert.equal(after2.revGroupOrder, 1, 'Lot 2 promoted to primary (order 1)');
    assert.equal(after2.revVehicleClassId, truckClass.id, 'Lot 2 inherits vehicle class');
    assert.equal(after3.revGroupId, mergeResult.groupId, 'Lot 3 remains in group');
    assert.equal(after3.revGroupOrder, 2, 'Lot 3 renumbered to order 2');

    // Invariant: Promoted lot (Lot 2) MUST hold EXACTLY 100% of the freight amount (4,200,000₫)
    const snap2After = await latestSnapshot(lot2.id);
    const snap3After = await latestSnapshot(lot3.id);
    assert.equal(snap2After, 4200000, 'Promoted Lot 2 holds exactly 100% of the freight');
    assert.equal(snap3After, 0, 'Lot 3 still holds 0₫');

    const totalAfter = (snap2After ?? 0) + (snap3After ?? 0);
    assert.equal(totalAfter, totalBefore, 'Money conservation invariant: group total freight is identical before and after primary deletion');
  });

  test('deleting the last-but-one lot dissolves group cleanly and primary retains 100% freight', async () => {
    const customer = await mkCustomer('GAP1 delete member');
    const route = await mkRoute();
    const truckClass = await vehicleClassByCode('5T');
    const [pricing] = await db.insert(s.pricingTables).values({
      customerId: customer.id,
      routeId: route.id,
      vehicleSizeClassId: truckClass.id,
      rateKey: truckClass.code,
      price: '3900000',
    }).returning();
    createdPricingTableIds.push(pricing.id);

    const lot1 = await mkLclLot(customer.id, route.id, `GAP1-ML1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `GAP1-ML2-${suffix.slice(-6)}`);

    await mergeLclRevGroup({
      shipmentIds: [lot1.id, lot2.id],
      vehicleSizeClassId: truckClass.id,
    }, actor);

    const snap1Before = await latestSnapshot(lot1.id);
    const snap2Before = await latestSnapshot(lot2.id);
    assert.equal(snap1Before, 3900000);
    assert.equal(snap2Before, 0);
    const totalBefore = (snap1Before ?? 0) + (snap2Before ?? 0);

    // Delete lot2 (last-but-one lot leaving only lot1)
    const [fresh2] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot2.id));
    await softDeleteShipment(lot2.id, { version: fresh2.version, deletedBy: actor.userId, actor });

    // Lot 1 stands alone, group dissolved cleanly (no ghost group ID)
    const [after1] = await db.select().from(s.shipments).where(eq(s.shipments.id, lot1.id));
    assert.equal(after1.revGroupId, null, 'Group dissolved cleanly: revGroupId is null');
    assert.equal(after1.revGroupOrder, null, 'revGroupOrder is null');
    assert.equal(after1.revVehicleClassId, truckClass.id, 'Lot 1 keeps its vehicle class');

    // Money conservation: lot 1 retains 100% of the freight
    const snap1After = await latestSnapshot(lot1.id);
    assert.equal(snap1After, 3900000, 'Lot 1 retains exactly 100% of freight');
    assert.equal(snap1After, totalBefore, 'Total freight is conserved when member is deleted');

    // Verify no ghost group: Lot 1 can be merged into a new group without conflict
    const lot3 = await mkLclLot(customer.id, route.id, `GAP1-ML3-${suffix.slice(-6)}`);
    const newMerge = await mergeLclRevGroup({
      shipmentIds: [lot1.id, lot3.id],
      vehicleSizeClassId: truckClass.id,
    }, actor);
    assert.equal(newMerge.memberCount, 2, 'Lot 1 re-merges cleanly with no ghost group error');
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
  if (createdFreightSnapshotIds.length > 0) {
    await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.id, createdFreightSnapshotIds));
  }
  if (createdFulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
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
