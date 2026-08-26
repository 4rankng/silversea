import { NotificationType, Role, TripStatus } from '@tingting/shared';
import * as tripService from './trip.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { emitNotification, type NotificationPayload } from './notification.service';
import { runIdempotent } from './idempotency.service';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

type TripRecord = Awaited<ReturnType<typeof tripService.createTrip>>;
type CreateTripInput = Parameters<typeof tripService.createTrip>[0];

export interface TripCommandActor {
  userId: number;
  role: Role;
}

export interface TripCommandDeps {
  createTrip: typeof tripService.createTrip;
  copyTrip: typeof tripService.copyTrip;
  transitionTripStatus: typeof tripService.transitionTripStatus;
  syncAttendanceAfterStatusChange: typeof tripService.syncAttendanceAfterStatusChange;
  invalidateReports: (invalidatePnl?: boolean) => Promise<void>;
  emitNotification: (payload: NotificationPayload) => void;
}

export interface TripWriteCommandResult {
  trip: TripRecord;
  replayed: boolean;
}

async function invalidateReportCaches(invalidatePnl?: boolean) {
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
    cacheInvalidate('reports:dashboard:executive'),
    cacheInvalidatePattern('reports:entity-results:*'),   // trip writes change AR/AP aging
    cacheInvalidatePattern('reports:fuel-variance:*'),    // trip writes change fuel variance
    invalidatePnl ? cacheInvalidatePattern('reports:pnl:*') : Promise.resolve(),
  ]).catch(() => {});
}

const defaultDeps: TripCommandDeps = {
  createTrip: tripService.createTrip,
  copyTrip: tripService.copyTrip,
  transitionTripStatus: tripService.transitionTripStatus,
  syncAttendanceAfterStatusChange: tripService.syncAttendanceAfterStatusChange,
  invalidateReports: invalidateReportCaches,
  emitNotification,
};

/**
 * These trip-lifecycle notifications only ever target the driver
 * (`targetDriverId`, no `targetRoles`/`targetUserId`) — driver-only, so the
 * deep link can safely key on the fulfillment. `DriverTripDetailPage`
 * (`/my-trips/:id`) reads that route param as a fulfillment id, not a trip
 * id — `relatedEntityType: 'trips'` would send the driver to
 * `/my-trips/{tripId}`, which 404s. `fulfillmentId` is null for trips
 * created outside the fulfillment-issuance flow (legacy `/api/trips`); the
 * driver then lands on the trip list instead of a dead link.
 */
function driverTripEntity(trip: Pick<TripRecord, 'fulfillmentId'>): { relatedEntityType: string; relatedEntityId?: number } {
  return { relatedEntityType: 'shipment_fulfillments', relatedEntityId: trip.fulfillmentId ?? undefined };
}

function emitTripCreatedNotification(
  trip: TripRecord,
  emit: (payload: NotificationPayload) => void,
) {
  emit({
    type: NotificationType.TRIP_CREATED,
    title: 'Chuyến mới được tạo',
    message: `Chuyến ${trip.tripCode} đã được tạo`,
    ...driverTripEntity(trip),
    targetDriverId: trip.driverId ?? undefined,
  });
}

async function loadTripRow(tx: Tx, tripId: number): Promise<TripRecord> {
  const [trip] = await tx.select().from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  return trip;
}

export async function createTripCommand(
  data: CreateTripInput,
  actor: TripCommandActor,
  deps: TripCommandDeps = defaultDeps,
): Promise<TripRecord> {
  const trip = await deps.createTrip({
    ...data,
    createdBy: actor.userId,
    createdByRole: actor.role,
  });
  await deps.invalidateReports();
  emitTripCreatedNotification(trip, deps.emitNotification);
  return trip;
}

export async function copyTripCommand(
  sourceTripId: number,
  actor: TripCommandActor,
  deps: TripCommandDeps = defaultDeps,
): Promise<TripRecord> {
  const trip = await deps.copyTrip(sourceTripId, actor.userId);
  await deps.invalidateReports();
  emitTripCreatedNotification(trip, deps.emitNotification);
  return trip;
}

export async function dispatchTripCommand(
  tripId: number,
  actor: TripCommandActor,
  deps: TripCommandDeps = defaultDeps,
): Promise<TripRecord> {
  const trip = await deps.transitionTripStatus(
    tripId,
    TripStatus.IN_TRANSIT,
    actor.userId,
    actor.role,
  );
  await deps.invalidateReports();
  await deps.syncAttendanceAfterStatusChange(
    trip.id,
    TripStatus.IN_TRANSIT,
    trip.driverId ?? null,
    trip.departureDate ?? null,
    null,
    actor.userId,
  );
  deps.emitNotification({
    type: NotificationType.TRIP_DISPATCHED,
    title: 'Chuyến được điều phối',
    message: `Chuyến ${trip.tripCode} đã được điều phối`,
    ...driverTripEntity(trip),
    targetDriverId: trip.driverId ?? undefined,
  });
  return trip;
}

