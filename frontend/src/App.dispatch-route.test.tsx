// SIL-862 — /dispatch (Kế hoạch Tổng quát) mở cho 2 tài khoản repro của ticket:
// hoangnh (role OPS 'Vận hành' — ghế "Vận hành / Điều vận" theo cách gọi ticket)
// và hoapt (Kế toán), KHÔNG denial toast. Ghế Điều vận (DISPATCHER) giữ nguyên
// bảng. SIL-915 (KB audit 24/11) thu lại premise SIL-694 cho BẢNG CHI TIẾT:
// /dispatch-detail trả 403 cho 8 request dữ liệu của OPS, nên vai này bị chuyển
// hướng thân thiện về trang chủ vai trò (/ops/orders) thay vì thấy trang lỗi.
// Vai thật sự sai quyền (CUS) vẫn bị chặn CÓ thông báo.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ role: 'OPS' as string }));

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 3,
      username: 'hoangnh',
      email: null,
      phone: null,
      role: authState.role,
      fullName: 'Nguyễn Huy Hoàng',
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

vi.mock('./pages/MasterPlanPage', () => ({ default: () => <div data-testid="master-plan">Kế hoạch Tổng quát</div> }));
vi.mock('./pages/DispatchDetailPlanPage', () => ({ default: () => <div data-testid="detail-plan">Kế hoạch Chi tiết</div> }));
vi.mock('./pages/ShipmentsPage', () => ({ default: () => <div data-testid="shipments-page">Tổng quan lô hàng</div> }));
vi.mock('./pages/OpsOrdersPage', () => ({ default: () => <div data-testid="ops-orders">Kế hoạch làm hàng</div> }));

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

describe('SIL-862 — /dispatch mở cho đúng vai, không denial toast', () => {
  it('Vận hành (OPS — hoangnh, repro) mở /dispatch không dính denial', async () => {
    authState.role = 'OPS';
    renderAt('/dispatch');
    expect(await screen.findByTestId('master-plan')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });

  it('Kế toán (ACCOUNTANT — hoapt, repro) mở /dispatch không dính denial', async () => {
    authState.role = 'ACCOUNTANT';
    renderAt('/dispatch');
    expect(await screen.findByTestId('master-plan')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });

  it('Điều vận (DISPATCHER) giữ nguyên quyền /dispatch', async () => {
    authState.role = 'DISPATCHER';
    renderAt('/dispatch');
    expect(await screen.findByTestId('master-plan')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });

  it('OPS gõ thẳng /dispatch-detail bị chuyển về trang chủ vai trò (/ops/orders) kèm thông báo — 8 request dữ liệu của bảng 403 cho vai này', async () => {
    authState.role = 'OPS';
    renderAt('/dispatch-detail');
    expect(await screen.findByText(DENIAL_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('detail-plan')).toBeNull();
    expect(await screen.findByTestId('ops-orders')).toBeTruthy();
  });

  it('Giao nhận (legacy FORWARDER token) gõ thẳng /dispatch-detail cũng bị chuyển về /ops/orders như OPS', async () => {
    // The denial announcement for this seat is the OPS test above; a same-path
    // denial inside the 1.2s burst window announces once (QA2-003), so this
    // pin asserts the redirect outcome the card asks for, order-independently.
    authState.role = 'FORWARDER';
    renderAt('/dispatch-detail');
    expect(screen.queryByTestId('detail-plan')).toBeNull();
    expect(await screen.findByTestId('ops-orders')).toBeTruthy();
  });

  it('ACCOUNTANT mở /dispatch-detail (bảng điều vận đọc được — premise SIL-694)', async () => {
    authState.role = 'ACCOUNTANT';
    renderAt('/dispatch-detail');
    expect(await screen.findByTestId('detail-plan')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });

  it('CUS vào /dispatch vẫn bị chặn CÓ thông báo — toast chỉ hiện khi sai quyền thật', async () => {
    authState.role = 'CUS';
    renderAt('/dispatch');
    expect(await screen.findByText(DENIAL_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('master-plan')).toBeNull();
    expect(await screen.findByTestId('shipments-page')).toBeTruthy();
  });
});
