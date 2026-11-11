/**
 * SIL-801 (id 927, QA 10/11, KB Ch1 §1.5.8 + Ch10 §10.8.3) — uncollected
 * receivables read warning amber on the Chi phí - Quyết toán board. The
 * TỔNG PHẢI THU KHÁCH figures (row cell, group subtotal, page foot) carry
 * `--warning-text` while known and non-zero; a settled 0 keeps its muted
 * ink, a pending figure keeps its blank cell, and the component money
 * columns never take the tone.
 */
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  ...(await importOriginal()),
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
  ...(await importOriginal()),
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

const amberRow = (over: Partial<ShipmentDebitLotRow> = {}, shipmentId = 101): ShipmentDebitLotRow => ({
  shipmentId,
  code: `SHP-26-0${shipmentId}`,
  customerName: 'KH A',
  factoryName: null,
  factoryAddress: null,
  billOrBookNumber: `BL-${shipmentId}`,
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
  revGroupMemberCount: null,
  costGroupMemberCount: null,
  revGroupPrincipalRef: null,
  costGroupPrincipalRef: null,
  actualTruckNo: null,
  billingTruckNo: null,
  costVehicleClassCode: null,
  revVehicleClassCode: null,
  revGroupOrder: null,
  ...over,
  customerId: over.customerId ?? 1,
});

beforeEach(() => {
  authRole.value = 'CUS';
  sessionStorage.clear();
  getBootstrap.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
});

describe('SIL-801 — uncollected receivables wear the warning amber tone', () => {
  it('marks a known non-zero receivable amber on the row, group subtotal and foot', async () => {
    listSummary.mockResolvedValue({
      items: [amberRow({ freightAuto: 10000000, receivableTotal: 306619500 })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-101');

    // Row cell: amber, and only the total column.
    const warnCells = document.querySelectorAll('td.shipment-debit-money--warn');
    expect(warnCells).toHaveLength(1);
    expect(warnCells[0].getAttribute('data-col')).toBe('total');
    expect(warnCells[0].textContent).toContain('306.619.500');

    // Group subtotal + page foot carry the tone.
    expect(document.querySelector('td.shipment-debit-group__sum--warn')).toBeTruthy();
    const foot = document.querySelector('td.shipment-debit-totals__sum--warn');
    expect(foot).toBeTruthy();
    expect(foot?.textContent).toContain('306.619.500');
  });

  it('keeps a settled 0 receivable muted and the component columns neutral', async () => {
    listSummary.mockResolvedValue({
      items: [
        amberRow({ freightAuto: 0, receivableTotal: 0 }),
        amberRow({ freightAuto: 250000, receivableTotal: 250000 }, 102),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-102');

    // The zero row: its total cell has no warn class; the muted zero span.
    const zeroRow = screen.getByText('BL-101').closest('tr')!;
    const zeroTotal = zeroRow.querySelector('td[data-col="total"]')!;
    expect(zeroTotal.classList.contains('shipment-debit-money--warn')).toBe(false);
    expect(zeroTotal.querySelector('.shipment-debit-money__zero')).toBeTruthy();
    // Freight column (250.000) never takes the tone — amber owns only the
    // receivable total; exactly one warn cell on the board (row 102's total).
    const freightCells = [...document.querySelectorAll('td.shipment-debit-money--warn')];
    expect(freightCells).toHaveLength(1);
    expect(freightCells[0].getAttribute('data-col')).toBe('total');
  });

  it('leaves a pending receivable as the blank cell - no tone, no fabricated 0', async () => {
    listSummary.mockResolvedValue({
      items: [amberRow({ freightAuto: null, receivableTotal: null })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-101');

    const row = screen.getByText('BL-101').closest('tr')!;
    const totalCell = row.querySelector('td[data-col="total"]')!;
    expect(totalCell.classList.contains('shipment-debit-money--warn')).toBe(false);
    // Owner 24/10 law: the pending money cell renders empty, never '0 ₫'.
    expect(totalCell.textContent).toBe('');
    // No warn anywhere on the group subtotal or the foot either.
    expect(document.querySelector('td.shipment-debit-group__sum--warn')).toBeNull();
    expect(document.querySelector('td.shipment-debit-totals__sum--warn')).toBeNull();
  });

  it('pins the amber ink on the --warning-text token in the stylesheet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentDebitPage.css'), 'utf8');
    expect(css).toMatch(
      /\.shipment-debit-money--warn,\n\.shipment-debit-group__sum--warn,\n\.shipment-debit-totals__sum--warn \{ color: var\(--warning-text\); \}/,
    );
  });
});
