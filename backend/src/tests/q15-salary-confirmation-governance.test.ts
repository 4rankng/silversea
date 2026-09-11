import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import salaryRoutes from '../routes/salary';
import {
  requestSalaryConfirmation,
  requestSalaryReopen,
  applySalaryConfirmationAction,
  applySalaryReopenAction,
} from '../services/salary-confirmation-governance.service';
import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const year = 6400 + (Number(suffix.split('-')[0]) % 300);
const month = ((Number(suffix.split('-')[0]) % 12) + 1);
const periodKey = `${year}-${String(month).padStart(2, '0')}`;

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdPeriodLockIds: number[] = [];
let periodRange: Awaited<ReturnType<typeof resolveSalaryPeriodDateRange>>;
let server: http.Server;
let baseUrl = '';

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `q15-salary-${role}-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return {
    id: user.id,
    role: user.role as Role,
  };
}

async function mkDriver(tag: string) {
  const user = await mkUser(Role.DRIVER, tag);
  const [driver] = await db.insert(s.drivers).values({
    name: `Q15 salary ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function createClosedPeriodLock(actorId: number) {
  const [lock] = await db.insert(s.periodLocks).values({
    domain: 'SALARY',
    scopeType: 'GLOBAL',
    scopeId: 0,
    cycle: 'MONTHLY',
    periodKey,
    periodStart: periodRange.start,
    periodEnd: periodRange.end,
    status: 'CLOSED',
    closedBy: actorId,
    note: `Q15 salary close race ${suffix}`,
  }).returning();
  createdPeriodLockIds.push(lock.id);
  return lock;
}

async function postSalary(
  path: string,
  body: Record<string, unknown>,
  actor: { id: number; role: Role },
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Test-User-Id': String(actor.id),
    'X-Test-Role': actor.role,
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const response = await fetch(`${baseUrl}/api/salary${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  periodRange = await resolveSalaryPeriodDateRange(month, year);

  const app = express();
  app.use(express.json());
  app.use('/api/salary', (req, _res, next) => {
    const userId = Number(req.header('X-Test-User-Id'));
    const role = String(req.header('X-Test-Role') ?? Role.ACCOUNTANT) as Role;
    req.user = {
      userId,
      username: `q15-salary-${userId}`,
      email: null,
      fullName: null,
      role,
    };
    next();
  });
  app.use('/api/salary', salaryRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (createdPeriodLockIds.length === 0) {
    return;
  }
  await db.delete(s.periodLocks).where(inArray(s.periodLocks.id, createdPeriodLockIds));
  createdPeriodLockIds.length = 0;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (createdUserIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, createdDriverIds));
    await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, createdDriverIds));
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('Q15 salary confirmation governance', () => {
  it('replays the same keyed confirm request exactly once at the HTTP boundary', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'replay-acct');
    const driver = await mkDriver('replay-driver');
    const path = `/${driver.id}/${year}/${month}/confirm`;
    const key = `q15-salary-confirm-replay-${driver.id}`;

    const first = await postSalary(path, {}, accountant, key);
    const replay = await postSalary(path, {}, accountant, key);

    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(first.body.replayed, false);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body, { ...first.body, replayed: true });

    // Direct apply: the confirm effect lands on the salary confirmation row.
    const [confirmation] = await db.select().from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driver.id),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      ))
      .limit(1);
    assert.equal(confirmation?.status, 'CONFIRMED');
    assert.equal((first.body as { status?: string }).status, 'APPROVED');
  });

  it('applies the confirmation in-request and stamps the requesting actor', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'direct-maker');
    const driver = await mkDriver('direct-driver');

    const applied = await autoApplyGovernanceAction({
      make: (tx) => requestSalaryConfirmation({
        driverId: driver.id,
        year,
        month,
        actorId: accountant.id,
        actorRole: accountant.role,
        transaction: tx,
      }),
      apply: applySalaryConfirmationAction,
      actorId: accountant.id,
      actorRole: accountant.role,
    });

    assert.equal(applied.status, 'APPROVED');
    assert.equal(applied.makerId, accountant.id);
    assert.equal(applied.approverId, accountant.id);

    const [confirmation] = await db.select().from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driver.id),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      ))
      .limit(1);
    assert.equal(confirmation?.status, 'CONFIRMED');
    assert.equal(confirmation?.confirmedBy, accountant.id);
  });

  it('rejects the confirm request outright once the salary period is locked', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'close-maker');
    const driver = await mkDriver('close-driver');

    await createClosedPeriodLock(accountant.id);

    await assert.rejects(
      () => autoApplyGovernanceAction({
        make: (tx) => requestSalaryConfirmation({
          driverId: driver.id,
          year,
          month,
          actorId: accountant.id,
          actorRole: accountant.role,
          transaction: tx,
        }),
        apply: applySalaryConfirmationAction,
        actorId: accountant.id,
        actorRole: accountant.role,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && /đã khóa/i.test(error.message),
    );
  });

  it('keeps salary reopen append-only and restores the draft in-request', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'reopen-acct');
    const driver = await mkDriver('reopen-driver');

    await autoApplyGovernanceAction({
      make: (tx) => requestSalaryConfirmation({
        driverId: driver.id,
        year,
        month,
        actorId: accountant.id,
        actorRole: accountant.role,
        transaction: tx,
      }),
      apply: applySalaryConfirmationAction,
      actorId: accountant.id,
      actorRole: accountant.role,
    });

    const reopened = await autoApplyGovernanceAction({
      make: (tx) => requestSalaryReopen({
        driverId: driver.id,
        year,
        month,
        actorId: accountant.id,
        actorRole: accountant.role,
        reason: 'Điều chỉnh lại ngày công sau đối soát',
        transaction: tx,
      }),
      apply: applySalaryReopenAction,
      actorId: accountant.id,
      actorRole: accountant.role,
    });
    assert.equal(reopened.status, 'APPROVED');

    const [confirmation] = await db.select().from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driver.id),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      ))
      .limit(1);
    assert.equal(confirmation?.status, 'DRAFT');
    assert.equal(confirmation?.confirmedBy, null);
  });
});
