import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role, TripStatus, TxnType } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { salaryPeriodsAdminRouter } from '../routes/config';
import {
  setAuditEnrichmentHandlerForTest,
  setAuditPersistHandlerForTest,
} from '../services/audit.service';
import { syncAttendanceAfterStatusChange } from '../services/trip-attendance-sync.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const periodYear = 7100 + (Number(suffix.split('-')[0]) % 500);
const PERIOD = `${periodYear}-07`;
const DISTINCT_TARGET_PERIOD = `${periodYear}-08`;
const TRIP_DAY = `${PERIOD}-12`;

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdTripIds: number[] = [];
const createdLedgerIds: number[] = [];
const createdActionIds: number[] = [];
const idempotencyKeys: string[] = [];
let idempotencyCounter = 0;

let server: http.Server;
let baseUrl = '';

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `q10-route-${role}-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return { id: user.id, role: user.role as Role };
}

async function mkDriver(tag: string) {
  const user = await mkUser(Role.DRIVER, tag);
  const [driver] = await db.insert(s.drivers).values({
    name: `Q10 route ${tag} ${suffix}`,
    userId: user.id,
    status: 'ACTIVE',
    baseSalary: '12000000',
  }).returning();
  createdDriverIds.push(driver.id);
  return driver;
}

async function mkCatalogs() {
  const [customer] = await db.select({ id: s.customers.id }).from(s.customers).limit(1);
  const [route] = await db.select({ id: s.routes.id }).from(s.routes).limit(1);
  const [cargoType] = await db.select({ id: s.cargoTypes.id }).from(s.cargoTypes).limit(1);
  return {
    customer: customer ?? (await db.insert(s.customers).values({ name: `Q10 catalog ${suffix}` }).returning())[0]!,
    route: route ?? (await db.insert(s.routes).values({ name: `Q10 route ${suffix}` }).returning())[0]!,
    cargoType: cargoType ?? (await db.insert(s.cargoTypes).values({ name: `Q10 cargo ${suffix}` }).returning())[0]!,
  };
}

async function mkPendingDriver(tag: string, actorId: number) {
  const driver = await mkDriver(tag);
  const catalogs = await mkCatalogs();
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q10R-${tag}-${suffix}`.slice(0, 50),
    customerId: catalogs.customer.id,
    routeId: catalogs.route.id,
    cargoTypeId: catalogs.cargoType.id,
    driverId: driver.id,
    status: TripStatus.COMPLETED,
    departureDate: TRIP_DAY,
    completedAt: new Date(`${TRIP_DAY}T09:00:00.000Z`),
    carrierType: 'OWN',
    driverSalary: '1800000',
    revenue: '0',
    totalRoadAllowance: '0',
  }).returning();
  createdTripIds.push(trip.id);

  const [ledger] = await db.insert(s.ledger).values({
    entityType: 'DRIVER',
    entityId: driver.id,
    txnType: TxnType.DRIVER_SALARY,
    txnId: trip.id,
    debit: '0',
    credit: '1800000',
    balance: '1800000',
    timestamp: new Date(),
    note: `q10 route ${tag}`,
  }).returning();
  createdLedgerIds.push(ledger.id);

  await syncAttendanceAfterStatusChange(
    trip.id,
    TripStatus.COMPLETED,
    driver.id,
    TRIP_DAY,
    null,
    actorId,
  );
  return driver;
}

async function postExclusion(
  period: string,
  body: Record<string, unknown>,
  actor: { id: number; role: Role },
  idempotencyKey = `q10-exclusion-${suffix}-${++idempotencyCounter}`,
) {
  if (!idempotencyKeys.includes(idempotencyKey)) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}/api/salary-periods/${period}/exclusions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Test-User-Id': String(actor.id),
      'X-Test-Role': actor.role,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  setAuditEnrichmentHandlerForTest(async () => undefined);
  const app = express();
  app.use(express.json());
  app.use('/api/salary-periods', (req, _res, next) => {
    req.user = {
      userId: Number(req.header('X-Test-User-Id')),
      username: `q10-route-${req.header('X-Test-User-Id')}`,
      email: null,
      fullName: null,
      role: String(req.header('X-Test-Role') ?? Role.ACCOUNTANT) as Role,
    };
    next();
  });
  app.use('/api/salary-periods', auditLogMiddleware);
  app.use('/api/salary-periods', salaryPeriodsAdminRouter);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  setAuditPersistHandlerForTest(null);
  setAuditEnrichmentHandlerForTest(null);
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (createdUserIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
  }
  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, idempotencyKeys));
  }
  if (createdActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdActionIds));
  }
  if (createdLedgerIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.id, createdLedgerIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.driverId, createdDriverIds));
    await db.delete(s.salaryConfirmations).where(inArray(s.salaryConfirmations.driverId, createdDriverIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await client.end();
});

