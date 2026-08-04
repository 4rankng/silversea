import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray, like } from 'drizzle-orm';

import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { client, db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate, disconnectRedis } from '../lib/redis';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import configRoutes from '../routes/config';
import paymentsRoutes from '../routes/financial/payments.routes';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds = new Set<number>();
const idempotencyKeys = new Set<string>();

let server: http.Server;
let baseUrl = '';
let makerToken = '';
let managerMakerToken = '';
let accountantMakerToken = '';
let checkerToken = '';
let approverToken = '';
let driverToken = '';
let originalRoadConfig: typeof s.roadConfig.$inferSelect | null = null;
let originalFuelConfigRows: Array<typeof s.fuelConfig.$inferSelect> = [];
let originalCompanyRows: Array<{ key: string; value: string }> = [];

async function invalidateSingletonCaches(): Promise<void> {
  await Promise.all([
    cacheInvalidate('config:fuel'),
    cacheInvalidate('config:fuel-price-history'),
    cacheInvalidate('catalogs:bootstrap'),
  ]);
}

function expectPendingGovernance(body: Record<string, unknown>) {
  assert.equal(body.status, 'PENDING_CHECK');
  assert.equal(body.subjectType, 'PRICE_CONFIG');
  assert.equal(body.actionKind, 'PRICE_CONFIG_CHANGE');
}

async function checkAction(actionId: number, version: number) {
  return requestJson(`/api/governance-actions/${actionId}/check`, {
    method: 'POST',
    token: checkerToken,
    idempotencyKey: `q23-singleton-check-${actionId}-${version}`,
    body: { expectedVersion: version },
  });
}

async function approveAction(actionId: number, version: number) {
  return requestJson(`/api/governance-actions/${actionId}/approve`, {
    method: 'POST',
    token: approverToken,
    idempotencyKey: `q23-singleton-approve-${actionId}-${version}`,
    body: { expectedVersion: version },
  });
}

function sign(user: { id: number; username: string; role: string }) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    config.jwtSecret,
  );
}

async function requestJson(path: string, init: {
  method?: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  expectedUpdatedAt?: string;
} = {}) {
  if (init.idempotencyKey) idempotencyKeys.add(init.idempotencyKey);
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  if (init.expectedUpdatedAt) headers['If-Unmodified-Since'] = init.expectedUpdatedAt;
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body: body as Record<string, unknown>,
  };
}

before(async () => {
  await initEnforcer();
  await invalidateSingletonCaches();
  originalRoadConfig = await db.select().from(s.roadConfig).limit(1).then((rows) => rows[0] ?? null);
  originalFuelConfigRows = await db.select().from(s.fuelConfig);
  originalCompanyRows = await db.select({ key: s.appSettings.key, value: s.appSettings.value })
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'company.%'))
    .orderBy(s.appSettings.key);

  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware, casbinAuthz('config'), configRoutes);
  app.use('/api', authMiddleware, paymentsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const mkUser = async (username: string, role: 'ADMIN' | 'ACCOUNTANT' | 'MANAGER' | 'DRIVER') => {
    const [user] = await db.insert(s.users).values({
      username,
      fullName: username,
      passwordHash: await bcrypt.hash('admin123', 10),
      role,
      status: 'ACTIVE',
    }).returning({ id: s.users.id, username: s.users.username, role: s.users.role });
    createdUserIds.add(user.id);
    return user;
  };

  const maker = await mkUser(`q23-singleton-maker-${suffix}`, 'ADMIN');
  const managerMaker = await mkUser(`q23-singleton-manager-maker-${suffix}`, 'MANAGER');
  const accountantMaker = await mkUser(`q23-singleton-accountant-maker-${suffix}`, 'ACCOUNTANT');
  const checker = await mkUser(`q23-singleton-checker-${suffix}`, 'ACCOUNTANT');
  const approver = await mkUser(`q23-singleton-approver-${suffix}`, 'MANAGER');
  const driver = await mkUser(`q23-singleton-driver-${suffix}`, 'DRIVER');
  makerToken = sign({ ...maker, username: maker.username ?? `maker-${maker.id}` });
  managerMakerToken = sign({
    ...managerMaker,
    username: managerMaker.username ?? `manager-maker-${managerMaker.id}`,
  });
  accountantMakerToken = sign({
    ...accountantMaker,
    username: accountantMaker.username ?? `accountant-maker-${accountantMaker.id}`,
  });
  checkerToken = sign({ ...checker, username: checker.username ?? `checker-${checker.id}` });
  approverToken = sign({ ...approver, username: approver.username ?? `approver-${approver.id}` });
  driverToken = sign({ ...driver, username: driver.username ?? `driver-${driver.id}` });
});

