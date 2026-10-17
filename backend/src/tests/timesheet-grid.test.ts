// Chấm công lái xe — the grid write path, the accountant's signed correction,
// the reconcile lock and the month rollup, driven over real HTTP with a real
// Postgres (the shape used by deposit-refund-http.test.ts).
//
// What this pins, per the accountant doc + owner ruling 2026-10-14:
//   - the grid accepts SYMBOLS only (a client cannot post its own trip count),
//   - K (kẹp 2 cont) counts ONE trip, Q (quay đầu) counts TWO,
//   - a Sunday records its trips but is never an attended day,
//   - the 21st trip starts the +100.000đ bonus,
//   - the accountant's correction may be NEGATIVE and floors the money at zero,
//   - a reconciled month refuses further grid writes until it is reopened,
//   - the rollup reports the efficiency metrics leadership reads.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import timesheetRoutes from '../routes/timesheet';
import { disconnectRedis } from '../lib/redis';

const prefix = `timesheet-${Date.now()}`;
let server: Server;
let base: string;
let dispatcherToken: string;
let accountantToken: string;
const monthIds: number[] = [];
const driverIds: number[] = [];
const userIds: number[] = [];
const tripIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];

async function mintUser(role: 'DISPATCHER' | 'ACCOUNTANT'): Promise<{ id: number; token: string }> {
  const [user] = await db.insert(s.users)
    .values({ username: `${prefix}-${role}`, passwordHash: 'test', role, status: 'ACTIVE' })
    .returning();
  userIds.push(user.id);
  return { id: user.id, token: jwt.sign({ userId: user.id, role }, config.jwtSecret, { expiresIn: '1h' }) };
}

