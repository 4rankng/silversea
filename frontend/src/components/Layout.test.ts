import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';

import { getNavItems } from './Layout';

describe('getNavItems', () => {
  it('includes audit logs for ACCOUNTANT in the shared office nav source', () => {
    const items = getNavItems(Role.ACCOUNTANT);
    expect(items.some((item) => item.key === 'audit-logs' && item.path === '/audit-logs')).toBe(true);
  });

  it('includes the dedicated credit-override approval queue for office roles only', () => {
    expect(getNavItems(Role.ADMIN).some((item) => item.key === 'credit-overrides' && item.path === '/credit-overrides')).toBe(true);
    expect(getNavItems(Role.ACCOUNTANT).some((item) => item.key === 'credit-overrides' && item.path === '/credit-overrides')).toBe(true);
    expect(getNavItems(Role.CUSTOMER).some((item) => item.key === 'credit-overrides')).toBe(false);
  });

  it('includes the governance inbox for office roles only', () => {
    expect(getNavItems(Role.ADMIN).some((item) => (
      item.key === 'governance-actions'
      && item.path === '/governance-actions'
      && item.label === 'Trung tâm phê duyệt'
    ))).toBe(true);
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'governance-actions' && item.path === '/governance-actions')).toBe(true);
    expect(getNavItems(Role.ACCOUNTANT).some((item) => item.key === 'governance-actions' && item.path === '/governance-actions')).toBe(true);
    expect(getNavItems(Role.DRIVER).some((item) => item.key === 'governance-actions')).toBe(false);
  });

  it('uses one canonical advance workspace item for office roles', () => {
    const items = getNavItems(Role.ADMIN);
    expect(items.filter((item) => item.key === 'advances')).toEqual([
      expect.objectContaining({
        label: 'Tạm ứng & hoàn ứng',
        path: '/advances',
      }),
    ]);
    expect(items.some((item) => item.key === 'advance-settlements')).toBe(false);
  });

  it('keeps admin-only app settings out of the ACCOUNTANT nav', () => {
    const items = getNavItems(Role.ACCOUNTANT);
    expect(items.some((item) => item.key === 'app-settings')).toBe(false);
  });
});
