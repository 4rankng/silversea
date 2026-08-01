import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';

import { getNavItems, getNavSections } from './Layout';

describe('getNavItems', () => {
  it('puts the dedicated accounting home first for ACCOUNTANT', () => {
    const items = getNavItems(Role.ACCOUNTANT);
    expect(items[0]).toMatchObject({ key: 'accounting', path: '/accounting', label: 'Tổng Quan' });
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'accounting')).toBe(false);
  });

  it('orders sidebar sections around each office role workflow', () => {
    expect(getNavSections(Role.ADMIN).map((section) => section.label)).toEqual([
      'Vận hành', 'Công nợ & dòng tiền', 'Báo cáo & phê duyệt', 'Nhân sự', 'Danh mục', 'Quản trị',
    ]);
    expect(getNavSections(Role.MANAGER).slice(0, 3).map((section) => section.label)).toEqual([
      'Vận hành', 'Báo cáo & phê duyệt', 'Công nợ & dòng tiền',
    ]);
    expect(getNavSections(Role.ACCOUNTANT).slice(0, 3).map((section) => section.label)).toEqual([
      'Công nợ & dòng tiền', 'Báo cáo & phê duyệt', 'Vận hành liên quan',
    ]);
  });

  it('removes the inaccessible dispatch route from the accountant sidebar', () => {
    expect(getNavItems(Role.ACCOUNTANT).some((item) => item.key === 'dispatch')).toBe(false);
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'dispatch')).toBe(true);
  });

  it('keeps the approved operations order while omitting unavailable actions', () => {
    const adminOperations = getNavItems(Role.ADMIN)
      .filter((item) => item.section === 'operations')
      .map((item) => item.key);
    const accountantOperations = getNavItems(Role.ACCOUNTANT)
      .filter((item) => item.section === 'operations')
      .map((item) => item.key);
    expect(adminOperations).toEqual(['fleet', 'dispatch', 'trips', 'shipments']);
    expect(accountantOperations).toEqual(['fleet', 'trips', 'shipments']);
  });

  it('keeps every role menu structurally complete and free of duplicate destinations', () => {
    for (const role of Object.values(Role)) {
      const items = getNavItems(role, undefined, undefined, ['treasury.read', 'recoverable_costs.read']);
      const sections = new Set(getNavSections(role).map((section) => section.key));
      const keys = items.map((item) => item.key);
      expect(new Set(keys).size, role).toBe(keys.length);
      expect(items.every((item) => !item.section || sections.has(item.section)), role).toBe(true);
    }
  });

  it('keeps Tổng Quan as the accountant’s only sidebar home', () => {
    const items = getNavItems(Role.ACCOUNTANT, undefined, undefined, ['executive_dashboard.read']);
    expect(items.filter((item) => !item.section).map((item) => item.label)).toEqual(['Tổng Quan']);
    expect(items.some((item) => item.key === 'dashboard')).toBe(false);
  });
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

  it('gives CLERK a shipment-first scoped workflow without broad finance links', () => {
    const items = getNavItems(Role.CLERK, undefined, undefined, ['recoverable_costs.read']);
    expect(items[0]).toEqual(expect.objectContaining({ key: 'shipments', path: '/shipments' }));
    expect(items.some((item) => item.key === 'recoverable-costs')).toBe(true);
    expect(items.some((item) => ['debt', 'payables', 'treasury', 'profit'].includes(item.key))).toBe(false);
  });

  it('shows workflow links when the role has the required capability', () => {
    expect(getNavItems(Role.ACCOUNTANT, undefined, undefined, ['treasury.read'])
      .some((item) => item.key === 'treasury')).toBe(true);
  });

  it('keeps the executive dashboard out of the active ACCOUNTANT workspace', () => {
    const items = getNavItems(Role.ACCOUNTANT, undefined, undefined, ['treasury.read']);
    expect(items.some((item) => item.key === 'dashboard')).toBe(false);
    expect(items[0]).toEqual(expect.objectContaining({ key: 'accounting' }));
  });
});
