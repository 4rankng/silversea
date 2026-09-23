/**
 * Card 20260922_77 — the /shipments search honors the placeholder's promise:
 * one `q` matches Bill/Book, container number, OR declaration number
 * (function-wins ruling; contract mirrors the cus-workspace search).
 * Fixtures are real rows; the predicate runs through the real
 * listShipmentsPaginated consumer.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { listShipmentsPaginated } from '../services/shipment-queries.service';

const suffix = `q77-${Date.now().toString(36)}`;
const created = {
  customerIds: [] as number[],
  routeIds: [] as number[],
  shipmentIds: [] as number[],
};

let shipmentId = 0;
let otherShipmentId = 0;
const BL = `BULK-IMP-${suffix.slice(-8)}`;
const CONTAINER = `CSQU${suffix.slice(-6).toUpperCase()}`;
const DECLARATION = `10302026110001${suffix.slice(-5)}`;

async function mkShipment(opts: { bl: string; withContainer: boolean; withDeclaration: boolean }): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `Q77 customer ${suffix} ${opts.bl}` }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q77 route ${suffix} ${opts.bl}` }).returning();
  created.routeIds.push(route.id);
  const [row] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    blNumber: opts.bl,
    status: 'NEW',
  }).returning();
  created.shipmentIds.push(row.id);
  if (opts.withContainer) {
    await db.insert(s.shipmentContainers).values({
      shipmentId: row.id,
      containerNumber: CONTAINER,
    });
  }
  if (opts.withDeclaration) {
    await db.insert(s.shipmentDeclarations).values({
      shipmentId: row.id,
      declarationNumber: DECLARATION,
    });
  }
  return row.id;
}

before(async () => {
  shipmentId = await mkShipment({ bl: BL, withContainer: true, withDeclaration: true });
  otherShipmentId = await mkShipment({ bl: `OTHER-${suffix.slice(-8)}`, withContainer: false, withDeclaration: false });
});

after(async () => {
  if (created.shipmentIds.length) {
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, created.shipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, created.shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, created.shipmentIds));
  }
  if (created.routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, created.routeIds));
  if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await client.end();
});

describe('shipment search three branches (card 20260922_77)', () => {
  test('A1 container-number branch: CSQU-style number finds its lot', async () => {
    const result = await listShipmentsPaginated({ q: CONTAINER });
    const ids = result.items.map((r: { id: number }) => r.id);
    assert.ok(ids.includes(shipmentId), 'container search must return the lot holding the container');
    assert.ok(!ids.includes(otherShipmentId), 'unrelated lot must not match');
  });

  test('A2 Bill/Book branch still works', async () => {
    const result = await listShipmentsPaginated({ q: BL });
    const ids = result.items.map((r: { id: number }) => r.id);
    assert.ok(ids.includes(shipmentId));
    assert.ok(!ids.includes(otherShipmentId));
  });

  test('A2b declaration-number branch finds its lot', async () => {
    const result = await listShipmentsPaginated({ q: DECLARATION });
    const ids = result.items.map((r: { id: number }) => r.id);
    assert.ok(ids.includes(shipmentId));
    assert.ok(!ids.includes(otherShipmentId));
  });

  test('no false positives on an unrelated term', async () => {
    const result = await listShipmentsPaginated({ q: 'ZZZNOMATCH' });
    const ids = result.items.map((r: { id: number }) => r.id);
    assert.ok(!ids.includes(shipmentId));
    assert.ok(!ids.includes(otherShipmentId));
  });
});
