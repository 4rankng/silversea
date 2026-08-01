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
  Activity,
  SlidersHorizontal,
  Landmark,
  Calculator,
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
import type { NavItem, NavSection } from './layout/types';
import { useBottomNavAnimations } from '../hooks/useBottomNavAnimations';
import { routes, titleForPath } from '../lib/routes';
import { OnboardingChecklist } from './onboarding/OnboardingChecklist';
import { TutorialLibrary } from './onboarding/TutorialLibrary';
import { BRAND } from '../brand';

// ─── Navigation config ────────────────────────────────────────────────────

export function getNavItems(
  role: Role,
  dispatchCount?: number,
  penaltiesCount?: number,
  capabilities: readonly string[] = [],
): NavItem[] {
  const normRole = String(role || '').toUpperCase();
  const hasCapability = (capability: string) => capabilities.includes(capability);
  switch (normRole) {
    case 'MANAGER':
    case 'ACCOUNTANT':
    case 'ADMIN': {
      const common: NavItem[] = [
        ...(role === Role.ACCOUNTANT ? [
          { key: 'accounting', label: 'Tổng Quan', path: routes.accounting, icon: Calculator },
        ] : []),
        ...(role !== Role.ACCOUNTANT ? [
          {
            key: 'dashboard',
            label: 'Tổng quan',
            path: routes.dashboard,
            icon: LayoutDashboard,
          },
        ] : []),

        { key: 'fleet', label: 'Đội xe', path: routes.fleet, icon: Layers, section: 'operations' },
        ...(role !== Role.ACCOUNTANT ? [
          { key: 'dispatch', label: 'Phân xe', path: routes.dispatch, icon: Compass, section: 'operations' as const, count: dispatchCount },
        ] : []),
        { key: 'trips', label: 'Sổ chuyến đi', path: routes.trips, icon: Truck, section: 'operations' },
        // Wave 0: shipment (lô hàng) — minimal read-only list. A shipment
        // precedes and outlives any single trip, so it sits adjacent to trips.
        { key: 'shipments', label: 'Lô hàng', path: routes.shipments, icon: Package, section: 'operations' },

        { key: 'salary', label: 'Lương & Chấm công', path: routes.salary, icon: CalendarDays, section: 'hr' },
        { key: 'penalties', label: 'Kỷ luật', path: routes.penalties, icon: AlertTriangle, section: 'hr', count: penaltiesCount },

        { key: 'debt', label: 'Công nợ phải thu', path: routes.debt, icon: Receipt, section: 'financials' },
        { key: 'payables', label: 'Công nợ phải trả', path: routes.payables, icon: Receipt, section: 'financials' },
        ...(hasCapability('treasury.read') ? [
          { key: 'treasury', label: 'Sổ quỹ / ngân hàng', path: routes.treasury, icon: Landmark, section: 'financials' as const },
        ] : []),
        { key: 'expenses', label: 'Chi phí phát sinh', path: routes.expenses, icon: FileText, section: 'financials' },
        { key: 'advances', label: 'Tạm ứng & hoàn ứng', path: routes.advances, icon: Wallet, section: 'financials' },

        { key: 'profit', label: 'Lợi nhuận', path: routes.profit, icon: DollarSign, section: 'oversight' },
        { key: 'finance', label: 'Báo cáo lãi lỗ', path: routes.finance, icon: Wallet, section: 'oversight' },
        { key: 'credit-overrides', label: 'Duyệt vượt hạn mức', path: routes.creditOverrides, icon: Shield, section: 'oversight' },
        { key: 'governance-actions', label: 'Trung tâm phê duyệt', path: routes.governanceActions, icon: ClipboardCheck, section: 'oversight' },

        { key: 'customers', label: 'Khách hàng', path: routes.customers, icon: Users, section: 'master-data' },
        { key: 'suppliers', label: 'Nhà cung cấp', path: routes.suppliers, icon: Store, section: 'master-data' },
        { key: 'routes', label: 'Tuyến đường', path: routes.configRoutes, icon: Route, section: 'master-data' },

        ...(role === 'ADMIN' || role === 'MANAGER' || role === 'ACCOUNTANT' ? [
          { key: 'users', label: 'Người dùng', path: routes.users, icon: Users, section: 'system' as const },
        ] : []),
        ...(role === 'ADMIN' ? [
          { key: 'app-settings', label: 'Cài đặt ứng dụng', path: '/config/app-settings', icon: SlidersHorizontal, section: 'system' as const },
          { key: 'chatbot-monitoring', label: 'Giám sát Chatbot', path: routes.chatbotMonitoring, icon: Activity, section: 'system' as const },
        ] : []),
        ...(role === 'ADMIN' || role === 'MANAGER' || role === 'ACCOUNTANT' ? [
          { key: 'audit-logs', label: 'Nhật ký người dùng', path: routes.auditLogs, icon: ScrollText, section: 'system' as const },
        ] : []),
        { key: 'config', label: 'Cấu hình', path: routes.config, icon: Settings, section: 'system' },
      ];
      return common;
    }
    case 'DRIVER':
      return [
        { key: 'my-trips', label: 'Hành trình', path: routes.myTrips, icon: Route, section: 'operations' },
        { key: 'my-earnings', label: 'Thu nhập', path: routes.myEarnings, icon: DollarSign, section: 'operations' },
        { key: 'my-penalties', label: 'Kỷ luật', path: routes.myPenalties, icon: AlertTriangle, section: 'operations' },
      ];
    case 'FORWARDER':
      return [
        { key: 'my-forwarder-trips', label: 'Chuyến đi', path: routes.myForwarderTrips, icon: Package, section: 'operations' },
        { key: 'my-advances', label: 'Tạm ứng', path: routes.myAdvances, icon: Wallet, section: 'operations' },
        { key: 'my-settlements', label: 'Phiếu thanh toán', path: routes.mySettlements, icon: FileText, section: 'operations' },
      ];
    case 'CUSTOMER':
      return [
        { key: 'portal-shipments', label: 'Lô hàng của tôi', path: routes.portalShipments, icon: Package, section: 'operations' },
        { key: 'portal-debit-notes', label: 'Giấy báo nợ', path: routes.portalDebitNotes, icon: FileText, section: 'financials' },
        { key: 'portal-statement', label: 'Sao kê công nợ', path: routes.portalStatement, icon: Landmark, section: 'financials' },
      ];
    case 'CLERK':
      return [
        { key: 'shipments', label: 'Lô hàng được giao', path: routes.shipments, icon: Package, section: 'operations' },
        { key: 'clerk-shipment-new', label: 'Tạo lô hàng', path: routes.clerkShipmentNew, icon: FileText, section: 'operations' },
        ...(hasCapability('recoverable_costs.read') ? [
          { key: 'recoverable-costs', label: 'Chi phí cần kiểm tra', path: routes.recoverableCosts, icon: Receipt, section: 'financials' as const },
        ] : []),
      ];
    default:
      return [];
  }
}

