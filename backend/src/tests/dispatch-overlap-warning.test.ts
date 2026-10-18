// Card 101026043000 — "cảnh báo trùng giờ xe không nổ" (FB-038 class): the
// plan editor saved a same-rig double-booking with NO warning whenever the
// overlap evidence rode anything weaker than an explicit container
// appointment. The repro (admin, staging, 2026-10-10): truck 15H-118.47
// already assigned to EEUU1234702 at slot 08:45 01/10/2026 (Đã phát lệnh cho
// tài xế), then the SAME truck assigned to BLCUSaA8B3 at the IDENTICAL slot
// via "Chỉnh sửa điều phối" → "Lưu thay đổi" saved silently.
//
// The shared overlap-detection owner (assertPlanRowRigAvailable +
// resolvePlanRowWindowStart, dispatch-planning-detail-plan.service.ts) had
// two evidence holes that silently disproved every scan:
//   1. the saving row's window resolved from customerAppointmentAt ONLY while
//      every surface's "slot" reads coalesce(appointment, closingAt,
//      plannedReturnAt) — a row whose slot rides the lot fallback got
//      windowStart = null and the whole guard was skipped;
//   2. a staged "Giờ trả hàng" at/before the slot collapsed the window to
//      zero (lt(slot, windowEnd) false everywhere).
// FB-038 ruling: the restored detection must WARN (the family's warn-once
// confirm; the confirmed save proceeds) — never a silent save, never a new
// hard block. Fully-evidenced overlaps keep their pinned tiers untouched.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import type { DispatchActor } from '../services/dispatch-planning-utils.service';
import { updateDispatchDetailPlan } from '../services/dispatch-planning-detail-plan.service';
import { assertTripRigAvailable } from '../services/dispatch-plan-conflict-scan.service';
import { assignLclCostGroup } from '../services/lcl-grouping.service';

