import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';

import { getNavItems, getNavSections, getDefaultOpenSection, PRIMARY_SECTION_BY_ROLE } from './Layout';

describe('getNavItems', () => {
  it.each([
    [Role.ADMIN, [
      ['Tổng quan Quản trị', '/dashboard'],
      ['Quản lý Lô hàng', '/shipments'],
      ['Phân bổ Phương tiện (Điều vận)', '/dispatch'],
      ['Sổ chuyến đi', '/trips'],
      ['Quản lý Đội xe (Fleet)', '/fleet'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
      ['Duyệt vượt hạn mức', '/credit-overrides'],
      ['Trung tâm phê duyệt (Approve Hub)', '/governance-actions'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu (AR)', '/debt'],
      ['Công nợ phải trả (AP)', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Lương & Chấm công', '/salary'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà cung cấp / Nhà xe', '/suppliers'],
      ['Tuyến đường', '/config/routes'],
      ['Nhà máy', '/config/factories'],
      ['Cảng / Bãi & Biểu phí', '/config/ports'],
      ['Bảng giá cước', '/config/pricing-tables'],
      ['Quản lý Người dùng', '/users'],
      ['Nhật ký hệ thống (Audit Logs)', '/audit-logs'],
      ['Cài đặt ứng dụng', '/config/app-settings'],
      ['Cấu hình chung', '/config'],
    ]],
    [Role.MANAGER, [
      ['Tổng quan Quản trị', '/dashboard'],
      ['Quản lý Lô hàng', '/shipments'],
      ['Phân bổ Phương tiện (Điều vận)', '/dispatch'],
      ['Sổ chuyến đi', '/trips'],
      ['Quản lý Đội xe (Fleet)', '/fleet'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
      ['Duyệt vượt hạn mức', '/credit-overrides'],
      ['Trung tâm phê duyệt (Approve Hub)', '/governance-actions'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu (AR)', '/debt'],
      ['Công nợ phải trả (AP)', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Lương & Chấm công', '/salary'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà cung cấp / Nhà xe', '/suppliers'],
      ['Tuyến đường', '/config/routes'],
      ['Nhà máy', '/config/factories'],
      ['Cảng / Bãi & Biểu phí', '/config/ports'],
      ['Bảng giá cước', '/config/pricing-tables'],
      ['Quản lý Người dùng', '/users'],
      ['Nhật ký hệ thống (Audit Logs)', '/audit-logs'],
      ['Cấu hình chung', '/config'],
    ]],
    [Role.ACCOUNTANT, [
      ['Tổng Quan Kế Toán', '/accounting'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu (AR)', '/debt'],
      ['Công nợ phải trả (AP)', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
      ['Duyệt vượt hạn mức', '/credit-overrides'],
      ['Trung tâm phê duyệt (Approve Hub)', '/governance-actions'],
      ['Quản lý Lô hàng', '/shipments'],
      ['Sổ chuyến đi', '/trips'],
      ['Đội xe', '/fleet'],
      ['Lương & Chấm công', '/salary'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà cung cấp / Nhà xe', '/suppliers'],
      ['Bảng giá cước', '/config/pricing-tables'],
      ['Nhật ký hệ thống (Audit Logs)', '/audit-logs'],
    ]],
    [Role.DRIVER, [
      ['Hành trình của tôi', '/my-trips'],
      ['Thu nhập', '/my-earnings'],
      ['Kỷ luật', '/my-penalties'],
    ]],
    [Role.OPS, [
      ['Lệnh giao nhận (Đổi lệnh)', '/my-orders'],
      ['Yêu cầu Tạm ứng', '/my-advances'],
      ['Phiếu thanh toán / Hoàn ứng', '/my-settlements'],
    ]],
    [Role.CUS, [
      ['Quản lý Lô hàng', '/shipments'],
      ['Chi phí cần kiểm tra', '/recoverable-costs'],
    ]],
    [Role.DISPATCHER, [
      ['Kế hoạch Tổng quát (Gán Nhà xe)', '/dispatch/master-plan'],
      ['Kế hoạch Chi tiết (Gán BKS)', '/dispatch/detailed-plan'],
      ['Theo dõi Lộ trình', '/dispatch/live-tracking'],
      ['Danh mục Xe nội bộ', '/fleet/vehicles'],
      ['Danh mục Tài xế', '/fleet/drivers'],
      ['Nhà thầu phụ (Subcontractors)', '/suppliers'],
    ]],
    [Role.CUSTOMER, [
      ['Lô hàng của tôi', '/portal/shipments'],
      ['Giấy báo nợ (Debit Notes)', '/portal/debit-notes'],
      ['Sao kê công nợ', '/portal/statement'],
    ]],
  ] as const)('matches the approved exact label and path matrix for %s', (role, expected) => {
    const actual = getNavItems(role, undefined, undefined, ['treasury.read', 'recoverable_costs.read'])
      .map(({ label, path }) => [label, path]);
    expect(actual).toEqual(expected);
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
    // Công nợ & Dòng tiền → Báo cáo & Phê duyệt → Vận hành liên quan → Nhân sự → Danh mục → Hệ thống
    expect(getNavSections(Role.ACCOUNTANT).map((section) => section.label)).toEqual([
      'Công nợ & Dòng tiền', 'Báo cáo & Phê duyệt', 'Vận hành liên quan', 'Nhân sự', 'Danh mục', 'Hệ thống',
    ]);
  });

  it('removes the inaccessible dispatch route from the accountant sidebar', () => {
    expect(getNavItems(Role.ACCOUNTANT).some((item) => item.key === 'dispatch')).toBe(false);
    expect(getNavItems(Role.MANAGER).some((item) => item.key === 'dispatch')).toBe(true);
  });

  it('keeps the approved operations order while omitting unavailable actions', () => {
    // Spec §III.1 ADMIN/MANAGER operations order:
    // Quản lý Lô hàng → Phân bổ Phương tiện → Sổ chuyến đi → Quản lý Đội xe
    const adminOperations = getNavItems(Role.ADMIN)
      .filter((item) => item.section === 'operations')
      .map((item) => item.key);
    const accountantOperations = getNavItems(Role.ACCOUNTANT)
      .filter((item) => item.section === 'operations')
      .map((item) => item.key);
    expect(adminOperations).toEqual(['shipments', 'dispatch', 'trips', 'fleet']);
    expect(accountantOperations).toEqual(['shipments', 'trips', 'fleet']);
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
    // Spec §III.1/III.2 — "Trung tâm phê duyệt (Approve Hub)"
    const expectedLabel = 'Trung tâm phê duyệt (Approve Hub)';
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
    const items = getNavItems(Role.CUS, undefined, undefined, ['recoverable_costs.read']);
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
