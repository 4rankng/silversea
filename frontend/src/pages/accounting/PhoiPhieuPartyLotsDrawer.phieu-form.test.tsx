import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getPhoiPhieuPartyLots: vi.fn(), listPhoiPhieuStk: vi.fn(), createPhoiPhieuVoucher: vi.fn() }));
vi.mock('../../api/phoiPhieuClient', () => ({
  getPhoiPhieuPartyLots: api.getPhoiPhieuPartyLots,
  listPhoiPhieuStk: api.listPhoiPhieuStk,
  createPhoiPhieuVoucher: api.createPhoiPhieuVoucher,
}));

import { PhoiPhieuPartyLotsDrawer } from './PhoiPhieuPartyLotsDrawer';
import type { PhoiPhieuPartyLot } from '../../api/phoiPhieuClient';

const lot: PhoiPhieuPartyLot = {
  tripId: 7,
  shipmentId: 3,
  billOrBooking: 'MATS7539769000',
  containerNumber: 'AXEU2141373',
  plateNumber: null,
  departureDate: '2026-11-20',
  tienNang: 1000000,
  tienHa: 2000000,
  psKhac: 0,
  total: 3000000,
  daThuTra: 0,
  conLai: 3000000,
  party: 'Vận tải',
  ghiChu: 'giao cont sáng',
  entries: [
    { sourceId: 91, expectedVersion: 1, amount: 1000000, bucket: 'nang' },
    { sourceId: 92, expectedVersion: 2, amount: 2000000, bucket: 'ha' },
  ],
};

function renderDrawer() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PhoiPhieuPartyLotsDrawer kind="THU" party="Vận tải" dateFrom="2026-11-01" dateTo="2026-11-30" onClose={() => {}} onIssued={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.getPhoiPhieuPartyLots.mockReset().mockResolvedValue({ items: [lot] });
  api.listPhoiPhieuStk.mockReset().mockResolvedValue({ items: [{ id: 5, code: 'ACB', name: 'TK công ty ACB' }] });
  api.createPhoiPhieuVoucher.mockReset().mockResolvedValue({ voucherId: 1, code: 'PT-1', total: 3000000, entries: 1 });
});

