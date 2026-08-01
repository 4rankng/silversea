import { describe, expect, it } from 'vitest';
import { resolveNotificationRoute } from './notificationClient';

describe('resolveNotificationRoute', () => {
  it('routes driver trip notifications to the driver task detail page', () => {
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
    }, 'DRIVER')).toBe('/my-trips/88');
  });

  it('routes forwarder settlement notifications to the forwarder portal', () => {
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
    }, 'FORWARDER')).toBe('/my-settlements/91');
  });
});
