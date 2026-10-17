/**
 * Card 171026154000 (C) — the "Gán xe nhóm" action in the LCL selection bar
 * used to freeze behind a native `disabled` attribute whose only explanation
 * was a `title` tooltip (unreachable: a disabled control can be neither
 * focused nor hovered, and phone operators never see a title at all).
 *
 * Pinned here through the real grid (checkboxes → page selection state → bar):
 * - with ONE lot selected the reason is REAL text in the bar, the button
 *   carries aria-disabled + aria-describedby pointing at that text, and a
 *   click is guarded (no dialog);
 * - with TWO lots the reason disappears, the button enables and opens the
 *   group-assign dialog.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type * as UseCatalogQueriesModule from '../hooks/useCatalogQueries';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

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

// Sibling flows with their own tests — keep this one off their endpoints.
vi.mock('../features/dispatch/detailed-plan/TripReassignDialog', () => ({
  TripReassignDialog: () => null,
}));
vi.mock('../features/dispatch/detailed-plan/useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));

// The real group-assign dialog mounts on enable; its catalog reads are pinned
// quiet (shapes mirror AssignTruckGroupDialog.test.tsx).
const truckClasses = [
  { id: 12, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8, deletedAt: null },
];
vi.mock('../hooks/useCatalogQueries', async (importOriginal) => ({
  ...await importOriginal<typeof UseCatalogQueriesModule>(),
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
  useTrucksAndDrivers: () => ({ data: { trucks: [], drivers: [] }, isLoading: false }),
}));
vi.mock('../features/dispatch/master-plan/useCarrierAllocationOptions', () => ({
  useCarrierAllocationOptions: () => ({
    options: [
      { key: 'OWN', label: 'Đội xe nội bộ SilverSea', carrierType: 'OWN', externalCarrierId: null, isActive: true },
    ],
    empty: false,
    loading: false,
    error: false,
    reload: vi.fn(),
  }),
}));
// The real dialog calls useToast, which throws outside ToastProvider.
vi.mock('../components/shared/Toast', async (importOriginal) => ({
  ...await importOriginal<typeof import('../components/shared/Toast')>(),
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

import { MonthProvider } from '../hooks/useMonth';
import DispatchDetailPlanPage from './DispatchDetailPlanPage';

function lclRow(shipmentId: number, bill: string): DispatchDetailPlanRow {
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
    lcl: { packageCount: 3, packageType: 'KIỆN', cargoVolumeCbm: '2.000', group: null },
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

const REASON = 'Nhóm ghép cần ít nhất 2 lô — chọn thêm lô hàng lẻ.';

beforeEach(() => {
  plan.refresh.mockReset();
  plan.items = [lclRow(301, 'BL-301'), lclRow(302, 'BL-302')];
});

describe('171026154000 (C) — Gán xe nhóm explains itself as text', () => {
  it('one selected lot: visible reason, aria-described + aria-disabled, guarded click', () => {
    renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-301' }));

    const totals = screen.getByText(
      (_, element) => element?.classList.contains('lcl-selection-bar__totals') ?? false,
    );
    expect(totals.textContent).toMatch(/^Đang chọn 1 lô/);
    const reason = screen.getByText(REASON);
    expect(reason).toHaveAttribute('id', 'lcl-group-assign-reason');

    const assign = screen.getByRole('button', { name: 'Gán xe nhóm' });
    expect(assign).toHaveAttribute('aria-disabled', 'true');
    expect(assign).toHaveAttribute('aria-describedby', 'lcl-group-assign-reason');
    // Review hardening: the native attribute must never come back — a
    // natively disabled control is unfocusable, which is exactly the trap
    // this pattern exists to avoid.
    expect(assign).not.toHaveAttribute('disabled');
    expect(assign).toHaveAttribute('title', 'Gán xe nhóm trả ĐV');

    // aria-disabled does not block clicks — the handler guard must.
    fireEvent.click(assign);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('two selected lots: reason gone, enabled click opens the group dialog', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-301' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-302' }));

    expect(screen.queryByText(REASON)).toBeNull();
    const assign = screen.getByRole('button', { name: 'Gán xe nhóm' });
    expect(assign).not.toHaveAttribute('aria-disabled');
    expect(assign).not.toHaveAttribute('aria-describedby');

    fireEvent.click(assign);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Gán xe nhóm');
    expect(dialog).toHaveTextContent('2 lô lẻ');

    // Dropping back to one lot re-arms the reason (deselect the second).
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn lô BL-302' }));
    await waitFor(() => expect(screen.getByText(REASON)).toBeTruthy());
  });
});