describe('Q23 singleton config routes', () => {
  test('MANAGER and ACCOUNTANT can submit governed company-info changes through the real PUT route', async () => {
    const companyBefore = await requestJson('/api/company-info', { token: makerToken });
    const expectedUpdatedAt = typeof companyBefore.body.updatedAt === 'string'
      ? companyBefore.body.updatedAt
      : undefined;
    const payload = {
      name: `Office role company ${suffix}`,
      address: '1 Q23 Street',
      taxCode: '0312345678',
      representative: 'Nguyen Van A',
      representativeTitle: 'Giám đốc',
      bankAccount: '0123456789',
      bankName: 'Vietcombank',
      phone: '',
      email: '',
      logoStorageKey: null,
    };

    for (const [role, token] of [
      ['MANAGER', managerMakerToken],
      ['ACCOUNTANT', accountantMakerToken],
    ] as const) {
      const idempotencyKey = `q23-company-${role.toLowerCase()}-maker-${suffix}`;
      const response = await requestJson('/api/company-info', {
        method: 'PUT',
        token,
        idempotencyKey,
        expectedUpdatedAt,
        body: { ...payload, name: `${payload.name} ${role}` },
      });

      assert.equal(response.status, 201, `${role} PUT body ${JSON.stringify(response.body)}`);
      expectPendingGovernance(response.body);
      assert.equal(response.body.replayed, false);

      await db.delete(s.governanceActions)
        .where(eq(s.governanceActions.id, Number(response.body.id)));
      await db.delete(s.idempotencyKeys)
        .where(eq(s.idempotencyKeys.idempotencyKey, idempotencyKey));
    }
  });

  test('road/fuel/company routes enforce RBAC, replay exactly, reject drift, and require current version on existing data', async () => {
    const roadForbidden = await requestJson('/api/road-config', {
      method: 'PUT',
      token: driverToken,
      idempotencyKey: `q23-road-forbidden-${suffix}`,
      body: {
        tollPerStation: '11111',
        returnCargoBonus: '22222',
        defaultDriverSalary: '33333',
        twoPointDeliveryBonus: '44444',
        vehicleShiftDefault: '55555',
      },
    });
    assert.equal(roadForbidden.status, 403);

    const roadBefore = await requestJson('/api/road-config', { token: makerToken });
    const roadVersion = roadBefore.body && typeof roadBefore.body === 'object' && typeof roadBefore.body.updatedAt === 'string'
      ? roadBefore.body.updatedAt
      : undefined;
    const roadKey = `q23-road-${suffix}`;
    const roadPayload = {
      tollPerStation: '11111',
      returnCargoBonus: '22222',
      defaultDriverSalary: '33333',
      twoPointDeliveryBonus: '44444',
      vehicleShiftDefault: '55555',
    };
    const roadFirst = await requestJson('/api/road-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: roadKey,
      expectedUpdatedAt: roadVersion,
      body: roadPayload,
    });
    const roadReplay = await requestJson('/api/road-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: roadKey,
      expectedUpdatedAt: roadVersion,
      body: roadPayload,
    });
    const roadDrift = await requestJson('/api/road-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: roadKey,
      expectedUpdatedAt: roadVersion,
      body: { ...roadPayload, tollPerStation: '99999' },
    });
    const roadMissingVersion = await requestJson('/api/road-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: `q23-road-missing-version-${suffix}`,
      body: { ...roadPayload, vehicleShiftDefault: '66666' },
    });
    const roadStale = await requestJson('/api/road-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: `q23-road-stale-${suffix}`,
      expectedUpdatedAt: roadVersion ?? new Date(0).toISOString(),
      body: { ...roadPayload, vehicleShiftDefault: '77777' },
    });
    assert.equal(roadFirst.status, 201);
    assert.equal(roadReplay.status, 200);
    assert.equal(roadFirst.body.replayed, false);
    assert.equal(roadReplay.body.replayed, true);
    expectPendingGovernance(roadFirst.body);
    assert.deepEqual(roadReplay.body, { ...roadFirst.body, replayed: true });
    assert.equal(roadDrift.status, 409);
    assert.equal(roadMissingVersion.status, roadVersion ? 428 : 409);
    assert.equal(roadStale.status, 409);
    const roadAfter = await requestJson('/api/road-config', { token: makerToken });
    assert.deepEqual(roadAfter.body, roadBefore.body);
    const roadChecked = await checkAction(Number(roadFirst.body.id), Number(roadFirst.body.version));
    assert.equal(roadChecked.status, 200, `road check body ${JSON.stringify(roadChecked.body)}`);
    const roadApproved = await approveAction(Number(roadFirst.body.id), Number(roadChecked.body.version));
    assert.equal(roadApproved.status, 200, `road approve body ${JSON.stringify(roadApproved.body)}`);
    const roadAfterApproval = await requestJson('/api/road-config', { token: makerToken });
    assert.equal(roadAfterApproval.body.tollPerStation, roadPayload.tollPerStation);

    const fuelForbidden = await requestJson('/api/fuel-config', {
      method: 'PUT',
      token: driverToken,
      idempotencyKey: `q23-fuel-forbidden-${suffix}`,
      body: { source: 'MANUAL', manualPrice: '25000' },
    });
    assert.equal(fuelForbidden.status, 403);

    const fuelBefore = await requestJson('/api/fuel-config', { token: makerToken });
    const fuelVersion = fuelBefore.body && typeof fuelBefore.body === 'object' && typeof fuelBefore.body.updatedAt === 'string'
      ? fuelBefore.body.updatedAt
      : undefined;
    const fuelKey = `q23-fuel-${suffix}`;
    const fuelPayload = {
      loadedNorm: '32',
      emptyNorm: '28',
      supplement: '3',
      unitPrice: '25000',
      warningThreshold: '37',
      criticalThreshold: '40',
    };
    const fuelFirst = await requestJson('/api/fuel-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: fuelKey,
      expectedUpdatedAt: fuelVersion,
      body: fuelPayload,
    });
    const fuelReplay = await requestJson('/api/fuel-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: fuelKey,
      expectedUpdatedAt: fuelVersion,
      body: fuelPayload,
    });
    const fuelDrift = await requestJson('/api/fuel-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: fuelKey,
      expectedUpdatedAt: fuelVersion,
      body: { ...fuelPayload, unitPrice: '26000' },
    });
    const fuelMissingVersion = await requestJson('/api/fuel-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: `q23-fuel-missing-version-${suffix}`,
      body: { ...fuelPayload, unitPrice: '27000' },
    });
    const fuelStale = await requestJson('/api/fuel-config', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: `q23-fuel-stale-${suffix}`,
      expectedUpdatedAt: fuelVersion ?? new Date(0).toISOString(),
      body: { ...fuelPayload, unitPrice: '28000' },
    });
    assert.equal(fuelFirst.status, 201, `fuel first body ${JSON.stringify(fuelFirst.body)}`);
    assert.equal(fuelReplay.status, 200);
    assert.equal(fuelFirst.body.replayed, false);
    assert.equal(fuelReplay.body.replayed, true);
    expectPendingGovernance(fuelFirst.body);
    assert.deepEqual(fuelReplay.body, { ...fuelFirst.body, replayed: true });
    assert.equal(fuelDrift.status, 409);
    assert.equal(fuelMissingVersion.status, fuelVersion ? 428 : 409);
    assert.equal(fuelStale.status, 409);
    const fuelAfter = await requestJson('/api/fuel-config', { token: makerToken });
    assert.deepEqual(fuelAfter.body, fuelBefore.body);
    const fuelChecked = await checkAction(Number(fuelFirst.body.id), Number(fuelFirst.body.version));
    assert.equal(fuelChecked.status, 200);
    const fuelApproved = await approveAction(Number(fuelFirst.body.id), Number(fuelChecked.body.version));
    assert.equal(fuelApproved.status, 200);
    await invalidateSingletonCaches();
    const fuelAfterApproval = await requestJson('/api/fuel-config', { token: makerToken });
    assert.equal(fuelAfterApproval.body.unitPrice, fuelPayload.unitPrice);

    const companyForbidden = await requestJson('/api/company-info', {
      method: 'PUT',
      token: driverToken,
      idempotencyKey: `q23-company-forbidden-${suffix}`,
      body: { name: 'Forbidden Co', taxCode: '0312345678' },
    });
    assert.equal(companyForbidden.status, 403);

    const companyBefore = await requestJson('/api/company-info', { token: makerToken });
    const companyVersion = companyBefore.body && typeof companyBefore.body === 'object' && typeof companyBefore.body.updatedAt === 'string'
      ? companyBefore.body.updatedAt
      : undefined;
    const companyKey = `q23-company-${suffix}`;
    const companyPayload = {
      name: `Q23 Company ${suffix}`,
      address: '1 Q23 Street',
      taxCode: '0312345678',
      representative: 'Nguyen Van A',
      representativeTitle: 'Giám đốc',
      bankAccount: '0123456789',
      bankName: 'Vietcombank',
      phone: '0909000000',
      email: 'q23@example.com',
      logoStorageKey: null,
    };
    const companyFirst = await requestJson('/api/company-info', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: companyKey,
      expectedUpdatedAt: companyVersion,
      body: companyPayload,
    });
    const companyReplay = await requestJson('/api/company-info', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: companyKey,
      expectedUpdatedAt: companyVersion,
      body: companyPayload,
    });
    const companyDrift = await requestJson('/api/company-info', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: companyKey,
      expectedUpdatedAt: companyVersion,
      body: { ...companyPayload, phone: '0911000000' },
    });
    const companyMissingVersion = await requestJson('/api/company-info', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: `q23-company-missing-version-${suffix}`,
      body: { ...companyPayload, phone: '0922000000' },
    });
    const companyStale = await requestJson('/api/company-info', {
      method: 'PUT',
      token: makerToken,
      idempotencyKey: `q23-company-stale-${suffix}`,
      expectedUpdatedAt: companyVersion ?? new Date(0).toISOString(),
      body: { ...companyPayload, phone: '0933000000' },
    });
    assert.equal(companyFirst.status, 201, `company first body ${JSON.stringify(companyFirst.body)}`);
    assert.equal(companyReplay.status, 200);
    assert.equal(companyFirst.body.replayed, false);
    assert.equal(companyReplay.body.replayed, true);
    expectPendingGovernance(companyFirst.body);
    assert.deepEqual(companyReplay.body, { ...companyFirst.body, replayed: true });
    assert.equal(companyDrift.status, 409);
    assert.equal(companyMissingVersion.status, companyVersion ? 428 : 409);
    assert.equal(companyStale.status, 409);
    const companyAfter = await requestJson('/api/company-info', { token: makerToken });
    assert.deepEqual(companyAfter.body, companyBefore.body);
    const companyChecked = await checkAction(Number(companyFirst.body.id), Number(companyFirst.body.version));
    assert.equal(companyChecked.status, 200);
    const companyApproved = await approveAction(Number(companyFirst.body.id), Number(companyChecked.body.version));
    assert.equal(companyApproved.status, 200);
    const companyAfterApproval = await requestJson('/api/company-info', { token: makerToken });
    assert.equal(companyAfterApproval.body.name, companyPayload.name);
  });
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  await db.delete(s.roadConfig);
  if (originalRoadConfig) {
    await db.insert(s.roadConfig).values(originalRoadConfig);
  }

  await db.delete(s.fuelConfig);
  if (originalFuelConfigRows.length > 0) {
    await db.insert(s.fuelConfig).values(originalFuelConfigRows);
  }

  await db.delete(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  if (originalCompanyRows.length > 0) {
    await db.insert(s.appSettings).values(originalCompanyRows);
  }
  await invalidateSingletonCaches();

  if (createdUserIds.size > 0) {
    await db.delete(s.governanceActions)
      .where(inArray(s.governanceActions.makerId, [...createdUserIds]));
  }
  if (idempotencyKeys.size > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...idempotencyKeys]));
  }
  if (createdUserIds.size > 0) {
    const userIds = [...createdUserIds];
    await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, userIds));
    await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, userIds));
    await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, userIds));
    await db.delete(s.drivers).where(inArray(s.drivers.userId, userIds));
    await db.delete(s.users).where(inArray(s.users.id, userIds));
  }

  await disconnectRedis();
  await client.end();
});
