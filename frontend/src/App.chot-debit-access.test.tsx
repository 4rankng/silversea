// SIL-825 round 2 (QA wave 13, build 9f999b4d) — QA signed in as tiepvv
// (CUS), hit /accounting/chot-debit, and was redirected home with the denial
// toast; the card came back as FAIL because "the role has lost access to the
// screen". It never had it: the route has ridden officeStaffOnly
// (ADMIN|MANAGER|ACCOUNTANT) since it was created (465c8360), the backend
// gate is the same trio (accounting-debit.ts OFFICE_ROLES), and the sidebar
// has deliberately omitted Chốt Debit from the CUS menu (Layout.test.ts nav
// matrix, d701c8d8) — the CUS money surface is /shipments-debit (Chi phí -
// Quyết toán), which never carries giá vốn. Nothing in wave 13 changed this:
// the only guard edit in the 237af351→9f999b4d window is /timesheet/bao-cao
// (SIL-836). These tests pin the access matrix so the next QA sweep does not
// re-file the denial as a regression, and so widening the guard to CUS or
// Điều vận has to change a test on purpose.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type * as UseAuthModule from './hooks/useAuth';
import type * as LayoutModule from './components/Layout';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof UseAuthModule>('./hooks/useAuth');
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('./components/Layout', async () => {
  const actual = await vi.importActual<typeof LayoutModule>('./components/Layout');
  return { ...actual, default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout-shell">{children}</div> };
});

import { AppRoutes } from './App';
import { ToastProvider } from './components/shared/Toast';

const DENIAL_TEXT = 'Bạn không có quyền truy cập trang này.';
const CHOT_DEBIT_TITLE = 'KIỂM SOÁT LÔ HÀNG';

function renderAs(role: Role, path: string) {
  useAuthMock.mockReturnValue({
    user: { userId: 1, username: 'probe', email: null, phone: null, role, fullName: 'Probe' },
    logout: vi.fn(), login: vi.fn(), updateUser: vi.fn(),
    isAuthenticated: true, loading: false, sessionExpired: false,
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuthMock.mockReset();
});

describe('AppRoutes — /accounting/chot-debit access matrix (SIL-825 round 2)', () => {
  it('denies CUS with the denial notice and never renders the board', async () => {
    renderAs(Role.CUS, '/accounting/chot-debit');
    expect(await screen.findByText(DENIAL_TEXT)).toBeTruthy();
    expect(screen.queryByText(CHOT_DEBIT_TITLE)).toBeNull();
  });

  it('denies DISPATCHER the same way (separate denial, past the 1.2s burst window)', async () => {
    // QA2-003 collapses same-path denial bursts within 1200ms; the CUS test
    // above just denied this exact path, so wait out the window — this is a
    // genuinely separate denial and must announce itself.
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 1250);
    await promise;
    renderAs(Role.DISPATCHER, '/accounting/chot-debit');
    expect(await screen.findByText(DENIAL_TEXT)).toBeTruthy();
    expect(screen.queryByText(CHOT_DEBIT_TITLE)).toBeNull();
  });

  it('admits ACCOUNTANT: the board renders, no denial notice, no gửi-duyệt button', async () => {
    renderAs(Role.ACCOUNTANT, '/accounting/chot-debit');
    expect(await screen.findByText(CHOT_DEBIT_TITLE)).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
    expect(screen.queryByRole('button', { name: /Gửi yêu cầu điều chỉnh/ })).toBeNull();
  });
});
