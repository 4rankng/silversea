/**
 * Card 181026145620 (FB-094) — after "chốt đợt" the accounting close screen
 * must offer a Debit Note download. Pins the toolbar action, the batched issue
 * call over the selected rows (stable idempotency key), the download seam and
 * the error banner.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

const { listBoard, listRounds, createBatch, exportFile } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  createBatch: vi.fn(),
  exportFile: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: vi.fn(),
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

vi.mock('../../api/shipmentDebit', () => ({
  createDebitNoteBatch: createBatch,
  exportDebitNoteFile: exportFile,
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SS-1',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-10-20',
  billOrBooking: 'BL-1',
  containers: [],
  phanXe: ['Nhà xe A'],
  thu: { cuocThu: '1000000', lachHuyen: '0', phuPs: '0', phatSinhCus: '0', tongThu: '1000000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '0', phatSinhDv: '0', tong1: '400000', phiRu: '0' },
  loiNhuan: '600000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingDebitClosePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const originalMatchMedia = window.matchMedia;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  listBoard.mockResolvedValue({ items: [row({ shipmentId: 1, billOrBooking: 'BL-1' }), row({ shipmentId: 2, billOrBooking: 'BL-2' })], total: 2 });
  createBatch.mockResolvedValue({ id: 77 });
  exportFile.mockResolvedValue(new Blob(['xlsx']));
  URL.createObjectURL = vi.fn(() => 'blob:debit-note');
  URL.revokeObjectURL = vi.fn();
  window.matchMedia = (media): MediaQueryList => ({
    media, matches: false, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList;
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  window.matchMedia = originalMatchMedia;
  anchorClick.mockReset();
  anchorClick.mockImplementation(() => {});
});

describe('card 181026145620 — Xuất Debit Note on /accounting/chot-debit', () => {
  it('exports the selected lots through the batched issue + per-lot download seam', async () => {
    renderPage();

    const selectAll = await screen.findByRole('button', { name: /Chọn tất cả 2 lô/ });
    fireEvent.click(selectAll);
    const exportButton = screen.getByRole('button', { name: /Xuất Debit Note \(2\)/ });
    fireEvent.click(exportButton);

    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1));
    expect(createBatch).toHaveBeenCalledWith([1, 2], 'debit-note-1-2');
    await waitFor(() => expect(exportFile).toHaveBeenCalledWith(1, 77));
    expect(await screen.findByText('Đã xuất Debit Note cho 2 lô.')).toBeTruthy();
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('keeps the action disabled without a selection and shows the server refusal', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Xuất Debit Note \(0\)/ })).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Chọn tất cả 2 lô/ }));
    createBatch.mockRejectedValueOnce(new Error('Lô BL-9 chưa khóa sổ — chưa xuất Debit Note được.'));
    fireEvent.click(screen.getByRole('button', { name: /Xuất Debit Note \(2\)/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lô BL-9 chưa khóa sổ — chưa xuất Debit Note được.');
    expect(exportFile).not.toHaveBeenCalled();
  });
});
