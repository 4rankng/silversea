import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/* The source-axis projection the position route appends (K6.17 — bốn nguồn
   tiền) for the shared mock: balanced rows, deltas 0. */
const fundBreakdown = {
  sources: [
    { source: 'TM' as const, openingBalance: 1000, totalIn: 2000, totalOut: 500, bookBalance: 2500 },
    { source: 'COMPANY' as const, openingBalance: 1000, totalIn: 2000, totalOut: 500, bookBalance: 2500 },
    { source: 'ACB_REFUND' as const, openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
    { source: 'OPS_ADVANCE' as const, openingBalance: null, totalIn: null, totalOut: null, bookBalance: 0 },
  ],
  inDelta: 0,
  outDelta: 0,
  balanceDelta: 0,
};
const noLedger: never[] = [];

beforeEach(() => {
  getTreasuryPositionMock.mockReset().mockResolvedValue({
    asOf: '2026-08-23T08:00:00.000Z',
    currency: 'VND',
    coverage: 'COMPLETE',
    opsAdvance: { totalOutstanding: 0 },
    accounts: [account(1, 'Tiền mặt quỹ', 900), account(2, 'VCB chính', 500)],
    fundBreakdown,
    ledger: noLedger,
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
    expect(within(screen.getByRole('region', { name: 'Danh sách tài khoản ghi sổ' })).getByRole('columnheader', { name: 'Thu' }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Thu' }));
    await waitFor(() => expect(getTreasuryPositionMock).toHaveBeenLastCalledWith({ sortBy: 'totalIn', sortDir: 'desc' }));
    expect(within(screen.getByRole('region', { name: 'Danh sách tài khoản ghi sổ' })).getByRole('columnheader', { name: 'Thu' }).getAttribute('aria-sort')).toBe('descending');
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
      fundBreakdown,
      ledger: noLedger,
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
      fundBreakdown,
      ledger: noLedger,
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
      fundBreakdown,
      ledger: noLedger,
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

describe('TreasuryPositionPage bốn nguồn tiền + bảng sổ quỹ (K6.17 + K6.51)', () => {
  it('renders the four nguồn tiền with their book totals and closes with the Tiền mặt − Ngân hàng delta row', async () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-11-01T08:00:00.000Z',
      currency: 'VND',
      coverage: 'COMPLETE',
      opsAdvance: { totalOutstanding: 23_210_000 },
      accounts: [
        { ...account(1, 'Tiền mặt quỹ', 600), type: 'CASH', fundCode: 'TM', openingBalance: 100, totalIn: 700, totalOut: 200 },
        { ...account(2, 'VCB chính', 500), type: 'BANK', fundCode: 'COMPANY', bankName: 'Vietcombank', openingBalance: 1000, totalIn: 400, totalOut: 900 },
        { ...account(6, 'ACB - Tài khoản công ty', 220), type: 'BANK', fundCode: 'COMPANY', bankName: 'ACB', openingBalance: 200, totalIn: 50, totalOut: 30 },
      ],
      fundBreakdown: {
        sources: [
          { source: 'TM', openingBalance: 100, totalIn: 700, totalOut: 200, bookBalance: 600 },
          { source: 'COMPANY', openingBalance: 1000, totalIn: 400, totalOut: 900, bookBalance: 500 },
          { source: 'ACB_REFUND', openingBalance: 200, totalIn: 50, totalOut: 30, bookBalance: 220 },
          { source: 'OPS_ADVANCE', openingBalance: null, totalIn: null, totalOut: null, bookBalance: 23_210_000 },
        ],
        inDelta: 250,
        outDelta: -730,
        balanceDelta: -120,
      },
      ledger: noLedger,
    });
    render(<TreasuryPositionPage />);

    const recon = await screen.findByRole('region', { name: 'Đối soát quỹ' });
    const text = recon.textContent;
    // K6.17 — bốn nguồn tiền, mỗi nguồn một dòng over Đầu kỳ | Thu | Chi | Số dư cuối.
    expect(text).toContain('Quỹ tiền mặt');
    expect(text).toContain('Quỹ công ty');
    expect(text).toContain('Quỹ tài khoản ngân hàng ACB chuyên hoàn cược');
    expect(text).toContain('Quỹ tạm ứng của giao nhận');
    expect(text).toContain('Đầu kỳ');
    expect(text).toContain('Thu');
    expect(text).toContain('Chi');
    expect(text).toContain('Số dư cuối');
    expect(text).toContain('600');        // quỹ tiền mặt book balance
    expect(text).toContain('500');        // quỹ công ty book balance
    expect(text).toContain('220');        // quỹ ACB hoàn cược book balance
    expect(text).toContain('23.210.000'); // quỹ tạm ứng của giao nhận còn tồn
    // Quỹ tạm ứng không có kỳ — các cột kỳ của dòng nó là '—'.
    expect(text).toContain('—');
    // The đối soát line: Tiền mặt − (công ty + ACB) deltas as projected.
    expect(text).toContain('Đối soát (Tiền mặt − Ngân hàng)');
    expect(text).toContain('250');   // in delta
    expect(text).toContain('-730');  // out delta
    expect(text).toContain('-120');  // balance delta
  });

  it('QA sweep 28/11: negative balances render danger with an (âm …) note, not black like positives', async () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-11-01T08:00:00.000Z',
      currency: 'VND',
      coverage: 'COMPLETE',
      opsAdvance: { totalOutstanding: 0 },
      accounts: [
        { ...account(1, 'Tiền mặt quỹ', 0), type: 'CASH', fundCode: 'TM' },
        { ...account(2, 'VCB chính', -7_001_634), type: 'BANK', fundCode: 'COMPANY' },
      ],
      fundBreakdown: {
        sources: [
          { source: 'TM', openingBalance: 100, totalIn: 700, totalOut: 200, bookBalance: 600 },
          { source: 'COMPANY', openingBalance: 1000, totalIn: 400, totalOut: 900, bookBalance: -17_509_634 },
          { source: 'ACB_REFUND', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
          { source: 'OPS_ADVANCE', openingBalance: null, totalIn: null, totalOut: null, bookBalance: 0 },
        ],
        inDelta: -500,
        outDelta: -700,
        balanceDelta: -600,
      },
      ledger: noLedger,
    });
    render(<TreasuryPositionPage />);

    // The rail's 'Số dư ghi sổ' (−7.001.634 ₫) carries the danger tone and
    // spells the sign out: '(âm 7.001.634 ₫)'.
    let rail: Element | null = null;
    await waitFor(() => {
      rail = document.querySelector('[aria-label="Tóm tắt số dư ghi sổ"]');
      expect(rail?.textContent).toContain('(âm 7.001.634 ₫)');
    });
    const railItem = [...rail!.querySelectorAll('.summary-rail__item')]
      .find((item) => item.querySelector('dt')?.textContent === 'Số dư ghi sổ');
    expect(railItem?.className).toContain('summary-rail__item--danger');

    // The recon's Quỹ công ty Số dư cuối (−17.509.634 ₫) is red + annotated.
    const recon = await screen.findByRole('region', { name: 'Đối soát quỹ' });
    const companyRow = [...recon.querySelectorAll('tbody tr')]
      .find((row) => row.textContent?.includes('Quỹ công ty'));
    expect(companyRow).toBeTruthy();
    const balanceCell = companyRow!.querySelector('td[data-label="Số dư cuối"]') as HTMLElement;
    expect(balanceCell.textContent).toContain('-17.509.634 ₫');
    expect(balanceCell.textContent).toContain('(âm 17.509.634 ₫)');
    expect(balanceCell.style.color).toBe('var(--danger-text)');
  });

  it('states the no-inter-fund-transfer ledger law in the recon note', async () => {
    render(<TreasuryPositionPage />);
    const recon = await screen.findByRole('region', { name: 'Đối soát quỹ' });
    expect(recon.textContent).toContain('không ghi chuyển tiền giữa hai quỹ');
  });

  it('bảng sổ quỹ carries Số phiếu / Đối tượng / Mô tả and the total-balance label (K6.51, SIL-1031)', async () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-11-01T08:00:00.000Z',
      currency: 'VND',
      coverage: 'COMPLETE',
      opsAdvance: { totalOutstanding: 0 },
      accounts: [
        { ...account(6, 'ACB - Tài khoản công ty', 301000), type: 'BANK', fundCode: 'COMPANY', bankName: 'ACB', openingBalance: 1000, totalIn: 500000, totalOut: 200000 },
      ],
      fundBreakdown,
      ledger: [
        { id: 1, valueDate: '2026-11-01', direction: 'IN', amount: 500000, accountName: 'ACB - Tài khoản công ty', code: 'PT-0001', counterpartyName: 'KH Alpha', description: 'Thu cước lô A' },
        { id: 2, valueDate: '2026-11-02', direction: 'OUT', amount: 200000, accountName: 'ACB - Tài khoản công ty', code: 'PC-0002', counterpartyName: 'Nhà xe B', description: 'Chi phí nâng' },
      ],
    });
    render(<TreasuryPositionPage />);

    const book = await screen.findByRole('region', { name: 'Bảng sổ quỹ' });
    for (const label of ['Số phiếu', 'Ngày', 'Đối tượng', 'Mô tả', 'Tài khoản', 'Thu', 'Chi', 'Số dư']) {
      expect(within(book).getByRole('columnheader', { name: label })).toBeTruthy();
    }
    // K6.51 — nhãn tổng số dư phía trên bảng.
    expect(book.textContent).toContain('Tổng số dư');
    expect(book.textContent).toContain('301.000');
    // Row identity: Số phiếu · Đối tượng · Mô tả, and the running balance.
    expect(book.textContent).toContain('PT-0001');
    expect(book.textContent).toContain('KH Alpha');
    expect(book.textContent).toContain('Thu cước lô A');
    expect(book.textContent).toContain('PC-0002');
    expect(book.textContent).toContain('Nhà xe B');
    expect(book.textContent).toContain('Chi phí nâng');
    expect(book.textContent).toContain('501.000'); // 1.000 opening + 500.000 IN
  });

  it('hides the recon strip with the rest of the read when the ledger is empty', () => {
    getTreasuryPositionMock.mockReset().mockResolvedValue({
      asOf: '2026-11-01T08:00:00.000Z',
      currency: 'VND',
      coverage: 'UNAVAILABLE',
      opsAdvance: { totalOutstanding: 0 },
      accounts: [],
      fundBreakdown: {
        sources: [
          { source: 'TM', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
          { source: 'COMPANY', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
          { source: 'ACB_REFUND', openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
          { source: 'OPS_ADVANCE', openingBalance: null, totalIn: null, totalOut: null, bookBalance: 0 },
        ],
        inDelta: 0,
        outDelta: 0,
        balanceDelta: 0,
      },
      ledger: noLedger,
    });
    render(<TreasuryPositionPage />);
    return waitFor(() => expect(screen.queryByRole('region', { name: 'Đối soát quỹ' })).toBeNull());
  });
});
