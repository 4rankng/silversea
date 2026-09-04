import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { inArray, isNull, eq, and } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import penaltiesRoutes from '../routes/financial/penalties.routes';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';

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

// ── Legacy client-side helpers, transplanted verbatim from
// frontend/src/features/penalties/utils.ts (computeStreak + getViolationGrade).
// The golden insights test proves the SQL-computed endpoint reproduces the
// client-side computation exactly on the same rows.
function legacyComputeStreak(driverId: number, penalties: { driverId: number; date: string }[], createdAt: string): number {
  const driverPenalties = penalties
    .filter((p) => p.driverId === driverId && p.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (driverPenalties.length === 0) {
    const hire = new Date(createdAt);
    const now = new Date();
    return Math.max(0, Math.floor((now.getTime() - hire.getTime()) / DAY_MS));
  }
  const lastViolation = new Date(driverPenalties[0].date);
  const now = new Date();
  return Math.max(0, Math.floor((now.getTime() - lastViolation.getTime()) / DAY_MS));
}

function legacyGetViolationGrade(violationCount: number): string {
  if (violationCount === 0) return 'A+';
  if (violationCount <= 2) return 'A';
  if (violationCount <= 5) return 'B';
  return 'C';
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
    assert.deepEqual(body.statusCounts, { all: 5, ACTIVE: 4, CANCELED: 1 });
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

  test('filters by status while chip counts stay full-set', async () => {
    const { status, body } = await request(`${scoped}&status=CANCELED`);
    assert.equal(status, 200);
    assert.equal(body.total, 1);
    assert.equal(body.items[0].status, 'CANCELED');
    // Chips render from statusCounts over the same where minus the status
    // filter — never page-derived, never status-filtered.
    assert.deepEqual(body.statusCounts, { all: 5, ACTIVE: 4, CANCELED: 1 });
  });

  test('rejects invalid queries with 400', async () => {
    assert.equal((await request('/penalties?limit=101')).status, 400);
    assert.equal((await request('/penalties?status=BOGUS')).status, 400);
    assert.equal((await request('/penalties?dateFrom=31-12-2026')).status, 400);
    assert.equal((await request('/penalties?dateFrom=2026-09-01&dateTo=2026-08-01')).status, 400);
    assert.equal((await request('/penalties?sortBy=nope')).status, 400);
    assert.equal((await request('/penalties?sortDir=up')).status, 400);
  });

  test('sorts by amount server-side in both directions', async () => {
    // The unique suffix only appears in the two seeded drivers' names, so the
    // search scope isolates exactly this suite's five rows.
    const scope = `search=${encodeURIComponent(suffix)}`;
    const asc = await request(`/penalties?${scope}&sortBy=amount&sortDir=asc&limit=100`);
    assert.equal(asc.status, 200);
    assert.equal(asc.body.total, 5);
    assert.deepEqual(
      asc.body.items.map((item: { amount: string }) => Number(item.amount)),
      [50_000, 100_000, 200_000, 300_000, 400_000],
    );

    const desc = await request(`/penalties?${scope}&sortBy=amount&sortDir=desc&limit=100`);
    assert.deepEqual(
      desc.body.items.map((item: { amount: string }) => Number(item.amount)),
      [400_000, 300_000, 200_000, 100_000, 50_000],
    );
  });

  test('sorts by driver name, clustering each driver\'s rows', async () => {
    const scope = `search=${encodeURIComponent(suffix)}`;
    const byDriver = await request(`/penalties?${scope}&sortBy=driverName&sortDir=asc&limit=100`);
    assert.equal(byDriver.status, 200);
    const driverSequence = byDriver.body.items.map((item: { driverId: number }) => item.driverId);
    // "list A …" sorts before "list B …", so A's two rows precede B's three.
    assert.deepEqual(driverSequence, [driverA.id, driverA.id, driverB.id, driverB.id, driverB.id]);
  });
});

