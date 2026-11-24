/**
 * /shipments-debit — REBUILT contract (ticket 18/11 Task 2.3 + Task 1.2).
 * The page renders the ONE DebitMergeGrid (6 groups shared with
 * /accounting/ghep-bo-debit) and carries the team toggle, pagination,
 * Khóa lô / Chọn Debit actions. The old flat board (ribbon, merge bar,
 * Debit Note export, phone records) retired with it — the accountant board
 * (/accounting/chot-debit) keeps pinning those laws.
 *
 * Laws pinned here:
 *  - Task 1.2: the toggle's EXACT label 'Hiện thông tin lô hàng team',
 *    default OFF; OFF → own-only data call, ON → team=1 on BOTH calls and
 *    the NV phụ trách column appears;
 *  - Khóa lô rides ShipmentDebitWorkspace's canLock law (ADMIN|ACCOUNTANT|CUS)
 *    through the existing cost-lock channel;
 *  - Chọn Debit arms only when every picked lot's costs are complete (the
 *    ACTIVE cost-lock signal); CUS runs the same channel as accounting
 *    (ticket 2.3) alongside the office trio;
 *  - SIL-776 REV2: the surface carries NO giá vốn — no cost column exists
 *    on the grid, and the summary response still renders its revenue cells
 *    with the null-is-blank law;
 *  - the quick filters (Khách hàng / Tuyến đường) thread into the grid.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listMerge, listSummary, lockCost, createRound } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  listMerge: vi.fn(),
  listSummary: vi.fn(),
  lockCost: vi.fn(),
  createRound: vi.fn(),
}));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentDebit', () => ({
  listShipmentDebitSummary: listSummary,
  listDebitMergeBoard: listMerge,
  lockShipmentCost: lockCost,
  unlockShipmentCost: vi.fn(),
  adjustShipmentCost: vi.fn(),
  listShipmentCostAdjustments: vi.fn().mockResolvedValue([]),
  listShipmentCostLockHistory: vi.fn().mockResolvedValue([]),
  getShipmentDebitDetail: vi.fn().mockResolvedValue({}),
  saveShipmentDebitEdits: vi.fn(),
  requestShipmentCostAdjust: vi.fn().mockResolvedValue({ id: 1 }),
  listPendingShipmentCostAdjustRequests: vi.fn().mockResolvedValue([]),
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
    pendingAdjustRequests: ['accounting-debit-merge', 'pending-adjust-requests'] as const,
  },
}));
vi.mock('../api/shipmentClient', () => ({
  getShipmentDebitDetail: vi.fn().mockResolvedValue({}),
  lockShipmentCost: lockCost,
  unlockShipmentCost: vi.fn(),
  adjustShipmentCost: vi.fn(),
  listShipmentCostAdjustments: vi.fn().mockResolvedValue([]),
  listShipmentCostLockHistory: vi.fn().mockResolvedValue([]),
  saveShipmentDebitEdits: vi.fn(),
}));
vi.mock('../api/accountingDebitClient', () => ({
  createSettlementRound: createRound,
}));
vi.mock('../api/dispatchPlanningClient', () => ({
  mergeLclRevGroup: vi.fn(),
  unmergeLclLot: vi.fn(),
  unmergeLclGroup: vi.fn(),
  updateLclTruck: vi.fn(),
  assignLclCostGroup: vi.fn(),
}));
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage, TEAM_TOGGLE_LABEL } from './ShipmentDebitPage';
import type { DebitMergeItem } from '../api/shipmentDebit';

function renderPage(initialEntry = '/shipments-debit') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const mergeRow = (over: Partial<DebitMergeItem> = {}): DebitMergeItem => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerId: 1,
  customerName: 'KH A',
  factoryName: 'NM A',
  routeName: 'Hải Phòng → Bắc Ninh',
  deliveryDate: '2026-11-18',
  billOrBookNumber: 'BL-1',
  creatorName: 'Lê Văn Tài',
  creatorCode: 'NV001',
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  localStorage.clear();
  getBootstrap.mockReset().mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
  listMerge.mockReset().mockResolvedValue({ items: [], total: 0 });
  listSummary.mockReset().mockResolvedValue({ items: [], total: 0, excludedCount: 0, excludedSum: '0' });
  lockCost.mockReset();
  createRound.mockReset();
});

describe('Task 2.3 — /shipments-debit renders the Ghép bộ Debit grid', () => {
  it('renders the 6 group headers on the CUS surface', async () => {
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    for (const header of ['Container', 'Cước phải thu', 'PHÍ CHI HỘ (Có hóa đơn)', 'PHÍ KHÔNG HÓA ĐƠN', 'KIỂM SOÁT']) {
      expect(screen.getByText(header)).toBeTruthy();
    }
  });

  it('SIL-776 REV2: NO giá vốn column exists on the surface', async () => {
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    const headers = [...document.querySelectorAll('th')].map((th) => th.textContent ?? '');
    for (const banned of ['Giá vốn', 'Cước trả', 'Tổng chi', 'Lợi nhuận', 'Chi nội địa']) {
      expect(headers.some((header) => header.includes(banned))).toBe(false);
    }
  });

  it('threads the customer quick filter into the merge call', async () => {
    renderPage('/shipments-debit?customer=7');
    await screen.findByText('Thông tin Lô hàng');
    await waitFor(() => expect(listMerge).toHaveBeenCalledWith({ customerId: 7, team: false }));
    expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ customerId: 7, team: false }));
  });
});

describe('Task 1.2 — Hiện thông tin lô hàng team', () => {
  it('the toggle renders its EXACT label and defaults OFF — own-only calls', async () => {
    renderPage();
    const toggle = await screen.findByLabelText(TEAM_TOGGLE_LABEL) as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(false);
    await waitFor(() => expect(listMerge).toHaveBeenCalledWith(expect.objectContaining({ team: false })));
    // NV phụ trách column hidden while OFF.
    await screen.findByText('Thông tin Lô hàng');
    expect(document.querySelector('th[data-col="creator"]')).toBeNull();
  });

  it('ON → team=1 rides BOTH data calls and the NV phụ trách column appears', async () => {
    listMerge.mockResolvedValue({ items: [mergeRow({ creatorName: 'Trần Thị B', creatorCode: 'NV002' })], total: 1 });
    renderPage();
    const toggle = await screen.findByLabelText(TEAM_TOGGLE_LABEL) as HTMLInputElement;
    fireEvent.click(toggle);
    const afterToggle = await screen.findByLabelText(TEAM_TOGGLE_LABEL) as HTMLInputElement;
    expect(afterToggle.checked).toBe(true);
    await waitFor(() => expect(listMerge).toHaveBeenCalledWith(expect.objectContaining({ team: true })));
    expect(listSummary).toHaveBeenCalledWith(expect.objectContaining({ team: true }));
    await screen.findByText('Trần Thị B');
    expect(document.querySelector('th[data-col="creator"]')?.textContent).toBe('NV phụ trách');
  });
});

describe('Khóa lô — the canLock law over the grid selection', () => {
  it('locks the picked lots through the existing cost-lock channel', async () => {
    authRole.value = 'CUS';
    listMerge
      .mockResolvedValueOnce({
        items: [mergeRow({ shipmentId: 101, control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null } })],
        total: 1,
      })
      .mockResolvedValue({
        items: [mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-24T00:00:00.000Z' } })],
        total: 1,
      });
    lockCost.mockResolvedValue({});
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    fireEvent.click(await screen.findByLabelText('Chọn lô BL-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Khóa lô' }));
    await waitFor(() => expect(lockCost).toHaveBeenCalledWith(101, expect.any(String)));
    // SIL-923 — the board refresh reads back LOCKED and the selection STAYS,
    // so the same toolbar slot is now [Đề nghị điều chỉnh] for the CUS
    // viewer (the unlock trio would see [Mở khóa] instead).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đề nghị điều chỉnh' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Khóa lô' })).toBeNull();
  });

  it('Chọn Debit arms for CUS on a locked pick — same channel as accounting (ticket 2.3)', async () => {
    listMerge.mockResolvedValue({
      items: [mergeRow({ shipmentId: 101, control: { tongTc: '100', lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } })],
      total: 1,
    });
    renderPage();
    await screen.findByText('Thông tin Lô hàng');
    fireEvent.click(await screen.findByLabelText('Chọn lô BL-1'));
    const choose = document.querySelector('button.debit-merge__action--primary') as HTMLButtonElement;
    expect(choose.getAttribute('aria-disabled')).not.toBe('true');
    expect(document.getElementById('debit-merge-choose-disabled-reason')).toBeNull();
    fireEvent.click(choose);
    expect(await screen.findByRole('dialog', { name: 'Chọn Debit — chốt đợt đối soát' })).toBeTruthy();
    expect(createRound).not.toHaveBeenCalled();
  });
});
