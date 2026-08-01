import { useEffect, useRef, useState } from 'react';
import { FileText, Landmark, LogOut, Menu, Package, User, X } from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { BRAND } from '../../brand';
import { routes, titleForPath } from '../../lib/routes';
import { CustomerPortalScopeProvider, useCustomerPortalScope } from './CustomerPortalScope';
import './CustomerPortalLayout.css';

const portalNav = [
  { to: routes.portalShipments, label: 'Lô hàng của tôi', icon: Package },
  { to: routes.portalDebitNotes, label: 'Giấy báo nợ', icon: FileText },
  { to: routes.portalStatement, label: 'Sao kê công nợ', icon: Landmark },
] as const;

function CustomerPortalLayoutBody({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const {
    customers,
    selectedCustomerId,
    error: customerScopeError,
    retry: retryCustomerScope,
    setSelectedCustomerId,
  } = useCustomerPortalScope();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen && !accountOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (accountOpen) {
          setAccountOpen(false);
          requestAnimationFrame(() => accountButtonRef.current?.focus());
        } else {
          setMenuOpen(false);
          requestAnimationFrame(() => menuButtonRef.current?.focus());
        }
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [accountOpen, menuOpen]);

  useEffect(() => {
    document.title = `${titleForPath(location.pathname)} · ${BRAND.name}`;
  }, [location.pathname]);

  const closeMenu = () => {
    setMenuOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const openMenu = () => {
    setAccountOpen(false);
    setMenuOpen(true);
  };

  const toggleAccountMenu = () => {
    setMenuOpen(false);
    setAccountOpen((open) => !open);
  };

  const handleLogout = () => {
    setMenuOpen(false);
    setAccountOpen(false);
    logout();
    navigate('/login', { replace: true });
  };

  const identity = user?.fullName || user?.username || 'Khách hàng';

  return (
    <div className="customer-shell">
      <a className="skip-link" href="#customer-main">Bỏ qua đến nội dung chính</a>
      <header className="customer-shell__mobile-header">
        <button
          ref={menuButtonRef}
          type="button"
          className="customer-shell__icon-button"
          aria-label="Mở menu"
          aria-expanded={menuOpen}
          aria-controls="customer-navigation"
          onClick={openMenu}
        >
          <Menu size={22} />
        </button>
        <img src={BRAND.sidebarLogoPath} alt="" aria-hidden="true" />
        <strong>{BRAND.name}</strong>
        <button
          ref={accountButtonRef}
          type="button"
          className="customer-shell__icon-button customer-shell__account-button"
          aria-label="Mở menu tài khoản"
          aria-expanded={accountOpen}
          aria-controls="customer-account-popover"
          onClick={toggleAccountMenu}
        >
          <User size={20} />
        </button>
      </header>

      {menuOpen && <button className="customer-shell__backdrop" aria-label="Đóng menu" onClick={closeMenu} />}

      <aside id="customer-navigation" className={`customer-shell__sidebar ${menuOpen ? 'is-open' : ''}`}>
        <div className="customer-shell__brand">
          <img src={BRAND.sidebarLogoPath} alt="" aria-hidden="true" />
          <div>
            <strong>{BRAND.name}</strong>
            <span>Cổng thông tin khách hàng</span>
          </div>
          <button type="button" className="customer-shell__close" aria-label="Đóng menu" onClick={closeMenu}>
            <X size={20} />
          </button>
        </div>

        <nav className="customer-shell__nav" aria-label="Khu vực khách hàng">
          <span className="customer-shell__nav-label">Theo dõi và đối soát</span>
          {portalNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `customer-shell__nav-item ${isActive ? 'is-active' : ''}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="customer-shell__identity">
          <span className="customer-shell__avatar"><User size={18} /></span>
          <div>
            <strong>{identity}</strong>
            <span>Khách hàng</span>
          </div>
          <button type="button" aria-label="Đăng xuất" title="Đăng xuất" onClick={handleLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="customer-shell__content">
        <div className="customer-shell__desktop-topbar">
          <div>
            <span>Cổng thông tin khách hàng</span>
            <strong>{identity}</strong>
          </div>
          <button type="button" onClick={handleLogout}><LogOut size={17} /> Đăng xuất</button>
        </div>
        {customers.length > 1 && (
          <div className="customer-shell__scope-bar">
            <label htmlFor="customer-portal-scope">Pháp nhân đang xem</label>
            <select
              id="customer-portal-scope"
              value={selectedCustomerId ?? ''}
              onChange={(event) => setSelectedCustomerId(Number(event.target.value))}
            >
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
            <span>Dữ liệu được tách riêng theo từng pháp nhân.</span>
          </div>
        )}
        {customerScopeError && (
          <div className="customer-shell__scope-error" role="alert">
            <span>{customerScopeError}</span>
            <button type="button" onClick={retryCustomerScope}>Thử lại</button>
          </div>
        )}
        <main id="customer-main" className="customer-shell__main">{children}</main>
      </div>

      {accountOpen && (
        <div id="customer-account-popover" className="customer-shell__account-popover">
          <strong>{identity}</strong>
          <span>{user?.email || 'Tài khoản khách hàng'}</span>
          <button type="button" onClick={handleLogout}><LogOut size={17} /> Đăng xuất</button>
        </div>
      )}

      <nav className="customer-shell__bottom-nav" aria-label="Điều hướng nhanh">
        {portalNav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'is-active' : undefined}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerPortalScopeProvider>
      <CustomerPortalLayoutBody>{children}</CustomerPortalLayoutBody>
    </CustomerPortalScopeProvider>
  );
}