describe('GET /api/penalties/insights', () => {
  test('golden parity: server KPIs equal the transplanted client-side computation', async () => {
    const { status, body } = await request('/penalties/insights?month=8&year=2026');
    assert.equal(status, 200);

    // Snapshot the exact inputs the frontend used to receive as props.
    const [allPenalties, allDrivers, allTrucks] = await Promise.all([
      db.select({ driverId: s.penalties.driverId, date: s.penalties.date, amount: s.penalties.amount })
        .from(s.penalties).where(isNull(s.penalties.deletedAt)),
      db.select({ id: s.drivers.id, name: s.drivers.name, createdAt: s.drivers.createdAt, assignedTruckId: s.truckDriverAssignments.truckId })
        .from(s.drivers)
        .leftJoin(s.truckDriverAssignments, and(
          eq(s.truckDriverAssignments.driverId, s.drivers.id),
          isNull(s.truckDriverAssignments.endsAt),
          eq(s.truckDriverAssignments.role, 'PRIMARY'),
        ))
        .where(and(isNull(s.drivers.deletedAt), eq(s.drivers.status, 'ACTIVE'))),
      db.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate }).from(s.trucks),
    ]);

    const period = await resolveSalaryPeriodDateRange(8, 2026);
    const prevPeriod = await resolveSalaryPeriodDateRange(7, 2026);
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;

    // ── PenaltyTable.tsx KPI block, transplanted ──────────────────────────
    const monthPenalties = allPenalties.filter((p) => p.date >= period.start && p.date <= period.end);
    const incidentCount = monthPenalties.length;
    const totalMonthAmount = monthPenalties.reduce((acc, p) => acc + parseFloat(p.amount), 0);
    const prevMonthCount = allPenalties.filter((p) => p.date >= prevPeriod.start && p.date <= prevPeriod.end).length;
    const comparisonLabel = prevMonthCount > 0
      ? `Giảm ${Math.round((1 - incidentCount / prevMonthCount) * 100)}% so với ${String(7).padStart(2, '0')}/${String(2026).slice(-2)}`
      : incidentCount === 0 ? 'Tháng an toàn' : '';
    const penalizedDriverIds = new Set(monthPenalties.map((p) => p.driverId));
    const safeDriverCount = allDrivers.filter((d) => !penalizedDriverIds.has(d.id)).length;
    const ytdPenalties = allPenalties.filter((p) => p.date >= yearStart);
    const ytdTotal = ytdPenalties.reduce((acc, p) => acc + parseFloat(p.amount), 0);
    const cutoff = (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - days);
      return d.toISOString().slice(0, 10);
    };
    const truckMap = new Map(allTrucks.map((t) => [t.id, t.licensePlate]));
    const violationsIn = (driverId: number, from: string) => allPenalties.filter((p) => p.driverId === driverId && p.date >= from).length;
    const expected = allDrivers.map((d) => {
      const violations90d = violationsIn(d.id, cutoff(90));
      return {
        driverId: d.id,
        name: d.name,
        streakDays: legacyComputeStreak(d.id, allPenalties, d.createdAt.toISOString()),
        violations7d: violationsIn(d.id, cutoff(7)),
        violations30d: violationsIn(d.id, cutoff(30)),
        violations90d,
        violationsYtd: ytdPenalties.filter((p) => p.driverId === d.id).length,
        fineYtd: ytdPenalties.filter((p) => p.driverId === d.id).reduce((acc, p) => acc + parseFloat(p.amount), 0),
        grade: legacyGetViolationGrade(violations90d),
        truckPlate: d.assignedTruckId ? truckMap.get(d.assignedTruckId) ?? null : null,
      };
    }).sort((a, b) => b.streakDays - a.streakDays || a.violations90d - b.violations90d || a.driverId - b.driverId);
    // ── end transplant ────────────────────────────────────────────────────

    assert.equal(body.month.incidentCount, incidentCount);
    assert.equal(body.month.totalAmount, totalMonthAmount);
    assert.equal(body.month.prevMonthCount, prevMonthCount);
    assert.equal(body.month.comparisonLabel, comparisonLabel);
    assert.equal(body.ytd.count, ytdPenalties.length);
    assert.equal(body.ytd.total, ytdTotal);
    assert.equal(body.safeDriverCount, safeDriverCount);
    assert.equal(body.driverTotal, allDrivers.length);
    assert.equal(body.longestStreak, expected.reduce((max, d) => Math.max(max, d.streakDays), 0));
    assert.equal(body.streakLeader, expected[0]?.name || '—');
    assert.equal(
      body.avgStreak,
      expected.length > 0 ? Math.round(expected.reduce((acc, d) => acc + d.streakDays, 0) / expected.length) : 0,
    );
    assert.equal(body.driversOver90, expected.filter((d) => d.streakDays >= 90).length);
    assert.equal(body.driversOver6m, expected.filter((d) => d.streakDays >= 180).length);

    assert.equal(body.scoreboard.length, expected.length);
    assert.deepEqual(body.scoreboard.map((r: { driverId: number }) => r.driverId), expected.map((d) => d.driverId));
    for (const row of expected) {
      const actual = body.scoreboard.find((r: { driverId: number }) => r.driverId === row.driverId);
      assert.ok(actual, `driver ${row.driverId} missing from scoreboard`);
      assert.deepEqual(actual, row);
    }

    // Seeded-driver sanity: the fresh seeds must actually exercise the paths.
    const driverARow = body.scoreboard.find((r: { driverId: number }) => r.driverId === driverA.id);
    const driverASeedYtd = seedPenalties.filter((p) => p.driver === 'A' && p.date >= yearStart);
    assert.equal(driverARow.violationsYtd, driverASeedYtd.length);
    assert.equal(driverARow.fineYtd, driverASeedYtd.reduce((acc, p) => acc + p.amount, 0));
  });

  test('defaults to the current period without params', async () => {
    const { status, body } = await request('/penalties/insights');
    assert.equal(status, 200);
    assert.equal(typeof body.month.incidentCount, 'number');
    assert.equal(typeof body.month.comparisonLabel, 'string');
    assert.ok(Array.isArray(body.scoreboard));
    assert.equal(body.driverTotal, body.scoreboard.length);
  });

  test('rejects invalid queries with 400', async () => {
    assert.equal((await request('/penalties/insights?month=13')).status, 400);
    assert.equal((await request('/penalties/insights?month=0')).status, 400);
    assert.equal((await request('/penalties/insights?year=1999')).status, 400);
    assert.equal((await request('/penalties/insights?bogus=1')).status, 400);
  });
});
