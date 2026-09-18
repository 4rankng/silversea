/**
 * Frontend projection of the shared page catalog (`PAGE_CATALOG` in
 * `@tingting/shared`). The catalog is the single source of truth for every
 * path string and page title; this module exposes
 * them in the shape the SPA has always consumed (`routes.tripDetail(id)`,
 * `titleForPath(pathname)`, the `legacy` redirect aliases).
 *
 * Why a projection instead of consuming the catalog inline everywhere:
 *   - Static paths stay plain string constants; parametric paths stay
 *     functions whose signature requires the param, so `routes.tripDetail()`
 *     with no id is still a compile error.
 *   - `titleRules` stays a hand-ordered first-match array (its order IS the
 *     precedence logic — e.g. `/trips/:id` vs `/trips/:id/edit`, config
 *     sub-paths before the `/config` catch-all). Only the title *strings*
 *     come from the catalog now, killing the copy-paste drift.
 *
 * Not here: RBAC. `App.tsx` route guards + Casbin remain the authority; the
 * catalog deliberately carries no `roles`. The `legacy` aliases are kept here
 * (not in the catalog) — they're accept-and-redirect shims, conceptually
 * separate from the live page set.
 */
import { PAGE_CATALOG } from '@tingting/shared';
import { BRAND } from '../brand';
import { CONFIG_ITEMS } from '../data/searchRegistry';

