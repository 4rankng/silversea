/**
 * REQ-5.10-01 — "Tổng quát về tiền" weekly container-deposit summary
 * (GET /api/accounting/deposits/weekly-summary → getDepositWeeklySummary).
 * Service-level bucketing suite + route guard; fixtures `wsum-*` parked in
 * far-future windows (2032-03/04/05/06) so no other suite's rolling data can
 * leak into the buckets. Harness mirrors card19-deposit-tracker.test.ts /
 * deposit-refund-http.test.ts (local DB, real user row for the signed token).
 *
 * Coverage:
 *   Mon→Sun bucketing — a Sunday and its following Monday land in different
 *       weeks; every week in range renders, empty ones zeroed.
 *   Refunds bucket by refundPostedAt when present, by updatedAt when null,
 *       and a refund counts in ITS OWN week even when the lot landed earlier.
 *   Range edges clamp inclusion while weekStart stays the true Monday.
 *   totals are exactly the sums of the week rows.
 *   from > to answers the business 400 at the route, and at the service too.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import depositRoutes from '../routes/accounting-deposit';
import { getDepositWeeklySummary } from '../services/deposit-refund-tracker.service';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';

const suffix = `wsum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<void>> = [];

const actor = { userId: 0, role: Role.ACCOUNTANT };
let server: http.Server;
let baseUrl = '';
let token = '';
let userId = 0;

async function mkTracker(overrides: {
  billNumber: string; depositAmount: string; createdAt: Date;
  status?: 'CHUA_HOAN_CUOC' | 'DA_HOAN_CUOC'; refundPostedAt?: Date; updatedAt?: Date;
}) {
  const [row] = await db.insert(s.depositRefundTrackers).values({
    billNumber: `${suffix}-${overrides.billNumber}`,
    customerName: `wsum cust ${suffix}`,
    carrierName: 'YML',
    depositAmount: overrides.depositAmount,
    status: overrides.status ?? 'CHUA_HOAN_CUOC',
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt ?? overrides.createdAt,
    refundPostedAt: overrides.refundPostedAt ?? null,
  }).returning();
  cleanup.unshift(async () => { await db.delete(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, row.id)); });
  return row;
}

async function get(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/weekly-summary${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: `${suffix}-acct`, passwordHash: 'x', role: 'ACCOUNTANT', status: 'ACTIVE',
  }).returning();
  userId = user.id;
  actor.userId = user.id;
  token = jwt.sign({ userId: user.id, role: 'ACCOUNTANT' }, config.jwtSecret, { expiresIn: '1h' });
  const app = express();
  app.use(express.json());
  app.use('/api/accounting/deposits', authMiddleware, depositRoutes);
  app.use(globalErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/deposits`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  for (const fn of cleanup) await fn();
  if (userId) await db.delete(s.users).where(eq(s.users.id, userId));
  await disconnectRedis();
  await client.end();
});

describe('weekly deposit summary — Mon→Sun buckets (REQ-5.10-01)', () => {
  test('a Sunday and its Monday split weeks; empty weeks render zeroed; totals = Σ weeks', async () => {
    await mkTracker({ billNumber: 'sun', depositAmount: '1000000', createdAt: new Date('2032-03-07T12:00:00Z') });
    await mkTracker({ billNumber: 'mon', depositAmount: '2000000', createdAt: new Date('2032-03-08T08:00:00Z') });
    const summary = await getDepositWeeklySummary(actor, { from: '2032-03-01', to: '2032-03-21' });
    assert.deepEqual(summary.weeks.map((week) => week.weekStart), ['2032-03-01', '2032-03-08', '2032-03-15']);
    assert.deepEqual(summary.weeks.map((week) => week.label), ['Tuần 01/03', 'Tuần 08/03', 'Tuần 15/03']);
    assert.deepEqual(summary.weeks[0], { weekStart: '2032-03-01', label: 'Tuần 01/03', count: 1, depositAmount: 1000000, refundedAmount: 0 }, 'Sunday 07/03 buckets into the Mon 01/03 week');
    assert.deepEqual(summary.weeks[1], { weekStart: '2032-03-08', label: 'Tuần 08/03', count: 1, depositAmount: 2000000, refundedAmount: 0 }, 'Monday 08/03 opens its OWN week');
    assert.deepEqual(summary.weeks[2], { weekStart: '2032-03-15', label: 'Tuần 15/03', count: 0, depositAmount: 0, refundedAmount: 0 }, 'empty week still renders, zeroed');
    assert.deepEqual(summary.totals, {
      count: summary.weeks.reduce((sum, week) => sum + week.count, 0),
      depositAmount: summary.weeks.reduce((sum, week) => sum + week.depositAmount, 0),
      refundedAmount: summary.weeks.reduce((sum, week) => sum + week.refundedAmount, 0),
    }, 'totals are exactly the sums of the week rows');
    assert.deepEqual(summary.totals, { count: 2, depositAmount: 3000000, refundedAmount: 0 });
  });

  test('refunds bucket by refundPostedAt when present, by updatedAt when null', async () => {
    // Created week 05/04, refunded week 12/04 — the refund lands in ITS week.
    await mkTracker({
      billNumber: 'ref-posted', depositAmount: '3000000',
      createdAt: new Date('2032-04-06T09:00:00Z'), status: 'DA_HOAN_CUOC', refundPostedAt: new Date('2032-04-13T10:00:00Z'),
    });
    // refundPostedAt null → updatedAt decides (week 19/04).
    await mkTracker({
      billNumber: 'ref-fallback', depositAmount: '4000000',
      createdAt: new Date('2032-04-07T09:00:00Z'), status: 'DA_HOAN_CUOC', updatedAt: new Date('2032-04-20T11:00:00Z'),
    });
    // Lot landed BEFORE the window — its in-window refund still counts in the refund series.
    await mkTracker({
      billNumber: 'ref-early-lot', depositAmount: '5000000',
      createdAt: new Date('2032-03-29T09:00:00Z'), status: 'DA_HOAN_CUOC', refundPostedAt: new Date('2032-04-14T10:00:00Z'),
    });
    const summary = await getDepositWeeklySummary(actor, { from: '2032-04-05', to: '2032-04-25' });
    assert.deepEqual(summary.weeks.map((week) => week.weekStart), ['2032-04-05', '2032-04-12', '2032-04-19']);
    assert.deepEqual(summary.weeks[0], { weekStart: '2032-04-05', label: 'Tuần 05/04', count: 2, depositAmount: 7000000, refundedAmount: 0 }, 'only in-window createdAt rows feed the deposit series');
    assert.deepEqual(summary.weeks[1], { weekStart: '2032-04-12', label: 'Tuần 12/04', count: 0, depositAmount: 0, refundedAmount: 8000000 }, 'refundPostedAt 13/04 + 14/04 bucket into week 12/04');
    assert.deepEqual(summary.weeks[2], { weekStart: '2032-04-19', label: 'Tuần 19/04', count: 0, depositAmount: 0, refundedAmount: 4000000 }, 'null refundPostedAt falls back to updatedAt 20/04');
    assert.deepEqual(summary.totals, { count: 2, depositAmount: 7000000, refundedAmount: 12000000 });
  });

  test('range edges clamp inclusion while weekStart stays the true Monday', async () => {
    await mkTracker({ billNumber: 'edge-before', depositAmount: '9000000', createdAt: new Date('2032-05-03T09:00:00Z') }); // Mon, before from
    await mkTracker({ billNumber: 'edge-sun', depositAmount: '1000000', createdAt: new Date('2032-05-09T09:00:00Z') }); // Sun, in range
    await mkTracker({ billNumber: 'edge-after', depositAmount: '8000000', createdAt: new Date('2032-05-13T09:00:00Z') }); // Thu, after to
    const summary = await getDepositWeeklySummary(actor, { from: '2032-05-05', to: '2032-05-12' });
    assert.deepEqual(summary.weeks.map((week) => week.weekStart), ['2032-05-03', '2032-05-10'], 'weekStarts stay the true Mondays, wider than [from,to]');
    assert.deepEqual(summary.weeks[0], { weekStart: '2032-05-03', label: 'Tuần 03/05', count: 1, depositAmount: 1000000, refundedAmount: 0 }, 'only the in-range day counts in the clamped first week');
    assert.deepEqual(summary.weeks[1], { weekStart: '2032-05-10', label: 'Tuần 10/05', count: 0, depositAmount: 0, refundedAmount: 0 }, 'the day after to is clamped out of the last week');
    assert.deepEqual(summary.totals, { count: 1, depositAmount: 1000000, refundedAmount: 0 });
  });

  test('from > to is rejected at the service boundary too', async () => {
    await assert.rejects(
      () => getDepositWeeklySummary(actor, { from: '2032-05-12', to: '2032-05-05' }),
      (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
  });
});

describe('GET /api/accounting/deposits/weekly-summary (route guard)', () => {
  test('from > to answers the business 400', async () => {
    const bad = await get('?from=2032-03-21&to=2032-03-01');
    assert.equal(bad.status, 400, JSON.stringify(bad.body).slice(0, 160));
    assert.match(String(bad.body.error ?? ''), /Ngày từ phải trước/);
  });

  test('a valid range answers 200 with the zeroed week row', async () => {
    const ok = await get('?from=2032-06-07&to=2032-06-13');
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 160));
    assert.deepEqual(ok.body.weeks, [{ weekStart: '2032-06-07', label: 'Tuần 07/06', count: 0, depositAmount: 0, refundedAmount: 0 }]);
    assert.deepEqual(ok.body.totals, { count: 0, depositAmount: 0, refundedAmount: 0 });
  });
});
