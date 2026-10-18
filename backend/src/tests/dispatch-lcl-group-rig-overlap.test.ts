// Card B 18/10 (B.4) — the "đã gáp cho lô tác vụ khác trong khung giờ trùng"
// report. RED-FIRST on the false positive: an LCL cost group ("Ghép trả ĐV")
// puts every member lot on ONE truck in ONE window BY DESIGN — the same
// deliberate-overlap law the Kẹp carve-out and the same-lot rotation already
// carry. The plan-row rig guard counted the group's sibling lots as CROSS-lot
// claims, and with strong windows (LCL closingAt/return timestamps — strong:
// true per resolvePlanRowWindow) that took the HARD tier:
//   409 "Đầu xe X đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp."
// with NO confirm payload — saving any member's plan after a group assignment
// (re-picking the group truck, adjusting a member) died with no path on.
// Desired: same-cost-group siblings land at the family's WARN tier
// (RIG_OVERLAP_COMPLETED, "Vẫn lưu?", message naming the group), and the
// confirmed retry proceeds. A TRUE cross-lot overlap with strong windows must
// keep the hard block (control test).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { DispatchActor } from '../services/dispatch-planning-utils.service';
import { updateDispatchDetailPlan } from '../services/dispatch-planning-detail-plan.service';
import { assignLclCostGroup } from '../services/lcl-grouping.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let plateSeq = 0;
/** Unique per test: each case builds its own rig identity. */
const mkPlate = () => `29X-B4${suffix.slice(-4).toUpperCase()}${++plateSeq}`;
/** Strong LCL window: a real closing timestamp makes the row's slot
 *  full-evidence (resolvePlanRowWindow: LCL lot date IS primary evidence). */
const CLOSING_AT = new Date('2026-11-04T03:00:00.000Z');

const userIds: number[] = [];
const customerIds: number[] = [];
const carrierIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const fulfillmentIds: number[] = [];
const groupActor = { userId: 1, role: 'ADMIN', actorName: `card-b4 ${suffix}` };
let keySeq = 0;

after(async () => {
  await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
  await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  await db.delete(s.customers).where(inArray(s.customers.id, [...customerIds, ...carrierIds]));
  await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  await db.delete(s.users).where(inArray(s.users.id, userIds));
  await client.end();
  await disconnectRedis();
});

async function actor(): Promise<DispatchActor> {
  const [row] = await db.insert(s.users).values({
    username: `b4-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  userIds.push(row.id);
  return { userId: row.id, username: row.username, email: null, fullName: null, role: Role.ADMIN };
}

async function mkCarrier() {
  const [carrier] = await db.insert(s.customers).values({
    name: `B4 nhà xe ${suffix}-${carrierIds.length}`,
    isCarrier: true,
    status: 'ACTIVE',
  }).returning();
  carrierIds.push(carrier.id);
  return carrier;
}

/** One LCL lot with a STRONG window (closingAt) + its whole-lot fulfillment. */
async function mkLclLot(customerId: number, routeId: number, ref: string) {
  const [shipment] = await db.insert(s.shipments).values({
    customerId,
    blNumber: ref,
    tradeDirection: 'IMPORT',
    cargoMode: 'LCL',
    status: 'READY_FOR_DISPATCH',
    expectedDeliveryDate: '2026-11-04',
    closingAt: CLOSING_AT,
    routeId,
    packageCount: 3,
    packageType: 'PALLET',
  }).returning();
  shipmentIds.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  fulfillmentIds.push(fulfillment.id);
  return { shipment, fulfillment };
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({ name: `B4 tuyến ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  return route;
}

async function vehicleClassCont20() {
  const [vehicleClass] = await db.select().from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, 'CONT20')).limit(1);
  assert.ok(vehicleClass, 'seeded CONT20 vehicle class exists');
  return vehicleClass;
}

/** Re-read the fulfillment + shipment versions the group assignment bumped. */
async function versions(shipmentId: number) {
  const [fulfillment] = await db.select({
    id: s.shipmentFulfillments.id,
    version: s.shipmentFulfillments.version,
    shipmentVersion: s.shipments.version,
  }).from(s.shipmentFulfillments)
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(eq(s.shipmentFulfillments.shipmentId, shipmentId))
    .limit(1);
  assert.ok(fulfillment, `fulfillment of lot ${shipmentId} exists`);
  return fulfillment;
}

