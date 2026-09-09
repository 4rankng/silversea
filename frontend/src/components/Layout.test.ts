import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';

import {
  getNavItems,
  getNavSections,
  getDefaultOpenSection,
  PRIMARY_SECTION_BY_ROLE,
  resolveInitialSidebarOpen,
  COMPACT_DESKTOP_MEDIA_QUERY,
  getPageTitle,
} from './Layout';

describe('getNavItems', () => {
  it.each([
    [Role.ADMIN, [
      ['Tổng quan Quản trị', '/dashboard'],
      ['Tổng quan lô hàng', '/shipments'],
      ['Điều vận', '/dispatch'],
      ['Sổ chuyến đi', '/trips'],
      ['Đội xe', '/fleet'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
      ['Duyệt vượt hạn mức', '/credit-overrides'],
      ['Trung tâm phê duyệt', '/governance-actions'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu', '/debt'],
      ['Công nợ phải trả', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Lương & Chấm công', '/salary'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà cung cấp / Nhà xe', '/suppliers'],
      ['Tuyến đường', '/config/routes'],
      ['Nhà máy / Kho', '/config/factories'],
      ['Cảng / Bãi & Biểu phí', '/config/ports'],
      ['Bảng giá cước', '/config/pricing-tables'],
      ['Trung tâm quản trị', '/admin-center'],
      ['Quản lý Người dùng', '/users'],
      ['Nhật ký hệ thống', '/audit-logs'],
      ['Cài đặt ứng dụng', '/config/app-settings'],
      ['Cấu hình chung', '/config'],
    ]],
    [Role.MANAGER, [
      ['Tổng quan Quản trị', '/dashboard'],
      ['Tổng quan lô hàng', '/shipments'],
      ['Điều vận', '/dispatch'],
      ['Sổ chuyến đi', '/trips'],
      ['Đội xe', '/fleet'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
      ['Duyệt vượt hạn mức', '/credit-overrides'],
      ['Trung tâm phê duyệt', '/governance-actions'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu', '/debt'],
      ['Công nợ phải trả', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Lương & Chấm công', '/salary'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà cung cấp / Nhà xe', '/suppliers'],
      ['Tuyến đường', '/config/routes'],
      ['Nhà máy / Kho', '/config/factories'],
      ['Cảng / Bãi & Biểu phí', '/config/ports'],
      ['Bảng giá cước', '/config/pricing-tables'],
      ['Quản lý Người dùng', '/users'],
      ['Nhật ký hệ thống', '/audit-logs'],
      ['Cấu hình chung', '/config'],
    ]],
    [Role.ACCOUNTANT, [
      ['Tổng Quan Kế Toán', '/accounting'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu', '/debt'],
      ['Công nợ phải trả', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Giá dầu DO theo kỳ', '/config/fuel-price-periods'],
      ['Điều khoản cước theo tuyến', '/config/freight-rate-terms'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
      ['Duyệt vượt hạn mức', '/credit-overrides'],
      ['Trung tâm phê duyệt', '/governance-actions'],
      ['Tổng quan lô hàng', '/shipments'],
      ['Nhật ký hệ thống', '/audit-logs'],
    ]],
    [Role.DRIVER, [
      ['Hành trình của tôi', '/my-trips'],
      ['Thông báo', '/notifications'],
      ['Thu nhập', '/my-earnings'],
      ['Kỷ luật', '/my-penalties'],
    ]],
    [Role.OPS, [
      ['Kế hoạch làm hàng', '/ops/orders'],
      ['Theo dõi phương tiện', '/ops/fleet-tracking'],
      ['Quỹ tạm ứng', '/ops/wallet'],
      ['Lệnh giao nhận', '/my-orders'],
      ['Yêu cầu Tạm ứng', '/my-advances'],
      ['Phiếu thanh toán / Hoàn ứng', '/my-settlements'],
    ]],
    [Role.CUS, [
      ['Tổng quan lô hàng', '/shipments'],
      ['Chi tiết lô hàng', '/shipments-detail'],
      ['Chi phí cần kiểm tra', '/recoverable-costs'],
      ['Khách hàng', '/config/customers'],
      ['Tuyến đường', '/config/routes'],
      ['Giá dầu DO theo kỳ', '/config/fuel-price-periods'],
    ]],
    [Role.DISPATCHER, [
      ['Kế hoạch tổng quát', '/dispatch'],
      ['Kế hoạch chi tiết', '/dispatch-detail'],
      ['Xe nội bộ', '/fleet/vehicles'],
      ['Tài xế', '/fleet/drivers'],
      ['Nhà thầu', '/suppliers'],
      ['Khách hàng', '/config/customers'],
      ['Tuyến đường', '/config/routes'],
    ]],
    [Role.CUSTOMER, [
      ['Lô hàng của tôi', '/portal/shipments'],
      ['Giấy báo nợ', '/portal/debit-notes'],
      ['Sao kê công nợ', '/portal/statement'],
    ]],
  ] as const)('matches the approved exact label and path matrix for %s', (role, expected) => {
    const actual = getNavItems(role, undefined, undefined, ['treasury.read', 'recoverable_costs.read'])
      .map(({ label, path }) => [label, path]);
    expect(actual).toEqual(expected);
  });

  it('omits live-route tracking from the dispatcher sidebar without changing its route', () => {
    const items = getNavItems(Role.DISPATCHER);
    expect(items.some((item) => item.path === '/dispatch/live-tracking')).toBe(false);
  });

  it('keeps the Ops navigation usable for legacy FORWARDER sessions', () => {
    expect(getNavItems('FORWARDER')).toEqual(getNavItems(Role.OPS));
    expect(getNavSections('FORWARDER')).toEqual(getNavSections(Role.OPS));
    expect(getDefaultOpenSection('FORWARDER')).toBe('my-work');
  });

  it('puts the dedicated accounting home first for ACCOUNTANT', () => {
    const items = getNavItems(Role.ACCOUNTANT);
    expect(items[0]).toMatchObject({ key: 'accounting', path: '/accounting', label: 'Tổng Quan Kế Toán' });
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'accounting')).toBe(false);
  });

  it('orders sidebar sections around each office role workflow per spec', () => {
    // Spec §III.1 — ADMIN/MANAGER section order:
    // Vận hành → Báo cáo & Phê duyệt → Công nợ & Dòng tiền → Nhân sự → Danh mục → Hệ thống
    expect(getNavSections(Role.ADMIN).map((section) => section.label)).toEqual([
      'Vận hành', 'Báo cáo & Phê duyệt', 'Công nợ & Dòng tiền', 'Nhân sự', 'Danh mục', 'Hệ thống',
    ]);
    expect(getNavSections(Role.MANAGER).map((section) => section.label)).toEqual([
      'Vận hành', 'Báo cáo & Phê duyệt', 'Công nợ & Dòng tiền', 'Nhân sự', 'Danh mục', 'Hệ thống',
    ]);
    // Spec §III.2 — ACCOUNTANT:
    // Công nợ & Dòng tiền → Báo cáo & Phê duyệt → Vận hành liên quan → Hệ thống.
    // Nhân sự + Danh mục are gone: all their ACCOUNTANT items were
    // adminOnly-bounced dead links, so the sections went with them.
    expect(getNavSections(Role.ACCOUNTANT).map((section) => section.label)).toEqual([
      'Công nợ & Dòng tiền', 'Báo cáo & Phê duyệt', 'Vận hành liên quan', 'Hệ thống',
    ]);
  });

  it('offers the accountant no adminOnly-bounced destination', () => {
    // App.tsx bounces ACCOUNTANT off every adminOnly route (and the
    // non-dispatcher /suppliers branch). Each of these nav keys used to be a
    // silent dead link that re-rendered /accounting unchanged.
    const deadKeys = ['trips', 'fleet', 'penalties', 'customers', 'salary', 'suppliers', 'config-pricing'];
    const items = getNavItems(Role.ACCOUNTANT, undefined, undefined, ['treasury.read']);
    for (const key of deadKeys) {
      expect(items.some((item) => item.key === key), key).toBe(false);
    }
    // Every remaining accountant destination must stay reachable: only
    // financeReader/officeStaff/shipmentReader-guarded paths survive.
    expect(items.map((item) => item.path)).toEqual([
      '/accounting', '/finance/treasury', '/debt', '/payables', '/expenses', '/advances',
      '/config/fuel-price-periods', '/config/freight-rate-terms',
      '/finance', '/profit', '/credit-overrides', '/governance-actions', '/shipments', '/audit-logs',
    ]);
  });

  it('removes the inaccessible dispatch route from the accountant sidebar', () => {
    expect(getNavItems(Role.ACCOUNTANT).some((item) => item.key === 'dispatch')).toBe(false);
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'dispatch')).toBe(true);
  });

  it('keeps the approved operations order while omitting unavailable actions', () => {
    // Spec §III.1 ADMIN/MANAGER operations order:
    // Tổng quan lô hàng → Phân bổ Phương tiện → Sổ chuyến đi → Quản lý Đội xe
    const adminOperations = getNavItems(Role.ADMIN)
      .filter((item) => item.section === 'operations')
      .map((item) => item.key);
    const accountantOperations = getNavItems(Role.ACCOUNTANT)
      .filter((item) => item.section === 'operations')
      .map((item) => item.key);
    expect(adminOperations).toEqual(['shipments', 'dispatch', 'trips', 'fleet']);
    expect(accountantOperations).toEqual(['shipments']);
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

  it('keeps every sidebar label Vietnamese-only without parenthetical aliases', () => {
    for (const role of Object.values(Role)) {
      const labels = getNavItems(role, undefined, undefined, ['treasury.read', 'recoverable_costs.read'])
        .map((item) => item.label);
      expect(labels.some((label) => /[()]/.test(label)), role).toBe(false);
      expect(labels.some((label) => /\b(Fleet|Approve|Audit|Subcontractors|Debit Notes)\b/i.test(label)), role).toBe(false);
    }
  });

  it('keeps Tổng Quan Kế Toán as the accountant’s only sidebar home', () => {
    const items = getNavItems(Role.ACCOUNTANT, undefined, undefined, ['executive_dashboard.read']);
    expect(items.filter((item) => !item.section).map((item) => item.label)).toEqual(['Tổng Quan Kế Toán']);
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

  it('includes the governance inbox for office roles only with spec-compliant label', () => {
    const expectedLabel = 'Trung tâm phê duyệt';
    expect(getNavItems(Role.ADMIN).some((item) => (
      item.key === 'governance-actions'
      && item.path === '/governance-actions'
      && item.label === expectedLabel
    ))).toBe(true);
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'governance-actions' && item.path === '/governance-actions' && item.label === expectedLabel)).toBe(true);
    expect(getNavItems(Role.ACCOUNTANT).some((item) => item.key === 'governance-actions' && item.path === '/governance-actions' && item.label === expectedLabel)).toBe(true);
    expect(getNavItems(Role.DRIVER).some((item) => item.key === 'governance-actions')).toBe(false);
  });

  it('uses one canonical advance workspace item for office roles', () => {
    const items = getNavItems(Role.ADMIN);
    expect(items.filter((item) => item.key === 'advances')).toEqual([
      expect.objectContaining({
        label: 'Tạm ứng & Hoàn ứng',
        path: '/advances',
      }),
    ]);
    expect(items.some((item) => item.key === 'advance-settlements')).toBe(false);
  });

  it('keeps admin-only app settings out of the ACCOUNTANT nav', () => {
    const items = getNavItems(Role.ACCOUNTANT);
    expect(items.some((item) => item.key === 'app-settings')).toBe(false);
  });

  it('gives CUS a shipment-first scoped workflow without broad finance links', () => {
    // recoverable-costs left the CUS clerk's hands (2026-09-06): the role no
    // longer carries recoverable_costs.* capabilities (policy.csv), so the
    // default CUS capability set must render no reconciliation entry.
    const items = getNavItems(Role.CUS, undefined, undefined, []);
    expect(items[0]).toEqual(expect.objectContaining({ key: 'shipments', path: '/shipments' }));
    expect(items.some((item) => item.key === 'recoverable-costs')).toBe(false);
    expect(items.some((item) => ['debt', 'payables', 'treasury', 'profit'].includes(item.key))).toBe(false);
  });

  it('shows CUS only the document-ops and catalog items without the recoverable-costs capability', () => {
    const items = getNavItems(Role.CUS);
    expect(items.map(({ key }) => key)).toEqual(['shipments', 'shipment-containers', 'customers', 'config-routes', 'config-fuel-price-periods']);
    expect(items[1]).toEqual(expect.objectContaining({ key: 'shipment-containers', path: '/shipments-detail' }));
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

describe('getPageTitle', () => {
  it('uses dispatcher language for the shared supplier route', () => {
    expect(getPageTitle('/suppliers', Role.DISPATCHER)).toBe('Nhà thầu');
    expect(getPageTitle('/suppliers', Role.ADMIN)).toBe('Nhà cung cấp');
  });
});

describe('getDefaultOpenSection / PRIMARY_SECTION_BY_ROLE', () => {
  it('covers every supported role with a primary section per spec §II', () => {
    // ADMIN/MANAGER → Vận hành; ACCOUNTANT → Công nợ & Dòng tiền;
    // DISPATCHER → Điều độ Phương tiện; CUS → Nghiệp vụ Chứng từ;
    // OPS/DRIVER → Công việc của tôi; CUSTOMER → Portal.
    expect(PRIMARY_SECTION_BY_ROLE).toEqual({
      ADMIN: 'operations',
      MANAGER: 'operations',
      ACCOUNTANT: 'financials',
      DISPATCHER: 'dispatch-planning',
      CUS: 'document-ops',
      OPS: 'my-work',
      DRIVER: 'my-work',
      CUSTOMER: 'portal',
    });
  });

  it.each([
    [Role.ADMIN, 'operations'],
    [Role.MANAGER, 'operations'],
    [Role.ACCOUNTANT, 'financials'],
    [Role.DISPATCHER, 'dispatch-planning'],
    [Role.CUS, 'document-ops'],
    [Role.OPS, 'my-work'],
    [Role.DRIVER, 'my-work'],
    [Role.CUSTOMER, 'portal'],
  ] as const)('returns the spec-defined primary section for %s', (role, expected) => {
    expect(getDefaultOpenSection(role)).toBe(expected);
  });

  it('returns undefined for unknown / empty role so callers can fall back', () => {
    expect(getDefaultOpenSection(undefined)).toBeUndefined();
    expect(getDefaultOpenSection('')).toBeUndefined();
    expect(getDefaultOpenSection('NOT_A_ROLE' as unknown as Role)).toBeUndefined();
  });
});

describe('resolveInitialSidebarOpen / COMPACT_DESKTOP_MEDIA_QUERY', () => {
  it('starts with the sidebar open only on wide desktop viewports (≥1440px)', () => {
    expect(resolveInitialSidebarOpen(1920)).toBe(true);
    expect(resolveInitialSidebarOpen(1440)).toBe(true);
    expect(resolveInitialSidebarOpen(1439)).toBe(false);
    expect(resolveInitialSidebarOpen(1280)).toBe(false);
    expect(resolveInitialSidebarOpen(1024)).toBe(false);
  });

  it('scopes the compact-desktop range to 1024–1439px so mobile (≤1023px) stays untouched', () => {
    expect(COMPACT_DESKTOP_MEDIA_QUERY).toBe('(min-width: 1024px) and (max-width: 1439px)');
  });
});
