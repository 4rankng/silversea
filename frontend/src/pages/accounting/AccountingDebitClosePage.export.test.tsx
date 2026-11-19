/**
 * FB-094 (card 181026145620 + card 201026112300) + ticket 18/11 Task 2.4
 * (SIL-855) — the Xuất Debit Note flow through the round-scoped preview:
 * - the toolbar carries "Xuất Debit Note", disabled with no selection;
 * - one click opens the PREVIEW; the accountant picks the đợt (Lần · Tháng ·
 *   Năm), the dialog pulls ALL lots of that đợt from the server preview
 *   (100% BKS báo khách + the four closing totals on the same frozen basis
 *   the issuance uses), and no issue call runs before a save button;
 * - [Lưu và tải file XLSX] issues the union document carrying the round id
 *   (`POST /api/shipments/debit-notes`, stable Idempotency-Key per selection),
 *   reconciles the issued totals against the preview, downloads
 *   `giay-bao-no-<Số Bill/Booking>.xlsx`, and reports success; a totals
 *   mismatch refuses the download loudly;
 * - still-UNLOCKED rows ask for consent FIRST — confirming DOES the locking
 *   (`POST /shipments/:id/lock`, the accountant's existing act) before the
 *   preview opens — cancel locks nothing; a lock/issue refusal surfaces
 *   verbatim in the page's message banner and no file is downloaded.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

const { listBoard, listRounds, roundPreview, createDebitNoteBatch, exportDebitNoteFile, lockShipmentCost } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  roundPreview: vi.fn(),
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  getDebitNoteRoundPreview: roundPreview,
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
  reconcileAndHideDebitLots: vi.fn(),
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
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1160000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt,
});

const ROUND = {
  id: 7,
  customerId: 11,
  customerName: 'KH A',
  direction: 'THU' as const,
  carrierKey: 'OWN',
  carrierLabel: 'Xe công ty',
  periodKey: '2026-09',
  roundNo: 1,
  dateFrom: '2026-09-01',
  dateTo: '2026-09-15',
  amount: '3580000',
  vatRate: 0,
  vatAmount: 0,
  totalAmount: 3580000,
  ghiChu: null,
  lotCount: 2,
  createdAt: '2026-09-16T00:00:00.000Z',
};

const PREVIEW = {
  round: { id: 7, roundNo: 1, periodKey: '2026-09', direction: 'THU' as const, vatRate: 0, customerName: 'KH A' },
  items: [
    { shipmentId: 1, code: 'SHP-26-0001', customerName: 'KH A', billingTruckNo: '51A-123.45', net: 1790000, costLockedAt: '2026-09-24T00:00:00.000Z' },
    { shipmentId: 2, code: 'SHP-26-0002', customerName: 'KH A', billingTruckNo: null, net: 1790000, costLockedAt: '2026-09-24T00:00:00.000Z' },
  ],
  totals: { net: 3580000, tax: 0, gross: 3580000 },
};

const originalCreateObjectURL = window.URL.createObjectURL;
const originalRevokeObjectURL = window.URL.revokeObjectURL;
let anchorClick: MockInstance;

afterEach(() => {
  window.URL.createObjectURL = originalCreateObjectURL;
  window.URL.revokeObjectURL = originalRevokeObjectURL;
  anchorClick.mockRestore();
});

/** The settled board's own rows — scoped by region because the Tổng hợp công
 *  nợ table renders beside it with the same .debit-board class. */
function boardRows() {
  return [...document.querySelectorAll('[aria-label="Bảng kế hoạch điều động tổng hợp"] tbody tr')] as HTMLElement[];
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [ROUND] });
  roundPreview.mockResolvedValue(PREVIEW);
  window.URL.createObjectURL = vi.fn(() => 'blob:debit-note');
  window.URL.revokeObjectURL = vi.fn();
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

/** Pick the seeded đợt in an open preview dialog and wait for its table. */
async function pickRound(preview: HTMLElement) {
  fireEvent.click(within(preview).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09' }));
  await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });
}

/** Open [Xuất Debit Note] over the checked rows and pick the seeded đợt. */
async function openPreviewWithRound() {
  fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
  const preview = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
  expect(createDebitNoteBatch).not.toHaveBeenCalled();
  await pickRound(preview);
  return preview;
}

