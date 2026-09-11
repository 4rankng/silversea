/**
 * Single source of truth for SPA page metadata: path + Vietnamese title.
 *
 * Why this exists: the same page used to be described in multiple drifting
 * places — `frontend/src/lib/routes.ts` (path + title) and `frontend/src/App.tsx`
 * (the `<Route>` declarations). Adding one page touched both and the Vietnamese
 * title got copy-pasted. Now the literal lives here once and every consumer
 * derives from it.
 *
 * What this is NOT:
 *   - NOT a router. `App.tsx` still owns the React Router `<Route>` elements +
 *     role guards (the runtime RBAC authority). There is deliberately no
 *     `roles` field here — RBAC stays in App.tsx + Casbin to avoid a third
 *     source of truth.
 *   - NOT exhaustive navigation metadata. Section/roles for the sidebar live
 *     elsewhere for now; this catalog carries path + title (+ section) only.
 */

/** Coarse grouping for future sidebar/search derivation (informational only). */
export type PageSection = 'operations' | 'hr' | 'financials' | 'master-data' | 'resources' | 'system' | 'config';

/** A page with a static URL (no params), e.g. `/dashboard`. */
export interface StaticPageEntry {
  title: string;
  path: string;
  section?: PageSection;
}

/** A page whose URL needs params, e.g. `/trips/:id`. */
export interface DynamicPageEntry {
  title: string;
  /** Build the concrete URL from params. Param names match `requiresParams`. */
  path: (params: Record<string, string | number>) => string;
  /** The route template, e.g. `/trips/:id` — for matching/derivation. */
  pathPattern: string;
  /** Param names the builder reads, e.g. `['id']` or `['truckId']`. */
  requiresParams: readonly string[];
  section?: PageSection;
}

export type PageCatalogEntry = StaticPageEntry | DynamicPageEntry;

