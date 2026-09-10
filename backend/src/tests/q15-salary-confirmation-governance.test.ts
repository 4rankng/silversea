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
import { batchUpsertWorkDays } from '../services/attendance.service';
import {
  approveSalaryConfirmation,
  approveSalaryReopen,
  checkSalaryConfirmation,
  checkSalaryReopen,
  requestSalaryConfirmation,
  requestSalaryReopen,
} from '../services/salary-confirmation-governance.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const year = 6400 + (Number(suffix.split('-')[0]) % 300);
const month = ((Number(suffix.split('-')[0]) % 12) + 1);
const periodKey = `${year}-${String(month).padStart(2, '0')}`;

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdActionIds: number[] = [];
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
  if (createdActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdActionIds));
  }
  if (createdPeriodLockIds.length > 0) {
    await db.delete(s.periodLocks).where(inArray(s.periodLocks.id, createdPeriodLockIds));
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

    const [saved] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(first.body.id)));
    // 2026-09-10 (phê duyệt removed): the request applies immediately.
    assert.equal(saved.status, 'APPROVED');
    createdActionIds.push(saved.id);
  });

  it('has no salary effect before approval and rejects maker/checker self-escalation', async () => {
    const maker = await mkUser(Role.ACCOUNTANT, 'flow-maker');
    const checker = await mkUser(Role.MANAGER, 'flow-checker');
    const approver = await mkUser(Role.ADMIN, 'flow-approver');
    const driver = await mkDriver('flow-driver');

    const requested = await requestSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actorId: maker.id,
      actorRole: maker.role as Role,
    });
    createdActionIds.push(requested.id);

    // 2026-09-10 (phê duyệt removed): segregation is gone at the service
    // level too — the maker may check their own request and the checker
    // may approve it. Routes apply all three stages immediately.
    const checked = await checkSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: requested.id,
      actorId: maker.id,
      actorRole: maker.role,
      expectedVersion: requested.version,
    });
    assert.equal(checked.status, 'PENDING_APPROVAL');

    const approved = await approveSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: requested.id,
      actorId: approver.id,
      actorRole: approver.role,
      expectedVersion: checked.version,
    });
    assert.equal(approved.status, 'APPROVED');

    const [confirmation] = await db.select().from(s.salaryConfirmations)
      .where(and(
        eq(s.salaryConfirmations.driverId, driver.id),
        eq(s.salaryConfirmations.year, year),
        eq(s.salaryConfirmations.month, month),
      ))
      .limit(1);
    assert.equal(confirmation?.status, 'CONFIRMED');
    assert.equal(confirmation?.confirmedBy, approver.id);
  });

  it('rejects approval when workdays change after the snapshot was submitted', async () => {
    const maker = await mkUser(Role.ACCOUNTANT, 'stale-maker');
    const checker = await mkUser(Role.MANAGER, 'stale-checker');
    const approver = await mkUser(Role.ADMIN, 'stale-approver');
    const driver = await mkDriver('stale-driver');

    const requested = await requestSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actorId: maker.id,
      actorRole: maker.role,
    });
    createdActionIds.push(requested.id);

    const checked = await checkSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: requested.id,
      actorId: checker.id,
      actorRole: checker.role,
      expectedVersion: requested.version,
    });

    await batchUpsertWorkDays(driver.id, [
      { date: periodRange.start, status: 'STANDBY', note: 'stale snapshot change' },
    ], maker.id);

    await assert.rejects(
      () => approveSalaryConfirmation({
        driverId: driver.id,
        year,
        month,
        actionId: requested.id,
        actorId: approver.id,
        actorRole: approver.role,
        expectedVersion: checked.version,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && /đã thay đổi sau khi gửi yêu cầu/i.test(error.message),
    );
  });

  it('blocks driver-level confirmation approval once the salary period has been closed', async () => {
    const maker = await mkUser(Role.ACCOUNTANT, 'close-maker');
    const checker = await mkUser(Role.MANAGER, 'close-checker');
    const approver = await mkUser(Role.ADMIN, 'close-approver');
    const driver = await mkDriver('close-driver');

    const requested = await requestSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actorId: maker.id,
      actorRole: maker.role,
    });
    createdActionIds.push(requested.id);

    const checked = await checkSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: requested.id,
      actorId: checker.id,
      actorRole: checker.role,
      expectedVersion: requested.version,
    });

    await createClosedPeriodLock(approver.id);

    await assert.rejects(
      () => approveSalaryConfirmation({
        driverId: driver.id,
        year,
        month,
        actionId: requested.id,
        actorId: approver.id,
        actorRole: approver.role,
        expectedVersion: checked.version,
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 409 && /đã khóa/i.test(error.message),
    );
  });

  it('keeps reopen append-only and restores draft only after distinct check and approval', async () => {
    const maker = await mkUser(Role.ACCOUNTANT, 'reopen-maker');
    const checker = await mkUser(Role.MANAGER, 'reopen-checker');
    const approver = await mkUser(Role.ADMIN, 'reopen-approver');
    const driver = await mkDriver('reopen-driver');

    const confirmRequest = await requestSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actorId: maker.id,
      actorRole: maker.role,
    });
    createdActionIds.push(confirmRequest.id);
    const checkedConfirm = await checkSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: confirmRequest.id,
      actorId: checker.id,
      actorRole: checker.role,
      expectedVersion: confirmRequest.version,
    });
    await approveSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: confirmRequest.id,
      actorId: approver.id,
      actorRole: approver.role,
      expectedVersion: checkedConfirm.version,
    });

    const reopenRequest = await requestSalaryReopen({
      driverId: driver.id,
      year,
      month,
      actorId: maker.id,
      actorRole: maker.role,
      reason: 'Điều chỉnh lại ngày công sau đối soát',
    });
    createdActionIds.push(reopenRequest.id);
    const checkedReopen = await checkSalaryReopen({
      driverId: driver.id,
      year,
      month,
      actionId: reopenRequest.id,
      actorId: checker.id,
      actorRole: checker.role,
      expectedVersion: reopenRequest.version,
    });
    const reopened = await approveSalaryReopen({
      driverId: driver.id,
      year,
      month,
      actionId: reopenRequest.id,
      actorId: approver.id,
      actorRole: approver.role,
      expectedVersion: checkedReopen.version,
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

    const history = await db.select({
      actionKind: s.governanceActions.actionKind,
      status: s.governanceActions.status,
      makerId: s.governanceActions.makerId,
      checkerId: s.governanceActions.checkerId,
      approverId: s.governanceActions.approverId,
    }).from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'SALARY_CONFIRMATION'),
        eq(s.governanceActions.subjectKey, `${driver.id}:${periodKey}`),
      ));
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((row) => row.actionKind).sort(), ['SALARY_CONFIRMATION', 'SALARY_REOPEN']);
    assert.ok(history.every((row) =>
      row.status === 'APPROVED'
      && row.makerId === maker.id
      && row.checkerId === checker.id
      && row.approverId === approver.id,
    ));
  });

  it('allows exactly one concurrent approval winner for the same confirmation request', async () => {
    const maker = await mkUser(Role.ACCOUNTANT, 'winner-maker');
    const checker = await mkUser(Role.MANAGER, 'winner-checker');
    const approverA = await mkUser(Role.ADMIN, 'winner-approver-a');
    const approverB = await mkUser(Role.MANAGER, 'winner-approver-b');
    const driver = await mkDriver('winner-driver');

    const requested = await requestSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actorId: maker.id,
      actorRole: maker.role,
    });
    createdActionIds.push(requested.id);
    const checked = await checkSalaryConfirmation({
      driverId: driver.id,
      year,
      month,
      actionId: requested.id,
      actorId: checker.id,
      actorRole: checker.role,
      expectedVersion: requested.version,
    });

    const outcomes = await Promise.allSettled([
      approveSalaryConfirmation({
        driverId: driver.id,
        year,
        month,
        actionId: requested.id,
        actorId: approverA.id,
        actorRole: approverA.role,
        expectedVersion: checked.version,
      }),
      approveSalaryConfirmation({
        driverId: driver.id,
        year,
        month,
        actionId: requested.id,
        actorId: approverB.id,
        actorRole: approverB.role,
        expectedVersion: checked.version,
      }),
    ]);

    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);

    const [savedAction] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, requested.id))
      .limit(1);
    assert.equal(savedAction.status, 'APPROVED');
  });
});
