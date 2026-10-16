/**
 * 161026232349 (DEV SPEC Hàng lẻ §II.3.2 "Trường hợp 1 · Thu riêng từng lô") —
 * service contracts for the SINGLE-LOT thu vehicle class.
 *
 * The customer's law: "CUS không cần ghép. Khi bấm mở chi tiết từng lô (nút
 * [+]), CUS chọn Loại xe tính cước thu khách ... Cột CƯỚC VẬN TẢI (AUTO) của
 * từng lô sẽ nhảy 100% đơn giá của loại xe đã chọn cho lô đó."
 *
 * Pinned here:
 *   AC1 — the class saves on the lot and CƯỚC VẬN TẢI (AUTO) reads 100% of
 *         the customer × route × class lane price (`resolveCustomerVehicleClassPrice`).
 *   AC2 — a lane miss (no price row) saves the class but leaves the money null
 *         ("Chưa xác định") — never a fabricated 0₫, and no other amount moves.
 *   AC3 — the write lands on the channel the boards ALREADY read: the live
 *         trip's `trip_financial_state.revenue` + override stamp, or (no live
 *         trip) the merge path's shipment-level snapshot grain — so the CUS
 *         board, the Kế toán board and the customer-debt report agree without
 *         any of them being changed.
 *   AC4 — no group is created (`revGroupId` stays null); `costGroupId` and
 *         every cước TRẢ value stay untouched.
 *   AC5 — a lot inside a REV group is REFUSED with the tách-nhóm message.
 *   AC6 — the BKS quick-edit path (`updateLclGroupTruck`) is unaffected.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { upsertTripFinancialState } from '../services/trip-composite.service';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import { getAccountingDebitBoard } from '../services/accounting-debit-close.service';
import { getCustomerDebtSummary } from '../services/customer-debt-summary.service';
import { getShipmentFreightRateView } from '../services/freight-rate-snapshot-lifecycle.service';
import {
  mergeLclRevGroup,
  setLclLotRevClass,
  updateLclGroupTruck,
} from '../services/lcl-grouping.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const actor = { userId: 1, role: 'ADMIN', actorName: '161026232349 test' };
const LANE_PRICE = '3150000';

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTripIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdFreightSnapshotIds: number[] = [];
const createdFulfillmentIds: number[] = [];

async function mkCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({ name: `161026232349 route ${suffix}` }).returning();
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
    tripCode: `161026232349-${suffix.slice(-6)}-${createdTripIds.length + 1}-${shipmentId}`,
    customerId,
    routeId,
    departureDate: '2026-10-20',
    shipmentId,
    status: 'CREATED',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

/** Board-visible trip: the money boards count per-trip money only for
 *  fulfillment-linked live trips (card 20260924_2 shadow rule). */
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

/** The customer × route × class price lane the AUTO reads. */
async function mkCustomerLane(customerId: number, routeId: number, vehicleSizeClassId: number, rateKey: string, price: string) {
  const [row] = await db.insert(s.pricingTables).values({
    customerId, routeId, vehicleSizeClassId, rateKey, price,
  }).returning();
  createdPricingTableIds.push(row.id);
  return row;
}

