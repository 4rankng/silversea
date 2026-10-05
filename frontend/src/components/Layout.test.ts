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
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu', '/debt'],
      ['Công nợ phải trả', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Báo cáo hoàn ứng', '/accounting/hoan-ung'],
      ['Theo dõi hóa đơn', '/accounting/invoice-tracking'],
      ['Theo dõi hoàn cược', '/accounting/deposit-tracker'],
      ['Kiểm soát phơi phiếu', '/accounting/phoi-phieu'],
      ['Kế toán chốt debit', '/accounting/chot-debit'],
      ['Lương & Chấm công', '/salary'],
      ['Danh sách nhân sự', '/hr/roster'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà xe / Nhà cung cấp', '/suppliers'],
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
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu', '/debt'],
      ['Công nợ phải trả', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Báo cáo hoàn ứng', '/accounting/hoan-ung'],
      ['Lương & Chấm công', '/salary'],
      ['Danh sách nhân sự', '/hr/roster'],
      ['Kỷ luật', '/penalties'],
      ['Khách hàng', '/customers'],
      ['Nhà xe / Nhà cung cấp', '/suppliers'],
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
      ['Theo dõi hóa đơn', '/accounting/invoice-tracking'],
      ['Theo dõi hoàn cược', '/accounting/deposit-tracker'],
      ['Kiểm soát phơi phiếu', '/accounting/phoi-phieu'],
      ['Kế toán chốt debit', '/accounting/chot-debit'],
      ['Sổ quỹ / Ngân hàng', '/finance/treasury'],
      ['Công nợ phải thu', '/debt'],
      ['Công nợ phải trả', '/payables'],
      ['Chi phí phát sinh', '/expenses'],
      ['Tạm ứng & Hoàn ứng', '/advances'],
      ['Báo cáo hoàn ứng', '/accounting/hoan-ung'],
      ['Lương & Chấm công', '/salary'],
      ['Danh sách nhân sự', '/hr/roster'],
      ['Giá dầu theo kỳ', '/config/fuel-price-periods'],
      ['Điều khoản cước theo tuyến', '/config/freight-rate-terms'],
      ['Báo cáo Lãi lỗ', '/finance'],
      ['Báo cáo Lợi nhuận', '/profit'],
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
      ['Chi phí - Quyết toán', '/shipments-debit'],
      ['Theo dõi hóa đơn', '/accounting/invoice-tracking'],
      // Card 20260922_29: Theo dõi hoàn cược removed for CUS — the route
      // guard admits only ADMIN/MANAGER/ACCOUNTANT; nav must not advertise
      // a path the role cannot open.
      ['Chi phí cần kiểm tra', '/recoverable-costs'],
      ['Khách hàng', '/config/customers'],
      ['Tuyến đường', '/config/routes'],
      ['Giá dầu theo kỳ', '/config/fuel-price-periods'],
      ['Nhà máy / Kho', '/config/factories'],
    ]],
    [Role.DISPATCHER, [
      ['Kế hoạch tổng quát', '/dispatch'],
      ['Kế hoạch chi tiết', '/dispatch-detail'],
      ['Xe nội bộ', '/fleet/vehicles'],
      ['Tài xế', '/fleet/drivers'],
      ['Xe ngoài', '/fleet/external'],
      ['Nhà thầu', '/suppliers'],
      ['Khách hàng', '/config/customers'],
      ['Tuyến đường', '/config/routes'],
      ['Nhà máy / Kho', '/config/factories'],
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
    // Spec §5.10 — the single "Công nợ & Dòng tiền" group is split into the
    // 4 spec danh mục, in the slot the old group occupied (after Báo cáo,
    // before Nhân sự).
    // Spec §III.1 — ADMIN/MANAGER section order:
    // Vận hành → Báo cáo → Phơi phiếu → Công nợ vận tải → Quỹ → Khác →
    // Nhân sự → Danh mục → Hệ thống
    expect(getNavSections(Role.ADMIN).map((section) => section.label)).toEqual([
      'Vận hành', 'Báo cáo', 'Phơi phiếu', 'Công nợ vận tải', 'Quỹ', 'Khác',
      'Nhân sự', 'Danh mục', 'Hệ thống',
    ]);
    expect(getNavSections(Role.MANAGER).map((section) => section.label)).toEqual([
      'Vận hành', 'Báo cáo', 'Phơi phiếu', 'Công nợ vận tải', 'Quỹ', 'Khác',
      'Nhân sự', 'Danh mục', 'Hệ thống',
    ]);
    // Spec §III.2 — ACCOUNTANT: the 4 danh mục first, then "Giá & cước" (the
    // pricing master data), Báo cáo → Vận hành liên quan → Hệ thống.
    // "Giá & cước" is deliberately NOT "Danh mục": the spec's own 4 groups
    // already use that word, so a 5th group sharing it reads as a duplicate.
    expect(getNavSections(Role.ACCOUNTANT).map((section) => section.label)).toEqual([
      'Phơi phiếu', 'Công nợ vận tải', 'Quỹ', 'Khác',
      'Giá & cước', 'Báo cáo', 'Vận hành liên quan', 'Hệ thống',
    ]);
  });

  it('offers the accountant no adminOnly-bounced destination', () => {
    // App.tsx bounces ACCOUNTANT off every adminOnly route (and the
    // non-dispatcher /suppliers branch). Each of these nav keys used to be a
    // silent dead link that re-rendered /accounting unchanged.
    // 'salary' is NOT in this set: /salary is guarded by `officeStaffOnly`,
    // which admits ACCOUNTANT (App.tsx), and GET /api/salary answers 200 for
    // an accountant session. Do not re-add it here.
    const deadKeys = ['trips', 'fleet', 'penalties', 'customers', 'suppliers', 'config-pricing'];
    const items = getNavItems(Role.ACCOUNTANT, undefined, undefined, ['treasury.read']);
    for (const key of deadKeys) {
      expect(items.some((item) => item.key === key), key).toBe(false);
    }
    // Every remaining accountant destination must stay reachable: only
    // financeReader/officeStaff/shipmentReader-guarded paths survive.
    expect(items.map((item) => item.path)).toEqual([
      '/accounting', '/accounting/invoice-tracking', '/accounting/deposit-tracker', '/accounting/phoi-phieu', '/accounting/chot-debit', '/finance/treasury', '/debt', '/payables', '/expenses', '/advances', '/accounting/hoan-ung', '/salary', '/hr/roster',
      '/config/fuel-price-periods', '/config/freight-rate-terms',
      '/finance', '/profit', '/shipments', '/audit-logs',
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

  it('exposes the phoi-phieu control page to ACCOUNTANT and ADMIN only (20260922_5)', () => {
    for (const role of [Role.ADMIN, Role.ACCOUNTANT]) {
      expect(getNavItems(role).find((item) => item.key === 'phoi-phieu'), role)
        .toEqual(expect.objectContaining({ label: 'Kiểm soát phơi phiếu', path: '/accounting/phoi-phieu' }));
    }
    for (const role of [Role.MANAGER, Role.DISPATCHER, Role.CUS, Role.OPS, Role.DRIVER, Role.CUSTOMER]) {
      expect(getNavItems(role).some((item) => item.key === 'phoi-phieu'), role).toBe(false);
    }
  });

  it('exposes the chot-debit board to ACCOUNTANT and ADMIN only (20260921_21)', () => {
    for (const role of [Role.ADMIN, Role.ACCOUNTANT]) {
      expect(getNavItems(role).find((item) => item.key === 'chot-debit'), role)
        .toEqual(expect.objectContaining({ label: 'Kế toán chốt debit', path: '/accounting/chot-debit' }));
    }
    for (const role of [Role.MANAGER, Role.DISPATCHER, Role.CUS, Role.OPS, Role.DRIVER, Role.CUSTOMER]) {
      expect(getNavItems(role).some((item) => item.key === 'chot-debit'), role).toBe(false);
    }
  });

  it('does not advertise internal approval workflows in role navigation', () => {
    for (const role of Object.values(Role)) {
      expect(getNavSections(role).some(section => /phê duyệt/i.test(section.label)), role).toBe(false);
      expect(getNavItems(role).some(item => /approval|approve|phê duyệt/i.test(`${item.path} ${item.label}`)), role).toBe(false);
    }
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
    expect(items.map(({ key }) => key)).toEqual(['shipments', 'shipment-containers', 'shipment-debit', 'invoice-tracking', 'customers', 'config-routes', 'config-fuel-price-periods', 'config-factories']);
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

describe('kế toán danh mục (spec 5.10)', () => {
  const PHƠI_PHIEU = 'accounting-phoi-phieu';
  const CÔNG_NỢ = 'accounting-cong-no';
  const QUỸ = 'accounting-quy';
  const KHÁC = 'accounting-khac';
  const DANH_MỤC = [PHƠI_PHIEU, CÔNG_NỢ, QUỸ, KHÁC] as const;

  const itemsFor = (role: Role, section: string) =>
    getNavItems(role, undefined, undefined, ['treasury.read', 'recoverable_costs.read'])
      .filter((item) => item.section === section)
      .map((item) => item.key);

  it('gives the 4 danh mục their exact spec labels for every accounting role', () => {
    for (const role of [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT]) {
      const labelled = getNavSections(role)
        .filter((section) => (DANH_MỤC as readonly string[]).includes(section.key))
        .map((section) => section.label);
      expect(labelled, role).toEqual(['Phơi phiếu', 'Công nợ vận tải', 'Quỹ', 'Khác']);
    }
  });

  it('routes every spec screen to its spec danh mục', () => {
    expect(itemsFor(Role.ADMIN, PHƠI_PHIEU)).toEqual([
      'expenses', 'advances', 'hoan-ung', 'invoice-tracking', 'deposit-tracker', 'phoi-phieu', 'chot-debit',
    ]);
    expect(itemsFor(Role.ADMIN, CÔNG_NỢ)).toEqual(['debt', 'payables']);
    expect(itemsFor(Role.ADMIN, QUỸ)).toEqual(['treasury']);
    expect(itemsFor(Role.ADMIN, KHÁC)).toEqual(['salary', 'hr-roster']);

    expect(itemsFor(Role.MANAGER, PHƠI_PHIEU)).toEqual(['expenses', 'advances', 'hoan-ung']);
    expect(itemsFor(Role.MANAGER, CÔNG_NỢ)).toEqual(['debt', 'payables']);
    expect(itemsFor(Role.MANAGER, QUỸ)).toEqual(['treasury']);
    expect(itemsFor(Role.MANAGER, KHÁC)).toEqual(['salary', 'hr-roster']);

    expect(itemsFor(Role.ACCOUNTANT, KHÁC)).toEqual(['salary', 'hr-roster']);

    expect(itemsFor(Role.ACCOUNTANT, PHƠI_PHIEU)).toEqual([
      'invoice-tracking', 'deposit-tracker', 'phoi-phieu', 'chot-debit',
      'expenses', 'advances', 'hoan-ung',
    ]);
    expect(itemsFor(Role.ACCOUNTANT, CÔNG_NỢ)).toEqual(['debt', 'payables']);
    expect(itemsFor(Role.ACCOUNTANT, QUỸ)).toEqual(['treasury']);
  });

  it('loses no spec screen and double-places none across the 4 danh mục', () => {
    const expected: Record<string, string[]> = {
      [Role.ADMIN]: [
        'phoi-phieu', 'expenses', 'invoice-tracking', 'deposit-tracker', 'advances',
        'hoan-ung', 'chot-debit', 'debt', 'payables', 'treasury', 'salary', 'hr-roster',
      ],
      [Role.MANAGER]: [
        'expenses', 'advances', 'hoan-ung', 'debt', 'payables', 'treasury', 'salary', 'hr-roster',
      ],
      [Role.ACCOUNTANT]: [
        'phoi-phieu', 'expenses', 'invoice-tracking', 'deposit-tracker', 'advances',
        'hoan-ung', 'chot-debit', 'debt', 'payables', 'treasury', 'salary', 'hr-roster',
      ],
    };
    for (const [role, expectedKeys] of Object.entries(expected)) {
      const union = DANH_MỤC.flatMap((section) => itemsFor(role as Role, section));
      expect([...union].sort(), role).toEqual([...expectedKeys].sort());
      // No screen may be counted twice (or thrice) by the split.
      expect(new Set(union).size, role).toBe(union.length);
    }
  });

  it('keeps each role’s pricing master data out of the 4 danh mục but still rendered', () => {
    // config-fuel-price-periods / config-freight-rate-terms are ACCOUNTANT-only
    // pricing master data, not a spec danh mục — they sit in 'Giá & cước'.
    for (const section of DANH_MỤC) {
      expect(itemsFor(Role.ACCOUNTANT, section)).not.toContain('config-fuel-price-periods');
      expect(itemsFor(Role.ACCOUNTANT, section)).not.toContain('config-freight-rate-terms');
    }
    expect(itemsFor(Role.ACCOUNTANT, 'master-data')).toEqual([
      'config-fuel-price-periods', 'config-freight-rate-terms',
    ]);
  });

  it('leaves the CUS invoice-tracking entry in the CUS reconciliation group', () => {
    // CUS is not an accounting role: the read-only invoice page stays where
    // it was, and the CUS menu must not gain any accounting danh mục.
    const cusInvoice = getNavItems(Role.CUS).find((item) => item.key === 'invoice-tracking');
    expect(cusInvoice).toEqual(expect.objectContaining({ path: '/accounting/invoice-tracking' }));
    expect(cusInvoice?.section).toBe('reconciliation');
    for (const section of DANH_MỤC) {
      expect(itemsFor(Role.CUS, section), section).toEqual([]);
    }
  });

  it('grants the 4 danh mục only to the roles that own accounting screens', () => {
    for (const role of [Role.CUS, Role.DISPATCHER, Role.OPS, Role.DRIVER, Role.CUSTOMER]) {
      const keys = getNavSections(role).map((section) => section.key);
      for (const section of DANH_MỤC) {
        expect(keys, `${role}/${section}`).not.toContain(section);
      }
    }
  });

  it('renders nothing for a danh mục the role has no item in', () => {
    // The section stays listed for the role, but filters to zero items, which
    // Sidebar skips. Reachable via the capability gate: without
    // `treasury.read` the Quỹ danh mục owns no item.
    expect(getNavSections(Role.ADMIN).map((section) => section.key)).toContain(QUỸ);
    expect(getNavItems(Role.ADMIN, undefined, undefined, [])
      .filter((item) => item.section === QUỸ)).toEqual([]);
  });

  it('gives ACCOUNTANT a non-empty Khác danh mục holding Lương & Chấm công and Danh sách nhân sự', () => {
    // Spec §5.10 puts bảng chấm công + bảng lương in KHÁC. /salary is guarded
    // by `officeStaffOnly` in App.tsx, which admits ACCOUNTANT, so the entry is
    // a real destination and the danh mục must not render empty for them.
    // /hr/roster joins it with the same guard (card 385 rework).
    expect(itemsFor(Role.ACCOUNTANT, KHÁC)).toEqual(['salary', 'hr-roster']);
    expect(getNavSections(Role.ACCOUNTANT).map((section) => section.key)).toContain(KHÁC);
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
    // ADMIN/MANAGER → Vận hành; ACCOUNTANT → Phơi phiếu (the first of the
    // 4 accounting danh mục, spec §5.10 — the old 'financials' group is
    // gone); DISPATCHER → Điều độ Phương tiện; CUS → Nghiệp vụ Chứng từ;
    // OPS/DRIVER → Công việc của tôi; CUSTOMER → Portal.
    expect(PRIMARY_SECTION_BY_ROLE).toEqual({
      ADMIN: 'operations',
      MANAGER: 'operations',
      ACCOUNTANT: 'accounting-phoi-phieu',
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
    [Role.ACCOUNTANT, 'accounting-phoi-phieu'],
    [Role.DISPATCHER, 'dispatch-planning'],
    [Role.CUS, 'document-ops'],
    [Role.OPS, 'my-work'],
    [Role.DRIVER, 'my-work'],
    [Role.CUSTOMER, 'portal'],
  ] as const)('returns the spec-defined primary section for %s', (role, expected) => {
    expect(getDefaultOpenSection(role)).toBe(expected);
  });

  it('keeps every role primary section inside that role’s rendered section list', () => {
    for (const role of Object.values(Role)) {
      const primary = getDefaultOpenSection(role);
      if (!primary) continue;
      expect(getNavSections(role).map((section) => section.key), role).toContain(primary);
    }
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
