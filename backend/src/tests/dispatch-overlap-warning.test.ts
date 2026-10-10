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
// the appointment is absent (the repro's "identical slot" evidence).
async function makeFixture(
  a: DispatchActor,
  opts: { appointment: Date | null; closingAt: Date | null },
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
