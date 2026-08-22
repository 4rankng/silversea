import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import penaltiesRoutes from '../routes/financial/penalties.routes';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY_MS = 86_400_000;

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdPenaltyIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let adminToken: string;
let driverA: { id: number; name: string };
let driverB: { id: number; name: string };

/** Seeded rows — single source for every expectation below. */
interface SeedPenalty { driver: 'A' | 'B'; amount: number; date: string; status: 'ACTIVE' | 'CANCELED'; customReason?: string }
const seedPenalties: SeedPenalty[] = [
  { driver: 'A', amount: 100_000, date: '2026-08-01', status: 'ACTIVE', customReason: `penalty-list alpha ${suffix}` },
  { driver: 'A', amount: 200_000, date: '2026-08-05', status: 'CANCELED', customReason: 'penalty-list other' },
  { driver: 'B', amount: 300_000, date: '2026-07-15', status: 'ACTIVE' },
  { driver: 'B', amount: 400_000, date: '2026-01-20', status: 'ACTIVE' },
  { driver: 'B', amount: 50_000, date: '2025-12-31', status: 'ACTIVE' },
];
const yearStart = `${new Date().getFullYear()}-01-01`;

async function request(path: string, token = adminToken) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function sign(userId: number, username: string, role: Role) {
  return jwt.sign({ userId, username, role }, config.jwtSecret);
}

/** Mirror of the frontend computeStreak / service streak formula. */
function expectedStreakDays(lastPenaltyDate: string | null, createdAt: Date) {
  const anchor = lastPenaltyDate ? new Date(lastPenaltyDate).getTime() : createdAt.getTime();
  return Math.max(0, Math.floor((Date.now() - anchor) / DAY_MS));
}

