/**
 * Single source of truth for SPA page metadata: path, Vietnamese title, and
 * (for agent-navigable pages) the description + aliases the AI assistant uses
 * to resolve a user query to a routeKey.
 *
 * Why this exists: the same page used to be described in four drifting places —
 * `frontend/src/lib/routes.ts` (path + title), `shared/src/schemas/agent.ts`
 * (the closed set of agent route keys), `backend/src/services/agent/tools/ui.ts`
 * (a hand-maintained `PAGE_DESCRIPTIONS` record), and `frontend/src/App.tsx`
 * (the `<Route>` declarations). Adding one page touched all four and the
 * Vietnamese title got copy-pasted. Now the literal lives here once and every
 * consumer derives from it.
 *
 * What this is NOT:
 *   - NOT a router. `App.tsx` still owns the React Router `<Route>` elements +
 *     role guards (the runtime RBAC authority). There is deliberately no
 *     `roles` field here — RBAC stays in App.tsx + Casbin to avoid a third
 *     source of truth.
 *   - NOT exhaustive navigation metadata. Section/roles for the sidebar live
 *     elsewhere for now; this catalog carries path + title + agent data only.
 *
 * Agent membership rule: an entry is navigable by the AI assistant iff it has
 * an `agent` sub-object. `shared/src/schemas/agent.ts` keeps a hand-written
 * `AGENT_ROUTE_KEYS as const` tuple (load-bearing for `z.enum`) plus a
 * compile-time assertion that the tuple exactly equals the set of entries with
 * an `agent` sub-object — so the two can never drift silently.
 */

/** Coarse grouping for future sidebar/search derivation (informational only). */
export type PageSection = 'operations' | 'hr' | 'financials' | 'master-data' | 'system' | 'config';

/** Search data for pages the AI assistant may navigate to / search for. */
export interface PageAgentMeta {
  /** Vietnamese description powering `ui.search_pages` + the LLM's route choice. */
  description: string;
  /** Extra normalized search terms (diacritics stripped or English fallbacks). */
  aliases?: readonly string[];
}

/** A page with a static URL (no params), e.g. `/dashboard`. */
export interface StaticPageEntry {
  title: string;
  path: string;
  section?: PageSection;
  agent?: PageAgentMeta;
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
  agent?: PageAgentMeta;
}

export type PageCatalogEntry = StaticPageEntry | DynamicPageEntry;

