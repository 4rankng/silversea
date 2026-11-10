// SIL-773 Rev2 — nút 'Lưu & Xác nhận đối soát' (nhãn khách yêu cầu nguyên
// văn): lưu các dòng đã chọn rồi ẩn khỏi danh sách tác nghiệp; công tắc
// 'Hiện dòng đã ẩn' refetch với includeHidden để tra lại lịch sử, dòng ẩn
// mang marker 'Đã lưu - ẩn'.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, reconcileHide, getBootstrap } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  reconcileHide: vi.fn(),
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
  reconcileAndHideDebitLots: reconcileHide,
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
  debitHiddenAt: null,
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

describe('AccountingDebitClosePage — SIL-773 Rev2 Lưu & Xác nhận đối soát', () => {
  it('nút hiện đúng nhãn Rev2 (Lưu & Xác nhận đối soát) + nút Lưu, tắt khi chưa chọn dòng', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Lưu & Xác nhận đối soát' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });

  it('chọn dòng rồi bấm nút → gọi ẩn đúng shipmentId và báo số dòng đã ẩn', async () => {
    reconcileHide.mockResolvedValue({ hidden: [1] });
    const { container } = renderPage();
    await screen.findByText('BL-1');
    fireEvent.click(within(container.querySelector('.debit-board tbody tr')!).getByRole('checkbox', { name: 'Chọn lô BL-1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu & Xác nhận đối soát' }));
    await waitFor(() => expect(reconcileHide.mock.calls[0]?.[0]).toEqual([1]));
    expect(await screen.findByText(/Đã lưu & xác nhận đối soát, ẩn 1 dòng/)).toBeVisible();
  });

  it('công tắc Hiện dòng đã ẩn refetch với includeHidden=true', async () => {
    renderPage();
    await screen.findByText('BL-1');
    expect(listBoard.mock.calls.every((call) => call[0]?.includeHidden !== true)).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Hiện dòng đã ẩn|Hiện dòng đã ẩn \(lịch sử\)/ }));
    await waitFor(() => expect(listBoard.mock.calls.at(-1)?.[0]?.includeHidden).toBe(true));
  });

  it('dòng đã ẩn mang marker Đã lưu - ẩn trong cột Đối soát', async () => {
    listBoard.mockResolvedValue({ items: [row({ debitHiddenAt: '2026-11-09T10:00:00.000Z' })], total: 1 });
    renderPage();
    await screen.findByText('BL-1');
    expect(await screen.findByText('Đã lưu - ẩn')).toBeVisible();
  });
});
