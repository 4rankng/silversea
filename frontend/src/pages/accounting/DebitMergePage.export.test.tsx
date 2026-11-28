/**
 * SIL-866 (hotfix CR-009.1) — [Xuất Debit Note] runs on
 * /accounting/ghep-bo-debit through the round-scoped preview (FB-094 cards
 * 181026145620 + 201026112300, SIL-855). KB K10.37 §10.6.9 + K10.46 §10.7.4 —
 * "2 nút [Lưu] / [Lưu và tải file Excel] — chỉ [Lưu] mới ghi vào công nợ":
 * - the toolbar carries "Xuất Debit Note" (aria-disabled with no selection);
 * - one click opens the PREVIEW; the accountant picks the đợt (Lần · Tháng ·
 *   Năm), the dialog pulls ALL lots of that đợt from the server preview
 *   (100% BKS báo khách + the four closing totals on the same frozen basis
 *   the issuance uses), and no issue call runs before [Lưu];
 * - [Lưu] issues the union document carrying the round id
 *   (`POST /api/shipments/debit-notes`) and reconciles the issued totals
 *   against the preview — the ONLY act that writes Công nợ;
 * - [Lưu và tải file XLSX] exports the PREVIEW as
 *   `giay-bao-no-<Số Bill/Booking>.xlsx` WITHOUT creating a Debit Note (no
 *   POST, no Công nợ) — SIL-971;
 * - a save refusal (409 remedy text) or a totals mismatch surfaces verbatim
 *   INSIDE the dialog (pattern catch surface error.message, mẫu màn close);
 * - still-UNLOCKED rows ask for consent FIRST — confirming DOES the locking
 *   (the same `lockShipmentCost` channel the [Khóa lô] toolbar button runs)
 *   before the preview opens — cancel locks nothing; a lock refusal surfaces
 *   verbatim as an error toast and the preview never opens.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listMergeBoard, listRounds, roundPreview, roundVariance, reconcileRound, createDebitNoteBatch, lockShipmentCost, getBootstrap, downloadCSV } = vi.hoisted(() => ({
  listMergeBoard: vi.fn(),
  listRounds: vi.fn(),
  roundPreview: vi.fn(),
  roundVariance: vi.fn(),
  reconcileRound: vi.fn(),
  createDebitNoteBatch: vi.fn(),
  lockShipmentCost: vi.fn(),
  getBootstrap: vi.fn(),
  downloadCSV: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 9, role: 'ACCOUNTANT' } }),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  getDebitNoteRoundPreview: roundPreview,
  getDebitRoundVariance: roundVariance,
  reconcileDebitRound: reconcileRound,
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  listDebitMergeBoard: listMergeBoard,
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
  },
  createDebitNoteBatch,
  lockShipmentCost,
  unlockShipmentCost: vi.fn(),
  listPendingShipmentCostAdjustRequests: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
// The house XLSX writer — the download act builds the sheet from the preview
// payload and must never reach the issuance API.
vi.mock('../../lib/csv', () => ({ downloadCSV }));

import { DebitMergePage } from './DebitMergePage';
import { ToastProvider } from '../../components/shared/Toast';
import type { DebitMergeItem } from '@tingting/shared';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/ghep-bo-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <DebitMergePage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const mergeRow = (shipmentId: number, bill: string, lockStatus: 'OPEN' | 'LOCKED' = 'LOCKED'): DebitMergeItem => ({
  shipmentId,
  code: `SHP-26-000${shipmentId}`,
  customerId: 11,
  customerName: 'KH A',
  factoryName: 'NM A',
  routeName: 'Hải Phòng → Bắc Ninh',
  deliveryDate: '2026-11-18',
  billOrBookNumber: bill,
  creatorName: null,
  creatorCode: null,
  containers: [{ id: shipmentId, containerNumber: 'BSIU1234567', containerType: "20'DC" }],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus, lockedAt: lockStatus === 'LOCKED' ? '2026-09-24T00:00:00.000Z' : null },
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
    // SIL-1094 — the merged member row carries the merge note (GHI CHÚ).
    { shipmentId: 1, billOrBooking: 'BL-1', customerName: 'KH A', billingTruckNo: '51A-123.45', mergeNote: 'Ghép xe cùng Bill BL-P', net: 1790000, costLockedAt: '2026-09-24T00:00:00.000Z' },
    { shipmentId: 2, billOrBooking: 'BL-2', customerName: 'KH A', billingTruckNo: null, net: 1790000, costLockedAt: '2026-09-24T00:00:00.000Z' },
  ],
  totals: { net: 3580000, tax: 0, gross: 3580000 },
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  downloadCSV.mockResolvedValue(undefined);
  listMergeBoard.mockResolvedValue({ items: [], total: 0 });
  listRounds.mockResolvedValue({ items: [ROUND] });
  roundPreview.mockResolvedValue(PREVIEW);
  // FIN-01 — a healthy đợt reads reconciled by default: the variance section
  // stays silent and the existing export behavior is byte-identical.
  roundVariance.mockResolvedValue({
    round: { id: 7, roundNo: 1, periodKey: '2026-09', direction: 'THU', vatRate: 0, closedAmount: 3580000, closedVat: 0, closedGross: 3580000 },
    items: [
      { shipmentId: 1, billOrBooking: 'BL-1', exportNet: 1790000, closedNet: 1790000, diff: 0, exportVat: 0, closedVat: 0, mismatch: false },
      { shipmentId: 2, billOrBooking: 'BL-2', exportNet: 1790000, closedNet: 1790000, diff: 0, exportVat: 0, closedVat: 0, mismatch: false },
    ],
    totals: { exportNet: 3580000, closedTotal: 3580000, varianceNet: 0 },
    mismatchCount: 0,
    reconciled: true,
    closedBasis: 'CHOT_RECORDED',
    history: [],
  });
  getBootstrap.mockResolvedValue({ customers: [], trucks: [] });
});

/** Select a lot through its row checkbox (the grid's selection affordance). */
async function selectLot(bill: string) {
  fireEvent.click(await screen.findByRole('checkbox', { name: `Chọn lô ${bill}` }));
}

