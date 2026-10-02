// Locked lots must render port labels AS OF LOCK: the cost-lock snapshot
// jsonb captures the labels (per container: pickup/dropoff port labels +
// raw ad-hoc names) at lock time. Renaming a port after the lock must not
// rewrite the frozen document — the debit note is the pricing basis.
// Old locks without the captured labels fall back to live reads upstream
// (consumers treat a missing snapshot key as "not frozen").
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { lockShipmentCost } from '../services/shipment-cost-lock.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-lbl-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const portIds: number[] = [];
const lockIds: number[] = [];
let actor: Parameters<typeof lockShipmentCost>[0]['actor'];

async function mkPort(name: string): Promise<number> {
  const [port] = await db.insert(s.ports).values({ name, code: `LBL-${portIds.length}-${Date.now().toString(36)}` }).returning();
  portIds.push(port.id);
  return port.id;
}

async function mkLotWithContainer(pickupPortId: number, dropoffPortId: number): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `Lbl ${suffix} ${shipmentIds.length}` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `LBL-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-LBL-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: actor.userId,
  }).returning();
  shipmentIds.push(shipment.id);
  await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerNumber: `LBL${shipmentIds.length}${suffix.slice(-4)}`.toUpperCase(),
    pickupPortId,
    dropoffPortId,
  });
  return shipment.id;
}

before(async () => {
  actor = {
    userId: 0, username: `lbl-${suffix.slice(-6)}`, email: null, fullName: null,
    role: 'DISPATCHER', customerId: null, customerIds: [],
  } as unknown as Parameters<typeof lockShipmentCost>[0]['actor'];
});

after(async () => {
  try {
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, shipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    await db.delete(s.ports).where(inArray(s.ports.id, portIds));
  } catch { /* best-effort cleanup */ }
  await client.end();
  await disconnectRedis();
});

describe('locked lot renders port labels as of lock', () => {
  test('the snapshot captures container port labels at lock time', async () => {
    const pickup = await mkPort(`PORT-A ${suffix}`);
    const dropoff = await mkPort(`PORT-B ${suffix}`);
    const shipmentId = await mkLotWithContainer(pickup, dropoff);

    const lock = await lockShipmentCost({ shipmentId, actor, idempotencyKey: `lbl-${suffix}-1` });
    lockIds.push(lock.id);
    const [lockRow] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const snapshot = lockRow.costSnapshot as Record<string, unknown> | null;
    assert.ok(snapshot, 'lock creates a snapshot');
    const labels = snapshot?.portLabels as { byContainer?: Array<{ containerId: number; liftSiteLabel: string | null; dropSiteLabel: string | null; rawLiftSiteName: string | null; rawDropSiteName: string | null }>; ports?: Record<string, string> } | undefined;
    assert.ok(labels?.byContainer?.length, 'container-scoped labels captured at lock time');
    assert.equal(labels.byContainer[0]?.liftSiteLabel, `PORT-A ${suffix}`, 'lift label frozen at lock');
    assert.equal(labels.byContainer[0]?.dropSiteLabel, `PORT-B ${suffix}`, 'drop label frozen at lock');

    // Renaming the port after the lock must NOT rewrite the frozen label.
    await db.update(s.ports).set({ name: `QA-A3 ${suffix}` }).where(inArray(s.ports.id, [pickup]));
    const [afterRename] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const afterLabels = afterRename.costSnapshot as { portLabels?: { byContainer?: Array<{ liftSiteLabel: string | null }> } } | null;
    assert.equal(afterLabels?.portLabels?.byContainer?.[0]?.liftSiteLabel, `PORT-A ${suffix}`, 'the frozen label survives the rename');
  });

  test('a lot locked AFTER the rename captures the new label', async () => {
    const pickup = await mkPort(`PORT-A ${suffix}-2`);
    const shipmentId = await mkLotWithContainer(pickup, pickup);
    await db.update(s.ports).set({ name: `QA-A3 ${suffix}-2` }).where(inArray(s.ports.id, [pickup]));

    const lock = await lockShipmentCost({ shipmentId, actor, idempotencyKey: `lbl-${suffix}-2` });
    lockIds.push(lock.id);
    const [lockRow] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const snapshot = lockRow?.costSnapshot as { portLabels?: { byContainer?: Array<{ liftSiteLabel: string | null }> } } | null;
    assert.ok(snapshot?.portLabels?.byContainer?.[0]?.liftSiteLabel === `QA-A3 ${suffix}-2`, 'the new lock carries the renamed label');
  });
});
