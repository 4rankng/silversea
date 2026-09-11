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
import { applyTripPatch, insertTripComposite } from '../services/trip-composite.service';
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
    const trip = await insertTripComposite(db, {
      tripCode: `Q15-PROFIT-${targetQuarter}-${index}-${suffix}`.slice(0, 50),
      customerId: createdCustomerIds[0]!,
      routeId: createdRouteIds[0]!,
      cargoTypeId: createdCargoTypeIds[0]!,
      truckId: truck.id,
      status: TripStatus.COMPLETED,
      departureDate: `${targetYear}-${month}-${day}`,
      completedAt: new Date(`${targetYear}-${month}-${day}T04:00:00.000Z`),
      carrierType: 'OWN',
      revenue: String(profits[index]! + 500000),
      totalCost: '500000',
      grossProfit: String(profits[index]!),
    });
    createdTripIds.push(trip.id);
    tripIds.push(trip.id);
  }

  return { truckId: truck.id, tripIds };
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
  const trip = await insertTripComposite(db, {
    tripCode: `Q15-PROFIT-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    truckId: truck.id,
    status: TripStatus.COMPLETED,
    departureDate: `${year}-01-10`,
    completedAt: new Date(`${year}-01-15T04:00:00.000Z`),
    carrierType: 'OWN',
    revenue: '1500000',
    totalCost: '500000',
    grossProfit: '1000000',
  });
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

  it('applies the request immediately and replays the exact command result (phê duyệt removed)', async () => {
    const key = `q15-profit-replay-${suffix}`;
    const first = await requestDistribution(quarter, year, 0, key);
    assert.equal(first.status, 201);
    assert.equal(first.body.actionKind, 'PROFIT_DISTRIBUTION');
    // 2026-09-10 (phê duyệt removed): the request applies at submit —
    // status APPROVED and the distribution rows exist immediately.
    assert.equal(first.body.status, 'APPROVED');
    assert.equal((await rowsFor(quarter, year)).length, 1);
    primaryAction = first.body;
    assert.ok(await waitForAuditEvent(
      actors[0]!.id,
      AuditEvent.PROFIT_DISTRIBUTED,
      Number(first.body.id),
    ));

    const replay = await requestDistribution(quarter, year, 0, key);
    // This endpoint pins responseStatusCode 201, so replays also return 201
    // with the identical body — the replay contract lives in the body.
    assert.equal(replay.status, first.status);
    assert.deepEqual(replay.body, first.body);
    assert.equal((await rowsFor(quarter, year)).length, 1);
  });



  it('applies atomically against the current trip snapshot (no request-to-approve window)', async () => {
    const staleQuarter = 4;
    const { tripIds } = await seedQuarterProfitSource(staleQuarter, year, [600000, 400000]);

    // 2026-09-10: request and apply are one transaction — the old
    // request-to-approve window (and the stale-source 409 it enabled) no
    // longer exists. The distribution applies against the live snapshot.
    const requested = await requestDistribution(staleQuarter, year);
    assert.equal(requested.status, 201);
    assert.equal(requested.body.status, 'APPROVED');
    assert.equal((await rowsFor(staleQuarter, year)).length, 1);

    await applyTripPatch(db, tripIds[0]!, {
      grossProfit: '550000',
      revenue: '1050000',
      version: 2,
      updatedAt: new Date(),
    });
    await applyTripPatch(db, tripIds[1]!, {
      grossProfit: '450000',
      revenue: '950000',
      version: 2,
      updatedAt: new Date(),
    });
    // The applied distribution is immutable history — rows stay at 1.
    assert.equal((await rowsFor(staleQuarter, year)).length, 1);
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