describe('SIL-1030 (K6.13) — bấm dòng bill chọn lô và hiện ô lập phiếu', () => {
  it('bấm vào dòng bill chọn được lô: đếm tăng và khu ô lập phiếu hiện ra', async () => {
    renderDrawer();
    await screen.findByText('MATS7539769000');
    expect(screen.getByRole('status')).toHaveTextContent('Chưa chọn lô nào');
    expect(screen.queryByRole('region', { name: 'Ô lập phiếu' })).toBeNull();

    // QA repro: click the BILL ROW — the lot must select (count up) and the
    // voucher-entry area must appear.
    fireEvent.click(screen.getByText('MATS7539769000'));

    expect(screen.getByRole('status')).toHaveTextContent('Đã chọn 1 lô');
    expect(screen.getByRole('region', { name: 'Ô lập phiếu' })).toBeInTheDocument();
  });

  it('khu ô lập phiếu mang đủ trường của KB §6.2: ngày chi, tài khoản chi, STT · nhà xe · chi phí · số container · số tiền · tổng tiền · ghi chú, và nút xác nhận', async () => {
    renderDrawer();
    await screen.findByText('MATS7539769000');
    fireEvent.click(screen.getByText('MATS7539769000'));

    const form = screen.getByRole('region', { name: 'Ô lập phiếu' });
    expect(within(form).getByLabelText(/Ngày chi/)).toBeInTheDocument();
    expect(within(form).getByText('Tổng thanh toán')).toBeInTheDocument();
    for (const label of ['STT', 'Nhà xe', 'Chi phí', 'Số container', 'Số tiền', 'Tổng tiền', 'Ghi chú']) {
      expect(within(form).getByRole('columnheader', { name: label })).toBeTruthy();
    }
    // The entry lines: one per open fee bucket of the selected lot.
    expect(within(form).getByText('Nâng hàng')).toBeInTheDocument();
    expect(within(form).getByText('Hạ hàng')).toBeInTheDocument();
    expect(within(form).getByText('1.000.000')).toBeInTheDocument();
    expect(within(form).getByText('2.000.000')).toBeInTheDocument();
    // "tài khoản chi" is the STK picker's name (KB §6.2 "tài khoản chi").
    expect(screen.getByRole('button', { name: /Tài khoản chi/ })).toBeInTheDocument();
    // "xác nhận" is the issue action's name.
    expect(screen.getByRole('button', { name: /Xác nhận/ })).toBeInTheDocument();
  });

  it('ngày chi của ô lập phiếu đi theo phiếu khi bấm xác nhận', async () => {
    renderDrawer();
    await screen.findByText('MATS7539769000');
    fireEvent.click(screen.getByText('MATS7539769000'));
    fireEvent.change(screen.getByLabelText(/Ngày chi/), { target: { value: '25/11/2026' } });
    fireEvent.blur(screen.getByLabelText(/Ngày chi/));
    fireEvent.click(screen.getByRole('button', { name: /Tài khoản chi/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'ACB - TK công ty ACB' }));
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận/ }));
    await screen.findByText(/Đã lập phiếu PT-1/);
    expect(api.createPhoiPhieuVoucher).toHaveBeenCalledWith({
      tripIds: [7],
      direction: 'IN',
      treasuryAccountId: 5,
      valueDate: '2026-11-25',
    });
  });

  // Round-27 FAIL build 55c063cc — the repro bills (MATS7539769000,
  // YMJAI226573788) are the SHARED lots (no single live trip, SIL-729): the
  // previous fix toggled only the trip ladder, so clicking those rows stayed
  // dead. Pin: the shared lot's bill row selects, a second row accumulates,
  // and the phiếu carries shipmentIds beside tripIds.
  it('bấm dòng bill của lô phí chung (không chuyến) chọn được lô, bấm dòng khác cộng tiếp, phiếu kèm shipmentIds', async () => {
    const sharedLot: PhoiPhieuPartyLot = {
      tripId: null,
      shipmentId: 42,
      billOrBooking: 'YMJAI226573788',
      containerNumber: null,
      plateNumber: null,
      departureDate: null,
      tienNang: 0,
      tienHa: 0,
      psKhac: 4500000,
      total: 4500000,
      daThuTra: 0,
      conLai: 4500000,
      party: 'Vận tải',
      ghiChu: null,
      entries: [{ sourceId: 201, expectedVersion: 4, amount: 4500000, bucket: 'khac' }],
    };
    api.getPhoiPhieuPartyLots.mockResolvedValue({ items: [lot, sharedLot] });
    renderDrawer();
    await screen.findByText('MATS7539769000');
    expect(screen.getByRole('status')).toHaveTextContent('Chưa chọn lô nào');

    fireEvent.click(screen.getByText('MATS7539769000'));
    expect(screen.getByRole('status')).toHaveTextContent('Đã chọn 1 lô');
    // The shared lot's row is bill-clickable too — the round-27 repro path.
    fireEvent.click(screen.getByText('YMJAI226573788'));
    expect(screen.getByRole('status')).toHaveTextContent('Đã chọn 2 lô');

    // The phiếu form shows the shared lot's open fee line and the combined total.
    const form = screen.getByRole('region', { name: 'Ô lập phiếu' });
    expect(within(form).getByText('Phát sinh khác')).toBeInTheDocument();
    // The fee line prints the amount; the group's subtotal repeats it.
    expect(within(form).getAllByText('4.500.000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Tổng thanh toán').closest('p')).toHaveTextContent('7.500.000');

    fireEvent.click(screen.getByRole('button', { name: /Tài khoản chi/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'ACB - TK công ty ACB' }));
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận lập phiếu thu \(2\)/ }));
    await screen.findByText(/Đã lập phiếu PT-1/);
    expect(api.createPhoiPhieuVoucher).toHaveBeenCalledWith(expect.objectContaining({
      tripIds: [7],
      shipmentIds: [42],
    }));
  });
});
