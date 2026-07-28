import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import postgres from 'postgres';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import financialRoutes from '../routes/financial';
import { disconnectRedis } from '../lib/redis';
import { initAuditService } from '../services/audit.service';
import { AuditEvent } from '../services/audit-types';
import {
  PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS,
  requestProfitDistributionGovernance,
  runProfitDistributionWithSerializationRetry,
} from '../services/profit-distribution.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const year = 2200 + Math.floor(Math.random() * 500);
const quarter = 1;
const createdUserIds: number[] = [];
const createdActionIds: number[] = [];
const createdIdempotencyIds: number[] = [];
const createdDistributionIds: number[] = [];
const createdTripIds: number[] = [];
const createdTruckCapIds: number[] = [];
const createdTruckIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
let actors: Array<{ id: number; role: string }> = [];
let server: http.Server;
let baseUrl = '';
let primaryAction: Record<string, unknown>;

async function post(
  path: string,
  body: Record<string, unknown>,
  actorIndex: number,
  idempotencyKey: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Connection: 'close',
      'X-Test-Actor': String(actorIndex),
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function rowsFor(targetQuarter: number, targetYear: number) {
  return db.select().from(s.distributions).where(and(
    eq(s.distributions.quarter, targetQuarter),
    eq(s.distributions.year, targetYear),
  ));
}

async function waitForAuditEvent(userId: number, event: string, actionId?: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.userId, userId))
      .orderBy(desc(s.auditLogs.id));
    const match = rows.find((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.event === event && (actionId == null || row.entityId === actionId);
    });
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return undefined;
}

async function requestDistribution(
  targetQuarter: number,
  targetYear: number,
  actorIndex = 0,
  key = `q15-profit-request-${targetQuarter}-${targetYear}-${suffix}`,
) {
  const response = await post('/api/reports/distribute-profit', {
    quarter: targetQuarter,
    year: targetYear,
    reason: `Phân phối lợi nhuận Q${targetQuarter}/${targetYear}`,
  }, actorIndex, key);
  if (typeof response.body.id === 'number') createdActionIds.push(response.body.id);
  return response;
}