async function insertTrip(values: typeof s.trips.$inferInsert) {
  const [row] = await db.insert(s.trips).values(values).returning();
  return row;
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const siteIds: number[] = [];
const containerTypeIds: number[] = [];
const shipmentIds: number[] = [];
const truckIds: number[] = [];
let keySeq = 0;

async function actor(): Promise<DispatchActor> {
  const [row] = await db.insert(s.users).values({
    username: `warn-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning();
  userIds.push(row.id);
  return { userId: row.id, username: row.username, email: null, fullName: null, role: Role.ADMIN };
}

type Fixture = {
  actor: DispatchActor;
  customerId: number;
  routeId: number;
  shipmentId: number;
  fulfillmentId: number;
  fulfillmentVersion: number;
  shipmentVersion: number;
  containerId: number;
  truckPlate: string;
  truckId: number;
};

// One lot + fulfillment + truck. `appointment` is the container's explicit
// slot; `closingAt` is the lot-level fallback the grid's runAt renders when
// the appointment is absent (the repro's "identical slot" evidence);
// `expectedDeliveryDate` is the lot "Ngày giao" projection — the date column
// every grid displays for a row without an appointment date.
async function makeFixture(
  a: DispatchActor,
  opts: { appointment: Date | null; closingAt: Date | null; expectedDeliveryDate?: string | null },
): Promise<Fixture> {
  const [customer] = await db.insert(s.customers).values({ name: `Warn KH ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Warn Tuyen ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const [site] = await db.insert(s.operationalSites).values({
    customerId: customer.id,
    code: `WN-${suffix}-${siteIds.length}`,
    name: `Warn NM ${suffix}`,
    siteType: 'FACTORY',
    address: 'KCN Sóng Thần, Bình Dương',
  }).returning();
  siteIds.push(site.id);
  const [ctype] = await db.insert(s.containerTypes).values({
    code: `20GWN${containerTypeIds.length}${suffix.slice(-4)}`.slice(0, 20),
    name: `Container 20 feet ${suffix}`,
  }).returning();
  containerTypeIds.push(ctype.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    cargoMode: 'FCL',
    shipmentCode: `WARN-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: opts.closingAt,
    expectedDeliveryDate: opts.expectedDeliveryDate ?? null,
    createdBy: a.userId,
  }).returning();
  shipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    routeId: route.id,
    operationalSiteId: site.id,
    containerTypeId: ctype.id,
    containerNumber: `WN${shipmentIds.length}${suffix.slice(-5)}`.toUpperCase(),
    customerAppointmentAt: opts.appointment,
    createdBy: a.userId,
  }).returning();
  const [ff] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    shipmentContainerId: container.id,
    sourceShipmentVersion: shipment.version,
    createdBy: a.userId,
  }).returning();
  const plate = `WN-${suffix.slice(-4)}-${truckIds.length}`.toUpperCase();
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plate, status: 'ACTIVE' }).returning();
  truckIds.push(truck.id);
  return {
    actor: a,
    customerId: customer.id,
    routeId: route.id,
    shipmentId: shipment.id,
    fulfillmentId: ff.id,
    fulfillmentVersion: ff.version,
    shipmentVersion: shipment.version,
    containerId: container.id,
    truckPlate: plate,
    truckId: truck.id,
  };
}

function saveInput(fx: Fixture, extra: { plannedEndAt?: string } = {}) {
  return {
    fulfillmentId: fx.fulfillmentId,
    expectedFulfillmentVersion: fx.fulfillmentVersion,
    expectedShipmentVersion: fx.shipmentVersion,
    carrierType: 'OWN' as const,
    truckId: fx.truckId,
    plannedRevenue: null,
    plannedCarrierCost: null,
    ...extra,
    idempotencyKey: `warn-${suffix}-${keySeq++}`,
    actor: fx.actor,
  };
}

// The repro's slot: 08:45 01/10/2026 Asia/Ho_Chi_Minh.
const SLOT = new Date('2026-10-01T01:45:00.000Z');

async function expectWarnThenProceed(input: object, label: string) {
  await assert.rejects(
    () => updateDispatchDetailPlan(input as never),
    (error: unknown) => {
      const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
      assert.equal(e.statusCode, 409, `${label}: expected a warn refusal, got: ${e.message}`);
      assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED',
        `${label}: expected the family overlap-warn payload, got: ${e.message}`);
      assert.match(String(e.message), /Vẫn lưu/, `${label}: warn copy must invite the confirm`);
      return true;
    },
  );
}

describe('card 101026043000 — the overlap warning fires on weak slot evidence (FB-038 ruling: warn, not block)', () => {
  test('the repro: a fallback slot + an issued trip on the same rig warns, and the confirmed save proceeds', async () => {
    const a = await actor();
    // The holder (EEUU1234702-shaped): explicit appointment + an ISSUED trip
    // (CREATED) riding the truck at the slot.
    const holder = await makeFixture(a, { appointment: SLOT, closingAt: null });
    // The target (BLCUSaA8B3-shaped): its displayed slot 08:45 rides the LOT
    // fallback — the container carries no customerAppointmentAt.
    const target = await makeFixture(a, { appointment: null, closingAt: SLOT });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));
    await insertTrip({
      tripCode: `WARN-TRIP-A-${suffix}`,
      customerId: holder.customerId,
      routeId: holder.routeId,
      departureDate: '2026-10-01',
      truckId: target.truckId,
      fulfillmentId: holder.fulfillmentId,
      plannedStartAt: SLOT,
      plannedEndAt: null,
      status: 'CREATED',
      createdBy: a.userId,
    });

    await expectWarnThenProceed(saveInput(target), 'repro');

    const saved = await updateDispatchDetailPlan({
      ...saveInput(target),
      rigOverlapCompletedConfirmed: true,
    } as never);
    assert.ok(saved, 'the confirmed retry must proceed (FB-038: warning only)');
  });

  test('a staged Giờ trả hàng at the identical slot warns instead of collapsing the window to silence', async () => {
    const a = await actor();
    const holder = await makeFixture(a, { appointment: SLOT, closingAt: null });
    const target = await makeFixture(a, { appointment: SLOT, closingAt: null });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));
    await insertTrip({
      tripCode: `WARN-TRIP-B-${suffix}`,
      customerId: holder.customerId,
      routeId: holder.routeId,
      departureDate: '2026-10-01',
      truckId: target.truckId,
      fulfillmentId: holder.fulfillmentId,
      plannedStartAt: SLOT,
      plannedEndAt: null,
      status: 'CREATED',
      createdBy: a.userId,
    });

    // Giờ trả hàng staged at the IDENTICAL slot: the window must not collapse
    // to zero and silently disprove the overlap (the card-363 8h law covers
    // an unprovable end).
    await expectWarnThenProceed(
      saveInput(target, { plannedEndAt: SLOT.toISOString() }), 'degenerate end');

    const saved = await updateDispatchDetailPlan({
      ...saveInput(target, { plannedEndAt: SLOT.toISOString() }),
      rigOverlapCompletedConfirmed: true,
    } as never);
    assert.ok(saved);
  });

  test('control: a clean fallback-slot save passes untouched — no overlap, no warning', async () => {
    const a = await actor();
    const target = await makeFixture(a, { appointment: null, closingAt: SLOT });
    const saved = await updateDispatchDetailPlan(saveInput(target) as never);
    assert.ok(saved);
  });

  test('control: the fully-evidenced active overlap still hard blocks — evidence restoration never softens the pinned tier', async () => {
    const a = await actor();
    const holder = await makeFixture(a, { appointment: SLOT, closingAt: null });
    const target = await makeFixture(a, { appointment: SLOT, closingAt: null });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));
    await insertTrip({
      tripCode: `WARN-TRIP-C-${suffix}`,
      customerId: holder.customerId,
      routeId: holder.routeId,
      departureDate: '2026-10-01',
      truckId: target.truckId,
      fulfillmentId: holder.fulfillmentId,
      plannedStartAt: SLOT,
      plannedEndAt: null,
      status: 'CREATED',
      createdBy: a.userId,
    });

    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(target) as never),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409);
        assert.equal(e.payload?.code, undefined,
          `a provable active overlap must keep the hard block, not warn: ${e.message}`);
        assert.match(String(e.message), /khung giờ trùng lặp/);
        return true;
      },
    );
  });

  test('the round-14 repro: two plan rows sharing only the displayed "Ngày giao" lot date warn (case 2026-10-11-R14-04)', async () => {
    const a = await actor();
    // Both rows display "Ngày giao 01/10/2026" from the lot
    // expectedDeliveryDate projection alone — no appointment, no closing/
    // return. The window law read only appointment ?? closing ?? plannedReturn,
    // so this exact pair saved silently through "Chỉnh sửa điều phối" (local UI
    // rung 2026-10-11: two same-slot rows both took truck 15C-167.31 with no
    // warning). The displayed slot is the dispatcher's claim on the rig.
    const holder = await makeFixture(a, { appointment: null, closingAt: null, expectedDeliveryDate: '2026-10-01' });
    const target = await makeFixture(a, { appointment: null, closingAt: null, expectedDeliveryDate: '2026-10-01' });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));

    await expectWarnThenProceed(saveInput(target), 'ngày-giao-only pair');

    const saved = await updateDispatchDetailPlan({
      ...saveInput(target),
      rigOverlapCompletedConfirmed: true,
    } as never);
    assert.ok(saved, 'the confirmed retry must proceed (warn, never a hard block)');
  });

  test('a date-only "Ngày giao" claim covers the displayed day — a same-day afternoon slot warns', async () => {
    const a = await actor();
    // The grid shows the date-only row beside "13H 01/10/2026" — one rig
    // cannot run both, so the day claim must reach the afternoon slot too.
    const holder = await makeFixture(a, { appointment: null, closingAt: null, expectedDeliveryDate: '2026-10-01' });
    const target = await makeFixture(a, { appointment: new Date('2026-10-01T06:00:00.000Z'), closingAt: null });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));

    await expectWarnThenProceed(saveInput(target), 'afternoon slot vs ngày-giao day claim');
  });

  test('control: date-only rows on different "Ngày giao" days save untouched', async () => {
    const a = await actor();
    const holder = await makeFixture(a, { appointment: null, closingAt: null, expectedDeliveryDate: '2026-10-01' });
    const target = await makeFixture(a, { appointment: null, closingAt: null, expectedDeliveryDate: '2026-10-03' });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));

    const saved = await updateDispatchDetailPlan(saveInput(target) as never);
    assert.ok(saved, 'different displayed days are not an overlap');
  });

  test('an LCL date-only holder stays weak evidence: the confirmed save has a path on (case 2026-10-11-R14-04 review B1)', async () => {
    const a = await actor();
    // Holder: a whole-lot LCL_SHIPMENT fulfillment whose only slot is the
    // displayed "Ngày giao" lot date — the same date-only evidence the FCL
    // branch warns on. An LCL row riding closingAt/plannedReturnAt is its
    // PRIMARY slot (full evidence, card 061026174603); the date-only
    // fallback is display evidence and must never pin the hard tier —
    // otherwise the warn's own confirm dead-ends ("Vẫn lưu?" with no path on).
    const holder = await makeFixture(a, { appointment: null, closingAt: null, expectedDeliveryDate: '2026-10-01' });
    await db.update(s.shipmentFulfillments)
      .set({ fulfillmentType: 'LCL_SHIPMENT', shipmentContainerId: null, dispatchClassification: 'LCL' })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));
    // Target: a fully-evidenced FCL row (explicit appointment) on the same rig.
    const target = await makeFixture(a, { appointment: SLOT, closingAt: null });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));

    await expectWarnThenProceed(saveInput(target), 'LCL date-only holder');

    const saved = await updateDispatchDetailPlan({
      ...saveInput(target),
      rigOverlapCompletedConfirmed: true,
    } as never);
    assert.ok(saved, 'the confirmed retry must proceed — the warn tier must never dead-end');
  });

  test('a provable cross-lot LCL holder keeps the HARD tier — the FCL scan must not leak it in as weak evidence (review M1)', async () => {
    const a = await actor();
    // Holder: a whole-lot LCL_SHIPMENT fulfillment whose closingAt IS its
    // primary slot (full evidence, card 061026174603). The holder scan's
    // left join once admitted LCL rows into the FCL branch, where their
    // null container columns forced fallbackSlot=true and downgraded this
    // fully-evidenced cross-lot overlap to a warn. The FCL scan excludes
    // LCL_SHIPMENT holders; the LCL scan carries the provable slot, so the
    // pinned hard tier survives.
    const holder = await makeFixture(a, { appointment: null, closingAt: SLOT, expectedDeliveryDate: null });
    await db.update(s.shipmentFulfillments)
      .set({ fulfillmentType: 'LCL_SHIPMENT', shipmentContainerId: null, dispatchClassification: 'LCL' })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));
    // Target: a fully-evidenced FCL row (explicit appointment) on the same rig.
    const target = await makeFixture(a, { appointment: SLOT, closingAt: null });
    await db.update(s.shipmentFulfillments)
      .set({ plannedVehiclePlateNumber: target.truckPlate })
      .where(eq(s.shipmentFulfillments.id, holder.fulfillmentId));

    await assert.rejects(
      () => updateDispatchDetailPlan(saveInput(target) as never),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the hard block, got: ${e.message}`);
        assert.equal(e.payload?.code, undefined,
          `a provable LCL closingAt overlap must keep the hard tier, not warn: ${e.message}`);
        assert.match(String(e.message), /khung giờ trùng lặp/);
        return true;
      },
    );
  });
});