export const routes = {
  /* ── Top-level admin / manager pages ────────────────────────────────── */

  dashboard: PAGE_CATALOG.dashboard.path,
  dispatch: PAGE_CATALOG.dispatch.path,
  fleet: PAGE_CATALOG.fleet.path,
  fleetVehicles: PAGE_CATALOG.fleetVehicles.path,
  fleetDrivers: PAGE_CATALOG.fleetDrivers.path,
  fleetTires: (truckId: number | string) => PAGE_CATALOG.fleetTires.path({ truckId }),
  fleetTrailerTires: (trailerId: number | string) => PAGE_CATALOG.fleetTrailerTires.path({ trailerId }),
  trips: PAGE_CATALOG.trips.path,
  tripNew: PAGE_CATALOG.tripNew.path,
  tripDetail: (id: number | string) => PAGE_CATALOG.tripDetail.path({ id }),
  tripEdit: (id: number | string) => PAGE_CATALOG.tripEdit.path({ id }),
  finance: PAGE_CATALOG.finance.path,
  accounting: PAGE_CATALOG.accounting.path,
  accountingFuelEvidence: '/accounting/fuel-evidence',
  expenseAccounting: '/accounting/expenses',
  treasury: '/finance/treasury',
  recoverableCosts: '/recoverable-costs',
  profit: PAGE_CATALOG.profit.path,
  debt: PAGE_CATALOG.debt.path,
  debtDetail: (id: number | string) => PAGE_CATALOG.debtDetail.path({ id }),
  penalties: PAGE_CATALOG.penalties.path,
  advances: PAGE_CATALOG.advances.path,
  adminAdvanceSettlements: PAGE_CATALOG.adminAdvanceSettlements.path,
  salary: PAGE_CATALOG.salary.path,
  users: PAGE_CATALOG.users.path,
  auditLogs: PAGE_CATALOG.auditLogs.path,
  adminCenter: PAGE_CATALOG.adminCenter.path,
  customers: PAGE_CATALOG.customers.path,
  suppliers: PAGE_CATALOG.suppliers.path,
  // Wave 0: shipment (lô hàng) — minimal read-only list + detail.
  shipments: PAGE_CATALOG.shipments.path,
  shipmentContainers: PAGE_CATALOG.shipmentContainers.path,
  shipmentDebit: PAGE_CATALOG.shipmentDebit.path,
  shipmentNew: '/shipments/new',
  shipmentDetail: (id: number | string) => PAGE_CATALOG.shipmentDetail.path({ id }),
  expenses: PAGE_CATALOG.expenses.path,
  expenseNew: PAGE_CATALOG.expenseNew.path,
  expenseEdit: (id: number | string) => PAGE_CATALOG.expenseEdit.path({ id }),
  payables: PAGE_CATALOG.payables.path,
  payableDetail: (id: number | string) => PAGE_CATALOG.payableDetail.path({ id }),
  login: PAGE_CATALOG.login.path,

  /* ── Config (catalog admin) ─────────────────────────────────────────── */

  config: PAGE_CATALOG.config.path,
  configFactories: '/config/factories',
  configTrailers: PAGE_CATALOG.configTrailers.path,
  configTrucks: PAGE_CATALOG.configTrucks.path,
  configTruckOwners: (truckId: number | string) => PAGE_CATALOG.configTruckOwners.path({ truckId }),
  configRoutes: PAGE_CATALOG.configRoutes.path,
  configCargoTypes: PAGE_CATALOG.configCargoTypes.path,
  configPricingTables: PAGE_CATALOG.configPricingTables.path,
  configRoadAllowances: PAGE_CATALOG.configRoadAllowances.path,
  configPenaltyReasons: PAGE_CATALOG.configPenaltyReasons.path,
  configFuel: PAGE_CATALOG.configFuel.path,
  // Freight pricing engine config (Phương án tính cước tự động) — plain
  // strings, not catalog entries: title falls through the /config catch-all.
  configFuelPricePeriods: '/config/fuel-price-periods',
  configFreightRateTerms: '/config/freight-rate-terms',
  configTripExpense: PAGE_CATALOG.configTripExpense.path,
  configCapTable: PAGE_CATALOG.configCapTable.path,
  configCustomers: PAGE_CATALOG.configCustomers.path,
  configManagementFees: PAGE_CATALOG.configManagementFees.path,
  configSalaryPeriods: PAGE_CATALOG.configSalaryPeriods.path,
  configExpenseCategories: PAGE_CATALOG.configExpenseCategories.path,
  configContainerTypes: PAGE_CATALOG.configContainerTypes.path,
  configPorts: PAGE_CATALOG.configPorts.path,
  configForwarderExpenseTypes: PAGE_CATALOG.configForwarderExpenseTypes.path,
  configDebitNoteTemplates: PAGE_CATALOG.configDebitNoteTemplates.path,

  /* ── Driver portal ──────────────────────────────────────────────────── */

  myTrips: PAGE_CATALOG.myTrips.path,
  myTripDetail: (id: number | string) => PAGE_CATALOG.myTripDetail.path({ id }),
  myTwoOrders: PAGE_CATALOG.myTwoOrders.path,
  myPayslips: PAGE_CATALOG.myPayslips.path,
  myEarnings: PAGE_CATALOG.myEarnings.path,
  myPenalties: PAGE_CATALOG.myPenalties.path,
  myNotifications: '/notifications',

  /* ── Forwarder portal ──────────────────────────────────────────────── */

  myOrders: PAGE_CATALOG.myOrders.path,
  myForwarderTrips: PAGE_CATALOG.myForwarderTrips.path,
  myForwarderTripDetail: (id: number | string) => PAGE_CATALOG.myForwarderTripDetail.path({ id }),
  myAdvances: PAGE_CATALOG.myAdvances.path,
  mySettlements: PAGE_CATALOG.mySettlements.path,
  mySettlementNew: PAGE_CATALOG.mySettlementNew.path,
  mySettlementDetail: (id: number | string) => PAGE_CATALOG.mySettlementDetail.path({ id }),

  /* ── Ops field operations (OpsVanHanh) ───────────────────────────────── */

  opsOrders: PAGE_CATALOG.opsOrders.path,
  opsFleetTracking: PAGE_CATALOG.opsFleetTracking.path,
  opsWallet: PAGE_CATALOG.opsWallet.path,

  /* ── Dispatch planning ───────────────────────────────────────────────── */

  // /dispatch = Kế hoạch Tổng quát, /dispatch-detail = Kế hoạch Chi tiết —
  // two separate screens per the SilverSea dispatch spec. Both derive from
  // the catalog so the paths can't drift from titles.
  dispatchMasterPlan: PAGE_CATALOG.dispatch.path,
  dispatchDetailedPlan: PAGE_CATALOG.dispatchDetailPlan.path,
  dispatchDetailPlan: PAGE_CATALOG.dispatchDetailPlan.path,

  /* ── Customer portal (Wave 2) ─────────────────────────────────────── */

  portalShipments: '/portal/shipments',
  portalShipmentDetail: (id: number | string) => `/portal/shipments/${id}`,
  portalDebitNotes: '/portal/debit-notes',
  portalStatement: '/portal/statement',

  /* ── Legacy paths that the router redirects from (kept for old links) */

  legacy: {
    routes: '/routes',           // → /config/routes
    trucks: '/trucks',            // → /fleet
    drivers: '/drivers',          // → /fleet
    trailers: '/trailers',        // → /config/trailers
    auditLog: '/audit-log',       // → /audit-logs
    adminAuditLogs: '/admin/audit-logs', // → /audit-logs
    adminAuditLog: '/admin/audit-log',   // → /audit-logs
  },
} as const;

/**
 * Resolve a "home" route for a given role — used after login + on 404.
 *
 * Role → Route mappings per O2C workflow specification:
 * - ADMIN → /config
 * - Manager → /dashboard
 * - ACCOUNTANT → /accounting
 * - DISPATCHER → /dispatch
 * - CLERK/CUS → /shipments
 * - FORWARDER/OPS → /my-orders
 * - DRIVER → /my-trips
 * - CUSTOMER → /portal/shipments
 */