export function getNavSections(role: Role): NavSection[] {
  switch (role) {
    case Role.ADMIN:
      return [
        { key: 'operations', label: 'Vận hành' },
        { key: 'financials', label: 'Công nợ & dòng tiền' },
        { key: 'oversight', label: 'Báo cáo & phê duyệt' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Quản trị' },
      ];
    case Role.MANAGER:
      return [
        { key: 'operations', label: 'Vận hành' },
        { key: 'oversight', label: 'Báo cáo & phê duyệt' },
        { key: 'financials', label: 'Công nợ & dòng tiền' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.ACCOUNTANT:
      return [
        { key: 'financials', label: 'Công nợ & dòng tiền' },
        { key: 'oversight', label: 'Báo cáo & phê duyệt' },
        { key: 'operations', label: 'Vận hành liên quan' },
        { key: 'hr', label: 'Nhân sự' },
        { key: 'master-data', label: 'Danh mục' },
        { key: 'system', label: 'Hệ thống' },
      ];
    case Role.DRIVER:
    case Role.FORWARDER:
      return [{ key: 'operations', label: 'Công việc của tôi' }];
    case Role.CUSTOMER:
      return [
        { key: 'operations', label: 'Lô hàng' },
        { key: 'financials', label: 'Tài chính' },
      ];
    case Role.CLERK:
      return [
        { key: 'operations', label: 'Chứng từ' },
        { key: 'financials', label: 'Đối soát' },
      ];
    default:
      return [];
  }
}

function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role] || role;
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
  const [tutorialLibraryOpen, setTutorialLibraryOpen] = useState(false);

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
  const preferredOpenSection = activeSection ?? navSections[0]?.key;

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
    onOpenTutorialLibrary: user && ['ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(user.role) && user.onboardingEnabled !== false
      ? () => setTutorialLibraryOpen(true)
      : undefined,
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

        {/* Phase 6: office-role activation checklist. Renders nothing for
            DRIVER/FORWARDER (gated internally by role) and hides at 100%. */}
        <OnboardingChecklist onOpenTutorialLibrary={() => setTutorialLibraryOpen(true)} />
        <TutorialLibrary open={tutorialLibraryOpen} onClose={() => setTutorialLibraryOpen(false)} />

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
                  <User size={26} aria-hidden="true" />
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
