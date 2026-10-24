/**
 * Demo App Shell (SIL-155, spec §2): left sidebar (6 mục, nhãn VN theo
 * spec) + top header (breadcrumb + search + user). Built only from vendored
 * Untitled UI base primitives (`components/untitled-ui/base/*`) and
 * `@untitledui/icons` — no new libraries, no page-local design overrides.
 *
 * This shell replaces the production Layout for `/demo/*` routes: the demo
 * tree must not grow entries inside the real sidebar/nav-sweep, and the demo
 * surface stays fixture-only (zero API calls).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, Menu01, SearchLg, Truck01, XClose } from '@untitledui/icons';
import { Avatar } from '@/components/untitled-ui/base/avatar/avatar';
import { Button } from '@/components/untitled-ui/base/buttons/button';
import { InputBase } from '@/components/untitled-ui/base/input/input';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS, Role } from '@tingting/shared';
import { getModernRole } from '@/lib/role-helpers';
import { DEMO_NAV_ITEMS, demoNavItemForPath } from './nav';
import { cx } from '@/utils/cx';

function initialsOf(fullName: string | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '…';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function BrandMark() {
  return (
    <Link
      to="/demo/dashboard"
      className="flex h-14 items-center gap-3 border-b border-secondary_alt px-4"
      aria-label="TransTing Demo — Tổng quan"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-solid text-white shadow-xs">
        <Truck01 className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-primary">TransTing Demo</span>
        <span className="truncate text-xs text-tertiary">Vận tải Container · 24/10</span>
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Demo" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
      {DEMO_NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-brand-primary text-brand-800'
                : 'text-tertiary hover:bg-primary_hover hover:text-primary',
            )
          }
        >
          <item.icon className="size-5 shrink-0" />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
      <p className="mt-auto flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs text-tertiary">
        <span className="size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
        Dữ liệu demo — không kết nối API
      </p>
    </nav>
  );
}

function Breadcrumb({ heading }: { heading: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link to="/demo/dashboard" className="shrink-0 text-tertiary hover:text-primary">
        Demo
      </Link>
      <ChevronRight className="size-4 shrink-0 text-quaternary" aria-hidden="true" />
      <span className="truncate font-medium text-primary" data-testid="demo-breadcrumb-current">
        {heading}
      </span>
    </nav>
  );
}

export default function DemoAppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = demoNavItemForPath(location.pathname);

  // Any navigation inside the demo tree closes the phone overlay sidebar.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-secondary text-primary">
      {/* Sidebar — persistent rail ≥1024px */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-secondary_alt bg-primary lg:flex">
        <BrandMark />
        <SidebarNav />
      </aside>

      {/* Sidebar — phone/tablet overlay with dimmed backdrop */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-overlay/50"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col bg-primary shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-secondary_alt pr-2">
              <BrandMark />
              <Button
                color="tertiary"
                iconLeading={XClose}
                aria-label="Đóng menu"
                onPress={() => setMenuOpen(false)}
              />
            </div>
            <SidebarNav onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-secondary_alt bg-primary px-4 lg:px-6">
          <Button
            color="tertiary"
            iconLeading={Menu01}
            aria-label="Mở menu"
            className="lg:hidden"
            onPress={() => setMenuOpen(true)}
          />
          <Breadcrumb heading={current?.heading ?? 'Demo'} />
          <div className="ml-auto hidden md:block md:w-72">
            <InputBase
              icon={SearchLg}
              placeholder="Tìm Số Cont / Booking / Biển số…"
              aria-label="Tìm kiếm demo"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <Avatar size="sm" initials={initialsOf(user?.fullName)} />
            <span className="hidden min-w-0 flex-col leading-tight lg:flex">
              <span className="truncate text-sm font-medium text-primary">
                {user?.fullName?.trim() || user?.username || 'Demo'}
              </span>
              <span className="truncate text-xs text-tertiary">
                {user ? (ROLE_LABELS[getModernRole(user.role) as Role] ?? user.role) : ''}
              </span>
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
