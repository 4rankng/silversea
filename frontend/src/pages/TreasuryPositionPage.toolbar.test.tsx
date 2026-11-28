// 28/11 staging audit — the Sổ quỹ ledger toolbar: shared FilterBar with
// search + from/to window over the ledger table and an XLSX export of the
// FILTERED view. Scoped to the toolbar contract.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'ACCOUNTANT' } }) }));
vi.mock('../lib/csv', () => ({ downloadCSV: vi.fn().mockResolvedValue(undefined) }));

const getTreasuryPositionMock = vi.hoisted(() => vi.fn());
vi.mock('../api/customerServiceFinanceClient', () => ({
  customerServiceFinanceClient: { getTreasuryPosition: getTreasuryPositionMock },
}));

import TreasuryPositionPage from './TreasuryPositionPage';
import { downloadCSV } from '../lib/csv';

const fundBreakdown = {
  sources: [
    { source: 'TM' as const, openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
    { source: 'COMPANY' as const, openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
    { source: 'ACB_REFUND' as const, openingBalance: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
    { source: 'OPS_ADVANCE' as const, openingBalance: null, totalIn: null, totalOut: null, bookBalance: 0 },
  ],
  inDelta: 0,
  outDelta: 0,
  balanceDelta: 0,
};

interface TreasuryLedgerTestRow {
  id: number;
  code: string;
  valueDate: string;
  counterpartyName: string;
  description: string;
  accountName: string;
  direction: 'IN' | 'OUT';
  amount: number;
}

const ledgerRow = (id: number, over: Partial<TreasuryLedgerTestRow> = {}): TreasuryLedgerTestRow => ({
  id,
  code: `PV-${id}`,
  valueDate: '2026-11-20',
  counterpartyName: `Đối tượng ${id}`,
  description: `Mô tả ${id}`,
  accountName: 'VCB chính',
  direction: 'IN' as const,
  amount: 1000 + id,
  ...over,
});

async function renderPage(ledger: TreasuryLedgerTestRow[]) {
  getTreasuryPositionMock.mockReset().mockResolvedValue({
    asOf: '2026-11-28T08:00:00.000Z',
    currency: 'VND',
    coverage: 'COMPLETE',
    opsAdvance: { totalOutstanding: 0 },
    accounts: [{
      accountId: 1, code: 'ACC-1', name: 'VCB chính', type: 'BANK', fundCode: null, version: 1,
      currency: 'VND', bankName: null, bankAccountNumber: null, openingBalance: 0, totalIn: 0,
      totalOut: 0, bookBalance: 0, completeness: 'COMPLETE' as const, cutoverAt: null,
    }],
    fundBreakdown,
    ledger,
  });
  render(<TreasuryPositionPage />);
  await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Số phiếu' })).toBeTruthy());
}

const ledgerSection = () => within(screen.getByRole('region', { name: 'Bảng sổ quỹ' }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TreasuryPositionPage — Sổ quỹ toolbar (28/11 audit)', () => {
  it('renders the search, the date window and the export action in one bar', async () => {
    await renderPage([ledgerRow(1)]);
    expect(screen.getByLabelText('Tìm kiếm trong sổ quỹ')).toBeTruthy();
    expect(screen.getByLabelText('Khoảng ngày ghi sổ')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Xuất XLSX/ })).toBeTruthy();
  });

  it('search narrows the ledger table and the empty-filter face names it', async () => {
    await renderPage([ledgerRow(1), ledgerRow(2)]);
    expect(ledgerSection().getAllByRole('row').length).toBeGreaterThanOrEqual(3);

    fireEvent.change(screen.getByLabelText('Tìm kiếm trong sổ quỹ'), { target: { value: 'PV-2' } });
    expect(ledgerSection().queryByText('Đối tượng 1')).toBeNull();
    expect(ledgerSection().getByText('Đối tượng 2')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tìm kiếm trong sổ quỹ'), { target: { value: 'không-tồn-tại' } });
    expect(ledgerSection().getByText(/Không dòng sổ quỹ nào khớp bộ lọc hiện tại/)).toBeTruthy();
    fireEvent.click(ledgerSection().getByRole('button', { name: 'Xóa bộ lọc' }));
    expect(ledgerSection().getByText('Đối tượng 1')).toBeTruthy();
  });

  it('the date window bounds valueDate on both ends', async () => {
    await renderPage([
      ledgerRow(1, { valueDate: '2026-11-01' }),
      ledgerRow(2, { valueDate: '2026-11-25' }),
    ]);
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '10/11/2026' } });
    expect(ledgerSection().queryByText('Đối tượng 1')).toBeNull();
    expect(ledgerSection().getByText('Đối tượng 2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '20/11/2026' } });
    expect(ledgerSection().queryByText('Đối tượng 2')).toBeNull();
  });

  it('the export writes the FILTERED rows through the shared XLSX channel', async () => {
    await renderPage([ledgerRow(1), ledgerRow(2)]);
    fireEvent.change(screen.getByLabelText('Tìm kiếm trong sổ quỹ'), { target: { value: 'PV-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Xuất XLSX/ }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const [filename, headers, rows] = vi.mocked(downloadCSV).mock.calls[0]!;
    expect(filename).toBe('so-quy-ngan-hang');
    expect(headers[0]).toBe('Số phiếu');
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('PV-1');
  });
});
