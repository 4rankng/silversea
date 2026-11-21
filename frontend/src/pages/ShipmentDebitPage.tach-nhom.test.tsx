/**
 * card 211026024348 / FB-145 — "Tách nhóm" on /shipments-debit, after the
 * Task 2.3 grid rebuild: the merged-lane MONEY laws (member 0₫ + tag, F-2
 * reason) stay pinned on this surface by the f2-money / rev-merge-tag pins,
 * but the SPLIT ACTION itself retired from the CUS surface with the old
 * flat board's row menu. The unmerge channel (unmergeLclGroup REV, the
 * promote-on-unmerge FB-095 law, the FB-145 skeleton/toast) remains live —
 * pinned on the accountant board where the action now lives
 * (AccountingDebitClosePage.tach-nhom.test.tsx).
 *
 * This file pins the retirement CONTRACT:
 *  - the rebuilt /shipments-debit renders NO "Tách nhóm" action anywhere;
 *  - the merge facts still READ from the wire (revGroupPrincipalRef-style
 *    citations stay visible via the merge tag law, pinned separately);
 *  - the CUS surface never regains a destructive group action silently.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listMerge, listSummary, unmergeGroup, unmergeLot } = vi.hoisted(() => ({
  getBootstrap: vi.fn(),
  listMerge: vi.fn(),
  listSummary: vi.fn(),
  unmergeGroup: vi.fn(),
  unmergeLot: vi.fn(),
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
  unmergeLclLot: unmergeLot,
  unmergeLclGroup: unmergeGroup,
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/shipments-debit']} initialIndex={0}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentDebitPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const row = (over: Partial<DebitMergeItem>, shipmentId = 101): DebitMergeItem => ({
  shipmentId,
  code: `SHP-26-0${shipmentId}`,
  customerId: 1,
  customerName: 'KH A',
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: `BL-${shipmentId}`,
  creatorName: null,
  creatorCode: null,
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
  getBootstrap.mockReset().mockResolvedValue({ customers: [], trucks: [] });
  listMerge.mockReset().mockResolvedValue({ items: [], total: 0 });
  listSummary.mockReset().mockResolvedValue({ items: [], total: 0, excludedCount: 0, excludedSum: '0' });
});

describe('Tách nhóm on /shipments-debit — retirement contract after Task 2.3', () => {
  it('the rebuilt surface renders NO "Tách nhóm" action, even for a merged rev group', async () => {
    listMerge.mockResolvedValue({
      items: [
        row({ shipmentId: 201, billOrBookNumber: 'BL-P', revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2, revenue: { cuoc: '3000000', cuocReason: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: '3000000' } }),
        row({ shipmentId: 202, billOrBookNumber: 'BL-M', revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2, revenue: { cuoc: '0', cuocReason: 'Ghép cước cùng Bill BL-P', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' } }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-M');

    expect(screen.queryByText('Tách nhóm')).toBeNull();
    expect(screen.queryByRole('button', { name: /Tách nhóm/ })).toBeNull();
    // No unmerge call may fire from this surface.
    expect(unmergeGroup).not.toHaveBeenCalled();
    expect(unmergeLot).not.toHaveBeenCalled();
  });

  it('the merged lane still READS: member 0₫ + tag (money laws pinned by f2-money / rev-merge-tag)', async () => {
    listMerge.mockResolvedValue({
      items: [row({ revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2, control: { tongTc: '0', lockStatus: 'OPEN', lockedAt: null }, revenue: { cuoc: '0', cuocReason: 'Ghép cước cùng Bill BL-9', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' } })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-101');
    const cell = document.querySelector('td[data-col="cuoc"]')!;
    expect(cell.textContent).toContain('0');
    expect(cell.querySelector('.debit-merge-money__mergetag')).toBeTruthy();
  });
});
