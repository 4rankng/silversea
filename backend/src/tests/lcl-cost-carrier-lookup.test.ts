/**
 * Card 171026142500 — "Cước trả ĐV không tự tra" (VERIFY-FIRST repro).
 *
 * The card's scene, exactly: 3 LCL lots CL5B-L01/02/03 (LONG MINH, IMPORT,
 * tuyến Hải Phòng → Bắc Ninh), two `carrier_route_pricing` rows — generic
 * 5.000.000₫ and vendor-specific BIỂN XANH 4.500.000₫ (same route + 2.5T,
 * effective ≤ lot date, "Đang áp dụng") — then "Gán xe nhóm" with the 2.5T
 * class and nhà xe BIỂN XANH. Expected per FB-092/161026232319: Lô 1 =
 * 4.500.000₫ (the nhà xe's own row wins over the generic), Lô 2/3 = 0₫.
 * Observed on the chốt-debit board: all 3 lots read "Thiếu cước trả ĐV".
 *
 * What these tests pin, in order:
 *   1. The lane lookup itself (`resolveCarrierVehicleClassPrice`) returns the
 *      vendor row — the 3 match keys (routeId, vehicleSizeClassId,
 *      effectiveDate ≤ lot date, supplier link) are all satisficed, so the
 *      "why no lookup" question is settled: the lookup is fine.
 *   2. The PRODUCTION ordering repro: dispatch groups lots on Kế hoạch Chi
 *      tiết BEFORE "phát lệnh" creates each lot's trip (the grid checkboxes
 *      exist exactly for that pre-issue selection), so the repro assigns the
 *      group on trip-less lots and then issues the three dispatch orders
 *      through the real `issueFulfillmentDispatchOrder`. The group's money
 *      law must still land on the trips the issue creates: Lô 1 = 4.500.000₫,
 *      members = 0₫.
 *   3. The chốt-debit reading path (`getAccountingDebitBoard`, the exact
 *      service behind the "Thiếu cước trả ĐV" column) must show the money —
 *      proving the label was the honest display of a persistence gap, not a
 *      display bug.
 *   4. Control: the post-issue ordering (issue first, group after) keeps
 *      working — the FB-092 assign-time money jump on existing trips.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';
import { assignLclCostGroup } from '../services/lcl-grouping.service';
import { resolveCarrierVehicleClassPrice } from '../services/pricing.service';
import { issueFulfillmentDispatchOrder } from '../services/dispatch-planning-commands.service';
import type { DispatchActor } from '../services/dispatch-planning-utils.service';
import { getAccountingDebitBoard } from '../services/accounting-debit-close.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** The issue command's actor (DispatchActor = AuthUser with a dispatch role). */
const dispatchActor: DispatchActor = {
  userId: 1,
  username: `admin-${suffix}`,
  email: null,
  fullName: '171026142500 test',
  role: Role.ADMIN,
};
/** The group assignment's actor (audit label channel). */
const groupActor = { userId: 1, role: 'ADMIN', actorName: '171026142500 test' };

/** The card's delivery day; the pricing rows are effective before it. */
const LOT_DATE = '2026-10-20';
const GENERIC_PRICE = 5_000_000;
const VENDOR_PRICE = 4_500_000;

const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCarrierPriceIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdCarrierVehicleIds: number[] = [];
const createdFulfillmentIds: number[] = [];
const usedIdempotencyKeys: string[] = [];

/** LONG MINH — the card's customer. */
async function mkCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute(name: string) {
  const [route] = await db.insert(s.routes).values({ name: `${name} ${suffix}` }).returning();
  createdRouteIds.push(route.id);
  return route;
}

/** nhà xe BIỂN XANH — an ACTIVE isCarrier customer linked to a CARRIER-typed
 *  supplier row (the "giá riêng" lane key of the carrier price board). */
async function mkCarrierWithSupplier(name: string) {
  const [supplier] = await db.insert(s.suppliers).values({
    name: `${name} NCC ${suffix}`,
    shortName: `NCC ${name}`,
    types: ['CARRIER'],
    primaryType: 'CARRIER',
  }).returning();
  createdSupplierIds.push(supplier.id);
  const [carrier] = await db.insert(s.customers).values({
    name: `${name} ${suffix}`,
    isCarrier: true,
    status: 'ACTIVE',
    linkedSupplierId: supplier.id,
  }).returning();
  createdCustomerIds.push(carrier.id);
  await db.update(s.suppliers).set({ linkedCustomerId: carrier.id }).where(eq(s.suppliers.id, supplier.id));
  return { carrier, supplier };
}

/** One LCL lot of the card's trio + its CUS-allocation fulfillment (the
 *  "phân bổ xe" channel the group assignment writes and the issue reads). */
async function mkLclLot(customerId: number, routeId: number, ref: string) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    blNumber: ref,
    tradeDirection: 'IMPORT',
    cargoMode: 'LCL',
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: LOT_DATE,
    routeId,
    packageCount: 5,
    packageType: 'PALLET',
    cargoWeightKg: '1922.00',
    cargoVolumeCbm: '4.000',
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  createdFulfillmentIds.push(fulfillment.id);
  return { shipment, fulfillment };
}

