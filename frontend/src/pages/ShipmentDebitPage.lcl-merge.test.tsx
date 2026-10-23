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

/** Spec 23/10 (261023110000 §2) — the CHỌN ticks are on-demand: every
 *  selection flow now starts by flipping the strip's [📦 Gộp hàng]. */
function openMergeMode() {
  fireEvent.click(screen.getByRole('button', { name: '📦 Gộp hàng' }));
}

describe('FB-093 — Ghép cước thu khách', () => {
  it('hides the ticks by default and arms the floating-bar merge CTA at ≥2 ungrouped lots (spec 23/10 §2)', async () => {
    listSummary.mockResolvedValue({
      items: [
        lclRow(),
        lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' }),
      ],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');

    // Default: no tick anywhere, no floating bar.
    expect(screen.queryByRole('checkbox', { name: /Chọn lô/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gộp xe thu khách' })).toBeNull();

    openMergeMode();

    // OPEN lots select now — merging is a pre-lock action.
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    // One pick: the floating bar is up and the CTA explains itself.
    const cta = screen.getByRole('button', { name: 'Gộp xe thu khách' });
    expect(cta.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Đang chọn 1 lô')).toBeTruthy();
    expect(screen.getByText(/Lô 1 giữ 100% tiền thu khách: BL-1/)).toBeTruthy();

    fireEvent.click(screen.getAllByText('BL-2')[0].closest('tr')!);
    // Re-query inside the wait: the bar re-renders with the new count.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Gộp xe thu khách' }).getAttribute('aria-disabled')).toBeNull();
    });
    expect(screen.getByText('Đang chọn 2 lô')).toBeTruthy();
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
    openMergeMode();
    fireEvent.click(screen.getAllByText('BL-1')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0].closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-3')[0].closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Gộp xe thu khách' }));

    // Same-customer gate names the conflict before any request leaves.
    expect(await screen.findByText(/cùng một khách hàng/)).toBeTruthy();
    expect(mergeRev).not.toHaveBeenCalled();

    // Drop the foreign lot; the merge proceeds in operator order (Lô 1 = BL-1).
    fireEvent.click(screen.getAllByText('BL-3')[0].closest('tr')!);
    // The bar CTA is the FIRST 'Gộp xe thu khách' button in the DOM (the
    // dialog's submit rides the body portal after it).
    fireEvent.click(screen.getAllByRole('button', { name: 'Gộp xe thu khách' })[0]!);
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
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    await waitFor(() => expect(mergeRev).toHaveBeenCalledWith(expect.objectContaining({
      shipmentIds: [101, 102],
      vehicleSizeClassId: 7,
    })));
  });

  // ── Card 161026232359 — the desktop tick + the [Gộp xe thu khách] gate ──
  it('gives every desktop row a leading checkbox that ticks exactly that lot (card 161026232359)', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow(), lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' })],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');
    openMergeMode();

    const rowA = screen.getAllByText('BL-1')[0]!.closest('tr')!;
    const rowB = screen.getAllByText('BL-2')[0]!.closest('tr')!;
    const checkA = within(rowA).getByRole('checkbox', { name: 'Chọn lô BL-1' });
    const checkB = within(rowB).getByRole('checkbox', { name: 'Chọn lô BL-2' });
    // The tick IS the first cell's content (tick beside [+], no tenth column).
    expect(rowA.querySelector('td')).toBe(checkA.closest('td'));
    expect(rowB.querySelector('td')).toBe(checkB.closest('td'));

    // One click, one toggle — the row-click alias must not double-toggle it.
    fireEvent.click(checkA);
    expect(checkA).toBeChecked();
    expect(rowA.getAttribute('data-selected')).not.toBeNull();
    expect(checkB).not.toBeChecked();
    expect(rowB.getAttribute('data-selected')).toBeNull();

    fireEvent.click(checkA);
    expect(checkA).not.toBeChecked();
    expect(rowA.getAttribute('data-selected')).toBeNull();

    // The whole-row click stays a selection ALIAS (kept, not removed): it
    // still selects and it keeps the tick in sync with the row state.
    fireEvent.click(rowB);
    expect(rowB.getAttribute('data-selected')).not.toBeNull();
    expect(within(rowB).getByRole('checkbox', { name: 'Chọn lô BL-2' })).toBeChecked();

    // Leaving the mode clears the picks and hides the ticks again (§2).
    fireEvent.click(screen.getByRole('button', { name: '✕ Thoát gộp hàng' }));
    expect(screen.queryByRole('checkbox', { name: /Chọn lô/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gộp xe thu khách' })).toBeNull();
  });

  it('arms Gộp xe thu khách from the checkbox picks and keeps the tick across expand/collapse (card 161026232359)', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow(), lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' })],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');
    openMergeMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' }));
    expect(screen.getByRole('button', { name: 'Gộp xe thu khách' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-2' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Gộp xe thu khách' })).not.toHaveAttribute('aria-disabled');
    });

    // Criterion 3 — the tick is the row's own state, not a transient highlight.
    fireEvent.click(screen.getByRole('button', { name: 'Mở chi tiết lô BL-1' }));
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng chi tiết lô BL-1' }));
    expect(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' })).toBeChecked();

    // …and the dialog opens with exactly those two picks, in click order.
    fireEvent.click(screen.getByRole('button', { name: 'Gộp xe thu khách' }));
    const dialog = await screen.findByRole('dialog');
    const lots = within(dialog).getAllByRole('listitem');
    expect(lots[0]!.textContent).toContain('Lô 1 · BL-1');
    expect(lots[1]!.textContent).toContain('Lô 2 · BL-2');
  });

  it('blocks mixed-customer checkbox picks with the same-customer message (card 161026232359)', async () => {
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
    openMergeMode();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gộp xe thu khách' }));
    expect(await screen.findByText(/cùng một khách hàng/)).toBeTruthy();
    expect(mergeRev).not.toHaveBeenCalled();
  });

  // ── Card 161026232409 — BKS Báo khách (xe ảo) picks from the catalog ──
  it('offers the fleet plate catalog in the merge BKS báo khách field, submits the pick and re-shows it (card 161026232409)', async () => {
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      trucks: [{ id: 9, licensePlate: '29C-111.22', trailerPlateNumber: null, trailerType: null, currentTrailerId: null }],
    });
    listSummary.mockResolvedValue({
      items: [lclRow(), lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' })],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');
    openMergeMode();
    // Row-click selection (the kept alias) — this red pins the OPTION LIST.
    fireEvent.click(screen.getAllByText('BL-1')[0]!.closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0]!.closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Gộp xe thu khách' }));
    const dialog = await screen.findByRole('dialog');

    // Class pick (required) then BKS báo khách = the dialog's second combobox.
    const classCombo = within(dialog).getAllByRole('combobox')[0]!;
    fireEvent.focusIn(classCombo);
    fireEvent.click(classCombo);
    fireEvent.change(classCombo, { target: { value: '3.5' } });
    fireEvent.click(await screen.findByRole('option', { name: /Xe 3\.5 tấn/ }));

    // Criterion 5 — the field lists the plates the caller handed in, not [].
    const bksCombo = within(dialog).getAllByRole('combobox')[1]!;
    fireEvent.focusIn(bksCombo);
    fireEvent.click(bksCombo);
    const plate = await screen.findByRole('option', { name: /29C-111\.22/ });
    fireEvent.click(plate);

    // The refetched list is the merged group: both lots carry the picked plate.
    listSummary.mockResolvedValue({
      items: [
        lclRow({
          revGroupId: 'rev-1', revGroupOrder: 1, revGroupMemberCount: 2, revVehicleClassCode: '3.5T',
          actualTruckNo: '51C-777.77', billingTruckNo: '29C-111.22',
        }),
        lclRow({
          shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002', revGroupId: 'rev-1',
          revGroupOrder: 2, revGroupMemberCount: 2, revVehicleClassCode: '3.5T',
          actualTruckNo: '51C-777.77', billingTruckNo: '29C-111.22',
        }),
      ],
      total: 2,
    });
    mergeRev.mockResolvedValue({
      groupId: 'g', memberCount: 2,
      members: [{ shipmentId: 101, order: 1, reference: 'BL-1' }, { shipmentId: 102, order: 2, reference: 'BL-2' }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    await waitFor(() => expect(mergeRev).toHaveBeenCalledWith(expect.objectContaining({
      shipmentIds: [101, 102],
      billingTruckNo: '29C-111.22',
    })));

    // Criterion 6 — the value is re-displayed on the merged lots afterwards
    // (the merge exits the on-demand mode, so the strip reopens via expand).
    fireEvent.click(await screen.findByRole('button', { name: /Mở chi tiết lô BL-1/ }));
    expect(await screen.findByText(/Báo khách \(Ảo\): 29C-111\.22/)).toBeTruthy();
    // Spec 23/10 §4.2 — finishing the merge exited the on-demand mode.
    expect(screen.queryByRole('checkbox', { name: /Chọn lô/ })).toBeNull();
  });

  it('still submits a free-typed BKS báo khách with the merge (card 161026232409)', async () => {
    listSummary.mockResolvedValue({
      items: [lclRow(), lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' })],
      total: 2,
    });
    renderPage();
    await screen.findAllByText('BL-1');
    openMergeMode();
    // Row-click selection (the kept alias) — this red pins the OPTION LIST.
    fireEvent.click(screen.getAllByText('BL-1')[0]!.closest('tr')!);
    fireEvent.click(screen.getAllByText('BL-2')[0]!.closest('tr')!);
    fireEvent.click(screen.getByRole('button', { name: 'Gộp xe thu khách' }));
    const dialog = await screen.findByRole('dialog');

    const classCombo = within(dialog).getAllByRole('combobox')[0]!;
    fireEvent.focusIn(classCombo);
    fireEvent.click(classCombo);
    fireEvent.change(classCombo, { target: { value: '3.5' } });
    fireEvent.click(await screen.findByRole('option', { name: /Xe 3\.5 tấn/ }));

    const bksCombo = within(dialog).getAllByRole('combobox')[1]!;
    fireEvent.focusIn(bksCombo);
    fireEvent.click(bksCombo);
    fireEvent.change(bksCombo, { target: { value: '51C-000.01' } });
    // The typed free value keeps the suggestion menu open (FB-066 lần 3's
    // suggestion-persistence fix) — dismiss it like a user moving to the
    // submit button does (react-aria scopes its modal popover over the
    // dialog while the list is open). The free-typed value stays in the field.
    fireEvent.keyDown(bksCombo, { key: 'Escape' });

    mergeRev.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    await waitFor(() => expect(mergeRev).toHaveBeenCalledWith(expect.objectContaining({
      billingTruckNo: '51C-000.01',
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
