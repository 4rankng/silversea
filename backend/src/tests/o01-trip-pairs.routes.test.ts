import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { Role, TripStatus } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { applyTripPatch, insertTripComposite } from '../services/trip-composite.service';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import tripRoutes from '../routes/trips';
import { applyTripPairLifecycleEffects, createTripPair } from '../services/trip-pairs.service';
import { getPairSalarySettingsFrom, savePairSalarySettings } from '../services/pair-salary-settings.service';
import { disconnectRedis } from '../lib/redis';

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
const createdIdempotencyKeys: string[] = [];
let requestCounter = 0;

type TripAuthoritySeed = {
  plannedStartAt: string;
  plannedEndAt: string;
  canonicalOrigin: string;
  canonicalDestination: string;
  cargoWeightKg: number;
  vehicleCapacityKg: number;
};

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

function pairDraft(seed: TripAuthoritySeed, expectedVersion: number) {
  return {
    plannedStartAt: seed.plannedStartAt,
    plannedEndAt: seed.plannedEndAt,
    canonicalOrigin: seed.canonicalOrigin,
    canonicalDestination: seed.canonicalDestination,
    cargoWeightKg: seed.cargoWeightKg,
    vehicleCapacityKg: seed.vehicleCapacityKg,
    expectedVersion,
  };
}

async function readTripAuthority(tripId: number) {
  const [trip] = await db.select({
    plannedStartAt: s.trips.plannedStartAt,
    plannedEndAt: s.trips.plannedEndAt,
    canonicalOrigin: s.trips.canonicalOrigin,
    canonicalDestination: s.trips.canonicalDestination,
    cargoWeightKg: s.trips.cargoWeightKg,
    vehicleCapacityKg: s.trips.vehicleCapacityKg,
    activeTripPairId: s.trips.activeTripPairId,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  return trip;
}

async function mkTrip(
  status: TripStatus,
  departureDate: string,
  authority?: Partial<TripAuthoritySeed>,
) {
  const trip = await insertTripComposite(db, {
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
    plannedStartAt: authority?.plannedStartAt ? new Date(authority.plannedStartAt) : null,
    plannedEndAt: authority?.plannedEndAt ? new Date(authority.plannedEndAt) : null,
    canonicalOrigin: authority?.canonicalOrigin ?? null,
    canonicalDestination: authority?.canonicalDestination ?? null,
    cargoWeightKg: authority?.cargoWeightKg != null ? String(authority.cargoWeightKg) : null,
    vehicleCapacityKg: authority?.vehicleCapacityKg != null ? String(authority.vehicleCapacityKg) : null,
  });
  createdTripIds.push(trip.id);
  return trip;
}

async function testFetch(path: string, options: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.method === 'POST') {
    const key = options.idempotencyKey ?? `o01-${suffix}-${requestCounter++}`;
    headers['Idempotency-Key'] = key;
    createdIdempotencyKeys.push(key);
  }
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
  const forwarder = await mkUser(`pair-forwarder-${suffix}`, Role.OPS);
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
  if (createdIdempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, createdIdempotencyKeys));
  }
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
    await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
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
  const closePromise = new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  server.closeAllConnections();
  await closePromise;
  await disconnectRedis();
  await client.end();
});

