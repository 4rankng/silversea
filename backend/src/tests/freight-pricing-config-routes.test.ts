/**
 * Freight pricing config routes — T2 CRUD contracts.
 *
 * Locks the config-surface behavior for the auto pricing engine
 * (`Phương án tính cước tự động.docx` §2-A/B/C + §5-1):
 *   - fuel_price_periods: single-record entry, effectiveFrom unique ⇒ 409,
 *     CUS route-scoped entry allowance (Kế toán/CUS per docx §5-1).
 *   - freight_rate_terms: customer×route×effectiveDate unique ⇒ 409,
 *     threshold pct/abs XOR enforced on create AND on merged updates.
 *   - fuel_consumption_norms: class×effectiveDate unique ⇒ 409, class must
 *     exist (400 otherwise).
 *   - vehicle_size_classes: code unique ⇒ 409, code immutable after create.
 *   - RBAC: DISPATCHER (config read-only) writes are denied 401/403.
 *
 * Harness mirrors dispatch-zone-crud.test.ts: casbinAuthz('config') mount +
 * test-only principal injection.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';

const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
const suffix = `${Date.now()}-${rand}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdVehicleClassIds: number[] = [];
const createdTermsIds: number[] = [];
const createdNormIds: number[] = [];
const createdFuelPeriodIds: number[] = [];
const userIds: number[] = [];
let adminId = 0;
let accountantId = 0;
let cusId = 0;
let dispatcherId = 0;
let server: http.Server;
let baseUrl = '';

async function api(
  method: string,
  path: string,
  actorId: number,
  body?: Record<string, unknown>,
  expectedUpdatedAt?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `fpc-${suffix}-${method}-${Math.random()}`,
      'X-Test-User-Id': String(actorId),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsedBody = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsedBody };
}

async function createUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `fpc-${role}-${suffix}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id, role: s.users.role });
  userIds.push(user.id);
  return user;
}

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `FPC customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes)
    .values({ name: `FPC route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkVehicleClass() {
  const code = `VC${rand}${createdVehicleClassIds.length}`.slice(0, 20);
  const [vc] = await db.insert(s.vehicleSizeClasses)
    .values({ code, name: `FPC class ${code}` }).returning();
  createdVehicleClassIds.push(vc.id);
  return vc;
}

let fuelDates: string[] = [];
let dateReservation: Awaited<ReturnType<typeof client.reserve>> | undefined;

async function reserveFuelDates() {
  // Serialize this suite's allocation across simultaneous local runs without
  // deleting another suite's fixtures or weakening the production unique key.
  dateReservation = await client.reserve();
  await dateReservation`SELECT pg_advisory_lock(906415, 1)`;
  const occupied = new Set((await db.select({ date: s.fuelPricePeriods.effectiveFrom })
    .from(s.fuelPricePeriods)).map(row => row.date));
  const day = new Date('2100-01-01T00:00:00.000Z');
  while (true) {
    const dates = Array.from({ length: 4 }, (_, offset) => {
      const candidate = new Date(day);
      candidate.setUTCDate(candidate.getUTCDate() + offset);
      return candidate.toISOString().slice(0, 10);
    });
    if (dates.every(date => !occupied.has(date))) { fuelDates = dates; return; }
    day.setUTCDate(day.getUTCDate() + 4);
  }
}

before(async () => {
  await reserveFuelDates();
  await initEnforcer();
  adminId = (await createUser(Role.ADMIN)).id;
  accountantId = (await createUser(Role.ACCOUNTANT)).id;
  cusId = (await createUser(Role.CUS)).id;
  dispatcherId = (await createUser(Role.DISPATCHER)).id;

  const app = express();
  app.use(express.json());
  const roleById = new Map<number, Role>([
    [adminId, Role.ADMIN],
    [accountantId, Role.ACCOUNTANT],
    [cusId, Role.CUS],
    [dispatcherId, Role.DISPATCHER],
  ]);
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-user-id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    (req as unknown as { user?: { userId: number; role: Role } }).user = {
      userId: Number(id) || adminId,
      role: roleById.get(Number(id)) ?? Role.ADMIN,
    };
    next();
  });
  app.use('/api', casbinAuthz('config'), configRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  for (const id of createdFuelPeriodIds) {
    await db.delete(s.fuelPricePeriods).where(eq(s.fuelPricePeriods.id, id)).catch(() => {});
  }
  for (const id of createdNormIds) {
    await db.delete(s.fuelConsumptionNorms).where(eq(s.fuelConsumptionNorms.id, id)).catch(() => {});
  }
  for (const id of createdTermsIds) {
    await db.delete(s.freightRateTerms).where(eq(s.freightRateTerms.id, id)).catch(() => {});
  }
  for (const id of createdVehicleClassIds) {
    await db.delete(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, id)).catch(() => {});
  }
  for (const id of createdRouteIds) {
    await db.delete(s.routes).where(eq(s.routes.id, id)).catch(() => {});
  }
  for (const id of createdCustomerIds) {
    await db.delete(s.customers).where(eq(s.customers.id, id)).catch(() => {});
  }
  for (const id of userIds) {
    await db.delete(s.users).where(eq(s.users.id, id)).catch(() => {});
  }
  if (dateReservation) {
    await dateReservation`SELECT pg_advisory_unlock(906415, 1)`;
    dateReservation.release();
  }
  await client.end();
  await disconnectRedis();
});

describe('fuel price periods config CRUD', () => {
  test('accountant enters a period; duplicate effectiveFrom conflicts 409', async () => {
    const created = await api('POST', '/fuel-price-periods', accountantId, {
      unitPrice: 21740,
      effectiveFrom: fuelDates[0],
      sourceNote: 'Điều chỉnh giá dầu DO',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const periodId = (created.body as { id: number }).id;
    createdFuelPeriodIds.push(periodId);

    const duplicate = await api('POST', '/fuel-price-periods', accountantId, {
      unitPrice: 22000,
      effectiveFrom: fuelDates[0],
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    // A later period is a new row, not an edit — audit keeps the old one.
    const next = await api('POST', '/fuel-price-periods', accountantId, {
      unitPrice: 27620,
      effectiveFrom: fuelDates[1],
    });
    assert.equal(next.status, 201, JSON.stringify(next.body));
    createdFuelPeriodIds.push((next.body as { id: number }).id);

    const list = await api('GET', '/fuel-price-periods', accountantId);
    assert.equal(list.status, 200);
    const dates = ((list.body as { items: Array<{ effectiveFrom: string }> }).items)
      .map((item) => item.effectiveFrom);
    assert.ok(dates.includes(fuelDates[0]), 'chronological list includes the entry');
  });

  test('fuel entries record the entrant and the list names them (audit attribution)', async () => {
    const created = await api('POST', '/fuel-price-periods', accountantId, {
      unitPrice: 28000,
      effectiveFrom: fuelDates[3],
      sourceNote: 'Ai nhập 28.000đ từ 19/9 — audit attribution',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    createdFuelPeriodIds.push((created.body as { id: number }).id);
    assert.equal((created.body as { createdBy: number }).createdBy, accountantId,
      'the entrant id must ride the created row');

    const list = await api('GET', '/fuel-price-periods', accountantId);
    assert.equal(list.status, 200);
    const items = (list.body as { items: Array<{ id: number; createdBy: number | null; createdByName: string | null }> }).items;
    const row = items.find((item) => item.id === (created.body as { id: number }).id);
    assert.ok(row, 'new row appears in the list');
    assert.equal(row!.createdBy, accountantId);
    assert.ok(row!.createdByName, 'list carries the entrant name for attribution');
    // Legacy rows (created by seed/pre-fix writes) expose no invented author:
    // the client renders them as "Không xác định".
    const legacy = items.find((item) => item.createdBy == null);
    if (legacy) assert.equal(legacy.createdByName, null);
  });

  test('CUS may enter fuel prices (docx §5-1 route-scoped); DISPATCHER may not', async () => {
    const cusEntry = await api('POST', '/fuel-price-periods', cusId, {
      unitPrice: 21900,
      effectiveFrom: fuelDates[2],
    });
    assert.equal(cusEntry.status, 201, JSON.stringify(cusEntry.body));
    createdFuelPeriodIds.push((cusEntry.body as { id: number }).id);

    // The CUS allowance is fuel prices ONLY — a CUS write to rate terms is
    // still casbin-denied (no config-tree grant).
    const [customer] = [await mkCustomer()];
    const [route] = [await mkRoute()];
    const cusDeniedTerms = await api('POST', '/freight-rate-terms', cusId, {
      customerId: customer.id,
      routeId: route.id,
      sharePct: 2,
      billingKmOneWay: 130,
      baseFuelPrice: 17842.5926,
    });
    assert.ok([401, 403].includes(cusDeniedTerms.status), `expected denial, got ${cusDeniedTerms.status}`);

    const dispatcherDenied = await api('POST', '/fuel-price-periods', dispatcherId, {
      unitPrice: 21900,
      effectiveFrom: fuelDates[3],
    });
    assert.ok([401, 403].includes(dispatcherDenied.status), `expected denial, got ${dispatcherDenied.status}`);
  });
});

describe('freight rate terms config CRUD', () => {
  test('create requires agreed lag and threshold choice; an unrelated patch preserves existing terms', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const base = { customerId: customer.id, routeId: route.id, billingKmOneWay: 100, baseFuelPrice: 20000, surchargeThresholdPct: null };
    for (const fuelLagDays of [undefined, null, '', '  ', false, true]) {
      const rejected = await api('POST', '/freight-rate-terms', accountantId, { ...base, fuelLagDays });
      assert.equal(rejected.status, 400, `Unknown lag ${String(fuelLagDays)}: ${JSON.stringify(rejected.body)}`);
    }
    const { surchargeThresholdPct: _threshold, ...noThreshold } = base;
    const missingThreshold = await api('POST', '/freight-rate-terms', accountantId, { ...noThreshold, fuelLagDays: 0 });
    // 20260917_11 three-state model: creating WITHOUT a threshold is legal —
    // the row lands in UNSET (nothing customer-confirmed yet) and the ENGINE,
    // not this route, refuses to auto-apply fuel prices to it.
    assert.equal(missingThreshold.status, 201, JSON.stringify(missingThreshold.body));
    assert.equal(missingThreshold.body.surchargeThresholdMode, 'UNSET');
    assert.equal(missingThreshold.body.fuelLagConfirmed, false);
    createdTermsIds.push(Number(missingThreshold.body.id));
    // A second route so the UNSET row above and this confirmed row don't
    // collide on the customer×route×date unique key.
    const route2 = await mkRoute();
    const recorded = await api('POST', '/freight-rate-terms', accountantId, { ...base, routeId: route2.id, fuelLagDays: '0' });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    const termsId = Number(recorded.body.id);
    createdTermsIds.push(termsId);
    const [before] = await db.select().from(s.freightRateTerms).where(eq(s.freightRateTerms.id, termsId));
    assert.equal(before.fuelLagDays, 0);
    assert.equal(before.surchargeThresholdPct, null);
    assert.equal(before.surchargeThresholdAbs, null);
    const updated = await api('PUT', `/freight-rate-terms/${termsId}`, accountantId, { note: 'Giữ điều khoản đã thỏa thuận' }, before.updatedAt.toISOString());
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const [after] = await db.select().from(s.freightRateTerms).where(eq(s.freightRateTerms.id, termsId));
    assert.equal(after.fuelLagDays, 0);
    assert.equal(after.surchargeThresholdPct, null);
    assert.equal(after.surchargeThresholdAbs, null);
    const blankPatch = await api('PUT', `/freight-rate-terms/${termsId}`, accountantId, { fuelLagDays: '' }, after.updatedAt.toISOString());
    assert.equal(blankPatch.status, 400, JSON.stringify(blankPatch.body));
  });

  test('admin creates terms; duplicate customer×route×date conflicts 409', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const created = await api('POST', '/freight-rate-terms', adminId, {
      customerId: customer.id,
      routeId: route.id,
      sharePct: 2,
      billingKmOneWay: 130,
      baseFuelPrice: 17842.5926,
      fuelLagDays: 1,
      surchargeThresholdPct: null,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const termsId = (created.body as { id: number }).id;
    createdTermsIds.push(termsId);

    const duplicate = await api('POST', '/freight-rate-terms', adminId, {
      customerId: customer.id,
      routeId: route.id,
      sharePct: 4,
      billingKmOneWay: 100,
      baseFuelPrice: 17842.5926,
      fuelLagDays: 1,
      surchargeThresholdPct: null,
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    const [row] = await db.select().from(s.freightRateTerms)
      .where(eq(s.freightRateTerms.id, termsId));
    assert.equal(Number(row.billingKmMultiplier), 2, 'km multiplier defaults to ×2 (chốt Câu 4=A)');
  });

  test('threshold pct/abs XOR: both on create rejected; merged patch rejected; single mode updates', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const bothSet = await api('POST', '/freight-rate-terms', adminId, {
      customerId: customer.id,
      routeId: route.id,
      sharePct: 2.5,
      billingKmOneWay: 120,
      baseFuelPrice: 17842.5926,
      fuelLagDays: 1,
      surchargeThresholdPct: 5,
      surchargeThresholdAbs: 500,
    });
    assert.equal(bothSet.status, 400, JSON.stringify(bothSet.body));
    assert.match(String((bothSet.body as { error?: string }).error), /ngưỡng/i);

    const pctOnly = await api('POST', '/freight-rate-terms', adminId, {
      customerId: customer.id,
      routeId: route.id,
      sharePct: 2.5,
      billingKmOneWay: 120,
      baseFuelPrice: 17842.5926,
      fuelLagDays: 1,
      surchargeThresholdMode: 'PCT',
      surchargeThresholdPct: 5,
    });
    assert.equal(pctOnly.status, 201, JSON.stringify(pctOnly.body));
    const termsId = (pctOnly.body as { id: number }).id;
    createdTermsIds.push(termsId);

    // A patch that only sets the ABS threshold must still be rejected: the
    // stored row carries the PCT threshold and the merged view has both.
    const [row] = await db.select().from(s.freightRateTerms)
      .where(eq(s.freightRateTerms.id, termsId));
    const mergeRejected = await api('PUT', `/freight-rate-terms/${termsId}`, adminId, {
      surchargeThresholdAbs: 500,
    }, row.updatedAt.toISOString());
    assert.equal(mergeRejected.status, 400, JSON.stringify(mergeRejected.body));
    assert.match(String((mergeRejected.body as { error?: string }).error), /ngưỡng/i);

    // Swapping modes in one patch is fine — under the 20260917_11 contract
    // the patch must carry the new MODE together with the values.
    const [row2] = await db.select().from(s.freightRateTerms)
      .where(eq(s.freightRateTerms.id, termsId));
    const swap = await api('PUT', `/freight-rate-terms/${termsId}`, adminId, {
      surchargeThresholdMode: 'ABS',
      surchargeThresholdPct: null,
      surchargeThresholdAbs: 500,
    }, row2.updatedAt.toISOString());
    assert.equal(swap.status, 200, JSON.stringify(swap.body));
  });
});

describe('fuel consumption norms config CRUD', () => {
  test('admin creates a norm; duplicate class×date conflicts 409; unknown class 400', async () => {
    const vc = await mkVehicleClass();
    const created = await api('POST', '/fuel-consumption-norms', adminId, {
      vehicleSizeClassId: vc.id,
      litersPerKm: 0.35,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    createdNormIds.push((created.body as { id: number }).id);

    const duplicate = await api('POST', '/fuel-consumption-norms', adminId, {
      vehicleSizeClassId: vc.id,
      litersPerKm: 0.4,
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    const unknownClass = await api('POST', '/fuel-consumption-norms', adminId, {
      vehicleSizeClassId: 99_999_999,
      litersPerKm: 0.3,
    });
    assert.equal(unknownClass.status, 400, JSON.stringify(unknownClass.body));
  });
});

describe('vehicle size class config CRUD', () => {
  test('admin creates a class; duplicate code 409; code immutable on update', async () => {
    const vc = await mkVehicleClass();
    const duplicate = await api('POST', '/vehicle-size-classes', adminId, {
      code: vc.code,
      name: 'Trùng mã',
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

    const created = await api('POST', '/vehicle-size-classes', adminId, {
      code: `${vc.code}X`,
      name: 'Loại xe thêm',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    createdVehicleClassIds.push((created.body as { id: number }).id);
    const newId = (created.body as { id: number }).id;

    const [row] = await db.select().from(s.vehicleSizeClasses)
      .where(eq(s.vehicleSizeClasses.id, newId));
    const rename = await api('PUT', `/vehicle-size-classes/${newId}`, adminId, {
      name: 'Loại xe đã sửa',
    }, row.updatedAt.toISOString());
    assert.equal(rename.status, 200, JSON.stringify(rename.body));

    const [row2] = await db.select().from(s.vehicleSizeClasses)
      .where(eq(s.vehicleSizeClasses.id, newId));
    const codeChange = await api('PUT', `/vehicle-size-classes/${newId}`, adminId, {
      code: 'OTHER',
      name: 'Loại xe đã sửa',
    }, row2.updatedAt.toISOString());
    assert.equal(codeChange.status, 400, JSON.stringify(codeChange.body));
  });
});
