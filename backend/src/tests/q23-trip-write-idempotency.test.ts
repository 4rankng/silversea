import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Role, TripStatus } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { auditLogMiddleware } from '../middleware/audit';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import tripRoutes from '../routes/trips';
import { initAuditService } from '../services/audit.service';
import {
  copyTripWriteCommand,
  createTripWriteCommand,
  transitionTripWriteCommand,
  type TripCommandDeps,
} from '../services/trip-command.service';
import {
  deleteTrip,
  reassignTrip,
  updateDepartureDate,
} from '../services/trip-mutations.service';
import { batchUpsertTripContainers } from '../services/forwarder-container.service';
import { upsertTripInstructions } from '../services/trip-instructions.service';

const tripIds: number[] = [];
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const containerTypeIds: number[] = [];
const userIds: number[] = [];
const keys: string[] = [];
const auditLogIds: number[] = [];

after(async () => {
  if (keys.length > 0) {
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.idempotencyKey, keys));
  }
  if (auditLogIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.id, auditLogIds));
  }
  if (userIds.length > 0) {
    await db.delete(s.auditLogs).where(inArray(s.auditLogs.userId, userIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'trips'),
      inArray(s.notifications.relatedEntityId, tripIds),
    ));
    await db.delete(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds));
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, tripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, tripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  if (customerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  if (routeIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  if (containerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, containerTypeIds));
  }
  if (cargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  await disconnectRedis();
  await client.end();
});

async function fixtureTrip(status: TripStatus = TripStatus.CREATED) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers).values({ name: `Q23 customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `Q23 route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Q23 cargo ${suffix}` }).returning();
  const [user] = await db.insert(s.users).values({
    username: `q23-trip-${suffix}`,
    passwordHash: 'x',
    role: Role.MANAGER,
  }).returning();
  const trip = await insertTripComposite(db, {
    tripCode: `Q23-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status,
    version: 1,
    departureDate: '2026-07-27',
    revenue: '1000000',
    totalFuelCost: '200000',
    totalRoadAllowance: '100000',
    totalCost: '300000',
    grossProfit: '700000',
    driverSalary: '100000',
  });
  customerIds.push(customer.id);
  routeIds.push(route.id);
  cargoTypeIds.push(cargoType.id);
  userIds.push(user.id);
  tripIds.push(trip.id);
  return { trip, user };
}

