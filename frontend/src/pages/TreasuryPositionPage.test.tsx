import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'ACCOUNTANT' } }) }));

const getTreasuryPositionMock = vi.hoisted(() => vi.fn());

vi.mock('../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: {
    getTreasuryPosition: getTreasuryPositionMock,
  },
}));

import TreasuryPositionPage from './TreasuryPositionPage';

function account(accountId: number, name: string, bookBalance: number) {
  return {
    accountId,
    code: `ACC-${accountId}`,
    name,
    type: accountId % 2 === 0 ? 'CASH' : 'BANK',
    fundCode: null,
    version: 1,
    currency: 'VND',
    openingBalance: 1000,
    totalIn: 2000,
    totalOut: 500,
    bookBalance,
    completeness: 'COMPLETE' as const,
    cutoverAt: null,
  };
}

beforeEach(() => {
  getTreasuryPositionMock.mockReset().mockResolvedValue({
    asOf: '2026-08-23T08:00:00.000Z',
    currency: 'VND',
    coverage: 'COMPLETE',
    accounts: [account(1, 'Tiền mặt quỹ', 900), account(2, 'VCB chính', 500)],
  });
});

describe('TreasuryPositionPage server-side column sort', () => {
  it('loads without sort params (default order) and renders sortable headers', async () => {
    render(<TreasuryPositionPage />);
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Số dư ghi sổ' })).toBeTruthy());
    expect(getTreasuryPositionMock).toHaveBeenCalledWith(undefined);
    for (const label of ['Tài khoản', 'Đầu kỳ', 'Thu', 'Chi', 'Số dư ghi sổ', 'Trạng thái']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('header click sends sortBy/sortDir and flips asc → desc', async () => {
    render(<TreasuryPositionPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thu' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
    await waitFor(() => expect(getTreasuryPositionMock).toHaveBeenLastCalledWith({ sortBy: 'totalIn', sortDir: 'asc' }));
    expect(screen.getByRole('columnheader', { name: 'Thu' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
    await waitFor(() => expect(getTreasuryPositionMock).toHaveBeenLastCalledWith({ sortBy: 'totalIn', sortDir: 'desc' }));
    expect(screen.getByRole('columnheader', { name: 'Thu' }).getAttribute('aria-sort')).toBe('descending');
  });
});