// ─── Card 191026100010 (B.4) — cost-group siblings of "Gán xe nhóm" ─────────
//
// FB-092 "Gán xe nhóm" puts N LCL lots in ONE cost group on ONE tractor ON
// PURPOSE: assignLclCostGroup stamps the group's plate onto every member's
// plan row, so lot 2's editor save sees lot 1 as a cross-lot holder with a
// STRONG LCL slot (closingAt ⇒ fallbackSlot=false) and used to refuse HARD:
// "Đầu xe X đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp."
// — while one group = one truck is the very point of the feature. FB-012
// (181026145600) already split SAME-lot holders out of the hard tier
// (warn-once + confirm retry); this card extends that same RIG_OVERLAP class
// to cross-lot holders sharing the SAVING row's costGroupId. Everything else
// keeps its pinned tier: no shared group ⇒ hard, Kẹp carve-out untouched,
// completed-trip tier untouched, weak-evidence warn unchanged.

type LclLotFixture = {
  shipmentId: number;
  fulfillmentId: number;
  shipmentVersion: number;
  fulfillmentVersion: number;
};

/** One LCL lot + its whole-lot LCL_SHIPMENT plan row (card 061026174603
 *  shape). `plate` stamps the row directly — the pre-grouping manual
 *  assignment; grouped fixtures get the plate from assignLclCostGroup. */
