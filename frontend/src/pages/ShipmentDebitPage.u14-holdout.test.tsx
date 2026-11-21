/**
 * STAGE-8 HOLDOUT (u14-debit-dense) — requirement laws that SURVIVE the grid
 * rebuild (ticket 18/11 Task 2.3), re-pinned against the DebitMergeGrid:
 *
 * AC-2  a lot row with customsNumber and factoryName/factoryAddress all null
 *       renders an identity cell with NO standalone '—' text.
 * AC-4  regression: with all money null the row money cells are EMPTY (no
 *       fabricated 0, no dash in row cells); the totals foot still renders
 *       '—' (empty sums).
 *
 * AC-1/AC-3/AC-5 (the flat board's fixed 220px th widths, pane max/min
 * height, edge-to-edge gutter calc) pinned the RETIRED flat board's CSS and
 * are superseded by the shared grid pane (DebitMergeGrid.css) — the grid's
 * own pane law (max-height, horizontal scroll) is what ships now. AC-6's
 * amber classes moved to the grid stylesheet and ride the sil801-amber pin.
 */
import { render, screen, within } from '@testing-library/react';
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
  getBootstrap.mockReset().mockResolvedValue({ customers: [], trucks: [] });
  listMerge.mockReset().mockResolvedValue({ items: [], total: 0 });
  listSummary.mockReset().mockResolvedValue({ items: [], total: 0, excludedCount: 0, excludedSum: '0' });
});

describe('u14 holdout laws on the rebuilt grid — density & legibility', () => {
  it('AC-2: customs + factory both null — identity cells render NO standalone —', async () => {
    listMerge.mockResolvedValue({
      items: [row({ shipmentId: 301, billOrBookNumber: 'BL-E', code: 'SHP-26-0301', factoryName: null, routeName: null })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-E');

    const identityRow = screen.getAllByText('BL-E')[0]!.closest('tr')!;
    for (const key of ['lot', 'factory', 'route', 'customer']) {
      const cell = identityRow.querySelector(`td[data-col="${key}"]`) as HTMLElement;
      expect(cell, key).not.toBeNull();
      expect(within(cell).queryByText('—')).toBeNull();
    }
  });

  it('AC-4: all money null — row money cells empty (no 0, no dash); the foot renders —', async () => {
    listMerge.mockResolvedValue({
      items: [row({ shipmentId: 401, billOrBookNumber: 'BL-N', code: 'SHP-26-0401' })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-N');

    const moneyRow = screen.getAllByText('BL-N')[0]!.closest('tr')!;
    for (const col of ['cuoc', 'lachHuyen', 'phuPhi', 'phatSinh', 'tong', 'gnFee', 'gnPaid', 'psFee', 'psPaid', 'tongTc']) {
      const cell = moneyRow.querySelector(`td[data-col="${col}"]`) as HTMLElement;
      expect(cell, col).not.toBeNull();
      expect(cell.textContent!.trim()).toBe('');
      expect(cell.textContent).not.toContain('0');
      expect(cell.textContent).not.toContain('—');
    }
    const footSums = document.querySelectorAll('tfoot td.debit-merge__totals-cell');
    const footValues = [...footSums].map((cell) => cell.textContent).filter((text) => text !== '' && text !== 'Tổng cộng');
    expect(footValues.length).toBeGreaterThan(0);
    for (const value of footValues) expect(value).toBe('—');
  });

  it('AC-6: two rows (one LOCKED) render with their trạng thái labels', async () => {
    listMerge.mockResolvedValue({
      items: [
        row({ shipmentId: 801, billOrBookNumber: 'BL-A' }),
        row({ shipmentId: 802, billOrBookNumber: 'BL-B', control: { tongTc: null, lockStatus: 'LOCKED', lockedAt: '2026-11-18T00:00:00.000Z' } }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-A');
    expect(screen.getAllByText('BL-B').length).toBeGreaterThan(0);
    expect(screen.getByText('Đã khóa')).toBeTruthy();
    expect(screen.getByText('Mở')).toBeTruthy();
  });
});
