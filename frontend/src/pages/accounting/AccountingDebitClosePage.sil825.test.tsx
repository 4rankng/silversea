// SIL-825 round 2 (build 9f999b4d QA wave 13) — the [Gửi yêu cầu điều chỉnh
// cước] flow was removed entirely (SIL-805 Task 1.1 ruling; round 1 commit
// e89f3feb), yet the QA card came back as "button still visible" on
// /accounting/chot-debit. Investigation: the button had exactly ONE render
// site ever — this page's selection strip — and main carries zero references
// (client fn `sendRateAdjustmentRequests` and the BE create route are gone
// too). Because the flow already resurfaced once after SIL-772 (that is why
// SIL-825 exists), these tests pin its ABSENCE on both cargo tabs (FCL + LCL)
// and in the exact state the QA repro used — a selected row — so a comeback
// fails CI instead of a QA wave. The kept confirm/withdraw flow
// ("Xác nhận đối soát" / "Hoàn tác") for legacy PENDING requests must stay.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const row = (over: Partial<AccountingDebitBoardRow> = {}): AccountingDebitBoardRow => ({
  shipmentId: 1,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  customerId: 11,
  carrierKeys: ['OWN'],
  ngay: '2026-11-09',
  billOrBooking: 'BL-F1',
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

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  listBoard.mockResolvedValue({
    items: [
      row(),
      row({
        shipmentId: 2,
        code: 'SHP-26-0002',
        customerId: 12,
        customerName: 'KH B',
        billOrBooking: 'BL-L1',
        containers: [],
        lcl: { label: 'Nhóm lẻ A1', actualTruckNo: null, billingTruckNo: null, ghépCùngRef: null },
      }),
    ],
    total: 2,
  });
  listRounds.mockResolvedValue({ items: [] });
  getBootstrap.mockResolvedValue({ trucks: [] });
});
afterEach(() => vi.clearAllMocks());

async function expectNoSendApprovalButton() {
  expect(screen.queryByRole('button', { name: /Gửi yêu cầu điều chỉnh/ })).toBeNull();
}

describe('AccountingDebitClosePage — SIL-825 round 2: gửi-duyệt flow stays gone on both tabs', () => {
  it('tab FCL: no gửi-duyệt button, including with a lot selected (the QA repro state)', async () => {
    renderPage();
    expect(await screen.findByText('BL-F1')).toBeInTheDocument();
    expectNoSendApprovalButton();

    // The old button lived in the selection strip — pin the selected state.
    fireEvent.click(screen.getByRole('button', { name: 'Chọn tất cả 1 lô đủ điều kiện' }));
    await waitFor(() => expect(screen.getByText('Đã chọn 1 lô')).toBeInTheDocument());
    expectNoSendApprovalButton();

    // The kept legacy-request flow stays reachable.
    expect(screen.getByRole('button', { name: 'Lưu & Xác nhận đối soát' })).toBeInTheDocument();
  });

  it('tab LCL: no gửi-duyệt button, including with a lot selected', async () => {
    renderPage();
    await screen.findByText('BL-F1');
    fireEvent.click(screen.getByRole('button', { name: /^LCL ·/ }));
    expect(await screen.findByText('BL-L1')).toBeInTheDocument();
    expect(screen.queryByText('BL-F1')).not.toBeInTheDocument();
    expectNoSendApprovalButton();

    fireEvent.click(screen.getByRole('button', { name: 'Chọn tất cả 1 lô đủ điều kiện' }));
    await waitFor(() => expect(screen.getByText('Đã chọn 1 lô')).toBeInTheDocument());
    expectNoSendApprovalButton();
  });
});
