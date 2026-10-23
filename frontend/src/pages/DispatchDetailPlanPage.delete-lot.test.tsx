/**
 * FB-095 (card 211026005623) — the Điều vận surface's "Xóa lô" flow behind
 * the row action on /dispatch-detail. The page owns the role law (CUS/ADMIN —
 * `requestShipmentDelete` 403s everyone else), the shared confirm + lý do
 * dialog and the FB-095 promote-law notice; the grid only raises the row.
 * Pinned through the real grid and the real ShipmentActionModal.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as UseCatalogQueriesModule from '../hooks/useCatalogQueries';
import type * as DispatchPlanningClientModule from '../api/dispatchPlanningClient';
import type * as ShipmentClientModule from '../api/shipmentClient';
import type * as ToastModule from '../components/shared/Toast';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';
import { Role } from '@tingting/shared';

const plan = vi.hoisted(() => ({ refresh: vi.fn(), items: [] as DispatchDetailPlanRow[] }));
const auth = vi.hoisted(() => ({ user: { userId: 7, role: 'ADMIN' as string } }));
const deleteLot = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

vi.mock('../features/dispatch/detailed-plan/useDispatchDetailPlan', async (importOriginal) => {
  const actual = await importOriginal<typeof UseDispatchDetailPlanModule>();
  return {
    ...actual,
    useDispatchDetailPlan: () => ({
      filters: actual.EMPTY_DETAILED_PLAN_FILTERS,
      updateFilters: vi.fn(),
      loadDeliveryPointFacets: vi.fn().mockResolvedValue([]),
      loadPickupPortFacets: vi.fn().mockResolvedValue([]),
      loadDropoffPortFacets: vi.fn().mockResolvedValue([]),
      items: plan.items,
      loading: false,
      error: null,
      assignmentError: null,
      lotBanner: null,
      clearLotBanner: vi.fn(),
      presence: null,
      zones: [],
      sortKey: null,
      sortDirection: 'asc' as const,
      toggleSort: vi.fn(),
      savePlan: vi.fn(),
      issueOrder: vi.fn(),
      ensureFulfillment: vi.fn(),
      autoOpenFulfillmentId: null,
      consumeAutoOpen: vi.fn(),
      total: plan.items.length,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      setPage: vi.fn(),
      refresh: plan.refresh,
    }),
  };
});

vi.mock('../features/dispatch/detailed-plan/TripReassignDialog', () => ({ TripReassignDialog: () => null }));
vi.mock('../features/dispatch/detailed-plan/useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));

// Only the delete call is faked — the real module keeps every other export.
vi.mock('../api/dispatchPlanningClient', async (importOriginal) => ({
  ...await importOriginal<typeof DispatchPlanningClientModule>(),
}));
vi.mock('../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  deleteCusShipment: deleteLot,
}));

vi.mock('../hooks/useCatalogQueries', async (importOriginal) => ({
  ...await importOriginal<typeof UseCatalogQueriesModule>(),
  useVehicleSizeClasses: () => ({ data: [], isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));
vi.mock('../features/dispatch/master-plan/useCarrierAllocationOptions', () => ({
  useCarrierAllocationOptions: () => ({
    options: [], empty: true, loading: false, error: false, reload: vi.fn(),
  }),
}));
vi.mock('../components/shared/Toast', async (importOriginal) => ({
  ...await importOriginal<typeof ToastModule>(),
  useToast: () => ({ toast, dismiss: vi.fn() }),
}));

import { MonthProvider } from '../hooks/useMonth';
import DispatchDetailPlanPage from './DispatchDetailPlanPage';

function lclRow(shipmentId: number, bill: string, order: number | null, memberCount = 2): DispatchDetailPlanRow {
  return {
    fulfillmentId: shipmentId,
    version: 1,
    shipmentId,
    shipmentVersion: 1,
    shipmentCode: 'SS-000300',
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    taskStatus: 'READY',
    time: { deliveryDate: '2026-10-20', runHour: 8 },
    customerRoute: { customerName: 'Công ty Lẻ', factoryName: null, deliveryPoint: null, routeName: null },
    docs: { billNumber: bill, tradeDirection: 'IMPORT', declarationNumbers: [] },
    container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '900.00' },
    lcl: {
      packageCount: 3,
      packageType: 'KIỆN',
      cargoVolumeCbm: '2.000',
      group: {
        groupId: 'grp-9', order, memberCount,
        actualTruckNo: '29C-333.33', billingTruckNo: '29C-333.33',
        vehicleClassCode: '5T', vehicleClassName: 'Xe 5 tấn',
      },
    },
    notes: { vehicleNote: null, customerNote: null },
    dispatch: {
      carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null,
      assignedPlate: null, tripId: null, tripStatus: null, pairKind: null,
    },
    ports: {
      pickupPortId: null, pickupPortName: null, pickupPortShortName: null,
      dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null,
    },
    isCombined: false,
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
    plannedEndAt: null,
    classification: 'SINGLE' as const,
    lotFullyPlated: false,
  } as DispatchDetailPlanRow;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthProvider>
          <DispatchDetailPlanPage />
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function openDeleteDialog(rowIdentity: string) {
  // Owner redesign 23/10: Xóa lô rides the row ⋯ menu (LAST item, danger
  // voice) — open the row's menu by identity, then pick the item.
  fireEvent.click(screen.getByRole('button', { name: `Thao tác dòng · ${rowIdentity}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Xóa lô' }));
  return screen.getByRole('dialog', { name: 'Xóa lô hàng' });
}

function fillReason(dialog: HTMLElement, reason: string) {
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: reason } });
}

beforeEach(() => {
  plan.refresh.mockReset();
  deleteLot.mockReset();
  toast.mockReset();
  auth.user = { userId: 7, role: 'ADMIN' };
  plan.items = [lclRow(31, 'CL4C-01', 1), lclRow(32, 'CL4C-02', 2)];
});

describe('FB-095 — Điều vận "Xóa lô" (FB095-UI-05..07, card 211026005623)', () => {
  it('FB095-UI-05a: ADMIN gets "Xóa lô" on every lot row — including the Lô chính row', () => {
    renderPage();
    // Both rows' ⋯ menus carry the destructive item (LAST position); the
    // principal row additionally keeps its group action (SPEC 18/10 §4).
    const openMenu = (identity: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Thao tác dòng · ${identity}` }));
      return screen.getAllByRole('menuitem');
    };
    const dismissMenu = () => fireEvent.keyDown(document, { key: 'Escape' });

    let items = openMenu('CL4C-01');
    expect(items[items.length - 1]).toHaveTextContent('Xóa lô');
    expect(items.some((item) => item.textContent === 'Tách nhóm')).toBe(true);
    dismissMenu();

    items = openMenu('CL4C-02');
    expect(items[items.length - 1]).toHaveTextContent('Xóa lô');
    expect(items.some((item) => item.textContent === 'Tách nhóm')).toBe(false);
    dismissMenu();
  });

  it('FB095-UI-05b: DISPATCHER gets the guard\'s law text instead of a delete execution (role law not loosened)', () => {
    auth.user = { userId: 9, role: Role.DISPATCHER };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Thao tác dòng · CL4C-01' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xóa lô' }));
    // Verbatim the `requestShipmentDelete` refusal — the affordance answers
    // with the guard's own reason (card 20260923_1) and never reaches the API.
    expect(screen.getByRole('alert').textContent).toBe(
      'Chỉ CUS hoặc Quản trị viên mới được yêu cầu xóa lô hàng.',
    );
    expect(screen.queryByRole('dialog', { name: 'Xóa lô hàng' })).toBeNull();
    expect(deleteLot).not.toHaveBeenCalled();
  });

  it('FB095-UI-06: host-lot delete names the FB-095 promotion, demands a reason, deletes, toasts and refreshes', async () => {
    deleteLot.mockResolvedValue(undefined);
    renderPage();

    const dialog = openDeleteDialog('CL4C-01');
    expect(within(dialog).getByText(/Lô này là Lô chính của nhóm 2 lô ghép trả ĐV/)).toBeTruthy();
    expect(within(dialog).getByText(/chuyển 100% cước trả ĐV cho lô kế tiếp/)).toBeTruthy();
    expect(within(dialog).getByText(/Nhóm giải tán vì chỉ còn một lô/)).toBeTruthy();

    const confirm = within(dialog).getByRole('button', { name: 'Xóa lô hàng' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fillReason(dialog, 'Nhập nhầm lô — xóa theo card 211026005623');
    fireEvent.click(confirm);

    await waitFor(() => expect(deleteLot).toHaveBeenCalledWith(
      31,
      1,
      'Nhập nhầm lô — xóa theo card 211026005623',
    ));
    await waitFor(() => expect(plan.refresh).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      message: 'Đã xóa lô CL4C-01',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xóa lô hàng' })).toBeNull());
  });

  it('FB095-UI-06b: a server refusal surfaces its verbatim reason and keeps the dialog open', async () => {
    deleteLot.mockRejectedValue(new Error(
      'Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.',
    ));
    renderPage();

    const dialog = openDeleteDialog('CL4C-01');
    fillReason(dialog, 'Thử xóa lô đã phát lệnh');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa lô hàng' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: 'Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.',
    })));
    expect(screen.getByRole('dialog', { name: 'Xóa lô hàng' })).toBeTruthy();
    expect(plan.refresh).not.toHaveBeenCalled();
  });

  it('FB095-UI-07: member-row delete names "Lô 1 giữ nguyên 100% cước" then deletes', async () => {
    deleteLot.mockResolvedValue(undefined);
    plan.items = [lclRow(31, 'CL4C-01', 1, 3), lclRow(32, 'CL4C-02', 2, 3), lclRow(33, 'CL4C-03', 3, 3)];
    renderPage();

    const dialog = openDeleteDialog('CL4C-02');
    expect(within(dialog).getByText(/Lô này là thành viên nhóm 3 lô ghép trả ĐV/)).toBeTruthy();
    expect(within(dialog).getByText(/Lô 1 giữ nguyên 100% cước; các thành viên còn lại được đánh số lại/)).toBeTruthy();
    expect(within(dialog).queryByText(/Nhóm giải tán/)).toBeNull();

    fillReason(dialog, 'Thành viên trùng lặp');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa lô hàng' }));
    await waitFor(() => expect(deleteLot).toHaveBeenCalledWith(32, 1, 'Thành viên trùng lặp'));
    await waitFor(() => expect(plan.refresh).toHaveBeenCalled());
  });
});
