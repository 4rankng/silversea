/**
 * F-2 (card 161026113900, owner ruling b) — the money column reflects the
 * override channel on the REBUILT /shipments-debit grid (Task 2.3): a rev
 * member's CƯỚC cell reads its computed 0₫ with the override reason as the
 * spec §3.2 note (rendered as the visible merge tag's tooltip — SIL-546
 * placement, the tag lives on the same cell); a lot whose freight came from
 * the snapshot channel carries no note.
 *
 * The BD-01/BD-03 phone-row lane retired with the old flat board (the grid
 * is a horizontal-scroll table at every width); the phone surface's
 * "Cước vận tải (Auto)" note law is superseded by the same cell contract
 * asserted here on the desktop grid.
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/shipments-debit?customer=1']} initialIndex={0}>
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
});

describe('F-2 — Cước cell reads the override channel (ruling b) on the merge grid', () => {
  it('renders the member 0₫ with the "Ghép cước cùng Bill" marker on the Cước cell', async () => {
    listMerge.mockResolvedValue({
      items: [
        row({
          shipmentId: 201, billOrBookNumber: 'BL-P', code: 'SHP-26-0201',
          revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2,
          revenue: { cuoc: '3150000', cuocReason: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: '3150000' },
        }),
        row({
          shipmentId: 202, billOrBookNumber: 'BL-M', code: 'SHP-26-0202',
          revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2,
          revenue: { cuoc: '0', cuocReason: 'Ghép cước cùng Bill BL-P', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' },
        }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-M');

    // The member's note rides the Cước cell (the merged 0₫ lane's home on
    // the flat board stays the Cước cell on the grid), tooltip = full reason.
    const memberCell = document.querySelector('tr[data-shipment-id="202"] td[data-col="cuoc"]')!;
    const tag = memberCell.querySelector('.debit-merge-money__mergetag')!;
    expect(tag.textContent).toBe('Ghép thu cước cùng Lô 1');
    expect(tag.getAttribute('title')).toBe('Ghép cước cùng Bill BL-P');
    expect(memberCell.textContent).toContain('0');

    // The principal carries 100% and NO marker.
    const principalRow = document.querySelector('tr[data-shipment-id="201"]')!;
    expect(principalRow.querySelector('.debit-merge-money__mergetag')).toBeNull();
    expect(principalRow.textContent).toContain('3.150.000');
  });

  it('renders no marker when the snapshot channel produced the freight', async () => {
    listMerge.mockResolvedValue({
      items: [row({
        shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203',
        revenue: { cuoc: '1234000', cuocReason: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: '1234000' },
      })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-S');
    expect(screen.getAllByText('1.234.000').length).toBeGreaterThan(0);
    expect(document.querySelector('.debit-merge-money__mergetag')).toBeNull();
  });
});
