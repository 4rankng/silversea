/**
 * SIL-876 (hotfix CR-009.1) — the QA-visible view law on /accounting/ghep-bo-debit:
 * mặc định mới nhất lên đầu (trang 1 là lô gần hiện tại, không phải lô tháng 9),
 * ô tìm kiếm Bill/Cont/KH trả kết quả đúng, lọc Từ ngày–Đến ngày trả kết quả
 * đúng. The CUS surface (/shipments-debit) runs the SAME helper — the unit
 * laws live in debit-merge-view.test.ts; here we pin the PAGE wiring.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebitMergeItem } from '@tingting/shared';

const { listMergeBoard, getBootstrap } = vi.hoisted(() => ({
  listMergeBoard: vi.fn(),
  getBootstrap: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 9, role: 'ACCOUNTANT' } }),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  listSettlementRounds: vi.fn().mockResolvedValue({ items: [] }),
  createSettlementRound: vi.fn(),
  getDebitNoteRoundPreview: vi.fn(),
  DEBIT_SETTLEMENT_ROUNDS_KEY: ['accounting-debit-settlement-rounds'],
}));
vi.mock('../../api/shipmentDebit', () => ({
  listDebitMergeBoard: listMergeBoard,
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
    pendingAdjustRequests: ['accounting-debit-merge', 'pending-adjust-requests'] as const,
  },
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
  lockShipmentCost: vi.fn(),
  unlockShipmentCost: vi.fn(),
  listPendingShipmentCostAdjustRequests: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));

import DebitMergePage from './DebitMergePage';

const row = (over: Partial<DebitMergeItem> & Pick<DebitMergeItem, 'shipmentId'>): DebitMergeItem => ({
  code: null,
  customerId: 11,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: null,
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

import { ToastProvider } from '../../components/shared/Toast';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/ghep-bo-debit']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <DebitMergePage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const bodyBills = () => [...document.querySelectorAll('tbody td[data-col="lot"]')].map((cell) => cell.textContent);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  getBootstrap.mockResolvedValue({ customers: [], trucks: [] });
  // Tháng 9 chiếm đầu bảng là đúng cái QA fail — DESC phải lôi tháng 11 lên.
  listMergeBoard.mockResolvedValue({
    items: [
      row({ shipmentId: 1, billOrBookNumber: 'BL-SEP-OLD', deliveryDate: '2026-09-01' }),
      row({ shipmentId: 2, billOrBookNumber: 'JJCTCHPDY260305', deliveryDate: '2026-11-02', containers: [{ id: 1, containerNumber: 'TWCU8170772', containerType: null }] }),
      row({ shipmentId: 3, billOrBookNumber: 'BL-NOV-LATEST', deliveryDate: '2026-11-18' }),
    ],
    total: 3,
  });
});

describe('DebitMergePage — SIL-876 sort DESC + tìm kiếm + lọc ngày', () => {
  it('mặc định mới nhất lên đầu: trang 1 mở bằng lô tháng 11, không phải tháng 9', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    expect(bodyBills()).toEqual(['BL-NOV-LATEST', 'JJCTCHPDY260305', 'BL-SEP-OLD']);
  });

  it('ô tìm kiếm lọc đúng theo số Bill và số container', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    const search = screen.getByLabelText('Tìm lô theo số Bill, container hoặc khách hàng');
    fireEvent.change(search, { target: { value: 'jjctchpdy' } });
    expect(bodyBills()).toEqual(['JJCTCHPDY260305']);
    fireEvent.change(search, { target: { value: 'twcu8170772' } });
    expect(bodyBills()).toEqual(['JJCTCHPDY260305']);
    fireEvent.change(search, { target: { value: '' } });
    expect(bodyBills()).toHaveLength(3);
  });

  it('lọc Từ ngày–Đến ngày giới hạn cột Ngày', async () => {
    renderPage();
    await screen.findByText('BL-NOV-LATEST');
    // The shared DD/MM/YYYY buffered fields emit complete ISO dates.
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '01/11/2026' } });
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '30/11/2026' } });
    expect(bodyBills()).toEqual(['BL-NOV-LATEST', 'JJCTCHPDY260305']);
  });
});
