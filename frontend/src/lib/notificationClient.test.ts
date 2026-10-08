import { describe, expect, it } from 'vitest';
import { resolveNotificationRoute } from './notificationClient';
import { routes } from './routes';

describe('resolveNotificationRoute', () => {
  it('keeps unresolved legacy fulfillment notifications on the driver board rather than guessing a trip id', () => {
    expect(resolveNotificationRoute({
      id: 1,
      userId: 7,
      type: 'TRIP_DISPATCHED',
      title: 'Trip',
      message: 'Trip ready',
      relatedEntityType: 'shipment_fulfillments',
      relatedEntityId: 88,
      isRead: false,
      createdAt: '2026-08-01T03:00:00.000Z',
    }, 'DRIVER')).toBe('/my-trips');
  });

  it('routes trip-keyed driver notifications through the trip-scoped detail route', () => {
    // Contract since card 20260915_1: /my-trips/:id reads a TRIP id. The
    // TRIP_DISPATCHED payload re-keyed to 'trips' + tripId (card 20260915_19)
    // rides this branch — both resolvers must agree with the backend mirror.
    expect(resolveNotificationRoute({
      id: 3,
      userId: 7,
      type: 'TRIP_DISPATCHED',
      title: 'Lệnh điều xe mới',
      message: 'Chuyến TRP-x đã được điều xe',
      relatedEntityType: 'trips',
      relatedEntityId: 42,
      isRead: false,
      createdAt: '2026-08-01T03:00:00.000Z',
    }, 'DRIVER')).toBe('/my-trips/42');
  });

  it.each(['FORWARDER', 'OPS'])('routes %s settlement notifications to the Ops portal', (role) => {
    expect(resolveNotificationRoute({
      id: 2,
      userId: 8,
      type: 'ADVANCE_SETTLEMENT_APPROVED',
      title: 'Settlement',
      message: 'Approved',
      relatedEntityType: 'advance_settlements',
      relatedEntityId: 91,
      isRead: false,
      createdAt: '2026-08-01T03:00:00.000Z',
    }, role)).toBe('/my-settlements/91');
  });

  // Card 051026231511 — the fund notice carries no row id, so it resolves to the
  // treasury position page for every role that can see it.
  it.each(['ACCOUNTANT', 'MANAGER', 'ADMIN'])('routes the fund notice to the treasury position page for %s', (role) => {
    expect(resolveNotificationRoute({
      id: 9,
      userId: 3,
      type: 'FUND_NEGATIVE',
      title: 'Quỹ âm',
      message: 'Cả hai quỹ đều âm — cần bổ sung dòng tiền ngay.',
      relatedEntityType: 'funds',
      relatedEntityId: null,
      isRead: false,
      createdAt: '2026-10-06T02:00:00.000Z',
    }, role)).toBe(routes.treasury);
  });
});