// Row selection is the row itself (card 20260929_207) on the settled board.
describe('AccountingDebitClosePage — Xuất Debit Note (FB-094 + SIL-855)', () => {
  it('previews the đợt: 100% BKS báo khách, 4 dòng tổng, rồi [Lưu và tải file XLSX] carries the round id', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1'), row(2, 'BL-2')], total: 2 });
    createDebitNoteBatch.mockResolvedValue({ id: 30, totalNet: 3580000, totalTax: 0, totalGross: 3580000 });
    exportDebitNoteFile.mockResolvedValue(new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    renderPage();

    // Disabled with no selection, and it says why.
    const button = await screen.findByRole('button', { name: 'Xuất Debit Note' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Chọn ít nhất một dòng lô để xuất Debit Note');

    await screen.findByText('BL-1');
    const rows = boardRows();
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).toBeEnabled();

    // The button opens the PREVIEW first; picking the đợt pulls its full lot
    // set from the server preview with 100% BKS báo khách and the four
    // closing totals — no issue call has run yet.
    const preview = await openPreviewWithRound();
    expect(roundPreview).toHaveBeenCalledWith(7);
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(preview).toHaveTextContent('BKS báo khách');
    expect(preview).toHaveTextContent('51A-123.45');
    expect(preview).toHaveTextContent('Tổng tiền trước thuế');
    expect(preview).toHaveTextContent('Giảm giá');
    expect(preview).toHaveTextContent('VAT');
    expect(preview).toHaveTextContent('Tổng tiền sau thuế');
    // Integer VN money, zero decimal digits, from the server totals.
    expect(preview).toHaveTextContent('3.580.000 ₫');

    // [Lưu và tải file XLSX] = the SAVE (push to Công nợ, naming the đợt) +
    // the download.
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu và tải file XLSX' }));

    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2], 7));
    expect(createDebitNoteBatch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(exportDebitNoteFile).toHaveBeenCalledWith(1, 30));

    const anchor = anchorClick.mock.instances[0] as HTMLAnchorElement;
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(anchor.getAttribute('download')).toBe('giay-bao-no-BL-1.xlsx');
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    // Object-URL revoke is deferred (10s, house flow) so the browser can start
    // the download first — timing itself is not load-bearing here.
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu Debit Note (2 lô, đợt Lần 1 · 2026-09) — số liệu đã đẩy sang Công nợ. File XLSX đã tải.');
  });

  it('[Lưu] alone issues and pushes to Công nợ but downloads nothing', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1'), row(2, 'BL-2')], total: 2 });
    createDebitNoteBatch.mockResolvedValue({ id: 32, totalNet: 3580000, totalTax: 0, totalGross: 3580000 });
    renderPage();

    await screen.findByText('BL-1');
    const rows = boardRows();
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    const preview = await openPreviewWithRound();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2], 7));
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu Debit Note (2 lô, đợt Lần 1 · 2026-09) — số liệu đã đẩy sang Công nợ.');
  });

  it('a server refusal surfaces verbatim and downloads nothing (FB094-UI-03)', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1')], total: 1 });
    createDebitNoteBatch.mockRejectedValue(
      new Error('Các lô đã chọn đã nằm trong Debit Note đã xuất: BL-1'),
    );
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((boardRows()[0]!));
    const preview = await openPreviewWithRound();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu và tải file XLSX' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Các lô đã chọn đã nằm trong Debit Note đã xuất: BL-1');
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('issued totals diverging from the preview refuse the download loudly', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1')], total: 1 });
    createDebitNoteBatch.mockResolvedValue({ id: 33, totalNet: 3580001, totalTax: 0, totalGross: 3580001 });
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((boardRows()[0]!));
    const preview = await openPreviewWithRound();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu và tải file XLSX' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('lệch bảng xem trước đợt Lần 1 · 2026-09');
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  // Card 201026112300 — the consent act DOES the locking now: the round
  // preview reads frozen locks, so "Khóa & xem trước" freezes the still-
  // unlocked lots before the preview opens, and the ISSUE still waits for
  // the preview's [Lưu].
  it('unlocked rows ask for consent, lock on confirm, then preview + issue + download', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1', null), row(2, 'BL-2')], total: 2 });
    lockShipmentCost.mockResolvedValue(undefined);
    createDebitNoteBatch.mockResolvedValue({ id: 31, totalNet: 3580000, totalTax: 0, totalGross: 3580000 });
    exportDebitNoteFile.mockResolvedValue(new Blob(['xlsx'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    renderPage();

    await screen.findByText('BL-1');
    const rows = boardRows();
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));

    // No lock or issue ran yet — the dialog names the unlocked lot and asks.
    expect(lockShipmentCost).not.toHaveBeenCalled();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 lô trong lựa chọn chưa khóa chi phí');
    expect(dialog).toHaveTextContent('BL-1');

    fireEvent.click(screen.getByRole('button', { name: 'Khóa & xem trước' }));
    const preview = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    // ONLY the unlocked lot is locked (BL-2 already carries an active lock),
    // BEFORE the preview opens; the issue still waits for [Lưu].
    await waitFor(() => expect(lockShipmentCost).toHaveBeenCalledTimes(1));
    expect(lockShipmentCost).toHaveBeenCalledWith(1, expect.any(String));
    expect(createDebitNoteBatch).not.toHaveBeenCalled();

    await pickRound(preview);
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu và tải file XLSX' }));
    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2], 7));
    await waitFor(() => expect(exportDebitNoteFile).toHaveBeenCalledWith(1, 31));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Đã lưu Debit Note (2 lô, đợt Lần 1 · 2026-09) — số liệu đã đẩy sang Công nợ. File XLSX đã tải.');
  });

  it('cancel in the lock dialog locks nothing and issues nothing', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1', null)], total: 1 });
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((boardRows()[0]!));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lockShipmentCost).not.toHaveBeenCalled();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('a lock refusal surfaces verbatim at the consent act and the preview never opens', async () => {
    listBoard.mockResolvedValue({ items: [row(1, 'BL-1', null)], total: 1 });
    lockShipmentCost.mockRejectedValue(new Error('Lô hàng đã thay đổi. Vui lòng tải lại.'));
    renderPage();

    await screen.findByText('BL-1');
    fireEvent.click((boardRows()[0]!));
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Khóa & xem trước' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lô hàng đã thay đổi. Vui lòng tải lại.');
    expect(screen.queryByRole('dialog', { name: 'Xem trước Debit Note' })).toBeNull();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(exportDebitNoteFile).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });
});
