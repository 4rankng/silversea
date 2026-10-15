/**
 * FB-093 — CUS "Ghép cước thu khách" on Chi phí - Quyết toán: OPEN lots are
 * selectable (merging is pre-lock), the merge button arms on ≥2 ungrouped LCL
 * lots, the same-customer gate blocks mixed selections, and the expanded lot
 * shows the LCL facts strip (THÔNG SỐ CONTAINER / PHÂN XE / group notes).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary, mergeRev, unmerge, updateTruck } = vi.hoisted(() => ({
  getBootstrap: vi.fn(), listSummary: vi.fn(), mergeRev: vi.fn(), unmerge: vi.fn(), updateTruck: vi.fn(),
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
  mergeLclRevGroup: mergeRev,
  unmergeLclLot: unmerge,
  updateLclTruck: updateTruck,
  assignLclCostGroup: vi.fn(),
}));
const truckClasses = [
  { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
];
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));

import { ToastProvider } from '../components/shared/Toast';
import { ShipmentDebitPage } from './ShipmentDebitPage';
import type { ShipmentDebitLotRow } from '../api/shipmentClient';

function renderPage(initialEntry = '/shipments-debit?customer=1') {
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
  mergeRev.mockReset();
  unmerge.mockReset();
  updateTruck.mockReset();
  getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
  listSummary.mockResolvedValue({ items: [], total: 0 });
});

describe('FB-093 — Ghép cước thu khách', () => {
  it('selects OPEN LCL lots and arms the merge button at ≥2 ungrouped lots', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    const mergeButton = screen.getByRole('button', { name: 'Ghép cước thu khách' });
    expect(mergeButton.getAttribute('aria-disabled')).toBe('true');

    // OPEN lots select now — merging is a pre-lock action.
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0].closest('tr')!);
    // Re-query inside the wait: the tip wrapper can remount the button.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ghép cước thu khách' }).getAttribute('aria-disabled')).toBeNull();
    });
  });

  it('blocks mixed-customer selections in the dialog and merges same-customer lots', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' }),
        lclRow({ shipmentId: 103, billOrBookNumber: 'BL-3', code: 'SHP-26-0003', customerId: 2 }),
      ],
      total: 3,
    });
    renderPage();
    await screen.findAllByText('BL-1');
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-3')[0].closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Ghép cước thu khách' }));

    // Same-customer gate names the conflict before any request leaves.
    expect(await screen.findByText(/cùng một khách hàng/)).toBeTruthy();
    expect(mergeRev).not.toHaveBeenCalled();

    // Drop the foreign lot; the merge proceeds in operator order (Lô 1 = BL-1).
    fireEvent.click(screen.getAllByText('BL-3')[0].closest('tr')!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghép cước thu khách' })[0]!);
    const dialog = await screen.findByRole('dialog');
    const lots = within(dialog).getAllByRole('listitem');
    expect(lots[0]!.textContent).toContain('Lô 1 · BL-1');
    expect(lots[1]!.textContent).toContain('Lô 2 · BL-2');

    // Pick the class and submit. The combobox popover portals outside the
    // dialog node, so options are queried from the whole document.
    const combo = within(dialog).getAllByRole('combobox')[0]!;
    fireEvent.focusIn(combo);
    fireEvent.click(combo);
    fireEvent.change(combo, { target: { value: '3.5' } });
    const option = await screen.findByRole('option', {}, { timeout: 3000 });
    fireEvent.click(option);
    expect(option.textContent).toContain('Xe 3.5 tấn');
    mergeRev.mockResolvedValue({
      groupId: 'g', memberCount: 2,
      members: [{ shipmentId: 101, order: 1, reference: 'BL-1' }, { shipmentId: 102, order: 2, reference: 'BL-2' }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ghép cước thu khách' }));
    await waitFor(() => expect(mergeRev).toHaveBeenCalledWith(expect.objectContaining({
      shipmentIds: [101, 102],
      vehicleSizeClassId: 7,
    })));
  });

  it('shows the LCL facts strip (THÔNG SỐ CONTAINER / PHÂN XE / Ghép cùng Bill) in the expanded lot', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow({
        revGroupId: 'rev-1', revGroupOrder: 2, revGroupMemberCount: 3,
        revVehicleClassCode: '3.5T', costVehicleClassCode: '10T',
        costGroupId: 'cost-1', costGroupOrder: 2, costGroupMemberCount: 2,
        actualTruckNo: '29C-111.22', billingTruckNo: '30C-999.99',
        revGroupPrincipalRef: 'BL-9',
      })],
      total: 1,
    });
    renderPage();
    await screen.findAllByText('BL-1');
    fireEvent.click(screen.getByRole('button', { name: /Mở chi tiết lô BL-1/ }));

    expect(await screen.findByText('Lô lẻ | Thu: Xe 3.5T | Trả: Xe 10T')).toBeTruthy();
    expect(screen.getByText(/Báo khách \(Ảo\): 30C-999\.99/)).toBeTruthy();
    expect(screen.getByText('Ghép cước cùng Bill BL-9')).toBeTruthy();
    expect(screen.getByText('Thu khách: Ghép (2/3)')).toBeTruthy();
    expect(screen.getByText('Trả ĐV: Ghép (2/2)')).toBeTruthy();
  });
});
