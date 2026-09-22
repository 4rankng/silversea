/**
 * Card 20260922_6 — the "có cược" intake wiring (BE).
 * Service-level suite; fixtures `card226-*`, local DB :5441.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { createShipment } from '../services/shipment-create.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkActor() {
  const [u] = await db.insert(s.users).values({
    username: `card226-${suffix}-actor-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkCustomer(name: string) {
  const [c] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, c.id)); });
  return c;
}

describe('card 20260922_6 — cược-container intake wiring', () => {
  after(async () => { for (const fn of cleanup) await fn(); });

  test('ticked + amount → tracker row (CHUA_HOAN_CUOC, amount, identity)', async () => {
    const actor = await mkActor();
    const customer = await mkCustomer('Công ty cược A');
    const shipment = await createShipment({
      customerId: customer.id,
      blNumber: `CARD226-BILL-A-${suffix}`,
      shippingLineName: 'Hãng tàu cược A',
      hasDeposit: true,
      depositAmount: 5_000_000,
      createdBy: actor.id,
    });
    const [row] = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, shipment.id));
    assert.ok(row, 'ticked create must produce a tracker row');
    assert.equal(row.status, 'CHUA_HOAN_CUOC');
    assert.equal(Number(row.depositAmount), 5_000_000);
    assert.equal(row.billNumber, `CARD226-BILL-A-${suffix}`);
    assert.equal(row.customerName, `Công ty cược A ${suffix}`);
    assert.equal(row.customerName.includes('Công ty cược A'), true);
    assert.equal(row.carrierName, 'Hãng tàu cược A');
    track(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id)); });
    track(async () => { await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment.id)); });
    track(async () => { await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, shipment.id)); });
    track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  });

  test('unticked → no tracker row', async () => {
    const actor = await mkActor();
    const customer = await mkCustomer('Công ty cược B');
    const shipment = await createShipment({
      customerId: customer.id,
      blNumber: `CARD226-BILL-B-${suffix}`,
      createdBy: actor.id,
    });
    const [row] = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, shipment.id));
    assert.equal(row, undefined);
    track(async () => { await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment.id)); });
    track(async () => { await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, shipment.id)); });
    track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  });

  test('ticked without amount → row with amount 0 (KT fills by hand)', async () => {
    const actor = await mkActor();
    const customer = await mkCustomer('Công ty cược C');
    const shipment = await createShipment({
      customerId: customer.id,
      blNumber: `CARD226-BILL-C-${suffix}`,
      hasDeposit: true,
      createdBy: actor.id,
    });
    const [row] = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.shipmentId, shipment.id));
    assert.ok(row, 'ticked create must produce a tracker row');
    assert.equal(Number(row.depositAmount), 0);
    track(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id)); });
    track(async () => { await db.delete(s.customerVisibleEvents).where(eq(s.customerVisibleEvents.shipmentId, shipment.id)); });
    track(async () => { await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, shipment.id)); });
    track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  });
});
