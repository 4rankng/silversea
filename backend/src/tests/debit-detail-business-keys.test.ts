// The debit-detail wire carries lot-level BUSINESS display keys (Số Bill /
// Số Booking / số tờ khai) — never internal ids or id-derived codes (hard
// rule 2026-09-19). null = the lot has no such number → the UI renders '—';
// the producer never fabricates an identifier, and the shared wire schema
// must parse the producer output verbatim.
// Direction CHECK on shipments: EXPORT lots carry bookingRef, IMPORT lots
// carry blNumber — fixtures mirror that (one lot per direction).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';
import { shipmentDebitDetailSchema } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-bk-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const actorId = 1;

async function mkLot(direction: 'EXPORT' | 'IMPORT', refs: { bookingRef?: string; blNumber?: string }): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `BK ${suffix} ${shipmentIds.length}` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `BK-${suffix}-${shipmentIds.length}`,
    ...(refs.bookingRef != null ? { bookingRef: refs.bookingRef } : {}),
    ...(refs.blNumber != null ? { blNumber: refs.blNumber } : {}),
    status: 'READY_FOR_DISPATCH',
    tradeDirection: direction,
    createdBy: actorId,
  }).returning();
  shipmentIds.push(shipment.id);
  return shipment.id;
}

after(async () => {
  try {
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  } catch { /* best-effort cleanup */ }
  await client.end();
  await disconnectRedis();
});

describe('debit-detail wire carries business keys, never ids', () => {
  test('an EXPORT lot renders Số Booking + tờ khai and parses against the wire schema', async () => {
    const shipmentId = await mkLot('EXPORT', { bookingRef: `BOOK-${suffix}` });
    await db.insert(s.shipmentDeclarations).values([
      { shipmentId, declarationNumber: `DECL-A-${suffix}`, channel: 'GREEN' as const },
      { shipmentId, declarationNumber: `DECL-B-${suffix}`, channel: 'RED' as const },
    ]);

    const detail = await getShipmentDebitDetail(shipmentId);
    assert.equal(detail.bookingRef, `BOOK-${suffix}`);
    assert.equal(detail.billNumber, null, 'EXPORT lot carries no bill number (direction CHECK)');
    assert.ok(
      detail.declarationNumber?.includes(`DECL-A-${suffix}`) && detail.declarationNumber?.includes(`DECL-B-${suffix}`),
      'both declaration numbers ride the wire, comma-joined',
    );
    // The shared wire contract parses the producer output verbatim — the FE
    // template consumes exactly this shape.
    shipmentDebitDetailSchema.parse(detail);
  });

  test('an IMPORT lot renders Số Bill', async () => {
    const shipmentId = await mkLot('IMPORT', { blNumber: `BILL-${suffix}` });
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.equal(detail.billNumber, `BILL-${suffix}`);
    assert.equal(detail.bookingRef, null);
    shipmentDebitDetailSchema.parse(detail);
  });

  test('a lot without numbers gets nulls — never a fabricated identifier', async () => {
    const shipmentId = await mkLot('EXPORT', {});
    const detail = await getShipmentDebitDetail(shipmentId);
    assert.equal(detail.billNumber, null);
    assert.equal(detail.bookingRef, null);
    assert.equal(detail.declarationNumber, null);
    shipmentDebitDetailSchema.parse(detail);
  });
});
