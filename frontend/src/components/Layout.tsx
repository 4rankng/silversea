import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Truck,
  Wallet,
  Receipt,
  AlertTriangle,
  Settings,
  Users,
  ScrollText,
  Route,
  DollarSign,
  Compass,
  Layers,
  FileText,
  FileSpreadsheet,
  Coins,
  Store,
  Package,
  CalendarDays,
  User,
  SlidersHorizontal,
  Landmark,
  Calculator,
  Anchor,
  Container,
  Activity,
  Bell,
  ClipboardList,
  ClipboardCheck,
  Fuel,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { useBadgeCounts } from '../hooks/useQueries';
import { ROLE_LABELS } from '@tingting/shared';
import { Role } from '@tingting/shared';
import { Sidebar } from './layout/Sidebar';
import { Topbar } from './layout/Topbar';
import { ProfileModal } from './layout/ProfileModal';
import { PasswordModal } from './layout/PasswordModal';
import { MobileAccountSheet } from './layout/MobileAccountSheet';
import type { NavItem, NavSection, SectionName } from './layout/types';
import { useBottomNavAnimations } from '../hooks/useBottomNavAnimations';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useTableArrowScroll } from '../hooks/useTableArrowScroll';
import { routes, titleForPath } from '../lib/routes';
import { getModernRole } from '../lib/role-helpers';
import { hasOperationalDensity } from '../lib/operational-density';
import { useDispatchFullwidthSidebar } from '../lib/dispatch-sidebar-policy';
import { BRAND } from '../brand';
import { requestAppNavigation } from '../lib/app-navigation';

// ─── Navigation config ────────────────────────────────────────────────────

/**
 * Per-role primary section that should be expanded by default when the user
 * lands on their start page (e.g. /dashboard for ADMIN/MANAGER, /accounting for
 * ACCOUNTANT, /dispatch for DISPATCHER, /my-trips for DRIVER, etc.).
 *
 * Per the O2C spec (Sidebar_update.md §II):
 *   "Khi truy cập trang bắt đầu, nhóm công việc trọng yếu nhất của vai trò đó
 *    sẽ được mở/sổ xuống (Expanded) mặc định."
 *
 * This is also the fallback used when the active route is the ungrouped home
 * page (Dashboard, Tổng Quan Kế Toán) — those items have no `section` so we
 * pick the role's primary section explicitly instead of relying on the array
 * order of `getNavSections()`.
 */
export const PRIMARY_SECTION_BY_ROLE: Record<string, SectionName | undefined> = {
  ADMIN: 'operations',
  MANAGER: 'operations',
  ACCOUNTANT: 'accounting-phoi-phieu',
  DISPATCHER: 'dispatch-planning',
  CUS: 'document-ops',
  OPS: 'my-work',
  DRIVER: 'my-work',
  CUSTOMER: 'portal',
};

export function getDefaultOpenSection(role: Role | string | undefined): SectionName | undefined {
  if (!role) return undefined;
  return PRIMARY_SECTION_BY_ROLE[getModernRole(role)];
}

// qa2-008: the sidebar label IS the page title it opens. The literals below
// carry the group structure only; getNavItems derives every label from
// titleForPath (PAGE_CATALOG + titleRules + role branches) so a title edit in
// the catalog propagates to the sidebar in the same build — the drift class
// this ticket closed cannot come back while the pin test holds.
type NavSpec = Omit<NavItem, 'label'>;