describe('O01 two-way dispatch pairing routes', () => {
  test('ADMIN can create a valid pair and duplicate pairing is rejected', async () => {
    const firstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const secondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-28T09:30:00',
      plannedEndAt: '2026-07-28T13:30:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    const first = await mkTrip(TripStatus.CREATED, '2026-07-27', firstSeed);
    const second = await mkTrip(TripStatus.CREATED, '2026-07-28', secondSeed);

    const payload = {
      firstTripId: first.id,
      secondTripId: second.id,
      firstTrip: pairDraft(firstSeed, first.version),
      secondTrip: pairDraft(secondSeed, second.version),
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
    const firstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const secondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T11:00:00',
      plannedEndAt: '2026-07-27T16:00:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    const first = await mkTrip(TripStatus.CREATED, '2026-07-27', firstSeed);
    const second = await mkTrip(TripStatus.CREATED, '2026-07-27', secondSeed);

    const payload = {
      firstTripId: first.id,
      secondTripId: second.id,
      firstTrip: pairDraft(firstSeed, first.version),
      secondTrip: pairDraft(secondSeed, second.version),
    };

    const denied = await testFetch('/pairs', { method: 'POST', token: forwarderToken, body: payload });
    assert.equal(denied.status, 403);

    const blocked = await testFetch('/pairs', { method: 'POST', token: managerToken, body: payload });
    assert.equal(blocked.status, 422);
    assert.match(String(blocked.data.error ?? ''), /chồng thời gian/i);
  });

  test('route rejects forged schedule, location, cargo, and capacity fields and accepts the authoritative payload', async () => {
    const firstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const secondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T14:00:00',
      plannedEndAt: '2026-07-27T18:00:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    const first = await mkTrip(TripStatus.CREATED, '2026-07-27', firstSeed);
    const second = await mkTrip(TripStatus.CREATED, '2026-07-27', secondSeed);

    const validPayload = {
      firstTripId: first.id,
      secondTripId: second.id,
      pairKind: 'KET_HOP' as const,
      firstTrip: pairDraft(firstSeed, first.version),
      secondTrip: pairDraft(secondSeed, second.version),
    };

    const forgedPayloads = [
      {
        body: {
          ...validPayload,
          firstTrip: {
            ...validPayload.firstTrip,
            plannedStartAt: '2026-07-27T08:15:00',
          },
        },
        expectedMessage: /Giờ bắt đầu kế hoạch không khớp/i,
      },
      {
        body: {
          ...validPayload,
          firstTrip: {
            ...validPayload.firstTrip,
            canonicalDestination: 'Sai địa điểm',
          },
        },
        expectedMessage: /Điểm đến không khớp/i,
      },
      {
        body: {
          ...validPayload,
          firstTrip: {
            ...validPayload.firstTrip,
            cargoWeightKg: 9000,
          },
        },
        expectedMessage: /Trọng lượng hàng không khớp/i,
      },
      {
        body: {
          ...validPayload,
          firstTrip: {
            ...validPayload.firstTrip,
            vehicleCapacityKg: 25000,
          },
        },
        expectedMessage: /Tải trọng xe không khớp/i,
      },
    ];

    for (const scenario of forgedPayloads) {
      const response = await testFetch('/pairs', { method: 'POST', token: managerToken, body: scenario.body });
      assert.equal(response.status, 422);
      assert.match(String(response.data.error ?? ''), scenario.expectedMessage);

      const firstAuthority = await readTripAuthority(first.id);
      const secondAuthority = await readTripAuthority(second.id);
      assert.equal(firstAuthority?.canonicalDestination, firstSeed.canonicalDestination);
      assert.equal(firstAuthority?.cargoWeightKg, '12000.00');
      assert.equal(firstAuthority?.vehicleCapacityKg, '18000.00');
      assert.equal(firstAuthority?.activeTripPairId, null);
      assert.equal(secondAuthority?.activeTripPairId, null);
    }

    const created = await testFetch('/pairs', { method: 'POST', token: managerToken, body: validPayload });
    assert.equal(created.status, 201);
    createdPairIds.push(created.data.id);

    const firstAuthority = await readTripAuthority(first.id);
    assert.equal(firstAuthority?.plannedStartAt?.getTime(), new Date(firstSeed.plannedStartAt).getTime());
    assert.equal(firstAuthority?.canonicalDestination, firstSeed.canonicalDestination);
    assert.equal(firstAuthority?.cargoWeightKg, '12000.00');
    assert.equal(firstAuthority?.vehicleCapacityKg, '18000.00');
  });

  test('cancellation and late completion break the persisted pair without deleting the surviving trip', async () => {
    const cancelFirstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const cancelSecondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-28T09:00:00',
      plannedEndAt: '2026-07-28T13:00:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    const cancelFirst = await mkTrip(TripStatus.CREATED, '2026-07-27', cancelFirstSeed);
    const cancelSecond = await mkTrip(TripStatus.CREATED, '2026-07-28', cancelSecondSeed);
    const createdPair = await createTripPair({
      firstTripId: cancelFirst.id,
      secondTripId: cancelSecond.id,
      pairKind: 'KET_HOP' as const,
      firstTrip: pairDraft(cancelFirstSeed, cancelFirst.version),
      secondTrip: pairDraft(cancelSecondSeed, cancelSecond.version),
    }, actorUserId);
    createdPairIds.push(createdPair.id);

    const canceled = await testFetch(`/${cancelFirst.id}/cancel`, { method: 'POST', token: managerToken, body: {} });
    assert.equal(canceled.status, 200);
    const [cancelPairRow] = await db.select().from(s.tripPairs).where(eq(s.tripPairs.id, createdPair.id)).limit(1);
    assert.equal(cancelPairRow?.status, 'BROKEN');
    assert.equal(cancelPairRow?.breakReason, 'FIRST_TRIP_CANCELED');
    const [survivor] = await db.select({ activeTripPairId: s.trips.activeTripPairId }).from(s.trips).where(eq(s.trips.id, cancelSecond.id)).limit(1);
    assert.equal(survivor?.activeTripPairId, null);

    const lateFirstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const lateSecondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T13:00:00',
      plannedEndAt: '2026-07-27T16:00:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    const lateFirst = await mkTrip(TripStatus.IN_TRANSIT, '2026-07-27', lateFirstSeed);
    const lateSecond = await mkTrip(TripStatus.CREATED, '2026-07-27', lateSecondSeed);
    const latePair = await createTripPair({
      firstTripId: lateFirst.id,
      secondTripId: lateSecond.id,
      pairKind: 'KET_HOP' as const,
      firstTrip: pairDraft(lateFirstSeed, lateFirst.version),
      secondTrip: pairDraft(lateSecondSeed, lateSecond.version),
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

  test('O2C kẹp hàng: pairing nets the second trip VETC toll out; pair-break restores it on the survivor', async () => {
    const firstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const secondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-28T09:00:00',
      plannedEndAt: '2026-07-28T13:00:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    const tollFirst = await mkTrip(TripStatus.CREATED, '2026-07-27', firstSeed);
    const tollSecond = await mkTrip(TripStatus.CREATED, '2026-07-28', secondSeed);

    // Both trips carry the same closed-loop VETC toll: 2 stations × 55 000 = 110 000.
    // totalCost baseline 900 000 already includes the toll (set at creation in mkTrip).
    const grossToll = 110000;
    await applyTripPatch(db, tollFirst.id, {
      tollsStations: 2,
      tollPerStationApplied: '55000',
      tollCost: String(grossToll),
      tollDeduction: '0',
    });
    await applyTripPatch(db, tollSecond.id, {
      tollsStations: 2,
      tollPerStationApplied: '55000',
      tollCost: String(grossToll),
      tollDeduction: '0',
    });

    const pair = await createTripPair({
      firstTripId: tollFirst.id,
      secondTripId: tollSecond.id,
      pairKind: 'KET_HOP' as const,
      firstTrip: pairDraft(firstSeed, tollFirst.version),
      secondTrip: pairDraft(secondSeed, tollSecond.version),
    }, actorUserId);
    createdPairIds.push(pair.id);

    const [firstRow] = await db.select({
      tollDeduction: s.tripsComposite.tollDeduction, tollCost: s.tripsComposite.tollCost,
    }).from(s.tripsComposite).where(eq(s.tripsComposite.id, tollFirst.id)).limit(1);
    const [secondRow] = await db.select({
      tollDeduction: s.tripsComposite.tollDeduction,
      tollCost: s.tripsComposite.tollCost,
      totalCost: s.tripsComposite.totalCost,
      grossProfit: s.tripsComposite.grossProfit,
    }).from(s.tripsComposite).where(eq(s.tripsComposite.id, tollSecond.id)).limit(1);

    // Trip 1 keeps its full toll; trip 2 is netted out (dedup == gross) so the
    // pair bears the toll once: 110000 + 0 == 110000.
    assert.equal(Number(firstRow.tollDeduction), 0);
    assert.equal(Number(firstRow.tollCost), grossToll);
    assert.equal(Number(secondRow.tollDeduction), grossToll);
    assert.equal(Number(secondRow.tollCost), 0);
    assert.equal(Number(secondRow.totalCost), 790000);
    assert.equal(Number(secondRow.grossProfit), 710000);
    assert.equal(Number(firstRow.tollCost) + Number(secondRow.tollCost), grossToll);

    // Break the pair by canceling trip 1; trip 2 survives and its toll must be restored.
    const cancel = await testFetch(`/${tollFirst.id}/cancel`, { method: 'POST', token: managerToken, body: {} });
    assert.equal(cancel.status, 200);

    const [restoredSurvivor] = await db.select({
      tollDeduction: s.tripsComposite.tollDeduction,
      tollCost: s.tripsComposite.tollCost,
      totalCost: s.tripsComposite.totalCost,
      grossProfit: s.tripsComposite.grossProfit,
    }).from(s.tripsComposite).where(eq(s.tripsComposite.id, tollSecond.id)).limit(1);
    assert.equal(Number(restoredSurvivor.tollDeduction), 0);
    assert.equal(Number(restoredSurvivor.tollCost), grossToll); // full toll back
    assert.equal(Number(restoredSurvivor.totalCost), 900000);
    assert.equal(Number(restoredSurvivor.grossProfit), 600000);
  });

  test('service rejects forged capacity and cargo while accepting the authoritative draft', async () => {
    const firstSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-29T08:00:00',
      plannedEndAt: '2026-07-29T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12500,
      vehicleCapacityKg: 19000,
    };
    const secondSeed: TripAuthoritySeed = {
      plannedStartAt: '2026-07-29T13:30:00',
      plannedEndAt: '2026-07-29T17:30:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11500,
      vehicleCapacityKg: 19000,
    };
    const first = await mkTrip(TripStatus.CREATED, '2026-07-29', firstSeed);
    const second = await mkTrip(TripStatus.CREATED, '2026-07-29', secondSeed);

    const validPayload = {
      firstTripId: first.id,
      secondTripId: second.id,
      pairKind: 'KET_HOP' as const,
      firstTrip: pairDraft(firstSeed, first.version),
      secondTrip: pairDraft(secondSeed, second.version),
    };

    await assert.rejects(
      () => createTripPair({
        ...validPayload,
        firstTrip: {
          ...validPayload.firstTrip,
          cargoWeightKg: 5000,
        },
      }, actorUserId),
      (error: unknown) => error instanceof Error
        && 'statusCode' in error
        && (error as { statusCode?: number }).statusCode === 422
        && /Trọng lượng hàng không khớp/i.test(error.message),
    );

    await assert.rejects(
      () => createTripPair({
        ...validPayload,
        secondTrip: {
          ...validPayload.secondTrip,
          vehicleCapacityKg: 26000,
        },
      }, actorUserId),
      (error: unknown) => error instanceof Error
        && 'statusCode' in error
        && (error as { statusCode?: number }).statusCode === 422
        && /Tải trọng xe không khớp/i.test(error.message),
    );

    const createdPair = await createTripPair(validPayload, actorUserId);
    createdPairIds.push(createdPair.id);
    assert.equal(createdPair.status, 'ACTIVE');
  });
});

describe('pair kind split (KEP simultaneous / KET_HOP sequential)', () => {
  // Kind-specific seeds, created once for this block. Container type codes are
  // suffixed to stay unique against the base catalog.
  const createdContainerTypeIds: number[] = [];
  const createdTripContainerIds: number[] = [];
  let typeTwentyId = 0;
  let typeFortyId = 0;
  let secondRouteId = 0;
  let secondDriverId = 0;

  before(async () => {
    const [twenty] = await db.insert(s.containerTypes).values({
      code: `20GP${suffix.slice(-6)}`, name: "20'GP (test)",
    }).returning();
    const [forty] = await db.insert(s.containerTypes).values({
      code: `40HC${suffix.slice(-6)}`, name: "40'HC (test)",
    }).returning();
    createdContainerTypeIds.push(twenty.id, forty.id);
    typeTwentyId = twenty.id;
    typeFortyId = forty.id;
    const [secondRoute] = await db.insert(s.routes).values({
      name: `Pair route KEP ${suffix}`, distanceKm: 95,
    }).returning();
    createdRouteIds.push(secondRoute.id);
    secondRouteId = secondRoute.id;
    const [secondDriver] = await db.insert(s.drivers).values({
      name: `Pair driver 2 ${suffix}`, assignedTruckId: createdTruckIds[0],
    }).returning();
    createdDriverIds.push(secondDriver.id);
    secondDriverId = secondDriver.id;
  });

  after(async () => {
    if (createdTripContainerIds.length > 0) {
      await db.delete(s.tripContainers).where(inArray(s.tripContainers.id, createdTripContainerIds));
    }
    if (createdContainerTypeIds.length > 0) {
      await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    }
  });

  async function mkContainerTrip(args: {
    departureDate: string;
    containerTypeId: number;
    containerNumber: string | null;
    driverId?: number;
    routeId?: number;
    authority?: Partial<TripAuthoritySeed>;
  }) {
    const trip = await insertTripComposite(db, {
      tripCode: `KEP-${suffix}-${createdTripIds.length + 1}`,
      customerId: createdCustomerIds[0],
      truckId: createdTruckIds[0],
      driverId: args.driverId ?? createdDriverIds[0],
      routeId: args.routeId ?? createdRouteIds[0],
      cargoTypeId: createdCargoTypeIds[0],
      status: TripStatus.CREATED,
      departureDate: args.departureDate,
      carrierType: 'OWN',
      revenue: '1500000',
      totalCost: '900000',
      driverSalary: '350000',
      plannedStartAt: args.authority?.plannedStartAt ? new Date(args.authority.plannedStartAt) : null,
      plannedEndAt: args.authority?.plannedEndAt ? new Date(args.authority.plannedEndAt) : null,
      canonicalOrigin: args.authority?.canonicalOrigin ?? null,
      canonicalDestination: args.authority?.canonicalDestination ?? null,
      cargoWeightKg: args.authority?.cargoWeightKg != null ? String(args.authority.cargoWeightKg) : null,
      vehicleCapacityKg: args.authority?.vehicleCapacityKg != null ? String(args.authority.vehicleCapacityKg) : null,
    });
    createdTripIds.push(trip.id);
    const [container] = await db.insert(s.tripContainers).values({
      tripId: trip.id,
      containerTypeId: args.containerTypeId,
      containerNumber: args.containerNumber,
      cargoWeightKg: '12000',
    }).returning();
    createdTripContainerIds.push(container.id);
    return trip;
  }

  const kepAuthority = {
    plannedStartAt: '2026-07-27T08:00:00',
    plannedEndAt: '2026-07-27T12:00:00',
    canonicalOrigin: 'Cat Lai',
    canonicalDestination: 'Binh Duong',
    cargoWeightKg: 11000,
    vehicleCapacityKg: 18000,
  };

  test('KEP pairs two 20ft same-day trips with identical windows; route mismatch warns, never blocks', async () => {
    const first = await mkContainerTrip({
      departureDate: '2026-07-27',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU1234561',
      authority: kepAuthority,
    });
    const second = await mkContainerTrip({
      departureDate: '2026-07-27',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU7654321',
      routeId: secondRouteId,
      authority: kepAuthority,
    });

    const created = await testFetch('/pairs', {
      method: 'POST',
      token: managerToken,
      body: {
        firstTripId: first.id,
        secondTripId: second.id,
        pairKind: 'KEP',
        firstTrip: pairDraft(kepAuthority, first.version),
        secondTrip: pairDraft(kepAuthority, second.version),
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.pairKind, 'KEP');
    createdPairIds.push(created.data.id);
    // Different routes on a KEP pair surface as a non-blocking advisory.
    assert.ok(Array.isArray(created.data.warnings) && created.data.warnings.length > 0);
  });

  test('KEP is blocked unless both containers are 20ft', async () => {
    const first = await mkContainerTrip({
      departureDate: '2026-07-28',
      containerTypeId: typeFortyId,
      containerNumber: 'TGHU1111111',
      authority: kepAuthority,
    });
    const second = await mkContainerTrip({
      departureDate: '2026-07-28',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU2222222',
      authority: kepAuthority,
    });

    const blocked = await testFetch('/pairs', {
      method: 'POST',
      token: managerToken,
      body: {
        firstTripId: first.id,
        secondTripId: second.id,
        pairKind: 'KEP',
        firstTrip: pairDraft(kepAuthority, first.version),
        secondTrip: pairDraft(kepAuthority, second.version),
      },
    });
    assert.equal(blocked.status, 422);
    assert.match(String(blocked.data.error ?? ''), /Không đủ điều kiện kẹp hàng/);
  });

  test('KEP requires the same day and the same driver', async () => {
    const dayFirst = await mkContainerTrip({
      departureDate: '2026-07-28',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU3333333',
      authority: kepAuthority,
    });
    const daySecond = await mkContainerTrip({
      departureDate: '2026-07-29',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU4444444',
      authority: kepAuthority,
    });
    const dayBlocked = await testFetch('/pairs', {
      method: 'POST',
      token: managerToken,
      body: {
        firstTripId: dayFirst.id,
        secondTripId: daySecond.id,
        pairKind: 'KEP',
        firstTrip: pairDraft(kepAuthority, dayFirst.version),
        secondTrip: pairDraft(kepAuthority, daySecond.version),
      },
    });
    assert.equal(dayBlocked.status, 422);
    assert.match(String(dayBlocked.data.error ?? ''), /cùng một ngày/);

    const driverFirst = await mkContainerTrip({
      departureDate: '2026-07-28',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU5555555',
      authority: kepAuthority,
    });
    const driverSecond = await mkContainerTrip({
      departureDate: '2026-07-28',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU6666666',
      driverId: secondDriverId,
      authority: kepAuthority,
    });
    const driverBlocked = await testFetch('/pairs', {
      method: 'POST',
      token: managerToken,
      body: {
        firstTripId: driverFirst.id,
        secondTripId: driverSecond.id,
        pairKind: 'KEP',
        firstTrip: pairDraft(kepAuthority, driverFirst.version),
        secondTrip: pairDraft(kepAuthority, driverSecond.version),
      },
    });
    assert.equal(driverBlocked.status, 422);
    assert.match(String(driverBlocked.data.error ?? ''), /Không đủ điều kiện kẹp hàng/);
  });

  test('KET_HOP requires the same shell when both orders carry a number, and skips when one is missing', async () => {
    const seedA: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T08:00:00',
      plannedEndAt: '2026-07-27T12:00:00',
      canonicalOrigin: 'Cat Lai',
      canonicalDestination: 'Binh Duong',
      cargoWeightKg: 12000,
      vehicleCapacityKg: 18000,
    };
    const seedB: TripAuthoritySeed = {
      plannedStartAt: '2026-07-27T13:00:00',
      plannedEndAt: '2026-07-27T17:00:00',
      canonicalOrigin: 'Binh Duong',
      canonicalDestination: 'Cat Lai',
      cargoWeightKg: 11000,
      vehicleCapacityKg: 18000,
    };
    // Both numbers known but different => block (wrong shell reuse).
    const shellFirst = await mkContainerTrip({
      departureDate: '2026-07-27',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU7777777',
      authority: seedA,
    });
    const shellSecond = await mkContainerTrip({
      departureDate: '2026-07-27',
      containerTypeId: typeTwentyId,
      containerNumber: 'TGHU8888888',
      authority: seedB,
    });
    const mismatch = await testFetch('/pairs', {
      method: 'POST',
      token: managerToken,
      body: {
        firstTripId: shellFirst.id,
        secondTripId: shellSecond.id,
        pairKind: 'KET_HOP',
        firstTrip: pairDraft(seedA, shellFirst.version),
        secondTrip: pairDraft(seedB, shellSecond.version),
      },
    });
    assert.equal(mismatch.status, 422);
    assert.match(String(mismatch.data.error ?? ''), /số vỏ khác nhau/);

    // Second order has no number yet (dispatch stage) => allowed by spec.
    const noNumberSecond = await mkContainerTrip({
      departureDate: '2026-07-27',
      containerTypeId: typeTwentyId,
      containerNumber: null,
      authority: seedB,
    });
    const created = await testFetch('/pairs', {
      method: 'POST',
      token: managerToken,
      body: {
        firstTripId: shellFirst.id,
        secondTripId: noNumberSecond.id,
        pairKind: 'KET_HOP',
        firstTrip: pairDraft(seedA, shellFirst.version),
        secondTrip: pairDraft(seedB, noNumberSecond.version),
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.pairKind, 'KET_HOP');
    createdPairIds.push(created.data.id);
  });
});

describe('pair salary (lương cặp = cuốc cơ bản + phụ phí)', () => {
  test('second trip carries the configured surcharge; breaking the pair restores the standard wage', async () => {
    const settingsBefore = await getPairSalarySettingsFrom();
    await db.transaction(async (tx) => savePairSalarySettings(tx, { kepSurcharge: 120000, ketHopSurcharge: 80000 }));
    try {
      const salarySeed: TripAuthoritySeed = {
        plannedStartAt: '2026-07-27T08:00:00',
        plannedEndAt: '2026-07-27T12:00:00',
        canonicalOrigin: 'Cat Lai',
        canonicalDestination: 'Binh Duong',
        cargoWeightKg: 11000,
        vehicleCapacityKg: 18000,
      };
      const first = await insertTripComposite(db, {
        tripCode: `SAL-${suffix}-1`,
        customerId: createdCustomerIds[0],
        truckId: createdTruckIds[0],
        driverId: createdDriverIds[0],
        routeId: createdRouteIds[0],
        cargoTypeId: createdCargoTypeIds[0],
        status: TripStatus.CREATED,
        departureDate: '2026-07-27',
        carrierType: 'OWN',
        revenue: '1500000',
        totalCost: '900000',
        driverSalary: '350000',
        plannedStartAt: new Date(salarySeed.plannedStartAt),
        plannedEndAt: new Date(salarySeed.plannedEndAt),
        canonicalOrigin: salarySeed.canonicalOrigin,
        canonicalDestination: salarySeed.canonicalDestination,
        cargoWeightKg: String(salarySeed.cargoWeightKg),
        vehicleCapacityKg: String(salarySeed.vehicleCapacityKg),
      });
      createdTripIds.push(first.id);
      // Sequential backhaul leg (Binh Duong -> Cat Lai) so the pair is a valid
      // KET_HOP: shell numbers absent at dispatch stage, so the vỏ rule skips.
      const second = await insertTripComposite(db, {
        tripCode: `SAL-${suffix}-2`,
        customerId: createdCustomerIds[0],
        truckId: createdTruckIds[0],
        driverId: createdDriverIds[0],
        routeId: createdRouteIds[0],
        cargoTypeId: createdCargoTypeIds[0],
        status: TripStatus.CREATED,
        departureDate: '2026-07-27',
        carrierType: 'OWN',
        revenue: '1500000',
        totalCost: '900000',
        driverSalary: '350000',
        plannedStartAt: new Date('2026-07-27T13:00:00'),
        plannedEndAt: new Date('2026-07-27T17:00:00'),
        canonicalOrigin: 'Binh Duong',
        canonicalDestination: 'Cat Lai',
        cargoWeightKg: String(salarySeed.cargoWeightKg),
        vehicleCapacityKg: String(salarySeed.vehicleCapacityKg),
      });
      createdTripIds.push(second.id);
      const secondSalarySeed: TripAuthoritySeed = {
        plannedStartAt: '2026-07-27T13:00:00',
        plannedEndAt: '2026-07-27T17:00:00',
        canonicalOrigin: 'Binh Duong',
        canonicalDestination: 'Cat Lai',
        cargoWeightKg: 11000,
        vehicleCapacityKg: 18000,
      };

      const created = await testFetch('/pairs', {
        method: 'POST',
        token: managerToken,
        body: {
          firstTripId: first.id,
          secondTripId: second.id,
          pairKind: 'KET_HOP',
          firstTrip: pairDraft(salarySeed, first.version),
          secondTrip: pairDraft(secondSalarySeed, second.version),
        },
      });
      assert.equal(created.status, 201);
      createdPairIds.push(created.data.id);

      const [pairedRow] = await db.select({
        driverSalary: s.tripsComposite.driverSalary,
        totalCost: s.tripsComposite.totalCost,
        grossProfit: s.tripsComposite.grossProfit,
      }).from(s.tripsComposite).where(eq(s.tripsComposite.id, second.id)).limit(1);
      // Wage replaced by the KEP surcharge; cost follows the salary delta.
      assert.equal(Number(pairedRow.driverSalary), 80000);
      assert.equal(Number(pairedRow.totalCost), 630000);
      assert.equal(Number(pairedRow.grossProfit), 870000);
      // The pre-pair wage is stashed on the pair for exact restore.
      const [pairRow] = await db.select({ secondSalaryStash: s.tripPairs.secondSalaryStash })
        .from(s.tripPairs).where(eq(s.tripPairs.id, created.data.id)).limit(1);
      assert.equal(Number(pairRow.secondSalaryStash), 350000);

      // Break the pair by canceling the first trip — the survivor's standard
      // wage (and cost math) must come back exactly.
      const cancel = await testFetch(`/${first.id}/cancel`, { method: 'POST', token: managerToken, body: {} });
      assert.equal(cancel.status, 200);
      const [restoredRow] = await db.select({
        driverSalary: s.tripsComposite.driverSalary,
        totalCost: s.tripsComposite.totalCost,
        grossProfit: s.tripsComposite.grossProfit,
      }).from(s.tripsComposite).where(eq(s.tripsComposite.id, second.id)).limit(1);
      assert.equal(Number(restoredRow.driverSalary), 350000);
      assert.equal(Number(restoredRow.totalCost), 900000);
      assert.equal(Number(restoredRow.grossProfit), 600000);
    } finally {
      await db.transaction(async (tx) => savePairSalarySettings(tx, settingsBefore));
    }
  });
});
