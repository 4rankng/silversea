import { describe, expect, it } from 'vitest';
import { filterItems, getSearchItems } from './searchRegistry';

/**
 * SIL-703 (id 823) — the reporting-policy ("phiên bản chính sách báo cáo")
 * page was reported as "not found": QA swept /admin-center, /settings,
 * /system-config and the topbar search. The page never moved — it is the
 * ADMIN-only /config/app-settings → "Chính sách báo cáo" tab (SIL-197 fixed
 * the Cmd-K description so the operator's own words reach it).
 *
 * This pin keeps the ENTRY discoverable: the search palette answers the
 * words the card used, and the entry stays ADMIN-only (the route guard is
 * strictAdminOnly).
 */
describe('the reporting-policy entry point (SIL-703)', () => {
  it('the Cmd-K palette finds the policy surface by its own vocabulary', () => {
    const admin = getSearchItems('ADMIN');
    const entry = admin.find((item) => item.id === 'app-settings');
    expect(entry?.path).toBe('/config/app-settings');
    expect(entry?.description).toMatch(/Chính sách báo cáo/);
    expect(entry?.adminOnly).toBe(true);

    // The words an operator (and the QA sweep) searches for.
    expect(filterItems(admin, 'chính sách báo cáo').map((item) => item.id)).toContain('app-settings');
    expect(filterItems(admin, 'phiên bản').map((item) => item.id)).toContain('app-settings');
  });

  it('MANAGER does not see the entry — the route is ADMIN-only', () => {
    expect(getSearchItems('MANAGER').find((item) => item.id === 'app-settings')).toBeUndefined();
  });
});
