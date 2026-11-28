import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as DispatchPlanningClientModule from '../api/dispatchPlanningClient';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

// SIL-1139 (owner ruling 28/11, QA builds 2d15ef50/61999831) — outside Gộp
// hàng the toolbar [Gán xe] is disabled under its reason (lots get selected
// only inside Gộp hàng): the click arms NO quick-assign mode and never
// navigates (the filter-wipe defect stays dead). The quick-assign flow for
// FCL rows stays reachable from the Gộp hàng selection — the CR-011.2
// describe below owns it. Inside Gộp hàng the first toolbar branch owns
// [Gán xe] (Gán xe nhóm) — pinned in DetailedPlanFilters.test.tsx.

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
  useToastOptional: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const toastMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ role: 'ADMIN' as string }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 1, role: auth.role } }) }));

const plan = vi.hoisted(() => ({ refresh: vi.fn(), savePlan: vi.fn(), items: [] as DispatchDetailPlanRow[] }));
const fleetResources = vi.hoisted(() => vi.fn());

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
      savePlan: plan.savePlan,
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

vi.mock('../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof DispatchPlanningClientModule>();
  return {
    ...actual,
    listDispatchFleetResources: fleetResources,
    deleteCusShipment: vi.fn(),
    unmergeLclGroup: vi.fn(),
    unmergeLclLot: vi.fn(),
  };
});

vi.mock('../features/dispatch/detailed-plan/TripReassignDialog', () => ({ TripReassignDialog: () => null }));
vi.mock('../features/dispatch/detailed-plan/useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));
const useTripDetailMock = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useTripQueries', () => ({ useTripDetail: useTripDetailMock }));
vi.mock('../api/tripClient', () => ({
  tripClient: { getTrip: vi.fn(), createPair: vi.fn(), cancelTrip: vi.fn().mockResolvedValue({}) },
}));

import { MonthProvider } from '../hooks/useMonth';
import DispatchDetailPlanPage from './DispatchDetailPlanPage';

function plannedRow(key: number, overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow {
  return {
    fulfillmentId: 400 + key,
    version: 3,
    shipmentId: 11,
    shipmentVersion: 5,
    shipmentCode: 'SS-000200',
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    taskStatus: 'PLANNED',
    time: { deliveryDate: '2026-09-08', runHour: 8 },
    customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho', routeName: 'LH — Biên Hòa' },
    docs: { billNumber: `BL-QA-${key}`, tradeDirection: 'EXPORT', declarationNumbers: [] },
    container: { containerNumber: `TGHU${key}`, containerTypeLabel: "20'GP", cargoWeightKg: '11000.00' },
    notes: { vehicleNote: null, customerNote: null },
    dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null, tripId: null, tripStatus: null, pairKind: null },
    ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
    isCombined: false,
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
    lotFullyPlated: false,
    ...overrides,
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

beforeEach(() => {
  vi.clearAllMocks();
  useTripDetailMock.mockReturnValue({ data: undefined, isLoading: false });
  plan.items = [plannedRow(1), plannedRow(2)];
  fleetResources.mockResolvedValue({ items: [] });
});

describe('DispatchDetailPlanPage — SIL-1139 [Gán xe] outside Gộp hàng is inert', () => {
  it('is disabled at zero picks; clicking flips no mode, opens no popup, navigates nowhere', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Gán xe' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(button);

    // No mode switch (the behavior QA bounced): the toolbar keeps [Gán xe] —
    // never [Thoát gán xe] — and the GÁN XE checkbox column never appears.
    expect(screen.queryByRole('button', { name: 'Thoát gán xe' })).toBeNull();
    await screen.findByRole('table');
    expect(screen.queryByRole('columnheader', { name: 'Gán xe' })).toBeNull();
    expect(screen.queryByText('Gán nhà xe nhanh (1 dòng)')).toBeNull();
  });
});

// CR-011.2 HOT-04 (QA 28/11 retest) — inside Gộp hàng the unassigned FCL
// rows tick (HOT-04 supersedes the LCL-only checkbox law), and [Gán xe]
// routes a selection holding cont rows to the quick-assign modal — the
// acceptance "tích chọn 2 dòng container chưa phân xe và gán nhanh ... thành
// công". runQuickAssign then saves each row individually (the per-row save
// the plan editor uses), and the ĐIỀU PHỐI column updates on the refresh.
describe('DispatchDetailPlanPage — CR-011.2 HOT-04 quick assign from Gộp hàng', () => {
  it('ticks unassigned FCL rows and [Gán xe] opens the quick-assign modal for them', async () => {
    plan.items = [
      plannedRow(1, { shipmentId: 11 }),
      plannedRow(2, { shipmentId: 12 }),
    ];
    renderPage();
    await screen.findByRole('table');

    // Enter Gộp hàng — the on-demand checkbox column appears.
    fireEvent.click(screen.getByRole('button', { name: 'Gộp hàng' }));

    // The two unassigned cont rows are TICKABLE now (they used to sit dimmed
    // behind the old LCL-only law).
    const firstTick = await screen.findByRole('checkbox', { name: 'Chọn lô BL-QA-1' });
    const secondTick = screen.getByRole('checkbox', { name: 'Chọn lô BL-QA-2' });
    expect(firstTick.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(firstTick);
    fireEvent.click(secondTick);

    // The floating bar reads the quick-assign session and [Gán xe nhanh]
    // carries the whole pick into QuickAssignCarrierModal.
    const bar = screen.getByRole('status');
    expect(bar.textContent).toContain('Đang chọn 2 dòng để gán nhà xe');
    fireEvent.click(within(bar).getByRole('button', { name: 'Gán xe nhanh' }));

    expect(await screen.findByText('Gán nhà xe nhanh (2 dòng)')).toBeTruthy();
  });
});
