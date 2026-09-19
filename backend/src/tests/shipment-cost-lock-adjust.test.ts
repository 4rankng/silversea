import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';

// Card 20260918_19 RED-FIRST suite (spec: docs/card-19-lock-and-adjust-design.md).
// The lock/adjust/cost-adjustments endpoints DO NOT EXIST yet — every test
// below hits the real shipments router and fails today with a 404 where the
// spec requires a specific status + message. FullStack implements the routes
// to green WITHOUT editing this file: every assertion pins a status code or
// a distinctive message substring from the spec.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdShipmentIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTripIds: number[] = [];
const createdCarrierInfoIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let accountantId = 0;
let cusId = 0;
let dispatcherId = 0;
let driverId = 0;
let server: http.Server;
let baseUrl = '';
const idemKeys: string[] = [];

interface ApiResult { status: number; body: Record<string, unknown>; }

async function api(
  method: string,
  path: string,
  actorId: number,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<ApiResult> {
  const key = idempotencyKey ?? `c19-${suffix}-${method}-${Math.random()}`;
  idemKeys.push(key);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      'X-Test-User-Id': String(actorId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 160) };
  }
  return { status: response.status, body: parsed };
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `c19-${role.toLowerCase()}-${suffix}-${userIds.length}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  userIds.push(user.id);
  return user.id;
}

async function mkShipment() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `C19 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `C19 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
  }).returning({ id: s.shipments.id, version: s.shipments.version });
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function costLockRow(shipmentId: number) {
  try {
    const [row] = await db.select().from(s.shipmentCostLocks)
      .where(eq(s.shipmentCostLocks.shipmentId, shipmentId)).limit(1);
    return row ?? null;
  } catch {
    return null; // table not created yet — the red phase
  }
}

async function adjustmentRows(shipmentId: number) {
  try {
    return await db.select().from(s.shipmentCostAdjustments)
      .where(eq(s.shipmentCostAdjustments.shipmentId, shipmentId));
  } catch {
    return []; // table not created yet — the red phase
  }
}

before(async () => {
  await initEnforcer();
  adminId = await mkUser(Role.ADMIN);
  accountantId = await mkUser(Role.ACCOUNTANT);
  cusId = await mkUser(Role.CUS);
  dispatcherId = await mkUser(Role.DISPATCHER);
  driverId = await mkUser(Role.DRIVER);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test',
      role: ([
        [adminId, Role.ADMIN], [accountantId, Role.ACCOUNTANT], [cusId, Role.CUS],
        [dispatcherId, Role.DISPATCHER], [driverId, Role.DRIVER],
      ] as Array<[number, Role]>).find(([id]) => id === Number(header))![1],
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    for (const shipmentId of createdShipmentIds) {
      await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.shipmentId, shipmentId));
      await db.delete(s.shipmentCostAdjustments).where(eq(s.shipmentCostAdjustments.shipmentId, shipmentId));
      await db.delete(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.shipmentId, shipmentId));
    }
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    createdTripIds.length = 0;
    createdCarrierInfoIds.length = 0;
    for (const shipmentId of createdShipmentIds) {
      await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
    }
    for (const routeId of createdRouteIds) {
      await db.delete(s.routes).where(eq(s.routes.id, routeId));
    }
    for (const customerId of createdCustomerIds) {
      await db.delete(s.customers).where(eq(s.customers.id, customerId));
    }
    if (userIds.length > 0) {
      await db.delete(s.notifications).where(inArray(s.notifications.userId, userIds));
      await db.delete(s.users).where(inArray(s.users.id, userIds));
    }
  } catch {
    // red-phase: adjustment/lock tables may not exist yet — nothing to clean
  }
  // The postgres client is SHARED across the in-process tsx run — never end
  // it here (the 20260917_17 wedge). Process teardown reclaims the sockets.
  await disconnectRedis();
});

describe('20260918_19 POST /shipments/:id/lock (red-first)', () => {
  test('404 unknown shipment carries the dedicated not-found message', async () => {
    const result = await api('POST', '/api/shipments/999999999/lock', accountantId, {});
    assert.equal(result.status, 404);
    assert.match(String(result.body.error), /không tồn tại|Không tìm thấy/i);
  });

  test('CUS lock succeeds, freezes the snapshot, stamps actor and version', async () => {
    const shipment = await mkShipment();
    const result = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const row = await costLockRow(shipment.id);
    assert.ok(row, 'an active cost lock row must exist');
    assert.equal(row.lockedBy, cusId);
    assert.equal(row.shipmentVersionAtLock, shipment.version);
    assert.ok(row.costSnapshot && typeof row.costSnapshot === 'object');
  });

  test('second lock on the same shipment → 409 with the dedicated locked message', async () => {
    const shipment = await mkShipment();
    const first = await api('POST', `/api/shipments/${shipment.id}/lock`, accountantId, {});
    assert.equal(first.status, 201, 'precondition: first lock succeeds');
    const second = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
    assert.equal(second.status, 409);
    assert.match(String(second.body.error), /đã khóa/i);
  });

  test('stale expectedShipmentVersion → 409 concurrent-update', async () => {
    const shipment = await mkShipment();
    const result = await api('POST', `/api/shipments/${shipment.id}/lock`, accountantId, {
      expectedShipmentVersion: shipment.version + 5,
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /đồng thời|tải lại/i);
  });

  test('Idempotency-Key replay returns the original lock, one row', async () => {
    const shipment = await mkShipment();
    const key = `c19-replay-${suffix}-${shipment.id}`;
    const first = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {}, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {}, key);
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.id, first.body.id, 'replay must return the original lock');
    const rows = await costLockRow(shipment.id);
    assert.ok(rows);
  });

  test('role gates: CUS/ACCOUNTANT/ADMIN allowed — DRIVER/DISPATCHER 403', async () => {
    const allowed = await api('POST', `/api/shipments/${(await mkShipment()).id}/lock`, driverId, {});
    assert.equal(allowed.status, 403, JSON.stringify(allowed.body));
    const allowedDispatcher = await api('POST', `/api/shipments/${(await mkShipment()).id}/lock`, dispatcherId, {});
    assert.equal(allowedDispatcher.status, 403, JSON.stringify(allowedDispatcher.body));
    for (const actor of [cusId, accountantId, adminId]) {
      const result = await api('POST', `/api/shipments/${(await mkShipment()).id}/lock`, actor, {});
      assert.notEqual(result.status, 403, `role of actor ${actor} must be allowed`);
    }
  });
});

describe('20260918_19 cost adjustments (red-first)', () => {
  test('adjust without an active cost lock → dedicated not-locked error', async () => {
    const shipment = await mkShipment();
    const result = await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: 'Điều chỉnh sau khóa',
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /chưa khóa|chưa được khóa/i);
  });

  test('adjust requires a non-blank reason', async () => {
    const shipment = await mkShipment();
    await api('POST', `/api/shipments/${shipment.id}/lock`, accountantId, {});
    const blank = await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: '   ',
    });
    assert.equal(blank.status, 400);
    assert.match(String(blank.body.error), /lý do/i);
  });

  test('adjust applies under the accounting lock only when it is absent — accounting lock wins', async () => {
    const shipment = await mkShipment();
    await api('POST', `/api/shipments/${shipment.id}/lock`, accountantId, {});
    // Direct fixture row: the accounting-lock service signature is richer
    // than this pin needs, and the guard only reads committed rows.
    await db.insert(s.shipmentAccountingLocks).values({
      shipmentId: shipment.id,
      billingDocumentId: 0,
      billingDocumentVersion: 1,
      shipmentVersionAtLock: shipment.version,
      billingPeriodSnapshot: { rangeFrom: '2026-01-01', rangeTo: '2026-01-31', issuedAt: '2026-02-01' },
      reason: 'c19 accounting-lock-wins probe',
      activatedBy: adminId,
    });
    const blocked = await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: 'blocked by the accounting lock',
    });
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.body.error), /kế toán|đã khóa/i);
  });

  test('adjust never mutates the snapshot — new history row with before/after', async () => {
    const shipment = await mkShipment();
    const lock = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
    assert.equal(lock.status, 201, 'precondition: lock succeeds');
    const before = await costLockRow(shipment.id);
    assert.ok(before?.costSnapshot);
    const frozen = JSON.stringify(before.costSnapshot);

    const adjust = await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: 'Chốt lại chi phí theo biên bản',
      changes: { note: 'adjust probe' },
    });
    assert.equal(adjust.status, 201, JSON.stringify(adjust.body));

    const afterRow = await costLockRow(shipment.id);
    assert.equal(JSON.stringify(afterRow?.costSnapshot), frozen, 'the locked snapshot is immutable');
    const history = await adjustmentRows(shipment.id);
    assert.equal(history.length, 1);
    assert.ok(history[0].beforeJson && history[0].afterJson);
    assert.equal(history[0].reason, 'Chốt lại chi phí theo biên bản');
  });

  test('adjust idempotency replay returns the same adjustment, one row', async () => {
    const shipment = await mkShipment();
    await api('POST', `/api/shipments/${shipment.id}/lock`, accountantId, {});
    const key = `c19-adjust-${suffix}-${shipment.id}`;
    const first = await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: 'replay probe',
    }, key);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const replay = await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: 'replay probe',
    }, key);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.id, first.body.id);
    assert.equal((await adjustmentRows(shipment.id)).length, 1);
  });

  test('GET adjustments returns the before/after history', async () => {
    const shipment = await mkShipment();
    await api('POST', `/api/shipments/${shipment.id}/lock`, accountantId, {});
    await api('POST', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId, {
      reason: 'history probe',
    });
    const list = await api('GET', `/api/shipments/${shipment.id}/cost-adjustments`, accountantId);
    assert.equal(list.status, 200);
    const items = Array.isArray(list.body) ? list.body : list.body.items as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(items) && items.length >= 1);
    assert.ok(items.every((item) => 'reason' in item));
  });
});

describe('2026-09-19 ruling — the lock freezes the 2.3 composition', () => {
  test('the lock snapshot carries the frozen payables composition (State A)', async () => {
    const shipment = await mkShipment();
    const [lot] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const [trip] = await db.insert(s.trips).values({
      shipmentId: shipment.id, customerId: lot.customerId!, routeId: lot.routeId!,
      status: 'CREATED', departureDate: '2026-09-20',
    }).returning();
    createdTripIds.push(trip.id);
    const [carrier] = await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, externalFreightCost: '500000' }).returning();
    createdCarrierInfoIds.push(carrier.id);
    await db.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, expenseTypeCode: 'PHI_CHI_HO', amount: '250000', paidById: cusId, paidAt: '2026-09-19' });
    await db.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, expenseTypeCode: 'PHI_CHI_HO', amount: '140000', paidById: cusId, paidAt: '2026-09-19' });
    const lockResult = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
    assert.equal(lockResult.status, 201, JSON.stringify(lockResult.body));
    const row = await costLockRow(shipment.id);
    assert.ok(row, 'an active cost lock row must exist');
    const snapshot = row!.costSnapshot as Record<string, unknown>;
    assert.equal(snapshot['externalFreightCost'], 500000, 'Cước trả freezes as a number');
    assert.equal(snapshot['opsExpenseTotal'], 390000);
    assert.equal(snapshot['unclassifiedFee'], 390000, 'State A: the whole ops total sits in the visible catch-all');
    assert.equal(snapshot['hqgsFee'], null, 'no category producer yet — customs reads null, never a guess');
    assert.equal(snapshot['phatSinhFee'], null);
    assert.equal(snapshot['payableTotal'], 890000);
    assert.equal(
      (snapshot['hqgsFee'] as number | null ?? 0) + (snapshot['phatSinhFee'] as number | null ?? 0) + (snapshot['unclassifiedFee'] as number | null ?? 0),
      snapshot['opsExpenseTotal'],
      'buckets conserve the ops total (ruling hardening b)',
    );
  });

  test('the locked lot reads 2.3 from the frozen snapshot; the payables wire carries structural keys only', async () => {
    const shipment = await mkShipment();
    const [lot] = await db.select().from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const [trip] = await db.insert(s.trips).values({
      shipmentId: shipment.id, customerId: lot.customerId!, routeId: lot.routeId!,
      status: 'CREATED', departureDate: '2026-09-20',
    }).returning();
    createdTripIds.push(trip.id);
    const [carrier] = await db.insert(s.tripCarrierInfo).values({ tripId: trip.id, externalFreightCost: '600000' }).returning();
    createdCarrierInfoIds.push(carrier.id);
    await db.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, expenseTypeCode: 'PHI_CHI_HO', amount: '100000', paidById: cusId, paidAt: '2026-09-19' });
    const lockResult = await api('POST', `/api/shipments/${shipment.id}/lock`, cusId, {});
    assert.equal(lockResult.status, 201, JSON.stringify(lockResult.body));
    const before = await api('GET', `/api/shipments/${shipment.id}/debit-detail`, cusId);
    assert.equal(before.status, 200, JSON.stringify(before.body).slice(0, 160));
    const payablesBefore = (before.body as { payables: Record<string, unknown> }).payables;
    assert.deepEqual(
      Object.keys(payablesBefore).sort(),
      ['chiHoTotal', 'externalFreightCost', 'hqgsFee', 'opsExpenseTotal', 'payableTotal', 'phatSinhFee', 'unclassifiedFee'],
      'structural keys only — no place-named field exists on the wire (freeze ruling)',
    );
    assert.equal(payablesBefore['externalFreightCost'], 600000);
    assert.equal(payablesBefore['opsExpenseTotal'], 100000);
    assert.equal(payablesBefore['unclassifiedFee'], 100000);
    assert.equal(payablesBefore['payableTotal'], 700000);
    await db.insert(s.opsExpenseEntries).values({ shipmentId: shipment.id, expenseTypeCode: 'PHI_CHI_HO', amount: '500000', paidById: cusId, paidAt: '2026-09-19' });
    await db.update(s.tripCarrierInfo).set({ externalFreightCost: '1' }).where(eq(s.tripCarrierInfo.tripId, trip.id));
    const afterMutations = await api('GET', `/api/shipments/${shipment.id}/debit-detail`, cusId);
    const payablesAfter = (afterMutations.body as { payables: Record<string, unknown> }).payables;
    assert.equal(payablesAfter['externalFreightCost'], 600000, 'the locked table does not follow live carrier-cost edits');
    assert.equal(payablesAfter['opsExpenseTotal'], 100000, 'the locked table does not follow live ops rows');
    assert.equal(payablesAfter['payableTotal'], 700000, 'the frozen total is immutable behind the lock');
  });
});