async function seedQuarterProfitSource(targetQuarter: number, targetYear: number, profits: number[]) {
  const monthByQuarter: Record<number, string> = {
    1: '01',
    2: '04',
    3: '07',
    4: '10',
  };
  const month = monthByQuarter[targetQuarter];
  assert.ok(month);

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q15-${targetQuarter}-${suffix}`.slice(0, 20),
    status: 'ACTIVE',
  }).returning({ id: s.trucks.id });
  createdTruckIds.push(truck.id);

  const [cap] = await db.insert(s.truckCapTable).values({
    truckId: truck.id,
    partnerName: `Q15 owner ${targetQuarter} ${suffix}`.slice(0, 255),
    percentage: '100.00',
    role: 'INVESTOR',
    effectiveDate: `${targetYear}-${month}-01`,
  }).returning({ id: s.truckCapTable.id });
  createdTruckCapIds.push(cap.id);

  const tripIds: number[] = [];
  for (let index = 0; index < profits.length; index += 1) {
    const day = String(10 + index).padStart(2, '0');
    const [trip] = await db.insert(s.trips).values({
      tripCode: `Q15-PROFIT-${targetQuarter}-${index}-${suffix}`.slice(0, 50),
      customerId: createdCustomerIds[0]!,
      routeId: createdRouteIds[0]!,
      cargoTypeId: createdCargoTypeIds[0]!,
      truckId: truck.id,
      status: TripStatus.LOCKED,
      departureDate: `${targetYear}-${month}-${day}`,
      completedAt: new Date(`${targetYear}-${month}-${day}T04:00:00.000Z`),
      carrierType: 'OWN',
      revenue: String(profits[index]! + 500000),
      totalCost: '500000',
      grossProfit: String(profits[index]!),
    }).returning({ id: s.trips.id });
    createdTripIds.push(trip.id);
    tripIds.push(trip.id);
  }

  return { truckId: truck.id, tripIds };
}

async function checkAction(action: Record<string, unknown>, actorIndex = 1) {
  return post(
    `/api/governance-actions/${action.id}/check`,
    { expectedVersion: action.version },
    actorIndex,
    `q15-profit-check-${action.id}-${actorIndex}-${suffix}`,
  );
}

before(async () => {
  initAuditService();
  actors = await db.insert(s.users).values([
    { username: `q15-profit-maker-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
    { username: `q15-profit-checker-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT },
    { username: `q15-profit-approver-${suffix}`, passwordHash: 'x', role: Role.ADMIN },
    { username: `q15-profit-viewer-${suffix}`, passwordHash: 'x', role: Role.DRIVER },
    { username: `q15-profit-racer-${suffix}`, passwordHash: 'x', role: Role.MANAGER },
  ]).returning({ id: s.users.id, role: s.users.role });
  createdUserIds.push(...actors.map(actor => actor.id));

  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `Q15-${suffix}`.slice(0, 20),
    status: 'ACTIVE',
  }).returning({ id: s.trucks.id });
  createdTruckIds.push(truck.id);
  const [cap] = await db.insert(s.truckCapTable).values({
    truckId: truck.id,
    partnerName: `Q15 owner ${suffix}`,
    percentage: '100.00',
    role: 'INVESTOR',
    effectiveDate: `${year}-01-01`,
  }).returning({ id: s.truckCapTable.id });
  createdTruckCapIds.push(cap.id);
  const [customer] = await db.insert(s.customers).values({
    name: `Q15 profit customer ${suffix}`,
  }).returning({ id: s.customers.id });
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `Q15 profit route ${suffix}`,
  }).returning({ id: s.routes.id });
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 profit cargo ${suffix}`,
  }).returning({ id: s.cargoTypes.id });
  createdCargoTypeIds.push(cargoType.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q15-PROFIT-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    truckId: truck.id,
    status: TripStatus.LOCKED,
    departureDate: `${year}-01-10`,
    completedAt: new Date(`${year}-01-15T04:00:00.000Z`),
    carrierType: 'OWN',
    revenue: '1500000',
    totalCost: '500000',
    grossProfit: '1000000',
  }).returning({ id: s.trips.id });
  createdTripIds.push(trip.id);

  const app = express();
  app.use(express.json());
  app.use('/api', (req, _res, next) => {
    const actor = actors[Number(req.header('X-Test-Actor') ?? 0)] ?? actors[0]!;
    req.user = {
      userId: actor.id,
      username: `q15-profit-actor-${actor.id}`,
      email: null,
      fullName: null,
      role: actor.role as Role,
    };
    next();
  });
  app.use(auditLogMiddleware);
  app.use('/api', financialRoutes);
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
  const keys = await db.select({ id: s.idempotencyKeys.id }).from(s.idempotencyKeys)
    .where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
  createdIdempotencyIds.push(...keys.map(row => row.id));
  if (createdIdempotencyIds.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.id, createdIdempotencyIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
  }
  const distributions = await db.select({ id: s.distributions.id }).from(s.distributions)
    .where(and(eq(s.distributions.year, year), eq(s.distributions.quarter, quarter)));
  createdDistributionIds.push(...distributions.map(row => row.id));
  if (createdDistributionIds.length > 0) {
    await db.delete(s.distributions).where(inArray(s.distributions.id, createdDistributionIds));
  }
  if (createdActionIds.length > 0) {
    await db.delete(s.governanceActions).where(inArray(s.governanceActions.id, createdActionIds));
  }
  if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  if (createdTruckCapIds.length > 0) {
    await db.delete(s.truckCapTable).where(inArray(s.truckCapTable.id, createdTruckCapIds));
  }
  if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  await disconnectRedis();
  await client.end();
});

