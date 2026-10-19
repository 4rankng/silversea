/**
 * Card 191026160000 (§2) — the chốt-debit fixes the chiphispec round-2 asks:
 * - CP2-D1 the board opens on the CURRENT MONTH (select-all over the whole
 *   ledger froze the page at 8864 rows on the shared DB — the QA repro);
 * - CP2-D2 a selected row paints the accent band AND carries the ✓ tick in
 *   its Ngày cell ("hiện số dòng mà không biết đã click dòng nào");
 * - CP2-D3 the "Chọn Debit" dialog groups the selection BY NGÀY with tick
 *   boxes — unticking a date removes its lots from the count, the sum and
 *   the submitted shipmentIds;
 * - CP2-D4 a successful chốt đợt KEEPS the selection so "Xuất Debit Note"
 *   works immediately after (the export used to die on the forced clear).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, createRound, createNote, exportNote } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  createRound: vi.fn(),
  createNote: vi.fn(),
  exportNote: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: vi.fn(),
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: createRound,
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  createDebitNoteBatch: createNote,
  exportDebitNoteFile: exportNote,
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingDebitClosePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const RATES = { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' };
const CARRIER_RATES = { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-10-05',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { ...RATES },
  tra: { ...CARRIER_RATES },
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  ...over,
});

const originalCreateObjectURL = window.URL.createObjectURL;
const originalRevokeObjectURL = window.URL.revokeObjectURL;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  window.URL.createObjectURL = vi.fn(() => 'blob:debit-note');
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  window.URL.createObjectURL = originalCreateObjectURL;
  window.URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

describe('AccountingDebitClosePage — card 191026160000 chốt-debit fixes', () => {
  it('CP2-D1: the board opens scoped to the current month, not the whole ledger', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const from = `${today.getFullYear()}-${month}-01`;
    expect(listBoard).toHaveBeenCalledWith({ dateFrom: from, dateTo: expect.any(String) });
  });

  it('CP2-D2: a selected row carries data-selected and the ✓ tick in its Ngày cell', async () => {
    listBoard.mockResolvedValue({ items: [row(), row({ shipmentId: 2, billOrBooking: 'BL-2' })], total: 2 });
    const { container } = renderPage();
    await screen.findByText('BL-1');
    const rows = [...container.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
    const tick = rows[0].querySelector('.debit-row-tick');
    expect(tick).not.toBeNull();
    expect(tick).toHaveTextContent('');
    fireEvent.click(rows[0]);
    await waitFor(() => expect(rows[0]).toHaveAttribute('data-selected'));
    // The tick renders the glyph only for the selected row — the sibling stays blank.
    expect(rows[0].querySelector('.debit-row-tick')).toHaveTextContent('✓');
    expect(rows[1].querySelector('.debit-row-tick')).toHaveTextContent('');
  });

  it('CP2-D3: the Chọn Debit dialog groups by date — unticking a date drops its lots from the submit body', async () => {
    listBoard.mockResolvedValue({
      items: [
        row({ shipmentId: 1, billOrBooking: 'BL-1', ngay: '2026-10-05' }),
        row({ shipmentId: 2, billOrBooking: 'BL-2', ngay: '2026-10-05' }),
        row({ shipmentId: 3, billOrBooking: 'BL-3', ngay: '2026-10-07' }),
      ],
      total: 3,
    });
    createRound.mockResolvedValue({ id: 9, roundNo: 1, periodKey: '2026-10', direction: 'THU', vatRate: 0, totalAmount: 3580000, amount: '3580000' });
    const { container } = renderPage();
    await screen.findByText('BL-1');
    const rows = [...container.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
    fireEvent.click(rows[0]);
    fireEvent.click(rows[1]);
    fireEvent.click(rows[2]);
    fireEvent.click(screen.getByRole('button', { name: 'Chọn Debit (3 dòng)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' });
    // Header states the scoped count over the whole selection.
    expect(within(dialog).getByText('Chọn Debit — chốt đợt đối soát (3/3 lô)')).toBeInTheDocument();
    // One labelled tick per distinct date, each naming its lot count.
    expect(within(dialog).getByRole('checkbox', { name: 'Chọn ngày 2026-10-05 (2 lô)' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Chọn ngày 2026-10-07 (1 lô)' })).toBeChecked();
    // All dates on ⇒ the master tick reads the "bỏ chọn" direction.
    expect(within(dialog).getByRole('checkbox', { name: 'Bỏ chọn tất cả ngày' })).toBeChecked();

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Chọn ngày 2026-10-05 (2 lô)' }));
    expect(within(dialog).getByText('Chọn Debit — chốt đợt đối soát (1/3 lô)')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Chọn tất cả ngày' })).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '0%' }));
    // Only 2026-10-07's lot sums into the amount.
    expect(within(dialog).getAllByText('1.790.000 ₫').length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chốt đợt' }));
    await waitFor(() => expect(createRound.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      shipmentIds: [3],
    })));
  }, 20000);

  it('CP2-D4: a successful chốt keeps the selection so Xuất Debit Note works right after', async () => {
    listBoard.mockResolvedValue({ items: [row({ shipmentId: 151190, billOrBooking: 'BL-9' })], total: 1 });
    createRound.mockResolvedValue({ id: 12, roundNo: 1, periodKey: '2026-10', direction: 'THU', vatRate: 0, totalAmount: 1790000, amount: '1790000' });
    createNote.mockResolvedValue({ id: 60 });
    exportNote.mockResolvedValue(new Blob(['xlsx']));
    const { container } = renderPage();
    await screen.findByText('BL-9');
    fireEvent.click((container.querySelectorAll('.debit-board tbody tr')[0] as HTMLElement));

    fireEvent.click(screen.getByRole('button', { name: 'Chọn Debit (1 dòng)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Phải thu (từ khách hàng)' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '0%' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chốt đợt' }));
    await waitFor(() => expect(createRound).toHaveBeenCalledTimes(1));

    // The selection SURVIVES the chốt: the export button stays enabled and
    // exports the same lot (the FB-094 flow, un-broken by the clear()).
    const exportButton = screen.getByRole('button', { name: 'Xuất Debit Note' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);
    await waitFor(() => expect(createNote).toHaveBeenCalledWith([151190]));
    await waitFor(() => expect(exportNote).toHaveBeenCalledWith(151190, 60));
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xuất Debit Note (1 lô).');
  }, 20000);
});
