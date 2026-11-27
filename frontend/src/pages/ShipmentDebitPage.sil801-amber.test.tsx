/**
 * SIL-801 — uncollected receivables wear the warning amber tone, on the
 * REBUILT /shipments-debit grid (Task 2.3). The receivable column is now
 * KIỂM SOÁT's 'Tổng TC' cell; the foot (totals row) carries the tone the
 * same way. Laws pinned:
 *  - a known non-zero receivable is amber on the row cell AND the foot;
 *  - a settled 0 stays muted (never amber);
 *  - a pending receivable is the BLANK cell — no tone, no fabricated 0;
 *  - the amber ink is var(--warning-text) and the --warn rule sits AFTER the
 *    base rule in the cascade (QA FAIL 1ae5afcb).
 * The per-customer group subtotal band stays retired (SIL-837 flat law —
 * carried into the grid: no group band exists at all).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const amberRow = (over: Partial<DebitMergeItem>, shipmentId = 101): DebitMergeItem => ({
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

const cssSource = () =>
  readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  localStorage.clear();
  getBootstrap.mockReset().mockResolvedValue({ customers: [], trucks: [] });
  listMerge.mockReset().mockResolvedValue({ items: [], total: 0 });
  listSummary.mockReset().mockResolvedValue({ items: [], total: 0, excludedCount: 0, excludedSum: '0' });
});

describe('SIL-801 — Tổng TC chưa thu wears the warning amber tone', () => {
  it('marks a known non-zero receivable amber on the row cell AND the foot', async () => {
    listMerge.mockResolvedValue({
      items: [amberRow({ revenue: { cuoc: '10000000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '10000000' }, control: { tongTc: '306619500', lockStatus: 'OPEN', lockedAt: null } })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-101');

    const warnCells = document.querySelectorAll('td[data-col="tongTc"] .debit-merge-money__warn');
    expect(warnCells).toHaveLength(1);
    expect(warnCells[0].textContent).toContain('306.619.500');
    // The foot carries the tone on the same column.
    const foot = document.querySelector('tfoot td[data-col="tongTc"]');
    expect(foot?.classList.contains('debit-merge__totals-cell--warn')).toBe(true);
    expect(foot?.textContent).toContain('306.619.500');
    // SIL-837 — no group subtotal surface survives anywhere.
    expect(document.querySelector('[class*="group__sum"]')).toBeNull();
  });

  it('keeps a settled 0 receivable muted and the component columns neutral', async () => {
    listMerge.mockResolvedValue({
      items: [
        amberRow({ revenue: { cuoc: '0', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '0' }, control: { tongTc: '0', lockStatus: 'OPEN', lockedAt: null } }),
        amberRow({ revenue: { cuoc: '250000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '250000' }, control: { tongTc: '250000', lockStatus: 'OPEN', lockedAt: null } }, 102),
      ],
      total: 2,
    });
    renderPage();
    await screen.findByText('BL-102');

    const zeroRow = document.querySelector('tr[data-shipment-id="101"]')!;
    const zeroTotal = zeroRow.querySelector('td[data-col="tongTc"]')!;
    expect(zeroTotal.querySelector('.debit-merge-money__warn')).toBeNull();
    expect(zeroTotal.querySelector('.debit-merge-money__zero')).toBeTruthy();
    // Amber owns only the receivable column — the Cước cell never takes it.
    const allWarn = document.querySelectorAll('.debit-merge-money__warn');
    expect(allWarn).toHaveLength(1);
    expect(allWarn[0].closest('td')?.getAttribute('data-col')).toBe('tongTc');
  });

  it('leaves a pending receivable without a tone — the null cell ghosts — (SIL-1081), never a fabricated 0', async () => {
    listMerge.mockResolvedValue({
      items: [amberRow({ control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null } })],
      total: 1,
    });
    renderPage();
    await screen.findByText('BL-101');

    const row = document.querySelector('tr[data-shipment-id="101"]')!;
    const totalCell = row.querySelector('td[data-col="tongTc"]')!;
    expect(totalCell.classList.contains('debit-merge-money__warn')).toBe(false);
    // Owner 24/10 law (SIL-1081 supersedes the empty face): the pending
    // money cell ghosts the em-dash, never '0 ₫'.
    expect(totalCell.textContent!.trim()).toBe('—');
    expect(document.querySelector('tfoot td[data-col="tongTc"]')?.classList.contains('debit-merge__totals-cell--warn')).toBe(false);
    expect(document.querySelector('tfoot td[data-col="tongTc"]')?.textContent).toBe('—');
  });

  it('pins the amber ink on the --warning-text token in the stylesheet (grid CSS)', () => {
    const css = cssSource();
    expect(css).toMatch(/\.debit-merge-money__warn\s*\{\s*color: var\(--warning-text\);/);
    expect(css).toMatch(/\.debit-merge__totals-row td\.debit-merge__totals-cell--warn\s*\{\s*color: var\(--warning-text\);/);
  });

  // QA FAIL 1ae5afcb (comment 5048): the amber rule must appear AFTER its
  // base rule in the stylesheet — same specificity, so the later rule wins;
  // a reorder silently kills the tone.
  it('keeps the amber rules AFTER their base rules in the cascade', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeGrid.css'), 'utf8');
    expect(css.indexOf('.debit-merge-money__value')).toBeGreaterThan(-1);
    expect(css.indexOf('.debit-merge-money__warn')).toBeGreaterThan(-1);
    expect(css.indexOf('.debit-merge-money__value')).toBeLessThan(css.indexOf('.debit-merge-money__warn'));
    expect(css.indexOf('.debit-merge__totals-row td.debit-merge__totals-cell {')).toBeGreaterThan(-1);
    expect(css.indexOf('.debit-merge__totals-cell--warn')).toBeGreaterThan(-1);
    expect(css.indexOf('.debit-merge__totals-row td.debit-merge__totals-cell {'))
      .toBeLessThan(css.indexOf('.debit-merge__totals-cell--warn'));
  });
});
