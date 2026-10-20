/**
 * FB-094 (card 181026145620 + card 201026112300) — QA (hoapt, R23/R24) closed
 * a settlement round on /accounting/chot-debit but the toolbar had no way to
 * produce the Debit Note file for the customer; after the button landed, QA
 * still failed because the chốt-debit flow's rows are never cost-locked and
 * the server refuses unlocked lots. Pinned here through the real page:
 * - the toolbar carries "Xuất Debit Note", disabled with no selection;
 * - one click over LOCKED rows issues the union document
 *   (`POST /api/shipments/debit-notes`, stable Idempotency-Key per selection),
 *   downloads `giay-bao-no-<Số Bill/Booking>.xlsx` via the blob + a[download]
 *   pattern (the `ShipmentDebitPage.exportSelectedLockedLots` house flow), and
 *   reports success;
 * - a click over still-UNLOCKED rows first asks for consent, then locks each
 *   unlocked lot (`POST /shipments/:id/lock`, the accountant's existing act)
 *   before issuing — cancel locks nothing; a lock/issue refusal surfaces
 *   verbatim in the page's message banner and no file is downloaded.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

const { listBoard, listRounds, createDebitNoteBatch, exportDebitNoteFile, lockShipmentCost } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
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
  lockShipmentCost,
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

const row = (shipmentId: number, bill: string, costLockedAt: string | null = '2026-09-24T00:00:00.000Z'): AccountingDebitBoardRow => ({
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
  costLockedAt,
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

    // ONE issue call carries the whole selection; the key is derived inside
    // the client (stable per selection) so a re-click replays instead of
    // duplicating the document.
    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2]));
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

  // Card 201026112300 — the R24 QA-visible failure: rows the chốt-debit flow
  // produces are reconciled but NOT cost-locked, and the export used to
  // refuse them with "chỉ áp dụng cho lô đã khóa chi phí". The button now
  // bridges the two accountant acts with explicit consent.
  it('unlocked rows ask for consent, lock each lot, then issue + download (card 201026112300)', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1', null), row(2, 'BL-2')], total: 2 });
    lockShipmentCost.mockResolvedValue(undefined);
    createDebitNoteBatch.mockResolvedValue({ id: 31 });
    exportDebitNoteFile.mockResolvedValue(new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    renderPage();

    await screen.findByText('BL-1');
    const rows = [...document.querySelectorAll('.debit-board tbody tr')] as HTMLElement[];
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));

    // No lock or issue ran yet — the dialog names the unlocked lot and asks.
    expect(lockShipmentCost).not.toHaveBeenCalled();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 lô trong lựa chọn chưa khóa chi phí');
    expect(dialog).toHaveTextContent('BL-1');

    fireEvent.click(screen.getByRole('button', { name: 'Khóa & Xuất' }));

    // ONLY the unlocked lot is locked (BL-2 already carries an active lock),
    // then ONE issue call carries the whole selection and the file downloads.
    await waitFor(() => expect(lockShipmentCost).toHaveBeenCalledTimes(1));
    expect(lockShipmentCost).toHaveBeenCalledWith(1, expect.any(String));
    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2]));
    await waitFor(() => expect(exportDebitNoteFile).toHaveBeenCalledWith(1, 31));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Đã xuất Debit Note (2 lô, đã khóa chi phí 1 lô).');
  });

  it('cancel in the lock dialog locks nothing and issues nothing', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1', null)], total: 1 });
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((document.querySelectorAll('.debit-board tbody tr')[0] as HTMLElement));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lockShipmentCost).not.toHaveBeenCalled();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('a lock refusal surfaces verbatim and nothing is issued', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1', null)], total: 1 });
    lockShipmentCost.mockRejectedValue(new Error('Lô hàng đã thay đổi. Vui lòng tải lại.'));
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((document.querySelectorAll('.debit-board tbody tr')[0] as HTMLElement));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Khóa & Xuất' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lô hàng đã thay đổi. Vui lòng tải lại.');
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });
});