before(async () => {
  dispatcherToken = (await mintUser('DISPATCHER')).token;
  accountantToken = (await mintUser('ACCOUNTANT')).token;

  const app = express();
  app.use(express.json());
  app.use('/api/timesheet', authMiddleware, timesheetRoutes);
  app.use(globalErrorHandler);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/timesheet`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (monthIds.length) {
    await db.delete(s.driverTimesheetDays).where(inArray(s.driverTimesheetDays.monthId, monthIds));
    await db.delete(s.driverTimesheetMonths).where(inArray(s.driverTimesheetMonths.id, monthIds));
  }
  if (tripIds.length) {
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  if (userIds.length) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }
  await disconnectRedis();
  await client.end();
});

async function request(path: string, method: string, body: unknown, token = accountantToken) {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // A GET must not carry a body — fetch rejects it outright.
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

async function openMonth(options: {
  year?: number; month?: number; salaryMode?: 'PER_TRIP' | 'FLAT_MONTHLY';
  dailyBase?: number | null; flatAmount?: number | null;
} = {}): Promise<{ monthId: number; driverId: number }> {
  // Each test gets its OWN driver, so the (driver, year, month) unique index
  // stays a per-test fact instead of leaking state between cases.
  const [driver] = await db.insert(s.drivers)
    .values({ name: `${prefix}-driver-${driverIds.length}`, status: 'ACTIVE' })
    .returning();
  driverIds.push(driver.id);
  const created = await request('/months', 'POST', {
    driverId: driver.id,
    year: options.year ?? 2026,
    month: options.month ?? 10,
    salaryMode: options.salaryMode ?? 'PER_TRIP',
    dailyBase: options.dailyBase === undefined ? 200_000 : options.dailyBase,
    flatAmount: options.flatAmount ?? null,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  monthIds.push(created.body.id);
  return { monthId: created.body.id, driverId: driver.id };
}

describe('timesheet grid — dispatcher writes symbols', () => {
  // FB-103 (ticket 171026215600, verify-fail card 141026230800): chế độ lương
  // phải chọn được ở mức LÁI XE và là mặc định khi mở bảng tháng mới. Kế toán
  // bỏ qua salaryMode trong POST /months → bảng mới nhận chế độ của lái xe.
  test('opening a month without a mode uses the driver\'s own salary mode', async () => {
    const [driver] = await db.insert(s.drivers)
      .values({ name: `${prefix}-mode-driver`, status: 'ACTIVE', salaryMode: 'FLAT_MONTHLY' })
      .returning();
    driverIds.push(driver.id);

    const driversList = await request('/drivers?year=2026&month=12', 'GET', {});
    assert.equal(driversList.status, 200, JSON.stringify(driversList.body));
    const listed = (driversList.body.items as Array<{ id: number; defaultSalaryMode: string }>)
      .find(row => row.id === driver.id);
    assert.equal(listed?.defaultSalaryMode, 'FLAT_MONTHLY');

    const created = await request('/months', 'POST', {
      driverId: driver.id, year: 2026, month: 12, flatAmount: 10_000_000,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.salaryMode, 'FLAT_MONTHLY');
    monthIds.push(created.body.id);
  });

  test('a K cell is one trip and a Q cell is two', async () => {
    const { monthId } = await openMonth();
    const saved = await request(`/months/${monthId}/days`, 'PUT', {
      days: [
        { workDate: '2026-10-05', symbol: 'K' },
        { workDate: '2026-10-06', symbol: 'Q' },
        { workDate: '2026-10-07', symbol: 'Đ' },
        { workDate: '2026-10-08', symbol: 'L' },
        { workDate: '2026-10-09', symbol: 'N' },
        { workDate: '2026-10-13', symbol: 'P' },
      ],
    }, dispatcherToken);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.salary.trips, 4, 'K=1 + Q=2 + Đ=1 + L/N/P=0');
    assert.equal(saved.body.salary.workdays, 5, 'L counts, N does not; every day here is a workday');

    const [row] = await db.select().from(s.driverTimesheetDays)
      .where(eq(s.driverTimesheetDays.workDate, '2026-10-05'));
    assert.equal(row.symbol, 'K');
    assert.ok(row.enteredBy, 'the dispatcher is stamped as the writer');
  });

  test('the API rejects an unknown symbol and a client-supplied trip count', async () => {
    const { monthId } = await openMonth();
    const bad = await request(`/months/${monthId}/days`, 'PUT', { days: [{ workDate: '2026-10-05', symbol: 'X' }] }, dispatcherToken);
    assert.equal(bad.status, 400);
    const smuggled = await request(`/months/${monthId}/days`, 'PUT', {
      days: [{ workDate: '2026-10-05', symbol: 'Đ', trips: 99 }],
    }, dispatcherToken);
    assert.equal(smuggled.status, 400, 'trips are the server\'s to decide, never the client\'s');
  });

  test('a day outside the month is refused', async () => {
    const { monthId } = await openMonth();
    const outside = await request(`/months/${monthId}/days`, 'PUT', { days: [{ workDate: '2026-11-01', symbol: 'Đ' }] }, dispatcherToken);
    assert.equal(outside.status, 400);
  });
});

describe('timesheet Sunday rule', () => {
  test('a Sunday records its trips but is never an attended day', async () => {
    const { monthId } = await openMonth();
    const saved = await request(`/months/${monthId}/days`, 'PUT', {
      days: [
        { workDate: '2026-10-11', symbol: 'Q' }, // Sunday
        { workDate: '2026-10-12', symbol: 'Đ' },
      ],
    }, dispatcherToken);
    assert.equal(saved.body.salary.trips, 3, 'the Sunday trips are still recorded');
    assert.equal(saved.body.salary.workdays, 1, 'only Monday counts as an attended day');
    assert.equal(saved.body.salary.dailyBasePay, 200_000);
  });
});

describe('timesheet salary by mode', () => {
  test('per-trip pays 300.000đ and adds 100.000đ from the 21st trip', async () => {
    const { monthId } = await openMonth({ month: 9, dailyBase: 0 });
    const days = Array.from({ length: 21 }, (_, index) => ({
      workDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
      symbol: 'Đ' as const,
    }));
    const saved = await request(`/months/${monthId}/days`, 'PUT', { days }, dispatcherToken);
    assert.equal(saved.body.salary.trips, 21);
    assert.equal(saved.body.salary.bonusTrips, 1);
    assert.equal(saved.body.salary.salaryTotal, 21 * 300_000 + 100_000);
  });

  test('a flat month pays the configured figure regardless of trips', async () => {
    const { monthId } = await openMonth({ month: 8, salaryMode: 'FLAT_MONTHLY', flatAmount: 10_000_000 });
    const days = Array.from({ length: 20 }, (_, index) => ({
      workDate: `2026-08-${String(index + 1).padStart(2, '0')}`,
      symbol: 'Đ' as const,
    }));
    const saved = await request(`/months/${monthId}/days`, 'PUT', { days }, dispatcherToken);
    assert.equal(saved.body.salary.salaryTotal, 10_000_000);
    assert.equal(saved.body.salary.trips, 20);
  });

  test('an unconfigured money input is reported as a warning, not a silent zero', async () => {
    const created = await openMonth({ month: 7, salaryMode: 'FLAT_MONTHLY' });
    assert.ok(created.monthId > 0);
    const reread = await request(`/months/${created.monthId}`, 'GET', {});
    assert.ok(reread.body.warnings.length > 0, 'the accountant is told the flat figure is missing');
  });
});

describe('timesheet accountant reconciliation', () => {
  test('a negative correction reduces the trips and the money floors at zero', async () => {
    const { monthId } = await openMonth();
    const saved = await request(`/months/${monthId}/days`, 'PUT', {
      days: [
        { workDate: '2026-10-05', symbol: 'Q' },
        { workDate: '2026-10-06', symbol: 'Đ' },
      ],
    }, dispatcherToken);
    assert.equal(saved.body.salary.trips, 3);

    const dayId = saved.body.days.find((day: { workDate: string }) => day.workDate === '2026-10-05').id;
    const adjusted = await request(`/months/${monthId}/days/${dayId}/adjustment`, 'PUT', { tripAdjustment: -1 });
    assert.equal(adjusted.body.salary.trips, 2, 'Q becomes a single trip');
    assert.equal(adjusted.body.salary.salaryTotal, 2 * 300_000 + 2 * 200_000);

    const [row] = await db.select().from(s.driverTimesheetDays).where(eq(s.driverTimesheetDays.id, dayId));
    assert.equal(row.tripAdjustment, -1);
    assert.ok(row.adjustedBy, 'the correcting accountant is stamped');
  });

  test('a dispatcher may not apply a correction', async () => {
    const { monthId } = await openMonth();
    const saved = await request(`/months/${monthId}/days`, 'PUT', { days: [{ workDate: '2026-10-05', symbol: 'Đ' }] }, dispatcherToken);
    const dayId = saved.body.days.find((day: { workDate: string }) => day.workDate === '2026-10-05').id;
    const denied = await request(`/months/${monthId}/days/${dayId}/adjustment`, 'PUT', { tripAdjustment: -1 }, dispatcherToken);
    assert.equal(denied.status, 403);
  });

  test('a reconciled month locks the grid until it is reopened', async () => {
    const { monthId } = await openMonth();
    await request(`/months/${monthId}/days`, 'PUT', { days: [{ workDate: '2026-10-05', symbol: 'Đ' }] }, dispatcherToken);

    const reconciled = await request(`/months/${monthId}/reconcile`, 'POST', { note: 'Đã so với phiếu' });
    assert.equal(reconciled.body.status, 'RECONCILED');

    const blocked = await request(`/months/${monthId}/days`, 'PUT', { days: [{ workDate: '2026-10-06', symbol: 'Đ' }] }, dispatcherToken);
    assert.equal(blocked.status, 409);

    const reopened = await request(`/months/${monthId}/reopen`, 'POST', {});
    assert.equal(reopened.body.status, 'OPEN');
    const allowed = await request(`/months/${monthId}/days`, 'PUT', { days: [{ workDate: '2026-10-06', symbol: 'Đ' }] }, dispatcherToken);
    assert.equal(allowed.status, 200);
  });

  test('a grid write after reconciliation returns the month to OPEN', async () => {
    const { monthId } = await openMonth();
    await request(`/months/${monthId}/reconcile`, 'POST', {});
    const reopened = await request(`/months/${monthId}/reopen`, 'POST', {});
    assert.equal(reopened.body.status, 'OPEN');
  });

  // Independent-review finding: the correction endpoint never checked the
  // month status, so an accountant could restate a SEALED month and leave it
  // marked RECONCILED with a different figure than the one reconciled.
  test('a correction on a reconciled month is refused, not silently applied', async () => {
    const { monthId } = await openMonth();
    const saved = await request(`/months/${monthId}/days`, 'PUT', {
      days: [{ workDate: '2026-10-05', symbol: 'Q' }],
    }, dispatcherToken);
    const dayId = saved.body.days.find((day: { workDate: string }) => day.workDate === '2026-10-05').id;

    await request(`/months/${monthId}/reconcile`, 'POST', {});
    const sealed = await request(`/months/${monthId}/days/${dayId}/adjustment`, 'PUT', { tripAdjustment: -2 });
    assert.equal(sealed.status, 409);

    const [row] = await db.select().from(s.driverTimesheetDays).where(eq(s.driverTimesheetDays.id, dayId));
    assert.equal(row.tripAdjustment, 0, 'the sealed figure is untouched');

    await request(`/months/${monthId}/reopen`, 'POST', {});
    const afterReopen = await request(`/months/${monthId}/days/${dayId}/adjustment`, 'PUT', { tripAdjustment: -2 });
    assert.equal(afterReopen.status, 200);
  });

  // Independent-review finding: the month check only compared year+month, so
  // "2026-10-99" reached Postgres and surfaced as a 500 instead of a 400.
  test('a day that does not exist in the month is a 400, not a 500', async () => {
    const { monthId } = await openMonth();
    const invalidDay = await request(`/months/${monthId}/days`, 'PUT', {
      days: [{ workDate: '2026-10-99', symbol: 'Đ' }],
    }, dispatcherToken);
    assert.equal(invalidDay.status, 400);
  });

  test('a re-entered cell keeps the discarded correction in the audit trail', async () => {
    const { monthId } = await openMonth();
    const saved = await request(`/months/${monthId}/days`, 'PUT', {
      days: [{ workDate: '2026-10-05', symbol: 'Q' }],
    }, dispatcherToken);
    const dayId = saved.body.days.find((day: { workDate: string }) => day.workDate === '2026-10-05').id;
    await request(`/months/${monthId}/days/${dayId}/adjustment`, 'PUT', { tripAdjustment: -1 });

    await request(`/months/${monthId}/days`, 'PUT', {
      days: [{ workDate: '2026-10-05', symbol: 'Đ' }],
    }, dispatcherToken);

    const [audit] = await db.select().from(s.auditLogs)
      .where(and(eq(s.auditLogs.entityId, monthId), eq(s.auditLogs.entityType, 'TIMESHEET_MONTH')))
      .orderBy(desc(s.auditLogs.id));
    const discarded = (audit?.payload as { discardedAdjustments?: Array<{ tripAdjustment: number }> } | null)?.discardedAdjustments;
    assert.ok(discarded?.length === 1, 'the discarded correction is recorded, not silently dropped');
    assert.equal(discarded[0].tripAdjustment, -1);
  });
});

describe('timesheet month rollup', () => {
  test('reports per-symbol counts, trips, workdays, salary and the efficiency metrics', async () => {
    const { monthId, driverId } = await openMonth();
    const [customer] = await db.insert(s.customers)
      .values({ name: `${prefix}-customer`, shortName: prefix, status: 'ACTIVE' })
      .returning();
    customerIds.push(customer.id);
    const [route] = await db.insert(s.routes)
      .values({ name: `${prefix}-route` })
      .returning();
    routeIds.push(route.id);

    const [trip] = await db.insert(s.trips).values({
      customerId: customer.id,
      routeId: route.id,
      driverId,
      departureDate: '2026-10-05',
      status: 'COMPLETED',
    }).returning();
    tripIds.push(trip.id);
    await db.insert(s.tripFinancialState).values({
      tripId: trip.id,
      revenue: '5000000',
      totalCost: '3000000',
    });

    await request(`/months/${monthId}/days`, 'PUT', {
      days: [
        { workDate: '2026-10-05', symbol: 'Q' },
        { workDate: '2026-10-06', symbol: 'Đ' },
        { workDate: '2026-10-11', symbol: 'Đ' },
      ],
    }, dispatcherToken);

    const rollup = await request('/rollup?year=2026&month=10', 'GET', {});
    assert.equal(rollup.status, 200);
    const row = rollup.body.items.find((item: { driverId: number }) => item.driverId === driverId);
    assert.ok(row, 'the driver appears in the rollup');
    assert.equal(row.quayDauCount, 1);
    assert.equal(row.donCount, 2);
    assert.equal(row.trips, 4, 'Q=2 + Đ=1 + the Sunday Đ=1');
    assert.equal(row.workdays, 2, 'the Sunday Đ is not an attended day');
    assert.equal(row.sundayTrips, 1, 'Sunday trips are reported for the separate Sunday pay');
    assert.equal(row.salary, 4 * 300_000 + 2 * 200_000);
    assert.equal(row.revenue, 5000000);
    assert.equal(row.cost, 3000000);
    assert.equal(row.salaryRatio, Math.round((row.salary / 5000000) * 10000) / 10000);
    assert.equal(row.status, 'OPEN');
  });

  test('an empty period returns an empty rollup instead of failing', async () => {
    const rollup = await request('/rollup?year=2026&month=2', 'GET', {});
    assert.equal(rollup.status, 200);
    assert.deepEqual(rollup.body.items, []);
  });
});