import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotificationType, Role } from '@tingting/shared';
import { buildNotificationPayload } from '../services/dispatch-planning-utils.service';
import { notificationUrlForRole } from '../services/notification.service';

// Card 20260915_19: the driver's dispatch notification must deep-link the
// TRIP, because /my-trips/:id has been trip-scoped since card 20260915_1
// (DriverTripDetailPage fetches getDriverTrip(tripId)). The payload used to
// carry 'shipment_fulfillments' + fulfillmentId, which both resolvers fed
// into the trip-scoped route — the driver landed on the wrong trip or an
// ownership 403. The 'trips' + tripId payload rides the DRIVER branch that
// is already correct on both sides (FE resolveNotificationRoute and the BE
// push mirror must agree).

describe('TRIP_DISPATCHED notification entity contract', () => {
  it('buildNotificationPayload keys the deep link on the trip id, not the fulfillment id', () => {
    const payload = buildNotificationPayload({
      id: 42,
      tripCode: 'TRP-202606-0042',
      driverId: 7,
      fulfillmentId: 4200,
    });
    assert.equal(payload.type, NotificationType.TRIP_DISPATCHED);
    assert.equal(payload.relatedEntityType, 'trips');
    assert.equal(payload.relatedEntityId, 42);
    assert.equal(payload.targetDriverId, 7);
  });

  it('push deep link for a trips payload lands the driver on their trip route', () => {
    const url = notificationUrlForRole({
      type: NotificationType.TRIP_DISPATCHED,
      title: 'Lệnh điều xe mới',
      message: 'Chuyến TRP-202606-0042 đã được điều xe',
      relatedEntityType: 'trips',
      relatedEntityId: 42,
      targetDriverId: 7,
    }, Role.DRIVER);
    assert.equal(url, '/my-trips/42');
  });
});
