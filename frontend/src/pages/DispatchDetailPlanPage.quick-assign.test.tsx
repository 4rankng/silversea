import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as DispatchPlanningClientModule from '../api/dispatchPlanningClient';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

// HOT-04 (CR-011.2) — quick-assign contract pins:
// 1. an LCL group member is NOT selectable (the group's plate is managed
//    group-wide; a per-row assign would split the shared BKS);
// 2. an OWN (SilverSea) assign without a truck saves carrier-only — no
//    truckId/plateNumber keys ride the wire (the BE clear path drops the old
//    vehicle block) and the row re-resolves from the live store before its
//    save, so same-lot siblings don't 409 on the version a sibling just bumped;
// 3. an OWN assign with a fleet truck rides truckId;
// 4. a partial failure keeps the selection open for retry with the succeeded
//    rows pruned out of the selection map.

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

async function openModalForSelectedRows(count: number) {
  fireEvent.click(screen.getByRole('button', { name: /Gán xe/ }));
  for (let i = 0; i < count; i += 1) {
    const checkbox = await screen.findByRole('checkbox', { name: `Chọn gán xe lô BL-QA-${i + 1}` });
    fireEvent.click(checkbox);
  }
  fireEvent.click(screen.getByRole('button', { name: `Gán nhà xe cho ${count} dòng đã chọn` }));
  await screen.findByText(`Gán nhà xe nhanh (${count} dòng)`);
  // Hold past the overlay's mount/animation settle so the select triggers are
  // interactive before picking.
  await waitFor(() => { expect(screen.getByText('Lưu gán xe')).toBeTruthy(); });
}

async function pickOption(triggerName: RegExp, optionName: string | RegExp) {
  // The trigger's accessible name is its placeholder — wait out the catalog
  // fetch ('Đang tải nhà xe…' / 'Đang tải đội xe…') before opening.
  fireEvent.click(await screen.findByRole('button', { name: triggerName }));
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useTripDetailMock.mockReturnValue({ data: undefined, isLoading: false });
  plan.items = [plannedRow(1), plannedRow(2)];
  fleetResources.mockImplementation((resource: string) => {
    if (resource === 'EXTERNAL_CARRIER') {
      return Promise.resolve({ items: [{ id: 77, name: 'KHÁCH TỰ VC' }] });
    }
    if (resource === 'TRUCK') {
      return Promise.resolve({ items: [{ id: 51, licensePlate: '51H-123.45' }] });
    }
    return Promise.resolve({ items: [] });
  });
});

describe('DispatchDetailPlanPage — HOT-04 quick assign', () => {
  it('excludes LCL group members from the quick-assign selection', async () => {
    plan.items = [
      plannedRow(1, { cargoMode: 'LCL', lcl: { packageCount: 3, packageType: 'Pallet', cargoVolumeCbm: null, group: { groupId: 'g1', order: 1, memberCount: 2 } } } as Partial<DispatchDetailPlanRow> as DispatchDetailPlanRow),
      plannedRow(2),
    ];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Gán xe/ }));
    const groupCheckbox = await screen.findByRole('checkbox', { name: 'Chọn gán xe lô BL-QA-1' });
    expect(groupCheckbox).toBeDisabled();
    const plainCheckbox = screen.getByRole('checkbox', { name: 'Chọn gán xe lô BL-QA-2' });
    expect(plainCheckbox).not.toBeDisabled();
  });

  it('saves an OWN assign without a truck as carrier-only and re-resolves each row from the live store', async () => {
    renderPage();
    await openModalForSelectedRows(2);
    await pickOption(/Chọn SilverSea hoặc nhà thầu ngoài/, 'SilverSea (Xe nhà)');

    // The real savePlan replaces the store row in place with the response's
    // bumped shipmentVersion — simulate exactly that mutation.
    plan.savePlan.mockImplementation(async (row: DispatchDetailPlanRow) => {
      row.shipmentVersion = 6;
      return row;
    });

    fireEvent.click(screen.getByText('Lưu gán xe'));
    await waitFor(() => expect(plan.savePlan).toHaveBeenCalledTimes(2));

    const [firstBody, secondBody] = plan.savePlan.mock.calls.map((call) => call[1]);
    expect(firstBody.carrierType).toBe('OWN');
    expect(firstBody.externalCarrierId).toBeNull();
    expect(firstBody).not.toHaveProperty('truckId');
    expect(firstBody).not.toHaveProperty('plateNumber');
    // Second sibling re-resolved from detailPlan.items AFTER the first save
    // bumped its version in place — no stale 5 riding the wire.
    expect(secondBody).toMatchObject({ carrierType: 'OWN' });
    expect(plan.savePlan.mock.calls[1][0].shipmentVersion).toBe(6);
    expect(plan.refresh).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('rides truckId when a fleet truck is picked for SilverSea', async () => {
    renderPage();
    await openModalForSelectedRows(1);
    await pickOption(/Chọn SilverSea hoặc nhà thầu ngoài/, 'SilverSea (Xe nhà)');
    await pickOption(/Chọn SilverSea trước|Để trống nếu chỉ gán SilverSea/, '51H-123.45');
    plan.savePlan.mockResolvedValue({});
    fireEvent.click(screen.getByText('Lưu gán xe'));
    await waitFor(() => expect(plan.savePlan).toHaveBeenCalledTimes(1));
    expect(plan.savePlan.mock.calls[0][1]).toMatchObject({ carrierType: 'OWN', truckId: 51 });
    expect(plan.savePlan.mock.calls[0][1]).not.toHaveProperty('plateNumber');
  });

  it('keeps the selection open on partial failure with the succeeded rows pruned', async () => {
    renderPage();
    await openModalForSelectedRows(2);
    await pickOption(/Chọn SilverSea hoặc nhà thầu ngoài/, 'SilverSea (Xe nhà)');

    plan.savePlan.mockImplementation(async (row: DispatchDetailPlanRow) => {
      row.shipmentVersion = 6;
      if (row.fulfillmentId === plan.items[0].fulfillmentId) throw new Error('Lô hàng đã thay đổi');
      return row;
    });

    fireEvent.click(screen.getByText('Lưu gán xe'));
    await waitFor(() => expect(plan.refresh).toHaveBeenCalled());

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    // Row 1 failed → its checkbox stays; row 2 succeeded → pruned from the
    // floating bar count so a retry only re-saves the failure.
    const bar = screen.getByRole('button', { name: 'Gán nhà xe cho 1 dòng đã chọn' });
    expect(bar).toBeInTheDocument();
  });
});
