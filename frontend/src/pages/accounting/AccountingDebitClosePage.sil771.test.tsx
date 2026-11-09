// SIL-771 — Bảng Kiểm soát lô hàng: cột 'Chi phí ngoài' (kế toán nhập được)
// và công thức lợi nhuận = Tổng thu − Tổng trả − Chi phí ngoài, giữ quy tắc
// cảnh báo lợi nhuận âm → ô nền đỏ đậm. The arithmetic itself is unit-tested
// server-side (debit-board-profit.test.ts); here the board reads the wire.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, setExternalCost, getBootstrap } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  setExternalCost: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  sendRateAdjustmentRequests: vi.fn(),
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: setExternalCost,
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
  loiNhuan: '1310000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listBoard.mockResolvedValue({ items: [row()], total: 1 });
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});
afterEach(() => vi.clearAllMocks());

describe('AccountingDebitClosePage — SIL-771 Chi phí ngoài + Lợi nhuận', () => {
  it('cột Chi phí ngoài hiển thị ô nhập với giá trị đã lưu', async () => {
    listBoard.mockResolvedValue({ items: [row({ chiPhiNgoai: '50000' })], total: 1 });
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    expect(input).toHaveValue('50000');
  });

  it('gõ số rồi blur → lưu đúng shipmentId + giá trị nguyên VND', async () => {
    setExternalCost.mockResolvedValue({ shipmentId: 1, chiPhiNgoai: '75000' });
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    fireEvent.change(input, { target: { value: '75000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setExternalCost.mock.calls[0]?.[0]).toEqual({ shipmentId: 1, chiPhiNgoai: 75000 }));
  });

  it('xoá trắng rồi blur → lưu null (chưa nhập, công thức đóng góp 0)', async () => {
    listBoard.mockResolvedValue({ items: [row({ chiPhiNgoai: '50000' })], total: 1 });
    setExternalCost.mockResolvedValue({ shipmentId: 1, chiPhiNgoai: null });
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setExternalCost.mock.calls[0]?.[0]).toEqual({ shipmentId: 1, chiPhiNgoai: null }));
  });

  it('draft chưa đổi thì blur không gọi lưu', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    fireEvent.blur(input);
    expect(setExternalCost).not.toHaveBeenCalled();
  });

  it('Lợi nhuận đọc đúng công thức từ dây: 1.790.000 − 480.000 − 50.000 = 1.260.000 ₫', async () => {
    listBoard.mockResolvedValue({ items: [row({ chiPhiNgoai: '50000', loiNhuan: '1260000' })], total: 1 });
    const { container } = renderPage();
    await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    const cell = container.querySelector('.debit-loinhuan:not(.debit-loinhuan--negative)');
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toBe('1.260.000 ₫');
  });

  it('Lợi nhuận âm bôi nền đỏ đậm (class cảnh báo, chữ vẫn đọc được)', async () => {
    listBoard.mockResolvedValue({ items: [row({ loiNhuan: '-430000' })], total: 1 });
    const { container } = renderPage();
    await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    const negative = container.querySelector('.debit-loinhuan--negative');
    expect(negative).not.toBeNull();
    expect(negative?.textContent).toContain('430.000');
    expect(container.querySelector('.debit-loinhuan:not(.debit-loinhuan--negative)')).toBeNull();
  });

  it('chưa đủ Tổng thu/Tổng trả → vẫn "Thiếu lợi nhuận" (chi phí ngoài null không đủ điều kiện tính)', async () => {
    listBoard.mockResolvedValue({
      items: [row({ thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null }, loiNhuan: null })],
      total: 1,
    });
    renderPage();
    await screen.findByRole('textbox', { name: 'Chi phí ngoài lô BL-1' });
    expect(await screen.findByText('Thiếu lợi nhuận')).toBeVisible();
  });
});
