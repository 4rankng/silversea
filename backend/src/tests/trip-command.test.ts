import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationType, Role, TripStatus } from '@tingting/shared';
import { copyTripCommand, createTripCommand, dispatchTripCommand, type TripCommandDeps } from '../services/trip-command.service';

describe('trip command service', () => {
  it('creates a trip, invalidates dashboard reports, emits creation notification, and returns the trip', async () => {
    const calls: string[] = [];
    const notifications: unknown[] = [];
    const trip = { id: 42, tripCode: 'TRP-202606-0042', driverId: 7, departureDate: '2026-06-20', fulfillmentId: 4200 };
    const deps = {
      createTrip: async (data: unknown) => {
        calls.push(`create:${JSON.stringify(data)}`);
        return trip;
      },
      transitionTripStatus: async () => { throw new Error('not used'); },
      syncAttendanceAfterStatusChange: async () => { throw new Error('not used'); },
      invalidateReports: async (invalidatePnl?: boolean) => {
        calls.push(`invalidate:${String(invalidatePnl)}`);
      },
      emitNotification: (payload: unknown) => {
        calls.push('notify');
        notifications.push(payload);
      },
    } as unknown as TripCommandDeps;

    const result = await createTripCommand({
      customerId: 1,
      routeId: 2,
      cargoTypeId: 3,
      containerTypeId: 4,
      departureDate: '2026-06-20',
    }, { userId: 99, role: Role.ADMIN }, deps);

    assert.equal(result, trip);
    assert.match(calls[0], /"createdBy":99/);
    assert.equal(calls[1], 'invalidate:undefined');
    assert.equal(calls[2], 'notify');
    assert.deepEqual(notifications[0], {
      type: NotificationType.TRIP_CREATED,
      title: 'Chuyến mới được tạo',
      message: 'Chuyến TRP-202606-0042 đã được tạo',
      // Driver-only notification (targetDriverId, no targetRoles/targetUserId)
      // — /my-trips/:id is trip-scoped (card 20260915_1), so the deep link
      // keys on the trip id.
      relatedEntityType: 'trips',
      relatedEntityId: 42,
      targetDriverId: 7,
    });
  });

  it('copies a trip, invalidates reports, and emits the standard creation notification', async () => {
    const calls: string[] = [];
    const notifications: unknown[] = [];
    const trip = { id: 43, tripCode: 'TRP-202606-0043', driverId: 7, departureDate: '2026-06-20', fulfillmentId: 4300 };
    const deps = {
      copyTrip: async (sourceTripId: number, createdBy: number) => {
        calls.push(`copy:${sourceTripId}:${createdBy}`);
        return trip;
      },
      invalidateReports: async () => {
        calls.push('invalidate');
      },
      emitNotification: (payload: unknown) => {
        calls.push('notify');
        notifications.push(payload);
      },
    } as unknown as TripCommandDeps;

    const result = await copyTripCommand(42, { userId: 99, role: Role.MANAGER }, deps);

    assert.equal(result, trip);
    assert.deepEqual(calls, ['copy:42:99', 'invalidate', 'notify']);
    assert.deepEqual(notifications[0], {
      type: NotificationType.TRIP_CREATED,
      title: 'Chuyến mới được tạo',
      message: 'Chuyến TRP-202606-0043 đã được tạo',
      relatedEntityType: 'trips',
      relatedEntityId: 43,
      targetDriverId: 7,
    });
  });

  it('dispatches a trip through the lifecycle service before attendance sync and notification', async () => {
    const calls: string[] = [];
    const notifications: unknown[] = [];
    const trip = { id: 55, tripCode: 'TRP-202606-0055', driverId: 8, departureDate: '2026-06-21', fulfillmentId: 5500 };
    const deps = {
      createTrip: async () => { throw new Error('not used'); },
      transitionTripStatus: async (tripId: number, status: TripStatus, userId: number, role: Role) => {
        calls.push(`transition:${tripId}:${status}:${userId}:${role}`);
        return trip;
      },
      syncAttendanceAfterStatusChange: async (tripId: number, status: TripStatus, driverId: number | null, departureDate: string | null, _arrival: string | null, userId: number) => {
        calls.push(`attendance:${tripId}:${status}:${driverId}:${departureDate}:${userId}`);
      },
      invalidateReports: async (invalidatePnl?: boolean) => {
        calls.push(`invalidate:${String(invalidatePnl)}`);
      },
      emitNotification: (payload: unknown) => {
        calls.push('notify');
        notifications.push(payload);
      },
    } as unknown as TripCommandDeps;

    const result = await dispatchTripCommand(55, { userId: 99, role: Role.MANAGER }, deps);

    assert.equal(result, trip);
    assert.deepEqual(calls, [
      'transition:55:IN_TRANSIT:99:MANAGER',
      'invalidate:undefined',
      'attendance:55:IN_TRANSIT:8:2026-06-21:99',
      'notify',
    ]);
    assert.deepEqual(notifications[0], {
      type: NotificationType.TRIP_DISPATCHED,
      title: 'Chuyến được điều phối',
      message: 'Chuyến TRP-202606-0055 đã được điều phối',
      relatedEntityType: 'trips',
      relatedEntityId: 55,
      targetDriverId: 8,
    });
  });
});
