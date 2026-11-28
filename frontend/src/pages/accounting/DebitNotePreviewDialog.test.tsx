/**
 * Ticket 18/11 Task 2.4 (SIL-855) — the Debit Note preview dialog's own laws:
 * - no đợt picked → the save buttons stay disabled and the dialog says why
 *   (chưa chọn đợt thì chưa thể lưu — the money gate of the chốt law);
 * - a picked đợt pulls the round's FULL lot set from the server preview and
 *   renders 100% BKS báo khách per row (the issued-line plate law) and the
 *   four closing totals as integer VN money;
 * - KB K10.37 §10.6.9 + K10.46 §10.7.4 — [Lưu] carries (roundId, lots,
 *   totals) to the page (the ONLY Công-nợ act); [Lưu và tải file XLSX] hands
 *   the preview for a NO-save XLSX export (SIL-971);
 * - a preview refusal (e.g. đợt còn lô chưa khóa chi phí) and a save/export
 *   refusal surface verbatim.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { roundPreview, roundVariance, reconcileRound } = vi.hoisted(() => ({
  roundPreview: vi.fn(),
  roundVariance: vi.fn(),
  reconcileRound: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  getDebitNoteRoundPreview: roundPreview,
  getDebitRoundVariance: roundVariance,
  reconcileDebitRound: reconcileRound,
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

import { DebitNotePreviewDialog, type DebitNoteSavePayload } from './DebitNotePreviewDialog';
import type { DebitNoteRoundPreview, DebitSettlementRoundRow } from '../../api/accountingDebitClient';

const ROUND: DebitSettlementRoundRow = {
  id: 7,
  customerId: 11,
  customerName: 'KH A',
  direction: 'THU',
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
    { shipmentId: 1, billOrBooking: 'BL-1001', customerName: 'KH A', billingTruckNo: '51A-123.45', net: 1790000, costLockedAt: '2026-09-24T00:00:00.000Z' },
    { shipmentId: 2, billOrBooking: 'BL-1002', customerName: null, billingTruckNo: null, net: 1790000, costLockedAt: '2026-09-24T00:00:00.000Z' },
  ],
  totals: { net: 3580000, tax: 0, gross: 3580000 },
};

function renderDialog(open = true, rounds: DebitSettlementRoundRow[] = [ROUND], error: string | null = null, canReconcile = false) {
  const saves: DebitNoteSavePayload[] = [];
  const downloads: DebitNoteRoundPreview[] = [];
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DebitNotePreviewDialog
        open={open}
        customerIds={[11]}
        rounds={rounds}
        busy={false}
        error={error}
        canReconcile={canReconcile}
        onSaveOnly={(payload) => saves.push(payload)}
        onDownloadXlsx={(preview) => downloads.push(preview)}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  return { saves, downloads };
}

/** A reconciled đợt (the QA control pair: 120.000 ₫ + a real 0₫) — the
 *  variance section must stay silent and nothing else changes. */
const RECONCILED_VARIANCE = {
  round: { id: 7, roundNo: 1, periodKey: '2026-09', direction: 'THU', vatRate: 0, closedAmount: 3580000, closedVat: 0, closedGross: 3580000 },
  items: [
    { shipmentId: 1, billOrBooking: 'BL-1001', exportNet: 1790000, closedNet: 1790000, diff: 0, exportVat: 0, closedVat: 0, mismatch: false },
    { shipmentId: 2, billOrBooking: 'BL-1002', exportNet: 1790000, closedNet: 1790000, diff: 0, exportVat: 0, closedVat: 0, mismatch: false },
  ],
  totals: { exportNet: 3580000, closedTotal: 3580000, varianceNet: 0 },
  mismatchCount: 0,
  reconciled: true,
  closedBasis: 'CHOT_RECORDED',
  history: [],
};

/** The QA Lần 12 · 2026-11 shape: chốt ghi nhận 4.638.000 ₫, phí đã khóa cho
 *  3.998.800 ₫ — chênh lệch 639.200 ₫ trên hai dòng, từng dòng nêu tên. */
