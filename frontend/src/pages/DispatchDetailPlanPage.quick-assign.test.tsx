import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as DispatchPlanningClientModule from '../api/dispatchPlanningClient';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

// SIL-1139 (owner ruling 28/11 "disable/chặn dùng") — outside Gộp hàng mode
// with no lot picked, the toolbar [Gán xe] stays DISABLED under a
// DisabledActionTip naming the working path ('Vào Gộp hàng để chọn lô rồi
// gán xe.'): no navigation away, no in-place mode switch. The former HOT-04
// quick-assign entry (click → GÁN XE checkbox column) is blocked by this law;
// the mode machinery itself is retained pending an explicit owner call.
// Inside Gộp hàng the first toolbar branch owns [Gán xe] (≥2 picks, group
// assign) — pinned in DetailedPlanFilters.test.tsx.

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

describe('DispatchDetailPlanPage — SIL-1139 [Gán xe] outside Gộp hàng', () => {
  it('is disabled with a reason at zero picks and never enters a selection mode', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Gán xe' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById('detailed-plan-assign-quick-toggle-disabled-reason')?.textContent)
      .toBe('Vào Gộp hàng để chọn lô rồi gán xe.');
    fireEvent.click(button);
    // No GÁN XE checkbox column appears — the mode switch is dead; the
    // dispatcher stays on the filtered board.
    await screen.findByRole('table');
    expect(screen.queryByRole('checkbox', { name: /Chọn gán xe lô/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thoát gán xe' })).toBeNull();
    expect(screen.queryByRole('status', { name: /Đang chọn/ })).toBeNull();
  });
});