export async function createTripWriteCommand(
  data: CreateTripInput,
  actor: TripCommandActor,
  idempotencyKey?: string,
  deps: TripCommandDeps = defaultDeps,
): Promise<TripWriteCommandResult> {
  if (!idempotencyKey) {
    return { trip: await createTripCommand(data, actor, deps), replayed: false };
  }

  const outcome = await runIdempotent({
    endpoint: 'trips.create',
    idempotencyKey,
    payload: { actorId: actor.userId, data },
    createdBy: actor.userId,
    create: (tx) => deps.createTrip({ ...data, createdBy: actor.userId, createdByRole: actor.role }, tx),
    load: (tripId, tx) => loadTripRow(tx, tripId),
    entityType: 'trip',
  });
  if (!outcome.replayed) {
    await deps.invalidateReports();
    emitTripCreatedNotification(outcome.result, deps.emitNotification);
  }
  return { trip: outcome.result, replayed: outcome.replayed };
}

export async function copyTripWriteCommand(
  sourceTripId: number,
  actor: TripCommandActor,
  idempotencyKey?: string,
  deps: TripCommandDeps = defaultDeps,
): Promise<TripWriteCommandResult> {
  if (!idempotencyKey) {
    return { trip: await copyTripCommand(sourceTripId, actor, deps), replayed: false };
  }

  const outcome = await runIdempotent({
    endpoint: 'trips.copy',
    idempotencyKey,
    payload: { actorId: actor.userId, sourceTripId },
    createdBy: actor.userId,
    create: (tx) => deps.copyTrip(sourceTripId, actor.userId, tx),
    load: (tripId, tx) => loadTripRow(tx, tripId),
    entityType: 'trip',
  });
  if (!outcome.replayed) {
    await deps.invalidateReports();
    emitTripCreatedNotification(outcome.result, deps.emitNotification);
  }
  return { trip: outcome.result, replayed: outcome.replayed };
}

export async function transitionTripWriteCommand(args: {
  tripId: number;
  targetStatus: TripStatus;
  actor: TripCommandActor;
  idempotencyKey?: string;
  expectedVersion?: number;
  confirmZeroRevenue?: boolean;
  confirmNoPhoto?: boolean;
}, deps: TripCommandDeps = defaultDeps): Promise<TripWriteCommandResult> {
  const {
    tripId,
    targetStatus,
    actor,
    idempotencyKey,
    expectedVersion,
    confirmZeroRevenue,
    confirmNoPhoto,
  } = args;

  if (!idempotencyKey) {
    const trip = await deps.transitionTripStatus(
      tripId,
      targetStatus,
      actor.userId,
      actor.role,
      confirmZeroRevenue,
      confirmNoPhoto,
      { expectedVersion },
    );
    return { trip, replayed: false };
  }

  const outcome = await runIdempotent({
    endpoint: `trips.transition.${targetStatus.toLowerCase()}`,
    idempotencyKey,
    payload: {
      actorId: actor.userId,
      tripId,
      targetStatus,
      expectedVersion,
      confirmZeroRevenue: confirmZeroRevenue === true,
      confirmNoPhoto: confirmNoPhoto === true,
    },
    createdBy: actor.userId,
    create: (tx) => deps.transitionTripStatus(
      tripId,
      targetStatus,
      actor.userId,
      actor.role,
      confirmZeroRevenue,
      confirmNoPhoto,
      { expectedVersion, transaction: tx },
    ),
    load: (storedTripId, tx) => loadTripRow(tx, storedTripId),
    entityType: 'trip',
  });
  return { trip: outcome.result, replayed: outcome.replayed };
}

export async function dispatchTripWriteCommand(
  tripId: number,
  actor: TripCommandActor,
  options: { idempotencyKey?: string; expectedVersion?: number } = {},
  deps: TripCommandDeps = defaultDeps,
): Promise<TripWriteCommandResult> {
  const outcome = await transitionTripWriteCommand({
    tripId,
    targetStatus: TripStatus.IN_TRANSIT,
    actor,
    ...options,
  }, deps);
  if (!outcome.replayed) {
    await deps.invalidateReports();
    await deps.syncAttendanceAfterStatusChange(
      outcome.trip.id,
      TripStatus.IN_TRANSIT,
      outcome.trip.driverId ?? null,
      outcome.trip.departureDate ?? null,
      null,
      actor.userId,
    );
    deps.emitNotification({
      type: NotificationType.TRIP_DISPATCHED,
      title: 'Chuyến được điều phối',
      message: `Chuyến ${outcome.trip.tripCode} đã được điều phối`,
      ...driverTripEntity(outcome.trip),
      targetDriverId: outcome.trip.driverId ?? undefined,
    });
  }
  return outcome;
}