function buildNavItems(
  role: Role | string,
  dispatchCount?: number,
  penaltiesCount?: number,
  capabilities: readonly string[] = [],
): NavSpec[] {
  const normRole = getModernRole(role);
  const hasCapability = (capability: string) => capabilities.includes(capability);

  switch (normRole) {
    /* ─────────────────────────────────────────────────────────────────────────
       ADMIN & MANAGER: Full system visibility (separate menus)
       ───────────────────────────────────────────────────────────────────────── */
    case 'ADMIN': {
      return [
        // Vận hành (Operations) — O2C flow per spec
        { key: 'shipments', path: routes.shipments, icon: Package, section: 'operations' as SectionName },
        { key: 'dispatch', path: routes.dispatch, icon: Compass, section: 'operations' as SectionName, count: dispatchCount },
        { key: 'trips', path: routes.trips, icon: Truck, section: 'operations' as SectionName },
        { key: 'fleet', path: routes.fleet, icon: Layers, section: 'operations' as SectionName },

        // Báo cáo (Reports)
        { key: 'finance', path: routes.finance, icon: Wallet, section: 'reports' as SectionName },
        { key: 'profit', path: routes.profit, icon: DollarSign, section: 'reports' as SectionName },

        // Kế toán (Accounting) per spec §5.10 — the former single
        // "Công nợ & Dòng tiền" area, split into the 4 spec danh mục.
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', path: routes.treasury, icon: Landmark, section: 'accounting-quy' as SectionName },
        ] : []),
        { key: 'debt', path: routes.debt, icon: Receipt, section: 'accounting-cong-no' as SectionName },
        { key: 'payables', path: routes.payables, icon: Receipt, section: 'accounting-cong-no' as SectionName },
        { key: 'expenses', path: routes.expenses, icon: FileText, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'advances', path: routes.advances, icon: Wallet, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'hoan-ung', path: '/accounting/hoan-ung', icon: FileText, section: 'accounting-phoi-phieu' as SectionName },
        // Theo dõi hóa đơn kết hợp (card 20260921_18) — kế toán + quản trị write,
        // CUS read-only on the same page.
        { key: 'invoice-tracking', path: '/accounting/invoice-tracking', icon: FileSpreadsheet, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'deposit-tracker', path: '/accounting/deposit-tracker', icon: Coins, section: 'accounting-phoi-phieu' as SectionName },
        // Kiểm soát phơi phiếu / tiền đường (card 20260922_5) — the dedicated
        // control page built by card 20260921_12; discoverability only, the
        // route and its financeReader gate already existed.
        { key: 'phoi-phieu', path: '/accounting/phoi-phieu', icon: FileText, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'chot-debit', path: '/accounting/chot-debit', icon: Calculator, section: 'accounting-phoi-phieu' as SectionName },

        // Nhân sự (HR) — owner ruling 2026-10-12 (QA2-008): ALL HR items
        // group here — Lương & Chấm công, Danh sách nhân sự and Kỷ luật.
        // This supersedes spec §5.10's placement of Lương & Chấm công in the
        // accounting Khác danh mục for the sidebar; the empty Khác section
        // self-hides (Sidebar renders no empty section).
        { key: 'salary', path: routes.salary, icon: CalendarDays, section: 'hr' as SectionName },
        // Chấm công lái xe (2026-10-14). Only the grid: the reconciliation
        // board is ACCOUNTANT-only, so listing it here would be a dead link
        // (App.nav-sweep pins nav == guard).
        { key: 'timesheet', path: routes.timesheet, icon: CalendarDays, section: 'hr' as SectionName },
        { key: 'timesheet-report', path: routes.timesheetReport, icon: FileSpreadsheet, section: 'hr' as SectionName },
        { key: 'hr-roster', path: routes.hrRoster, icon: Users, section: 'hr' as SectionName },
        { key: 'penalties', path: routes.penalties, icon: AlertTriangle, section: 'hr' as SectionName, count: penaltiesCount },

        // Danh mục (Master Data) per spec
        { key: 'customers', path: routes.customers, icon: Users, section: 'master-data' as SectionName },
        { key: 'suppliers', path: routes.suppliers, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-routes', path: routes.configRoutes, icon: Route, section: 'master-data' as SectionName },
        { key: 'config-factories', path: routes.configFactories, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-ports', path: routes.configPorts, icon: Anchor, section: 'master-data' as SectionName },
        { key: 'config-pricing', path: routes.configPricingTables, icon: DollarSign, section: 'master-data' as SectionName },

        // Hệ thống (System) per spec
        { key: 'admin-center', path: routes.adminCenter, icon: Activity, section: 'system' as SectionName },
        { key: 'users', path: routes.users, icon: Users, section: 'system' as SectionName },
        { key: 'audit-logs', path: routes.auditLogs, icon: ScrollText, section: 'system' as SectionName },
        { key: 'app-settings', path: '/config/app-settings', icon: SlidersHorizontal, section: 'system' as SectionName },
        { key: 'config', path: routes.config, icon: Settings, section: 'system' as SectionName },

        // Tổng quan (Dashboard) - first item, per spec: "Tổng quan Quản trị"
        { key: 'dashboard', path: routes.dashboard, icon: LayoutDashboard, section: undefined },
      ].sort((a, b) => {
        if (a.key === 'dashboard') return -1;
        if (b.key === 'dashboard') return 1;
        return 0;
      });
    }

    case 'MANAGER': {
      return [
        // Vận hành (Operations) — O2C flow per spec
        { key: 'shipments', path: routes.shipments, icon: Package, section: 'operations' as SectionName },
        { key: 'dispatch', path: routes.dispatch, icon: Compass, section: 'operations' as SectionName, count: dispatchCount },
        { key: 'trips', path: routes.trips, icon: Truck, section: 'operations' as SectionName },
        { key: 'fleet', path: routes.fleet, icon: Layers, section: 'operations' as SectionName },

        // Báo cáo (Reports)
        { key: 'finance', path: routes.finance, icon: Wallet, section: 'reports' as SectionName },
        { key: 'profit', path: routes.profit, icon: DollarSign, section: 'reports' as SectionName },

        // Kế toán (Accounting) per spec §5.10 — split into the 4 danh mục.
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', path: routes.treasury, icon: Landmark, section: 'accounting-quy' as SectionName },
        ] : []),
        { key: 'debt', path: routes.debt, icon: Receipt, section: 'accounting-cong-no' as SectionName },
        { key: 'payables', path: routes.payables, icon: Receipt, section: 'accounting-cong-no' as SectionName },
        { key: 'expenses', path: routes.expenses, icon: FileText, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'advances', path: routes.advances, icon: Wallet, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'hoan-ung', path: '/accounting/hoan-ung', icon: FileText, section: 'accounting-phoi-phieu' as SectionName },

        // Nhân sự (HR) — owner ruling 2026-10-12 (QA2-008): ALL HR items
        // group here — Lương & Chấm công, Danh sách nhân sự and Kỷ luật.
        // This supersedes spec §5.10's placement of Lương & Chấm công in the
        // accounting Khác danh mục for the sidebar; the empty Khác section
        // self-hides (Sidebar renders no empty section).
        { key: 'salary', path: routes.salary, icon: CalendarDays, section: 'hr' as SectionName },
        // Chấm công lái xe (2026-10-14). Only the grid: the reconciliation
        // board is ACCOUNTANT-only, so listing it here would be a dead link
        // (App.nav-sweep pins nav == guard).
        { key: 'timesheet', path: routes.timesheet, icon: CalendarDays, section: 'hr' as SectionName },
        { key: 'timesheet-report', path: routes.timesheetReport, icon: FileSpreadsheet, section: 'hr' as SectionName },
        { key: 'hr-roster', path: routes.hrRoster, icon: Users, section: 'hr' as SectionName },
        { key: 'penalties', path: routes.penalties, icon: AlertTriangle, section: 'hr' as SectionName, count: penaltiesCount },

        // Danh mục (Master Data) per spec
        { key: 'customers', path: routes.customers, icon: Users, section: 'master-data' as SectionName },
        { key: 'suppliers', path: routes.suppliers, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-routes', path: routes.configRoutes, icon: Route, section: 'master-data' as SectionName },
        { key: 'config-factories', path: routes.configFactories, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-ports', path: routes.configPorts, icon: Anchor, section: 'master-data' as SectionName },
        { key: 'config-pricing', path: routes.configPricingTables, icon: DollarSign, section: 'master-data' as SectionName },

        // Hệ thống (System) per spec (MANAGER excludes app-settings + master-data import)
        { key: 'users', path: routes.users, icon: Users, section: 'system' as SectionName },
        { key: 'audit-logs', path: routes.auditLogs, icon: ScrollText, section: 'system' as SectionName },
        { key: 'config', path: routes.config, icon: Settings, section: 'system' as SectionName },

        // Tổng quan (Dashboard) - first item, per spec: "Tổng quan Quản trị"
        { key: 'dashboard', path: routes.dashboard, icon: LayoutDashboard, section: undefined },
      ].sort((a, b) => {
        if (a.key === 'dashboard') return -1;
        if (b.key === 'dashboard') return 1;
        return 0;
      });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       ACCOUNTANT: Financial focus only, NO /dashboard, /dispatch, /config/app-settings
       ───────────────────────────────────────────────────────────────────────── */
    case 'ACCOUNTANT': {
      return [
        // Tổng Quan Kế Toán (Accounting Dashboard) - first item, per spec
        { key: 'accounting', path: routes.accounting, icon: Calculator, section: undefined },

        // Kế toán (Accounting) per spec §5.10 — the old single "Công nợ &
        // Dòng tiền" area, split into the 4 spec danh mục.
        // Theo dõi hóa đơn kết hợp (card 20260921_18) — same read-only-for-CUS
        // page as the accountant entry; writes stay server-gated.
        { key: 'invoice-tracking', path: '/accounting/invoice-tracking', icon: FileSpreadsheet, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'deposit-tracker', path: '/accounting/deposit-tracker', icon: Coins, section: 'accounting-phoi-phieu' as SectionName },
        // Kiểm soát phơi phiếu / tiền đường (card 20260922_5) — ADMIN+ACCOUNTANT only.
        { key: 'phoi-phieu', path: '/accounting/phoi-phieu', icon: FileText, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'chot-debit', path: '/accounting/chot-debit', icon: Calculator, section: 'accounting-phoi-phieu' as SectionName },

        // Công nợ vận tải (AR/AP) + Quỹ per spec §5.10
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', path: routes.treasury, icon: Landmark, section: 'accounting-quy' as SectionName },
        ] : []),
        { key: 'debt', path: routes.debt, icon: Receipt, section: 'accounting-cong-no' as SectionName },
        { key: 'payables', path: routes.payables, icon: Receipt, section: 'accounting-cong-no' as SectionName },
        { key: 'expenses', path: routes.expenses, icon: FileText, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'advances', path: routes.advances, icon: Wallet, section: 'accounting-phoi-phieu' as SectionName },
        { key: 'hoan-ung', path: '/accounting/hoan-ung', icon: FileText, section: 'accounting-phoi-phieu' as SectionName },

        // Nhân sự (HR) — owner ruling 2026-10-12 (QA2-008): all HR items
        // group under Nhân sự for ACCOUNTANT too, superseding spec §5.10's
        // Khác placement. /salary stays officeStaffOnly (real destination,
        // not a dead link); the Khác section self-hides when empty.
        { key: 'salary', path: routes.salary, icon: CalendarDays, section: 'hr' as SectionName },
        // Chấm công lái xe (2026-10-14). FB-101 (card 141026230780): mục grid
        // KHÔNG còn bị ẩn với kế toán — xem lưới tại đây (chỉ xem; ghi lưới là
        // việc của Điều vận), đối chiếu ở bàn kế toán bên dưới.
        { key: 'timesheet', path: routes.timesheet, icon: CalendarDays, section: 'hr' as SectionName },
        { key: 'timesheet-reconciliation', path: routes.timesheetReconciliation, icon: ClipboardCheck, section: 'hr' as SectionName },
        { key: 'timesheet-report', path: routes.timesheetReport, icon: FileSpreadsheet, section: 'hr' as SectionName },
        { key: 'hr-roster', path: routes.hrRoster, icon: Users, section: 'hr' as SectionName },

        // Pricing config entry points (docx §5-1): accountant fuel-price entry + per-customer×route rate terms.
        // Master data, not one of the 4 spec danh mục — they live in the
        // accountant's 'Danh mục' group so no destination is left outside a
        // rendered section.
        { key: 'config-fuel-price-periods', path: routes.configFuelPricePeriods, icon: Fuel, section: 'master-data' as SectionName },
        { key: 'config-freight-rate-terms', path: routes.configFreightRateTerms, icon: DollarSign, section: 'master-data' as SectionName },

        // Báo cáo (Reports)
        { key: 'finance', path: routes.finance, icon: Wallet, section: 'reports' as SectionName },
        { key: 'profit', path: routes.profit, icon: DollarSign, section: 'reports' as SectionName },

        // Vận hành liên quan (Operations - View-only/Audit) per spec.
        // Trips/fleet/penalties were removed on 2026-10-05 because App.tsx then
        // guarded them with adminOnly, making each nav entry a dead link that
        // silently re-rendered /accounting. That premise is stale: all three
        // are officeStaffOnly, which admits ACCOUNTANT, and casbin grants the
        // resources behind them (`trips` read/write, `financial` for penalties,
        // `config` for the truck/driver catalog FleetPage reads). The same
        // correction was made for /salary in 3614f54e — restore the entries
        // rather than deny the route, or the deep link stays the only way in.
        { key: 'trips', path: routes.trips, icon: Truck, section: 'operations' as SectionName },
        { key: 'fleet', path: routes.fleet, icon: Layers, section: 'operations' as SectionName },
        { key: 'penalties', path: routes.penalties, icon: AlertTriangle, section: 'operations' as SectionName },
        { key: 'shipments', path: routes.shipments, icon: Package, section: 'operations' as SectionName },

        // Hệ thống (System) per spec — accountant has ONLY audit-logs in this section
        { key: 'audit-logs', path: routes.auditLogs, icon: ScrollText, section: 'system' as SectionName },
      ].sort((a, b) => {
        if (a.key === 'accounting') return -1;
        if (b.key === 'accounting') return 1;
        return 0;
      });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       DISPATCHER: Resource allocation focus, default = /dispatch
       ───────────────────────────────────────────────────────────────────────── */
    case 'DISPATCHER': {
      return [
        // Điều độ Phương tiện (Dispatch Planning) - PRIMARY SECTION per spec
        { key: 'dispatch-master-plan', path: routes.dispatchMasterPlan, icon: Compass, section: 'dispatch-planning' as SectionName },
        { key: 'dispatch-detailed-plan', path: routes.dispatchDetailedPlan, icon: Route, section: 'dispatch-planning' as SectionName },

        // Quản lý Tài nguyên (Resources) per spec
        { key: 'fleet-vehicles', path: routes.fleetVehicles, icon: Truck, section: 'resources' as SectionName },
        { key: 'fleet-drivers', path: routes.fleetDrivers, icon: Users, section: 'resources' as SectionName },
        { key: 'fleet-external', path: routes.fleetExternal, icon: Truck, section: 'resources' },
        { key: 'suppliers', path: routes.suppliers, icon: Store, section: 'resources' as SectionName },

        // Danh mục (Master Data) — dispatchers may add the missing customer or
        // route while staffing dispatch plans. Create-only: Casbin grants
        // DISPATCHER POST on customers/routes, and both catalog pages hide the
        // edit/delete affordances for this role.
        { key: 'customers', path: routes.configCustomers, icon: Users, section: 'master-data' as SectionName },
        { key: 'config-routes', path: routes.configRoutes, icon: Route, section: 'master-data' as SectionName },
        { key: 'config-factories', path: routes.configFactories, icon: Store, section: 'master-data' as SectionName },

        // Chấm công lái xe (2026-10-14): Điều vận fills the symbol grid. It sits
        // with dispatch planning — the roster board IS a dispatch job.
        { key: 'timesheet', path: routes.timesheet, icon: CalendarDays, section: 'dispatch-planning' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CUS (Customer Service): Document operations
       ───────────────────────────────────────────────────────────────────────── */
    case 'CUS': {
      return [
        // Nghiệp vụ Chứng từ (Document Operations)
        { key: 'shipments', path: routes.shipments, icon: Package, section: 'document-ops' as SectionName },
        { key: 'shipment-containers', path: routes.shipmentContainers, icon: Container, section: 'document-ops' as SectionName },
        { key: 'shipment-debit', path: routes.shipmentDebit, icon: Calculator, section: 'document-ops' as SectionName },
        // Theo dõi hóa đơn kết hợp (card 20260921_18) — read-only for this role;
        // the page hides editors and the server rejects writes (403).
        { key: 'invoice-tracking', path: '/accounting/invoice-tracking', icon: FileSpreadsheet, section: 'reconciliation' as SectionName },
        // Theo dõi hoàn cược deliberately ABSENT for CUS: the route guard
        // (/accounting/deposit-tracker) admits only ADMIN/MANAGER/ACCOUNTANT.
        // Nav must derive from the same permission source as the guard — an
        // entry here bounces CUS to /shipments (card 20260922_29).

        // Đối soát (Reconciliation)
        ...(hasCapability('recoverable_costs.read') ? [
          { key: 'recoverable-costs', path: routes.recoverableCosts, icon: Receipt, section: 'reconciliation' as SectionName },
        ] : []),

        // Danh mục (Master Data) — CUS can add/edit customers and routes
        { key: 'customers', path: routes.configCustomers, icon: Users, section: 'master-data' as SectionName },
        { key: 'config-routes', path: routes.configRoutes, icon: Route, section: 'master-data' as SectionName },
        // Giá dầu theo kỳ — docx §5-1 names CUS as a fuel-price entrant.
        { key: 'config-fuel-price-periods', path: routes.configFuelPricePeriods, icon: Fuel, section: 'master-data' as SectionName },
        { key: 'config-factories', path: routes.configFactories, icon: Store, section: 'master-data' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       OPS (Field Staff): My Work focus
       ───────────────────────────────────────────────────────────────────────── */
    case 'OPS': {
      return [
        // Tổng quan Ops (route /ops) — ungrouped home entry, first, the same
        // way /dashboard and /accounting lead their roles. opsHome stays
        // /my-orders; this is the overview dashboard, not the role home.
        { key: 'ops-overview', path: routes.opsOverview, icon: LayoutDashboard, section: undefined },
        // Vận hành hiện trường (OpsVanHanh) — kế hoạch làm hàng là màn chính.
        { key: 'ops-orders', path: routes.opsOrders, icon: ClipboardList, section: 'my-work' as SectionName },
        { key: 'ops-fleet-tracking', path: routes.opsFleetTracking, icon: Activity, section: 'my-work' as SectionName },
        { key: 'ops-wallet', path: routes.opsWallet, icon: Wallet, section: 'my-work' as SectionName },
        // Công việc của tôi (My Work)
        { key: 'my-orders', path: routes.myOrders, icon: Package, section: 'my-work' as SectionName },
        { key: 'my-advances', path: routes.myAdvances, icon: Wallet, section: 'my-work' as SectionName },
        { key: 'my-settlements', path: routes.mySettlements, icon: FileText, section: 'my-work' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       DRIVER: My trips and earnings
       ───────────────────────────────────────────────────────────────────────── */
    case 'DRIVER': {
      return [
        // Công việc của tôi (My Work) - same section for PC and mobile consistency
        { key: 'my-trips', path: routes.myTrips, icon: Route, section: 'my-work' as SectionName },
        { key: 'my-notifications', path: routes.myNotifications, icon: Bell, section: 'my-work' as SectionName },
        { key: 'my-earnings', path: routes.myEarnings, icon: DollarSign, section: 'my-work' as SectionName },
        { key: 'my-penalties', path: routes.myPenalties, icon: AlertTriangle, section: 'my-work' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CUSTOMER (Portal): Client portal access
       ───────────────────────────────────────────────────────────────────────── */
    case 'CUSTOMER': {
      return [
        // Portal menu
        { key: 'portal-shipments', path: routes.portalShipments, icon: Package, section: 'portal' as SectionName },
        { key: 'portal-debit-notes', path: routes.portalDebitNotes, icon: FileText, section: 'portal' as SectionName },
        { key: 'portal-statement', path: routes.portalStatement, icon: Landmark, section: 'portal' as SectionName },
      ];
    }

    default:
      return [];
  }
}

export function getNavItems(
  role: Role | string,
  dispatchCount?: number,
  penaltiesCount?: number,
  capabilities: readonly string[] = [],
): NavItem[] {
  const normRole = getModernRole(role);
  return buildNavItems(role, dispatchCount, penaltiesCount, capabilities).map((item) => ({
    ...item,
    label: titleForPath(item.path, normRole),
  }));
}

export function getNavSections(role: Role | string): NavSection[] {
  switch (getModernRole(role)) {
    case Role.ADMIN:
      return [
        { key: 'operations', label: 'Vận hành' },
        { key: 'reports', label: 'Báo cáo' },
        { key: 'accounting-phoi-phieu', label: 'Phơi phiếu' },
        { key: 'accounting-cong-no', label: 'Công nợ vận tải' },
        { key: 'accounting-quy', label: 'Quỹ' },
        { key: 'accounting-khac', label: 'Khác' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.MANAGER:
      return [
        { key: 'operations', label: 'Vận hành' },
        { key: 'reports', label: 'Báo cáo' },
        { key: 'accounting-phoi-phieu', label: 'Phơi phiếu' },
        { key: 'accounting-cong-no', label: 'Công nợ vận tải' },
        { key: 'accounting-quy', label: 'Quỹ' },
        { key: 'accounting-khac', label: 'Khác' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.ACCOUNTANT:
      return [
        { key: 'accounting-phoi-phieu', label: 'Phơi phiếu' },
        { key: 'accounting-cong-no', label: 'Công nợ vận tải' },
        { key: 'accounting-quy', label: 'Quỹ' },
        { key: 'accounting-khac', label: 'Khác' },
        // Owner ruling 2026-10-12 (QA2-008): the accountant's HR items
        // (Lương & Chấm công, Danh sách nhân sự) live under Nhân sự.
        { key: 'hr', label: 'Nhân sự' },
        // Pricing master data (Giá dầu theo kỳ, Điều khoản cước theo
        // tuyến) belongs to no spec danh mục, so it gets its own group.
        // Named "Giá & cước" rather than "Danh mục": the spec's own vocabulary
        // for the 4 groups above already uses the word "danh mục", and reusing
        // it for a 5th, different thing in the same menu reads as a duplicate.
        { key: 'master-data', label: 'Giá & cước' },
        { key: 'reports', label: 'Báo cáo' },
        { key: 'operations', label: 'Vận hành liên quan' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.DISPATCHER:
      return [
        { key: 'dispatch-planning', label: 'Điều độ Phương tiện' },
        { key: 'resources', label: 'Quản Lý' },
        // Catalog create-only group (customers, routes). Not 'Danh mục' — the
        // user's label philosophy dropped that prefix — and not 'Quản Lý',
        // which the resources group above already owns.
        { key: 'master-data', label: 'Khai báo' },
      ];
    case Role.CUS:
      return [
        { key: 'document-ops', label: 'Nghiệp vụ Chứng từ' },
        { key: 'reconciliation', label: 'Đối soát' },
        { key: 'master-data', label: 'Quản Lý' },
      ];
    case Role.OPS:
      return [{ key: 'my-work', label: 'Công việc của tôi' }];
    case Role.DRIVER:
      return [{ key: 'my-work', label: 'Công việc của tôi' }];
    case Role.CUSTOMER:
      return [{ key: 'portal', label: 'Portal' }];
    default:
      return [];
  }
}

function getRoleLabel(role: Role | string): string {
  const modernRole = getModernRole(role);
  return ROLE_LABELS[modernRole as Role] || modernRole;
}

export function getPageTitle(pathname: string, role?: Role | string): string {
  // qa2-008: the dispatcher supplier framing moved into routes.ts's
  // ROLE_BRANCHED_TITLES so the sidebar and the topbar resolve one authority.
  return titleForPath(pathname, role ? getModernRole(role) : undefined);
}

// ─── Layout component ─────────────────────────────────────────────────────

/**
 * Wide-desktop threshold aligned with `--content-max-w` (tokens.css): below it
 * the content column is width-constrained anyway, so the sidebar's 248px rail
 * steals space from wide tables (e.g. /shipments, /shipments-detail). On such
 * viewports the sidebar starts collapsed to its 48px icon rail and reopens only
 * on explicit user action (topbar toggle / Cmd-B).
 */
export const WIDE_DESKTOP_MIN_WIDTH = 1440;

/** Viewports that are desktop-class (≥1024px) but below the wide-desktop threshold. */
export const COMPACT_DESKTOP_MEDIA_QUERY = `(min-width: 1024px) and (max-width: ${WIDE_DESKTOP_MIN_WIDTH - 1}px)`;

export function resolveInitialSidebarOpen(viewportWidth: number): boolean {
  return viewportWidth >= WIDE_DESKTOP_MIN_WIDTH;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, updateUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const bottomNavRef = useBottomNavAnimations({ ready: !!user && user.role === 'DRIVER' });
  const [sidebarOpen, setSidebarOpen] = useState(() => resolveInitialSidebarOpen(window.innerWidth));
  // An explicit user choice survives breakpoint crossings; without one the
  // crossing re-derives the width default (first-run behavior unchanged).
  const sidebarPreferenceRef = useRef<boolean | null>(null);
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(v => {
      sidebarPreferenceRef.current = !v;
      return !v;
    });
  }, []);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountDialogOpenedFromSheetRef = useRef(false);

  // Profile modal state
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ email: '', phone: '', username: '', fullName: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const currentPasswordFieldRef = useRef<HTMLInputElement | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // The sheet action unmounts when it opens a dialog. Restore to the stable
  // account trigger after the dialog closes, including after a profile save.
  // Desktop dialogs retain the shared modal's ordinary opener restoration.
  useEffect(() => {
    if (profileModalOpen || passwordModalOpen || !accountDialogOpenedFromSheetRef.current) return;
    accountDialogOpenedFromSheetRef.current = false;
    const frame = requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 1023px)').matches) accountButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [profileModalOpen, passwordModalOpen]);
  const toggleUserMenu = useCallback(() => setUserMenuOpen(v => !v), []);
  const closeUserMenu = useCallback(() => {
    setUserMenuOpen(false);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => accountButtonRef.current?.focus());
    }
  }, []);
  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
      setUserMenuOpen(false);
      // Entering desktop from mobile may land in the compact-desktop range,
      // where the sidebar must stay collapsed for full-width tables.
      setSidebarOpen(sidebarPreferenceRef.current ?? resolveInitialSidebarOpen(window.innerWidth));
    };
    media.addEventListener('change', handleViewportChange);
    return () => media.removeEventListener('change', handleViewportChange);
  }, []);

  // Compact desktop (1024–1439px): collapse for full-width tables, reopen
  // past the threshold; one state set per crossing, manual toggles persist
  // until then. Resolves from window.innerWidth (not event.matches) so a
  // 1024→1023 shrink never leaves the mobile drawer open (resolve() is
  // false at every flippable boundary; compact listener fires after mobile).
  useEffect(() => {
    const media = window.matchMedia(COMPACT_DESKTOP_MEDIA_QUERY);
    const handleCompactDesktopChange = () => {
      setSidebarOpen(sidebarPreferenceRef.current ?? resolveInitialSidebarOpen(window.innerWidth));
    };
    media.addEventListener('change', handleCompactDesktopChange);
    return () => media.removeEventListener('change', handleCompactDesktopChange);
  }, []);

  // /dispatch-detail (customer doc2 BUG2): sidebar yields to the plan table
  // below the wide-desktop threshold — policy+hook in lib/dispatch-sidebar-policy.
  useDispatchFullwidthSidebar(location.pathname, closeSidebar);

  // SIL-531: ←/→ scroll every table in the app horizontally (mounted once in
  // the shell, so the behaviour is global — never a per-page keydown copy).
  useTableArrowScroll();

  // Auto-subscribe drivers to push notifications (spec AC-DISPATCH-001).
  // Drivers must receive dispatch orders even when the app is backgrounded.
  // The subscribe() hook is idempotent — it no-ops if already subscribed or
  // if the browser denies permission.
  const { isSupported: pushSupported, isSubscribed: pushSubscribed, permissionStatus: pushPermission, subscribe: subscribePush } = usePushNotifications();
  useEffect(() => {
    if (user?.role === 'DRIVER' && pushSupported && !pushSubscribed && pushPermission !== 'denied') {
      void subscribePush();
    }
  }, [user?.role, pushSupported, pushSubscribed, pushPermission, subscribePush]);

  const openProfileModal = () => {
    if (!user) return;
    accountDialogOpenedFromSheetRef.current = user.role === 'DRIVER' && isMobileViewport && userMenuOpen;
    setProfileForm({ email: user.email || '', phone: user.phone || '', username: user.username || '', fullName: user.fullName || '' });
    setProfileError(null);
    setProfileModalOpen(true);
    setUserMenuOpen(false);
  };

  const openPasswordModal = () => {
    accountDialogOpenedFromSheetRef.current = user?.role === 'DRIVER' && isMobileViewport && userMenuOpen;
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordError(null);
    setPasswordModalOpen(true);
    setUserMenuOpen(false);
  };

  const handleSaveProfile = async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const updated = await api.patch<{ email: string; phone: string; username: string; fullName: string | null }>('/auth/me', profileForm);
      updateUser({ email: updated.email, phone: updated.phone, username: updated.username, fullName: updated.fullName ?? undefined });
      setProfileModalOpen(false);
    } catch (err: unknown) {
      setProfileError((err as Error)?.message || 'Không thể lưu thông tin.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordSaving) return;
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      setPasswordError('Vui lòng nhập đầy đủ thông tin.');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }
    if (passwordForm.newPassword.length > 128) {
      setPasswordError('Mật khẩu quá dài (tối đa 128 ký tự).');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordModalOpen(false);
      // The server revoked this session's token as part of the password
      // change, so the SPA must drop it and send the user to sign in with
      // the new password — staying signed in would 401 every later request.
      logout({ revoke: false });
    } catch (err: unknown) {
      const message = (err as Error)?.message || 'Không thể đổi mật khẩu.';
      setPasswordError(message);
      // A wrong current password is a field error: clear it and refocus so
      // the user corrects just that field — the session stays signed in.
      if (message.includes('Mật khẩu hiện tại không đúng')) {
        setPasswordForm((form) => ({ ...form, currentPassword: '' }));
        currentPasswordFieldRef.current?.focus();
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  // Badge counts
  const { data: badgeData } = useBadgeCounts({
    enabled: !!user && ['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(user.role),
  });
  const dispatchCount = badgeData?.dispatchCount;
  const penaltiesCount = badgeData?.penaltiesCount;

  // Nav items and active state
  const navItems = useMemo(() => user ? getNavItems(
    user.role,
    dispatchCount,
    penaltiesCount,
    user.capabilities,
  ) : [], [dispatchCount, penaltiesCount, user]);
  const navSections = useMemo(
    () => user ? getNavSections(user.role) : [],
    [user],
  );
  const activeKey = navItems
    .filter(item => location.pathname.startsWith(item.path))
    .sort((a, b) => b.path.length - a.path.length)[0]?.key || '';

  const pageTitle = getPageTitle(location.pathname, user?.role);
  const activeSection = navItems.find(i => i.key === activeKey)?.section;
  // When the active item is the ungrouped start page (e.g. /dashboard,
  // /accounting), fall back to the role's primary section per spec rather than
  // blindly taking the first section in the list.
  const primarySection = getDefaultOpenSection(user?.role);
  const preferredOpenSection = activeSection ?? primarySection ?? navSections[0]?.key;

  // Sidebar navigation handler
  const handleNavigate = useCallback((path: string) => {
    requestAppNavigation(path, () => {
      if (window.innerWidth < 1024) setSidebarOpen(false);
      setUserMenuOpen(false);
      navigate(path);
    });
  }, [navigate]);

  // Sidebar collapse state
  const navRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [navClientHeight, setNavClientHeight] = useState(0);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    setNavClientHeight(nav.clientHeight);
    const ro = new ResizeObserver(() => setNavClientHeight(nav.clientHeight));
    ro.observe(nav);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // When the sidebar is collapsed, the dedicated effect below force-expands
    // every section; bail out here so this layout calc only runs when expanded
    // (and only once the nav has been measured).
    if (!sidebarOpen || navClientHeight === 0) return;
    const nav = navRef.current;
    if (!nav) return;
    const item = nav.querySelector('.sidebar-item') as HTMLElement | null;
    const label = nav.querySelector('.sidebar-section-label') as HTMLElement | null;
    const navStyle = getComputedStyle(nav);
    const ITEM_H = item?.offsetHeight ?? 38;
    const LABEL_H = label?.offsetHeight ?? 36;
    const NAV_PAD = parseFloat(navStyle.paddingTop) + parseFloat(navStyle.paddingBottom) || 20;
    const ungroupedCount = navItems.filter(i => !i.section).length;
    const totalH = navSections.reduce((acc, section) => {
      const count = navItems.filter(i => i.section === section.key).length;
      return count > 0 ? acc + LABEL_H + count * ITEM_H : acc;
    }, NAV_PAD + ungroupedCount * ITEM_H);

    if (totalH > navClientHeight) {
      setCollapsed(prev => {
        const next = new Set<string>(
          navSections.map(section => section.key).filter(key => key !== preferredOpenSection)
        );
        if (next.size === prev.size && [...next].every(k => prev.has(k))) return prev;
        return next;
      });
    } else {
      setCollapsed(prev => (prev.size === 0 ? prev : new Set<string>()));
    }
  }, [navClientHeight, sidebarOpen, navItems, navSections, preferredOpenSection]);

  const toggleSection = useCallback((key: string) => {
    if (!sidebarOpen) return;
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [sidebarOpen]);

  // In icons-only (collapsed) mode the section chevrons + labels are hidden,
  // so per-section collapse just hides icons the user can no longer click
  // back to. Force all sections expanded so every menu item stays reachable.
  useEffect(() => {
    if (sidebarOpen) return;
    setCollapsed(prev => (prev.size === 0 ? prev : new Set<string>()));
  }, [sidebarOpen]);

  // Update browser tab title on route change
  useEffect(() => {
    document.title = `${pageTitle} · ${BRAND.name}`;
  }, [pageTitle]);

  // Screen reader live region
  const [ariaLiveMsg, setAriaLiveMsg] = useState('');
  useEffect(() => {
    setAriaLiveMsg(`Đã chuyển đến ${pageTitle}`);
  }, [pageTitle]);

  if (!user) return null;

  const isDriver = user.role === 'DRIVER';

  const sidebarProps = {
    user,
    navItems,
    navSections,
    activeKey,
    sidebarOpen,
    isMobileViewport,
    userMenuOpen: userMenuOpen && !(isDriver && isMobileViewport),
    collapsed,
    onNavigate: handleNavigate,
    onToggleSidebar: closeSidebar,
    onToggleUserMenu: toggleUserMenu,
    onCloseUserMenu: closeUserMenu,
    onOpenProfileModal: openProfileModal,
    onOpenPasswordModal: openPasswordModal,
    onLogout: logout,
    navRef,
    activeSection,
    toggleSection,
  };

  const topbarProps = {
    user,
    isDriver,
    pageTitle,
    sidebarOpen,
    menuButtonRef,
    onToggleSidebar: toggleSidebar,
  };

  return (
    <div className={`app ${!sidebarOpen ? 'sidebar-closed' : ''} ${isDriver ? 'is-driver' : ''} ${hasOperationalDensity(location.pathname) ? 'app--operational-density' : 'app--frozen-operational-surface'}`}>
      <a href="#main-content" className="skip-link">Bỏ qua đến nội dung chính</a>
      {/* Screen reader live region for route changes */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{ariaLiveMsg}</div>

      <Sidebar {...sidebarProps} />

      <ProfileModal
        isOpen={profileModalOpen}
        onClose={() => { if (!profileSaving) setProfileModalOpen(false); }}
        saving={profileSaving}
        error={profileError}
        form={profileForm}
        onFormChange={setProfileForm}
        onSave={handleSaveProfile}
      />

      <PasswordModal
        isOpen={passwordModalOpen}
        onClose={() => { if (!passwordSaving) setPasswordModalOpen(false); }}
        saving={passwordSaving}
        error={passwordError}
        currentPasswordFieldRef={currentPasswordFieldRef}
        isCurrentPasswordError={(passwordError ?? '').includes('Mật khẩu hiện tại không đúng')}
        form={passwordForm}
        onFormChange={setPasswordForm}
        onSave={handleChangePassword}
      />

      <div className={`app-main ${isDriver ? 'driver-mode' : ''}`} inert={isDriver && isMobileViewport && userMenuOpen}>
        <Topbar {...topbarProps} />

        <main className="app-body" id="main-content" tabIndex={-1}>
          {children}
        </main>

        {/* Bottom Navigation for Drivers on Mobile */}
        {isDriver && (
          <nav className="bottom-nav" aria-label="Điều hướng chính" ref={bottomNavRef as React.RefObject<HTMLElement>}>
            {navItems.filter(item => item.key !== 'my-notifications').map(item => {
              const IconC = item.icon;
              const isActive = !userMenuOpen && item.key === activeKey;
              const displayLabel = item.mobileLabel || item.label;
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  className={`bottom-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.path)}
                >
                  <div className="bottom-nav-indicator" />
                  <div className="bottom-nav-icon-wrap">
                    <IconC size={20} strokeWidth={isActive ? 2.5 : 2} aria-hidden="true" />
                  </div>
                  <span className="bottom-nav-label">{displayLabel}</span>
                </button>
              );
            })}

            {/* Account button for mobile bottom nav */}
            <button
              ref={accountButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={userMenuOpen && isMobileViewport}
              aria-controls={userMenuOpen && isMobileViewport ? 'mobile-account-sheet' : undefined}
              className={`bottom-nav-item ${userMenuOpen ? 'active' : ''}`}
              onClick={toggleUserMenu}
            >
              <div className="bottom-nav-indicator" />
              <div className="bottom-nav-icon-wrap">
                <User size={20} strokeWidth={userMenuOpen ? 2.5 : 2} aria-hidden="true" />
              </div>
              <span className="bottom-nav-label">Tài khoản</span>
            </button>
          </nav>
        )}
      </div>

      {isDriver && isMobileViewport && userMenuOpen && (
        <MobileAccountSheet
          user={user}
          roleLabel={getRoleLabel(user.role)}
          onClose={closeUserMenu}
          openerRef={accountButtonRef}
          onOpenProfile={openProfileModal}
          onOpenNotifications={() => handleNavigate(routes.myNotifications)}
          onOpenPassword={openPasswordModal}
          onLogout={() => { setUserMenuOpen(false); logout(); }}
        />
      )}
    </div>
  );
}