before(async () => {
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('financial'), penaltiesRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const [admin] = await db.insert(s.users).values({
    username: `penalties-list-admin-${suffix}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role: Role.ADMIN,
  }).returning();
  createdUserIds.push(admin.id);
  adminToken = sign(admin.id, admin.username ?? `user-${admin.id}`, Role.ADMIN);

  const [driverARow] = await db.insert(s.drivers).values({
    name: `Penalties list A ${suffix}`,
  }).returning();
  const [driverBRow] = await db.insert(s.drivers).values({
    name: `Penalties list B ${suffix}`,
  }).returning();
  createdDriverIds.push(driverARow.id, driverBRow.id);
  driverA = { id: driverARow.id, name: driverARow.name };
  driverB = { id: driverBRow.id, name: driverBRow.name };

  const inserted = await db.insert(s.penalties).values(seedPenalties.map((p) => ({
    driverId: p.driver === 'A' ? driverARow.id : driverBRow.id,
    amount: String(p.amount),
    date: p.date,
    status: p.status,
    customReason: p.customReason ?? null,
  }))).returning();
  for (const row of inserted) createdPenaltyIds.push(row.id);
});

after(async () => {
  try {
    if (createdPenaltyIds.length > 0) {
      await db.delete(s.penalties).where(inArray(s.penalties.id, createdPenaltyIds));
    }
    if (createdDriverIds.length > 0) {
      await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } catch (err) {
    console.warn('[penalties-list] cleanup:', (err as Error).message);
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await client.end();
  }
});

describe('GET /api/penalties (paginated)', () => {
  // Every seeded driver name and the one custom reason carry `suffix`, so a
  // search on it deterministically scopes the shared demo DB to our 5 rows.
  const scoped = `/penalties?search=${encodeURIComponent(suffix)}`;

  test('returns the paginated envelope with a real total and stable date-desc order', async () => {
    const { status, body } = await request(`${scoped}&limit=2`);
    assert.equal(status, 200);
    assert.equal(body.total, 5);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 2);
    assert.equal(body.items.length, 2);
    assert.notEqual(body.total, body.items.length);
    assert.equal(body.items[0].date, '2026-08-05');
    assert.equal(body.items[0].driverName, driverA.name);
    assert.equal(body.items[1].date, '2026-08-01');
  });

  test('later pages continue the ordering and the last page is partial', async () => {
    const page2 = await request(`${scoped}&limit=2&page=2`);
    assert.equal(page2.status, 200);
    assert.equal(page2.body.items.length, 2);
    assert.equal(page2.body.items[0].date, '2026-07-15');

    const page3 = await request(`${scoped}&limit=2&page=3`);
    assert.equal(page3.body.items.length, 1);
    assert.equal(page3.body.items[0].date, '2025-12-31');
  });

  test('filters by driverId', async () => {
    const { status, body } = await request(`/penalties?driverId=${driverA.id}`);
    assert.equal(status, 200);
    assert.equal(body.total, 2);
    assert.ok(body.items.every((item: { driverId: number }) => item.driverId === driverA.id));
  });

  test('search matches driver name and reason text', async () => {
    const byDriverName = await request(`/penalties?search=${encodeURIComponent(`list A ${suffix}`)}`);
    assert.equal(byDriverName.status, 200);
    assert.equal(byDriverName.body.total, 2);

    const byReason = await request(`/penalties?search=${encodeURIComponent(`alpha ${suffix}`)}`);
    assert.equal(byReason.status, 200);
    assert.equal(byReason.body.total, 1);
    assert.equal(byReason.body.items[0].customReason, `penalty-list alpha ${suffix}`);
  });

  test('date range is inclusive on both ends', async () => {
    const { status, body } = await request(`${scoped}&dateFrom=2026-08-01&dateTo=2026-08-05`);
    assert.equal(status, 200);
    assert.equal(body.total, 2);
    assert.ok(body.items.every((item: { date: string }) => item.date >= '2026-08-01' && item.date <= '2026-08-05'));

    const openEnded = await request(`${scoped}&dateFrom=2026-08-01`);
    assert.equal(openEnded.body.total, 2);
  });

  test('filters by status', async () => {
    const { status, body } = await request(`${scoped}&status=CANCELED`);
    assert.equal(status, 200);
    assert.equal(body.total, 1);
    assert.equal(body.items[0].status, 'CANCELED');
  });

  test('rejects invalid queries with 400', async () => {
    assert.equal((await request('/penalties?limit=101')).status, 400);
    assert.equal((await request('/penalties?status=BOGUS')).status, 400);
    assert.equal((await request('/penalties?dateFrom=31-12-2026')).status, 400);
    assert.equal((await request('/penalties?dateFrom=2026-09-01&dateTo=2026-08-01')).status, 400);
  });
});

describe('GET /api/penalties/summary', () => {
  test('aggregates range, status, YTD and per-driver figures', async () => {
    const { status, body } = await request(`/penalties/summary?driverId=${driverA.id}&dateFrom=2026-08-01&dateTo=2026-08-05`);
    assert.equal(status, 200);

    assert.equal(body.totalCount, 2);
    assert.equal(body.totalAmount, 300_000);
    assert.equal(body.statusCounts.ACTIVE, 1);
    assert.equal(body.statusCounts.CANCELED, 1);
    assert.equal(body.statusAmounts.ACTIVE, 100_000);
    assert.equal(body.statusAmounts.CANCELED, 200_000);
    assert.equal(body.penalizedDriverCount, 1);

    const ytdSeed = seedPenalties.filter((p) => p.driver === 'A' && p.date >= yearStart);
    assert.equal(body.ytdCount, ytdSeed.length);
    assert.equal(body.ytdAmount, ytdSeed.reduce((acc, p) => acc + p.amount, 0));

    // driverId scopes the roster to the single seeded driver.
    assert.equal(body.drivers.length, 1);
    const driverARow = body.drivers[0];
    assert.equal(driverARow.driverId, driverA.id);
    assert.equal(driverARow.driverName, driverA.name);
    assert.equal(driverARow.count, 2);
    assert.equal(driverARow.totalAmount, 300_000);
    assert.equal(driverARow.ytdCount, 2);
    assert.equal(driverARow.ytdAmount, 300_000);
    assert.equal(driverARow.lastPenaltyDate, '2026-08-05');
    assert.equal(driverARow.streakDays, expectedStreakDays('2026-08-05', new Date()));
  });

  test('without dates covers the whole history and sorts by streak first', async () => {
    const { status, body } = await request(`/penalties/summary?driverId=${driverB.id}`);
    assert.equal(status, 200);
    // Whole history includes the 2025 row — no hidden date cap.
    assert.equal(body.totalCount, 3);
    assert.equal(body.totalAmount, 750_000);
    assert.equal(body.penalizedDriverCount, 1);
    assert.equal(body.drivers.length, 1);

    const driverBRow = body.drivers[0];
    assert.equal(driverBRow.driverId, driverB.id);
    assert.equal(driverBRow.lastPenaltyDate, '2026-07-15');
    assert.equal(driverBRow.streakDays, expectedStreakDays('2026-07-15', new Date()));
    // YTD only counts rows inside the current calendar year.
    const driverBYtdSeed = seedPenalties.filter((p) => p.driver === 'B' && p.date >= yearStart);
    assert.equal(driverBRow.ytdCount, driverBYtdSeed.length);
    assert.equal(driverBRow.ytdAmount, driverBYtdSeed.reduce((acc, p) => acc + p.amount, 0));
    assert.equal(body.ytdCount, driverBYtdSeed.length);
    assert.equal(body.ytdAmount, driverBYtdSeed.reduce((acc, p) => acc + p.amount, 0));
  });

  test('rejects invalid queries with 400', async () => {
    assert.equal((await request('/penalties/summary?driverId=abc')).status, 400);
    assert.equal((await request('/penalties/summary?dateFrom=2026-09-01&dateTo=2026-08-01')).status, 400);
    assert.equal((await request('/penalties/summary?dateFrom=not-a-date')).status, 400);
  });
});
