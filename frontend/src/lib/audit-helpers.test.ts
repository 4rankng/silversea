import { describe, expect, it } from 'vitest';

import { resolveCategory } from './audit-helpers';

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
