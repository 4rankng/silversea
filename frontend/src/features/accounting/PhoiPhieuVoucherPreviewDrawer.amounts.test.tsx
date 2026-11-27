// SIL-1099 (K2.113 §2.2.8.4) — the board's "Lập phiếu thu" confirm step (this
// preview drawer) carries an editable "Số tiền thu lần này" per line, default
// = the khoản's open remainder, with the "Còn lại" figure beside it (thu một
// phần, giữ phần còn lại). Edited lines ride to the engine as amountBySourceId
// keyed in the engine's own id space; untouched lines keep the full-remaining
// default. This is the dialog the QA repro named ("hộp chỉ text tĩnh").
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PhoiPhieuVoucherPreviewDrawer } from './PhoiPhieuVoucherPreviewDrawer';
import { createPhoiPhieuVoucher } from '../../api/phoiPhieuClient';
import type { PhoiPhieuRow } from '../../api/phoiPhieuClient';

vi.mock('../../api/phoiPhieuClient', () => ({
  createPhoiPhieuVoucher: vi.fn().mockResolvedValue({ voucherId: 1, code: 'PT-2611-9001', total: 50000, entries: 1 }),
}));

const row = {
  tripId: 204,
  tripCode: 'TRP-204',
  billOrBooking: 'EBK18452303',
  voucherSources: {
    IN: [{
      sourceId: 55,
      entryId: 101,
      sourceKind: 'OPS',
      feeName: 'Phát sinh khác',
      invoiceNumber: null,
      confirmed: true,
      amount: 105000,
      included: true,
      reason: null,
    }],
    OUT: [],
  },
} as unknown as PhoiPhieuRow;

function renderDrawer() {
  return render(
    <PhoiPhieuVoucherPreviewDrawer
      direction="IN"
      rows={[row]}
      treasuryAccountId="7"
      stkAccounts={[{ id: 7, code: 'ACB', name: 'TK công ty' }]}
      onTreasuryAccountChange={() => {}}
      onClose={() => {}}
      onIssued={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SIL-1099 — hộp xem trước phiếu thu nhập được số tiền thu một phần (FE)', () => {
  it('ô Số tiền từng dòng mặc định bằng số còn mở, kèm cột Còn lại', () => {
    renderDrawer();
    const input = screen.getByLabelText('Số tiền · Phát sinh khác') as HTMLInputElement;
    expect(input.value.replace(/\D/g, '')).toBe('105000');
    const rowEl = input.closest('tr')!;
    expect(within(rowEl).getByText('0 ₫')).toBeTruthy();
  });

  it('thu một phần: Còn lại bám theo ô nhập và phiếu gửi amountBySourceId đúng id của engine', async () => {
    renderDrawer();
    const input = screen.getByLabelText('Số tiền · Phát sinh khác') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50000' } });
    const rowEl = input.closest('tr')!;
    expect(within(rowEl).getByText('55.000 ₫')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu/ }));
    await waitFor(() => expect(createPhoiPhieuVoucher).toHaveBeenCalledTimes(1));
    expect(createPhoiPhieuVoucher).toHaveBeenCalledWith(expect.objectContaining({
      tripIds: [204],
      amountBySourceId: { '101': 50000 },
    }));
  });

  it('số tiền thu không vượt phần còn lại — chặn tại hộp, không gọi API', async () => {
    renderDrawer();
    const input = screen.getByLabelText('Số tiền · Phát sinh khác') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '200000' } });
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu/ }));
    await waitFor(() => expect(screen.getByText(/Số tiền từng khoản phải lớn hơn 0 và không vượt phần còn lại/)).toBeTruthy());
    expect(createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });
});
