/**
 * SIL-1293 (id 1593) — sidebar contract:
 *   1. every nav item of every role carries ITS OWN icon (the repro: three
 *      icon groups were shared by pairs/triples of items — bookmark ×2,
 *      calendar ×2, file ×3 — and read as duplicates);
 *   2. the three Title-Case stragglers ('Tổng Quan', 'Kế hoạch Tổng quát',
 *      'Quản Lý') are sentence case like the rest of the sidebar.
 * The footer scroll-clearance law stays pinned in layout/Sidebar.styles.test.ts
 * (SIL-570), which this ticket verified still holds at both repro viewports.
 */
import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';
import { getNavItems, getNavSections } from './Layout';

const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.DISPATCHER, Role.CUS, Role.OPS, Role.DRIVER, Role.CUSTOMER];
// Wide capability set so the capability-gated items (treasury, recoverables,
// executive dashboard) join their lists and take part in the uniqueness law.
const CAPS = ['treasury.read', 'recoverable_costs.read', 'executive_dashboard.read'];

describe('SIL-1293 — sidebar icons are per-item, labels sentence case', () => {
  it('gives every role a sidebar where no two items share an icon', () => {
    for (const role of ROLES) {
      const items = getNavItems(role, 0, 0, CAPS);
      expect(items.length, `${role} renders nav items`).toBeGreaterThan(0);
      const icons = items.map((item) => item.icon);
      expect(new Set(icons).size, `${role} sidebar icons must be unique per item`).toBe(icons.length);
    }
  });

  it('renames the three Title-Case stragglers to sentence case everywhere the label renders', () => {
    expect(getNavItems(Role.ACCOUNTANT)[0].label).toBe('Tổng quan');
    expect(getNavItems(Role.DISPATCHER).some((item) => item.label === 'Kế hoạch tổng quát')).toBe(true);
    expect(getNavSections(Role.DISPATCHER).some((s) => s.label === 'Quản lý')).toBe(true);
    expect(getNavSections(Role.CUS).some((s) => s.label === 'Quản lý')).toBe(true);
  });
});
