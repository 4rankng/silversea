import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { Role, TripStatus } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { initAuditService } from '../services/audit.service';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import tripRoutes from '../routes/trips';
import { applyTripPairLifecycleEffects, createTripPair } from '../services/trip-pairs.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;
let adminToken: string;
let managerToken: string;
let forwarderToken: string;
let actorUserId = 0;

const createdTripIds: number[] = [];
const createdPairIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function mkTrip(status: TripStatus, departureDate: string) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `PAIR-${suffix}-${createdTripIds.length + 1}`,
    customerId: createdCustomerIds[0],
    truckId: createdTruckIds[0],
    driverId: createdDriverIds[0],
    routeId: createdRouteIds[0],
    cargoTypeId: createdCargoTypeIds[0],
    status,
    departureDate,
    carrierType: 'OWN',
    revenue: '1500000',
    totalCost: '900000',
    driverSalary: '350000',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function testFetch(path: string, options: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${baseUrl}/api/trips${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

before(async () => {
  await initAuditService();
  await initEnforcer();

  const app = express();
  app.use(express.json());
  app.use('/api/trips', authMiddleware, casbinAuthz('trips'), tripRoutes);
  app.use(globalErrorHandler);

  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const admin = await mkUser(`pair-admin-${suffix}`, Role.ADMIN);
  const manager = await mkUser(`pair-manager-${suffix}`, Role.MANAGER);
  const forwarder = await mkUser(`pair-forwarder-${suffix}`, Role.FORWARDER);
  adminToken = sign(admin);
  managerToken = sign(manager);
  forwarderToken = sign(forwarder);
  actorUserId = admin.id;

  const [customer] = await db.insert(s.customers).values({ name: `Pair customer ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `Pair route ${suffix}`,
    distanceKm: 120,
  }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Pair cargo ${suffix}` }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const [truck] = await db.insert(s.trucks).values({ licensePlate: `51D-${Math.floor(Math.random() * 9000 + 1000)}` }).returning();
  createdTruckIds.push(truck.id);
  const [driver] = await db.insert(s.drivers).values({ name: `Pair driver ${suffix}`, assignedTruckId: truck.id }).returning();
  createdDriverIds.push(driver.id);
});

after(async () => {
  if (createdTripIds.length > 0) {
    await db.update(s.trips).set({
      activeTripPairId: null,
      activeTripPairOrder: null,
    }).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdPairIds.length > 0) {
    await db.delete(s.tripPairs).where(inArray(s.tripPairs.id, createdPairIds));
  }
  if (createdTripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdDriverIds.length > 0) {
    await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
  }
  if (createdTruckIds.length > 0) {
    await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  }
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('O01 two-way dispatch pairing routes', () => {
  test('ADMIN can create a valid pair and duplicate pairing is rejected', async () => {
    const first = await mkTrip(TripStatus.CREATED, '2026-07-27');
    const second = await mkTrip(TripStatus.CREATED, '2026-07-28');

    const payload = {
      firstTripId: first.id,
      secondTripId: second.id,
      firstTrip: {
        plannedStartAt: '2026-07-27T08:00:00',
        plannedEndAt: '2026-07-27T12:00:00',
        canonicalOrigin: 'Cat Lai',
        canonicalDestination: 'Binh Duong',
        cargoWeightKg: 12000,
        vehicleCapacityKg: 18000,
        expectedVersion: first.version,
      },
      secondTrip: {
        plannedStartAt: '2026-07-28T09:30:00',
        plannedEndAt: '2026-07-28T13:30:00',
        canonicalOrigin: 'Binh Duong',
        canonicalDestination: 'Cat Lai',
        cargoWeightKg: 11000,
        vehicleCapacityKg: 18000,
        expectedVersion: second.version,
      },
    };

    const created = await testFetch('/pairs', { method: 'POST', token: adminToken, body: payload });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'ACTIVE');
    assert.equal(created.data.firstTripId, first.id);
    createdPairIds.push(created.data.id);

    const duplicate = await testFetch('/pairs', { method: 'POST', token: adminToken, body: payload });
    assert.equal(duplicate.status, 409);
  });

  test('FORWARDER is denied and overlap is blocked clearly', async () => {
    const first = await mkTrip(TripStatus.CREATED, '2026-07-27');
    const second = await mkTrip(TripStatus.CREATED, '2026-07-27');

    const payload = {
      firstTripId: first.id,
      secondTripId: second.id,
      firstTrip: {
        plannedStartAt: '2026-07-27T08:00:00',
        plannedEndAt: '2026-07-27T12:00:00',
        canonicalOrigin: 'Cat Lai',
        canonicalDestination: 'Binh Duong',
        cargoWeightKg: 12000,
        vehicleCapacityKg: 18000,
        expectedVersion: first.version,
      },
      secondTrip: {
        plannedStartAt: '2026-07-27T11:00:00',
        plannedEndAt: '2026-07-27T16:00:00',
        canonicalOrigin: 'Binh Duong',
        canonicalDestination: 'Cat Lai',
        cargoWeightKg: 11000,
        vehicleCapacityKg: 18000,
        expectedVersion: second.version,
      },
    };

    const denied = await testFetch('/pairs', { method: 'POST', token: forwarderToken, body: payload });
    assert.equal(denied.status, 403);

    const blocked = await testFetch('/pairs', { method: 'POST', token: managerToken, body: payload });
    assert.equal(blocked.status, 422);
    assert.match(String(blocked.data.error ?? ''), /chồng thời gian/i);
  });

  test('cancellation and late completion break the persisted pair without deleting the surviving trip', async () => {
    const cancelFirst = await mkTrip(TripStatus.CREATED, '2026-07-27');
    const cancelSecond = await mkTrip(TripStatus.CREATED, '2026-07-28');
    const createdPair = await createTripPair({
      firstTripId: cancelFirst.id,
      secondTripId: cancelSecond.id,
      firstTrip: {
        plannedStartAt: '2026-07-27T08:00:00',
        plannedEndAt: '2026-07-27T12:00:00',
        canonicalOrigin: 'Cat Lai',
        canonicalDestination: 'Binh Duong',
        cargoWeightKg: 12000,
        vehicleCapacityKg: 18000,
        expectedVersion: cancelFirst.version,
      },
      secondTrip: {
        plannedStartAt: '2026-07-28T09:00:00',
        plannedEndAt: '2026-07-28T13:00:00',
        canonicalOrigin: 'Binh Duong',
        canonicalDestination: 'Cat Lai',
        cargoWeightKg: 11000,
        vehicleCapacityKg: 18000,
        expectedVersion: cancelSecond.version,
      },
    }, actorUserId);
    createdPairIds.push(createdPair.id);

    const canceled = await testFetch(`/${cancelFirst.id}/cancel`, { method: 'POST', token: managerToken, body: {} });
    assert.equal(canceled.status, 200);
    const [cancelPairRow] = await db.select().from(s.tripPairs).where(eq(s.tripPairs.id, createdPair.id)).limit(1);
    assert.equal(cancelPairRow?.status, 'BROKEN');
    assert.equal(cancelPairRow?.breakReason, 'FIRST_TRIP_CANCELED');
    const [survivor] = await db.select({ activeTripPairId: s.trips.activeTripPairId }).from(s.trips).where(eq(s.trips.id, cancelSecond.id)).limit(1);
    assert.equal(survivor?.activeTripPairId, null);

    const lateFirst = await mkTrip(TripStatus.IN_TRANSIT, '2026-07-27');
    const lateSecond = await mkTrip(TripStatus.CREATED, '2026-07-27');
    const latePair = await createTripPair({
      firstTripId: lateFirst.id,
      secondTripId: lateSecond.id,
      firstTrip: {
        plannedStartAt: '2026-07-27T08:00:00',
        plannedEndAt: '2026-07-27T12:00:00',
        canonicalOrigin: 'Cat Lai',
        canonicalDestination: 'Binh Duong',
        cargoWeightKg: 12000,
        vehicleCapacityKg: 18000,
        expectedVersion: lateFirst.version,
      },
      secondTrip: {
        plannedStartAt: '2026-07-27T13:00:00',
        plannedEndAt: '2026-07-27T16:00:00',
        canonicalOrigin: 'Binh Duong',
        canonicalDestination: 'Cat Lai',
        cargoWeightKg: 11000,
        vehicleCapacityKg: 18000,
        expectedVersion: lateSecond.version,
      },
    }, actorUserId);
    createdPairIds.push(latePair.id);

    await db.update(s.trips).set({
      completedAt: new Date('2026-07-27T12:50:00'),
      status: TripStatus.COMPLETED,
    }).where(eq(s.trips.id, lateFirst.id));

    await db.transaction(async (tx) => {
      await applyTripPairLifecycleEffects(tx, {
        tripId: lateFirst.id,
        activeTripPairId: latePair.id,
        activeTripPairOrder: 1,
        targetStatus: TripStatus.COMPLETED,
        actorId: actorUserId,
        completedAt: new Date('2026-07-27T12:50:00'),
      });
    });

    const [latePairRow] = await db.select().from(s.tripPairs).where(eq(s.tripPairs.id, latePair.id)).limit(1);
    assert.equal(latePairRow?.status, 'BROKEN');
    assert.equal(latePairRow?.breakReason, 'LATE_COMPLETION');
    const [lateSecondRow] = await db.select({ activeTripPairId: s.trips.activeTripPairId }).from(s.trips).where(eq(s.trips.id, lateSecond.id)).limit(1);
    assert.equal(lateSecondRow?.activeTripPairId, null);
  });
});