export const PAGE_CATALOG = {
  /* ── Top-level admin / manager pages ────────────────────────────────── */

  dashboard: {
    title: 'Tổng quan',
    path: '/dashboard',
    agent: { description: 'Tổng quan — bảng điều khiển chính, KPI tháng.' },
  },
  dispatch: {
    title: 'Điều vận & Phân xe',
    path: '/dispatch',
    section: 'operations',
    agent: { description: 'Điều vận & phân xe — danh sách chuyến cần điều động, bản đồ GPS.' },
  },
  fleet: {
    title: 'Đội xe',
    path: '/fleet',
    agent: { description: 'Đội xe — danh sách xe đầu kéo, rơ-moóc, lốp.' },
  },
  fleetTires: {
    title: 'Lốp xe đầu kéo',
    path: (p: Record<string, string | number>) => `/fleet/${p.truckId}/tires`,
    pathPattern: '/fleet/:truckId/tires',
    requiresParams: ['truckId'],
    agent: {
      description: 'Lốp xe đầu kéo — serial, vị trí lắp, tuổi lốp, nhà cung cấp, thanh lý lốp (theo đầu kéo).',
      aliases: ['lốp', 'lop', 'lốp xe', 'vỏ xe', 'vo xe'],
    },
  },
  fleetTrailerTires: {
    title: 'Lốp rơ-moóc',
    path: (p: Record<string, string | number>) => `/fleet/trailers/${p.trailerId}/tires`,
    pathPattern: '/fleet/trailers/:trailerId/tires',
    requiresParams: ['trailerId'],
    agent: {
      description: 'Lốp rơ-moóc — serial, vị trí lắp, tuổi lốp, thanh lý (theo rơ-moóc).',
      aliases: ['lốp rơ moóc', 'vỏ rơ moóc', 'lốp moóc'],
    },
  },
  trips: {
    title: 'Lệnh vận chuyển',
    path: '/trips',
    agent: { description: 'Lệnh vận chuyển — danh sách tất cả chuyến.' },
  },
  tripNew: {
    title: 'Tạo lệnh vận chuyển',
    path: '/trips/new',
    agent: { description: 'Tạo lệnh vận chuyển — form tạo chuyến mới.' },
  },
  tripDetail: {
    title: 'Chi tiết lệnh vận chuyển',
    path: (p: Record<string, string | number>) => `/trips/${p.id}`,
    pathPattern: '/trips/:id',
    requiresParams: ['id'],
    agent: { description: 'Chi tiết một lệnh vận chuyển.' },
  },
  tripEdit: {
    title: 'Sửa lệnh vận chuyển',
    path: (p: Record<string, string | number>) => `/trips/${p.id}/edit`,
    pathPattern: '/trips/:id/edit',
    requiresParams: ['id'],
    agent: { description: 'Sửa lệnh vận chuyển.' },
  },
  finance: {
    title: 'Báo cáo lãi lỗ',
    path: '/finance',
    section: 'financials',
    agent: { description: 'Báo cáo lãi lỗ (P&L) theo tháng.' },
  },
  profit: {
    title: 'Phân chia lợi nhuận',
    path: '/profit',
    section: 'financials',
    agent: { description: 'Phân chia lợi nhuận theo quý.' },
  },
  debt: {
    title: 'Công nợ phải thu',
    path: '/debt',
    section: 'financials',
    agent: { description: 'Công nợ phải thu — danh sách khách nợ.' },
  },
  debtDetail: {
    title: 'Chi tiết công nợ phải thu',
    path: (p: Record<string, string | number>) => `/debt/${p.id}`,
    pathPattern: '/debt/:id',
    requiresParams: ['id'],
    agent: { description: 'Chi tiết công nợ một khách.' },
  },
  penalties: {
    title: 'Kỷ luật',
    path: '/penalties',
    agent: { description: 'Kỷ luật — danh sách phạt tài xế.' },
  },
  advances: {
    title: 'Quản lý tạm ứng',
    path: '/advances',
    section: 'financials',
    agent: { description: 'Quản lý tạm ứng.' },
  },
  adminAdvanceSettlements: {
    title: 'Duyệt hoàn ứng',
    path: '/admin/advance-settlements',
    section: 'financials',
    agent: { description: 'Duyệt hoàn ứng.' },
  },
  salary: {
    title: 'Lương & Chấm công',
    path: '/salary',
    section: 'operations',
    agent: { description: 'Lương & Chấm công.' },
  },
  users: {
    title: 'Người dùng',
    path: '/users',
    section: 'system',
    agent: { description: 'Người dùng — danh sách tài khoản.' },
  },
  auditLogs: {
    title: 'Nhật ký người dùng',
    path: '/audit-logs',
    section: 'system',
    agent: { description: 'Nhật ký thao tác người dùng.' },
  },
  chatbotMonitoring: {
    title: 'Giám sát Chatbot',
    path: '/chatbot-monitoring',
    section: 'system',
    agent: {
      description: 'Giám sát Chatbot — hiệu năng bot: độ trễ, lỗi, công cụ, chi phí.',
      aliases: ['chatbot monitoring', 'hieu nang bot', 'giam sat chatbot', 'bot performance'],
    },
  },
  customers: {
    title: 'Khách hàng',
    path: '/customers',
    section: 'master-data',
    agent: { description: 'Khách hàng — danh sách.' },
  },
  shipments: {
    title: 'Lô hàng',
    // Wave 0: minimal read-only list/detail surface. Path is its own top-level
    // (/shipments) rather than nested under /trips because a shipment precedes
    // and outlives any single trip (phase-01 architecture). No `agent` meta
    // yet — the AI assistant's page-search coverage ships with the Wave 2 CUS
    // UI when the page becomes operator-relevant in daily flow.
    path: '/shipments',
    section: 'operations',
  },
  shipmentDetail: {
    title: 'Chi tiết lô hàng',
    path: (p: Record<string, string | number>) => `/shipments/${p.id}`,
    pathPattern: '/shipments/:id',
    requiresParams: ['id'],
  },
  suppliers: {
    title: 'Nhà cung cấp',
    path: '/suppliers',
    section: 'master-data',
    agent: { description: 'Nhà cung cấp — danh sách.' },
  },
  expenses: {
    title: 'Chi phí phát sinh',
    path: '/expenses',
    section: 'financials',
    agent: { description: 'Chi phí phát sinh.' },
  },
  expenseNew: {
    title: 'Ghi nhận chi phí',
    path: '/expenses/new',
    section: 'financials',
    agent: { description: 'Ghi nhận chi phí phát sinh mới.' },
  },
  expenseEdit: {
    title: 'Sửa chi phí',
    path: (p: Record<string, string | number>) => `/expenses/${p.id}/edit`,
    pathPattern: '/expenses/:id/edit',
    requiresParams: ['id'],
    agent: { description: 'Sửa chi phí phát sinh.' },
  },
  payables: {
    title: 'Công nợ phải trả',
    path: '/payables',
    section: 'financials',
    agent: { description: 'Công nợ phải trả — danh sách nợ nhà cung cấp.' },
  },
  payableDetail: {
    title: 'Chi tiết công nợ phải trả',
    path: (p: Record<string, string | number>) => `/payables/${p.id}`,
    pathPattern: '/payables/:id',
    requiresParams: ['id'],
    agent: { description: 'Chi tiết công nợ phải trả.' },
  },
  login: {
    title: 'Đăng nhập',
    path: '/login',
  },

  /* ── Config (catalog admin) ─────────────────────────────────────────── */

  config: {
    title: 'Cấu hình hệ thống',
    path: '/config',
    section: 'config',
    agent: { description: 'Cấu hình hệ thống.' },
  },
  configTrailers: {
    title: 'Rơ-moóc',
    path: '/config/trailers',
    section: 'config',
    agent: { description: 'Cấu hình rơ-moóc.' },
  },
  configTrucks: {
    title: 'Xe đầu kéo',
    path: '/config/trucks',
    section: 'config',
    agent: { description: 'Cấu hình xe đầu kéo.' },
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
    agent: { description: 'Cấu hình tuyến đường.' },
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
    agent: { description: 'Cấu hình dầu (định mức, đơn giá).' },
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
    agent: { description: 'Cấu hình khách hàng.' },
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
    agent: { description: 'Cấu hình kỳ lương.' },
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
    agent: {
      description: 'Mẫu giấy báo nợ — cấu hình mẫu Excel giấy báo nợ, chữ ký, thông tin công ty, cột xuất file.',
      aliases: ['mau giay bao no', 'giay bao no', 'debit note', 'debit note template'],
    },
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
  myEarnings: {
    title: 'Thu nhập',
    path: '/my-earnings',
  },
  myPenalties: {
    title: 'Kỷ luật',
    path: '/my-penalties',
  },

  /* ── Forwarder portal ──────────────────────────────────────────────── */

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
