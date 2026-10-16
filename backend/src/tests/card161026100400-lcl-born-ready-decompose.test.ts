/**
 * Card 161026100400 — lô lẻ sinh-ready không hiện trên "Kế hoạch Chi tiết Xe".
 *
 * Staging reproduced the INCONSISTENCY (10:03 lot VIS-TEST-01 absent; 10:52
 * and 12:02 lots visible right after create). Root cause: createShipmentTx
 * never decomposed a lot born READY_FOR_DISPATCH into shipment fulfillments,
 * and the detail plan's fulfillment-less union branch is FCL-only (inner join
 * on container rows — LCL lots own none by law), so an undecomposed LCL lot
 * was invisible until some later write (update / submit / allocation)
 * decomposed it. Lots that went through such a write appeared; lots that did
 * not stayed hidden — exactly the flaky pattern the card reported.
 *
 * The fix mirrors BUG 5's becomesReady branch (shipment-update.service):
 * decompose born-ready LCL lots inside the create transaction, with the same
 * intake actor + allowClerkIntake contract. FB-092's display law is unchanged
 * — an unassigned LCL row still renders bare "Lẻ"; the fix only guarantees the
 * row EXISTS.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createShipment } from '../services/shipment-create.service';
import { listDispatchDetailPlanRows } from '../services/dispatch-planning-detail-plan-read.service';
import { Role } from '@tingting/shared';
import type { AuthUser } from '../middleware/auth';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
const DAY = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

const ids = { users: [] as number[], customers: [] as number[], shipments: [] as number[] };
let cusActor: AuthUser;
let dispatcher: AuthUser;
let customerId = 0;

before(async () => {
  const [cus] = await db.insert(s.users).values({
    username: `card400-cus-${suffix}`, passwordHash: 'test-only', role: Role.CUS,
  }).returning();
  ids.users.push(cus.id);
  const [disp] = await db.insert(s.users).values({
    username: `card400-disp-${suffix}`, passwordHash: 'test-only', role: Role.DISPATCHER,
  }).returning();
  ids.users.push(disp.id);
  cusActor = { userId: cus.id, role: Role.CUS } as AuthUser;
  dispatcher = { userId: disp.id, role: Role.DISPATCHER } as AuthUser;
  const [customer] = await db.insert(s.customers).values({ name: `Card400 customer ${suffix}` }).returning();
  ids.customers.push(customer.id);
  customerId = customer.id;
});

after(async () => {
  try {
    const shipmentIds = ids.shipments;
    if (shipmentIds.length > 0) {
      await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));
      await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.shipmentId, shipmentIds));
      await db.delete(s.customerVisibleEvents).where(inArray(s.customerVisibleEvents.shipmentId, shipmentIds));
      await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, shipmentIds));
      await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    }
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } catch (err) {
    console.warn('[card161026100400] cleanup partial:', (err as Error).message);
  }
  try { await client.end(); } catch { /* ignore */ }
});

describe('card 161026100400 — born-ready LCL decomposes at create', () => {
  test('a LCL lot created WITH a delivery date is visible on the detail plan immediately', async () => {
    const bookingRef = `VIS-${suffix}-A`;
    const shipment = await createShipment({
      customerId,
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      bookingRef,
      packageType: 'PALLET',
      packageCount: 5,
      cargoWeightKg: '1900',
      cargoVolumeCbm: '4',
      expectedDeliveryDate: DAY(3),
      createdBy: cusActor.userId,
    }, cusActor);
    ids.shipments.push(shipment.id);
    assert.equal(shipment.status, 'READY_FOR_DISPATCH', 'dates at intake ⇒ born ready');

    // The decomposition the old create path skipped: ONE live shipment-level
    // LCL fulfillment, no container rows.
    const fulfillments = await db.select().from(s.shipmentFulfillments).where(and(
      eq(s.shipmentFulfillments.shipmentId, shipment.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
    assert.equal(fulfillments.length, 1);
    assert.equal(fulfillments[0].fulfillmentType, 'LCL_SHIPMENT');
    assert.equal(fulfillments[0].shipmentContainerId, null);

    // The reported screen: "Tìm nhanh" by the booking ref must find the row.
    const board = await listDispatchDetailPlanRows({ actor: dispatcher, page: 1, limit: 50, q: bookingRef });
    assert.equal(board.total, 1, 'the born-ready LCL lot must appear immediately');
    assert.equal(board.items[0].cargoMode, 'LCL');
    assert.ok(board.items[0].fulfillmentId != null, 'the row is fulfillment-backed, not a fallback row');
    assert.ok((board.assignmentStatusCounts?.UNASSIGNED ?? 0) >= 1, 'the unassigned chip counts it');
  });

  test('control: a LCL lot created WITHOUT dates stays pending and off the board (unchanged)', async () => {
    const bookingRef = `VIS-${suffix}-B`;
    const shipment = await createShipment({
      customerId,
      cargoMode: 'LCL',
      tradeDirection: 'EXPORT',
      bookingRef,
      packageType: 'PALLET',
      packageCount: 2,
      createdBy: cusActor.userId,
    }, cusActor);
    ids.shipments.push(shipment.id);
    assert.equal(shipment.status, 'PENDING_DATE');

    const fulfillments = await db.select({ id: s.shipmentFulfillments.id }).from(s.shipmentFulfillments).where(and(
      eq(s.shipmentFulfillments.shipmentId, shipment.id),
      isNull(s.shipmentFulfillments.canceledAt),
    ));
    assert.equal(fulfillments.length, 0, 'no premature decomposition before readiness');

    const board = await listDispatchDetailPlanRows({ actor: dispatcher, page: 1, limit: 50, q: bookingRef });
    assert.equal(board.total, 0);
  });
});
