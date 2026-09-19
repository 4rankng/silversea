// Card 20260919_3 — the classification CONTRACT tests. These pin the only
// acceptable consumer semantics: buckets READ the explicit category column
// (never name matching), the catch-all keeps every đồng visible, and the
// split conserves money exactly. Landed RED while the consumer wiring is not
// yet in place (lot-payables.service.ts belongs to another lane); the
// wiring that reads the column turns them green — that is the contract.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { computeLotPayablesBreakdown } from '../services/lot-payables.service';

const suffix = `${Date.now()}-expcat-${Math.random().toString(36).slice(2, 8)}`;
const typeIds: number[] = [];
const userIds: number[] = [];
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const entryIds: number[] = [];
let shipmentId = 0;
let payerId = 0;

async function mkType(code: string, name: string, category: string | null) {
  const [type] = await db.insert(s.forwarderExpenseTypes).values({
    code: `${code}-${suffix}`, name, category,
  }).returning();
  typeIds.push(type.id);
  return type;
}

async function mkEntry(typeCode: string, amount: string) {
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId,
    expenseTypeCode: typeCode,
    amount,
    paidById: payerId,
    paidAt: '2026-10-01',
  }).returning();
  entryIds.push(entry.id);
  return entry;
}

async function breakdown() {
  return computeLotPayablesBreakdown(shipmentId);
}

async function mkShipment(): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `Expcat customer ${suffix} extra` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `EXPX-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-EXPX-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: null,
  }).returning();
  shipmentIds.push(shipment.id);
  return shipment.id;
}

before(async () => {
  await disconnectRedis();
  const [customer] = await db.insert(s.customers).values({ name: `Expcat customer ${suffix}` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `EXP-${suffix}`,
    bookingRef: `BOOK-EXP-${suffix}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: null,
  }).returning();
  shipmentIds.push(shipment.id);
  shipmentId = shipment.id;
  const [payer] = await db.insert(s.users).values({
    username: `expcat-${suffix.slice(-6)}`,
    passwordHash: 'test-only', role: 'DISPATCHER', status: 'ACTIVE',
  }).returning();
  userIds.push(payer.id);
  payerId = payer.id;
});

after(async () => {
  try {
    await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.id, entryIds));
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, typeIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('card 20260919_3 — classification contract: buckets read the category column', () => {
  test('FLIP: recategorizing a type moves the money column', async () => {
    const hqgsType = await mkType('HQC', 'Phí kiểm hóa flip', 'HQGS');
    await mkEntry(hqgsType.code, '1000000');
    let result = await breakdown();
    assert.equal(result.hqgsFee, 1000000, 'entry starts in the HQGS bucket');
    await db.update(s.forwarderExpenseTypes).set({ category: 'PHAT_SINH' })
      .where(eq(s.forwarderExpenseTypes.id, hqgsType.id));
    result = await breakdown();
    assert.equal(result.phatSinhFee, 1000000, 'after the flip the SAME money reads in the PHAT_SINH bucket');
    assert.equal(result.hqgsFee, 0, 'HQGS bucket empties after the flip');
  });

  test('conservation A/B: categorizing must never move the lot total', async () => {
    shipmentId = await mkShipment();
    const t1 = await mkType('NC', 'Phí chưa phân loại A/B', null);
    const t2 = await mkType('HQB', 'Phí kiểm hóa A/B', null);
    const t3 = await mkType('PSB', 'Phí phát sinh A/B', null);
    const t4 = await mkType('KHB', 'Phí khác A/B', null);
    await mkEntry(t1.code, '1112000');
    await mkEntry(t2.code, '2500000');
    await mkEntry(t3.code, '800000');
    await mkEntry(t4.code, '300000');
    const stateA = await breakdown();
    assert.equal(stateA.opsExpenseTotal, 4712000, 'State A total captured');
    assert.equal(stateA.unclassifiedFee, 4712000, 'State A: catch-all carries the whole total');
    assert.equal(stateA.hqgsFee, 0);
    assert.equal(stateA.phatSinhFee, 0);
    await db.update(s.forwarderExpenseTypes).set({ category: 'HQGS' })
      .where(eq(s.forwarderExpenseTypes.id, t2.id));
    await db.update(s.forwarderExpenseTypes).set({ category: 'PHAT_SINH' })
      .where(eq(s.forwarderExpenseTypes.id, t3.id));
    await db.update(s.forwarderExpenseTypes).set({ category: 'KHAC' })
      .where(eq(s.forwarderExpenseTypes.id, t4.id));
    const stateB = await breakdown();
    assert.equal(stateB.opsExpenseTotal, 4712000, 'State B total identical to the đồng');
    assert.equal(stateB.hqgsFee, 2500000);
    assert.equal(stateB.phatSinhFee, 800000);
    assert.equal(stateB.unclassifiedFee, 1412000, 'null-category + KHAC rows stay in the catch-all');
    assert.equal(
      stateB.hqgsFee + stateB.phatSinhFee + stateB.unclassifiedFee,
      stateB.opsExpenseTotal,
      'standing invariant: buckets sum to the total',
    );
  });
});
