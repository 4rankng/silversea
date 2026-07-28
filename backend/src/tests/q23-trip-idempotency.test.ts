import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import tripRoutes from '../routes/trips';

const keys: string[] = [];
const tripIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const userIds: number[] = [];
let server: http.Server;
let baseUrl: string;

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [user] = await db.insert(s.users).values({
    username: `q23-replay-${suffix}`,
    passwordHash: 'x',
    role: Role.MANAGER,
  }).returning();
  userIds.push(user.id);

  const app = express();
  app.use(express.json());
  app.use('/api/trips', (req, _res, next) => {
    req.user = {
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
      role: Role.MANAGER,
    };
    next();
  }, tripRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (keys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, keys));
  }
  if (tripIds.length > 0) {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, tripIds));
    await db.delete(s.tripInstructions).where(inArray(s.tripInstructions.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (routeIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (cargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  await client.end();
});

async function fixtureTrip() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers).values({
    name: `Q23 replay customer ${suffix}`,
  }).returning();
  const [route] = await db.insert(s.routes).values({
    name: `Q23 replay route ${suffix}`,
  }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q23 replay cargo ${suffix}`,
  }).returning();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q23-R-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.CREATED,
    version: 1,
    departureDate: '2026-07-27',
  }).returning();
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(cargoType.id);
  tripIds.push(trip.id);
  return trip;
}

async function jsonRequest(
  path: string,
  method: string,
  key: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: await response.json() as Record<string, unknown>,
  };
}

describe('Q23 immutable trip replay', () => {
  test('replays the original instruction response after the live row changes', async () => {
    const trip = await fixtureTrip();
    const key = `q23-instructions-${trip.id}`;
    keys.push(key);
    const payload = { notes: 'Chỉ dẫn ban đầu', expectedVersion: 1 };

    const first = await jsonRequest(
      `/api/trips/${trip.id}/instructions`,
      'PUT',
      key,
      payload,
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.body.notes, 'Chỉ dẫn ban đầu');
    assert.equal(first.body.replayed, false);

    await db.update(s.tripInstructions)
      .set({ notes: 'Dữ liệu đã thay đổi sau phản hồi đầu tiên' })
      .where(eq(s.tripInstructions.tripId, trip.id));

    const replay = await jsonRequest(
      `/api/trips/${trip.id}/instructions`,
      'PUT',
      key,
      payload,
    );
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.notes, 'Chỉ dẫn ban đầu');
    assert.equal(replay.body.id, first.body.id);
    assert.equal(replay.body.replayed, true);
    const { replayed: firstReplayFlag, ...firstSnapshot } = first.body;
    const { replayed: replayFlag, ...replayedSnapshot } = replay.body;
    assert.equal(firstReplayFlag, false);
    assert.equal(replayFlag, true);
    assert.deepEqual(replayedSnapshot, firstSnapshot);
  });

  test('returns 409 when an instruction key is reused with a different payload', async () => {
    const trip = await fixtureTrip();
    const key = `q23-instructions-mismatch-${trip.id}`;
    keys.push(key);

    const first = await jsonRequest(
      `/api/trips/${trip.id}/instructions`,
      'PUT',
      key,
      { notes: 'Bản thứ nhất', expectedVersion: 1 },
    );
    assert.equal(first.response.status, 200);

    const mismatch = await jsonRequest(
      `/api/trips/${trip.id}/instructions`,
      'PUT',
      key,
      { notes: 'Bản khác', expectedVersion: 1 },
    );
    assert.equal(mismatch.response.status, 409);
    assert.match(String(mismatch.body.error), /Khóa giao dịch trùng nhưng nội dung khác/);
  });

  test('serializes concurrent expense creates and commits one expense with one receipt', async () => {
    const trip = await fixtureTrip();
    const key = `q23-expense-create-${trip.id}`;
    keys.push(key);
    const payload = {
      expenseType: 'LIFTING',
      buyAmount: 125000,
      sellAmount: 150000,
      settlementMethod: 'COMPANY_DIRECT',
      expenseDate: '2026-07-27',
      payeeName: 'Đơn vị nâng hạ',
      note: 'Q23 concurrent retry',
      noInvoiceEvidenceTypes: ['RECEIPT'],
    };

    const requests = await Promise.all([
      jsonRequest(`/api/trips/${trip.id}/expenses`, 'POST', key, payload),
      jsonRequest(`/api/trips/${trip.id}/expenses`, 'POST', key, payload),
    ]);
    assert.deepEqual(requests.map((item) => item.response.status), [201, 201]);
    assert.equal(requests[0].body.id, requests[1].body.id);
    assert.deepEqual(
      requests.map((item) => item.body.replayed).sort(),
      [false, true],
    );

    const expenses = await db.select({ id: s.tripExpenses.id })
      .from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, trip.id));
    assert.equal(expenses.length, 1);
    const receipts = await db.select({ id: s.idempotencyKeys.id })
      .from(s.idempotencyKeys)
      .where(and(
        eq(s.idempotencyKeys.endpoint, 'trip-expenses.create'),
        eq(s.idempotencyKeys.idempotencyKey, key),
      ));
    assert.equal(receipts.length, 1);
  });

  test('does not reserve the key when the transaction fails', async () => {
    const trip = await fixtureTrip();
    const key = `q23-instructions-rollback-${trip.id}`;
    keys.push(key);

    const stale = await jsonRequest(
      `/api/trips/${trip.id}/instructions`,
      'PUT',
      key,
      { notes: 'Không được lưu', expectedVersion: 2 },
    );
    assert.equal(stale.response.status, 409);
    const [receiptAfterFailure] = await db.select()
      .from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key));
    assert.equal(receiptAfterFailure, undefined);

    const retry = await jsonRequest(
      `/api/trips/${trip.id}/instructions`,
      'PUT',
      key,
      { notes: 'Được lưu sau khi sửa phiên bản', expectedVersion: 1 },
    );
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.replayed, false);
    assert.equal(retry.body.notes, 'Được lưu sau khi sửa phiên bản');
  });
});
