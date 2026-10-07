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
    bankName: null,
    bankAccountNumber: null,
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
    opsAdvance: { totalOutstanding: 0 },
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

describe('TreasuryPositionPage fund summary bar and account identity (card 20261002_291)', () => {
  it('sums the five core fund figures into one bar, without the technical code anywhere', async () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-10-03T08:00:00.000Z',
      currency: 'VND',
      coverage: 'COMPLETE',
      opsAdvance: { totalOutstanding: 750 },
      accounts: [
        { ...account(1, 'Tiền mặt quỹ', 900), type: 'CASH', bankName: null, bankAccountNumber: null },
        { ...account(2, 'VCB chính', 500), type: 'BANK', bankName: 'Vietcombank', bankAccountNumber: '0221000123456' },
      ],
    });
    render(<TreasuryPositionPage />);

    const rail = await screen.findByRole('region', { name: 'Tóm tắt số dư ghi sổ' });
    const railText = rail.textContent;
    // Sums across accounts: opening 1000×2, in 2000×2, out 500×2, balance 900+500.
    expect(railText).toContain('Đầu kỳ');
    expect(railText).toContain('2.000');
    expect(railText).toContain('Thu');
    expect(railText).toContain('4.000');
    expect(railText).toContain('Chi');
    expect(railText).toContain('1.000');
    expect(railText).toContain('1.400');          // book balance
    expect(railText).toContain('Tạm ứng OPS còn tồn');
    expect(railText).toContain('750');

    // The bank identity names the row's caption; the technical code (ACC-…)
    // never renders as a business label.
    const row = screen.getByText('VCB chính').closest('td')!;
    expect(row.textContent).toContain('Vietcombank');
    expect(row.textContent).toContain('0221000123456');
    expect(row.textContent).not.toContain('ACC-2');
    // Accounts without a bank still read type + fund, never the code.
    const cashRow = screen.getByText('Tiền mặt quỹ').closest('td')!;
    expect(cashRow.textContent).not.toContain('ACC-1');
  });

  it('card 071026212020: no migration phrase in an account caption without a cutover date, real cutover dates still shown', async () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-10-03T08:00:00.000Z',
      currency: 'VND',
      coverage: 'COMPLETE',
      opsAdvance: { totalOutstanding: 0 },
      accounts: [
        account(1, 'Tiền mặt quỹ', 900),
        { ...account(2, 'VCB chính', 500), cutoverAt: '2026-10-01T03:00:00.000Z' },
      ],
    });
    render(<TreasuryPositionPage />);

    const row = await screen.findByText('Tiền mặt quỹ');
    const cell = row.closest('td')!;
    // The migration-state phrase is a technical label — the account's
    // conversion state lives in the Trạng thái pill, never in the caption.
    expect(cell.textContent).not.toContain('Chưa chuyển đổi');
    const cutRow = screen.getByText('VCB chính').closest('td')!;
    expect(cutRow.textContent).toContain('Chuyển đổi:');
  });

  it('carries the bank identity through the row caption from the read', async () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-10-03T08:00:00.000Z',
      currency: 'VND',
      coverage: 'COMPLETE',
      opsAdvance: { totalOutstanding: 0 },
      accounts: [{ ...account(1, 'VCB chính', 500), type: 'BANK', bankName: 'Vietcombank', bankAccountNumber: '0221000999' }],
    });
    render(<TreasuryPositionPage />);
    const row = await screen.findByText('VCB chính');
    const cell = row.closest('td')!;
    expect(cell.textContent).toContain('Vietcombank');
    expect(cell.textContent).toContain('0221000999');
    expect(cell.textContent).not.toContain('ACC-1');
    // The fifth rail metric renders from the read's canonical outstanding.
    const rail = document.querySelector('[aria-label="Tóm tắt số dư ghi sổ"]')!;
    expect(rail.textContent).toContain('Tạm ứng OPS còn tồn');
  });
});