const MISMATCH_VARIANCE = {
  round: { id: 7, roundNo: 1, periodKey: '2026-09', direction: 'THU', vatRate: 8, closedAmount: 4638000, closedVat: 371040, closedGross: 5009040 },
  items: [
    { shipmentId: 1, billOrBooking: 'BL-2611-A', exportNet: 1998800, closedNet: 2319000, diff: -320200, exportVat: 159904, closedVat: 185520, mismatch: true },
    { shipmentId: 2, billOrBooking: 'BL-2611-B', exportNet: 2000000, closedNet: 2319000, diff: -319000, exportVat: 160000, closedVat: 185520, mismatch: true },
  ],
  totals: { exportNet: 3998800, closedTotal: 4638000, varianceNet: -639200 },
  mismatchCount: 2,
  reconciled: false,
  closedBasis: 'CHOT_RECORDED',
  history: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  roundPreview.mockResolvedValue(PREVIEW);
  roundVariance.mockResolvedValue(RECONCILED_VARIANCE);
  reconcileRound.mockResolvedValue({
    roundId: 7, roundNo: 1, periodKey: '2026-09', direction: 'THU', lotCount: 2,
    before: { amount: 4638000, vat: 371040, gross: 5009040 },
    after: { amount: 3998800, vat: 319904, gross: 4318704 },
    varianceNet: -639200, reconciledBy: 9, reconciledByName: 'Kế toán QA',
    reconciledAt: '2026-11-28T10:00:00.000Z', reason: 'đối chiếu',
  });
});

describe('DebitNotePreviewDialog (SIL-855)', () => {
  it('mở đủ rộng cho cột tiền — Modal không còn mặc định 480px (QA phải cuộn ngang)', () => {
    renderDialog();
    const surface = document.querySelector<HTMLElement>('[style*="modal-max-w"]');
    expect(surface).not.toBeNull();
    expect(surface!.style.getPropertyValue('--modal-max-w')).toBe('min(92vw, 860px)');
  });

  it('without a đợt the saves stay disabled and the dialog says why', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    expect(roundPreview).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Chọn đợt chốt để gom toàn bộ lô của đợt/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Lưu và tải file XLSX' })).toBeDisabled();
  });

  it('a picked đợt pulls its full lot set: 100% BKS báo khách + 4 integer totals, saves carry (roundId, lots, totals)', async () => {
    const { saves } = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));

    const table = await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });
    expect(roundPreview).toHaveBeenCalledWith(7);
    // Both đợt lots render, identified by SỐ BILL/BOOKING (SIL-868: the
    // internal SHP-* code never reaches the preview), with the issued-line
    // plate law per row.
    expect(table).toHaveTextContent('BL-1001');
    expect(table).toHaveTextContent('51A-123.45');
    expect(table).toHaveTextContent('BL-1002');
    expect(table).not.toHaveTextContent('SHP-');
    // No plate known → the honest dash, never a fabricated plate.
    expect(table).toHaveTextContent('—');
    // The four closing totals, integer VN money (zero digits).
    expect(table).toHaveTextContent('Tổng tiền trước thuế');
    expect(table).toHaveTextContent('3.580.000 ₫');
    expect(table).toHaveTextContent('Giảm giá');
    expect(table).toHaveTextContent('VAT');
    expect(table).toHaveTextContent('Tổng tiền sau thuế');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({
      roundId: 7,
      roundLabel: 'Lần 1 · 2026-09 · Phải thu',
      lotIds: [1, 2],
      totals: { net: 3580000, tax: 0, gross: 3580000 },
    });
  });

  it('[Lưu và tải file XLSX] hands the whole preview to the page — a NO-save export (KB K10.46 §10.7.4)', async () => {
    const { saves, downloads } = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));
    await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu và tải file XLSX' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    // The download act carries the preview data — and NEVER the save
    // payload: nothing may reach Công nợ from this button.
    expect(downloads[0]).toEqual(PREVIEW);
    expect(saves).toHaveLength(0);
  });

  it('a save/export refusal surfaces verbatim inside the dialog (SIL-971)', async () => {
    renderDialog(true, [ROUND], 'Các lô SHP-2611-00657 đã xuất Debit Note #29. Mỗi lô đã khóa chỉ xuất trong một Debit Note duy nhất.');
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Các lô SHP-2611-00657 đã xuất Debit Note #29');
  });

  it('no đợt for the selection’s customer → the create-đợt guidance replaces the picker options', async () => {
    renderDialog(true, []);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    expect(within(dialog).getByText(/Chưa có đợt chốt \(Lần\/Tháng\/Năm\) cho khách của lựa chọn/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('a preview refusal (lô chưa khóa) surfaces verbatim and keeps the saves disabled', async () => {
    roundPreview.mockRejectedValue(new Error('Đợt còn 1 lô chưa khóa chi phí: SHP-26-0002 — hãy khóa chi phí các lô (Khóa lô / Khóa & xem trước) rồi xem lại bảng xem trước.'));
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Đợt còn 1 lô chưa khóa chi phí');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });
});

// SIL-1094 (KB §3.6.5 K3.87) — cột GHI CHÚ: dòng lô ghép mang chú thích
// "Ghép xe cùng Bill [Số Bill Lô 1]"; lô không ghép để trống (absence is
// not data). The column rides the THU Debit Note table before the money.
describe('DebitNotePreviewDialog — GHI CHÚ chú thích Ghép xe cùng Bill (SIL-1094)', () => {
  it('dòng lô ghép mang "Ghép xe cùng Bill [Số Bill Lô 1]", dòng lô thường để trống', async () => {
    roundPreview.mockResolvedValue({
      ...PREVIEW,
      items: [
        { ...PREVIEW.items[0], mergeNote: 'Ghép xe cùng Bill BL-P' },
        PREVIEW.items[1],
      ],
    });
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));

    const table = await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });
    expect(within(table).getByText('GHI CHÚ')).toBeTruthy();
    const rows = within(table).getAllByRole('row');
    const memberRow = rows.find((row) => row.textContent?.includes('BL-1001'))!;
    expect(memberRow.querySelectorAll('td')[3]!.textContent).toBe('Ghép xe cùng Bill BL-P');
    const plainRow = rows.find((row) => row.textContent?.includes('BL-1002'))!;
    expect(plainRow.querySelectorAll('td')[3]!.textContent).toBe('');
  });
});

