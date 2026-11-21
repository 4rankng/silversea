/**
 * Ticket 18/11 Task 2.4 (SIL-855) — the Debit Note preview dialog's own laws:
 * - no đợt picked → the save buttons stay disabled and the dialog says why
 *   (chưa chọn đợt thì chưa thể lưu — the money gate of the chốt law);
 * - a picked đợt pulls the round's FULL lot set from the server preview and
 *   renders 100% BKS báo khách per row (the issued-line plate law) and the
 *   four closing totals as integer VN money;
 * - a preview refusal (e.g. đợt còn lô chưa khóa chi phí) surfaces verbatim.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { roundPreview } = vi.hoisted(() => ({ roundPreview: vi.fn() }));

vi.mock('../../api/accountingDebitClient', () => ({
  getDebitNoteRoundPreview: roundPreview,
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));

import { DebitNotePreviewDialog, type DebitNoteSavePayload } from './DebitNotePreviewDialog';
import type { DebitSettlementRoundRow } from '../../api/accountingDebitClient';

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

function renderDialog(open = true, rounds: DebitSettlementRoundRow[] = [ROUND]) {
  const saves: DebitNoteSavePayload[] = [];
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DebitNotePreviewDialog
        open={open}
        customerIds={[11]}
        rounds={rounds}
        busy={false}
        onSaveOnly={(payload) => saves.push(payload)}
        onSaveAndDownload={(payload) => saves.push({ ...payload, roundLabel: `${payload.roundLabel}+download` })}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
  return saves;
}

beforeEach(() => {
  vi.clearAllMocks();
  roundPreview.mockResolvedValue(PREVIEW);
});

describe('DebitNotePreviewDialog (SIL-855)', () => {
  it('without a đợt the saves stay disabled and the dialog says why', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    expect(roundPreview).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/Chọn đợt chốt để gom toàn bộ lô của đợt/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Lưu' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Lưu và tải file XLSX' })).toBeDisabled();
  });

  it('a picked đợt pulls its full lot set: 100% BKS báo khách + 4 integer totals, saves carry (roundId, lots, totals)', async () => {
    const saves = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09' }));

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
      roundLabel: 'Lần 1 · 2026-09',
      lotIds: [1, 2],
      totals: { net: 3580000, tax: 0, gross: 3580000 },
    });
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
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-09' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Đợt còn 1 lô chưa khóa chi phí');
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
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
    const saves = renderDialog(true, [VAT_ROUND]);
    const dialog = await screen.findByRole('dialog', { name: 'Xem trước Debit Note' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Đợt chốt \(Lần · Tháng · Năm\)/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Lần 1 · 2026-11' }));

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
      roundLabel: 'Lần 1 · 2026-11',
      lotIds: [301, 310],
      totals: { net: 7904000, tax: 632320, gross: 8536320 },
    });
  });
});