describe('Q10 salary exclusion route validation', () => {
  test('rejects unknown handling mode and invalid supplementary targets at the HTTP boundary', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'acct');
    const admin = await mkUser(Role.ADMIN, 'admin');
    const pendingDriver = await mkPendingDriver('pending', admin.id);

    const missingHandling = await postExclusion(PERIOD, {
      driverId: pendingDriver.id,
      reason: 'Thiếu xác nhận lương',
      targetPeriod: DISTINCT_TARGET_PERIOD,
    }, accountant);
    assert.equal(missingHandling.status, 400);
    assert.match(String(missingHandling.body.error), /handlingMode/i);

    const missingTarget = await postExclusion(PERIOD, {
      driverId: pendingDriver.id,
      reason: 'Thiếu xác nhận lương',
      handlingMode: 'SUPPLEMENTARY_PERIOD',
    }, accountant);
    assert.equal(missingTarget.status, 400);
    assert.match(String(missingTarget.body.error), /kỳ bổ sung/i);

    const sameSourceTarget = await postExclusion(PERIOD, {
      driverId: pendingDriver.id,
      reason: 'Thiếu xác nhận lương',
      handlingMode: 'SUPPLEMENTARY_PERIOD',
      targetPeriod: PERIOD,
    }, accountant);
    assert.equal(sameSourceTarget.status, 400);
    assert.match(String(sameSourceTarget.body.error), /khác kỳ lương gốc/i);

    const adjustment = await postExclusion(PERIOD, {
      driverId: pendingDriver.id,
      reason: 'Điều chỉnh vào kỳ đang mở',
      handlingMode: 'ADJUSTMENT',
      targetPeriod: PERIOD,
      note: 'q10 adjustment route',
    }, accountant);
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.body));
    assert.equal(adjustment.body.handlingMode, 'ADJUSTMENT');
    assert.equal(adjustment.body.targetPeriod, null);
    createdActionIds.push(Number(adjustment.body.actionId));

    const [stored] = await db.select({
      afterSnapshot: s.governanceActions.afterSnapshot,
    }).from(s.governanceActions)
      .where(eq(s.governanceActions.id, Number(adjustment.body.actionId)))
      .limit(1);
    assert.equal(
      ((stored?.afterSnapshot as Record<string, unknown> | null)?.targetPeriod ?? null),
      null,
    );
  });

  test('commits effect, replay key, and material audit atomically and rolls all back on audit failure', async () => {
    const accountant = await mkUser(Role.ACCOUNTANT, 'atomic-acct');
    const admin = await mkUser(Role.ADMIN, 'atomic-admin');
    const pendingDriver = await mkPendingDriver('atomic-pending', admin.id);
    const key = `q10-exclusion-atomic-${suffix}`;
    const body = {
      driverId: pendingDriver.id,
      reason: `Q10 atomic exclusion ${suffix}`,
      handlingMode: 'ADJUSTMENT',
      note: 'atomic commit proof',
    };

    const first = await postExclusion(PERIOD, body, accountant, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    const actionId = Number(first.body.actionId);
    createdActionIds.push(actionId);

    const replay = await postExclusion(PERIOD, body, accountant, key);
    assert.equal(replay.status, 201, JSON.stringify(replay.body));
    assert.equal(replay.body.replayed, true);
    assert.equal(Number(replay.body.actionId), actionId);

    const [persistedKey] = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key))
      .limit(1);
    assert.equal(persistedKey?.entityId, actionId);
    const [persistedAction] = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, actionId))
      .limit(1);
    assert.equal(persistedAction?.reason, body.reason);
    const audits = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.userId, accountant.id));
    assert.equal(
      audits.some((row) =>
        (row.payload as Record<string, unknown> | null)?.materialWriteEndpoint
          === 'config.salary-periods.exclusion.create'),
      true,
    );

    const failingKey = `q10-exclusion-audit-fail-${suffix}`;
    const failingReason = `Q10 rolled back exclusion ${suffix}`;
    setAuditPersistHandlerForTest(async () => {
      throw new Error('simulated salary exclusion audit failure');
    });
    const failed = await postExclusion(PERIOD, {
      ...body,
      reason: failingReason,
    }, accountant, failingKey);
    setAuditPersistHandlerForTest(null);
    assert.equal(failed.status, 500, JSON.stringify(failed.body));

    const failedKeys = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, failingKey));
    assert.equal(failedKeys.length, 0);
    const failedActions = await db.select().from(s.governanceActions)
      .where(eq(s.governanceActions.reason, failingReason));
    assert.equal(failedActions.length, 0);
  });
});