// SIL-855 QA fail (build 09069560): the preview footer ignored the đợt's
// recorded VAT (showed 0 ₫ / 7.904.000 ₫ while the đợt row said VAT 8% =
// 632.320 ₫ / 8.536.320 ₫) and rendered '—' BKS for lots whose plate rides
// the ĐV-assigned trip (15H-104.03). The dialog renders the server preview —
// these pins hold the footer to the QA repro's exact four numbers and the
// plate column to 100% coverage, so a regression surfaces in vitest.
describe('DebitNotePreviewDialog QA regression — đợt VAT totals + real BKS', () => {
  const VAT_ROUND: DebitSettlementRoundRow = {
    ...ROUND,
    id: 91,
    periodKey: '2026-11',
    amount: '7904000',
    vatRate: 8,
    vatAmount: 632320,
    totalAmount: 8536320,
  };
  const VAT_PREVIEW = {
    round: { id: 91, roundNo: 1, periodKey: '2026-11', direction: 'THU' as const, vatRate: 8, customerName: 'KH A' },
    items: [
      { shipmentId: 301, billOrBooking: 'BL-2611-00308', customerName: 'Long Minh', billingTruckNo: '15H-104.03', net: 3952000, costLockedAt: '2026-11-18T00:00:00.000Z' },
      { shipmentId: 310, billOrBooking: 'BL-2611-00310', customerName: 'Long Minh', billingTruckNo: '15H-104.03', net: 3952000, costLockedAt: '2026-11-18T00:00:00.000Z' },
    ],
    totals: { net: 7904000, tax: 632320, gross: 8536320 },
  };

  it('the footer carries the đợt VAT (QA numbers) and every row shows its BKS báo khách', async () => {
    roundPreview.mockResolvedValue(VAT_PREVIEW);
    const { saves } = renderDialog(true, [VAT_ROUND]);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-11 · Phải thu' }));

    const table = await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });
    // Both đợt lots render the ĐV-assigned plate — no fabricated '—' — and
    // identify by Số Bill/Booking (SIL-868), never the internal code.
    expect(table).toHaveTextContent('BL-2611-00308');
    expect(table).toHaveTextContent('BL-2611-00310');
    expect(table).not.toHaveTextContent('SHP-');
    expect(within(table).getAllByText('15H-104.03')).toHaveLength(2);
    expect(table).not.toHaveTextContent('—');
    // The four closing totals = the đợt row's recorded VAT math (8%).
    expect(table).toHaveTextContent('7.904.000 ₫');
    expect(table).toHaveTextContent('632.320 ₫');
    expect(table).toHaveTextContent('8.536.320 ₫');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toEqual({
      roundId: 91,
      roundLabel: 'Lần 1 · 2026-11 · Phải thu',
      lotIds: [301, 310],
      totals: { net: 7904000, tax: 632320, gross: 8536320 },
    });
  });
});

