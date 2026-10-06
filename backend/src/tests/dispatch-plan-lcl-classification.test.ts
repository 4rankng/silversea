// Card 20261006_392 — 'Lấy Lẻ' (LCL_PICKUP) on an LCL_SHIPMENT row violated the
// DB check `shipment_fulfillments_lcl_dispatch_classification_check`
// (fulfillment_type <> 'LCL_SHIPMENT' OR dispatch_classification = 'LCL'), so the
// dispatcher plan save surfaced a raw PostgresError 23514 as HTTP 500.
//
// The constraint is the authority: an LCL lot's single LCL_SHIPMENT row is
// whole-lot, and 'LCL' is its only legal classification. 'LCL_PICKUP' ("Lấy Lẻ")
// is a 40'-trailer run on a CONTAINER row — no fulfillment row in the database
// has ever carried it. So the frontend must not offer it on an LCL row, and the
// backend must refuse it as a business error rather than 500 on the constraint.
//
// Red-first: both cases fail before the fix — the frontend offered the value, and
// the backend reached the constraint.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { updateDispatchDetailPlan } from '../services/dispatch-planning-detail-plan.service';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const ids: Record<string, number[]> = { users: [], customers: [], routes: [], shipments: [], fulfillments: [] };
let actorId = 0;
let lclFulfillmentId = 0;
let lclShipmentId = 0;

async function seedLclLot() {
  const [customer] = await db.insert(s.customers).values({ name: `LclClass customer ${suffix}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `LclClass route ${suffix}` }).returning();
  ids.routes.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    shipmentCode: `LCL-CLASS-${suffix.slice(-8)}`.slice(0, 50),
    cargoMode: 'LCL',
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    expectedDeliveryDate: '2026-10-20',
  }).returning();
  ids.shipments.push(shipment.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    shipmentContainerId: null,
    sourceShipmentVersion: shipment.version,
    dispatchClassification: 'LCL',
  }).returning();
  ids.fulfillments.push(fulfillment.id);
  return { fulfillmentId: fulfillment.id, shipmentId: shipment.id };
}

async function currentVersions() {
  const [ful] = await db.select({ version: s.shipmentFulfillments.version }).from(s.shipmentFulfillments)
    .where(eq(s.shipmentFulfillments.id, lclFulfillmentId));
  const [ship] = await db.select({ version: s.shipments.version }).from(s.shipments)
    .where(eq(s.shipments.id, lclShipmentId));
  return { fulfillmentVersion: ful.version, shipmentVersion: ship.version };
}

async function saveClassification(classification: 'LCL' | 'LCL_PICKUP') {
  const { fulfillmentVersion, shipmentVersion } = await currentVersions();
  return updateDispatchDetailPlan({
    actor: { userId: actorId, role: Role.DISPATCHER } as Parameters<typeof updateDispatchDetailPlan>[0]['actor'],
    idempotencyKey: crypto.randomUUID(),
    fulfillmentId: lclFulfillmentId,
    expectedFulfillmentVersion: fulfillmentVersion,
    expectedShipmentVersion: shipmentVersion,
    carrierType: 'OWN',
    plannedRevenue: null,
    plannedCarrierCost: null,
    classification,
  });
}

before(async () => {
  const [actor] = await db.insert(s.users).values({
    username: `lclclass-${suffix.slice(-10)}`, passwordHash: 'test-only', role: Role.DISPATCHER,
  }).returning();
  ids.users.push(actor.id);
  actorId = actor.id;
  const lot = await seedLclLot();
  lclFulfillmentId = lot.fulfillmentId;
  lclShipmentId = lot.shipmentId;
});

after(async () => {
  try {
    if (ids.fulfillments.length > 0) await db.delete(s.shipmentFulfillments).where(inArray(s.shipmentFulfillments.id, ids.fulfillments));
    if (ids.shipments.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
    if (ids.routes.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
    if (ids.customers.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
    if (ids.users.length > 0) await db.delete(s.users).where(inArray(s.users.id, ids.users));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('LCL classification contract (card 20261006_392)', () => {
  test('setup: an LCL_SHIPMENT fulfillment', () => {
    assert.ok(lclFulfillmentId > 0);
  });

  // AC1/AC2 backend half: a business refusal, never a raw constraint 500.
  test('B1 LCL_PICKUP on an LCL row is refused with a 409 business message', async () => {
    await assert.rejects(
      () => saveClassification('LCL_PICKUP'),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'must be an Error');
        // The reported failure was a bare 500 from PostgresError 23514.
        assert.ok(!/23514|check constraint|violates/i.test(err.message),
          `must not surface a raw constraint error: ${err.message}`);
        assert.ok(/Phân loại/i.test(err.message), `expected a business message: ${err.message}`);
        return true;
      },
      'LCL_PICKUP must be refused as a business error on an LCL lot',
    );
  });

  test('B2 the row keeps its legal LCL classification after the refusal', async () => {
    const [row] = await db.select({ c: s.shipmentFulfillments.dispatchClassification })
      .from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, lclFulfillmentId));
    assert.equal(row.c, 'LCL');
  });

  // The legal value must still save — the guard cannot block the whole field.
  test('B3 the legal LCL classification still saves', async () => {
    const r = await saveClassification('LCL');
    assert.equal(r.replayed, false);
  });
});
