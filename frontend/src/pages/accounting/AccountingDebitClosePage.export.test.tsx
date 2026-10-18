/**
 * FB-094 (card 181026145620) — QA (hoapt, R23) closed a settlement round on
 * /accounting/chot-debit but the toolbar had no way to produce the Debit Note
 * file for the customer. Pinned here through the real page:
 * - the toolbar carries "Xuất Debit Note", disabled with no selection;
 * - one click over the selected rows issues the union document
 *   (`POST /api/shipments/debit-notes`, stable Idempotency-Key per selection),
 *   downloads `giay-bao-no-<Số Bill/Booking>.xlsx` via the blob + a[download]
 *   pattern (the `ShipmentDebitPage.exportSelectedLockedLots` house flow), and
 *   reports success;
 * - a server refusal surfaces verbatim in the page's message banner and no
 *   file is downloaded.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

const { listBoard, listRounds, createDebitNoteBatch, exportDebitNoteFile } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
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
  createDebitNoteBatch,
  exportDebitNoteFile,
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

const row = (shipmentId: number, bill: string): AccountingDebitBoardRow => ({
  shipmentId,
  code: `SHP-26-000${shipmentId}`,
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-09-25',
  billOrBooking: bill,
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' },
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
});

const originalCreateObjectURL = window.URL.createObjectURL;
const originalRevokeObjectURL = window.URL.revokeObjectURL;
let anchorClick: MockInstance;

afterEach(() => {
  window.URL.createObjectURL = originalCreateObjectURL;
  window.URL.revokeObjectURL = originalRevokeObjectURL;
  anchorClick.mockRestore();
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  window.URL.createObjectURL = vi.fn(() => 'blob:debit-note');
  window.URL.revokeObjectURL = vi.fn();
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

// Row selection is the row itself (card 20260929_207) on the settled board.
describe('AccountingDebitClosePage — Xuất Debit Note (FB-094)', () => {
  it('toolbar button downloads the issued note for the selected rows (FB094-UI-01/02)', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1'), row(2, 'BL-2')], total: 2 });
    createDebitNoteBatch.mockResolvedValue({ id: 30 });
    exportDebitNoteFile.mockResolvedValue(new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    renderPage();

    // Disabled with no selection, and it says why.
    const button = await screen.findByRole('button', { name: 'Xuất Debit Note' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Chọn ít nhất một dòng lô để xuất Debit Note');

    await screen.findByText('BL-1');
    const rows = [...document.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));

    // ONE issue call carries the whole selection; the key is stable per
    // selection so a re-click replays instead of duplicating the document.
    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2], 'debit-note-1-2'));
    expect(createDebitNoteBatch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(exportDebitNoteFile).toHaveBeenCalledWith(1, 30));

    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(anchor.getAttribute('download')).toBe('giay-bao-no-BL-1.xlsx');
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    // Object-URL revoke is deferred (10s, house flow) so the browser can start
    // the download first — timing itself is not load-bearing here.
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xuất Debit Note (2 lô).');
  });

  it('a server refusal surfaces verbatim and downloads nothing (FB094-UI-03)', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1')], total: 1 });
    createDebitNoteBatch.mockRejectedValue(
      new Error('Các lô đã chọn đã nằm trong Debit Note đã xuất: BL-1'),
    );
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((document.querySelectorAll('.debit-board tbody tr')[0] as HTMLElement));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Các lô đã chọn đã nằm trong Debit Note đã xuất: BL-1');
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });
});
