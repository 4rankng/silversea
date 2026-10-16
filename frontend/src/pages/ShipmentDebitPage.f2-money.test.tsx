/**
 * F-2 (card 161026113900, owner ruling b) — the money column reflects the
 * override channel: a member's CƯỚC VẬN TẢI (AUTO) cell reads 0₫ with the
 * override reason as the spec §3.2 "chú thích nhỏ bên dưới"; a lot whose
 * freight came from the snapshot channel carries no note.
 */
import { render, screen } from '@testing-library/react';
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

describe('F-2 — Cước vận tải (Auto) đọc kênh ghi đè (ruling b)', () => {
  it('renders the member 0₫ with the "Ghép cước cùng Bill" note beneath the money', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow({
          shipmentId: 201, billOrBookNumber: 'BL-P', code: 'SHP-26-0201',
          freightAuto: 3150000, receivableTotal: 3150000,
          revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2,
        }),
        lclRow({
          shipmentId: 202, billOrBookNumber: 'BL-M', code: 'SHP-26-0202',
          freightAuto: 0, receivableTotal: 0,
          revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 2,
          revGroupPrincipalRef: 'BL-P',
          freightOverrideReason: 'Ghép cước cùng Bill BL-P',
        }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-P');

    const note = screen.getByText('Ghép cước cùng Bill BL-P');
    expect(note.tagName).toBe('SMALL');
    // The note rides INSIDE the member's Cước vận tải (Auto) cell, under the
    // formatted 0₫ — not somewhere else on the row.
    const cell = note.closest('td')!;
    expect(cell.textContent).toContain('0');
    expect(screen.queryByText('Ghép cước cùng Bill BL-P', { selector: 'small:not(.shipment-debit-row__freight-note)' })).toBeNull();

    // The principal carries 100% and NO note (the snapshot-look of the cell
    // is unchanged when the override channel set no stamp).
    const principalRow = screen.getAllByText('BL-P')[0]!.closest('tr')!;
    expect(principalRow.querySelector('.shipment-debit-row__freight-note')).toBeNull();
    expect(principalRow.textContent).toContain('3.150.000');
  });

  it('renders no note when the snapshot channel produced the freight', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({ shipmentId: 203, billOrBookNumber: 'BL-S', code: 'SHP-26-0203', freightAuto: 1234000 })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-S');
    expect(screen.getByText('1.234.000')).toBeTruthy();
    expect(document.querySelector('.shipment-debit-row__freight-note')).toBeNull();
  });
});
