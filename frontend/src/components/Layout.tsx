import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { OfflineBanner } from './shared/OfflineBanner';
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
  Store,
  Package,
  CalendarDays,
  User,
  LogOut,
  UserCog,
  KeyRound,
  ChevronRight,
  Shield,
  Phone,
  ClipboardCheck,
  SlidersHorizontal,
  Landmark,
  Calculator,
  Anchor,
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
import type { NavItem, NavSection, SectionName } from './layout/types';
import { useBottomNavAnimations } from '../hooks/useBottomNavAnimations';
import { routes, titleForPath } from '../lib/routes';
import { getModernRole } from '../lib/role-helpers';
import { BRAND } from '../brand';

// ─── Navigation config ────────────────────────────────────────────────────

/**
 * Per-role primary section that should be expanded by default when the user
 * lands on their start page (e.g. /dashboard for ADMIN/MANAGER, /accounting for
 * ACCOUNTANT, /dispatch/master-plan for DISPATCHER, /my-trips for DRIVER, etc.).
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
  ACCOUNTANT: 'financials',
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

export function getNavItems(
  role: Role | string,
  dispatchCount?: number,
  penaltiesCount?: number,
  capabilities: readonly string[] = [],
): NavItem[] {
  const normRole = getModernRole(role);
  const hasCapability = (capability: string) => capabilities.includes(capability);

  switch (normRole) {
    /* ─────────────────────────────────────────────────────────────────────────
       ADMIN & MANAGER: Full system visibility (separate menus)
       ───────────────────────────────────────────────────────────────────────── */
    case 'ADMIN': {
      return [
        // Vận hành (Operations) — O2C flow per spec
        { key: 'shipments', label: 'Quản lý Lô hàng', path: routes.shipments, icon: Package, section: 'operations' as SectionName },
        { key: 'dispatch', label: 'Điều vận', path: routes.dispatch, icon: Compass, section: 'operations' as SectionName, count: dispatchCount },
        { key: 'trips', label: 'Sổ chuyến đi', path: routes.trips, icon: Truck, section: 'operations' as SectionName },
        { key: 'fleet', label: 'Đội xe', path: routes.fleet, icon: Layers, section: 'operations' as SectionName },

        // Báo cáo & Phê duyệt (Reports & Approvals) per spec
        { key: 'finance', label: 'Báo cáo Lãi lỗ', path: routes.finance, icon: Wallet, section: 'reports' as SectionName },
        { key: 'profit', label: 'Báo cáo Lợi nhuận', path: routes.profit, icon: DollarSign, section: 'reports' as SectionName },
        { key: 'credit-overrides', label: 'Duyệt vượt hạn mức', path: routes.creditOverrides, icon: Shield, section: 'reports' as SectionName },
        { key: 'governance-actions', label: 'Trung tâm phê duyệt', path: routes.governanceActions, icon: ClipboardCheck, section: 'reports' as SectionName },

        // Công nợ & Dòng tiền (AR/AP) per spec
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', label: 'Sổ quỹ / Ngân hàng', path: routes.treasury, icon: Landmark, section: 'financials' as SectionName },
        ] : []),
        { key: 'debt', label: 'Công nợ phải thu', path: routes.debt, icon: Receipt, section: 'financials' as SectionName },
        { key: 'payables', label: 'Công nợ phải trả', path: routes.payables, icon: Receipt, section: 'financials' as SectionName },
        { key: 'expenses', label: 'Chi phí phát sinh', path: routes.expenses, icon: FileText, section: 'financials' as SectionName },
        { key: 'advances', label: 'Tạm ứng & Hoàn ứng', path: routes.advances, icon: Wallet, section: 'financials' as SectionName },

        // Nhân sự (HR)
        { key: 'salary', label: 'Lương & Chấm công', path: routes.salary, icon: CalendarDays, section: 'hr' as SectionName },
        { key: 'penalties', label: 'Kỷ luật', path: routes.penalties, icon: AlertTriangle, section: 'hr' as SectionName, count: penaltiesCount },

        // Danh mục (Master Data) per spec
        { key: 'customers', label: 'Khách hàng', path: routes.customers, icon: Users, section: 'master-data' as SectionName },
        { key: 'suppliers', label: 'Nhà cung cấp / Nhà xe', path: routes.suppliers, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-routes', label: 'Tuyến đường', path: routes.configRoutes, icon: Route, section: 'master-data' as SectionName },
        { key: 'config-factories', label: 'Nhà máy', path: routes.configFactories, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-ports', label: 'Cảng / Bãi & Biểu phí', path: routes.configPorts, icon: Anchor, section: 'master-data' as SectionName },
        { key: 'config-pricing', label: 'Bảng giá cước', path: routes.configPricingTables, icon: DollarSign, section: 'master-data' as SectionName },

        // Hệ thống (System) per spec
        { key: 'users', label: 'Quản lý Người dùng', path: routes.users, icon: Users, section: 'system' as SectionName },
        { key: 'audit-logs', label: 'Nhật ký hệ thống', path: routes.auditLogs, icon: ScrollText, section: 'system' as SectionName },
        { key: 'app-settings', label: 'Cài đặt ứng dụng', path: '/config/app-settings', icon: SlidersHorizontal, section: 'system' as SectionName },
        { key: 'config', label: 'Cấu hình chung', path: routes.config, icon: Settings, section: 'system' as SectionName },

        // Tổng quan (Dashboard) - first item, per spec: "Tổng quan Quản trị"
        { key: 'dashboard', label: 'Tổng quan Quản trị', path: routes.dashboard, icon: LayoutDashboard, section: undefined },
      ].sort((a, b) => {
        if (a.key === 'dashboard') return -1;
        if (b.key === 'dashboard') return 1;
        return 0;
      });
    }

    case 'MANAGER': {
      return [
        // Vận hành (Operations) — O2C flow per spec
        { key: 'shipments', label: 'Quản lý Lô hàng', path: routes.shipments, icon: Package, section: 'operations' as SectionName },
        { key: 'dispatch', label: 'Điều vận', path: routes.dispatch, icon: Compass, section: 'operations' as SectionName, count: dispatchCount },
        { key: 'trips', label: 'Sổ chuyến đi', path: routes.trips, icon: Truck, section: 'operations' as SectionName },
        { key: 'fleet', label: 'Đội xe', path: routes.fleet, icon: Layers, section: 'operations' as SectionName },

        // Báo cáo & Phê duyệt (Reports & Approvals) per spec
        { key: 'finance', label: 'Báo cáo Lãi lỗ', path: routes.finance, icon: Wallet, section: 'reports' as SectionName },
        { key: 'profit', label: 'Báo cáo Lợi nhuận', path: routes.profit, icon: DollarSign, section: 'reports' as SectionName },
        { key: 'credit-overrides', label: 'Duyệt vượt hạn mức', path: routes.creditOverrides, icon: Shield, section: 'reports' as SectionName },
        { key: 'governance-actions', label: 'Trung tâm phê duyệt', path: routes.governanceActions, icon: ClipboardCheck, section: 'reports' as SectionName },

        // Công nợ & Dòng tiền (AR/AP) per spec
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', label: 'Sổ quỹ / Ngân hàng', path: routes.treasury, icon: Landmark, section: 'financials' as SectionName },
        ] : []),
        { key: 'debt', label: 'Công nợ phải thu', path: routes.debt, icon: Receipt, section: 'financials' as SectionName },
        { key: 'payables', label: 'Công nợ phải trả', path: routes.payables, icon: Receipt, section: 'financials' as SectionName },
        { key: 'expenses', label: 'Chi phí phát sinh', path: routes.expenses, icon: FileText, section: 'financials' as SectionName },
        { key: 'advances', label: 'Tạm ứng & Hoàn ứng', path: routes.advances, icon: Wallet, section: 'financials' as SectionName },

        // Nhân sự (HR)
        { key: 'salary', label: 'Lương & Chấm công', path: routes.salary, icon: CalendarDays, section: 'hr' as SectionName },
        { key: 'penalties', label: 'Kỷ luật', path: routes.penalties, icon: AlertTriangle, section: 'hr' as SectionName, count: penaltiesCount },

        // Danh mục (Master Data) per spec
        { key: 'customers', label: 'Khách hàng', path: routes.customers, icon: Users, section: 'master-data' as SectionName },
        { key: 'suppliers', label: 'Nhà cung cấp / Nhà xe', path: routes.suppliers, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-routes', label: 'Tuyến đường', path: routes.configRoutes, icon: Route, section: 'master-data' as SectionName },
        { key: 'config-factories', label: 'Nhà máy', path: routes.configFactories, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-ports', label: 'Cảng / Bãi & Biểu phí', path: routes.configPorts, icon: Anchor, section: 'master-data' as SectionName },
        { key: 'config-pricing', label: 'Bảng giá cước', path: routes.configPricingTables, icon: DollarSign, section: 'master-data' as SectionName },

        // Hệ thống (System) per spec (MANAGER excludes app-settings + master-data import)
        { key: 'users', label: 'Quản lý Người dùng', path: routes.users, icon: Users, section: 'system' as SectionName },
        { key: 'audit-logs', label: 'Nhật ký hệ thống', path: routes.auditLogs, icon: ScrollText, section: 'system' as SectionName },
        { key: 'config', label: 'Cấu hình chung', path: routes.config, icon: Settings, section: 'system' as SectionName },

        // Tổng quan (Dashboard) - first item, per spec: "Tổng quan Quản trị"
        { key: 'dashboard', label: 'Tổng quan Quản trị', path: routes.dashboard, icon: LayoutDashboard, section: undefined },
      ].sort((a, b) => {
        if (a.key === 'dashboard') return -1;
        if (b.key === 'dashboard') return 1;
        return 0;
      });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       ACCOUNTANT: Financial focus only, NO /dashboard, /dispatch, /config/app-settings, /chatbot-monitoring
       ───────────────────────────────────────────────────────────────────────── */
    case 'ACCOUNTANT': {
      return [
        // Tổng Quan Kế Toán (Accounting Dashboard) - first item, per spec
        { key: 'accounting', label: 'Tổng Quan Kế Toán', path: routes.accounting, icon: Calculator, section: undefined },

        // Công nợ & Dòng tiền (AR/AP) - PRIMARY SECTION per spec
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', label: 'Sổ quỹ / Ngân hàng', path: routes.treasury, icon: Landmark, section: 'financials' as SectionName },
        ] : []),
        { key: 'debt', label: 'Công nợ phải thu', path: routes.debt, icon: Receipt, section: 'financials' as SectionName },
        { key: 'payables', label: 'Công nợ phải trả', path: routes.payables, icon: Receipt, section: 'financials' as SectionName },
        { key: 'expenses', label: 'Chi phí phát sinh', path: routes.expenses, icon: FileText, section: 'financials' as SectionName },
        { key: 'advances', label: 'Tạm ứng & Hoàn ứng', path: routes.advances, icon: Wallet, section: 'financials' as SectionName },

        // Báo cáo & Phê duyệt (Reports & Approvals) per spec
        { key: 'finance', label: 'Báo cáo Lãi lỗ', path: routes.finance, icon: Wallet, section: 'reports' as SectionName },
        { key: 'profit', label: 'Báo cáo Lợi nhuận', path: routes.profit, icon: DollarSign, section: 'reports' as SectionName },
        { key: 'credit-overrides', label: 'Duyệt vượt hạn mức', path: routes.creditOverrides, icon: Shield, section: 'reports' as SectionName },
        { key: 'governance-actions', label: 'Trung tâm phê duyệt', path: routes.governanceActions, icon: ClipboardCheck, section: 'reports' as SectionName },

        // Vận hành liên quan (Operations - View-only/Audit) per spec
        { key: 'shipments', label: 'Quản lý Lô hàng', path: routes.shipments, icon: Package, section: 'operations' as SectionName },
        { key: 'trips', label: 'Sổ chuyến đi', path: routes.trips, icon: Truck, section: 'operations' as SectionName },
        { key: 'fleet', label: 'Đội xe', path: routes.fleet, icon: Layers, section: 'operations' as SectionName },

        // Nhân sự (HR)
        { key: 'salary', label: 'Lương & Chấm công', path: routes.salary, icon: CalendarDays, section: 'hr' as SectionName },
        { key: 'penalties', label: 'Kỷ luật', path: routes.penalties, icon: AlertTriangle, section: 'hr' as SectionName, count: penaltiesCount },

        // Danh mục (Master Data) per spec
        { key: 'customers', label: 'Khách hàng', path: routes.customers, icon: Users, section: 'master-data' as SectionName },
        { key: 'suppliers', label: 'Nhà cung cấp / Nhà xe', path: routes.suppliers, icon: Store, section: 'master-data' as SectionName },
        { key: 'config-pricing', label: 'Bảng giá cước', path: routes.configPricingTables, icon: DollarSign, section: 'master-data' as SectionName },

        // Hệ thống (System) per spec — accountant has ONLY audit-logs in this section
        { key: 'audit-logs', label: 'Nhật ký hệ thống', path: routes.auditLogs, icon: ScrollText, section: 'system' as SectionName },
      ].sort((a, b) => {
        if (a.key === 'accounting') return -1;
        if (b.key === 'accounting') return 1;
        return 0;
      });
    }

    /* ─────────────────────────────────────────────────────────────────────────
       DISPATCHER: Resource allocation focus, default = /dispatch/master-plan
       ───────────────────────────────────────────────────────────────────────── */
    case 'DISPATCHER': {
      return [
        // Điều độ Phương tiện (Dispatch Planning) - PRIMARY SECTION per spec
        { key: 'dispatch-master-plan', label: 'Kế hoạch tổng quát', path: routes.dispatchMasterPlan, icon: Compass, section: 'dispatch-planning' as SectionName },
        { key: 'dispatch-detailed-plan', label: 'Kế hoạch chi tiết', path: routes.dispatchDetailedPlan, icon: Route, section: 'dispatch-planning' as SectionName },
        { key: 'dispatch-live-tracking', label: 'Theo dõi Lộ trình', path: routes.dispatchLiveTracking, icon: Package, section: 'dispatch-planning' as SectionName },

        // Quản lý Tài nguyên (Resources) per spec
        { key: 'fleet-vehicles', label: 'Danh mục Xe nội bộ', path: '/fleet/vehicles', icon: Truck, section: 'resources' as SectionName },
        { key: 'fleet-drivers', label: 'Danh mục Tài xế', path: '/fleet/drivers', icon: Users, section: 'resources' as SectionName },
        { key: 'suppliers', label: 'Nhà thầu phụ', path: routes.suppliers, icon: Store, section: 'resources' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CUS (Customer Service): Document operations
       ───────────────────────────────────────────────────────────────────────── */
    case 'CUS': {
      return [
        // Nghiệp vụ Chứng từ (Document Operations)
        { key: 'shipments', label: 'Quản lý Lô hàng', path: routes.shipments, icon: Package, section: 'document-ops' as SectionName },

        // Đối soát (Reconciliation)
        ...(hasCapability('recoverable_costs.read') ? [
          { key: 'recoverable-costs', label: 'Chi phí cần kiểm tra', path: routes.recoverableCosts, icon: Receipt, section: 'reconciliation' as SectionName },
        ] : []),
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       OPS (Field Staff): My Work focus
       ───────────────────────────────────────────────────────────────────────── */
    case 'OPS': {
      return [
        // Công việc của tôi (My Work)
        { key: 'my-orders', label: 'Lệnh giao nhận', path: routes.myOrders, icon: Package, section: 'my-work' as SectionName },
        { key: 'my-advances', label: 'Yêu cầu Tạm ứng', path: routes.myAdvances, icon: Wallet, section: 'my-work' as SectionName },
        { key: 'my-settlements', label: 'Phiếu thanh toán / Hoàn ứng', path: routes.mySettlements, icon: FileText, section: 'my-work' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       DRIVER: My trips and earnings
       ───────────────────────────────────────────────────────────────────────── */
    case 'DRIVER': {
      return [
        // Công việc của tôi (My Work) - same section for PC and mobile consistency
        { key: 'my-trips', label: 'Hành trình của tôi', path: routes.myTrips, icon: Route, section: 'my-work' as SectionName },
        { key: 'my-earnings', label: 'Thu nhập', path: routes.myEarnings, icon: DollarSign, section: 'my-work' as SectionName },
        { key: 'my-penalties', label: 'Kỷ luật', path: routes.myPenalties, icon: AlertTriangle, section: 'my-work' as SectionName },
      ];
    }

    /* ─────────────────────────────────────────────────────────────────────────
       CUSTOMER (Portal): Client portal access
       ───────────────────────────────────────────────────────────────────────── */
    case 'CUSTOMER': {
      return [
        // Portal menu
        { key: 'portal-shipments', label: 'Lô hàng của tôi', path: routes.portalShipments, icon: Package, section: 'portal' as SectionName },
        { key: 'portal-debit-notes', label: 'Giấy báo nợ', path: routes.portalDebitNotes, icon: FileText, section: 'portal' as SectionName },
        { key: 'portal-statement', label: 'Sao kê công nợ', path: routes.portalStatement, icon: Landmark, section: 'portal' as SectionName },
      ];
    }

    default:
      return [];
  }
}

export function getNavSections(role: Role | string): NavSection[] {
  switch (getModernRole(role)) {
    case Role.ADMIN:
      return [
        { key: 'operations', label: 'Vận hành' },
        { key: 'reports', label: 'Báo cáo & Phê duyệt' },
        { key: 'financials', label: 'Công nợ & Dòng tiền' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.MANAGER:
      return [
        { key: 'operations', label: 'Vận hành' },
        { key: 'reports', label: 'Báo cáo & Phê duyệt' },
        { key: 'financials', label: 'Công nợ & Dòng tiền' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.ACCOUNTANT:
      return [
        { key: 'financials', label: 'Công nợ & Dòng tiền' },
        { key: 'reports', label: 'Báo cáo & Phê duyệt' },
        { key: 'operations', label: 'Vận hành liên quan' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.DISPATCHER:
      return [
        { key: 'dispatch-planning', label: 'Điều độ Phương tiện' },
        { key: 'resources', label: 'Quản lý Tài nguyên' },
      ];
    case Role.CUS:
      return [
        { key: 'document-ops', label: 'Nghiệp vụ Chứng từ' },
        { key: 'reconciliation', label: 'Đối soát' },
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

function getPageTitle(pathname: string): string {
  return titleForPath(pathname);
}

// ─── Layout component ─────────────────────────────────────────────────────

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, updateUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const bottomNavRef = useBottomNavAnimations({ ready: !!user && user.role === 'DRIVER' });
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Profile modal state
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({ email: '', phone: '', username: '', fullName: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const toggleUserMenu = useCallback(() => setUserMenuOpen(v => !v), []);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);
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
      setSidebarOpen(!event.matches);
    };
    media.addEventListener('change', handleViewportChange);
    return () => media.removeEventListener('change', handleViewportChange);
  }, []);

  const openProfileModal = () => {
    if (!user) return;
    setProfileForm({ email: user.email || '', phone: user.phone || '', username: user.username || '', fullName: user.fullName || '' });
    setProfileError(null);
    setProfileModalOpen(true);
    setUserMenuOpen(false);
  };

  const openPasswordModal = () => {
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
    } catch (err: unknown) {
      setPasswordError((err as Error)?.message || 'Không thể đổi mật khẩu.');
    } finally {
      setPasswordSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  const pageTitle = getPageTitle(location.pathname);
  const activeSection = navItems.find(i => i.key === activeKey)?.section;
  // When the active item is the ungrouped start page (e.g. /dashboard,
  // /accounting), fall back to the role's primary section per spec rather than
  // blindly taking the first section in the list.
  const primarySection = getDefaultOpenSection(user?.role);
  const preferredOpenSection = activeSection ?? primarySection ?? navSections[0]?.key;

  // Sidebar navigation handler
  const handleNavigate = useCallback((path: string) => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
    navigate(path);
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
    userMenuOpen,
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
    sidebarOpen,
    menuButtonRef,
    pageTitle,
    onToggleSidebar: () => setSidebarOpen(v => !v),
  };

  return (
    <div className={`app ${!sidebarOpen ? 'sidebar-closed' : ''} ${isDriver ? 'is-driver' : ''}`}>
      <a href="#main-content" className="skip-link">Bỏ qua đến nội dung chính</a>
      {/* M8.1 — global offline banner (slow-network state) */}
      <OfflineBanner />
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
        form={passwordForm}
        onFormChange={setPasswordForm}
        onSave={handleChangePassword}
      />

      <div className={`app-main ${isDriver ? 'driver-mode' : ''}`}>
        <Topbar {...topbarProps} />

        <main className="app-body" id="main-content">
          {children}
        </main>

        {/* Bottom Navigation for Drivers on Mobile */}
        {isDriver && (
          <nav className="bottom-nav" ref={bottomNavRef as React.RefObject<HTMLElement>}>
            {navItems.map(item => {
              const IconC = item.icon;
              const isActive = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  className={`bottom-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.path)}
                >
                  <div className="bottom-nav-indicator" />
                  <div className="bottom-nav-icon-wrap">
                    <IconC size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <span className="bottom-nav-label">{item.label}</span>
                </button>
              );
            })}

            {/* Account button for mobile bottom nav */}
            <button
              className={`bottom-nav-item ${userMenuOpen ? 'active' : ''}`}
              onClick={toggleUserMenu}
            >
              <div className="bottom-nav-indicator" />
              <div className="bottom-nav-icon-wrap">
                <User size={20} strokeWidth={userMenuOpen ? 2.5 : 2} />
              </div>
              <span className="bottom-nav-label">Tài khoản</span>
            </button>
          </nav>
        )}
      </div>

      {/* Mobile User Menu Sheet for Drivers — Vantai Design System */}
      {isDriver && userMenuOpen && (
        <div className="mobile-user-sheet-overlay" onClick={closeUserMenu}>
          <div className="mobile-user-sheet" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            {/* Drag handle */}
            <div className="mobile-user-sheet-handle" />

            {/* Profile Bento Grid Layout */}
            <div className="profile-bento-grid">
              {/* Avatar & Role Card (Vertical Span) */}
              <div className="profile-bento-card profile-bento-card--avatar">
                <div className="bento-avatar">
                  <img
                    src="/assets/avatars/driver-cartoon-v1.png"
                    alt=""
                    aria-hidden="true"
                  />
                </div>
                <div className="bento-role-badge">
                  <Shield size={10} />
                  <span>{getRoleLabel(user.role)}</span>
                </div>
              </div>

              {/* Full Name Card */}
              <div className="profile-bento-card profile-bento-card--name">
                <span className="bento-label">Họ và tên</span>
                <div className="bento-value">{user.fullName || getRoleLabel(user.role)}</div>
              </div>

              {/* Contact Info Row */}
              <div className="profile-bento-row">
                {/* Username Card */}
                <div className="profile-bento-card profile-bento-card--username">
                  <span className="bento-label">Tài khoản</span>
                  <div className="bento-value">
                    <User size={12} />
                    <span>{user.username || '—'}</span>
                  </div>
                </div>

                {/* Phone Card */}
                <div className="profile-bento-card profile-bento-card--phone">
                  <span className="bento-label">Điện thoại</span>
                  <div className="bento-value">
                    <Phone size={12} />
                    <span>{user.phone || '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Menu items with card tiles + trailing chevrons */}
            <div className="mobile-user-sheet-body">
              <div className="mobile-user-sheet-section-title">Tài khoản & Thiết lập</div>
              
              <button className="mobile-user-sheet-btn profile" onClick={openProfileModal}>
                <span className="icon-tile"><UserCog size={18} /></span>
                <span className="btn-label">Thông tin cá nhân</span>
                <ChevronRight size={16} className="btn-chevron" />
              </button>
              
              <button className="mobile-user-sheet-btn password" onClick={openPasswordModal}>
                <span className="icon-tile"><KeyRound size={18} /></span>
                <span className="btn-label">Đổi mật khẩu</span>
                <ChevronRight size={16} className="btn-chevron" />
              </button>

              <div className="mobile-user-sheet-section-title">Hệ thống</div>

              <button className="mobile-user-sheet-btn danger" onClick={() => { closeUserMenu(); logout(); }}>
                <span className="icon-tile"><LogOut size={18} /></span>
                <span className="btn-label">Đăng xuất</span>
                <ChevronRight size={16} className="btn-chevron" />
              </button>
            </div>

            <div className="mobile-user-sheet-footer">
              <span className="app-version">{BRAND.productName} v1.2.0</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
