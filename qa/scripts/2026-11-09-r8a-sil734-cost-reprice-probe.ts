/**
 * qa/scripts/2026-11-09-r8a-sil734-cost-reprice-probe.ts
 *
 * SIL-734 round 2 (QA fail 09/11, staging c4cea6b6 — lot 172 R40B1-LCL01
 * CƯỚC TRẢ ĐV 0₫ sau Tách nhóm) — probe THẬT trên DB local (integration
 * probe, qa/scripts ownership per AGENTS §2). Runs the REAL engine functions
 * in transactions:
 *
 *   D1. Merge COST (Gán xe nhóm, nhà xe + bảng giá CÓ hàng): Lô 1 nhận giá
 *       bảng giá (supplier lane), member stamped '0' ("nhảy tiền").
 *   D2. Tách cả nhóm COST: member re-price từ CÙNG bảng giá → về đúng giá
 *       trước ghép (không kẹt 0₫), planned_carrier_cost mirror theo.
 *   D3. Tách cả nhóm COST KHÔNG có bảng giá (lane miss): member stamped 0₫
 *       bị XÓA về null — 'Thiếu cước trả ĐV' honest, không 0₫ trần trừi,
 *       planned_carrier_cost cũng clear.
 *   D4. Tách 1 lô member (unmerge-lô) COST: leaver về giá bảng giá (hit) —
 *       cùng luật cho lối vào "1 lô về riêng".
 *
 * Run: cd backend && DATABASE_URL=postgres://postgres:postgres@localhost:5441/silversea \
 *      npx tsx ../qa/scripts/2026-11-09-r8a-sil734-cost-reprice-probe.ts
 * Evidence: qa/2026-11-09-r8a-694-728-734/.
 */
import { eq, and, isNull } from 'drizzle-orm';

import { db } from '../../backend/src/db';
import * as s from '../../backend/src/db/schema';
import { Role } from '@tingting/shared';
import { assignLclCostGroup, unmergeLclGroup, unmergeLclLot } from '../../backend/src/services/lcl-grouping.service';
import { disconnectRedis } from '../../backend/src/lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<unknown>> = [];
function trackDelete(run: () => Promise<unknown>) { cleanup.unshift(run); }

async function tripFreight(tripId: number) {
  const [row] = await db.select({ externalFreightCost: s.tripCarrierInfo.externalFreightCost, carrierType: s.tripCarrierInfo.carrierType })
    .from(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, tripId));
  return row ?? null;
}

async function plannedCost(shipmentId: number) {
  const [row] = await db.select({ plannedCarrierCost: s.shipmentFulfillments.plannedCarrierCost })
    .from(s.shipmentFulfillments)
    .where(and(eq(s.shipmentFulfillments.shipmentId, shipmentId), isNull(s.shipmentFulfillments.canceledAt)));
  return row?.plannedCarrierCost ?? null;
}

async function makeLot(customerId: number, routeId: number, index: number) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId, routeId, cargoMode: 'LCL', status: 'DISPATCHED',
    expectedDeliveryDate: '2026-11-06',
  }).returning({ id: s.shipments.id });
  trackDelete(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, fulfillmentType: 'DISPATCH', cargoMode: 'LCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  trackDelete(() => db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)));
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id, customerId, routeId,
    tripCode: `TRP-R8A-${index}-${suffix}`, departureDate: '2026-11-06', status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id });
  trackDelete(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  return { shipmentId: shipment.id, tripId: trip.id };
}

