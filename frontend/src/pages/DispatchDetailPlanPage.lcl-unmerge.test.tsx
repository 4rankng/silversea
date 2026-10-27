/**
 * FB-095 (card 181026145610) — the un-merge confirm flow behind the group
 * badge on /dispatch-detail. The badge menu raises the leaving lot; this page
 * owns the SPEC §4 safety guard ("Lô 2 sẽ thành Lô chính và nhận 100% tiền"),
 * the `POST /api/shipments/lcl/unmerge` call, the result toast and the grid
 * refresh — pinned through the real grid and the real ConfirmDialog.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as UseCatalogQueriesModule from '../hooks/useCatalogQueries';
import type * as DispatchPlanningClientModule from '../api/dispatchPlanningClient';
import type * as ToastModule from '../components/shared/Toast';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

const plan = vi.hoisted(() => ({ refresh: vi.fn(), items: [] as DispatchDetailPlanRow[] }));
const unmergeLot = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());

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
// Card 211026005623 — the page now reads the role law (Xóa lô gate).
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }) }));

// Only the un-merge call is faked — the real module keeps every other export.
vi.mock('../api/dispatchPlanningClient', async (importOriginal) => ({
  ...await importOriginal<typeof DispatchPlanningClientModule>(),
  unmergeLclLot: unmergeLot,
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

function groupedRow(shipmentId: number, bill: string, order: number | null): DispatchDetailPlanRow {
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
        groupId: 'grp-9', order, memberCount: 2,
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

function openBadgeConfirm(badgeName: string) {
  fireEvent.click(screen.getByRole('button', { name: badgeName }));
  const menu = screen.getByRole('dialog');
  fireEvent.click(within(menu).getByRole('button', { name: 'Hủy ghép' }));
  return screen.getByRole('dialog', { name: 'Xác nhận thao tác' });
}

beforeEach(() => {
  plan.refresh.mockReset();
  unmergeLot.mockReset();
  toast.mockReset();
  plan.items = [groupedRow(31, 'CL4C-01', 1), groupedRow(32, 'CL4C-02', 2)];
});

describe('FB-095 — Hủy ghép confirm flow (FB095-UI-02 / FB095-UI-03)', () => {
  it('Lô 1: the guard names the promotion to Lô 2, confirm calls unmerge with COST and refreshes', async () => {
    unmergeLot.mockResolvedValue({
      dimension: 'COST',
      groupId: 'grp-9',
      leaver: { shipmentId: 31, order: 1, reference: 'CL4C-01' },
      promoted: { shipmentId: 32, order: 1, reference: 'CL4C-02' },
      transferredAmount: '2400000',
      remaining: [],
      dissolved: true,
    });
    renderPage();

    const confirm = openBadgeConfirm('Ghép (1/2)');
    expect(within(confirm).getByText(/Hủy ghép nhóm 2 lô\?/)).toBeTruthy();
    expect(within(confirm).getByText(/Lô 2 sẽ thành Lô chính và nhận 100% tiền cước trả ĐV/)).toBeTruthy();
    expect(within(confirm).getByText(/Nhóm giải tán vì chỉ còn một lô/)).toBeTruthy();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Hủy ghép' }));
    await waitFor(() => expect(unmergeLot).toHaveBeenCalledWith({ shipmentId: 31, dimension: 'COST' }));
    await waitFor(() => expect(plan.refresh).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'success',
      message: expect.stringMatching(/Bill CL4C-02 nhận 100% cước trả ĐV/),
    }));
  });

  it('non-principal lot: the guard says Lô 1 keeps the money — no promotion claim', () => {
    renderPage();

    const confirm = openBadgeConfirm('Ghép (2/2)');
    expect(within(confirm).getByText(/Lô 1 giữ nguyên 100% tiền cước trả ĐV/)).toBeTruthy();
    expect(within(confirm).queryByText(/Lô 2 sẽ thành Lô chính/)).toBeNull();

    fireEvent.click(within(confirm).getByRole('button', { name: 'Hủy' }));
    expect(unmergeLot).not.toHaveBeenCalled();
    expect(plan.refresh).not.toHaveBeenCalled();
  });

  it('server refusal (nhóm đã chốt kế toán) surfaces verbatim and does not refresh', async () => {
    unmergeLot.mockRejectedValue(new Error('Nhóm ghép đã chốt kế toán — không thể tách nhóm'));
    renderPage();

    const confirm = openBadgeConfirm('Ghép (1/2)');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Hủy ghép' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Nhóm ghép đã chốt kế toán — không thể tách nhóm',
    }));
    expect(plan.refresh).not.toHaveBeenCalled();
  });
});
