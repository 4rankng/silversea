import { describe, expect, it } from 'vitest';

import { ACTION_LABELS, resolveCategory } from './audit-helpers';

describe('resolveCategory', () => {
  it('classifies generic finance entity events from finance route paths', () => {
    expect(resolveCategory('ENTITY_CREATED', { path: '/api/finance/billing-documents' })).toBe('finance');
  });

  it('keeps generic config entity events in the config bucket', () => {
    expect(resolveCategory('ENTITY_UPDATED', { path: '/api/config/app-settings' })).toBe('config');
  });

  it('keeps explicit finance actions in the finance bucket without a path hint', () => {
    expect(resolveCategory('PAYMENT_RECEIVED')).toBe('finance');
  });
});

describe('SIL-1023 — lot cost lock/unlock labels', () => {
  it('labels the lock and unlock actions in Vietnamese', () => {
    expect(ACTION_LABELS.SHIPMENT_COST_LOCKED).toBe('Khóa lô');
    expect(ACTION_LABELS.SHIPMENT_COST_UNLOCKED).toBe('Mở khóa lô');
  });

  it('groups both lock actions under the trip (lô hàng) category', () => {
    expect(resolveCategory('SHIPMENT_COST_LOCKED')).toBe('trip');
    expect(resolveCategory('SHIPMENT_COST_UNLOCKED')).toBe('trip');
  });
});