// SIL-1092 (K3.86 + K6.32) — a TRA (phải trả nhà xe) đợt is the BẢN KÊ CÔNG
// NỢ NHÀ XE PHẢI TRẢ: its table prints BKS THỰC + loại xe tính cước trả and
// NEVER the BKS báo khách column (the wire carries billingTruckNo null; the
// dialog renders no such column either). The THU table above stays untouched.
describe('DebitNotePreviewDialog bản kê nhàxe (SIL-1092)', () => {
  const TRA_ROUND: DebitSettlementRoundRow = {
    ...ROUND,
    id: 77,
    direction: 'TRA',
    carrierKey: 'CUST:42',
    carrierLabel: 'Nhà xe Long Minh',
    periodKey: '2026-10',
    customerName: 'KH A',
  };
  const TRA_PREVIEW = {
    round: { id: 77, roundNo: 1, periodKey: '2026-10', direction: 'TRA' as const, vatRate: 0, customerName: 'KH A' },
    items: [
      {
        shipmentId: 501, billOrBooking: 'BL-2610-00501', customerName: 'KH A',
        billingTruckNo: null, actualTruckNo: '29H-888.88, 51B-999.99',
        vehicleType: 'Xe tải 9 tấn', net: 1_000_000, costLockedAt: '2026-10-24T00:00:00.000Z',
      },
    ],
    totals: { net: 1_000_000, tax: 0, gross: 1_000_000 },
  };

  it('TRA đợt renders the nhà xe statement: BKS thực + loại xe tính cước trả, no BKS báo khách column', async () => {
    roundPreview.mockResolvedValue(TRA_PREVIEW);
    renderDialog(true, [TRA_ROUND]);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-10 · Phải trả' }));

    const table = await screen.findByRole('region', { name: 'Bảng bản kê công nợ nhà xe phải trả' });
    // The statement names itself + the counterparty nhà xe (the round's
    // carrier label), never the customer-plate column.
    expect(screen.getByText(/Bản kê công nợ nhà xe phải trả/)).toBeTruthy();
    expect(screen.getByText(/nhà xe: Nhà xe Long Minh/)).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'BKS thực' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Loại xe tính cước trả' })).toBeTruthy();
    expect(within(table).queryByRole('columnheader', { name: 'BKS báo khách' })).toBeNull();
    // Row facts: real plates + pricing class; the billing-plate column and
    // any of its values never appear (the header-absence check above is the
    // structural pin; the note line may NAME the law in prose).
    expect(table).toHaveTextContent('29H-888.88, 51B-999.99');
    expect(table).toHaveTextContent('Xe tải 9 tấn');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Lô', 'Khách hàng', 'BKS thực', 'Loại xe tính cước trả', 'Tiền trước thuế',
    ]);
    expect(table).toHaveTextContent('1.000.000 ₫');
  });

  // SIL-1092 (K3.86/K6.32) — the reported bug: đợt THU and đợt TRA of the
  // SAME Lần·kỳ rendered two identical 'Lần 1 · 2026-11' options; the chiều
  // in the label keeps them distinguishable.
  it('dropdown distinguishes a THU and a TRA đợt of the same Lần·kỳ by chiều', async () => {
    const thuRound: DebitSettlementRoundRow = { ...ROUND, id: 201, direction: 'THU', periodKey: '2026-11', roundNo: 1 };
    const traRound: DebitSettlementRoundRow = { ...ROUND, id: 202, direction: 'TRA', carrierKey: 'CUST:42', carrierLabel: 'Nhà xe Long Minh', periodKey: '2026-11', roundNo: 1 };
    renderDialog(true, [thuRound, traRound]);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    // Both same-Lần same-kỳ rounds appear, told apart ONLY by the chiều.
    expect(await screen.findByRole('option', { name: 'Lần 1 · 2026-11 · Phải thu' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Lần 1 · 2026-11 · Phải trả' })).toBeTruthy();
  });
});

// ─── FIN-01 (QA 28/11, đợt Lần 12 · 2026-11 · Phải thu) — the export dialog's
// mismatch alert names only the two aggregates; these pins hold the dialog to
// the line-level variance table under that alert, the reason-gated
// reconciliation for the office trio, and the SAME export gate (Save/XLSX
// unlock ONLY through the preview passing on the reconciled record). ───
describe('DebitNotePreviewDialog — FIN-01 line variance + controlled reconciliation', () => {
  const MISMATCH_ALERT = 'Tổng Debit Note lệch với đợt chốt Lần 1 · 2026-09 (#7): bảng khóa lô cho 3.998.800 + VAT 319.904 = 4.318.704 ₫, đợt đã chốt 4.638.000 + VAT 371.040 = 5.009.040 ₫.';

  function seedMismatch() {
    roundPreview.mockRejectedValue(new Error(MISMATCH_ALERT));
    roundVariance.mockResolvedValue(MISMATCH_VARIANCE);
  }

  it('a mismatched đợt renders the per-line variance table under the alert and keeps the saves disabled', async () => {
    seedMismatch();
    renderDialog(true, [ROUND], null, true);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));

    // The standing block alert stays verbatim (scoped by text: the variance
    // summary below is an alert of its own)…
    expect(await screen.findByText(/bảng khóa lô cho 3.998.800/)).toBeTruthy();
    // …and now the variance region names the DRIFTING LINES (bill / locked /
    // closed / diff / VAT), not just the two aggregates.
    const varianceRegion = await screen.findByRole('region', { name: 'Đối chiếu chênh lệch theo lô' });
    expect(within(varianceRegion).getByText(/chênh lệch -639.200 ₫/)).toBeTruthy();
    expect(within(varianceRegion).getAllByText('BL-2611-A').length).toBeGreaterThan(0);
    expect(within(varianceRegion).getAllByText('BL-2611-B').length).toBeGreaterThan(0);
    // The per-line diffs: -320.200 and -319.000 (integer VN money).
    expect(varianceRegion).toHaveTextContent('-320.200 ₫');
    expect(varianceRegion).toHaveTextContent('-319.000 ₫');
    // VAT column rides the đợt's 8%: 1.998.800 → 159.904.
    expect(varianceRegion).toHaveTextContent('159.904 ₫');
    // Mismatched rows highlighted (a class hook the CSS paints).
    const mismatchedRows = within(varianceRegion).getAllByRole('row').filter((row) => row.className.includes('debit-round-variance__row--mismatch'));
    expect(mismatchedRows).toHaveLength(2);
    // The hard block is intact: no preview → no Save, no XLSX.
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Lưu và tải file XLSX' })).toBeDisabled();
    // The office trio sees the controlled correction act.
    expect(within(varianceRegion).getByRole('button', { name: 'Đối chiếu theo phí đã khóa' })).toBeTruthy();
  });

  it('reconcile runs ONLY through the reason prompt; after it the preview passes and Save/XLSX unlock', async () => {
    seedMismatch();
    // After the reconciled write the gate re-runs: the preview passes on the
    // corrected record and the variance reads back reconciled WITH its trail.
    roundPreview.mockRejectedValueOnce(new Error(MISMATCH_ALERT)).mockResolvedValue({
      ...PREVIEW,
      totals: { net: 3998800, tax: 319904, gross: 4318704 },
    });
    roundVariance.mockResolvedValueOnce(MISMATCH_VARIANCE).mockResolvedValue({
      ...MISMATCH_VARIANCE,
      reconciled: true,
      totals: { exportNet: 3998800, closedTotal: 3998800, varianceNet: 0 },
      items: MISMATCH_VARIANCE.items.map((item) => ({ ...item, closedNet: item.exportNet, diff: 0, mismatch: false, closedVat: item.exportVat })),
      history: [{
        at: '2026-11-28T10:00:00.000Z',
        actorName: 'Kế toán QA',
        reason: 'khớp tổng theo phí đã khóa — lô khóa khi chưa đủ cước',
        beforeAmount: 4638000,
        afterAmount: 3998800,
        varianceNet: -639200,
      }],
    });
    renderDialog(true, [ROUND], null, true);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));
    await screen.findByRole('region', { name: 'Đối chiếu chênh lệch theo lô' });

    fireEvent.click(within(screen.getByRole('region', { name: 'Đối chiếu chênh lệch theo lô' })).getByRole('button', { name: 'Đối chiếu theo phí đã khóa' }));
    // The reason prompt: empty grounds keep Confirm disabled — the reason is
    // mandatory on the FRONT line, the server guard is only the backstop.
    const reasonDialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    const confirm = within(reasonDialog).getByRole('button', { name: 'Đối chiếu' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(reasonDialog).getByLabelText('Lý do đối chiếu (bắt buộc)'), { target: { value: 'khớp tổng theo phí đã khóa — lô khóa khi chưa đủ cước' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    // The act carries the reason verbatim to the server.
    await waitFor(() => expect(reconcileRound).toHaveBeenCalledWith(7, 'khớp tổng theo phí đã khóa — lô khóa khi chưa đủ cước'));
    // The refetched preview passes on the reconciled record → its table
    // renders the AUTHORITATIVE total, and Save/XLSX unlock through the
    // EXISTING gate (still keyed to the preview, never bypassed).
    const table = await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });
    expect(table).toHaveTextContent('4.318.704 ₫');
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Lưu và tải file XLSX' })).toBeEnabled();
    // The variance section is gone (totals agree) and the audit trail shows
    // who/why/old→new — a corrected total is never silent. (Scoped to the
    // history box: the closed prompt's textarea can still hold the same
    // string while its exit animation plays.)
    expect(screen.queryByRole('region', { name: 'Đối chiếu chênh lệch theo lô' })).toBeNull();
    const historyBox = screen.getByText('Nhật ký đối chiếu').parentElement as HTMLElement;
    expect(within(historyBox).getByText(/khớp tổng theo phí đã khóa — lô khóa khi chưa đủ cước/)).toBeTruthy();
    expect(within(historyBox).getByText(/Kế toán QA/)).toBeTruthy();
    expect(historyBox).toHaveTextContent('4.638.000 ₫ → 3.998.800 ₫');
  });

  it('the zero-variance control stays untouched: no variance section, saves enabled', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));
    await screen.findByRole('region', { name: 'Bảng tổng hợp Debit Note' });
    // A reconciled đợt renders nothing extra and refuses nothing.
    expect(screen.queryByRole('region', { name: 'Đối chiếu chênh lệch theo lô' })).toBeNull();
    expect(screen.queryByText('Nhật ký đối chiếu')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Lưu và tải file XLSX' })).toBeEnabled();
  });

  it('without reconciliation clearance the table still explains the block but offers no act', async () => {
    seedMismatch();
    renderDialog(); // canReconcile omitted → non-office viewer
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));
    const varianceRegion = await screen.findByRole('region', { name: 'Đối chiếu chênh lệch theo lô' });
    expect(within(varianceRegion).queryByRole('button', { name: 'Đối chiếu theo phí đã khóa' })).toBeNull();
    expect(within(varianceRegion).getByText(/Chỉ Quản trị \/ Giám đốc \/ Kế toán đối chiếu được/)).toBeTruthy();
  });

  it('a reconcile refusal surfaces verbatim inside the dialog and the block holds', async () => {
    seedMismatch();
    reconcileRound.mockRejectedValue(new Error('Đợt đã phát hành Debit Note #29 — tổng đợt chỉ đối chiếu được trước khi phát hành; hủy chứng từ (có kiểm soát) rồi đối chiếu lại.'));
    renderDialog(true, [ROUND], null, true);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09 · Phải thu' }));
    await screen.findByRole('region', { name: 'Đối chiếu chênh lệch theo lô' });
    fireEvent.click(within(screen.getByRole('region', { name: 'Đối chiếu chênh lệch theo lô' })).getByRole('button', { name: 'Đối chiếu theo phí đã khóa' }));
    const reasonDialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    fireEvent.change(within(reasonDialog).getByLabelText('Lý do đối chiếu (bắt buộc)'), { target: { value: 'thử đối chiếu đợt đã phát hành' } });
    fireEvent.click(within(reasonDialog).getByRole('button', { name: 'Đối chiếu' }));
    // SIL-971 — the refusal reads verbatim INSIDE the dialog, never silent.
    expect(await screen.findByText(/đã phát hành Debit Note #29/)).toBeTruthy();
    // The block holds: variance section still there, saves still disabled.
    expect(screen.getByRole('region', { name: 'Đối chiếu chênh lệch theo lô' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });
});
