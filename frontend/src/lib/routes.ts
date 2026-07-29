/**
 * Frontend projection of the shared page catalog (`PAGE_CATALOG` in
 * `@tingting/shared`). The catalog is the single source of truth for every
 * path string, page title, and agent-search description; this module exposes
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

export const routes = {
  /* ── Top-level admin / manager pages ────────────────────────────────── */

  dashboard: PAGE_CATALOG.dashboard.path,
  dispatch: PAGE_CATALOG.dispatch.path,
  fleet: PAGE_CATALOG.fleet.path,
  fleetTires: (truckId: number | string) => PAGE_CATALOG.fleetTires.path({ truckId }),
  fleetTrailerTires: (trailerId: number | string) => PAGE_CATALOG.fleetTrailerTires.path({ trailerId }),
  trips: PAGE_CATALOG.trips.path,
  tripNew: PAGE_CATALOG.tripNew.path,
  tripDetail: (id: number | string) => PAGE_CATALOG.tripDetail.path({ id }),
  tripEdit: (id: number | string) => PAGE_CATALOG.tripEdit.path({ id }),
  finance: PAGE_CATALOG.finance.path,
  profit: PAGE_CATALOG.profit.path,
  debt: PAGE_CATALOG.debt.path,
  debtDetail: (id: number | string) => PAGE_CATALOG.debtDetail.path({ id }),
  penalties: PAGE_CATALOG.penalties.path,
  advances: PAGE_CATALOG.advances.path,
  adminAdvanceSettlements: PAGE_CATALOG.adminAdvanceSettlements.path,
  salary: PAGE_CATALOG.salary.path,
  users: PAGE_CATALOG.users.path,
  auditLogs: PAGE_CATALOG.auditLogs.path,
  chatbotMonitoring: PAGE_CATALOG.chatbotMonitoring.path,
  customers: PAGE_CATALOG.customers.path,
  suppliers: PAGE_CATALOG.suppliers.path,
  // Wave 0: shipment (lô hàng) — minimal read-only list + detail.
  shipments: PAGE_CATALOG.shipments.path,
  shipmentDetail: (id: number | string) => PAGE_CATALOG.shipmentDetail.path({ id }),
  expenses: PAGE_CATALOG.expenses.path,
  expenseNew: PAGE_CATALOG.expenseNew.path,
  expenseEdit: (id: number | string) => PAGE_CATALOG.expenseEdit.path({ id }),
  payables: PAGE_CATALOG.payables.path,
  payableDetail: (id: number | string) => PAGE_CATALOG.payableDetail.path({ id }),
  creditOverrides: '/credit-overrides',
  governanceActions: PAGE_CATALOG.governanceActions.path,
  login: PAGE_CATALOG.login.path,

  /* ── Config (catalog admin) ─────────────────────────────────────────── */

  config: PAGE_CATALOG.config.path,
  configTrailers: PAGE_CATALOG.configTrailers.path,
  configTrucks: PAGE_CATALOG.configTrucks.path,
  configTruckOwners: (truckId: number | string) => PAGE_CATALOG.configTruckOwners.path({ truckId }),
  configRoutes: PAGE_CATALOG.configRoutes.path,
  configCargoTypes: PAGE_CATALOG.configCargoTypes.path,
  configPricingTables: PAGE_CATALOG.configPricingTables.path,
  configRoadAllowances: PAGE_CATALOG.configRoadAllowances.path,
  configPenaltyReasons: PAGE_CATALOG.configPenaltyReasons.path,
  configFuel: PAGE_CATALOG.configFuel.path,
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
  myEarnings: PAGE_CATALOG.myEarnings.path,
  myPenalties: PAGE_CATALOG.myPenalties.path,

  /* ── Forwarder portal ──────────────────────────────────────────────── */

  myForwarderTrips: PAGE_CATALOG.myForwarderTrips.path,
  myForwarderTripDetail: (id: number | string) => PAGE_CATALOG.myForwarderTripDetail.path({ id }),
  myAdvances: PAGE_CATALOG.myAdvances.path,
  mySettlements: PAGE_CATALOG.mySettlements.path,
  mySettlementNew: PAGE_CATALOG.mySettlementNew.path,
  mySettlementDetail: (id: number | string) => PAGE_CATALOG.mySettlementDetail.path({ id }),

  /* ── Customer portal (Wave 2) ─────────────────────────────────────── */

  portalShipments: '/portal/shipments',
  portalShipmentDetail: (id: number | string) => `/portal/shipments/${id}`,
  portalDebitNotes: '/portal/debit-notes',
  portalStatement: '/portal/statement',

  /* ── Clerk portal (Wave 4) ────────────────────────────────────────── */

  clerkShipmentNew: '/clerk/shipments/new',
  clerkShipmentDocs: (id: number | string) => `/clerk/shipments/${id}/docs`,

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

/** Resolve a "home" route for a given role — used after login + on 404. */
export function homeForRole(role: 'DRIVER' | 'FORWARDER' | string): string {
  if (role === 'DRIVER') return routes.myTrips;
  if (role === 'FORWARDER') return routes.myForwarderTrips;
  if (role === 'CUSTOMER') return routes.portalShipments;
  if (role === 'CLERK') return routes.clerkShipmentNew;
  return routes.dashboard;
}