/** Bảng giá cước trả nhà xe — supplierId null = giá chung. */
async function mkCarrierPricing(
  routeId: number,
  vehicleSizeClassId: number,
  price: number,
  supplierId: number | null = null,
) {
  const [row] = await db.insert(s.carrierRoutePricing).values({
    routeId, vehicleSizeClassId, supplierId, price: String(price),
    effectiveDate: '2026-10-01',
  }).returning();
  createdCarrierPriceIds.push(row.id);
  return row;
}

async function vehicleClassByCode(code: string) {
  const [vehicleClass] = await db.select().from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, code)).limit(1);
  assert.ok(vehicleClass, `seeded vehicle class ${code} exists`);
  return vehicleClass;
}

/** The real "phát lệnh": the exact command the Kế hoạch Chi tiết grid sends.
 *  Re-reads the fulfillment version first — the group assignment bumped it
 *  when it persisted the nhà xe identity, exactly like the grid refetches. */
async function issueLot(shipmentId: number, fulfillmentId: number, externalCarrierId: number, keyTag: string) {
  const [fresh] = await db.select({ version: s.shipmentFulfillments.version })
    .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillmentId)).limit(1);
  assert.ok(fresh, 'fulfillment still exists at issue time');
  const idempotencyKey = `171026142500-${keyTag}-${suffix}`;
  usedIdempotencyKeys.push(idempotencyKey);
  return issueFulfillmentDispatchOrder({
    shipmentId,
    fulfillmentId,
    expectedVersion: fresh!.version,
    plannedStartAt: `${LOT_DATE}T08:00:00+07:00`,
    plannedEndAt: `${LOT_DATE}T12:00:00+07:00`,
    endTimeConfirmed: true,
    carrierType: 'EXTERNAL',
    externalCarrierId,
    idempotencyKey,
    actor: dispatchActor,
  });
}

/** trip_carrier_info.external_freight_cost of the lot's live trip — the exact
 *  column the chốt-debit board sums ("known" iff non-null on every trip). */
async function liveFreightCost(shipmentId: number): Promise<string | null> {
  const [row] = await db.select({
    externalFreightCost: s.tripCarrierInfo.externalFreightCost,
  }).from(s.trips)
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(eq(s.trips.shipmentId, shipmentId), isNull(s.trips.deletedAt)))
    .limit(1);
  return row?.externalFreightCost ?? null;
}

async function boardCuocTraDv(shipmentIds: number[]): Promise<Map<number, string | null>> {
  const board = await getAccountingDebitBoard({ dateFrom: LOT_DATE, dateTo: LOT_DATE });
  const byId = new Map(board.items.map((row) => [row.shipmentId, row.tra.cuocTraDv]));
  return new Map(shipmentIds.map((id) => [id, byId.get(id) ?? undefined!]));
}

