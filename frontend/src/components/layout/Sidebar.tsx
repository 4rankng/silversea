import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LogOut,
  User,
  UserCog,
  KeyRound,
  X,
} from 'lucide-react';
import { ROLE_LABELS } from '@tingting/shared';
import type { Role } from '@tingting/shared';
import type { SidebarProps, SectionName } from './types';
import { useSidebarAnimations } from '../../hooks/useSidebarAnimations';
import { BRAND } from '../../brand';

function getRoleLabel(role: Role): string {
  return ROLE_LABELS[role] || role;
}

function NavIcon({ item }: { item: SidebarProps['navItems'][number] }) {
  const IconC = item.icon;
  return <IconC size={16} aria-hidden="true" />;
}

export function Sidebar({
  user,
  navItems,
  navSections,
  activeKey,
  sidebarOpen,
  isMobileViewport,
  userMenuOpen,
  collapsed,
  onNavigate,
  onToggleSidebar,
  onToggleUserMenu,
  onCloseUserMenu,
  onOpenProfileModal,
  onOpenPasswordModal,
  onLogout,
  navRef,
  activeSection: _activeSection,
  toggleSection,
}: SidebarProps) {
  const animRef = useSidebarAnimations();
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isMobileViewport || !sidebarOpen) return;
    const sidebar = asideRef.current;
    if (!sidebar) return;

    const focusableSelector = [
      'button:not(:disabled)',
      'a[href]',
      'input:not(:disabled)',
      'select:not(:disabled)',
      'textarea:not(:disabled)',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>(focusableSelector));
    focusable[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onToggleSidebar();
        return;
      }
      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileViewport, onToggleSidebar, sidebarOpen]);

  // Icon-only (collapsed) rail: show an instant styled tooltip on hover/focus.
  // The native `title` attribute is slow (~1s) and unstyled, and the item labels
  // are hidden when collapsed, so without this the icons are unlabeled. aria-label
  // still carries the accessible name. Rendered into a portal so the tooltip
  // escapes the sidebar's overflow:hidden and the nav's scroll container.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (label: string, rect: DOMRect) => {
    if (sidebarOpen) return; // only when collapsed to icons
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideTip = () => setTip(null);

  const renderUngroupedItems = () => {
    const items = navItems.filter(i => !i.section);
    if (items.length === 0) return null;

    return items.map(item => {
      const isActive = item.key === activeKey;
      const isDanger = item.key === 'penalties';
      return (
        <button
          key={item.key}
          className={`sidebar-item ${isActive ? 'active' : ''}`}
          onClick={() => onNavigate(item.path)}
          aria-label={item.label}
          aria-current={isActive ? 'page' : undefined}
          onMouseEnter={(e) => showTip(item.label, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip(item.label, e.currentTarget.getBoundingClientRect())}
          onBlur={hideTip}
        >
          <NavIcon item={item} />
          <span className="sidebar-item-label">{item.label}</span>

          {item.count !== undefined && item.count > 0 && (
            <span
              className={`nav-item__badge${isDanger ? ' nav-item__badge--danger' : ''}`}
              style={{ marginLeft: 'auto' }}
            >
              {item.count}
            </span>
          )}
          {isActive && (item.count === undefined || item.count === 0) && (
            <ChevronRight size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} />
          )}
        </button>
      );
    });
  };

  const renderNavSection = (label: string, sectionName: SectionName) => {
    const items = navItems.filter(i => i.section === sectionName);
    if (items.length === 0) return null;
    const isCollapsed = sidebarOpen && collapsed.has(sectionName);

    return (
      <div key={sectionName} className="sidebar-section">
        <button
          className="sidebar-section-label sidebar-section-toggle"
          onClick={() => toggleSection(sectionName)}
          aria-expanded={!isCollapsed}
          tabIndex={sidebarOpen ? 0 : -1}
        >
          <span>{label}</span>
          <ChevronDown
            size={10}
            className={`sidebar-section-chevron${isCollapsed ? ' collapsed' : ''}`}
          />
        </button>
        {!isCollapsed && items.map(item => {
          const isActive = item.key === activeKey;
          const isDanger = item.key === 'penalties';
          return (
            <button
              key={item.key}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              onClick={() => onNavigate(item.path)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onMouseEnter={(e) => showTip(item.label, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={hideTip}
              onFocus={(e) => showTip(item.label, e.currentTarget.getBoundingClientRect())}
              onBlur={hideTip}
            >
              <NavIcon item={item} />
              <span className="sidebar-item-label">{item.label}</span>

              {item.count !== undefined && item.count > 0 && (
                <span
                  className={`nav-item__badge${isDanger ? ' nav-item__badge--danger' : ''}`}
                  style={{ marginLeft: 'auto' }}
                >
                  {item.count}
                </span>
              )}
              {isActive && (item.count === undefined || item.count === 0) && (
                <ChevronRight size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => onToggleSidebar()}
        aria-hidden="true"
      />
      <aside
        ref={asideRef}
        id="sidebar-navigation"
        className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        aria-hidden={isMobileViewport && !sidebarOpen ? true : undefined}
        inert={isMobileViewport && !sidebarOpen}
      >
        <div className="sidebar-brand">
          <div className="sidebar-brand-logo">
            <img src={BRAND.sidebarLogoPath} alt="" aria-hidden="true" />
          </div>
          <div className="sidebar-brand-meta">
            <strong>{BRAND.name}</strong>
            <span>{BRAND.shellDescriptor}</span>
          </div>
          <button
            type="button"
            className="sidebar-close"
            aria-label="Đóng menu"
            onClick={() => onToggleSidebar()}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" ref={(node) => {
          (animRef as React.MutableRefObject<HTMLElement | null>).current = node;
          (navRef as React.MutableRefObject<HTMLElement | null>).current = node;
        }}>
          {renderUngroupedItems()}
          {navSections.map(section => renderNavSection(section.label, section.key))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-user" onClick={onToggleUserMenu} aria-expanded={userMenuOpen} aria-label="Menu người dùng">
            <div className="avatar">
              <User size={18} />
            </div>
            <div className="meta">
              <div className="name">{user.fullName || user.username || getRoleLabel(user.role)}</div>
              <div className="role">{getRoleLabel(user.role)}</div>
            </div>
            <ChevronUp size={14} className="sidebar-user-chevron" />
          </button>
          {userMenuOpen && (
            <div className="sidebar-user-dropdown">
              <div className="sidebar-user-dropdown-header">
                <div className="name">{user.fullName || getRoleLabel(user.role)}</div>
                <div className="role">{getRoleLabel(user.role)}</div>
              </div>
              <div className="sidebar-user-dropdown-divider" />
              <button
                className="sidebar-user-dropdown-item sidebar-user-dropdown-item--neutral"
                onClick={onOpenProfileModal}
              >
                <UserCog size={16} />
                Thông tin cá nhân
              </button>
              <button
                className="sidebar-user-dropdown-item sidebar-user-dropdown-item--neutral"
                onClick={onOpenPasswordModal}
              >
                <KeyRound size={16} />
                Đổi mật khẩu
              </button>
              <div className="sidebar-user-dropdown-divider" />
              <button
                className="sidebar-user-dropdown-item"
                onClick={() => {
                  onCloseUserMenu();
                  onLogout();
                }}
              >
                <LogOut size={16} />
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </aside>
      {tip &&
        createPortal(
          <div className="rail-tooltip" role="tooltip" style={{ top: tip.top, left: tip.left }}>
            {tip.label}
          </div>,
          document.body,
        )}
    </>
  );
}
