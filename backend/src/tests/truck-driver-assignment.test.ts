import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import shipmentRoutes from '../routes/shipments';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
import {
  getActiveAssignment,
  getActiveTruckIdForDriver,
  reassignTruckDriver,
  reassignTruckDriverInTx,
} from '../services/truck-driver-assignment.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdUserIds: number[] = [];
const createdDriverIds: number[] = [];
const createdAssignmentIds: number[] = [];
const createdTruckIds: number[] = [];
const createdTrailerIds: number[] = [];

let server: http.Server;
let baseUrl = '';
let adminUserId = 0;
let dispatcherToken = '';
let clerkToken = '';

async function mkUser(role: Role, tag: string) {
  const [user] = await db.insert(s.users).values({
    username: `assign-${tag}-${suffix}-${createdUserIds.length}`,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

function signToken(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign({
    userId: user.id,
    username: user.username ?? `user-${user.id}`,
    email: null,
    fullName: null,
    role: user.role as Role,
    customerId: null,
    customerIds: [],
  }, config.jwtSecret);
}

function authUser(user: { id: number; username: string | null; role: Role }) {
  return {
    userId: user.id,
    username: user.username ?? '',
    role: user.role,
    email: null,
    fullName: null,
    customerId: null,
    customerIds: [] as number[],
  };
}

async function createTruck() {
  const plateSuffix = `${suffix.slice(-6)}${String(createdTruckIds.length).padStart(2, '0')}`;
  const [trailer] = await db.insert(s.trailers).values({
    licensePlate: `51R-${plateSuffix}`.slice(0, 20),
    type: '20FT',
    status: 'ACTIVE',
  }).returning();
  createdTrailerIds.push(trailer.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `51C-${plateSuffix}`.slice(0, 20),
    currentTrailerId: trailer.id,
    trailerType: '20FT',
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(truck.id);
  return truck;
}

async function createDriver(tag: string) {
  const user = await mkUser(Role.DRIVER, tag);
  const [driver] = await db.insert(s.drivers).values({
    userId: user.id,
    name: `Assign driver ${tag} ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  createdDriverIds.push(driver.id);
  return { user, driver };
}

async function activeRows(truckId: number) {
  return db.select().from(s.truckDriverAssignments)
    .where(and(
      eq(s.truckDriverAssignments.truckId, truckId),
      isNull(s.truckDriverAssignments.endsAt),
      eq(s.truckDriverAssignments.role, 'PRIMARY'),
    ));
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/shipments', authMiddleware, auditLogMiddleware, casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(Role.ADMIN, 'admin');
  adminUserId = admin.id;
  dispatcherToken = signToken(await mkUser(Role.DISPATCHER, 'dispatcher'));
  clerkToken = signToken(await mkUser(Role.CUS, 'clerk'));
});

after(async () => {
  if (server.listening) {
    // fetch() keep-alive sockets would otherwise hold server.close() open.
    server.closeAllConnections?.();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  try {
    if (createdAssignmentIds.length > 0) {
      await db.delete(s.truckDriverAssignments).where(inArray(s.truckDriverAssignments.id, createdAssignmentIds));
    }
    if (createdDriverIds.length > 0) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdTrailerIds.length > 0) await db.delete(s.trailers).where(inArray(s.trailers.id, createdTrailerIds));
    if (createdUserIds.length > 0) {
      await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, createdUserIds));
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    }
  } finally {
    await disconnectRedis();
    await client.end();
  }
});

describe('truck driver assignment service', () => {
  test('reassign closes the old row and opens the new one; reads are deterministic', async () => {
    const truck = await createTruck();
    const { user: userA, driver: driverA } = await createDriver('a');
    const { driver: driverB } = await createDriver('b');
    void userA;

    await reassignTruckDriver(authUser({ id: adminUserId, username: null, role: Role.ADMIN }), {
      truckId: truck.id,
      driverId: driverA.id,
    });

    const rowsA = await activeRows(truck.id);
    assert.equal(rowsA.length, 1);
    assert.equal(rowsA[0]!.driverId, driverA.id);
    const created = rowsA[0]!;
    createdAssignmentIds.push(created.id);

    const active = await getActiveAssignment(db, truck.id);
    assert.equal(active?.driverId, driverA.id);
    assert.equal(active?.driverName, driverA.name);
    assert.equal(active?.driverUserId, (await db.select({ userId: s.drivers.userId }).from(s.drivers).where(eq(s.drivers.id, driverA.id)))[0]!.userId);

    // Reassign to B: A's row ends, B's row becomes the single active one.
    const outcome = await reassignTruckDriver(authUser({ id: adminUserId, username: null, role: Role.ADMIN }), {
      truckId: truck.id,
      driverId: driverB.id,
    });
    assert.equal(outcome.previousDriverId, driverA.id);

    const [endedA] = await db.select().from(s.truckDriverAssignments).where(eq(s.truckDriverAssignments.id, created.id));
    assert.ok(endedA.endsAt != null, 'old assignment row must be ended');

    const rowsB = await activeRows(truck.id);
    assert.equal(rowsB.length, 1, 'exactly one active row after reassign');
    assert.equal(rowsB[0]!.driverId, driverB.id);
    createdAssignmentIds.push(rowsB[0]!.id);

    // Driver-facing inverse read follows the move.
    assert.equal(await getActiveTruckIdForDriver(db, driverB.id), truck.id);
    assert.equal(await getActiveTruckIdForDriver(db, driverA.id), null);
  });

  test('reassign to the same driver is a no-op; null unassigns', async () => {
    const truck = await createTruck();
    const { driver } = await createDriver('same');
    const actor = authUser({ id: adminUserId, username: null, role: Role.ADMIN });

    await reassignTruckDriver(actor, { truckId: truck.id, driverId: driver.id });
    const rows = await activeRows(truck.id);
    assert.equal(rows.length, 1);
    createdAssignmentIds.push(rows[0]!.id);

    const noop = await reassignTruckDriver(actor, { truckId: truck.id, driverId: driver.id });
    assert.equal(noop.previousDriverId, driver.id);
    assert.equal((await activeRows(truck.id)).length, 1, 'same-driver reassign must not add rows');

    await reassignTruckDriver(actor, { truckId: truck.id, driverId: null });
    assert.equal((await activeRows(truck.id)).length, 0, 'null driverId ends the assignment');
  });

  test('role gate rejects non-dispatch actors with 403', async () => {
    const truck = await createTruck();
    const { driver } = await createDriver('gated');
    await assert.rejects(
      () => reassignTruckDriver(authUser({ id: 1, username: null, role: Role.CUS }), {
        truckId: truck.id,
        driverId: driver.id,
      }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 403,
    );
  });

  test('invalid truck or driver is rejected with 400', async () => {
    const { driver } = await createDriver('invalid-truck');
    const actor = authUser({ id: adminUserId, username: null, role: Role.ADMIN });
    await assert.rejects(
      () => reassignTruckDriver(actor, { truckId: 99999999, driverId: driver.id }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 400,
    );
    const truck = await createTruck();
    await assert.rejects(
      () => reassignTruckDriver(actor, { truckId: truck.id, driverId: 99999999 }),
      (error: unknown) => error instanceof ApiError && error.statusCode === 400,
    );
  });

  test('two lockless concurrent reassignments serialize safely — invariant holds, no raw 500', async () => {
    const truck = await createTruck();
    const { driver: driverA } = await createDriver('race-a');
    const { driver: driverB } = await createDriver('race-b');

    // Race both reassignments with the advisory lock skipped. The in-tx
    // SELECT ... FOR UPDATE re-evaluates against the winner's commit, so the
    // loser supersedes rather than colliding — either order leaves exactly
    // one active row and neither caller sees a raw Postgres error. (The
    // service's 23505→409 translation stays as defense-in-depth for paths
    // that bypass this ordering entirely.)
    const results = await Promise.allSettled([
      db.transaction((tx) => reassignTruckDriverInTx(tx, {
        truckId: truck.id, driverId: driverA.id, createdBy: adminUserId, skipAdvisoryLock: true,
      })),
      db.transaction((tx) => reassignTruckDriverInTx(tx, {
        truckId: truck.id, driverId: driverB.id, createdBy: adminUserId, skipAdvisoryLock: true,
      })),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        // Any failure must be a translated ApiError, never a raw driver error.
        assert.ok(result.reason instanceof ApiError, `unexpected raw error: ${String(result.reason)}`);
      }
    }

    const rows = await activeRows(truck.id);
    assert.equal(rows.length, 1, 'exactly one active row must survive the race');
    assert.ok(
      rows[0]!.driverId === driverA.id || rows[0]!.driverId === driverB.id,
      'the surviving assignment must belong to one of the racers',
    );
    createdAssignmentIds.push(rows[0]!.id);
  });

  test('a raw duplicate active insert raises the 23505 code the service translates', async () => {
    const truck = await createTruck();
    const { driver: driverA } = await createDriver('dup-a');
    const { driver: driverB } = await createDriver('dup-b');
    const [first] = await db.insert(s.truckDriverAssignments).values({
      truckId: truck.id, driverId: driverA.id, role: 'PRIMARY',
    }).returning();
    createdAssignmentIds.push(first.id);

    // The partial unique index is the last-line guard — this raw insert is
    // the exact failure shape reassignTruckDriverInTx's catch keys on.
    await assert.rejects(
      () => db.insert(s.truckDriverAssignments).values({
        truckId: truck.id, driverId: driverB.id, role: 'PRIMARY',
      }),
      (error: unknown) => {
        const candidate = error as { code?: string; cause?: { code?: string } };
        return candidate.code === '23505' || candidate.cause?.code === '23505';
      },
    );
  });

  test('move semantics: a driver reassigned to a new truck leaves their old truck', async () => {
    const truckOne = await createTruck();
    const truckTwo = await createTruck();
    const { driver } = await createDriver('move');
    const actor = authUser({ id: adminUserId, username: null, role: Role.ADMIN });

    await reassignTruckDriver(actor, { truckId: truckOne.id, driverId: driver.id });
    // Reassign the same driver to a second truck: the old row must end —
    // one active PRIMARY per driver, matching the legacy single-value column.
    await reassignTruckDriver(actor, { truckId: truckTwo.id, driverId: driver.id });

    assert.equal((await activeRows(truckOne.id)).length, 0, 'old truck must lose the driver');
    const rowsOnTwo = await activeRows(truckTwo.id);
    assert.equal(rowsOnTwo.length, 1);
    assert.equal(rowsOnTwo[0]!.driverId, driver.id);
    createdAssignmentIds.push(rowsOnTwo[0]!.id);

    const [driverRow] = await db.select({ assignedTruckId: s.drivers.assignedTruckId })
      .from(s.drivers).where(eq(s.drivers.id, driver.id));
    assert.equal(driverRow.assignedTruckId, truckTwo.id, 'legacy mirror must follow the move');

    const [orphan] = await db.select({ id: s.truckDriverAssignments.id })
      .from(s.truckDriverAssignments)
      .where(and(
        eq(s.truckDriverAssignments.driverId, driver.id),
        isNull(s.truckDriverAssignments.endsAt),
        ne(s.truckDriverAssignments.truckId, truckTwo.id),
      ));
    assert.equal(orphan, undefined, 'no second active row for the driver anywhere');
  });

  test('the per-driver partial unique index rejects a second active row for one driver', async () => {
    const truckOne = await createTruck();
    const truckTwo = await createTruck();
    const { driver } = await createDriver('per-driver');
    const [first] = await db.insert(s.truckDriverAssignments).values({
      truckId: truckOne.id, driverId: driver.id, role: 'PRIMARY',
    }).returning();
    createdAssignmentIds.push(first.id);

    await assert.rejects(
      () => db.insert(s.truckDriverAssignments).values({
        truckId: truckTwo.id, driverId: driver.id, role: 'PRIMARY',
      }),
      (error: unknown) => {
        const candidate = error as { code?: string; cause?: { code?: string } };
        return candidate.code === '23505' || candidate.cause?.code === '23505';
      },
    );
  });

  test('route: dispatcher reassigns via PATCH, CUS is forbidden', async () => {
    const truck = await createTruck();
    const { driver } = await createDriver('route');

    const forbidden = await fetch(`${baseUrl}/api/shipments/dispatch-fleet/trucks/${truck.id}/assigned-driver`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
        'Idempotency-Key': `assign-route-${suffix}-forbidden`,
      },
      body: JSON.stringify({ driverId: driver.id }),
    });
    assert.equal(forbidden.status, 403);

    // Omitting the key is a client bug — not a request to unassign.
    const missingKey = await fetch(`${baseUrl}/api/shipments/dispatch-fleet/trucks/${truck.id}/assigned-driver`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
        'Idempotency-Key': `assign-route-${suffix}-missing`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(missingKey.status, 400);

    const ok = await fetch(`${baseUrl}/api/shipments/dispatch-fleet/trucks/${truck.id}/assigned-driver`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${dispatcherToken}`,
        'Idempotency-Key': `assign-route-${suffix}-ok`,
      },
      body: JSON.stringify({ driverId: driver.id }),
    });
    const body = await ok.json().catch(() => ({})) as { truckId?: number; driverId?: number; previousDriverId?: number | null };
    assert.equal(ok.status, 200, JSON.stringify(body));
    assert.equal(body.truckId, truck.id);
    assert.equal(body.driverId, driver.id);
    assert.equal(body.previousDriverId, null);

    const rows = await activeRows(truck.id);
    assert.equal(rows.length, 1);
    createdAssignmentIds.push(rows[0]!.id);
  });
});