describe('171026142500 — tra bảng giá cước trả nhà xe theo đúng thứ tự điều vận thật', () => {
  test('lookup trả đúng dòng giá riêng của nhà xe (không phải null, không rơi về giá chung)', async () => {
    const route = await mkRoute('HP–BN lookup');
    const truckClass = await vehicleClassByCode('2.5T');
    const { supplier } = await mkCarrierWithSupplier('BIỂN XANH tra cứu');
    await mkCarrierPricing(route.id, truckClass.id, GENERIC_PRICE);
    await mkCarrierPricing(route.id, truckClass.id, VENDOR_PRICE, supplier.id);

    const price = await resolveCarrierVehicleClassPrice({
      routeId: route.id,
      vehicleSizeClassId: truckClass.id,
      supplierId: supplier.id,
      date: LOT_DATE,
    });
    assert.ok(price, 'bảng giá có 2 dòng cho đúng tuyến × 2.5T × nhà xe — lookup phải tra được');
    assert.equal(price!.price, VENDOR_PRICE, 'giá riêng của nhà xe thắng giá chung');
    assert.equal(price!.matched, 'SUPPLIER');
  });

  test('card repro: gán xe nhóm TRƯỚC khi phát lệnh — tiền vẫn phải lên chuyến sau phát lệnh', async () => {
    const customer = await mkCustomer('LONG MINH');
    const route = await mkRoute('HP–BN');
    const truckClass = await vehicleClassByCode('2.5T');
    const { carrier, supplier } = await mkCarrierWithSupplier('BIỂN XANH');
    await mkCarrierPricing(route.id, truckClass.id, GENERIC_PRICE);
    await mkCarrierPricing(route.id, truckClass.id, VENDOR_PRICE, supplier.id);

    const lot1 = await mkLclLot(customer.id, route.id, `CL5B-L01-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `CL5B-L02-${suffix.slice(-6)}`);
    const lot3 = await mkLclLot(customer.id, route.id, `CL5B-L03-${suffix.slice(-6)}`);
    const lots = [lot1, lot2, lot3];

    // Plan-time premise: no live trip exists yet for any selected lot.
    for (const lot of lots) {
      assert.equal(await liveFreightCost(lot.shipment.id), null, 'chưa phát lệnh — chưa có chuyến live');
    }

    // "Gán xe nhóm": 2.5T + nhà xe BIỂN XANH, manual entry left empty
    // ("Bỏ trống = tự tra bảng giá") — the card's exact call.
    const assigned = await assignLclCostGroup({
      shipmentIds: lots.map((lot) => lot.shipment.id),
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '51H-888.99',
      carrierType: 'EXTERNAL',
      carrierId: carrier.id,
    }, groupActor);
    assert.equal(assigned.memberCount, 3);

    // "Phát lệnh" each lot — the real issue command, in group order.
    await issueLot(lot1.shipment.id, lot1.fulfillment.id, carrier.id, 'l1');
    await issueLot(lot2.shipment.id, lot2.fulfillment.id, carrier.id, 'l2');
    await issueLot(lot3.shipment.id, lot3.fulfillment.id, carrier.id, 'l3');

    // The money law (FB-092 §II.2.2): Lô 1 = 100% (giá riêng 4.500.000₫),
    // members 2..N = 0₫ — ON THE TRIPS the issue just created.
    assert.equal(await liveFreightCost(lot1.shipment.id), String(VENDOR_PRICE), 'Lô 1 = giá riêng của nhà xe');
    assert.equal(await liveFreightCost(lot2.shipment.id), '0', 'Lô 2 nhảy tiền = 0₫');
    assert.equal(await liveFreightCost(lot3.shipment.id), '0', 'Lô 3 nhảy tiền = 0₫');

    // …and on the exact reading path of the chốt-debit board — the column
    // whose null renders "Thiếu cước trả ĐV".
    const board = await boardCuocTraDv(lots.map((lot) => lot.shipment.id));
    assert.equal(board.get(lot1.shipment.id), String(VENDOR_PRICE));
    assert.equal(board.get(lot2.shipment.id), '0');
    assert.equal(board.get(lot3.shipment.id), '0');
  });

  test('control: phát lệnh TRƯỚC rồi gán nhóm — luật tiền vẫn như FB-092 đã ghim', async () => {
    const customer = await mkCustomer('LONG MINH ctrl');
    const route = await mkRoute('HP–BN ctrl');
    const truckClass = await vehicleClassByCode('2.5T');
    const { carrier, supplier } = await mkCarrierWithSupplier('BIỂN XANH ctrl');
    await mkCarrierPricing(route.id, truckClass.id, GENERIC_PRICE);
    await mkCarrierPricing(route.id, truckClass.id, VENDOR_PRICE, supplier.id);

    const lot1 = await mkLclLot(customer.id, route.id, `CL5B-K01-${suffix.slice(-6)}`);
    const lot2 = await mkLclLot(customer.id, route.id, `CL5B-K02-${suffix.slice(-6)}`);

    await issueLot(lot1.shipment.id, lot1.fulfillment.id, carrier.id, 'c1');
    await issueLot(lot2.shipment.id, lot2.fulfillment.id, carrier.id, 'c2');

    await assignLclCostGroup({
      shipmentIds: [lot1.shipment.id, lot2.shipment.id],
      vehicleSizeClassId: truckClass.id,
      actualTruckNo: '51H-777.66',
      carrierType: 'EXTERNAL',
      carrierId: carrier.id,
    }, groupActor);

    assert.equal(await liveFreightCost(lot1.shipment.id), String(VENDOR_PRICE));
    assert.equal(await liveFreightCost(lot2.shipment.id), '0');
  });
});

after(async () => {
  const tripIds = createdShipmentIds.length > 0
    ? (await db.select({ id: s.trips.id }).from(s.trips)
        .where(inArray(s.trips.shipmentId, createdShipmentIds))).map((row) => row.id)
    : [];
  if (tripIds.length > 0) {
    await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.tripId, tripIds));
    await db.delete(s.notifications).where(inArray(s.notifications.relatedEntityId, tripIds));
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (usedIdempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, usedIdempotencyKeys));
  }
  if (createdFulfillmentIds.length > 0) {
    await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, createdFulfillmentIds));
  }
  if (createdShipmentIds.length > 0) {
    await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdShipmentIds));
    await db.delete(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'shipment'),
      inArray(s.auditLogs.entityId, createdShipmentIds),
    ));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdCarrierPriceIds.length > 0) {
    await db.delete(s.carrierRoutePricing).where(inArray(s.carrierRoutePricing.id, createdCarrierPriceIds));
  }
  if (createdCarrierVehicleIds.length > 0) {
    await db.delete(s.carrierFleetVehicles).where(inArray(s.carrierFleetVehicles.id, createdCarrierVehicleIds));
  }
  if (createdSupplierIds.length > 0) {
    await db.update(s.suppliers).set({ linkedCustomerId: null }).where(inArray(s.suppliers.id, createdSupplierIds));
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.update(s.customers).set({ linkedSupplierId: null }).where(inArray(s.customers.id, createdCustomerIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  await client.end();
});
