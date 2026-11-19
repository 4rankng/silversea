/**
 * SIL-546 — tag "Ghép thu cước cùng Lô 1" trên lô thành viên, on the REBUILT
 * /shipments-debit grid (Task 2.3). The tag is VISIBLE TEXT on the member's
 * Cước cell (not just a hover tooltip), the full F-2 reason rides the
 * tooltip; Lô 1 and ungrouped lots never carry it; a lot whose group is gone
 * (tách nhóm — revGroupId null) loses the tag even when a citation note
 * survives on the wire.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listMerge, listSummary } = vi.hoisted(() => ({
  getBootstrap: vi.fn(), listMerge: vi.fn(), listSummary: vi.fn(),
}));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentDebit', () => ({
  listShipmentDebitSummary: listSummary,
  listDebitMergeBoard: listMerge,
  lockShipmentCost: vi.fn(),
  debitMergeKeys: {
    all: ['accounting-debit-merge'] as const,
    board: (team: boolean) => ['accounting-debit-merge', 'board', team] as const,
  },
}));
vi.mock('../api/shipmentClient', () => ({
  getShipmentDebitDetail: vi.fn().mockResolvedValue({}),
  lockShipmentCost: vi.fn(),
  unlockShipmentCost: vi.fn(),
  adjustShipmentCost: vi.fn(),
  listShipmentCostAdjustments: vi.fn().mockResolvedValue([]),
  listShipmentCostLockHistory: vi.fn().mockResolvedValue([]),
  saveShipmentDebitEdits: vi.fn(),
}));
vi.mock('../api/accountingDebitClient', () => ({ createSettlementRound: vi.fn() }));
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
import { ShipmentDebitPage } from './ShipmentDebitPage';
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

const row = (over: Partial<DebitMergeItem> = {}): DebitMergeItem => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerId: 1,
  customerName: 'KH A',
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: 'BL-1',
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnOps: null, psOps: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  localStorage.clear();
  getBootstrap.mockReset().mockResolvedValue({ customers: [], trucks: [] });
  listMerge.mockReset().mockResolvedValue({ items: [], total: 0 });
  listSummary.mockReset().mockResolvedValue({ items: [], total: 0, excludedCount: 0, excludedSum: '0' });
});

describe('SIL-546 — tag "Ghép thu cước cùng Lô 1" trên cell Cước của grid mới', () => {
  it('Lô 2..N (rev member) hiện 0₫ + tag HIỂN THỊ đúng trên cell Cước (desktop)', async () => {
    listMerge.mockResolvedValue({
      items: [row({
        control: { tongTc: '0', lockStatus: 'OPEN', lockedAt: null },
        revGroupId: 'rev-1',
        revGroupOrder: 2,
        revGroupMemberCount: 2,
        revenue: { cuoc: '0', cuocReason: 'Ghép thu cước cùng Lô 1', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' },
      })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-1');

    const cell = document.querySelector('td[data-col="cuoc"]')!;
    const tag = cell.querySelector('.debit-merge-money__mergetag')!;
    expect(tag.textContent).toBe('Ghép thu cước cùng Lô 1');
    expect(tag.getAttribute('title')).toBe('Ghép thu cước cùng Lô 1');
    expect(cell.textContent).toContain('0');
  });

  it('Lô 1 (order 1) và lô chưa ghép KHÔNG có tag', async () => {
    listMerge.mockResolvedValue({
      items: [
        row({ revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2, control: { tongTc: '3000000', lockStatus: 'OPEN', lockedAt: null }, revenue: { cuoc: '3000000', cuocReason: 'Ghép cước thu khách — Lô 1 giữ 100% cước thu nhóm (3.5T)', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '3000000' } }),
        row({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002', control: { tongTc: '1200000', lockStatus: 'OPEN', lockedAt: null }, revenue: { cuoc: '1200000', cuocReason: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: '1200000' } }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-2');
    expect(screen.queryByText('Ghép thu cước cùng Lô 1')).toBeNull();
    expect(document.querySelector('.debit-merge-money__mergetag')).toBeNull();
  });

  it('AC2 — tách nhóm (rev_group_id về null) → tag biến mất', async () => {
    listMerge.mockResolvedValue({
      items: [row({
        revGroupId: null,
        revGroupOrder: null,
        revenue: { cuoc: null, cuocReason: 'Tách khỏi nhóm ghép — chờ định giá lại', lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
      })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-1');
    expect(screen.queryByText('Ghép thu cước cùng Lô 1')).toBeNull();
  });

  it('tag render kèm tooltip full-reason khi BE stamp lý do dài (trip-less member note)', async () => {
    listMerge.mockResolvedValue({
      items: [row({
        control: { tongTc: '0', lockStatus: 'OPEN', lockedAt: null },
        revGroupId: 'rev-1',
        revGroupOrder: 3,
        revGroupMemberCount: 3,
        revenue: { cuoc: '0', cuocReason: 'Ghép cước cùng Bill BL-7', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' },
      })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-1');
    const tag = document.querySelector('.debit-merge-money__mergetag')!;
    expect(tag.getAttribute('title')).toBe('Ghép cước cùng Bill BL-7');
  });
});