async function insertLclLot(
  a: DispatchActor,
  opts: {
    customerId: number;
    routeId: number;
    closingAt: Date | null;
    expectedDeliveryDate?: string;
    plate?: string;
  },
): Promise<LclLotFixture> {
  const [shipment] = await db.insert(s.shipments).values({
    customerId: opts.customerId,
    routeId: opts.routeId,
    cargoMode: 'LCL',
    tradeDirection: 'IMPORT',
    shipmentCode: `B4-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    closingAt: opts.closingAt,
    expectedDeliveryDate: opts.expectedDeliveryDate ?? null,
    createdBy: a.userId,
  }).returning();
  shipmentIds.push(shipment.id);
  const [ff] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
    createdBy: a.userId,
  }).returning();
  if (opts.plate != null) {
    await db.update(s.shipmentFulfillments)
      .set({ plannedCarrierType: 'OWN', plannedVehiclePlateNumber: opts.plate })
      .where(eq(s.shipmentFulfillments.id, ff.id));
  }
  return {
    shipmentId: shipment.id,
    fulfillmentId: ff.id,
    shipmentVersion: shipment.version,
    fulfillmentVersion: ff.version,
  };
}

/** The real grouping write (FB-092): costGroupId on every lot, the group
 *  plate onto every member's plan row (persistLclCostCarrier), versions
 *  bumped — callers must re-read what the editor will save with. */
async function groupLclLots(a: DispatchActor, shipmentIdsToGroup: number[], plate: string) {
  const [truckClass] = await db.select().from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, 'CONT20')).limit(1);
  assert.ok(truckClass, 'seeded vehicle class CONT20 exists');
  await assignLclCostGroup({
    shipmentIds: shipmentIdsToGroup,
    vehicleSizeClassId: truckClass.id,
    actualTruckNo: plate,
  }, { userId: a.userId, role: 'ADMIN', actorName: 'card 191026100010' });
}

/** Two LCL lots on ONE internal tractor — the deliberate "Gán xe nhóm"
 *  arrangement. `grouped` runs the REAL assignLclCostGroup (costGroupId +
 *  group plate on both members); without it the pair is a plain cross-lot
 *  overlap — the negative pin: no shared group ⇒ the hard block survives. */
async function makeLclTruckPair(
  a: DispatchActor,
  opts: { closingAt: Date; grouped: boolean },
) {
  const [customer] = await db.insert(s.customers)
    .values({ name: `B4 KH ${suffix}-${customerIds.length}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `B4 Tuyen ${suffix}-${routeIds.length}` }).returning();
  routeIds.push(route.id);
  const plate = `B4${suffix.slice(-6)}${truckIds.length}`.toUpperCase();
  const [truck] = await db.insert(s.trucks)
    .values({ licensePlate: plate, status: 'ACTIVE' }).returning();
  truckIds.push(truck.id);
  const lotOpts = { customerId: customer.id, routeId: route.id, closingAt: opts.closingAt };
  const lots = [
    await insertLclLot(a, { ...lotOpts, ...(opts.grouped ? {} : { plate }) }),
    await insertLclLot(a, { ...lotOpts, ...(opts.grouped ? {} : { plate }) }),
  ];
  if (opts.grouped) {
    await groupLclLots(a, lots.map((lot) => lot.shipmentId), plate);
    for (const lot of lots) {
      const [freshShipment] = await db.select().from(s.shipments)
        .where(eq(s.shipments.id, lot.shipmentId)).limit(1);
      const [freshFf] = await db.select().from(s.shipmentFulfillments)
        .where(eq(s.shipmentFulfillments.id, lot.fulfillmentId)).limit(1);
      lot.shipmentVersion = freshShipment.version;
      lot.fulfillmentVersion = freshFf.version;
    }
  }
  return { truck, lots, customerId: customer.id, routeId: route.id };
}

