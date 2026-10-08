import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

// The page's data owner is pinned; the grid still mounts the real
// PairTripsDialog so the test exercises the wiring this audit found dead
// (`onOpenPair` was never passed, so the "Ghép chuyến" button never rendered).
const plan = vi.hoisted(() => ({ refresh: vi.fn(), items: [] as DispatchDetailPlanRow[] }));

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

// The reassign overlay is a sibling flow with its own test; pin it so this
// page test never reaches the catalog endpoints.
vi.mock('../features/dispatch/detailed-plan/TripReassignDialog', () => ({
  TripReassignDialog: () => null,
}));

// The editor dialog's note composer pulls the tag pool via react-query.
vi.mock('../features/dispatch/detailed-plan/useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));

const useTripDetailMock = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useTripQueries', () => ({ useTripDetail: useTripDetailMock }));

vi.mock('../api/tripClient', () => ({
  tripClient: { getTrip: vi.fn(), createPair: vi.fn() },
}));

import { tripClient } from '../api/tripClient';
import { MonthProvider } from '../hooks/useMonth';
import DispatchDetailPlanPage from './DispatchDetailPlanPage';

function tripDetail(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    id: 900,
    version: 4,
    plannedStartAt: '2026-09-08T08:00:00.000Z',
    plannedEndAt: '2026-09-08T12:00:00.000Z',
    canonicalOrigin: 'Cảng Cát Lái',
    canonicalDestination: 'Kho Bình Dương',
    cargoWeightKg: '11000.00',
    vehicleCapacityKg: '18000.00',
    ...overrides,
  } as unknown as TripDetail;
}

function row(tripId: number, overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow {
  return {
    fulfillmentId: tripId,
    version: 3,
    shipmentId: 11,
    shipmentVersion: 5,
    shipmentCode: 'SS-000200',
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    taskStatus: 'DISPATCHED',
    time: { deliveryDate: '2026-09-08', runHour: 8 },
    customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho', routeName: 'LH — Biên Hòa' },
    docs: { billNumber: `BL-${tripId}`, tradeDirection: 'EXPORT', declarationNumbers: [] },
    container: { containerNumber: `TGHU${tripId}`, containerTypeLabel: "20'GP", cargoWeightKg: '11000.00' },
    notes: { vehicleNote: null, customerNote: null },
    dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51D-123', tripId, tripStatus: 'CREATED', pairKind: null },
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
  plan.refresh.mockReset();
  plan.items = [row(900), row(901)];
  useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
  vi.mocked(tripClient.getTrip).mockReset();
  vi.mocked(tripClient.createPair).mockReset();
});

describe('DispatchDetailPlanPage — ghép chuyến wiring (DISP-DP-12)', () => {
  it('renders the row affordance and pairs the trip through the real dialog, then refreshes the plan', async () => {
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901 }));
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: [] } as never);

    renderPage();

    const pairButtons = screen.getAllByRole('button', { name: 'Ghép chuyến' });
    expect(pairButtons).toHaveLength(2);
    expect(pairButtons.map(button => button.textContent?.trim())).toEqual(['Ghép', 'Ghép']);
    expect(pairButtons[0]).toHaveAttribute('title', 'Ghép chuyến · TGHU900');
    fireEvent.click(pairButtons[0]);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ghép chuyến điều vận');

    fireEvent.click(within(dialog).getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU901/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Ghép chuyến$/ }));

    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
    expect(vi.mocked(tripClient.createPair).mock.calls[0][0].firstTripId).toBe(900);
    // Card 20261003_353 added a plan refresh when the dialog opens; pairing
    // then refreshes again — 2 calls is the pinned intended behavior.
    expect(plan.refresh).toHaveBeenCalledTimes(2);
    // A warning-free pair closes the dialog with the grid's fresh data.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }, 20_000);

  it.each([
    { label: 'without a trip', dispatch: { tripId: null } },
    { label: 'with an external carrier', dispatch: { carrierType: 'EXTERNAL' } },
    { label: 'already paired', dispatch: { pairKind: 'KEP' } },
    { label: 'canceled', dispatch: { tripStatus: 'CANCELED' } },
  ] as const)('offers no pair affordance for a row $label', ({ dispatch }) => {
    plan.items = [row(902, { dispatch: { ...row(902).dispatch, ...dispatch } }), row(901)];
    renderPage();

    expect(screen.getAllByRole('button', { name: 'Ghép chuyến' })).toHaveLength(1);
  });
});

describe('DispatchDetailPlanPage — external completion identity (UI52-B)', () => {
  it.each([
    { container: 'TGHU900', bill: 'BL-900', expected: 'TGHU900' },
    { container: null, bill: 'BL-900', expected: 'BL-900' },
    { container: null, bill: 'BK-900', expected: 'BK-900' },
    { container: null, bill: null, expected: 'Chưa có số Bill/Booking' },
    { container: '  ', bill: null, expected: 'Chưa có số Bill/Booking' },
  ] as const)('keeps $expected in the opened confirmation and returns to the same row on Cancel', async ({ container, bill, expected }) => {
    const existing = row(900);
    plan.items = [row(900, {
      container: { ...existing.container, containerNumber: container },
      docs: { ...existing.docs, billNumber: bill },
      dispatch: { ...existing.dispatch, carrierType: 'EXTERNAL' },
    })];
    renderPage();

    const opener = screen.getByRole('button', { name: `Hoàn thành · ${expected}` });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(dialog).toHaveTextContent(`Hoàn thành chuyến với xe ngoài ${expected}?`);
    expect(dialog).not.toHaveTextContent('SS-000200');
    expect(dialog).not.toHaveTextContent('dòng 900');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: `Hoàn thành · ${expected}` })).toBe(opener);
    expect(plan.items).toHaveLength(1);
    expect(plan.refresh).not.toHaveBeenCalled();
  });
});