async function liveTrip(shipmentId: number) {
  const [row] = await db.select({
    tripId: s.trips.id,
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
    revenue: s.tripFinancialState.revenue,
    revenueOriginal: s.tripFinancialState.revenueOriginal,
    revenueOverriddenAt: s.tripFinancialState.revenueOverriddenAt,
    revenueOverrideReason: s.tripFinancialState.revenueOverrideReason,
    driverSalary: s.tripFinancialState.driverSalary,
    totalRoadAllowance: s.tripFinancialState.totalRoadAllowance,
  }).from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .where(and(eq(s.trips.shipmentId, shipmentId), isNull(s.trips.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function shipmentRow(shipmentId: number) {
  const [row] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipmentId));
  return row;
}

async function auditPayloads(shipmentId: number) {
  const rows = await db.select({ payload: s.auditLogs.payload }).from(s.auditLogs)
    .where(and(eq(s.auditLogs.entityType, 'shipment'), eq(s.auditLogs.entityId, shipmentId)));
  return rows.map((row) => row.payload as Record<string, unknown>);
}

async function shipmentLevelSnapshots(shipmentId: number) {
  return db.select().from(s.freightRateSnapshots)
    .where(and(eq(s.freightRateSnapshots.shipmentId, shipmentId), isNull(s.freightRateSnapshots.tripId)))
    .orderBy(s.freightRateSnapshots.id);
}

async function cusBoardRow(customerId: number, shipmentId: number) {
  const board = await getShipmentDebitSummary({ customerId, lockStatus: 'ALL' });
  return board.items.find((row) => row.shipmentId === shipmentId)!;
}

async function accountingBoardRow(customerId: number, shipmentId: number) {
  const board = await getAccountingDebitBoard({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
  return board.items.find((row) => row.shipmentId === shipmentId && row.customerId === customerId)!;
}

describe('161026232349 — CUS single-lot thu vehicle class (§II.3.2 "Thu riêng từng lô")', () => {
  test('AC1/AC3/AC4: an ungrouped lot takes the class and CƯỚC VẬN TẢI (AUTO) jumps to 100% of the class lane on all three readers', async () => {
    const customer = await mkCustomer('single rev class');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `SRC-1-${suffix.slice(-6)}`);
    const trip = await mkBoardTrip(lot.id, customer.id, route.id);
    // Pre-existing money that must NOT survive the class choice: the old
    // revenue (a manual 1.000.000) and a cước TRẢ figure.
    await upsertTripFinancialState(db, trip.id, {
      revenue: '1000000',
      driverSalary: '500000',
      totalRoadAllowance: '300000',
    });
    await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, carrierType: 'EXTERNAL', externalFreightCost: '1200000' });

    const truckClass = await vehicleClassByCode('3.5T');
    await mkCustomerLane(customer.id, route.id, truckClass.id, truckClass.code, LANE_PRICE);

    const result = await setLclLotRevClass({ shipmentId: lot.id, vehicleSizeClassId: truckClass.id }, actor);

    assert.equal(result.channel, 'TRIP');
    assert.equal(result.freightAuto, LANE_PRICE);
    assert.equal(result.vehicleClassCode, truckClass.code);
    assert.equal(result.reason, `Chọn loại xe tính cước thu khách — Xe ${truckClass.code}`);

    // AC4 — the class lands on the shipment, NO group is created, nothing of
    // the cost dimension is touched.
    const after = await shipmentRow(lot.id);
    assert.equal(after.revVehicleClassId, truckClass.id, 'the chosen thu class is stamped on the lot');
    assert.equal(after.revGroupId, null, 'AC4: no rev group is created');
    assert.equal(after.revGroupOrder, null);
    assert.equal(after.costGroupId, null, 'AC4: the cost dimension is untouched');
    assert.equal(after.costVehicleClassId, null);

    // AC3 — the write rides the override channel (stamped), the money law.
    const t = await liveTrip(lot.id);
    assert.equal(t!.revenue, LANE_PRICE, '100% of the chosen class lane price');
    assert.equal(t!.revenueOriginal, '1000000', 'the previous revenue is kept as the original');
    assert.equal(t!.revenueOverrideReason, result.reason);
    assert.ok(t!.revenueOverriddenAt != null, 'the override stamp is what qualifies the lot for the boards');
    // No other amount moved.
    assert.equal(t!.externalFreightCost, '1200000', 'cước TRẢ untouched');
    assert.equal(t!.driverSalary, '500000', 'road money untouched');
    assert.equal(t!.totalRoadAllowance, '300000');
    assert.deepEqual(await shipmentLevelSnapshots(lot.id), [], 'no snapshot grain is written when a live trip carries the money');

    // The three readers agree, from their own unchanged code.
    const cus = await cusBoardRow(customer.id, lot.id);
    assert.equal(cus.freightAuto, LANE_PRICE, 'CUS board CƯỚC VẬN TẢI (AUTO) = 100% đơn giá loại xe');
    assert.equal(cus.freightOverrideReason, result.reason);
    assert.equal(cus.revVehicleClassCode, truckClass.code, 'the strip reopens on the stored class');
    assert.equal((await accountingBoardRow(customer.id, lot.id)).thu.cuocThu, LANE_PRICE, 'Kế toán board agrees');
    const debt = await getCustomerDebtSummary({ customerIds: [customer.id], excludeOwnFleet: false });
    const line = debt.items.find((item) => item.customerId === customer.id)!.lines
      .find((item) => item.shipmentId === lot.id)!;
    assert.equal(line.freightRevenue, Number(LANE_PRICE), 'customer-debt report agrees');
    assert.equal(line.freightOverrideReason, result.reason);
    assert.equal(line.freightPayable, 1_200_000, 'cước trả on the debt line is unchanged');

    // Auditable the same way the sibling LCL writes are.
    const payload = (await auditPayloads(lot.id)).find((item) => item.action === 'rev-class-single-lot')!;
    assert.equal(payload.event, 'SHIPMENT_UPDATED');
    assert.equal(payload.channel, 'TRIP');
    assert.equal(payload.vehicleSizeClassId, truckClass.id);
  });

  test('AC2: a lane miss saves the class but leaves cước THU "Chưa xác định" — never a fabricated 0₫, and moves no money', async () => {
    const customer = await mkCustomer('single rev class miss');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `SRC-2-${suffix.slice(-6)}`);
    const trip = await mkBoardTrip(lot.id, customer.id, route.id);
    await upsertTripFinancialState(db, trip.id, { revenue: '1000000' });
    // NOTE: no pricing table row for customer × route × class.

    const truckClass = await vehicleClassByCode('5T');
    const result = await setLclLotRevClass({ shipmentId: lot.id, vehicleSizeClassId: truckClass.id }, actor);

    assert.equal(result.channel, 'NONE');
    assert.equal(result.freightAuto, null, 'no lane ⇒ Chưa xác định, never a fabricated number');
    assert.equal(result.reason, null);

    const after = await shipmentRow(lot.id);
    assert.equal(after.revVehicleClassId, truckClass.id, 'the class still saves so CUS can fix the price board later');

    // The money is exactly as before: no 0₫, no stamp, no snapshot.
    const t = await liveTrip(lot.id);
    assert.equal(t!.revenue, '1000000', 'the previous revenue is not overwritten by a fabricated value');
    assert.equal(t!.revenueOriginal, null);
    assert.equal(t!.revenueOverriddenAt, null, 'no override stamp is written on a lane miss');
    assert.equal(t!.revenueOverrideReason, null);
    assert.deepEqual(await shipmentLevelSnapshots(lot.id), [], 'no snapshot is written either');

    // The board keeps the lot on the snapshot channel ⇒ "Chưa xác định".
    const cus = await cusBoardRow(customer.id, lot.id);
    assert.equal(cus.freightAuto, null, 'CUS board: Chưa xác định (no snapshot, no override total)');
    const payload = (await auditPayloads(lot.id)).find((item) => item.action === 'rev-class-single-lot')!;
    assert.equal(payload.channel, 'NONE');
  });

  test('AC3: a lot with NO live trip materializes the money at the merge path\u2019s shipment-level snapshot grain', async () => {
    const customer = await mkCustomer('single rev class trip-less');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `SRC-3-${suffix.slice(-6)}`);
    const truckClass = await vehicleClassByCode('3.5T');
    await mkCustomerLane(customer.id, route.id, truckClass.id, truckClass.code, LANE_PRICE);

    const result = await setLclLotRevClass({ shipmentId: lot.id, vehicleSizeClassId: truckClass.id }, actor);
    assert.equal(result.channel, 'SNAPSHOT');
    assert.equal(result.freightAuto, LANE_PRICE);

    const snapshots = await shipmentLevelSnapshots(lot.id);
    assert.equal(snapshots.length, 1, 'exactly one shipment-level (trip-less) snapshot — the merge grain');
    assert.equal(snapshots[0]!.tripId, null);
    assert.equal(snapshots[0]!.totalAmount, LANE_PRICE);
    // The same shape insertRevMergeSnapshot writes (freight only, no surcharge)
    // — this write reuses the merge helper verbatim rather than forking it.
    assert.equal(snapshots[0]!.freightAmount, LANE_PRICE);
    assert.equal(snapshots[0]!.surchargeAmount, '0');
    createdFreightSnapshotIds.push(snapshots[0]!.id);
    // The note of WHY the row exists rides `formula_text` — the single-lot
    // write reuses the merge helper, so it inherits the same audit note.
    assert.equal(snapshots[0]!.formulaText,
      `Chọn loại xe tính cước thu khách — 100% bảng giá khách × tuyến × ${truckClass.code}, ngày 2026-10-20`);
    const view = await getShipmentFreightRateView(lot.id);
    assert.equal(view.latest!.id, snapshots[0]!.id);
    assert.equal(view.latest!.formula, snapshots[0]!.formulaText,
      'the reader serves the stored note, not a rebuilt hint');
    assert.equal(view.latest!.source, 'AUTO', 'a stored note marks the row as a computed (not to-be-typed) price');

    const cus = await cusBoardRow(customer.id, lot.id);
    assert.equal(cus.freightAuto, LANE_PRICE, 'CUS board reads the snapshot channel for a trip-less lot');
    assert.equal((await accountingBoardRow(customer.id, lot.id)).thu.cuocThu, LANE_PRICE, 'Kế toán board agrees');
  });

  test('AC5: a lot inside a REV group is refused with the tách-nhóm message and nothing changes', async () => {
    const customer = await mkCustomer('single rev class grouped');
    const route = await mkRoute();
    const lot1 = await mkLclLot(customer.id, route.id, `SRC-5-1-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `SRC-5-2-${suffix.slice(-6)}`);
    const trip1 = await mkBoardTrip(lot1.id, customer.id, route.id);
    const trip2 = await mkBoardTrip(lot2.id, customer.id, route.id);
    const groupClass = await vehicleClassByCode('3.5T');
    await mkCustomerLane(customer.id, route.id, groupClass.id, groupClass.code, LANE_PRICE);
    const grouped = await mergeLclRevGroup({ shipmentIds: [lot1.id, lot2.id], vehicleSizeClassId: groupClass.id }, actor);

    const otherClass = await vehicleClassByCode('5T');
    await assert.rejects(
      setLclLotRevClass({ shipmentId: lot1.id, vehicleSizeClassId: otherClass.id }, actor),
      /đã thuộc nhóm ghép cước thu khách — tách khỏi nhóm/,
    );

    // The refusal is total: the group's class and the group's money stand.
    const after = await shipmentRow(lot1.id);
    assert.equal(after.revGroupId, grouped.groupId, 'still in the group');
    assert.equal(after.revVehicleClassId, groupClass.id, 'the group class is kept');
    const t1 = await liveTrip(lot1.id);
    assert.equal(t1!.revenue, LANE_PRICE, 'the merge price is untouched');
    const t2 = await liveTrip(lot2.id);
    assert.equal(t2!.revenue, '0', 'the member zero is untouched');
  });

  test('AC6: the BKS quick-edit path keeps working, and the class/revenue survive it', async () => {
    const customer = await mkCustomer('single rev class bks');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `SRC-6-${suffix.slice(-6)}`);
    const trip = await mkBoardTrip(lot.id, customer.id, route.id);
    const truckClass = await vehicleClassByCode('3.5T');
    await mkCustomerLane(customer.id, route.id, truckClass.id, truckClass.code, LANE_PRICE);
    const saved = await setLclLotRevClass({ shipmentId: lot.id, vehicleSizeClassId: truckClass.id }, actor);

    const truckResult = await updateLclGroupTruck({
      shipmentId: lot.id,
      actualTruckNo: '29C-161.01',
      billingTruckNo: '29C-161.99',
    }, actor);
    assert.deepEqual(truckResult.updatedShipmentIds, [lot.id]);

    const after = await shipmentRow(lot.id);
    assert.equal(after.actualTruckNo, '29C-161.01');
    assert.equal(after.billingTruckNo, '29C-161.99');
    assert.equal(after.revVehicleClassId, truckClass.id, 'the thu class survives the BKS edit');
    assert.equal(after.revGroupId, null);
    assert.equal((await liveTrip(lot.id))!.revenue, LANE_PRICE, 'the money survives the BKS edit');
    assert.equal((await cusBoardRow(customer.id, lot.id)).freightOverrideReason, saved.reason);
  });

  test('guard: a non-LCL lot cannot take a thu class of its own', async () => {
    const customer = await mkCustomer('single rev class fcl');
    const route = await mkRoute();
    const [fclLot] = await db.insert(s.shipments).values({
      customerId: customer.id,
      blNumber: `SRC-FCL-${suffix.slice(-6)}`,
      tradeDirection: 'IMPORT',
      cargoMode: 'FCL',
      status: 'READY_FOR_DISPATCH',
      expectedDeliveryDate: '2026-10-20',
      routeId: route.id,
    }).returning();
    createdShipmentIds.push(fclLot.id);
    const truckClass = await vehicleClassByCode('3.5T');
    await assert.rejects(
      setLclLotRevClass({ shipmentId: fclLot.id, vehicleSizeClassId: truckClass.id }, actor),
      /không phải hàng lẻ/,
    );
  });

  test('guard: an unknown class is refused (404) and a missing lot too (404)', async () => {
    const customer = await mkCustomer('single rev class guards');
    const route = await mkRoute();
    const lot = await mkLclLot(customer.id, route.id, `SRC-7-${suffix.slice(-6)}`);
    await assert.rejects(
      setLclLotRevClass({ shipmentId: lot.id, vehicleSizeClassId: 99_999_999 }, actor),
      /Loại xe tính cước không tồn tại/,
    );
    await assert.rejects(
      setLclLotRevClass({ shipmentId: 99_999_999, vehicleSizeClassId: 1 }, actor),
      /Không tìm thấy lô hàng/,
    );
  });
});

after(async () => {
  if (createdFreightSnapshotIds.length > 0) {
    await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.id, createdFreightSnapshotIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdPricingTableIds.length > 0) {
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
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
