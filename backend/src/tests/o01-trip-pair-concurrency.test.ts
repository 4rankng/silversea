import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { and, eq, inArray, or } from 'drizzle-orm';

import { Role, TripStatus, type CreateTripPairInput } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import {
  approveGovernanceAction,
  requestTripFinancialClose,
} from '../services/adjustment-governance.service';
import { disconnectRedis } from '../lib/redis';
import { checkGovernanceAction } from '../services/governance-transition.service';
import {
  IDEMPOTENCY_ENDPOINTS,
  runIdempotent,
} from '../services/idempotency.service';
import { transitionTripWriteCommand } from '../services/trip-command.service';
import { createTripPair } from '../services/trip-pairs.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdTruckIds: number[] = [];
const createdDriverIds: number[] = [];

let actors: Array<{ id: number; role: string }> = [];

type TripSeed = {
  status?: TripStatus;
  plannedStartAt: string;
  plannedEndAt: string;
  canonicalOrigin: string;
  canonicalDestination: string;
};

function apiStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'statusCode' in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;
}

function assertOneWinnerOneConflict<T>(
  outcomes: PromiseSettledResult<T>[],
): PromiseFulfilledResult<T> {
  const winners = outcomes.filter(
    (outcome): outcome is PromiseFulfilledResult<T> => outcome.status === 'fulfilled',
  );
  const losers = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );
  assert.equal(winners.length, 1, 'the race must commit exactly one operation');
  assert.equal(losers.length, 1, 'the race must reject exactly one operation');
  assert.equal(apiStatus(losers[0]!.reason), 409, 'the losing operation must report a conflict');
  return winners[0]!;
}