async function main() {
  const failures: string[] = [];
  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
  };

  // ── Fixtures ────────────────────────────────────────────────────────────
  const [user] = await db.insert(s.users).values({
    username: `r8aprobe-${suffix}`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  trackDelete(() => db.delete(s.users).where(eq(s.users.id, user.id)));
  const actor = { userId: user.id, username: `r8aprobe-${suffix}`, fullName: 'R8A probe', role: Role.ACCOUNTANT };
  const [supplier] = await db.insert(s.suppliers).values({ name: `R8A probe NCC ${suffix}` }).returning({ id: s.suppliers.id });
  trackDelete(() => db.delete(s.suppliers).where(eq(s.suppliers.id, supplier.id)));
  const [customer] = await db.insert(s.customers).values({ name: `R8A probe KH ${suffix}` }).returning({ id: s.customers.id });
  trackDelete(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [carrier] = await db.insert(s.customers).values({
    name: `R8A probe Nhà xe ${suffix}`, isCarrier: true, status: 'ACTIVE', linkedSupplierId: supplier.id,
  }).returning({ id: s.customers.id });
  trackDelete(() => db.delete(s.customers).where(eq(s.customers.id, carrier.id)));
  const [routePriced] = await db.insert(s.routes).values({ name: `R8A probe route CÓ giá ${suffix}` }).returning({ id: s.routes.id });
  trackDelete(() => db.delete(s.routes).where(eq(s.routes.id, routePriced.id)));
  const [routeMiss] = await db.insert(s.routes).values({ name: `R8A probe route KHÔNG giá ${suffix}` }).returning({ id: s.routes.id });
  trackDelete(() => db.delete(s.routes).where(eq(s.routes.id, routeMiss.id)));
  const [vehicleClass] = await db.insert(s.vehicleSizeClasses).values({
    code: `R8VC${suffix.slice(0, 6)}`, name: 'R8A probe lớp xe', isContainer: true, sortOrder: 99,
  }).returning({ id: s.vehicleSizeClasses.id });
  trackDelete(() => db.delete(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, vehicleClass.id)));
  // Bảng giá trả ĐV của NHÀ XE cho tuyến priced: 2.400.000₫ (the merge's own
  // board trace — the pre-merge price KB §8.4 demands back after tách).
  const [price] = await db.insert(s.carrierRoutePricing).values({
    routeId: routePriced.id, vehicleSizeClassId: vehicleClass.id, supplierId: supplier.id,
    price: '2400000', effectiveDate: '2026-01-01',
  }).returning({ id: s.carrierRoutePricing.id });
  trackDelete(() => db.delete(s.carrierRoutePricing).where(eq(s.carrierRoutePricing.id, price.id)));

  const lotA1 = await makeLot(customer.id, routePriced.id, 1);
  const lotA2 = await makeLot(customer.id, routePriced.id, 2);
  const lotB1 = await makeLot(customer.id, routeMiss.id, 3);
  const lotB2 = await makeLot(customer.id, routeMiss.id, 4);
  const lotC1 = await makeLot(customer.id, routePriced.id, 5);
  const lotC2 = await makeLot(customer.id, routePriced.id, 6);

  // ── D1. Merge COST với bảng giá: Lô 1 = giá bảng, member = stamped 0₫ ──
  await assignLclCostGroup({
    shipmentIds: [lotA1.shipmentId, lotA2.shipmentId],
    vehicleSizeClassId: vehicleClass.id,
    actualTruckNo: '15C-999.99',
    carrierId: carrier.id,
  }, actor);
  const mergeA1 = await tripFreight(lotA1.tripId);
  const mergeA2 = await tripFreight(lotA2.tripId);
  check('D1 merge: Lô 1 nhận 2.400.000₫ từ bảng giá nhà xe (không nhập tay)', mergeA1?.externalFreightCost === '2400000', `freight=${mergeA1?.externalFreightCost}`);
  check('D1 merge: Lô 2 stamped 0₫ ("nhảy tiền" — mặt trước tách của QA)', mergeA2?.externalFreightCost === '0', `freight=${mergeA2?.externalFreightCost}`);
  check('D1 merge: planned_carrier_cost Lô 2 = 0₫ (SIL-492 stamp)', await plannedCost(lotA2.shipmentId) === '0', `planned=${await plannedCost(lotA2.shipmentId)}`);

  // ── D2. Tách cả nhóm COST: member re-price đúng bảng giá ────────────────
  const [groupA] = await db.select({ id: s.shipments.costGroupId }).from(s.shipments).where(eq(s.shipments.id, lotA1.shipmentId));
  const dissolve = await unmergeLclGroup({ dimension: 'COST', groupId: groupA!.id! }, actor);
  const afterA2 = await tripFreight(lotA2.tripId);
  check('D2 tách cả nhóm: Lô 2 về ĐÚNG 2.400.000₫ (giá trước ghép, không 0₫)', afterA2?.externalFreightCost === '2400000', `freight=${afterA2?.externalFreightCost}`);
  check('D2 tách cả nhóm: planned_carrier_cost Lô 2 mirror 2.400.000₫', await plannedCost(lotA2.shipmentId) === '2400000', `planned=${await plannedCost(lotA2.shipmentId)}`);
  check('D2 tách cả nhóm: response báo outcome repriced cho member', dissolve.memberFreightOutcomes.some(o => o.shipmentId === lotA2.shipmentId && o.outcome === 'repriced' && o.price === 2_400_000),
    JSON.stringify(dissolve.memberFreightOutcomes));

  // ── D3. Tách cả nhóm KHÔNG bảng giá: stamped 0₫ clear về null honest ────
  await assignLclCostGroup({
    shipmentIds: [lotB1.shipmentId, lotB2.shipmentId],
    vehicleSizeClassId: vehicleClass.id,
    actualTruckNo: '15C-999.99',
    carrierId: carrier.id,
  }, actor);
  const mergeB2 = await tripFreight(lotB2.tripId);
  const [groupB] = await db.select({ id: s.shipments.costGroupId }).from(s.shipments).where(eq(s.shipments.id, lotB1.shipmentId));
  const dissolveB = await unmergeLclGroup({ dimension: 'COST', groupId: groupB!.id! }, actor);
  const afterB2 = await tripFreight(lotB2.tripId);
  check('D3 merge không giá: member vẫn stamped 0₫', mergeB2?.externalFreightCost === '0', `freight=${mergeB2?.externalFreightCost}`);
  check('D3 tách không giá: stamped 0₫ bị XÓA về null (Thiếu cước trả ĐV honest — không 0₫ trần trừi)', afterB2?.externalFreightCost == null, `freight=${afterB2?.externalFreightCost}`);
  check('D3 tách không giá: planned_carrier_cost cũng clear về null', await plannedCost(lotB2.shipmentId) == null, `planned=${await plannedCost(lotB2.shipmentId)}`);
  check('D3 response báo outcome cleared', dissolveB.memberFreightOutcomes.some(o => o.shipmentId === lotB2.shipmentId && o.outcome === 'cleared'),
    JSON.stringify(dissolveB.memberFreightOutcomes));

  // ── D4. Tách 1 lô member (order 2) rời nhóm COST: re-price hit ──────────
  await assignLclCostGroup({
    shipmentIds: [lotC1.shipmentId, lotC2.shipmentId],
    vehicleSizeClassId: vehicleClass.id,
    actualTruckNo: '15C-999.99',
    carrierId: carrier.id,
  }, actor);
  const unmergeLot = await unmergeLclLot({ dimension: 'COST', shipmentId: lotC2.shipmentId }, actor);
  const afterC2 = await tripFreight(lotC2.tripId);
  check('D4 tách 1 lô về riêng: leaver về ĐÚNG 2.400.000₫ (không kẹt 0₫)', afterC2?.externalFreightCost === '2400000', `freight=${afterC2?.externalFreightCost}`);
  check('D4 outcome leaver repriced', unmergeLot.leaverFreightOutcome?.outcome === 'repriced' && unmergeLot.leaverFreightOutcome?.price === 2_400_000,
    JSON.stringify(unmergeLot.leaverFreightOutcome));

  // ── Cleanup ─────────────────────────────────────────────────────────────
  for (const run of cleanup) {
    await run();
  }
  console.log(failures.length === 0 ? 'PROBE GREEN — mọi assertion PASS' : `PROBE RED — ${failures.length} assertion FAIL`);
  await disconnectRedis().catch(() => {});
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('PROBE ERROR', error);
  for (const run of cleanup) {
    await run().catch(() => {});
  }
  process.exit(1);
});
