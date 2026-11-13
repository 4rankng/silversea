// SIL-805 — Bảng Kiểm soát lô hàng (/accounting/chot-debit, cả tab FCL +
// LCL): kế toán sửa TRỰC TIẾP 8 ô giá/chi phí trên dòng khi lô chưa khóa
// sổ; Lợi nhuận (server tính lại từ các ô ghi đè) cập nhật NGAY sau Lưu,
// không cần tải lại trang. Hàng đã khóa giữ mặt text — không còn ô nhập.
// The merge arithmetic itself is unit-tested server-side
// (debit-board-rate-overrides.test.ts); here the board reads the wire.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, setRateOverrides, getBootstrap } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  setRateOverrides: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: vi.fn(),
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: setRateOverrides,
  reconcileAndHideDebitLots: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
}));
vi.mock('../../api/dispatchPlanningClient', () => ({
  updateLclTruck: vi.fn(),
  mergeLclRevGroup: vi.fn(),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));

import AccountingDebitClosePage from './AccountingDebitClosePage';
import { ToastProvider } from '../../components/shared/Toast';
import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/chot-debit']}>
      <ToastProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AccountingDebitClosePage />
        </QueryClientProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-09',
  billOrBooking: 'BL-1',
  containers: ['ABCZ1234567 · 40HC'],
  phanXe: ['Nhà xe A'],
  thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' },
  tra: { cuocTraDv: '400000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '480000', phiRu: '150000' },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '1310000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

const RATE_LABELS = [
  'Cước thu lô BL-1',
  'Lạch Huyện lô BL-1',
  'Phụ PS lô BL-1',
  'Phát sinh (CUS) lô BL-1',
  'Cước trả ĐV lô BL-1',
  'Lạch Huyện ĐV lô BL-1',
  'Phát sinh ĐV lô BL-1',
  'Phí RU lô BL-1',
];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listBoard.mockResolvedValue({ items: [row()], total: 1 });
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});
afterEach(() => vi.clearAllMocks());

describe('AccountingDebitClosePage — SIL-805 inline-edit 8 ô giá/chi phí', () => {
  it('lô chưa khóa: cả 8 ô giá/chi phí là ô nhập trên dòng', async () => {
    renderPage();
    for (const label of RATE_LABELS) {
      expect(await screen.findByRole('textbox', { name: label }), label).toBeInTheDocument();
    }
  });

  it('gõ giá mới rồi blur → lưu đúng lô + đúng ô (number nguyên VND)', async () => {
    setRateOverrides.mockResolvedValue({ shipmentId: 1, rates: { cuocThu: 1200000 } });
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Cước thu lô BL-1' });
    fireEvent.change(input, { target: { value: '1200000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setRateOverrides.mock.calls[0]?.[0])
      .toEqual({ shipmentId: 1, rates: { cuocThu: 1200000 } }));
  });

  it('ô chi phí trả ĐV cũng lưu được (tra side)', async () => {
    setRateOverrides.mockResolvedValue({ shipmentId: 1, rates: { cuocTraDv: 350000 } });
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Cước trả ĐV lô BL-1' });
    fireEvent.change(input, { target: { value: '350000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setRateOverrides.mock.calls[0]?.[0])
      .toEqual({ shipmentId: 1, rates: { cuocTraDv: 350000 } }));
  });

  it('gõ lại đúng giá trị đang áp dụng → blur KHÔNG gửi', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Cước thu lô BL-1' });
    fireEvent.change(input, { target: { value: '1000000' } });
    fireEvent.blur(input);
    expect(setRateOverrides).not.toHaveBeenCalled();
  });

  it('lô ĐÃ khóa sổ: 8 ô thành text định dạng, không còn ô nhập', async () => {
    listBoard.mockResolvedValue({ items: [row({ costLockedAt: '2026-11-12T00:00:00.000Z' })], total: 1 });
    renderPage();
    await screen.findByRole('columnheader', { name: 'Cước phải thu' });
    for (const label of RATE_LABELS) {
      expect(screen.queryByRole('textbox', { name: label }), label).not.toBeInTheDocument();
    }
    expect(screen.getByText('1.000.000 ₫')).toBeInTheDocument();
    expect(setRateOverrides).not.toHaveBeenCalled();
  });

  it('Lợi nhuận cập nhật NGAY sau Lưu (refetch, không cần tải lại trang)', async () => {
    setRateOverrides.mockResolvedValue({ shipmentId: 1, rates: { cuocThu: 1000000 } });
    renderPage();
    expect(await screen.findByText('1.310.000 ₫')).toBeInTheDocument();
    // The saved row's new figures arrive on the refetch the save triggers.
    listBoard.mockResolvedValue({
      items: [row({ thu: { cuocThu: '1000000', lachHuyen: '90000', phuPs: '200000', phatSinhCus: '500000', tongThu: '1790000' }, tra: { cuocTraDv: '2500000', lachHuyenDv: '50000', phatSinhDv: '30000', tong1: '2580000', phiRu: '150000' }, loiNhuan: '-790000' })],
      total: 1,
    });
    const input = await screen.findByRole('textbox', { name: 'Cước trả ĐV lô BL-1' });
    fireEvent.change(input, { target: { value: '2500000' } });
    fireEvent.blur(input);
    const negative = await screen.findByText('-790.000 ₫');
    expect(negative).toHaveClass('debit-loinhuan--negative'); // < 0 → nền đỏ đậm, chữ trắng
    await waitFor(() => expect(listBoard.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('tab LCL: cùng 8 ô sửa trực tiếp trên dòng hàng lẻ', async () => {
    listBoard.mockResolvedValue({
      items: [row({ shipmentId: 2, billOrBooking: 'BL-2', lcl: { label: 'Lẻ', actualTruckNo: '29A-123.45', billingTruckNo: null, ghépCùngRef: null, revGroupId: null, costGroupId: null } })],
      total: 1,
    });
    setRateOverrides.mockResolvedValue({ shipmentId: 2, rates: { cuocThu: 900000 } });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Vận tải Hàng Lẻ \(LCL\)/ }));
    const input = await screen.findByRole('textbox', { name: 'Cước thu lô BL-2' });
    fireEvent.change(input, { target: { value: '900000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setRateOverrides.mock.calls[0]?.[0])
      .toEqual({ shipmentId: 2, rates: { cuocThu: 900000 } }));
  });
});
