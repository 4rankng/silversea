import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import { Sidebar } from './Sidebar';
import type { NavItem, NavSection, SectionName } from './types';

vi.mock('../../hooks/useSidebarAnimations', () => ({
  useSidebarAnimations: () => ({ current: null }),
}));

const TestIcon = () => <svg aria-hidden="true" />;
const navItems: NavItem[] = [
  { key: 'accounting', label: 'Tổng Quan', path: '/accounting', icon: TestIcon },
  { key: 'debt', label: 'Công nợ phải thu', path: '/debt', icon: TestIcon, section: 'financials' as SectionName },
  { key: 'finance', label: 'Báo cáo lãi lỗ', path: '/finance', icon: TestIcon, section: 'oversight' as SectionName },
];
const navSections: NavSection[] = [
  { key: 'financials' as SectionName, label: 'Công nợ & dòng tiền' },
  { key: 'oversight' as SectionName, label: 'Báo cáo & phê duyệt' },
];

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props: Parameters<typeof Sidebar>[0] = {
    user: {
      userId: 1,
      role: Role.ACCOUNTANT,
      fullName: 'Kế toán kiểm thử',
      username: 'accountant',
      email: null,
    },
    navItems,
    navSections,
    activeKey: 'accounting',
    sidebarOpen: true,
    isMobileViewport: false,
    userMenuOpen: false,
    collapsed: new Set(['oversight']),
    onNavigate: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleUserMenu: vi.fn(),
    onCloseUserMenu: vi.fn(),
    onOpenProfileModal: vi.fn(),
    onOpenPasswordModal: vi.fn(),
    onLogout: vi.fn(),
    navRef: createRef<HTMLElement>(),
    toggleSection: vi.fn(),
    ...overrides,
  };
  return { ...render(<Sidebar {...props} />), props };
}

describe('Sidebar role structure', () => {
  it('renders configured sections in order with accurate collapse semantics', () => {
    renderSidebar();

    expect(Array.from(document.querySelectorAll('.sidebar-section-label span')).map(node => node.textContent)).toEqual([
      'Công nợ & dòng tiền',
      'Báo cáo & phê duyệt',
    ]);
    expect(screen.getByRole('button', { name: 'Công nợ & dòng tiền' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Báo cáo & phê duyệt' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Tổng Quan' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Báo cáo lãi lỗ' })).toBeNull();
  });

  it('delegates navigation and section expansion through accessible buttons', () => {
    const { props } = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Công nợ phải thu' }));
    expect(props.onNavigate).toHaveBeenCalledWith('/debt');

    fireEvent.click(screen.getByRole('button', { name: 'Báo cáo & phê duyệt' }));
    expect(props.toggleSection).toHaveBeenCalledWith('oversight');
  });
});
