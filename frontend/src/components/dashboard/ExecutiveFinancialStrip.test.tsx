import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { ExecutiveFinancialStrip } from './ExecutiveFinancialStrip';

vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const executiveData = {
  asOf: '2026-08-02T03:30:00.000Z',
  definitionVersion: 'executive-dashboard-v1',
  revenueToday: 1_250_000,
  revenueMonth: 8_500_000,
  costMonth: 4_000_000,
  profitMonth: 4_500_000,
  accountsReceivable: 12_000_000,
  overdueAccountsReceivable: 2_500_000,
  cash: { bookBalance: 0, completeness: 'PARTIAL' as const, accountCount: 0 },
  bank: { bookBalance: 7_500_000, completeness: 'COMPLETE' as const, accountCount: 1 },
  reconciliation: { status: 'PARTIAL' as const, difference: 0, note: '' },
};

describe('ExecutiveFinancialStrip', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('keeps only the supplemental daily, overdue, cash, and bank pulse', async () => {
    vi.mocked(api.get).mockResolvedValue({ executive: executiveData });

    render(<ExecutiveFinancialStrip enabled />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Dòng tiền & đối soát' })).toBeTruthy();
    });

    expect(screen.getByText('Doanh thu hôm nay')).toBeTruthy();
    expect(screen.getByText('Công nợ quá hạn')).toBeTruthy();
    expect(screen.getByText('Tiền mặt ghi sổ')).toBeTruthy();
    expect(screen.getByText('Ngân hàng ghi sổ')).toBeTruthy();
    expect(screen.getAllByText('Dữ liệu một phần')).toHaveLength(2);

    expect(screen.queryByText('Doanh thu tháng')).toBeNull();
    expect(screen.queryByText('Chi phí tháng')).toBeNull();
    expect(screen.queryByText('Lợi nhuận tháng')).toBeNull();
  });

  it('does not request or render executive data without the capability', () => {
    const { container } = render(<ExecutiveFinancialStrip enabled={false} />);

    expect(api.get).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('shows an unavailable state when the response has no executive payload', async () => {
    vi.mocked(api.get).mockResolvedValue({});

    render(<ExecutiveFinancialStrip enabled />);

    expect(await screen.findByText('Chưa có dữ liệu tài chính điều hành cho kỳ này.')).toBeTruthy();
    expect(screen.queryByText('Đang tải chỉ số tài chính…')).toBeNull();
  });

  it('shows a recoverable error when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network'));

    render(<ExecutiveFinancialStrip enabled />);

    expect((await screen.findByRole('alert')).textContent).toContain('Không thể tải chỉ số tài chính điều hành');
  });
});
