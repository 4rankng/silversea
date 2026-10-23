/**
 * FB-093b — "Ghép cước thu khách" ARIA/role + click contract on the CUS
 * Chi phí - Quyết toán board (lclspec §3: checkbox đầu dòng từng lô + nút
 * [Ghép cước thu khách]; validation cùng 1 khách hàng; popup chọn loại xe +
 * BKS báo khách).
 *
 * Distinct from the lcl-merge suite (business flow): this file pins the
 * ACCESSIBILITY surface QA R25 re-verified — every manageable row carries a
 * role=checkbox named after its lot, the header action is a role=button whose
 * aria-disabled + aria-describedby state the arming reason, and the popup is
 * a role=dialog whose submit fires mergeLclRevGroup. A regression that hides
 * the button or flattens the tick to a row highlight fails here even when the
 * money math still works.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const { getBootstrap, listSummary, mergeRev } = vi.hoisted(() => ({
  getBootstrap: vi.fn(), listSummary: vi.fn(), mergeRev: vi.fn(),
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'CUS' } }) }));
vi.mock('../api/tripClient', () => ({ tripClient: { getBootstrap } }));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/shipmentClient')>(),
  listShipmentDebitSummary: listSummary,
  getShipmentDebitDetail: vi.fn(),
}));
vi.mock('../api/shipmentDebit', () => ({
  createDebitNoteBatch: vi.fn(),
  exportDebitNoteFile: vi.fn(),
}));
vi.mock('../api/dispatchPlanningClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/dispatchPlanningClient')>(),
  mergeLclRevGroup: mergeRev,
}));
const truckClasses = [
  { id: 5, code: '1.25T', name: 'Xe 1.25 tấn', isContainer: false, sortOrder: 1, deletedAt: null },
];
vi.mock('../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
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
  customerId: over.customerId ?? 1,
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
  revGroupMemberCount: null,
  revVehicleClassCode: null,
  actualTruckNo: null,
  billingTruckNo: null,
  ...over,
} as ShipmentDebitLotRow);

const twoSameCustomerLots = () => ({
  items: [
    lclRow(),
    lclRow({ shipmentId: 102, billOrBookNumber: 'BL-2', code: 'SHP-26-0002' }),
  ],
  total: 2,
});

describe('FB-093b — Gộp xe thu khách ARIA + click contract', () => {
  /** Owner redesign 23/10 — the ticks are permanent (Checkbox column); the
   *  merge CTA is the action-bar [Gộp hàng] button. */
  it('mỗi lô có role=checkbox đầu dòng mang tên lô, luôn hiển thị (redesign 23/10)', async () => {
    listSummary.mockResolvedValue(twoSameCustomerLots());
    renderPage();
    await screen.findAllByText('BL-1');

    // The ticks are permanent now — no on-demand mode, no floating bar.
    const tick1 = screen.getByRole('checkbox', { name: 'Chọn lô BL-1' }) as HTMLInputElement;
    const tick2 = screen.getByRole('checkbox', { name: 'Chọn lô BL-2' }) as HTMLInputElement;
    expect(tick1.checked).toBe(false);
    fireEvent.click(tick1);
    expect(tick1.checked).toBe(true);
    expect(tick2.checked).toBe(false);
    expect(screen.queryByText((_, element) => element?.classList.contains('lcl-selection-bar') ?? false)).toBeNull();
  });

  it('nút Gộp hàng: role=button, aria-disabled=true khi chưa đủ 2 lô, reason qua aria-describedby', async () => {
    listSummary.mockResolvedValue(twoSameCustomerLots());
    renderPage();
    await screen.findAllByText('BL-1');

    // One pick: the action-bar CTA explains itself.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' }));
    const button = screen.getByRole('button', { name: 'Gộp hàng' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('Chọn ít nhất 2 lô lẻ chưa ghép cước để ghép.');

    // Ticking the second lot arms it; ticking does not go through row clicks
    // here — the checkbox itself is the control under contract.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-2' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Gộp hàng' }).getAttribute('aria-disabled')).toBeNull(),
    );
  });

  it('click nút Gộp hàng → role=dialog: liệt kê Lô 1/Lô 2, combobox loại xe + BKS, submit gọi mergeLclRevGroup', async () => {
    listSummary.mockResolvedValue(twoSameCustomerLots());
    getBootstrap.mockResolvedValue({ customers: [{ id: 1, name: 'KH A' }], trucks: [] });
    renderPage();
    await screen.findAllByText('BL-1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-2' }));

    fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const lots = within(dialog).getAllByRole('listitem');
    expect(lots).toHaveLength(2);
    expect(lots[0]!.textContent).toContain('Lô 1 · BL-1');
    expect(lots[1]!.textContent).toContain('Lô 2 · BL-2');

    const combos = within(dialog).getAllByRole('combobox');
    expect(combos.length).toBeGreaterThanOrEqual(2);
    // The class field is required before submit; pick it then Gộp.
    fireEvent.focusIn(combos[0]!);
    fireEvent.click(combos[0]!);
    fireEvent.change(combos[0]!, { target: { value: '1.25' } });
    fireEvent.click(await screen.findByRole('option', { name: /Xe 1\.25 tấn/ }));

    mergeRev.mockResolvedValue({
      groupId: 'g', memberCount: 2,
      members: [{ shipmentId: 101, order: 1, reference: 'BL-1' }, { shipmentId: 102, order: 2, reference: 'BL-2' }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gộp xe thu khách' }));
    await waitFor(() => expect(mergeRev).toHaveBeenCalledWith(expect.objectContaining({
      shipmentIds: [101, 102],
      vehicleSizeClassId: 5,
    })));
  });
});