function lclSaveInput(a: DispatchActor, truckId: number, lot: LclLotFixture) {
  return {
    fulfillmentId: lot.fulfillmentId,
    expectedFulfillmentVersion: lot.fulfillmentVersion,
    expectedShipmentVersion: lot.shipmentVersion,
    carrierType: 'OWN' as const,
    truckId,
    plannedRevenue: null,
    plannedCarrierCost: null,
    idempotencyKey: `b4-${suffix}-${keySeq++}`,
    actor: a,
  };
}

describe('card 191026100010 (B.4) — a shared cost group ("Gán xe nhóm") rides the warn tier, never a new hard block', () => {
  test('DV-B4-01: saving lot 2 of a one-truck cost group warns once (RIG_OVERLAP_COMPLETED + "Vẫn lưu?"), the confirmed retry saves, the same save does not ask again', async () => {
    const a = await actor();
    const { truck, lots } = await makeLclTruckPair(a, { closingAt: SLOT, grouped: true });
    const target = lots[1]!;
    const input = lclSaveInput(a, truck.id, target);

    // RED-FIRST (pre-B.4): 409 with NO payload code and the plain hard
    // message "Đầu xe <plate> đã được gán cho lô/tác vụ khác trong khung
    // giờ trùng lặp." — the card's exact blocker.
    await assert.rejects(
      () => updateDispatchDetailPlan(input),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected a 409 refusal, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED',
          `a cost-group sibling must WARN, not hard-block (card 191026100010 / FB-012 181026145600) — got: ${e.message}`);
        assert.ok(String(e.message).endsWith('Vẫn lưu?'),
          `warn copy must end with "Vẫn lưu?", got: ${e.message}`);
        return true;
      },
    );

    const saved = await updateDispatchDetailPlan({ ...input, rigOverlapCompletedConfirmed: true });
    assert.ok(saved, 'the confirmed retry must proceed (warn-once is never a dead end)');

    // Warn-once: re-saving the confirmed transaction replays the stored
    // result — it must not ask a third time (testplan DV-B4-01).
    const replayed = await updateDispatchDetailPlan(input);
    assert.ok(replayed, 'the confirmed save must not ask again');
  });

  test('negative pin: the same cross-lot overlap with NO shared cost group keeps the plain HARD block', async () => {
    const a = await actor();
    const { truck, lots } = await makeLclTruckPair(a, { closingAt: SLOT, grouped: false });
    const target = lots[1]!;

    await assert.rejects(
      () => updateDispatchDetailPlan(lclSaveInput(a, truck.id, target)),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the hard block, got: ${e.message}`);
        assert.equal(e.payload?.code, undefined,
          `cross-lot without a shared cost group must keep the hard tier: ${e.message}`);
        assert.match(e.message ?? '',
          new RegExp(`^Đầu xe ${truck.licensePlate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp(: Lô .+)?\\.$`),
          `cross-lot without a shared cost group must keep the plain HARD block: ${e.message}`);
        return true;
      },
    );
  });

  test('mixed set (decision rule 4): a cost-group sibling — even date-only weak — must not downgrade the TRUE cross-lot holder\'s hard block', async () => {
    const a = await actor();
    const { truck, lots, customerId, routeId } = await makeLclTruckPair(a, { closingAt: SLOT, grouped: true });
    const [holder, target] = lots;
    // The grouped sibling degrades to date-only evidence (fallbackSlot=true):
    // its slot must never leak into weakEvidence for the true holder below.
    await db.update(s.shipments)
      .set({ closingAt: null, expectedDeliveryDate: '2026-10-01' })
      .where(eq(s.shipments.id, holder!.shipmentId));
    // The TRUE cross-lot holder: same rig, strong slot, NO shared group.
    await insertLclLot(a, { customerId, routeId, closingAt: SLOT, plate: truck.licensePlate });

    await assert.rejects(
      () => updateDispatchDetailPlan(lclSaveInput(a, truck.id, target!)),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected the hard block, got: ${e.message}`);
        assert.equal(e.payload?.code, undefined,
          `the true cross-lot holder must keep the HARD tier even beside a grouped sibling: ${e.message}`);
        assert.match(e.message ?? '',
          new RegExp(`^Đầu xe ${truck.licensePlate} đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp(: Lô .+)?\\.$`),
          `the true cross-lot holder must keep the HARD tier even beside a grouped sibling: ${e.message}`);
        return true;
      },
    );
  });

  test('trip form mirrors the split (decision rule 5): grouped sibling warns once, the confirmed save proceeds', async () => {
    const a = await actor();
    const { truck, lots } = await makeLclTruckPair(a, { closingAt: SLOT, grouped: true });
    const target = lots[1]!;
    const args = {
      truckId: truck.id,
      departureDate: '2026-10-01',
      plannedStartAt: SLOT,
      plannedEndAt: null as Date | null,
      fulfillmentId: target.fulfillmentId,
      shipmentId: target.shipmentId,
    };

    // RED-FIRST (pre-B.4): assertTripRigAvailable hard-blocks the same
    // message with no confirm path.
    await assert.rejects(
      () => db.transaction((tx) => assertTripRigAvailable(tx, args)),
      (error: unknown) => {
        const e = error as { statusCode?: number; payload?: { code?: string }; message?: string };
        assert.equal(e.statusCode, 409, `expected a 409 refusal, got: ${e.message}`);
        assert.equal(e.payload?.code, 'RIG_OVERLAP_COMPLETED',
          `trip form: a cost-group sibling must WARN, not hard-block (card 191026100010) — got: ${e.message}`);
        assert.ok(String(e.message).endsWith('Vẫn lưu?'),
          `warn copy must end with "Vẫn lưu?", got: ${e.message}`);
        return true;
      },
    );

    await db.transaction((tx) => assertTripRigAvailable(tx, { ...args, confirmOverlap: true }));
  });
});

after(async () => {
  try {
    if (shipmentIds.length) {
      await db.delete(s.trips).where(inArray(s.trips.shipmentId, shipmentIds));
    }
    if (truckIds.length) {
      await db.delete(s.trips).where(inArray(s.trips.truckId, truckIds));
      await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.truckId, truckIds));
      await db.delete(s.trucks).where(inArray(s.trucks.id, truckIds));
    }
    if (shipmentIds.length) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
    if (siteIds.length) await db.delete(s.operationalSites).where(inArray(s.operationalSites.id, siteIds));
    if (containerTypeIds.length) await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } finally {
    await client.end({ timeout: 5 });
    await disconnectRedis();
  }
});