export const PAGE_CATALOG = {
  /* ── Top-level admin / manager pages ────────────────────────────────── */

  dashboard: {
    title: 'Tổng quan',
    path: '/dashboard',
  },
  dispatch: {
    title: 'Kế hoạch Tổng quát',
    path: '/dispatch',
    section: 'operations',
  },
  dispatchDetailPlan: {
    title: 'Kế hoạch Chi tiết Xe',
    path: '/dispatch-detail',
    section: 'operations',
  },
  fleet: {
    title: 'Đội xe',
    path: '/fleet',
  },
  // Dispatcher resource-catalog views: read-only lookups of internal tractors
  // and drivers for staffing dispatch plans (separate from the admin /fleet
  // CRUD workspace).
  fleetVehicles: {
    title: 'Danh mục Xe nội bộ',
    path: '/fleet/vehicles',
    section: 'resources',
  },
  fleetDrivers: {
    title: 'Danh mục Tài xế',
    path: '/fleet/drivers',
    section: 'resources',
  },
  fleetTires: {
    title: 'Lốp xe đầu kéo',
    path: (p: Record<string, string | number>) => `/fleet/${p.truckId}/tires`,
    pathPattern: '/fleet/:truckId/tires',
    requiresParams: ['truckId'],
  },
  fleetTrailerTires: {
    title: 'Lốp rơ-moóc',
    path: (p: Record<string, string | number>) => `/fleet/trailers/${p.trailerId}/tires`,
    pathPattern: '/fleet/trailers/:trailerId/tires',
    requiresParams: ['trailerId'],
  },
  trips: {
    title: 'Sổ chuyến đi',
    path: '/trips',
  },
  tripNew: {
    title: 'Tạo chuyến đi',
    path: '/trips/new',
  },
  tripDetail: {
    title: 'Chi tiết chuyến đi',
    path: (p: Record<string, string | number>) => `/trips/${p.id}`,
    pathPattern: '/trips/:id',
    requiresParams: ['id'],
  },
  tripEdit: {
    title: 'Sửa chuyến đi',
    path: (p: Record<string, string | number>) => `/trips/${p.id}/edit`,
    pathPattern: '/trips/:id/edit',
    requiresParams: ['id'],
  },
  finance: {
    title: 'Báo cáo lãi lỗ',
    path: '/finance',
    section: 'financials',
  },
  accounting: {
    title: 'Tổng Quan',
    path: '/accounting',
    section: 'financials',
  },
  profit: {
    title: 'Phân chia lợi nhuận',
    path: '/profit',
    section: 'financials',
  },
  debt: {
    title: 'Công nợ phải thu',
    path: '/debt',
    section: 'financials',
  },
  debtDetail: {
    title: 'Chi tiết công nợ phải thu',
    path: (p: Record<string, string | number>) => `/debt/${p.id}`,
    pathPattern: '/debt/:id',
    requiresParams: ['id'],
  },
  penalties: {
    title: 'Kỷ luật',
    path: '/penalties',
  },
  advances: {
    title: 'Tạm ứng & hoàn ứng',
    path: '/advances',
    section: 'financials',
  },
  adminAdvanceSettlements: {
    title: 'Tạm ứng & hoàn ứng',
    path: '/admin/advance-settlements',
    section: 'financials',
  },
  salary: {
    title: 'Lương & Chấm công',
    path: '/salary',
    section: 'operations',
  },
  users: {
    title: 'Người dùng',
    path: '/users',
    section: 'system',
  },
  auditLogs: {
    title: 'Nhật ký người dùng',
    path: '/audit-logs',
    section: 'system',
  },
  customers: {
    title: 'Khách hàng',
    path: '/customers',
    section: 'master-data',
  },
  shipments: {
    title: 'Tổng quan lô hàng',
    // Wave 0: minimal read-only list/detail surface. Path is its own top-level
    // (/shipments) rather than nested under /trips because a shipment precedes
    // and outlives any single trip (phase-01 architecture).
    path: '/shipments',
    section: 'operations',
  },
  shipmentDetail: {
    title: 'Chi tiết lô hàng',
    path: (p: Record<string, string | number>) => `/shipments/${p.id}`,
    pathPattern: '/shipments/:id',
    requiresParams: ['id'],
  },
  shipmentContainers: {
    // CUS container-flat view: every container of every shipment, with the
    // closing/return appointment and vehicle plate per container. Sibling of
    // `shipments`; the per-shipment detail page stays at /shipments/:id.
    title: 'Chi tiết lô hàng',
    path: '/shipments-detail',
    section: 'operations',
  },
  suppliers: {
    title: 'Nhà cung cấp',
    path: '/suppliers',
    section: 'master-data',
  },
  expenses: {
    title: 'Chi phí phát sinh',
    path: '/expenses',
    section: 'financials',
  },
  expenseNew: {
    title: 'Ghi nhận chi phí',
    path: '/expenses/new',
    section: 'financials',
  },
  expenseEdit: {
    title: 'Sửa chi phí',
    path: (p: Record<string, string | number>) => `/expenses/${p.id}/edit`,
    pathPattern: '/expenses/:id/edit',
    requiresParams: ['id'],
  },
  payables: {
    title: 'Công nợ phải trả',
    path: '/payables',
    section: 'financials',
  },
  payableDetail: {
    title: 'Chi tiết công nợ phải trả',
    path: (p: Record<string, string | number>) => `/payables/${p.id}`,
    pathPattern: '/payables/:id',
    requiresParams: ['id'],
  },
  login: {
    title: 'Đăng nhập',
    path: '/login',
  },

  /* ── System administration ──────────────────────────────────────────── */

  adminCenter: {
    // ADMIN-only health & readiness hub (server-email, setup, RBAC counts,
    // operational catalogs, database). Backs the /admin-center page.
    title: 'Trung tâm quản trị',
    path: '/admin-center',
    section: 'system',
  },

  /* ── Config (catalog admin) ─────────────────────────────────────────── */

  config: {
    title: 'Cấu hình hệ thống',
    path: '/config',
    section: 'config',
  },
  configTrailers: {
    title: 'Rơ-moóc',
    path: '/config/trailers',
    section: 'config',
  },
  configTrucks: {
    title: 'Xe đầu kéo',
    path: '/config/trucks',
    section: 'config',
  },
  configTruckOwners: {
    title: 'Chủ xe',
    path: (p: Record<string, string | number>) => `/config/trucks/${p.truckId}/owners`,
    pathPattern: '/config/trucks/:truckId/owners',
    requiresParams: ['truckId'],
    section: 'config',
  },
  configRoutes: {
    title: 'Tuyến đường',
    path: '/config/routes',
    section: 'config',
  },
  configBusinessCalendar: {
    title: 'Lịch ngày làm việc',
    path: '/config/business-calendar',
    section: 'config',
  },
  configCargoTypes: {
    title: 'Loại hàng hóa',
    path: '/config/cargo-types',
    section: 'config',
  },
  configPricingTables: {
    title: 'Bảng giá',
    path: '/config/pricing-tables',
    section: 'config',
  },
  configRoadAllowances: {
    title: 'Phụ cấp đường',
    path: '/config/road-allowances',
    section: 'config',
  },
  configPenaltyReasons: {
    title: 'Lý do kỷ luật',
    path: '/config/penalty-reasons',
    section: 'config',
  },
  configFuel: {
    title: 'Định mức dầu',
    path: '/config/fuel',
    section: 'config',
  },
  configTripExpense: {
    title: 'Loại chi phí chuyến',
    path: '/config/trip-expense',
    section: 'config',
  },
  configCapTable: {
    title: 'Cơ cấu cổ phần',
    path: '/config/cap-table',
    section: 'config',
  },
  configCustomers: {
    title: 'Khách hàng',
    path: '/config/customers',
    section: 'config',
  },
  configManagementFees: {
    title: 'Phí quản lý',
    path: '/config/management-fees',
    section: 'config',
  },
  configSalaryPeriods: {
    title: 'Kỳ lương',
    path: '/config/salary-periods',
    section: 'config',
  },
  configExpenseCategories: {
    title: 'Nhóm chi phí',
    path: '/config/expense-categories',
    section: 'config',
  },
  configContainerTypes: {
    title: 'Loại container',
    path: '/config/container-types',
    section: 'config',
  },
  configPorts: {
    title: 'Cảng',
    path: '/config/ports',
    section: 'config',
  },
  configForwarderExpenseTypes: {
    title: 'Loại chi phí giao nhận',
    path: '/config/forwarder-expense-types',
    section: 'config',
  },
  configDebitNoteTemplates: {
    title: 'Mẫu giấy báo nợ',
    path: '/config/debit-note-templates',
    section: 'config',
  },

  /* ── Driver portal ──────────────────────────────────────────────────── */

  myTrips: {
    title: 'Hành trình',
    path: '/my-trips',
  },
  myTripDetail: {
    title: 'Chi tiết hành trình',
    path: (p: Record<string, string | number>) => `/my-trips/${p.id}`,
    pathPattern: '/my-trips/:id',
    requiresParams: ['id'],
  },
  myTwoOrders: {
    title: 'Hành trình · Hai lệnh',
    path: '/my-trips/two-orders',
  },
  myPayslips: {
    title: 'Phiếu lương',
    path: '/my-payslips',
  },
  myEarnings: {
    title: 'Thu nhập',
    path: '/my-earnings',
  },
  myPenalties: {
    title: 'Kỷ luật',
    path: '/my-penalties',
  },

  /* ── Forwarder portal ──────────────────────────────────────────────── */

  myOrders: {
    title: 'Lệnh giao nhận',
    path: '/my-orders',
  },
  myForwarderTrips: {
    title: 'Chuyến đi',
    path: '/my-forwarder-trips',
  },
  myForwarderTripDetail: {
    title: 'Chi tiết chuyến đi',
    path: (p: Record<string, string | number>) => `/my-forwarder-trips/${p.id}`,
    pathPattern: '/my-forwarder-trips/:id',
    requiresParams: ['id'],
  },
  myAdvances: {
    title: 'Tạm ứng',
    path: '/my-advances',
  },
  mySettlements: {
    title: 'Phiếu thanh toán',
    path: '/my-settlements',
  },
  mySettlementNew: {
    title: 'Tạo phiếu thanh toán',
    path: '/my-settlements/new',
  },
  mySettlementDetail: {
    title: 'Chi tiết phiếu thanh toán',
    path: (p: Record<string, string | number>) => `/my-settlements/${p.id}`,
    pathPattern: '/my-settlements/:id',
    requiresParams: ['id'],
  },
} as const satisfies Record<string, PageCatalogEntry>;

export type PageCatalogKey = keyof typeof PAGE_CATALOG;