function planSave(args: {
  a: DispatchActor;
  fulfillment: { id: number; version: number; shipmentVersion: number };
  carrierId: number;
  plate: string;
  confirm?: boolean;
}) {
  keySeq += 1;
  return updateDispatchDetailPlan({
    actor: args.a,
    idempotencyKey: `b4-${suffix}-${keySeq}`,
    fulfillmentId: args.fulfillment.id,
    expectedFulfillmentVersion: args.fulfillment.version,
    expectedShipmentVersion: args.fulfillment.shipmentVersion,
    carrierType: 'EXTERNAL',
    externalCarrierId: args.carrierId,
    plateNumber: args.plate,
    plannedRevenue: null,
    plannedCarrierCost: null,
    rigOverlapCompletedConfirmed: args.confirm === true,
  });
}

describe('card B.4 — LCL cost-group siblings warn, never hard-block (red-first)', () => {
  test('saving one member of a Ghép trả ĐV group warns once and the confirmed retry proceeds', async () => {
    const a = await actor();
    const carrier = await mkCarrier();
    const route = await mkRoute();
    const lot1 = await mkLclLot(carrier.id, route.id, `B4-GRP-${suffix}-1`);
    const lot2 = await mkLclLot(carrier.id, route.id, `B4-GRP-${suffix}-2`);
    const vehicleClass = await vehicleClassCont20();
    const PLATE = mkPlate();

    // "Gán xe nhóm" — both members land on PLATE with the group's shared
    // window (persistLclCostCarrier writes the planned plate on both).
    await assignLclCostGroup({
      shipmentIds: [lot1.shipment.id, lot2.shipment.id],
      vehicleSizeClassId: vehicleClass.id,
      actualTruckNo: PLATE,
      carrierId: carrier.id,
      carrierType: 'EXTERNAL',
    }, groupActor);

    const fulfillment2 = await versions(lot2.shipment.id);

    // At HEAD this hard-409s with "…lô/tác vụ khác trong khung giờ trùng
    // lặp." and NO confirm payload — the sibling is the group's OWN truck
    // arrangement, not a cross-lot claim. Desired: the warn-once payload.
    await assert.rejects(
      () => planSave({ a, fulfillment: fulfillment2, carrierId: carrier.id, plate: PLATE }),
      (err: unknown) => {
        assert.ok(err instanceof Error, `expected an ApiError, got ${String(err)}`);
        const apiErr = err as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(apiErr.statusCode, 409, `expected 409, got ${apiErr.statusCode}: ${apiErr.message}`);
        // THE fix assertion: the sibling lands at the WARN tier, never the
        // hard tier (hard = no payload code).
        assert.equal(apiErr.payload?.code, 'RIG_OVERLAP_COMPLETED',
          `same-group sibling must warn (got: ${apiErr.message})`);
        assert.match(apiErr.message ?? '', /Vẫn lưu\?/, 'the warn carries the confirm question');
        // The message names what the conflict IS (the ghép group), not a
        // generic other-lot claim.
        assert.match(apiErr.message ?? '', /nhóm ghép|lô 1/i);
        return true;
      },
      'saving a group member re-picking the group truck must warn, not hard-block',
    );

    // Confirmed retry proceeds.
    const saved = await planSave({ a, fulfillment: fulfillment2, carrierId: carrier.id, plate: PLATE, confirm: true });
    assert.equal(saved.fulfillmentId, fulfillment2.id);
  });

  test('control — two UNRELATED LCL lots on one plate in one strong window still hard-block', async () => {
    const a = await actor();
    const carrier = await mkCarrier();
    const route = await mkRoute();
    const PLATE = mkPlate();
    const lotA = await mkLclLot(carrier.id, route.id, `B4-CTL-${suffix}-A`);
    const lotB = await mkLclLot(carrier.id, route.id, `B4-CTL-${suffix}-B`);

    // Assign lotA to the plate directly (plan save, no group).
    const fulfillmentA = await versions(lotA.shipment.id);
    await planSave({ a, fulfillment: fulfillmentA, carrierId: carrier.id, plate: PLATE });
    const fulfillmentB = await versions(lotB.shipment.id);

    // lotB claiming the same rig in the same strong window is a REAL
    // cross-lot claim — the hard tier stands (no confirm path).
    await assert.rejects(
      () => planSave({ a, fulfillment: fulfillmentB, carrierId: carrier.id, plate: PLATE }),
      (err: unknown) => {
        const apiErr = err as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(apiErr.statusCode, 409);
        assert.equal(apiErr.payload?.code, undefined, 'a true cross-lot claim keeps the hard block');
        assert.match(apiErr.message ?? '', /lô\/tác vụ khác trong khung giờ trùng lặp/);
        return true;
      },
      'unrelated lots on one proven window must keep the hard block',
    );
  });
});
