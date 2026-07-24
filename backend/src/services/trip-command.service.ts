import { NotificationType, Role, TripStatus } from '@tingting/shared';
import * as tripService from './trip.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { emitNotification, type NotificationPayload } from './notification.service';

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

async function invalidateReportCaches(invalidatePnl?: boolean) {
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
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

function emitTripCreatedNotification(
  trip: TripRecord,
  emit: (payload: NotificationPayload) => void,
) {
  emit({
    type: NotificationType.TRIP_CREATED,
    title: 'Chuyến mới được tạo',
    message: `Chuyến ${trip.tripCode} đã được tạo`,
    relatedEntityType: 'trips',
    relatedEntityId: trip.id,
    targetDriverId: trip.driverId ?? undefined,
  });
}

export async function createTripCommand(
  data: CreateTripInput,
  actor: TripCommandActor,
  deps: TripCommandDeps = defaultDeps,
): Promise<TripRecord> {
  const trip = await deps.createTrip({
    ...data,
    createdBy: actor.userId,
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
    relatedEntityType: 'trips',
    relatedEntityId: trip.id,
    targetDriverId: trip.driverId ?? undefined,
  });
  return trip;
}
