// SIL-814 — luật 24/10 (Spec v4 §8.1.3) trên mặt EDITABLE của Bảng Kiểm soát
// lô hàng (/accounting/chot-debit): một ô CHƯA XÁC ĐỊNH (wire value null —
// lô mở chưa có giá, ví dụ R3K-J1) không được đọc '0' giả (QA 19/11 build
// 3af3e929). SIL-1081 (K2.120, KB Ch.10 money law 'thiếu dữ liệu hiện —')
// supersedes the blank face: EVERY unpriced cell now ghosts the em-dash —
// vẫn là ô nhập rỗng, không bao giờ số bịa. Pin: ô chưa xác định →
// placeholder '—'; ô có giá thật → placeholder định dạng; lô khóa sổ chưa
// có giá → không có input nào (mặt text '—').
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listBoard, listRounds, getBootstrap } = vi.hoisted(() => ({
  listBoard: vi.fn(),
  listRounds: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listAccountingDebitBoard: listBoard,
  confirmRateAdjustments: vi.fn(),
  withdrawRateAdjustments: vi.fn(),
  listSettlementRounds: listRounds,
  createSettlementRound: vi.fn(),
  setDebitExternalCost: vi.fn(),
  setDebitRateOverrides: vi.fn(),
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

const NULL_MONEY = { cuocThu: null, lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: null };
const NULL_TRA = { cuocTraDv: null, lachHuyenDv: null, phatSinhDv: null, tong1: null, phiRu: null };

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-2611-00244',
  customerName: 'Long Minh',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-02',
  billOrBooking: 'R3K-J1',
  containers: ['RTAU2001055 · 20DC'],
  phanXe: ['Nhà xe A'],
  thu: { ...NULL_MONEY },
  tra: { ...NULL_TRA },
  chiPhiNgoai: null,
  debitHiddenAt: null,
  loiNhuan: null,
  ghiChu: null,
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  costLockedAt: null,
  ...over,
});

const RATE_INPUTS = [
  'Cước thu lô R3K-J1',
  'Lạch Huyện lô R3K-J1',
  'Phụ PS lô R3K-J1',
  'Phát sinh (CUS) lô R3K-J1',
];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});
afterEach(() => vi.clearAllMocks());

describe('AccountingDebitClosePage — ô chưa xác định ghost —, không 0 giả (SIL-814 → SIL-1081)', () => {
  it('lô mở chưa định giá: 4 ô CƯỚC PHẢI THU là input rỗng ghost —, không 0 giả (SIL-1081)', async () => {
    listBoard.mockResolvedValue({ items: [row()], total: 1 });
    renderPage();
    // SIL-1081 — every unpriced cell ghosts the em-dash: still an EMPTY
    // input, never a fabricated number, on BOTH faces of the grid.
    for (const label of ['Cước thu lô R3K-J1', 'Lạch Huyện lô R3K-J1', 'Phụ PS lô R3K-J1', 'Phát sinh (CUS) lô R3K-J1', 'Cước trả ĐV lô R3K-J1', 'Lạch Huyện ĐV lô R3K-J1', 'Phát sinh ĐV lô R3K-J1', 'Phí RU lô R3K-J1']) {
      const input = await screen.findByRole('textbox', { name: label });
      expect(input).toHaveValue('');
      expect(input, label).toHaveAttribute('placeholder', '—');
    }
    // No fake '0' parked anywhere — placeholders are ghosts, not numbers.
    expect(screen.queryByText('0 ₫')).toBeNull();
  });

  it('ô có giá thật giữ placeholder định dạng (kế toán vẫn thấy tiền đang áp dụng)', async () => {
    listBoard.mockResolvedValue({ items: [row({
      thu: { cuocThu: '3952000', lachHuyen: null, phuPs: null, phatSinhCus: null, tongThu: '3952000' },
      loiNhuan: null,
    })], total: 1 });
    renderPage();
    const cuocThu = await screen.findByRole('textbox', { name: 'Cước thu lô R3K-J1' });
    expect(cuocThu).toHaveAttribute('placeholder', '3.952.000 ₫');
    expect(screen.getByRole('textbox', { name: 'Lạch Huyện lô R3K-J1' })).toHaveAttribute('placeholder', '—');
  });

  it('lô khóa sổ chưa có giá (R3M-KR2 quan sát QA): không render input nào — mặt text ghost —', async () => {
    listBoard.mockResolvedValue({ items: [row({
      code: 'SHP-2611-00279',
      billOrBooking: 'R3M-KR2',
      costLockedAt: '2026-11-06T03:00:00.000Z',
    })], total: 1 });
    renderPage();
    await screen.findByText('R3M-KR2');
    for (const label of RATE_INPUTS) {
      expect(screen.queryByRole('textbox', { name: label })).toBeNull();
    }
  });
});
