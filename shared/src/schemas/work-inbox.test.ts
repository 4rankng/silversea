import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { customerDeliveryResponseSchema, workInboxResponseSchema } from './work-inbox';

describe('work inbox contracts', () => {
  it('requires a bounded reason for a disputed delivery', () => {
    assert.equal(customerDeliveryResponseSchema.safeParse({ expectedVersion: 1, decision: 'DISPUTED' }).success, false);
    assert.equal(customerDeliveryResponseSchema.safeParse({ expectedVersion: 1, decision: 'DISPUTED', reason: 'Sai địa điểm giao' }).success, true);
  });

  it('keeps the response authority and pagination shape stable', () => {
    assert.equal(workInboxResponseSchema.safeParse({ asOf: '2026-08-22T00:00:00.000Z', timezone: 'Asia/Ho_Chi_Minh', counts: { action: 1, waiting: 0, done: 0 }, page: 1, limit: 25, total: 1, totalPages: 1, items: [{ id: 'trip:1', entityType: 'trip', entityId: 1, title: 'Chuyến #1', subtitle: null, state: 'ACTION', priority: 100, dueAt: null, freshnessAt: '2026-08-22T00:00:00.000Z', blockers: [], advisories: [], nextAction: null, targetRoute: '/my-trips/1' }] }).success, true);
  });
});
