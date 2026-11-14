/**
 * STAGE-8 HOLDOUT (u14-debit-dense) — requirement-only verification.
 *
 * One vitest/RTL test per acceptance criterion, derived ONLY from the six
 * requirement statements issued for this holdout (no case was taken from the
 * candidate's updated ShipmentDebitPage.test.tsx; the renderPage/row fixture
 * conventions are the committed page-test harness):
 *
 * AC-1  desktop widths: the four money column headers are not truncated —
 *       th.shipment-debit-col--{freight,chiho,service,total} width 220px and
 *       board min-width 1336px pinned in the CSS source.
 * AC-2  a lot row with customsNumber and factoryName/factoryAddress all null
 *       renders an identity cell with NO standalone '—' text.
 * AC-3  .shipment-debit-pane has max-height but NO min-height (no reserved
 *       dead height below the board).
 * AC-4  regression: with all money null the row money cells are EMPTY (no
 *       fabricated 0, no dash in row cells); the totals foot still renders
 *       '—' (empty sums).
 * AC-5  .shipment-debit-pane margin-inline calc(-12px -
 *       var(--app-body-pad-x, 24px)) and width calc(100% + 24px +
 *       2 * var(--app-body-pad-x, 24px)) (edge-to-edge rail).
 * AC-6  the page renders with two rows (one LOCKED); the row's menu opens;
 *       the amber/warn classes exist in CSS (shipment-debit-money--warn /
 *       --totals__sum--warn / group__sum--warn).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary } = vi.hoisted(() => ({
  getBootstrap: vi.fn(), listSummary: vi.fn(),
}));
const { authRole } = vi.hoisted(() => ({ authRole: { value: 'CUS' } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: authRole.value } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: vi.fn(),
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
}));
vi.mock('../api/shipmentDebit', () => ({
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
}));
vi.mock('../api/dispatchPlanningClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/dispatchPlanningClient')>(),
  mergeLclRevGroup: vi.fn(),
  unmergeLclLot: vi.fn(),
  updateLclTruck: vi.fn(),
  assignLclCostGroup: vi.fn(),
}));
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';

/* comment text carries history, not contract — strip before asserting rules */
const cssSource = () =>
  readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

const block = (selector: RegExp): string => {
  const found = [...cssSource().matchAll(new RegExp(selector.source + String.raw`\s*\{([^}]*)\}`, 'g'))].map((m) => m[0] as string);
  expect(found.length, `expected a CSS rule for ${selector}`).toBeGreaterThan(0);
  return found[0]!; // first occurrence = the base rule (media/print overrides follow)
};

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

const lclRow = (over: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow => ({
  shipmentId: 101,
  code: 'SHP-26-0001',
  customerName: 'KH A',
  factoryName: null,
  factoryAddress: null,
  billOrBookNumber: 'BL-1',
  customsNumber: null,
  documentsSummary: null,
  freightAuto: null,
  chiHoTotal: null,
  receivableTotal: null,
  payableTotal: null,
  profit: null,
  lockStatus: 'OPEN',
  lockedAt: null,
  cargoMode: 'LCL',
  costGroupId: null,
  costGroupOrder: null,
  revGroupId: null,
  revGroupOrder: null,
  costGroupMemberCount: null,
  revGroupMemberCount: null,
  actualTruckNo: null,
  billingTruckNo: null,
  costVehicleClassCode: null,
  revVehicleClassCode: null,
  revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
  ...over,
  customerId: over.customerId ?? 1,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  getBootstrap.mockReset();
  listSummary.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
});

describe('u14 holdout — requirement-only (density & legibility redesign)', () => {
  it('AC-1: money headers not truncated — th widths 220px, board min-width 1336px', () => {
    for (const col of ['freight', 'chiho', 'service', 'total']) {
      const th = block(new RegExp(String.raw`\.shipment-debit-table th\.shipment-debit-col--${col}\b`));
      expect(th).toMatch(/width:\s*220px/);
    }
    expect(block(/\.shipment-debit-table\s/)).toMatch(/min-width:\s*1336px/);
  });

  it('AC-2: customs + factory both null — identity cell renders NO standalone —', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({ shipmentId: 301, billOrBookNumber: 'BL-E', code: 'SHP-26-0301' })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-E');

    const row = screen.getAllByText('BL-E')[0]!.closest('tr')!;
    const identity = row.querySelector('.shipment-debit-cell--identity') as HTMLElement;
    expect(identity).not.toBeNull();
    expect(within(identity).queryByText('—')).toBeNull();
  });

  it('AC-3: the pane keeps max-height and has NO min-height', () => {
    const pane = block(/\.shipment-debit-pane/);
    expect(pane).toMatch(/max-height/);
    expect(pane).not.toMatch(/min-height/);
  });

  it('AC-4: all money null — row money cells empty (no 0, no dash); foot renders —', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({ shipmentId: 401, billOrBookNumber: 'BL-N', code: 'SHP-26-0401' })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-N');

    const row = screen.getAllByText('BL-N')[0]!.closest('tr')!;
    for (const col of ['freight', 'chiho', 'service', 'total']) {
      const cell = row.querySelector(`td[data-col="${col}"]`) as HTMLElement;
      expect(cell).not.toBeNull();
      expect(cell.textContent!.trim()).toBe('');
      expect(cell.textContent).not.toContain('0');
      expect(cell.textContent).not.toContain('—');
    }
    const footSums = document.querySelectorAll('.shipment-debit-totals__sum');
    expect(footSums.length).toBe(4);
    for (const sum of footSums) expect(sum.textContent).toBe('—');
  });

  it('AC-5: pane bleeds edge-to-edge — exact gutter calc width + negative inline margins', () => {
    const pane = block(/\.shipment-debit-pane/);
    expect(pane).toMatch(/margin-inline:\s*calc\(\s*-12px\s*-\s*var\(--app-body-pad-x,\s*24px\)\s*\)/);
    expect(pane).toMatch(/width:\s*calc\(\s*100%\s*\+\s*24px\s*\+\s*2\s*\*\s*var\(--app-body-pad-x,\s*24px\)\s*\)/);
  });

  it('AC-6: two rows (one LOCKED) render, the row menu opens, warn classes exist in CSS', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow({ shipmentId: 801, billOrBookNumber: 'BL-A', code: 'SHP-26-0801' }),
        lclRow({ shipmentId: 802, billOrBookNumber: 'BL-B', code: 'SHP-26-0802', lockStatus: 'LOCKED' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-A');
    expect(screen.getAllByText('BL-B').length).toBeGreaterThan(0);
    expect(screen.getByText('Đã khóa')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hành động lô BL-A' }));
    expect(screen.getByRole('menu', { name: 'Hành động lô BL-A' })).toBeTruthy();

    const css = cssSource();
    expect(css).toMatch(/\.shipment-debit-money--warn/);
    expect(css).toMatch(/\.shipment-debit-totals__sum--warn/);
    expect(css).toMatch(/\.shipment-debit-group__sum--warn/);
  });
});
