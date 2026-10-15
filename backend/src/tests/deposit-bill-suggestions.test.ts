// "Thêm cược" Bill typeahead (owner ruling 2026-10-14): Kế toán types the LAST
// FOUR DIGITS of a Bill/Booking and picks the lot; the form then fills
// Bill/Booking – Hãng tàu – Tên khách hàng from the customer-side lot data.
//
// Pins: the four-digit rule (shorter input is ambiguous and rejected), the
// Bill-then-Booking display key, the ad-hoc customer fallback, and the
// "already deposited N times" signal the form warns with.

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
    assert.equal(items.length, 3, 'the YMLU, ONE and HLXU lots match; the 0000 lot does not');

    const bill = items.find(item => item.billNumber === `YMLU${TAIL}`);
    assert.ok(bill, 'the Bill-number lot is listed');
    assert.equal(bill.carrierName, 'YML');
    assert.equal(bill.customerName, `${prefix}-Khách Hàng`);
    assert.equal(bill.existingTrackerCount, 1, 'the form can warn that this lot is already on deposit');

    const booking = items.find(item => item.bookingRef === `ONE${TAIL}`);
    assert.ok(booking, 'a Booking-number lot matches too');
    assert.equal(booking.billDisplay, `ONE${TAIL}`, 'the display key falls back to the Booking number');
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