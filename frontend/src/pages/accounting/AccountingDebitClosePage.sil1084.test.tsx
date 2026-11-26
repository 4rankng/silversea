// K2.23 (SIL-1084) — sửa ô Cước thu trên Kiểm soát lô hàng:
//   (1) giá tự tính/hợp đồng hiện CẠNH ô nhập để kế toán đối chiếu (kèm
//       nhãn công thức nếu có — tooltip);
//   (2) giá nhập tay LỆCH giá tự tính → hộp hỏi lý do BẮT BUỘC trước khi
//       lưu (lô chưa có giá tự tính — R3K-J1 — cũng là lệch: mọi số gõ tay
//       là một độ lệch khỏi "Chưa xác định"); lý do đi cùng wire vào audit
//       DEBIT_RATE_OVERRIDE_SET;
//   (3) nhập ĐÚNG giá tự tính thì không hỏi (không tạo hiệu ứng thứ hai);
//   (4) wire cũ không có cuocThuAuto (undefined) giữ nguyên đường lưu
//       SIL-805 — không hộp, không reason.
// Manual override GIỮ quyền thắng — chỉ thêm lý do + đối chiếu; logic tính
// J = I × (1 + % chia sẻ) của SIL-1074 không đụng (BE-only, unit pin tại
// backend/src/tests/unit/sil1084-debit-rate-reason.test.ts).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  thu: { cuocThu: '3952000', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '3952000' },
  tra: { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, tong1: null, phiRu: null },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: '3952000',
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

const CUOC_THU = 'Cước thu lô BL-1';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listBoard.mockResolvedValue({ items: [row({ cuocThuAuto: '3952000', cuocThuAutoFormula: '3.900.000 × 1,02' })], total: 1 });
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
  setRateOverrides.mockResolvedValue({ shipmentId: 1, containerId: null, rates: { cuocThu: 4100000 } });
});
afterEach(() => vi.clearAllMocks());

describe('AccountingDebitClosePage — K2.23 sửa cước thu hỏi lý do, hiện giá hợp đồng (SIL-1084)', () => {
  it('giá tự tính/hợp đồng hiện cạnh ô nhập, nhãn công thức lên tooltip', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: CUOC_THU });
    const anchor = input.parentElement!.querySelector('.debit-line__auto')!;
    expect(anchor.textContent).toBe('HĐ: 3.952.000 ₫');
    expect(anchor.getAttribute('title')).toBe('Giá tự tính/hợp đồng: 3.952.000 ₫ — 3.900.000 × 1,02');
  });

  it('giá lệch hợp đồng → hộp lý do bắt buộc; Lưu mở sau khi gõ lý do; wire mang reason', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: CUOC_THU });
    fireEvent.change(input, { target: { value: '4100000' } });
    fireEvent.blur(input);

    const dialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    expect(within(dialog).getByText(/khác giá tự tính/)).toBeTruthy();
    expect(within(dialog).getByText(/giá tự tính\/hợp đồng: 3\.952\.000 ₫/)).toBeTruthy();
    expect(within(dialog).getByText(/số nhập: 4\.100\.000 ₫/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Lưu' }) as HTMLButtonElement;
    expect(confirm).toBeDisabled();
    const field = within(dialog).getByLabelText('Lý do điều chỉnh cước (bắt buộc)');
    fireEvent.change(field, { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(field, { target: { value: '  đàm phán lại giá cuối với chủ hàng  ' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(setRateOverrides).toHaveBeenCalledTimes(1));
    expect(setRateOverrides.mock.calls[0]![0]).toEqual({
      shipmentId: 1, containerId: null, rates: { cuocThu: 4100000 },
      reason: 'đàm phán lại giá cuối với chủ hàng',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nhập lý do' })).not.toBeInTheDocument());
  });

  it('hủy hộp lý do thì không gửi gì — ô giữ nguyên trạng thái', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: CUOC_THU });
    fireEvent.change(input, { target: { value: '4100000' } });
    fireEvent.blur(input);
    const dialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nhập lý do' })).not.toBeInTheDocument());
    expect(setRateOverrides).not.toHaveBeenCalled();
  });

  it('lô chưa có giá tự tính (null — R3K-J1) thì mọi số gõ tay cũng được hỏi lý do', async () => {
    listBoard.mockResolvedValue({ items: [row({ thu: { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null }, loiNhuan: null, cuocThuAuto: null, cuocThuAutoFormula: null })], total: 1 });
    setRateOverrides.mockResolvedValue({ shipmentId: 1, containerId: null, rates: { cuocThu: 4000000 } });
    renderPage();
    const input = await screen.findByRole('textbox', { name: CUOC_THU });
    // Ô chưa xác định giữ mặt trống (SIL-814) — không dòng HĐ bịa số.
    expect(input.parentElement!.querySelector('.debit-line__auto')).toBeNull();
    fireEvent.change(input, { target: { value: '4000000' } });
    fireEvent.blur(input);
    const dialog = await screen.findByRole('dialog', { name: 'Nhập lý do' });
    expect(within(dialog).getByText(/lô chưa có giá tự tính — Chưa xác định/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Lý do điều chỉnh cước (bắt buộc)'), { target: { value: 'khách báo giá trực tiếp' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(setRateOverrides).toHaveBeenCalledTimes(1));
    expect(setRateOverrides.mock.calls[0]![0]).toEqual({
      shipmentId: 1, containerId: null, rates: { cuocThu: 4000000 },
      reason: 'khách báo giá trực tiếp',
    });
  });

  it('nhập ĐÚNG giá tự tính thì không hỏi, không gửi (không hiệu ứng thứ hai)', async () => {
    renderPage();
    const input = await screen.findByRole('textbox', { name: CUOC_THU });
    fireEvent.change(input, { target: { value: '3952000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nhập lý do' })).not.toBeInTheDocument());
    expect(setRateOverrides).not.toHaveBeenCalled();
  });

  it('wire cũ (không có cuocThuAuto) giữ đường lưu SIL-805 — không hộp, không reason', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    const input = await screen.findByRole('textbox', { name: CUOC_THU });
    expect(input.parentElement!.querySelector('.debit-line__auto')).toBeNull();
    fireEvent.change(input, { target: { value: '1200000' } });
    fireEvent.blur(input);
    await waitFor(() => expect(setRateOverrides).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Nhập lý do' })).toBeNull();
    expect(setRateOverrides.mock.calls[0]![0]).toEqual({ shipmentId: 1, containerId: null, rates: { cuocThu: 1200000 } });
  });
});
