// "Thêm cược" Bill typeahead (owner ruling 2026-10-14): Kế toán types the LAST
// FOUR DIGITS of a Bill/Booking and picks the lot; the form then fills
// Bill/Booking – Hãng tàu – Tên khách hàng from the customer-side lot data.
//
// Pins: the four-digit rule (shorter input is ambiguous and rejected), the
// Bill-then-Booking display key, the ad-hoc customer fallback, and the
// "already deposited N times" signal the form warns with.
//
// Card 171026212000 (FB-096 verify-fail): the tail is the last four DIGITS of
// the printed number's digit run, not its last four characters — real
// references end in suffixes like "-IMP"/"-FCL" and must still match.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import depositRoutes from '../routes/accounting-deposit';
import { disconnectRedis } from '../lib/redis';

const prefix = `bill-suggest-${Date.now()}`;
const TAIL = '7742';
let server: Server;
let base: string;
let token: string;
let userId: number;
let customerId: number;
const shipmentIds: number[] = [];
const trackerIds: number[] = [];

before(async () => {
  const [user] = await db.insert(s.users)
    .values({ username: prefix, passwordHash: 'test', role: 'ACCOUNTANT', status: 'ACTIVE' })
    .returning();
  userId = user.id;
  token = jwt.sign({ userId, role: 'ACCOUNTANT' }, config.jwtSecret, { expiresIn: '1h' });

  const [customer] = await db.insert(s.customers)
    .values({ name: `${prefix}-Khách Hàng`, shortName: prefix, status: 'ACTIVE' })
    .returning();
  customerId = customer.id;

  const catalogLot = await db.insert(s.shipments).values({
    customerId,
    blNumber: `YMLU${TAIL}`,
    shippingLineName: 'YML',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(catalogLot[0].id);

  // A Booking-number lot: no trade direction, so the
  // shipments_document_reference_direction_check constraint leaves it alone.
  const bookingLot = await db.insert(s.shipments).values({
    customerId,
    bookingRef: `ONE${TAIL}`,
    shippingLineName: 'ONE',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(bookingLot[0].id);

  // Ad-hoc "lệnh chạy ngoài": free-text customer, no catalog link.
  const adhocLot = await db.insert(s.shipments).values({
    isAdHoc: true,
    rawCustomerName: `${prefix}-Khách Ngoài`,
    blNumber: `HLXU${TAIL}`,
    shippingLineName: 'HLX',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(adhocLot[0].id);

  // A lot whose number ends differently must never appear.
  const other = await db.insert(s.shipments).values({
    customerId,
    blNumber: 'YMLU0000',
    shippingLineName: 'YML',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(other[0].id);

  // Card 171026212000: printed tails that are NOT four digits. The digit run
  // still ends in TAIL, so the "4 số cuối" habit must find them — a
  // last-4-characters comparison returns nothing for these shapes.
  const blSuffixLot = await db.insert(s.shipments).values({
    customerId,
    blNumber: `YMLU${TAIL}-IMP`,
    shippingLineName: 'YML',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(blSuffixLot[0].id);

  const bookingSuffixLot = await db.insert(s.shipments).values({
    customerId,
    bookingRef: `RARBOOK-1792${TAIL}-bzut`,
    shippingLineName: 'RAR',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(bookingSuffixLot[0].id);

  // The mirrored real shape `RARBOOK-…-9bzut2`: its suffix KEEPS digits, so
  // the digit run continues past the visible block. The lookup tail is the
  // last four digits of the whole printed number — here "…7742" + "92" ends
  // in 7292, not 7742.
  const hexTailLot = await db.insert(s.shipments).values({
    customerId,
    bookingRef: `RARBOOK-1792${TAIL}-9bzut2`,
    shippingLineName: 'RAR',
    status: 'PENDING_DATE',
  }).returning();
  shipmentIds.push(hexTailLot[0].id);

  // A tombstoned lot with a matching tail must NEVER be offered. It matches
  // via bookingRef on purpose: grouped or() keeps the deletedAt filter on
  // both branches — the bare `sql\`A or B\`` inside and() rendered
  // `(deleted_at is null and bl_match) or booking_match`, bypassing the
  // tombstone filter on exactly this branch.
  const tombstoneLot = await db.insert(s.shipments).values({
    customerId,
    bookingRef: `TOMB${TAIL}-X`,
    shippingLineName: 'YML',
    status: 'PENDING_DATE',
  }).returning();
  await db.update(s.shipments).set({ deletedAt: new Date() }).where(eq(s.shipments.id, tombstoneLot[0].id));
  shipmentIds.push(tombstoneLot[0].id);

  const tracker = await db.insert(s.depositRefundTrackers).values({
    shipmentId: catalogLot[0].id,
    billNumber: `YMLU${TAIL}`,
    customerName: `${prefix}-Khách Hàng`,
    carrierName: 'YML',
    depositAmount: '4000000',
  }).returning();
  trackerIds.push(tracker[0].id);

  const app = express();
  app.use(express.json());
  app.use('/api/accounting/deposits', authMiddleware, depositRoutes);
  app.use(globalErrorHandler);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/deposits`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (trackerIds.length) await db.delete(s.depositRefundTrackers).where(inArray(s.depositRefundTrackers.id, trackerIds));
  if (shipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
  await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, userId));
  await db.delete(s.users).where(eq(s.users.id, userId));
  await disconnectRedis();
  await client.end();
});

async function suggest(query: string) {
  const response = await fetch(`${base}/bill-suggestions?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

describe('bill suggestions by last four digits', () => {
  test('a four-digit tail returns the matching lots with Bill, hãng tàu and khách hàng', async () => {
    const result = await suggest(TAIL);
    assert.equal(result.status, 200);
    const items = result.body.items as Array<Record<string, unknown>>;
    // Containment, not exact counts: the suite runs against the shared dev
    // database, whose live lots may legitimately share the tail.
    for (const ref of [`YMLU${TAIL}`, `ONE${TAIL}`, `HLXU${TAIL}`, `YMLU${TAIL}-IMP`, `RARBOOK-1792${TAIL}-bzut`]) {
      assert.ok(items.some(item => item.billNumber === ref || item.bookingRef === ref), `${ref} is listed`);
    }
    assert.ok(!items.some(item => item.billNumber === 'YMLU0000'), 'the differently-ending lot is not listed');
    assert.ok(!items.some(item => item.bookingRef === `TOMB${TAIL}-X`), 'a soft-deleted lot is never offered');

    const bill = items.find(item => item.billNumber === `YMLU${TAIL}`);
    assert.ok(bill, 'the Bill-number lot is listed');
    assert.equal(bill.carrierName, 'YML');
    assert.equal(bill.customerName, `${prefix}-Khách Hàng`);
    assert.equal(bill.existingTrackerCount, 1, 'the form can warn that this lot is already on deposit');

    const booking = items.find(item => item.bookingRef === `ONE${TAIL}`);
    assert.ok(booking, 'a Booking-number lot matches too');
    assert.equal(booking.billDisplay, `ONE${TAIL}`, 'the display key falls back to the Booking number');
  });

  test('a reference whose printed tail is not digits still matches by its last four digits', async () => {
    // Card 171026212000 (FB-096 verify-fail): the accountant reads "4 số cuối"
    // off the printed number, so "-IMP"/"-bzut" suffixes cannot hide the lot.
    const result = await suggest(TAIL);
    assert.equal(result.status, 200);
    const items = result.body.items as Array<Record<string, unknown>>;

    const blSuffix = items.find(item => item.billNumber === `YMLU${TAIL}-IMP`);
    assert.ok(blSuffix, 'the non-digit-suffix Bill lot is found');
    assert.equal(blSuffix.billDisplay, `YMLU${TAIL}-IMP`, 'the display key keeps the full printed reference');
    assert.equal(blSuffix.existingTrackerCount, 0);

    const bookingSuffix = items.find(item => item.bookingRef === `RARBOOK-1792${TAIL}-bzut`);
    assert.ok(bookingSuffix, 'the non-digit-suffix Booking lot is found');
    assert.equal(bookingSuffix.billDisplay, `RARBOOK-1792${TAIL}-bzut`);
  });

  test('a suffix that keeps digits extends the digit run — the tail is the last four digits of the whole number', async () => {
    // `RARBOOK-17927742-9bzut2` prints digits 17927742 then 92, so its digit
    // run ends …4292 — NOT 7742: the lookup reads the number as one digit
    // sequence, exactly like the accountant scanning the paper.
    const byRealTail = await suggest('4292');
    assert.equal(byRealTail.status, 200);
    const hexTail = (byRealTail.body.items as Array<Record<string, unknown>>)
      .find(item => item.bookingRef === `RARBOOK-1792${TAIL}-9bzut2`);
    assert.ok(hexTail, 'found by the true last four digits of the whole number');
    // And the inner block's own tail alone does not match this lot.
    const byInnerTail = await suggest(TAIL);
    const leaked = (byInnerTail.body.items as Array<Record<string, unknown>>)
      .find(item => item.bookingRef === `RARBOOK-1792${TAIL}-9bzut2`);
    assert.equal(leaked, undefined, 'the pre-suffix block tail is not the lot’s tail');
  });

  test('an ad-hoc lot reports its free-text customer name', async () => {
    const result = await suggest(TAIL);
    const adhoc = (result.body.items as Array<Record<string, unknown>>).find(item => item.billNumber === `HLXU${TAIL}`);
    assert.ok(adhoc);
    assert.equal(adhoc.customerName, `${prefix}-Khách Ngoài`);
  });

  test('fewer than four digits is rejected rather than guessing', async () => {
    for (const query of ['1', '12', '774']) {
      const result = await suggest(query);
      assert.equal(result.status, 400, `"${query}" must not search`);
    }
  });

  test('a non-digit query is rejected', async () => {
    assert.equal((await suggest('abcd')).status, 400);
    assert.equal((await suggest('774a')).status, 400);
  });

  test('a tail with no match returns an empty list, not an error', async () => {
    // '9091' cannot collide with a seeded bill; '0001' does (BULK-IMP-0001).
    const result = await suggest('9091');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.items, []);
  });
});