export function homeForRole(role: string): string {
  switch (role) {
    case 'DRIVER':
      return routes.myTrips;
    case 'OPS':
    case 'FORWARDER':
      return routes.myOrders;
    case 'CUSTOMER':
      return routes.portalShipments;
    case 'CUS':
    case 'CLERK':
      return routes.shipments;
    case 'ACCOUNTANT':
      return routes.accounting;
    case 'DISPATCHER':
      return routes.dispatch;
    case 'ADMIN':
      return routes.config;
    case 'MANAGER':
    default:
      return routes.dashboard;
  }
}

type TitleRule = {
  test: (pathname: string) => boolean;
  title: string | ((pathname: string) => string);
};

// Per-role overrides for paths whose audience has more than one mental model.
// The default `titleForPath` ignores role; pass a `role` to `titleForPath` to
// receive the role-branched variant for the rules below.
const ROLE_BRANCHED_TITLES: Record<string, (role: string) => string> = {
  [routes.recoverableCosts]: (role) => role === 'CUS' ? 'Chi phí thu hộ cần đối soát' : 'Chi phí cần kiểm tra',
};

// Order is load-bearing precedence (first match wins). The title strings are
// sourced from PAGE_CATALOG so they can't drift from the sidebar; only the
// configuration hub labels are used for their destinations; specialist
// configuration pages keep their own explicit title before that fallback.
const titleRules: TitleRule[] = [
  { test: p => p === routes.dashboard, title: PAGE_CATALOG.dashboard.title },
  { test: p => p === routes.dispatchDetailPlan, title: PAGE_CATALOG.dispatchDetailPlan.title },
  { test: p => p.startsWith(routes.dispatch), title: PAGE_CATALOG.dispatch.title },
  // Exact matches before the /fleet startsWith catch-all so the dispatcher
  // catalog pages don't inherit the admin "Đội xe" title.
  { test: p => p === routes.fleetVehicles, title: PAGE_CATALOG.fleetVehicles.title },
  { test: p => p === routes.fleetDrivers, title: PAGE_CATALOG.fleetDrivers.title },
  // Tires sub-pages before the /fleet startsWith catch-all so the topbar shows
  // the tire catalog title, not the generic "Đội xe".
  { test: p => /^\/fleet\/trailers\/[^/]+\/tires$/.test(p), title: PAGE_CATALOG.fleetTrailerTires.title },
  { test: p => /^\/fleet\/\d+\/tires$/.test(p), title: PAGE_CATALOG.fleetTires.title },
  { test: p => p.startsWith(routes.fleet), title: PAGE_CATALOG.fleet.title },
  { test: p => /^\/trips\/(\d+)(?:\/edit)?$/.test(p), title: p => p.endsWith('/edit') ? PAGE_CATALOG.tripEdit.title : PAGE_CATALOG.tripDetail.title },
  { test: p => p === routes.tripNew, title: PAGE_CATALOG.tripNew.title },
  { test: p => p.startsWith(routes.trips), title: PAGE_CATALOG.trips.title },
  { test: p => p === routes.finance, title: PAGE_CATALOG.finance.title },
  { test: p => p === routes.accounting, title: PAGE_CATALOG.accounting.title },
  { test: p => p === routes.accountingFuelEvidence, title: 'Soát OCR màn hình bơm' },
  { test: p => p === routes.expenseAccounting, title: 'Chi phí và đối chiếu' },
  { test: p => p === routes.treasury, title: 'Sổ quỹ / ngân hàng' },
  { test: p => p.startsWith(routes.recoverableCosts), title: 'Chi phí cần kiểm tra' },
  { test: p => p.startsWith(routes.profit), title: PAGE_CATALOG.profit.title },
  { test: p => p.startsWith(routes.debt), title: PAGE_CATALOG.debt.title },
  { test: p => p.startsWith(routes.payables), title: PAGE_CATALOG.payables.title },
  { test: p => p.startsWith(routes.expenseNew), title: PAGE_CATALOG.expenseNew.title },
  { test: p => /^\/expenses\/\d+\/edit$/.test(p), title: PAGE_CATALOG.expenseEdit.title },
  { test: p => p.startsWith(routes.expenses), title: PAGE_CATALOG.expenses.title },
  { test: p => p.startsWith(routes.suppliers), title: PAGE_CATALOG.suppliers.title },
  { test: p => p === routes.shipmentContainers, title: PAGE_CATALOG.shipmentContainers.title },
  { test: p => p === routes.shipmentDebit, title: PAGE_CATALOG.shipmentDebit.title },
  { test: p => p === routes.shipmentNew, title: 'Tạo lô hàng' },
  { test: p => /^\/shipments\/\d+/.test(p), title: PAGE_CATALOG.shipmentDetail.title },
  { test: p => p.startsWith(routes.shipments), title: PAGE_CATALOG.shipments.title },
  { test: p => p === routes.penalties || p === routes.myPenalties, title: PAGE_CATALOG.penalties.title },
  { test: p => p.startsWith(routes.customers), title: PAGE_CATALOG.customers.title },
  { test: p => p.startsWith(routes.configRoutes) || p.startsWith(routes.legacy.routes), title: PAGE_CATALOG.configRoutes.title },
  { test: p => p.startsWith(routes.configDebitNoteTemplates), title: PAGE_CATALOG.configDebitNoteTemplates.title },
  { test: p => p === routes.config, title: PAGE_CATALOG.config.title },
  { test: p => /^\/config\/trucks\/\d+\/owners$/.test(p), title: 'Sở hữu xe' },
  { test: p => p === '/config/fuel-norms', title: 'Định mức nhiên liệu' },
  { test: p => p === '/config/weight-pricing-tiers', title: 'Bảng giá theo trọng lượng' },
  { test: p => p === '/config/lift-pricing', title: 'Bảng giá nâng/hạ container' },
  { test: p => p === '/config/ancillary-revenue', title: 'Doanh thu phi-vận-tải' },
  { test: p => p === '/config/ports', title: 'Cảng / Bãi' },
  { test: p => p.startsWith(routes.config), title: p => CONFIG_ITEMS.find(item => item.path.startsWith('/config/') && (p === item.path || p.startsWith(`${item.path}/`)))?.label ?? 'Cấu hình' },
  { test: p => p === routes.users, title: PAGE_CATALOG.users.title },
  { test: p => p === routes.auditLogs, title: PAGE_CATALOG.auditLogs.title },
  { test: p => p === routes.adminCenter, title: PAGE_CATALOG.adminCenter.title },
  { test: p => /^\/portal\/shipments\/\d+$/.test(p), title: 'Chi tiết lô hàng' },
  { test: p => p.startsWith(routes.portalShipments), title: 'Lô hàng của tôi' },
  { test: p => p.startsWith(routes.portalDebitNotes), title: 'Giấy báo nợ' },
  { test: p => p.startsWith(routes.portalStatement), title: 'Sao kê công nợ' },
  { test: p => p === routes.myTwoOrders, title: PAGE_CATALOG.myTwoOrders.title },
  { test: p => p === routes.myNotifications, title: 'Thông báo' },
  { test: p => p.startsWith(routes.myTrips), title: PAGE_CATALOG.myTrips.title },
  { test: p => p.startsWith(routes.myPayslips), title: PAGE_CATALOG.myPayslips.title },
  { test: p => p.startsWith(routes.myEarnings), title: PAGE_CATALOG.myEarnings.title },
  { test: p => p === routes.opsWallet, title: PAGE_CATALOG.opsWallet.title },
  { test: p => p === routes.opsOrders, title: PAGE_CATALOG.opsOrders.title },
  { test: p => p === routes.opsFleetTracking, title: PAGE_CATALOG.opsFleetTracking.title },
  { test: p => p.startsWith(routes.myOrders), title: PAGE_CATALOG.myOrders.title },
  { test: p => p.startsWith(routes.myForwarderTrips), title: PAGE_CATALOG.myForwarderTrips.title },
  { test: p => p.startsWith(routes.myAdvances), title: PAGE_CATALOG.myAdvances.title },
  { test: p => /^\/my-settlements\/\d+$/.test(p), title: PAGE_CATALOG.mySettlementDetail.title },
  { test: p => p.startsWith(routes.mySettlements), title: PAGE_CATALOG.mySettlements.title },
  { test: p => p.startsWith(routes.advances), title: PAGE_CATALOG.advances.title },
  { test: p => p.startsWith(routes.adminAdvanceSettlements), title: PAGE_CATALOG.adminAdvanceSettlements.title },
  { test: p => p.startsWith(routes.salary), title: PAGE_CATALOG.salary.title },
];

export function titleForPath(pathname: string, role?: string | null): string {
  // Role-branched overrides (paths where one URL serves two audiences with
  // different page framings). Only the topbar title is role-branched here;
  // the page body can branch its own <h1> via useAuth as needed.
  if (role) {
    const branchEntry = Object.entries(ROLE_BRANCHED_TITLES).find(([prefix]) => pathname.startsWith(prefix));
    if (branchEntry) return branchEntry[1](role);
  }
  const match = titleRules.find(rule => rule.test(pathname));
  if (!match) return BRAND.name;
  return typeof match.title === 'function' ? match.title(pathname) : match.title;
}

/**
 * Build an absolute URL (https://host/path) from a SPA path, using the
 * browser's own origin. Used by the share-link feature so a copied URL works
 * on whichever production domain the sharer is on (nepo vs vantai) without
 * any backend/env config.
 *
 * Pure CSR (Vite SPA) — `window` is always defined at call time. Call from
 * event handlers / component bodies, not at module top-level.
 */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}
