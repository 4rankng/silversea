import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as DispatchPlanningClientModule from '../api/dispatchPlanningClient';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

// SIL-1233 (KB Ch.4 §4.1.3, spec of record) — the toolbar [Gán xe] IS the
// quick-assign entry again: the click arms the in-place selection mode (GÁN XE
// checkbox column on chưa-phân-xe / chờ-chọn-xe rows, FCL container rows
// included), the floating bar reads 'Gán nhà xe cho N dòng đã chọn', and its
// button opens the 'Gán nhà xe nhanh' popup in place — no navigation away
// (the wipe-the-filters defect SIL-1139 ruled on stays dead; its
// disable-at-zero-picks law had left the KB flow unreachable for every row
// shape). Inside Gộp hàng the first toolbar branch owns [Gán xe] (Gán xe
// nhóm) — pinned in DetailedPlanFilters.test.tsx.

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

describe('DispatchDetailPlanPage — SIL-1233 [+ Gán xe] opens the quick-assign flow for FCL rows', () => {
  it('arms the selection mode in place; an FCL row ticks; the floating bar opens the popup', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Gán xe' });
    fireEvent.click(button);

    // The mode arms IN PLACE: the toolbar flips to Thoát gán xe and the GÁN XE
    // checkbox column appears — FCL container rows tickable (both fixtures are
    // un-dispatched FCL rows). The dispatcher stays on the filtered board.
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Thoát gán xe' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /Chọn gán xe lô BL-QA-1/ }));

    expect(await screen.findByText('Đang chọn 1 dòng để gán nhà xe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhà xe cho 1 dòng đã chọn' }));

    // The popup the SIL-1158 (Tài xế) + SIL-1159 (fleet limit) fixes ride in.
    expect(await screen.findByText('Gán nhà xe nhanh (1 dòng)')).toBeTruthy();
  });
});