async function mkTrip(seed: TripSeed) {
  const [trip] = await db.insert(s.trips).values({
    tripCode: `O01-RACE-${suffix}-${createdTripIds.length + 1}`,
    customerId: createdCustomerIds[0]!,
    truckId: createdTruckIds[0]!,
    driverId: createdDriverIds[0]!,
    routeId: createdRouteIds[0]!,
    cargoTypeId: createdCargoTypeIds[0]!,
    status: seed.status ?? TripStatus.CREATED,
    departureDate: seed.plannedStartAt.slice(0, 10),
    carrierType: 'OWN',
    revenue: '1500000',
    totalCost: '900000',
    driverSalary: '350000',
    plannedStartAt: new Date(seed.plannedStartAt),
    plannedEndAt: new Date(seed.plannedEndAt),
    canonicalOrigin: seed.canonicalOrigin,
    canonicalDestination: seed.canonicalDestination,
    cargoWeightKg: '12000',
    vehicleCapacityKg: '18000',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function seedCompletionEvidence(tripId: number, uploadedBy: number) {
  await db.insert(s.tripPhotos).values([
    {
      tripId,
      type: 'CONTAINER',
      storageKey: `o01-race-container-${tripId}-${suffix}.jpg`,
      uploadedBy,
    },
    {
      tripId,
      type: 'SEAL',
      storageKey: `o01-race-seal-${tripId}-${suffix}.jpg`,
      uploadedBy,
    },
  ]);
  await db.update(s.trips).set({
    podRecoveredAt: new Date(),
    podRecoveredBy: uploadedBy,
  }).where(eq(s.trips.id, tripId));
}

function pairPayload(
  first: Awaited<ReturnType<typeof mkTrip>>,
  second: Awaited<ReturnType<typeof mkTrip>>,
): CreateTripPairInput {
  const draft = (trip: typeof first) => ({
    plannedStartAt: trip.plannedStartAt!.toISOString(),
    plannedEndAt: trip.plannedEndAt!.toISOString(),
    canonicalOrigin: trip.canonicalOrigin!,
    canonicalDestination: trip.canonicalDestination!,
    cargoWeightKg: Number(trip.cargoWeightKg),
    vehicleCapacityKg: Number(trip.vehicleCapacityKg),
    expectedVersion: trip.version,
  });
  return {
    firstTripId: first.id,
    secondTripId: second.id,
    firstTrip: draft(first),
    secondTrip: draft(second),
  };
}

function runPair(input: CreateTripPairInput, idempotencyKey: string) {
  const actor = actors[0]!;
  return runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_PAIR_CREATE,
    idempotencyKey,
    payload: { actorId: actor.id, payload: input },
    createdBy: actor.id,
    entityType: 'trip_pair',
    responseStatusCode: 201,
    create: (tx) => createTripPair(input, actor.id, tx),
    getEntityId: (pair) => pair.id,
  });
}

async function assertPairIntegrity(tripIds: number[], expectedActivePairCount: number) {
  const trips = await db.select({
    id: s.trips.id,
    status: s.trips.status,
    deletedAt: s.trips.deletedAt,
    activeTripPairId: s.trips.activeTripPairId,
    activeTripPairOrder: s.trips.activeTripPairOrder,
  }).from(s.trips).where(inArray(s.trips.id, tripIds));
  assert.equal(trips.length, tripIds.length, 'every participating trip must survive the race');
  assert.ok(trips.every((trip) => trip.deletedAt == null), 'no participating trip may be deleted');

  const pairs = await db.select().from(s.tripPairs).where(or(
    inArray(s.tripPairs.firstTripId, tripIds),
    inArray(s.tripPairs.secondTripId, tripIds),
  ));
  const activePairs = pairs.filter((pair) => pair.status === 'ACTIVE');
  assert.equal(activePairs.length, expectedActivePairCount, 'unexpected active pair count');
  assert.equal(pairs.length, expectedActivePairCount, 'a losing transaction must not leave an orphan pair row');

  for (const pair of activePairs) {
    const first = trips.find((trip) => trip.id === pair.firstTripId);
    const second = trips.find((trip) => trip.id === pair.secondTripId);
    assert.equal(first?.activeTripPairId, pair.id);
    assert.equal(first?.activeTripPairOrder, 1);
    assert.equal(second?.activeTripPairId, pair.id);
    assert.equal(second?.activeTripPairOrder, 2);
  }

  for (const trip of trips) {
    if (trip.activeTripPairId == null) {
      assert.equal(trip.activeTripPairOrder, null);
      continue;
    }
    assert.ok(
      activePairs.some((pair) => pair.id === trip.activeTripPairId),
      'every active trip pointer must resolve to an active reciprocal pair',
    );
  }
  return { trips, pairs, activePairs };
}

before(async () => {
  actors = await db.insert(s.users).values([
    {
      username: `o01-race-maker-${suffix}`,
      passwordHash: 'x',
      role: Role.MANAGER,
      status: 'ACTIVE',
    },
    {
      username: `o01-race-checker-${suffix}`,
      passwordHash: 'x',
      role: Role.ACCOUNTANT,
      status: 'ACTIVE',
    },
    {
      username: `o01-race-approver-${suffix}`,
      passwordHash: 'x',
      role: Role.ADMIN,
      status: 'ACTIVE',
    },
  ]).returning({ id: s.users.id, role: s.users.role });
  createdUserIds.push(...actors.map((actor) => actor.id));

  const [customer] = await db.insert(s.customers).values({
    name: `O01 race customer ${suffix}`,
  }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({
    name: `O01 race route ${suffix}`,
    distanceKm: 120,
  }).returning();
  createdRouteIds.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `O01 race cargo ${suffix}`,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  const [truck] = await db.insert(s.trucks).values({
    licensePlate: `O01${suffix}`.replace(/[^A-Za-z0-9]/g, '').slice(-20),
  }).returning();
  createdTruckIds.push(truck.id);
  const [driver] = await db.insert(s.drivers).values({
    name: `O01 race driver ${suffix}`,
    assignedTruckId: truck.id,
  }).returning();
  createdDriverIds.push(driver.id);
});

after(async () => {
  if (createdTripIds.length > 0) {
    const actionRows = await db.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'TRIP'),
        inArray(s.governanceActions.subjectId, createdTripIds),
      ));
    const actionIds = actionRows.map((action) => action.id);
    if (actionIds.length > 0) {
      await db.delete(s.tripGpsCaptureJobs)
        .where(inArray(s.tripGpsCaptureJobs.governanceActionId, actionIds));
    }
    await db.delete(s.notifications).where(and(
      eq(s.notifications.relatedEntityType, 'trips'),
      inArray(s.notifications.relatedEntityId, createdTripIds),
    ));
    await db.delete(s.tripPhotos).where(inArray(s.tripPhotos.tripId, createdTripIds));
    await db.delete(s.driverWorkDays).where(inArray(s.driverWorkDays.tripId, createdTripIds));
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdTripIds));
    await db.delete(s.governanceActions).where(and(
      eq(s.governanceActions.subjectType, 'TRIP'),
      inArray(s.governanceActions.subjectId, createdTripIds),
    ));
    await db.delete(s.idempotencyKeys).where(inArray(s.idempotencyKeys.createdBy, createdUserIds));
    await db.update(s.trips).set({
      activeTripPairId: null,
      activeTripPairOrder: null,
    }).where(inArray(s.trips.id, createdTripIds));
    await db.delete(s.tripPairs).where(or(
      inArray(s.tripPairs.firstTripId, createdTripIds),
      inArray(s.tripPairs.secondTripId, createdTripIds),
    ));
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
  await disconnectRedis();
  await client.end();
});

