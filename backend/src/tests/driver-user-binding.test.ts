import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { globalErrorHandler } from '../middleware/errorHandler';
import { auditLogMiddleware } from '../middleware/audit';
import driverUserBindingRouter from '../routes/config/driver-user-binding.routes';
import {
  DRIVER_USER_BIND_ENDPOINT,
  bindDriverUser,
  driverUserBindingVersion,
} from '../services/driver-user-binding.service';
import { createUser, deleteUser } from '../services/user.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const userIds: number[] = [];
const driverIds: number[] = [];

let adminUserId = 0;
let managerUserId = 0;
let activeDriverUserId = 0;
let secondDriverUserId = 0;
let nonDriverUserId = 0;
let inactiveDriverUserId = 0;
let deletedDriverUserId = 0;
let bindableDriverId = 0;
let occupiedDriverId = 0;
let inactiveDriverId = 0;
let deletedDriverId = 0;
let server: http.Server;
let baseUrl = '';

async function requestBinding(
  driverId: number,
  body: Record<string, unknown>,
  options: { role?: Role; userId?: number; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Test-Role': options.role ?? Role.ADMIN,
    'X-Test-User': String(options.userId ?? adminUserId),
  };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(`${baseUrl}/api/config/driver-user-bindings/${driverId}`, {
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
  const users = await db.insert(s.users).values([
    { username: `binding-admin-${suffix}`, passwordHash: 'admin-password-hash', role: Role.ADMIN },
    { username: `binding-manager-${suffix}`, passwordHash: 'manager-password-hash', role: Role.MANAGER },
    { username: `binding-wrong-role-${suffix}`, passwordHash: 'wrong-role-password-hash', role: Role.MANAGER },
    { username: `binding-inactive-${suffix}`, passwordHash: 'inactive-password-hash', role: Role.DRIVER, status: 'INACTIVE' },
    { username: `binding-deleted-${suffix}`, passwordHash: 'deleted-password-hash', role: Role.DRIVER, deletedAt: new Date() },
  ]).returning({ id: s.users.id, username: s.users.username });
  const activeDriverUser = await createUser({
    username: `binding-driver-a-${suffix}`,
    password: 'driver-a-password',
    role: Role.DRIVER,
  });
  const secondDriverUser = await createUser({
    username: `binding-driver-b-${suffix}`,
    password: 'driver-b-password',
    role: Role.DRIVER,
  });
  userIds.push(...users.map((user) => user.id), activeDriverUser.id, secondDriverUser.id);
  const byUsername = new Map(users.map((user) => [user.username, user.id]));
  adminUserId = byUsername.get(`binding-admin-${suffix}`)!;
  managerUserId = byUsername.get(`binding-manager-${suffix}`)!;
  activeDriverUserId = activeDriverUser.id;
  secondDriverUserId = secondDriverUser.id;
  nonDriverUserId = byUsername.get(`binding-wrong-role-${suffix}`)!;
  inactiveDriverUserId = byUsername.get(`binding-inactive-${suffix}`)!;
  deletedDriverUserId = byUsername.get(`binding-deleted-${suffix}`)!;
  const autoCreatedProfiles = await db.select({ id: s.drivers.id }).from(s.drivers)
    .where(inArray(s.drivers.userId, [activeDriverUserId, secondDriverUserId]));
  assert.equal(autoCreatedProfiles.length, 0);

  const drivers = await db.insert(s.drivers).values([
    { name: `Tài xế chờ liên kết ${suffix}`, status: 'ACTIVE' },
    { name: `Tài xế đã liên kết ${suffix}`, status: 'ACTIVE', userId: secondDriverUserId },
    { name: `Tài xế ngưng hoạt động ${suffix}`, status: 'INACTIVE' },
    { name: `Tài xế đã xóa ${suffix}`, status: 'ACTIVE', deletedAt: new Date() },
  ]).returning({ id: s.drivers.id, name: s.drivers.name });
  driverIds.push(...drivers.map((driver) => driver.id));
  const byName = new Map(drivers.map((driver) => [driver.name, driver.id]));
  bindableDriverId = byName.get(`Tài xế chờ liên kết ${suffix}`)!;
  occupiedDriverId = byName.get(`Tài xế đã liên kết ${suffix}`)!;
  inactiveDriverId = byName.get(`Tài xế ngưng hoạt động ${suffix}`)!;
  deletedDriverId = byName.get(`Tài xế đã xóa ${suffix}`)!;

  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api/config/driver-user-bindings', (req, _res, next) => {
    req.user = {
      userId: Number(req.header('X-Test-User') ?? adminUserId),
      username: null,
      email: null,
      fullName: null,
      role: String(req.header('X-Test-Role') ?? Role.ADMIN) as Role,
    };
    next();
  }, driverUserBindingRouter);
  app.use(globalErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

describe('driver-user binding command', () => {
  test('is Admin-only and requires an idempotency key', async () => {
    const [driver] = await db.select().from(s.drivers).where(eq(s.drivers.id, bindableDriverId)).limit(1);
    const body = {
      userId: activeDriverUserId,
      expectedVersion: driverUserBindingVersion(driver!.updatedAt),
    };
    const denied = await requestBinding(bindableDriverId, body, {
      role: Role.MANAGER,
      userId: managerUserId,
      idempotencyKey: `binding-denied-${suffix}`,
    });
    assert.equal(denied.status, 403);
    const missingKey = await requestBinding(bindableDriverId, body);
    assert.equal(missingKey.status, 400);
    const outOfRange = await requestBinding(bindableDriverId, {
      ...body,
      userId: 2_147_483_648,
    }, {
      idempotencyKey: `binding-out-of-range-${suffix}`,
    });
    assert.equal(outOfRange.status, 400);
  });

  test('rejects invalid driver and user authorities without partial binding', async () => {
    const [bindable] = await db.select().from(s.drivers).where(eq(s.drivers.id, bindableDriverId)).limit(1);
    const version = driverUserBindingVersion(bindable!.updatedAt);
    const cases = [
      { driverId: bindableDriverId, userId: nonDriverUserId, status: 409, label: 'wrong-role' },
      { driverId: bindableDriverId, userId: inactiveDriverUserId, status: 409, label: 'inactive-user' },
      { driverId: bindableDriverId, userId: deletedDriverUserId, status: 404, label: 'deleted-user' },
      { driverId: bindableDriverId, userId: 2_147_000_000, status: 404, label: 'missing-user' },
      { driverId: inactiveDriverId, userId: activeDriverUserId, status: 409, label: 'inactive-driver' },
      { driverId: deletedDriverId, userId: activeDriverUserId, status: 404, label: 'deleted-driver' },
    ] as const;
    for (const scenario of cases) {
      const [driver] = await db.select().from(s.drivers).where(eq(s.drivers.id, scenario.driverId)).limit(1);
      const response = await requestBinding(scenario.driverId, {
        userId: scenario.userId,
        expectedVersion: driver ? driverUserBindingVersion(driver.updatedAt) : version,
      }, { idempotencyKey: `binding-${scenario.label}-${suffix}` });
      assert.equal(response.status, scenario.status, scenario.label);
    }
    const [unchanged] = await db.select({ userId: s.drivers.userId })
      .from(s.drivers).where(eq(s.drivers.id, bindableDriverId)).limit(1);
    assert.equal(unchanged!.userId, null);
  });

  test('rejects a user already bound to another non-deleted driver', async () => {
    const [driver] = await db.select().from(s.drivers).where(eq(s.drivers.id, bindableDriverId)).limit(1);
    const response = await requestBinding(bindableDriverId, {
      userId: secondDriverUserId,
      expectedVersion: driverUserBindingVersion(driver!.updatedAt),
    }, { idempotencyKey: `binding-occupied-${suffix}` });
    assert.equal(response.status, 409);
    assert.match(String(response.body.error), /đã được liên kết/);
    const [occupied] = await db.select({ userId: s.drivers.userId })
      .from(s.drivers).where(eq(s.drivers.id, occupiedDriverId)).limit(1);
    assert.equal(occupied!.userId, secondDriverUserId);
  });

  test('binds once, replays exactly, rejects stale/conflicting commands, and never changes credentials', async () => {
    const usersBefore = await db.select({ id: s.users.id, passwordHash: s.users.passwordHash }).from(s.users)
      .where(inArray(s.users.id, userIds));
    const [driverBefore] = await db.select().from(s.drivers).where(eq(s.drivers.id, bindableDriverId)).limit(1);
    const expectedVersion = driverUserBindingVersion(driverBefore!.updatedAt);
    const idempotencyKey = `binding-success-${suffix}`;
    const first = await requestBinding(bindableDriverId, {
      userId: activeDriverUserId,
      expectedVersion,
    }, { idempotencyKey });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.replayed, false);
    assert.equal(first.body.driverId, bindableDriverId);
    assert.equal(first.body.userId, activeDriverUserId);
    assert.ok(Number(first.body.version) > expectedVersion);

    const replay = await requestBinding(bindableDriverId, {
      userId: activeDriverUserId,
      expectedVersion,
    }, { idempotencyKey });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(
      { driverId: replay.body.driverId, userId: replay.body.userId, version: replay.body.version },
      { driverId: first.body.driverId, userId: first.body.userId, version: first.body.version },
    );
    const deniedReplay = await requestBinding(bindableDriverId, {
      userId: activeDriverUserId,
      expectedVersion,
    }, {
      role: Role.MANAGER,
      userId: adminUserId,
      idempotencyKey,
    });
    assert.equal(deniedReplay.status, 403);

    const changedPayload = await requestBinding(bindableDriverId, {
      userId: secondDriverUserId,
      expectedVersion,
    }, { idempotencyKey });
    assert.equal(changedPayload.status, 409);
    const stale = await requestBinding(bindableDriverId, {
      userId: activeDriverUserId,
      expectedVersion,
    }, { idempotencyKey: `binding-stale-${suffix}` });
    assert.equal(stale.status, 409);

    const [driverAfter] = await db.select().from(s.drivers).where(eq(s.drivers.id, bindableDriverId)).limit(1);
    assert.equal(driverAfter!.userId, activeDriverUserId);
    const usersAfter = await db.select({ id: s.users.id, passwordHash: s.users.passwordHash }).from(s.users)
      .where(inArray(s.users.id, userIds));
    assert.deepEqual(
      usersAfter.sort((a, b) => a.id - b.id),
      usersBefore.sort((a, b) => a.id - b.id),
    );
  });

  test('concurrent binding and user deletion cannot leave an active driver bound to a deleted user', async () => {
    const user = await createUser({
      username: `binding-race-${suffix}`,
      password: 'driver-race-password',
      role: Role.DRIVER,
    });
    userIds.push(user.id);
    const [driver] = await db.insert(s.drivers).values({
      name: `Tài xế race ${suffix}`,
      status: 'ACTIVE',
    }).returning();
    driverIds.push(driver.id);

    const [driverBefore] = await db.select().from(s.drivers)
      .where(eq(s.drivers.id, driver.id))
      .limit(1);
    const outcomes = await Promise.allSettled([
      bindDriverUser({
        driverId: driver.id,
        userId: user.id,
        expectedVersion: driverUserBindingVersion(driverBefore!.updatedAt),
        idempotencyKey: `binding-race-${suffix}`,
        actor: { userId: adminUserId, role: Role.ADMIN },
      }),
      deleteUser(user.id, adminUserId),
    ]);
    assert.ok(outcomes.some((result) => result.status === 'fulfilled'));

    const [persistedUser] = await db.select({
      deletedAt: s.users.deletedAt,
    }).from(s.users)
      .where(eq(s.users.id, user.id))
      .limit(1);
    const [persistedDriver] = await db.select({
      userId: s.drivers.userId,
      status: s.drivers.status,
      deletedAt: s.drivers.deletedAt,
    }).from(s.drivers)
      .where(eq(s.drivers.id, driver.id))
      .limit(1);

    assert.ok(
      !(
        persistedUser?.deletedAt != null
        && persistedDriver?.userId === user.id
        && persistedDriver?.deletedAt == null
        && persistedDriver?.status === 'ACTIVE'
      ),
      'deleted user cannot retain an active driver binding',
    );
  });
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(s.idempotencyKeys).where(and(
    eq(s.idempotencyKeys.endpoint, DRIVER_USER_BIND_ENDPOINT),
    inArray(s.idempotencyKeys.createdBy, userIds),
  ));
  await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
  await db.delete(s.drivers).where(inArray(s.drivers.id, driverIds));
  await db.delete(s.users).where(inArray(s.users.id, userIds));
  await client.end();
});
