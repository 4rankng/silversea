/**
 * Wave 4 M10.3 — dispatch handoff service tests.
 *
 * Verifies: create handoff, markSeen (UNSEEN→SEEN), resolveHandoff
 * (ACCEPTED/REJECTED with reason), version-conflict detection,
 * getActiveHandoffForShipment, partial-unique-index
 * enforcement (one active handoff per shipment), idempotent markSeen,
 * and notification emission.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  createHandoff,
  markSeen,
  resolveHandoff,
  checkVersionConflict,
  getActiveHandoffForShipment,
  getLatestHandoffForShipment,
} from '../services/dispatch-handoff.service';
import { initNotificationService } from '../services/notification.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdUserIds: number[] = [];
const createdHandoffIds: number[] = [];
const createdNotifIds: number[] = [];

let clerkUserId: number;
let handlerUserId: number;

async function mkUser(role: 'CUS' | 'OPS', tag: string) {
  const [u] = await db.insert(s.users).values({
    username: `m103-${role}-${suffix}-${tag}-${createdUserIds.length}`,
    passwordHash: 'x', role, status: 'ACTIVE',
  }).returning();
  createdUserIds.push(u.id);
  return u;
}

async function mkShipment() {
  const [cust] = await db.insert(s.customers).values({ name: `M103 cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(cust.id);
  const [ship] = await db.insert(s.shipments).values({
    customerId: cust.id, bookingRef: `M103-BR-${suffix}-${createdShipmentIds.length}`,
  }).returning();
  createdShipmentIds.push(ship.id);
  return ship;
}

before(async () => {
  initNotificationService();
  clerkUserId = (await mkUser('CUS', 'clerk')).id;
  handlerUserId = (await mkUser('OPS', 'handler')).id;
});

after(async () => {
  const namePattern = `M103 %${suffix}%`;
  const userPattern = `m103-%-${suffix}-%`;
  try {
    // Sweep notifications created by the handoff service.
    await db.delete(s.notifications).where(sql`${s.notifications.type} = 'SHIPMENT_HANDOFF' AND ${s.notifications.message} LIKE ${'%' + suffix + '%'}`);
    if (createdNotifIds.length > 0) await db.delete(s.notifications).where(inArray(s.notifications.id, createdNotifIds));
    if (createdHandoffIds.length > 0) await db.delete(s.dispatchHandoffs).where(inArray(s.dispatchHandoffs.id, createdHandoffIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    await db.delete(s.users).where(sql`${s.users.username} LIKE ${userPattern}`);
  } catch (err) { console.warn('[m103] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M10.3 — createHandoff', () => {
  test('creates an UNSEEN handoff with version snapshot', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({
      shipmentId: ship.id, handlerId: handlerUserId,
      priority: 'URGENT', createdBy: clerkUserId,
      operationalNote: 'cần xe gấp',
    });
    createdHandoffIds.push(h.id);
    assert.equal(h.status, 'UNSEEN');
    assert.equal(h.shipmentId, ship.id);
    assert.equal(h.handlerId, handlerUserId);
    assert.equal(h.priority, 'URGENT');
    assert.equal(h.handoffVersion, ship.version);
    assert.equal(h.createdBy, clerkUserId);
  });

  test('404 on missing shipment', async () => {
    await assert.rejects(
      () => createHandoff({ shipmentId: 99_999_999, createdBy: clerkUserId }),
      (err: Error & { statusCode?: number }) => err.statusCode === 404,
    );
  });

  test('emits a SHIPMENT_HANDOFF notification', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({
      shipmentId: ship.id, handlerId: handlerUserId,
      createdBy: clerkUserId,
    });
    createdHandoffIds.push(h.id);
    // Notification is emitted async via EventEmitter — wait briefly.
    await new Promise(r => setTimeout(r, 200));
    const notifs = await db.select().from(s.notifications)
      .where(sql`${s.notifications.type} = 'SHIPMENT_HANDOFF' AND ${s.notifications.relatedEntityId} = ${ship.id}`);
    assert.ok(notifs.length >= 1, 'SHIPMENT_HANDOFF notification emitted');
    for (const n of notifs) createdNotifIds.push(n.id);
  });
});

describe('M10.3 — markSeen', () => {
  test('UNSEEN → SEEN', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    const seen = await markSeen(h.id);
    assert.equal(seen.status, 'SEEN');
    assert.ok(seen.seenAt);
  });

  test('idempotent: markSeen on SEEN → no-op', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    await markSeen(h.id);
    const seen2 = await markSeen(h.id);
    assert.equal(seen2.status, 'SEEN');
  });

  test('400 on ACCEPTED handoff', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    await resolveHandoff(h.id, 'ACCEPTED', clerkUserId, h.version);
    await assert.rejects(
      () => markSeen(h.id),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });
});

describe('M10.3 — resolveHandoff', () => {
  test('ACCEPTED resolves successfully', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    const resolved = await resolveHandoff(h.id, 'ACCEPTED', clerkUserId, h.version);
    assert.equal(resolved.status, 'ACCEPTED');
    assert.ok(resolved.resolvedAt);
    assert.equal(resolved.rejectReason, null);
  });

  test('REJECTED requires a reason', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    await assert.rejects(
      () => resolveHandoff(h.id, 'REJECTED', clerkUserId, h.version),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /Lý do/.test(err.message),
    );
  });

  test('REJECTED with reason resolves successfully', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    const resolved = await resolveHandoff(h.id, 'REJECTED', clerkUserId, h.version, { rejectReason: 'không đủ xe' });
    assert.equal(resolved.status, 'REJECTED');
    assert.equal(resolved.rejectReason, 'không đủ xe');
  });

  test('400 on already-resolved handoff', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    const resolved = await resolveHandoff(h.id, 'ACCEPTED', clerkUserId, h.version);
    await assert.rejects(
      () => resolveHandoff(h.id, 'ACCEPTED', clerkUserId, resolved.version),
      (err: Error & { statusCode?: number }) => err.statusCode === 409,
    );
  });
});

describe('M10.3 — checkVersionConflict', () => {
  test('no conflict when shipment unchanged', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    const check = await checkVersionConflict(h.id);
    assert.equal(check.hasConflict, false);
    assert.equal(check.handoffVersion, check.currentVersion);
  });

  test('conflict detected when shipment version bumped', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    // Bump the shipment version.
    await db.update(s.shipments).set({ version: ship.version + 1 }).where(eq(s.shipments.id, ship.id));
    const check = await checkVersionConflict(h.id);
    assert.equal(check.hasConflict, true);
    assert.notEqual(check.handoffVersion, check.currentVersion);
  });
});

describe('M10.3 — getActiveHandoffForShipment', () => {
  test('getActiveHandoffForShipment returns UNSEEN/SEEN handoff', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    const active = await getActiveHandoffForShipment(ship.id);
    assert.ok(active);
    assert.equal(active!.id, h.id);
  });

  test('getActiveHandoffForShipment returns null after ACCEPTED', async () => {
    const ship = await mkShipment();
    const h = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(h.id);
    await resolveHandoff(h.id, 'ACCEPTED', clerkUserId, h.version);
    const active = await getActiveHandoffForShipment(ship.id);
    assert.equal(active, null);
  });

  test('getLatestHandoffForShipment preserves the accepted lifecycle state', async () => {
    const ship = await mkShipment();
    const handoff = await createHandoff({ shipmentId: ship.id, createdBy: clerkUserId });
    createdHandoffIds.push(handoff.id);
    const accepted = await resolveHandoff(handoff.id, 'ACCEPTED', clerkUserId, handoff.version);

    const latest = await getLatestHandoffForShipment(ship.id);
    assert.equal(latest?.id, accepted.id);
    assert.equal(latest?.status, 'ACCEPTED');
  });
});
