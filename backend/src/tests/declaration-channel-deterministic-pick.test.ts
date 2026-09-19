// Two reads of the lot's declared channel used to run unordered
// `select ... limit 1` — a lot holding more than one declaration froze
// (and displayed) an arbitrary one. These tests pin the SHARED pick:
// newest declaration by id, read through one helper by both the debit
// detail and the cost-lock snapshot, so the frozen value always equals
// the value the operator sees on the wire.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';
import { lockShipmentCost } from '../services/shipment-cost-lock.service';
import { getLotDeclaredChannel } from '../services/shipment-documents.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-chanpick-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const routeIds: number[] = [];
const lockIds: number[] = [];
let actor: Parameters<typeof lockShipmentCost>[0]['actor'];

async function mkLot(tag: string): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `ChanPick ${suffix} ${tag}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `ChanPick route ${suffix} ${tag}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `CHANPICK-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-CHANPICK-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: actor.userId,
  }).returning();
  shipmentIds.push(shipment.id);
  return shipment.id;
}

/** Two declarations on one lot: first-inserted = older id. */
type ChannelValue = (typeof s.shipmentDeclarations.channel.enumValues)[number] | null;

async function mkDeclarations(shipmentId: number, olderChannel: ChannelValue, newerChannel: ChannelValue) {
  const [older] = await db.insert(s.shipmentDeclarations)
    .values({ shipmentId, declarationNumber: `OLD-${suffix}-${shipmentId}`, channel: olderChannel }).returning();
  const [newer] = await db.insert(s.shipmentDeclarations
  ).values({ shipmentId, declarationNumber: `NEW-${suffix}-${shipmentId}`, channel: newerChannel }).returning();
  return { olderId: older.id, newerId: newer.id };
}

before(async () => {
  actor = {
    userId: 0, username: `chanpick-${suffix.slice(-6)}`, email: null, fullName: null,
    role: 'DISPATCHER', customerId: null, customerIds: [],
  } as unknown as Parameters<typeof lockShipmentCost>[0]['actor'];
});

after(async () => {
  try {
    await db.delete(s.shipmentCostLocks).where(inArray(s.shipmentCostLocks.shipmentId, shipmentIds));
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  } catch { /* best-effort cleanup */ }
  await client.end();
  await disconnectRedis();
});

describe('declared channel — deterministic pick', () => {
  test('both surfaces pick the newest declaration (id desc): older GREEN, newer RED → RED', async () => {
    const shipmentId = await mkLot('newest');
    const { olderId, newerId } = await mkDeclarations(shipmentId, 'GREEN', 'RED');
    assert.ok(newerId > olderId, 'fixture sanity: second insert gets the bigger id');

    const detail = await getShipmentDebitDetail(shipmentId);
    assert.equal(detail.customsChannel, 'RED', 'debit detail must read the newest declaration');

    const lock = await lockShipmentCost({ shipmentId, actor, idempotencyKey: `pick-${suffix}-1` });
    lockIds.push(lock.id);
    const [lockRow] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const snapshot = lockRow.costSnapshot as Record<string, unknown> | null;
    assert.ok(snapshot, 'lock creates a snapshot');
    assert.equal(snapshot.customsChannel, 'RED', 'the frozen snapshot must freeze the newest declaration');
  });

  test('both surfaces agree, and newest-with-NULL beats older-with-value (still deterministic)', async () => {
    const shipmentId = await mkLot('null-newest');
    await mkDeclarations(shipmentId, 'GREEN', null);

    const detail = await getShipmentDebitDetail(shipmentId);
    const lock = await lockShipmentCost({ shipmentId, actor, idempotencyKey: `pick-${suffix}-2` });
    lockIds.push(lock.id);
    const [lockRow] = await db.select().from(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.id, lock.id));
    const snapshot = lockRow.costSnapshot as Record<string, unknown> | null;

    assert.equal(detail.customsChannel, null, 'newest declaration has no channel — the wire reads null, not the older GREEN');
    assert.equal(snapshot?.customsChannel, null, 'the freeze reads the same newest declaration');
    assert.equal(detail.customsChannel, snapshot?.customsChannel, 'both surfaces agree on the same lot');
  });

  test('helper pin: getLotDeclaredChannel returns the id-desc winner directly', async () => {
    const shipmentId = await mkLot('helper');
    await mkDeclarations(shipmentId, 'YELLOW', 'RED');
    assert.equal(await getLotDeclaredChannel(shipmentId), 'RED');
    assert.equal(await getLotDeclaredChannel(shipmentId + 1000000), null, 'unknown lot reads null');
  });
});
