// SIL-998 (QA fail deb08aa9, 28/11): a staff seat opening a /portal/* URL is a
// wrong-surface visit, not a permission denial — tiepvv (Chứng từ) landed on a
// fully usable /shipments overview under a red "Bạn không có quyền truy cập
// trang này." toast. The /portal/* guard (customerOnly) now redirects silently
// to the visitor's own home; only a truly-forbidden route still announces
// (the DeniedRedirect law keeps its own pins in App.ops-route.test.tsx and
// App.timesheet-route.test.tsx).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ role: 'CUS' as string }));

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 7,
      username: 'tiepvv',
      email: null,
      phone: null,
      role: authState.role,
      fullName: 'Vũ Văn Tiếp',
    },
    logout: vi.fn(),
    login: vi.fn(),
    updateUser: vi.fn(),
    isAuthenticated: true,
    loading: false,
    sessionExpired: false,
  }),
}));

vi.mock('./components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./pages/portal/CustomerPortalLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('./pages/portal/PortalShipmentsPage', () => ({ default: () => <div data-testid="portal-shipments">Lô hàng của tôi</div> }));
vi.mock('./pages/ShipmentsPage', () => ({ default: () => <div data-testid="shipments-page">Tổng quan lô hàng</div> }));
vi.mock('./pages/MasterPlanPage', () => ({ default: () => <div data-testid="master-plan">Kế hoạch Tổng quát</div> }));

import { ToastProvider } from './components/shared/Toast';
import { AppRoutes } from './App';

const DENIAL_TEXT = 'Bạn không có quyền truy cập trang này.';

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('SIL-998 — /portal/* với vai staff: chuyển hướng lặng, không toast sai ngữ cảnh', () => {
  it('Chứng từ (tiepvv) mở /portal/shipments → về Tổng quan lô hàng, không denial toast', async () => {
    authState.role = 'CUS';
    renderAt('/portal/shipments');
    expect(await screen.findByTestId('shipments-page')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
    expect(screen.queryByTestId('portal-shipments')).toBeNull();
  });

  it('Điều vận mở /portal/shipments → về Kế hoạch Tổng quát, không denial toast', async () => {
    authState.role = 'DISPATCHER';
    renderAt('/portal/shipments');
    expect(await screen.findByTestId('master-plan')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
    expect(screen.queryByTestId('portal-shipments')).toBeNull();
  });

  it('CUSTOMER vẫn vào thẳng cổng portal (admit set không đổi)', async () => {
    authState.role = 'CUSTOMER';
    renderAt('/portal/shipments');
    expect(await screen.findByTestId('portal-shipments')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });
});
