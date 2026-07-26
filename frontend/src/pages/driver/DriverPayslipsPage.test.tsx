/**
 * Wave 4 M8.6 slice 2 — DriverPayslipsPage tests.
 *
 * Mocks `useDriverPayslips` at the module boundary.
 *
 * Coverage (PRD M08-06-03):
 *   - renders payslip cards with period + earnings + link to earnings detail;
 *   - REOPENED period shows the "Mở lại" badge;
 *   - CLOSED period shows "Đã chốt";
 *   - empty state when no payslips;
 *   - loading spinner; error state.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { useDriverPayslipsMock } = vi.hoisted(() => ({
  useDriverPayslipsMock: vi.fn(),
}));

vi.mock('../../hooks/useDriverQueries', () => ({
  useDriverPayslips: useDriverPayslipsMock,
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import DriverPayslipsPage from './DriverPayslipsPage';

const PAYSLIP = (overrides: Partial<{
  period: string; status: string; closedAt: string | null;
  closedByName: string | null; note: string | null;
}> = {}) => ({
  period: '2026-07',
  status: 'CLOSED',
  closedAt: '2026-08-01T00:00:00Z',
  closedByName: 'Kế toán',
  note: null,
  earnings: {
    netIncome: '15000000', productionSalary: '8000000', roadAllowance: '2000000',
    penalties: '500000', paidOrAdvanced: '10000000', payableBalance: '5000000',
    periodStart: '2026-07-01', periodEnd: '2026-07-31',
  },
  ...overrides,
});

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/my-payslips']}>
      <Routes>
        <Route path="/my-payslips" element={<DriverPayslipsPage />} />
        <Route path="/my-earnings" element={<div data-testid="earnings-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DriverPayslipsPage — M8.6 payslip view', () => {
  beforeEach(() => { useDriverPayslipsMock.mockReset(); });

  it('renders payslip cards with period + earnings + link to earnings detail', async () => {
    useDriverPayslipsMock.mockReturnValue({
      data: { items: [PAYSLIP()] }, isLoading: false, error: null,
    });
    renderAt();
    const card = await screen.findByTestId('payslip-card-2026-07');
    expect(card.getAttribute('href')).toBe('/my-earnings?month=7&year=2026');
    expect(card.textContent).toMatch(/07\/2026/);
    expect(card.textContent).toMatch(/15[,.]?0/); // net income formatted
  });

  it('REOPENED period shows the "Mở lại" badge', async () => {
    useDriverPayslipsMock.mockReturnValue({
      data: { items: [PAYSLIP({ status: 'REOPENED', note: 'điều chỉnh' })] },
      isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Mở lại/)).toBeTruthy());
    expect(screen.getByText(/điều chỉnh/)).toBeTruthy();
  });

  it('CLOSED period shows "Đã chốt"', async () => {
    useDriverPayslipsMock.mockReturnValue({
      data: { items: [PAYSLIP({ status: 'CLOSED' })] },
      isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Đã chốt/)).toBeTruthy());
  });

  it('empty state when no payslips', async () => {
    useDriverPayslipsMock.mockReturnValue({
      data: { items: [] }, isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Chưa có kỳ lương/)).toBeTruthy());
  });

  it('loading spinner', () => {
    useDriverPayslipsMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderAt();
    expect(screen.getByText(/Đang tải bảng lương/)).toBeTruthy();
  });

  it('error state', async () => {
    useDriverPayslipsMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Không thể tải bảng lương/)).toBeTruthy());
  });
});