describe('Q15 profit-distribution governance', () => {
  it('does not expose PostgreSQL serialization details after retry exhaustion', async () => {
    const databaseError = Object.assign(new Error('could not serialize access due to read/write dependencies'), {
      code: '40001',
    });
    await assert.rejects(
      () => runProfitDistributionWithSerializationRetry(async () => {
        throw databaseError;
      }),
      (error: unknown) => {
        const apiError = error as { statusCode?: number; message?: string; details?: unknown };
        assert.equal(apiError.statusCode, 409);
        assert.match(apiError.message ?? '', /Dữ liệu lợi nhuận/);
        assert.equal(apiError.details, undefined);
        return true;
      },
    );
  });

  it('keeps the public request pending and replays the exact command result', async () => {
    const key = `q15-profit-replay-${suffix}`;
    const first = await requestDistribution(quarter, year, 0, key);
    assert.equal(first.status, 201);
    assert.equal(first.body.actionKind, 'PROFIT_DISTRIBUTION');
    assert.equal(first.body.status, 'PENDING_CHECK');
    assert.equal((await rowsFor(quarter, year)).length, 0);
    primaryAction = first.body;
    assert.ok(await waitForAuditEvent(
      actors[0]!.id,
      AuditEvent.PROFIT_DISTRIBUTION_REQUESTED,
      Number(first.body.id),
    ));
    assert.equal(
      await waitForAuditEvent(actors[0]!.id, AuditEvent.PROFIT_DISTRIBUTED),
      undefined,
    );

    const replay = await requestDistribution(quarter, year, 0, key);
    assert.equal(replay.status, first.status);
    assert.deepEqual(replay.body, first.body);
    assert.equal((await rowsFor(quarter, year)).length, 0);
  });

  it('enforces viewer, maker, checker, and distinct approver roles before one effect', async () => {
    const action = primaryAction;

    const viewerRequest = await requestDistribution(quarter + 1, year, 3);
    assert.equal(viewerRequest.status, 403);
    const makerCheck = await checkAction(action, 0);
    assert.equal(makerCheck.status, 403);
    const viewerCheck = await checkAction(action, 3);
    assert.equal(viewerCheck.status, 403);

    const checked = await checkAction(action, 1);
    assert.equal(checked.status, 200);
    assert.equal(checked.body.status, 'PENDING_APPROVAL');
    assert.equal((await rowsFor(quarter, year)).length, 0);

    const checkerApprove = await post(
      `/api/governance-actions/${action.id}/approve`,
      { expectedVersion: checked.body.version },
      1,
      `q15-profit-checker-approve-${suffix}`,
    );
    assert.equal(checkerApprove.status, 403);

    const outcomes = await Promise.all([
      post(
        `/api/governance-actions/${action.id}/approve`,
        { expectedVersion: checked.body.version },
        2,
        `q15-profit-approve-a-${suffix}`,
      ),
      post(
        `/api/governance-actions/${action.id}/approve`,
        { expectedVersion: checked.body.version },
        4,
        `q15-profit-approve-b-${suffix}`,
      ),
    ]);
    assert.equal(outcomes.filter(result => result.status === 200).length, 1);
    assert.equal(outcomes.filter(result => result.status === 409).length, 1);
    assert.equal((await rowsFor(quarter, year)).length, 1);
    const winningActor = outcomes[0]!.status === 200 ? actors[2]! : actors[4]!;
    const distributionAudit = await waitForAuditEvent(
      winningActor.id,
      AuditEvent.PROFIT_DISTRIBUTED,
    );
    assert.ok(distributionAudit);
    assert.match(distributionAudit.message, new RegExp(`Quý ${quarter}/${year}`));

    const stale = await post(
      `/api/governance-actions/${action.id}/approve`,
      { expectedVersion: checked.body.version },
      2,
      `q15-profit-stale-${suffix}`,
    );
    assert.equal(stale.status, 409);
    assert.equal((await rowsFor(quarter, year)).length, 1);
  });

  it('leaves profit unchanged when a request is rejected or returned', async () => {
    const rejected = (await requestDistribution(2, year)).body;
    const rejectResponse = await post(
      `/api/governance-actions/${rejected.id}/reject`,
      { expectedVersion: rejected.version, reason: 'Không đủ căn cứ' },
      1,
      `q15-profit-reject-${suffix}`,
    );
    assert.equal(rejectResponse.status, 200);
    assert.equal(rejectResponse.body.status, 'REJECTED');
    assert.equal((await rowsFor(2, year)).length, 0);

    const returned = (await requestDistribution(3, year)).body;
    const returnResponse = await post(
      `/api/governance-actions/${returned.id}/return-for-evidence`,
      { expectedVersion: returned.version, reason: 'Bổ sung biên bản' },
      1,
      `q15-profit-return-${suffix}`,
    );
    assert.equal(returnResponse.status, 200);
    assert.equal(returnResponse.body.status, 'RETURNED_FOR_EVIDENCE');
    assert.equal((await rowsFor(3, year)).length, 0);
  });

  it('rejects approval when the underlying trip snapshot changes even if the computed plan is unchanged', async () => {
    const staleQuarter = 4;
    const { tripIds } = await seedQuarterProfitSource(staleQuarter, year, [600000, 400000]);
    const requested = await requestDistribution(staleQuarter, year);
    assert.equal(requested.status, 201);
    const checked = await checkAction(requested.body, 1);
    assert.equal(checked.status, 200);

    await db.update(s.trips)
      .set({
        grossProfit: '550000',
        revenue: '1050000',
        version: 2,
        updatedAt: new Date(),
      })
      .where(eq(s.trips.id, tripIds[0]!));
    await db.update(s.trips)
      .set({
        grossProfit: '450000',
        revenue: '950000',
        version: 2,
        updatedAt: new Date(),
      })
      .where(eq(s.trips.id, tripIds[1]!));

    const staleApproval = await post(
      `/api/governance-actions/${requested.body.id}/approve`,
      { expectedVersion: checked.body.version },
      2,
      `q15-profit-stale-source-${suffix}`,
    );
    assert.equal(staleApproval.status, 409);
    assert.match(String(staleApproval.body.error ?? ''), /đã thay đổi/i);
    assert.equal((await rowsFor(staleQuarter, year)).length, 0);
  });

  it('does not block unrelated-quarter trip writes while a profit request transaction stays open', async () => {
    const isolatedYear = year + 1;
    const requestQuarter = 1;
    const unrelatedQuarter = 2;
    const { tripIds } = await seedQuarterProfitSource(unrelatedQuarter, isolatedYear, [250000]);
    const updater = postgres(config.databaseUrl);

    try {
      await db.transaction(async (tx) => {
        const action = await requestProfitDistributionGovernance({
          quarter: requestQuarter,
          year: isolatedYear,
          reason: `Phân phối lợi nhuận Q${requestQuarter}/${isolatedYear}`,
          makerId: actors[0]!.id,
          makerRole: actors[0]!.role,
          transaction: tx,
        });
        createdActionIds.push(action.id);

        const unrelatedWrite = updater.begin(async (sqlClient) => {
          await sqlClient`set local lock_timeout = '200ms'`;
          await sqlClient`
            update trips
            set notes = ${`q15-unrelated-write-${suffix}`}
            where id = ${tripIds[0]!}
          `;
        });

        await tx.execute(sql`select pg_sleep(0.3)`);
        await unrelatedWrite;
      }, PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS);
    } finally {
      await updater.end();
    }

    const [updatedTrip] = await db.select({ notes: s.trips.notes })
      .from(s.trips)
      .where(eq(s.trips.id, tripIds[0]!))
      .limit(1);
    assert.equal(updatedTrip?.notes, `q15-unrelated-write-${suffix}`);
  });

  it('does not expose a direct distribution writer', async () => {
    const module = await import('../services/profit-distribution.service');
    assert.equal('distributeProfit' in module, false);
    assert.equal(typeof module.applyProfitDistributionGovernanceAction, 'function');
  });
});