describe('O01 persisted trip-pair concurrency', () => {
  test('same pair and same transaction key replays one committed pair', async () => {
    const first = await mkTrip({
      plannedStartAt: '2026-07-29T08:00:00.000Z',
      plannedEndAt: '2026-07-29T10:00:00.000Z',
      canonicalOrigin: 'Cát Lái',
      canonicalDestination: 'Bình Dương',
    });
    const second = await mkTrip({
      plannedStartAt: '2026-07-29T11:00:00.000Z',
      plannedEndAt: '2026-07-29T13:00:00.000Z',
      canonicalOrigin: 'Bình Dương',
      canonicalDestination: 'Cát Lái',
    });
    const input = pairPayload(first, second);
    const key = `o01-race-same-key-${suffix}`;

    const outcomes = await Promise.all([runPair(input, key), runPair(input, key)]);

    assert.equal(outcomes[0].result.id, outcomes[1].result.id);
    assert.deepEqual(outcomes.map((outcome) => outcome.replayed).sort(), [false, true]);
    await assertPairIntegrity([first.id, second.id], 1);
  });

  test('same pair and different transaction keys commit once and conflict once', async () => {
    const first = await mkTrip({
      plannedStartAt: '2026-07-30T08:00:00.000Z',
      plannedEndAt: '2026-07-30T10:00:00.000Z',
      canonicalOrigin: 'Cát Lái',
      canonicalDestination: 'Bình Dương',
    });
    const second = await mkTrip({
      plannedStartAt: '2026-07-30T11:00:00.000Z',
      plannedEndAt: '2026-07-30T13:00:00.000Z',
      canonicalOrigin: 'Bình Dương',
      canonicalDestination: 'Cát Lái',
    });
    const input = pairPayload(first, second);

    assertOneWinnerOneConflict(await Promise.allSettled([
      runPair(input, `o01-race-different-key-a-${suffix}`),
      runPair(input, `o01-race-different-key-b-${suffix}`),
    ]));
    await assertPairIntegrity([first.id, second.id], 1);
  });

  test('A+B racing A+C leaves one reciprocal pair and one unpaired trip', async () => {
    const first = await mkTrip({
      plannedStartAt: '2026-07-31T08:00:00.000Z',
      plannedEndAt: '2026-07-31T10:00:00.000Z',
      canonicalOrigin: 'Cát Lái',
      canonicalDestination: 'Bình Dương',
    });
    const second = await mkTrip({
      plannedStartAt: '2026-07-31T11:00:00.000Z',
      plannedEndAt: '2026-07-31T13:00:00.000Z',
      canonicalOrigin: 'Bình Dương',
      canonicalDestination: 'Cát Lái',
    });
    const alternative = await mkTrip({
      plannedStartAt: '2026-07-31T14:00:00.000Z',
      plannedEndAt: '2026-07-31T16:00:00.000Z',
      canonicalOrigin: 'Bình Dương',
      canonicalDestination: 'Cát Lái',
    });

    assertOneWinnerOneConflict(await Promise.allSettled([
      runPair(pairPayload(first, second), `o01-race-ab-${suffix}`),
      runPair(pairPayload(first, alternative), `o01-race-ac-${suffix}`),
    ]));
    const state = await assertPairIntegrity([first.id, second.id, alternative.id], 1);
    assert.equal(
      state.trips.filter((trip) => trip.activeTripPairId == null).length,
      1,
      'the losing alternative trip must remain unpaired',
    );
  });

  test('pair creation racing cancellation has one winner and preserves both trips', async () => {
    const first = await mkTrip({
      plannedStartAt: '2026-08-01T08:00:00.000Z',
      plannedEndAt: '2026-08-01T10:00:00.000Z',
      canonicalOrigin: 'Cát Lái',
      canonicalDestination: 'Bình Dương',
    });
    const second = await mkTrip({
      plannedStartAt: '2026-08-01T11:00:00.000Z',
      plannedEndAt: '2026-08-01T13:00:00.000Z',
      canonicalOrigin: 'Bình Dương',
      canonicalDestination: 'Cát Lái',
    });

    assertOneWinnerOneConflict(await Promise.allSettled([
      runPair(pairPayload(first, second), `o01-race-pair-cancel-${suffix}`),
      transitionTripWriteCommand({
        tripId: first.id,
        targetStatus: TripStatus.CANCELED,
        actor: { userId: actors[0]!.id, role: actors[0]!.role as Role },
        idempotencyKey: `o01-race-cancel-${suffix}`,
        expectedVersion: first.version,
      }),
    ]));
    const state = await assertPairIntegrity(
      [first.id, second.id],
      (await db.select().from(s.tripPairs).where(or(
        eq(s.tripPairs.firstTripId, first.id),
        eq(s.tripPairs.secondTripId, first.id),
      ))).length,
    );
    assert.ok(state.activePairs.length === 1 || state.trips.some(
      (trip) => trip.id === first.id && trip.status === TripStatus.CANCELED,
    ));
  });

  test('pair creation racing approved first-trip completion has one winner and no orphan', async () => {
    const first = await mkTrip({
      status: TripStatus.IN_TRANSIT,
      plannedStartAt: '2026-08-02T08:00:00.000Z',
      plannedEndAt: '2026-08-02T10:00:00.000Z',
      canonicalOrigin: 'Cát Lái',
      canonicalDestination: 'Bình Dương',
    });
    const second = await mkTrip({
      plannedStartAt: '2026-08-02T12:00:00.000Z',
      plannedEndAt: '2026-08-02T14:00:00.000Z',
      canonicalOrigin: 'Bình Dương',
      canonicalDestination: 'Cát Lái',
    });
    await seedCompletionEvidence(first.id, actors[0]!.id);
    const requested = await requestTripFinancialClose({
      tripId: first.id,
      reason: 'Xác nhận hoàn thành chuyến trong kiểm thử tranh chấp ghép chuyến',
      makerId: actors[0]!.id,
      makerRole: actors[0]!.role,
      expectedTripVersion: first.version,
    });
    const checked = await checkGovernanceAction({
      actionId: requested.id,
      checkerId: actors[1]!.id,
      checkerRole: actors[1]!.role,
      expectedVersion: requested.version,
    });

    assertOneWinnerOneConflict(await Promise.allSettled([
      runPair(pairPayload(first, second), `o01-race-pair-complete-${suffix}`),
      approveGovernanceAction({
        actionId: checked.id,
        approverId: actors[2]!.id,
        approverRole: actors[2]!.role,
        expectedVersion: checked.version,
      }),
    ]));
    const pairRows = await db.select().from(s.tripPairs).where(or(
      eq(s.tripPairs.firstTripId, first.id),
      eq(s.tripPairs.secondTripId, first.id),
    ));
    const state = await assertPairIntegrity([first.id, second.id], pairRows.length);
    assert.ok(state.activePairs.length === 1 || state.trips.some(
      (trip) => trip.id === first.id && trip.status === TripStatus.COMPLETED,
    ));
  });
});