/** Pick the seeded đợt in an open preview dialog and wait for its table. */
async function pickRound(preview: HTMLElement) {
  fireEvent.click(within(preview).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
  fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));
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

describe('DebitMergePage — Xuất Debit Note (SIL-866, FB-094 + SIL-855, KB K10.46)', () => {
  it('previews the đợt (100% BKS báo khách, 4 dòng tổng); [Lưu và tải file XLSX] exports the preview WITHOUT issuing', async () => {
    listMergeBoard.mockResolvedValue({ items: [mergeRow(1, 'BL-1'), mergeRow(2, 'BL-2')], total: 2 });
    renderPage();

    // aria-disabled with no selection, and it says why.
    const button = await screen.findByRole('button', { name: 'Xuất Debit Note' });
    expect(button).toHaveAttribute('aria-disabled', 'true');

    await selectLot('BL-1');
    await selectLot('BL-2');
    // Enabled state drops the attribute (the FB-093b aria-disabled pattern).
    expect(screen.getByRole('button', { name: 'Xuất Debit Note' })).not.toHaveAttribute('aria-disabled');

    // The button opens the PREVIEW first; picking the đợt pulls its full lot
    // set from the server preview with 100% BKS báo khách and the four
    // closing totals — no issue call has run yet.
    const preview = await openPreviewWithRound();
    expect(roundPreview).toHaveBeenCalledWith(7);
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(preview).toHaveTextContent('BKS báo khách');
    expect(preview).toHaveTextContent('51A-123.45');
    // SIL-1094 — GHI CHÚ carries "Ghép xe cùng Bill [Số Bill Lô 1]" on the
    // merged member row (and only there).
    expect(preview).toHaveTextContent('GHI CHÚ');
    expect(preview).toHaveTextContent('Ghép xe cùng Bill BL-P');
    expect(preview).toHaveTextContent('Tổng tiền trước thuế');
    expect(preview).toHaveTextContent('Giảm giá');
    expect(preview).toHaveTextContent('VAT');
    expect(preview).toHaveTextContent('Tổng tiền sau thuế');
    // Integer VN money, zero decimal digits, from the server totals.
    expect(preview).toHaveTextContent('3.580.000 ₫');

    // SIL-971 (KB K10.37 §10.6.9 + K10.46 §10.7.4) — the download button
    // exports the XLSX from the preview payload and NEVER issues a Debit
    // Note: no POST /api/shipments/debit-notes, nothing reaches Công nợ.
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu và tải file XLSX' }));

    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    const [filename, headers, rows, options] = downloadCSV.mock.calls[0];
    // SIL-876 — the board sorts DESC (mới nhất lên đầu), so the selection's
    // TOP row names the file: BL-2 (id 2, same date, higher id) leads.
    expect(filename).toBe('giay-bao-no-BL-2.xlsx');
    expect(headers).toEqual(['Lô', 'Khách hàng', 'BKS báo khách', 'GHI CHÚ', 'Tiền trước thuế']);
    expect(rows).toEqual([
      ['BL-1', 'KH A', '51A-123.45', 'Ghép xe cùng Bill BL-P', 1790000],
      ['BL-2', 'KH A', '—', '', 1790000],
      ['Tổng tiền trước thuế', '', '', '', 3580000],
      ['Giảm giá', '', '', '', 0],
      ['VAT', '', '', '', 0],
      ['Tổng tiền sau thuế', '', '', '', 3580000],
    ]);
    expect(options).toEqual(expect.objectContaining({ title: 'GIẤY BÁO NỢ', hideTotals: true }));
    expect(await screen.findByRole('log')).toHaveTextContent('Đã tải file XLSX (2 lô, đợt Lần 1 · 2026-09 · Phải thu) — bản xem trước, chưa ghi công nợ.');
    // The dialog STAYS open — [Lưu] follows on the same preview when the
    // accountant is ready to write Công nợ (the SIL-971 repro flow).
    expect(screen.getByRole('dialog', { name: 'Xem trước Debit Note' })).toBeTruthy();
  });

  it('[Lưu] alone issues the union document carrying the round id and downloads nothing', async () => {
    listMergeBoard.mockResolvedValue({ items: [mergeRow(1, 'BL-1'), mergeRow(2, 'BL-2')], total: 2 });
    createDebitNoteBatch.mockResolvedValue({ id: 32, totalNet: 3580000, totalTax: 0, totalGross: 3580000 });
    renderPage();

    await selectLot('BL-1');
    await selectLot('BL-2');
    const preview = await openPreviewWithRound();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2], 7));
    expect(createDebitNoteBatch).toHaveBeenCalledTimes(1);
    expect(downloadCSV).not.toHaveBeenCalled();
    expect(await screen.findByRole('log')).toHaveTextContent('Đã lưu Debit Note (2 lô, đợt Lần 1 · 2026-09 · Phải thu) — số liệu đã đẩy sang Công nợ.');
  });

  it('a 409 refusal on [Lưu] surfaces verbatim INSIDE the still-open dialog (SIL-971)', async () => {
    listMergeBoard.mockResolvedValue({ items: [mergeRow(1, 'BL-1')], total: 1 });
    createDebitNoteBatch.mockRejectedValue(
      new Error('Các lô SHP-2611-00657 đã xuất Debit Note #29. Mỗi lô đã khóa chỉ xuất trong một Debit Note duy nhất.'),
    );
    renderPage();

    await selectLot('BL-1');
    const preview = await openPreviewWithRound();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu' }));

    // The 409 remedy text reads INSIDE the popup (pattern catch surface
    // error.message) — never the silent dialog of the repro.
    const alert = await within(preview).findByRole('alert');
    expect(alert).toHaveTextContent('Các lô SHP-2611-00657 đã xuất Debit Note #29');
    expect(screen.getByRole('dialog', { name: 'Xem trước Debit Note' })).toBeTruthy();
    expect(downloadCSV).not.toHaveBeenCalled();
    // The FB094-UI-03 toast surface stays verbatim too.
    expect(await screen.findByRole('log')).toHaveTextContent('Các lô SHP-2611-00657 đã xuất Debit Note #29');
  });

  it('issued totals diverging from the preview surface loudly on [Lưu] and no file is produced', async () => {
    listMergeBoard.mockResolvedValue({ items: [mergeRow(1, 'BL-1')], total: 1 });
    createDebitNoteBatch.mockResolvedValue({ id: 33, totalNet: 3580001, totalTax: 0, totalGross: 3580001 });
    renderPage();

    await selectLot('BL-1');
    const preview = await openPreviewWithRound();
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu' }));

    expect(await within(preview).findByRole('alert')).toHaveTextContent('lệch bảng xem trước đợt Lần 1 · 2026-09 · Phải thu');
    expect(downloadCSV).not.toHaveBeenCalled();
  });

  // Card 201026112300 law, moved with the button (SIL-866) — the consent act
  // DOES the locking: the round preview reads frozen locks, so "Khóa & xem
  // trước" freezes the still-unlocked lots before the preview opens, and the
  // ISSUE still waits for the preview's [Lưu].
  it('unlocked rows ask for consent, lock on confirm, then preview + [Lưu] issues', async () => {
    listMergeBoard.mockResolvedValue({
      items: [mergeRow(1, 'BL-1', 'OPEN'), mergeRow(2, 'BL-2', 'LOCKED')],
      total: 2,
    });
    lockShipmentCost.mockResolvedValue(undefined);
    createDebitNoteBatch.mockResolvedValue({ id: 31, totalNet: 3580000, totalTax: 0, totalGross: 3580000 });
    renderPage();

    await selectLot('BL-1');
    await selectLot('BL-2');
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
    fireEvent.click(within(preview).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(createDebitNoteBatch).toHaveBeenCalledWith([1, 2], 7));
    expect(downloadCSV).not.toHaveBeenCalled();
    expect(await screen.findByRole('log')).toHaveTextContent('Đã lưu Debit Note (2 lô, đợt Lần 1 · 2026-09 · Phải thu) — số liệu đã đẩy sang Công nợ.');
  });

  it('cancel in the lock dialog locks nothing and issues nothing', async () => {
    listMergeBoard.mockResolvedValue({ items: [mergeRow(1, 'BL-1', 'OPEN')], total: 1 });
    renderPage();

    await selectLot('BL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lockShipmentCost).not.toHaveBeenCalled();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(downloadCSV).not.toHaveBeenCalled();
  });

  it('a lock refusal surfaces verbatim at the consent act and the preview never opens', async () => {
    listMergeBoard.mockResolvedValue({ items: [mergeRow(1, 'BL-1', 'OPEN')], total: 1 });
    lockShipmentCost.mockRejectedValue(new Error('Lô hàng đã thay đổi. Vui lòng tải lại.'));
    renderPage();

    await selectLot('BL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Xuất Debit Note' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Khóa & xem trước' }));

    expect(await screen.findByRole('log')).toHaveTextContent('Lô hàng đã thay đổi. Vui lòng tải lại.');
    expect(screen.queryByRole('dialog', { name: 'Xem trước Debit Note' })).toBeNull();
    expect(createDebitNoteBatch).not.toHaveBeenCalled();
    expect(downloadCSV).not.toHaveBeenCalled();
  });
});