type TitleRule = {
  test: (pathname: string) => boolean;
  title: string | ((pathname: string) => string);
};

// Order is load-bearing precedence (first match wins). The title strings are
// sourced from PAGE_CATALOG so they can't drift from the agent descriptions /
// sidebar; only the generic `/config/*` fallback ("Cấu hình") stays a literal
// since no single catalog entry owns it.
const titleRules: TitleRule[] = [
  { test: p => p === routes.dashboard, title: PAGE_CATALOG.dashboard.title },
  { test: p => p.startsWith(routes.dispatch), title: PAGE_CATALOG.dispatch.title },
  { test: p => p.startsWith(routes.fleet), title: PAGE_CATALOG.fleet.title },
  { test: p => /^\/trips\/(\d+)(?:\/edit)?$/.test(p), title: p => p.endsWith('/edit') ? PAGE_CATALOG.tripEdit.title : PAGE_CATALOG.tripDetail.title },
  { test: p => p === routes.tripNew, title: PAGE_CATALOG.tripNew.title },
  { test: p => p.startsWith(routes.trips), title: PAGE_CATALOG.trips.title },
  { test: p => p === routes.finance, title: PAGE_CATALOG.finance.title },
  { test: p => p.startsWith(routes.profit), title: PAGE_CATALOG.profit.title },
  { test: p => p.startsWith(routes.debt), title: PAGE_CATALOG.debt.title },
  { test: p => p.startsWith(routes.payables), title: PAGE_CATALOG.payables.title },
  { test: p => p.startsWith(routes.creditOverrides), title: 'Duyệt vượt hạn mức' },
  { test: p => p.startsWith(routes.governanceActions), title: PAGE_CATALOG.governanceActions.title },
  { test: p => p.startsWith(routes.expenseNew), title: PAGE_CATALOG.expenseNew.title },
  { test: p => /^\/expenses\/\d+\/edit$/.test(p), title: PAGE_CATALOG.expenseEdit.title },
  { test: p => p.startsWith(routes.expenses), title: PAGE_CATALOG.expenses.title },
  { test: p => p.startsWith(routes.suppliers), title: PAGE_CATALOG.suppliers.title },
  { test: p => /^\/shipments\/\d+/.test(p), title: PAGE_CATALOG.shipmentDetail.title },
  { test: p => p.startsWith(routes.shipments), title: PAGE_CATALOG.shipments.title },
  { test: p => p === routes.penalties || p === routes.myPenalties, title: PAGE_CATALOG.penalties.title },
  { test: p => p.startsWith(routes.customers), title: PAGE_CATALOG.customers.title },
  { test: p => p.startsWith(routes.configRoutes) || p.startsWith(routes.legacy.routes), title: PAGE_CATALOG.configRoutes.title },
  { test: p => p.startsWith(routes.configDebitNoteTemplates), title: PAGE_CATALOG.configDebitNoteTemplates.title },
  { test: p => p === routes.config, title: PAGE_CATALOG.config.title },
  { test: p => p.startsWith(routes.config), title: 'Cấu hình' },
  { test: p => p === routes.users, title: PAGE_CATALOG.users.title },
  { test: p => p === routes.auditLogs, title: PAGE_CATALOG.auditLogs.title },
  { test: p => p === routes.chatbotMonitoring, title: PAGE_CATALOG.chatbotMonitoring.title },
  { test: p => /^\/portal\/shipments\/\d+$/.test(p), title: 'Chi tiết lô hàng' },
  { test: p => p.startsWith(routes.portalShipments), title: 'Lô hàng của tôi' },
  { test: p => p.startsWith(routes.portalDebitNotes), title: 'Giấy báo nợ' },
  { test: p => p.startsWith(routes.portalStatement), title: 'Sao kê công nợ' },
  { test: p => /^\/clerk\/shipments\/\d+\/docs$/.test(p), title: 'Hồ sơ lô hàng' },
  { test: p => p.startsWith(routes.clerkShipmentNew), title: 'Tạo lô hàng' },
  { test: p => p.startsWith(routes.myTrips), title: PAGE_CATALOG.myTrips.title },
  { test: p => p.startsWith(routes.myEarnings), title: PAGE_CATALOG.myEarnings.title },
  { test: p => p.startsWith(routes.myForwarderTrips), title: PAGE_CATALOG.myForwarderTrips.title },
  { test: p => p.startsWith(routes.myAdvances), title: PAGE_CATALOG.myAdvances.title },
  { test: p => /^\/my-settlements\/\d+$/.test(p), title: PAGE_CATALOG.mySettlementDetail.title },
  { test: p => p.startsWith(routes.mySettlements), title: PAGE_CATALOG.mySettlements.title },
  { test: p => p.startsWith(routes.advances), title: PAGE_CATALOG.advances.title },
  { test: p => p.startsWith(routes.adminAdvanceSettlements), title: PAGE_CATALOG.adminAdvanceSettlements.title },
  { test: p => p.startsWith(routes.salary), title: PAGE_CATALOG.salary.title },
];

export function titleForPath(pathname: string): string {
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