async function waitForTripCreateAudits(userId: number, expectedCount: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rows = await db.select().from(s.auditLogs)
      .where(eq(s.auditLogs.userId, userId))
      .orderBy(desc(s.auditLogs.id))
      .limit(10);
    const matches = rows.filter((row) => {
      const payload = row.payload as Record<string, unknown>;
      return payload.event === 'TRIP_CREATED'
        && payload.path === '/api/trips';
    });
    if (matches.length >= expectedCount) {
      for (const row of matches) {
        if (!auditLogIds.includes(row.id)) auditLogIds.push(row.id);
      }
      return matches;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return [];
}

describe('Q23 trip write contracts', () => {
  test('binds created and replayed trip-create audits to the returned trip id', async () => {
    await initAuditService();
    const { trip: source, user } = await fixtureTrip();
    const key = `q23-create-audit-${source.id}`;
    keys.push(key);

    const app = express();
    app.use(express.json());
    app.use('/api/trips', (req, _res, next) => {
      req.user = {
        userId: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: Role.MANAGER,
      };
      next();
    });
    app.use(auditLogMiddleware);
    app.use('/api/trips', tripRoutes);
    app.use(globalErrorHandler);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [containerType] = await db.insert(s.containerTypes).values({
      code: `Q23A${source.id}`,
      name: `Q23 audit container ${source.id}`,
    }).returning();
    containerTypeIds.push(containerType.id);
    const [carrier] = await db.insert(s.customers).values({
      name: `Q23 audit carrier ${source.id}`,
      isCarrier: true,
    }).returning();
    customerIds.push(carrier.id);
    const body = {
      customerId: source.customerId,
      routeId: source.routeId,
      cargoTypeId: source.cargoTypeId,
      containerTypeId: containerType.id,
      departureDate: source.departureDate,
      carrierType: 'EXTERNAL',
      externalCarrierId: carrier.id,
    };

    try {
      const post = () => fetch(`${baseUrl}/api/trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify(body),
      });
      const firstResponse = await post();
      const first = await firstResponse.json() as Record<string, unknown>;
      const replayResponse = await post();
      const replay = await replayResponse.json() as Record<string, unknown>;

      assert.equal(firstResponse.status, 201);
      assert.equal(first.replayed, false);
      assert.equal(replayResponse.status, 201);
      assert.equal(replay.replayed, true);
      assert.equal(replay.id, first.id);

      const tripId = Number(first.id);
      tripIds.push(tripId);
      const audits = await waitForTripCreateAudits(user.id, 2);
      assert.equal(audits.length, 2);
      assert.deepEqual(
        audits.map((row) => row.entityId),
        [tripId, tripId],
      );
      assert.deepEqual(
        audits.map((row) => (row.payload as Record<string, unknown>).outcome).sort(),
        ['REPLAYED', 'SUCCEEDED'],
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  test('deduplicates keyed create and copy effects while preserving no-key commands', async () => {
    const { trip: source, user } = await fixtureTrip();
    const createKey = `q23-create-${source.id}`;
    const copyKey = `q23-copy-${source.id}`;
    keys.push(createKey, copyKey);
    let createCalls = 0;
    let copyCalls = 0;
    let invalidations = 0;
    let notifications = 0;
    const insertTrip = async (
      tx: Parameters<TripCommandDeps['createTrip']>[1],
      prefix: string,
    ) => {
      const [created] = await tx!.insert(s.trips).values({
        tripCode: `${prefix}-${source.id}-${Date.now()}`.slice(0, 50),
        customerId: source.customerId,
        routeId: source.routeId,
        cargoTypeId: source.cargoTypeId,
        status: TripStatus.CREATED,
        version: 1,
        departureDate: source.departureDate,
      }).returning();
      tripIds.push(created.id);
      return created;
    };
    const deps = {
      createTrip: async (_data: unknown, tx: Parameters<TripCommandDeps['createTrip']>[1]) => {
        createCalls += 1;
        return tx
          ? insertTrip(tx, 'Q23-CREATE')
          : db.transaction((transaction) => insertTrip(transaction, 'Q23-CREATE'));
      },
      copyTrip: async (_id: number, _userId: number, tx: Parameters<TripCommandDeps['copyTrip']>[2]) => {
        copyCalls += 1;
        return insertTrip(tx, 'Q23-COPY');
      },
      transitionTripStatus: async () => { throw new Error('not used'); },
      syncAttendanceAfterStatusChange: async () => { throw new Error('not used'); },
      invalidateReports: async () => { invalidations += 1; },
      emitNotification: () => { notifications += 1; },
    } as unknown as TripCommandDeps;
    const actor = { userId: user.id, role: Role.MANAGER };
    const createData = {
      customerId: source.customerId,
      routeId: source.routeId,
      cargoTypeId: source.cargoTypeId,
      containerTypeId: 1,
      departureDate: source.departureDate,
    };

    const creates = await Promise.all([
      createTripWriteCommand(createData, actor, createKey, deps),
      createTripWriteCommand(createData, actor, createKey, deps),
    ]);
    assert.equal(createCalls, 1);
    assert.deepEqual(creates.map((item) => item.replayed).sort(), [false, true]);

    const firstCopy = await copyTripWriteCommand(source.id, actor, copyKey, deps);
    const replayedCopy = await copyTripWriteCommand(source.id, actor, copyKey, deps);
    assert.equal(copyCalls, 1);
    assert.equal(firstCopy.replayed, false);
    assert.equal(replayedCopy.replayed, true);
    assert.equal(invalidations, 2);
    assert.equal(notifications, 2);

    const noKey = await createTripWriteCommand(createData, actor, undefined, deps);
    assert.equal(noKey.replayed, false);
    assert.equal(createCalls, 2);
  });

  test('serializes concurrent keyed dispatch and executes one status/version change', async () => {
    const { trip, user } = await fixtureTrip();
    const key = `q23-dispatch-${trip.id}`;
    keys.push(key);
    const actor = { userId: user.id, role: Role.MANAGER };

    const outcomes = await Promise.all([
      transitionTripWriteCommand({
        tripId: trip.id,
        targetStatus: TripStatus.IN_TRANSIT,
        actor,
        idempotencyKey: key,
        expectedVersion: 1,
      }),
      transitionTripWriteCommand({
        tripId: trip.id,
        targetStatus: TripStatus.IN_TRANSIT,
        actor,
        idempotencyKey: key,
        expectedVersion: 1,
      }),
    ]);

    assert.deepEqual(outcomes.map((item) => item.replayed).sort(), [false, true]);
    const [stored] = await db.select({
      status: s.trips.status,
      version: s.trips.version,
    }).from(s.trips).where(eq(s.trips.id, trip.id));
    assert.equal(stored.status, TripStatus.IN_TRANSIT);
    assert.equal(stored.version, 2);
  });

  test('rejects a reused key with a different payload', async () => {
    const { trip, user } = await fixtureTrip();
    const key = `q23-key-conflict-${trip.id}`;
    keys.push(key);
    const actor = { userId: user.id, role: Role.MANAGER };
    await transitionTripWriteCommand({
      tripId: trip.id,
      targetStatus: TripStatus.IN_TRANSIT,
      actor,
      idempotencyKey: key,
      expectedVersion: 1,
    });

    await assert.rejects(
      transitionTripWriteCommand({
        tripId: trip.id,
        targetStatus: TripStatus.IN_TRANSIT,
        actor,
        idempotencyKey: key,
        expectedVersion: 2,
      }),
      /Khóa giao dịch trùng nhưng nội dung khác/,
    );
  });

  test('rolls back the key when the lifecycle command fails', async () => {
    const { trip, user } = await fixtureTrip(TripStatus.COMPLETED);
    const key = `q23-rollback-${trip.id}`;
    keys.push(key);
    const actor = { userId: user.id, role: Role.MANAGER };
    const command = () => transitionTripWriteCommand({
      tripId: trip.id,
      targetStatus: TripStatus.CANCELED,
      actor,
      idempotencyKey: key,
    });

    // O2C: a completed trip is terminal; canceling it requires the governed
    // request path, so a direct cancel is rejected.
    await assert.rejects(command(), /Thiếu yêu cầu quản trị đã được phê duyệt|chỉ được.*yêu cầu/i);
    const [recordAfterFailure] = await db.select().from(s.idempotencyKeys)
      .where(eq(s.idempotencyKeys.idempotencyKey, key));
    assert.equal(recordAfterFailure, undefined);

    await db.update(s.trips).set({ status: TripStatus.CREATED }).where(eq(s.trips.id, trip.id));
    const retried = await command();
    assert.equal(retried.replayed, false);
    assert.equal(retried.trip.status, TripStatus.CANCELED);
  });

  test('rejects direct completed-trip cancellation before any financial mutation', async () => {
    const { trip, user } = await fixtureTrip(TripStatus.COMPLETED);
    const actor = { userId: user.id, role: Role.MANAGER };
    const keyA = `q23-cancel-a-${trip.id}`;
    const keyB = `q23-cancel-b-${trip.id}`;
    keys.push(keyA, keyB);

    const settled = await Promise.allSettled([
      transitionTripWriteCommand({
        tripId: trip.id,
        targetStatus: TripStatus.CANCELED,
        actor,
        idempotencyKey: keyA,
      }),
      transitionTripWriteCommand({
        tripId: trip.id,
        targetStatus: TripStatus.CANCELED,
        actor,
        idempotencyKey: keyB,
      }),
    ]);
    assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 0);
    assert.equal(settled.filter((item) => item.status === 'rejected').length, 2);

    const [stored] = await db.select().from(s.tripsComposite).where(eq(s.tripsComposite.id, trip.id));
    assert.equal(stored.status, TripStatus.COMPLETED);
    assert.equal(stored.revenue, trip.revenue);
    assert.equal(stored.totalFuelCost, trip.totalFuelCost);
    assert.equal(stored.totalRoadAllowance, trip.totalRoadAllowance);
    assert.equal(stored.totalCost, trip.totalCost);
    assert.equal(stored.grossProfit, trip.grossProfit);
    assert.equal(stored.driverSalary, trip.driverSalary);
  });

  test('rejects stale reassignment, departure, and delete before mutation', async () => {
    const { trip } = await fixtureTrip();
    const reassigned = await reassignTrip(trip.id, {
      carrierType: 'EXTERNAL',
      externalPlateNumber: '51C-12345',
      expectedVersion: 1,
    });
    assert.equal(reassigned.version, 2);

    await assert.rejects(
      updateDepartureDate(trip.id, '2026-07-28', 1, Role.MANAGER, 1),
      /Dữ liệu đã bị thay đổi/,
    );
    await assert.rejects(deleteTrip(trip.id, 1), /Dữ liệu đã bị thay đổi/);
    const [stored] = await db.select().from(s.tripsComposite).where(eq(s.trips.id, trip.id));
    assert.equal(stored.departureDate, '2026-07-27');
    assert.equal(stored.deletedAt, null);
  });

  test('serializes container and instruction replacements on the trip version', async () => {
    const { trip, user } = await fixtureTrip();
    const containers = await batchUpsertTripContainers(
      trip.id,
      user.id,
      [{ containerNumber: 'TCLU1234567' }],
      1,
    );
    assert.equal(containers.length, 1);

    await assert.rejects(
      batchUpsertTripContainers(
        trip.id,
        user.id,
        [{ containerNumber: 'STALE0000001' }],
        1,
      ),
      /Dữ liệu đã bị thay đổi/,
    );
    await upsertTripInstructions(
      trip.id,
      { notes: 'Chỉ dẫn mới', expectedVersion: 2 },
      user.id,
    );
    await assert.rejects(
      upsertTripInstructions(
        trip.id,
        { notes: 'Chỉ dẫn cũ', expectedVersion: 2 },
        user.id,
      ),
      /Dữ liệu đã bị thay đổi/,
    );

    const [storedContainer] = await db.select().from(s.tripContainers)
      .where(eq(s.tripContainers.tripId, trip.id));
    const [storedInstruction] = await db.select({ notes: s.trips.instructionNotes }).from(s.trips)
      .where(eq(s.trips.id, trip.id));
    const [storedTrip] = await db.select({ version: s.trips.version }).from(s.trips)
      .where(eq(s.trips.id, trip.id));
    assert.equal(storedContainer.containerNumber, 'TCLU1234567');
    assert.equal(storedInstruction.notes, 'Chỉ dẫn mới');
    assert.equal(storedTrip.version, 3);
  });
});
