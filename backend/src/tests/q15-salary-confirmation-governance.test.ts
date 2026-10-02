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
import { insertTripComposite } from '../services/trip-composite.service';

const fixtureTripIds: number[] = [];
const fixtureRouteIds: number[] = [];
const fixtureCargoTypeIds: number[] = [];
const fixtureCustomerIds: number[] = [];
import {
  requestSalaryConfirmation,
  requestSalaryReopen,
  applySalaryConfirmationAction,
  applySalaryReopenAction,
} from '../services/salary-confirmation-governance.service';
import { autoApplyGovernanceAction } from '../services/adjustment-governance.service';
import { confirmSalary, computeSalary, syncTripWorkDays, unconfirmSalary } from '../services/attendance.service';
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
  if (fixtureTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, fixtureTripIds));
  }
  if (fixtureCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, fixtureCargoTypeIds));
  }
  if (fixtureRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, fixtureRouteIds));
  }
  if (fixtureCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, fixtureCustomerIds));
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


describe('confirmed individual salary snapshots', () => {
  it('keeps the confirmed payslip fixed after a later driver rate and locked-period attendance update', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'snapshot');
    const driver = await mkDriver('snapshot');
    const before = (await confirmSalary(driver.id, year, month, accountant.id)).salary;
    await createClosedPeriodLock(accountant.id);
    await db.update(s.drivers).set({ baseSalary: '19000000' }).where(eq(s.drivers.id, driver.id));
    // Real trip — driver_work_days.trip_id is FK-backed; sentinel ids only
    // ever resolved on the accumulated shared dev database (card _40).
    const [snapCustomer] = await db.insert(s.customers).values({ name: `Q15 snap customer ${suffix}` }).returning();
    fixtureCustomerIds.push(snapCustomer.id);
    const [snapRoute] = await db.insert(s.routes).values({ name: `Q15 snap route ${suffix}` }).returning();
    fixtureRouteIds.push(snapRoute.id);
    const [snapCargo] = await db.insert(s.cargoTypes).values({ name: `Q15 snap cargo ${suffix}` }).returning();
    fixtureCargoTypeIds.push(snapCargo.id);
    const snapTrip = await insertTripComposite(db, {
      tripCode: `Q15-SNAP-${suffix}`.slice(0, 50),
      customerId: snapCustomer.id,
      routeId: snapRoute.id,
      cargoTypeId: snapCargo.id,
      status: 'COMPLETED',
      departureDate: periodRange.start,
      carrierType: 'OWN',
    });
    fixtureTripIds.push(snapTrip.id);
    await syncTripWorkDays(driver.id, snapTrip.id, periodRange.start, periodRange.start, accountant.id);
    const operationalDay = await db.select().from(s.driverWorkDays).where(eq(s.driverWorkDays.driverId, driver.id));
    assert.equal(operationalDay[0]?.status, 'TRIP_DAY', 'late driver completion may still record the operational fact');
    const after = await computeSalary(driver.id, year, month);
    assert.equal(after.salarySnapshotState, 'CONFIRMED');
    assert.equal(after.salaryReconciliationRequired, true);
    assert.equal(after.netSalary, before.netSalary);
    assert.equal(after.baseSalary, before.baseSalary);
    assert.deepEqual(after.workDays, before.workDays);
    assert.equal(after.tripDays, before.tripDays);
  });

  it('marks unsnapshotted historical confirmations as reference data and snapshots again only after an explicit reopen', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'legacy-snapshot');
    const driver = await mkDriver('legacy-snapshot');
    await db.insert(s.salaryConfirmations).values({ driverId: driver.id, year, month, status: 'CONFIRMED', confirmedBy: accountant.id });
    const legacy = await computeSalary(driver.id, year, month);
    assert.equal(legacy.salarySnapshotState, 'UNAVAILABLE');
    assert.equal(legacy.salaryReconciliationRequired, true);
    await unconfirmSalary(driver.id, year, month);
    await db.update(s.drivers).set({ baseSalary: '17000000' }).where(eq(s.drivers.id, driver.id));
    const reopened = await computeSalary(driver.id, year, month);
    assert.equal(reopened.salarySnapshotState, 'LIVE');
    assert.equal(reopened.baseSalary, 17000000);
    const captured = (await confirmSalary(driver.id, year, month, accountant.id)).salary;
    assert.equal(captured.salarySnapshotState, 'CONFIRMED');
    assert.equal(captured.salaryReconciliationRequired, false);
    assert.equal(captured.baseSalary, 17000000);
  });
});
