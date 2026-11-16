// SIL-842 (CR-008 Task 2.2, KH 15/11) — reported symptom: Điều vận (dungnv)
// opened /timesheet and got "Bạn không có quyền truy cập trang này." The route
// rides timesheetStaffOnly (the FB-101 set: ADMIN/MANAGER/DISPATCHER/
// ACCOUNTANT). This pin keeps the denial toast off the path for both operating
// roles: Điều vận fills the grid, Kế toán views it.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ role: 'DISPATCHER' as string }));

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: 5,
      username: 'dungnv',
      email: null,
      phone: null,
      role: authState.role,
      fullName: 'Nguyễn Văn Dũng',
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

vi.mock('./pages/TimesheetGridPage', () => ({ default: () => <div data-testid="timesheet-grid">Chấm công lái xe</div> }));

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

describe('SIL-842 — /timesheet mở cho vai trò thao tác, không denial toast', () => {
  it('Điều vận mở /timesheet không dính "Bạn không có quyền truy cập trang này."', async () => {
    authState.role = 'DISPATCHER';
    renderAt('/timesheet');
    expect(await screen.findByTestId('timesheet-grid')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });

  it('Kế toán vẫn mở được /timesheet (FB-101 giữ nguyên)', async () => {
    authState.role = 'ACCOUNTANT';
    renderAt('/timesheet');
    expect(await screen.findByTestId('timesheet-grid')).toBeTruthy();
    expect(screen.queryByText(DENIAL_TEXT)).toBeNull();
  });
});
