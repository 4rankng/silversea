// SIL-1099 (K2.113) — the phiếu drill-down's "Ô lập phiếu" carries an editable
// Số tiền per line (default = the source's full open remainder, capped at it), so
// collecting PART of a khoản is a choice, not impossible. Edited lines ride to the
// engine as amountBySourceId; untouched lines keep the full-remaining default.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PhoiPhieuPartyLotsDrawer } from './PhoiPhieuPartyLotsDrawer';
import { createPhoiPhieuVoucher } from '../../api/phoiPhieuClient';

vi.mock('../../api/phoiPhieuClient', () => ({
  createPhoiPhieuVoucher: vi.fn().mockResolvedValue({ voucherId: 1, code: 'PT-2611-9001', total: 70000, entries: 1 }),
  getPhoiPhieuPartyLots: vi.fn().mockResolvedValue({
    items: [{
      tripId: 574, shipmentId: null, billOrBooking: 'R3B-BILL02', containerNumber: 'TCLU1234567',
      plateNumber: null, party: 'Long Minh', ghiChu: null, departureDate: '2026-11-10',
      tienNang: 500000, tienHa: 0, psKhac: 0, total: 500000, daThuTra: 0, conLai: 500000,
      entries: [{ sourceId: 101, amount: 500000, bucket: 'nang' as const }],
      // SIL-1085 (K2.71a) — the khoản the phiếu leaves out (chưa đối chiếu).
      excluded: [
        { sourceId: 201, feeName: 'Phí nâng chờ hóa đơn', amount: 250000 },
        { sourceId: 202, feeName: 'Phí hạ chờ đối chiếu', amount: 120000 },
      ],
    }],
  }),
  listPhoiPhieuStk: vi.fn().mockResolvedValue({ items: [{ id: 7, code: 'STK-001', name: 'STK quỹ tiền mặt' }] }),
}));

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhoiPhieuPartyLotsDrawer kind="THU" party={null} dateFrom="2026-11-01" dateTo="2026-11-30" onClose={() => {}} onIssued={() => {}} />
    </QueryClientProvider>,
  );
}

async function openPhieuPreview() {
  await screen.findByText('R3B-BILL02');
  fireEvent.click(screen.getByRole('button', { name: 'Chọn lô R3B-BILL02' }));
  await screen.findByLabelText('Ô lập phiếu');
  // UuiSelectField = react-aria trigger + portalled listbox (no native <select>).
  const trigger = screen.queryByRole('button', { name: 'Tài khoản chi (STK)' })
    ?? screen.getByRole('combobox', { name: 'Tài khoản chi (STK)' });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: /STK quỹ tiền mặt/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SIL-1099 — phiếu thu chọn được số tiền thu một phần (FE)', () => {
  it('ô Số tiền mặc định bằng phần còn lại và gửi đủ khi không sửa', async () => {
    renderDrawer();
    await openPhieuPreview();
    const input = screen.getByLabelText('Số tiền · Nâng hàng') as HTMLInputElement;
    expect(input.value.replace(/\D/g, '')).toBe('500000');
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu/ }));
    await waitFor(() => expect(createPhoiPhieuVoucher).toHaveBeenCalledTimes(1));
    expect(createPhoiPhieuVoucher).toHaveBeenCalledWith(expect.objectContaining({
      tripIds: [574],
      direction: 'IN',
      treasuryAccountId: 7,
    }));
  });

  it('sửa Số tiền xuống một phần → phiếu gửi amountBySourceId đúng khoản', async () => {
    renderDrawer();
    await openPhieuPreview();
    const input = screen.getByLabelText('Số tiền · Nâng hàng') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '200000' } });
    fireEvent.blur(input);
    await waitFor(() => expect((screen.getByLabelText('Số tiền · Nâng hàng') as HTMLInputElement).value.replace(/\D/g, '')).toBe('200000'));
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu/ }));
    await waitFor(() => expect(createPhoiPhieuVoucher).toHaveBeenCalledTimes(1));
    expect(createPhoiPhieuVoucher).toHaveBeenCalledWith(expect.objectContaining({
      amountBySourceId: { '101': 200000 },
    }));
  });

  it('số tiền vượt phần còn lại bị chặn tại UI, không gửi phiếu', async () => {
    renderDrawer();
    await openPhieuPreview();
    const input = screen.getByLabelText('Số tiền · Nâng hàng') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '900000' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu/ }));
    await waitFor(() => expect(screen.getByText(/Số tiền từng khoản phải lớn hơn 0 và không vượt phần còn lại/)).toBeTruthy());
    expect(createPhoiPhieuVoucher).not.toHaveBeenCalled();
  });

  // SIL-1085 (K2.71a) — khoản chưa đối chiếu bị loại phải được GỌI TÊN (tên
  // phí + số tiền) trước khi lưu và trong phần phản hồi, không im lặng.
  it('gọi tên từng khoản chưa đối chiếu bị loại — trong ô lập phiếu và phản hồi', async () => {
    renderDrawer();
    await openPhieuPreview();

    // The phiếu form names each dropped khoản by fee + amount BEFORE any confirm.
    const block = screen.getByRole('note', { name: 'Khoản bị loại khỏi phiếu' });
    expect(within(block).getByText('Bị loại khỏi phiếu — chưa đối chiếu (2 khoản)')).toBeInTheDocument();
    expect(within(block).getByText('Phí nâng chờ hóa đơn — 250.000 ₫')).toBeInTheDocument();
    expect(within(block).getByText('Phí hạ chờ đối chiếu — 120.000 ₫')).toBeInTheDocument();
    // Dropped money carries no Số tiền control — it is not bookable.
    expect(within(block).queryByLabelText(/Số tiền/)).toBeNull();
    // And it never rides the phiếu total: Tổng thanh toán stays the bookable 500.000.
    expect(screen.getByText('Tổng thanh toán').closest('p')).toHaveTextContent(': 500.000 ₫');

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu/ }));
    await waitFor(() => expect(createPhoiPhieuVoucher).toHaveBeenCalledTimes(1));
    // The response names the dropped khoản too, by fee.
    expect(await screen.findByText(/Bỏ qua 2 khoản chưa đối chiếu: Phí nâng chờ hóa đơn, Phí hạ chờ đối chiếu\./)).toBeTruthy();
  });
});
