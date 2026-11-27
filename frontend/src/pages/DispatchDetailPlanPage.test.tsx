import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type * as UseDispatchDetailPlanModule from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';

// The page owns the Tách nhóm confirmation toast; the dialog tree expects the
// Toast context, so this suite pins the hook quiet (same seam as the sibling
// lcl-assign-reason suite).
vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
  useToastOptional: () => ({ toast: vi.fn(), dismiss: vi.fn() }),
}));

// Card 211026005623 — the page now reads the role law (Xóa lô gate).
// SIL-694: the role is mutable per test so the external-close gate can pin
// the full allowlist matrix.
const auth = vi.hoisted(() => ({ role: 'ADMIN' as string }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 1, role: auth.role } }) }));

// The page's data owner is pinned; the grid still mounts the real
// PairTripsDialog so the test exercises the wiring this audit found dead
// (`onOpenPair` was never passed, so the "Ghép chuyến" button never rendered).
const plan = vi.hoisted(() => ({ refresh: vi.fn(), savePlan: vi.fn(), items: [] as DispatchDetailPlanRow[] }));

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
  tripClient: { getTrip: vi.fn(), createPair: vi.fn(), cancelTrip: vi.fn().mockResolvedValue({}) },
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
    // SIL-969: keep this page-wiring test off the pre-save weight confirm
    // (2×11t ≤ 24t) — that path is owned by PairTripsDialog.test.tsx.
    vehicleCapacityKg: '24000.00',
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
  plan.savePlan.mockReset();
  plan.items = [row(900), row(901)];
  useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
  vi.mocked(tripClient.getTrip).mockReset();
  vi.mocked(tripClient.createPair).mockReset();
  auth.role = 'ADMIN';
});

describe('DispatchDetailPlanPage — ghép chuyến wiring (DISP-DP-12)', () => {
  it('renders the row affordance (⋯ menu) and pairs the trip through the real dialog, then refreshes the plan', async () => {
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901 }));
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: [] } as never);

    renderPage();

    // Owner redesign 23/10: "Ghép chuyến" is a row ⋯ menu item, not an
    // inline button — open the first row's menu and pick it.
    const menus = screen.getAllByRole('button', { name: /Thao tác dòng · TGHU/ });
    expect(menus).toHaveLength(2);
    fireEvent.click(menus[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ghép chuyến' }));

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

    // Only the qualifying row's menu carries the item.
    const menus = screen.getAllByRole('button', { name: /Thao tác dòng · TGHU/ });
    expect(menus).toHaveLength(2);
    fireEvent.click(menus[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Ghép chuyến' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(menus[1]!);
    expect(screen.getByRole('menuitem', { name: 'Ghép chuyến' })).toBeTruthy();
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

    // SIL-524 (owner 27/10): the wide inline pill is gone — the verb rides
    // the row ⋯ menu, whose identity label carries the display reference
    // (never the internal shipment code).
    const opener = screen.getByRole('button', { name: `Thao tác dòng · ${expected}` });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hoàn thành' }));

    const dialog = await screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
    expect(dialog).toHaveTextContent(`Hoàn thành chuyến với xe ngoài ${expected}?`);
    expect(dialog).not.toHaveTextContent('SS-000200');
    expect(dialog).not.toHaveTextContent('dòng 900');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hủy' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Same row again on Cancel: the row's ⋯ trigger is the same node, and
    // its menu still offers the completion verb for this identity.
    expect(screen.getByRole('button', { name: `Thao tác dòng · ${expected}` })).toBe(opener);
    fireEvent.click(opener);
    expect(screen.getByRole('menuitem', { name: 'Hoàn thành' })).toBeTruthy();
    expect(plan.items).toHaveLength(1);
    expect(plan.refresh).not.toHaveBeenCalled();
  });
});

describe('DispatchDetailPlanPage — external completion role gate (SIL-694)', () => {
  // POST /trips/:id/complete-external is allowlisted server-side to
  // ADMIN/MANAGER/DISPATCHER/CUS (authz-grants exclusive row). ACCOUNTANT
  // and OPS read the dispatch board; giving them the actionable verb was the
  // click → 403 → unchanged row → click-again loop QA reported.
  const externalDispatchedRow = () => row(900, {
    dispatch: { ...row(900).dispatch, carrierType: 'EXTERNAL', tripStatus: 'IN_TRANSIT' },
  });

  it.each(['ADMIN', 'MANAGER', 'DISPATCHER', 'CUS'])('offers the Hoàn thành verb to %s', (role) => {
    auth.role = role;
    plan.items = [externalDispatchedRow(), row(901)];
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /Thao tác dòng · TGHU/ })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Hoàn thành' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
  });

  it.each(['ACCOUNTANT', 'OPS'])('offers no dead Hoàn thành verb to %s', (role) => {
    auth.role = role;
    plan.items = [externalDispatchedRow(), row(901)];
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: /Thao tác dòng · TGHU/ })[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Hoàn thành' })).toBeNull();
    // The menu itself still renders its other verbs — the gate hides one
    // affordance, not the row's whole action surface.
    expect(screen.getByRole('menuitem', { name: 'Hủy phân xe' })).toBeTruthy();
  });

  it('SIL-708: clicking Hủy phân xe opens confirm dialog, and on confirm cancels the trip and refreshes plan', async () => {
    auth.role = 'DISPATCHER';
    plan.items = [externalDispatchedRow()];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng · TGHU/ }));
    const cancelMenuBtn = screen.getByRole('menuitem', { name: 'Hủy phân xe' });
    expect(cancelMenuBtn).toBeTruthy();
    fireEvent.click(cancelMenuBtn);

    expect(screen.getByText(/Bạn có chắc chắn muốn hủy phân xe cho lô/)).toBeTruthy();
    const confirmBtn = screen.getByRole('button', { name: 'Hủy phân xe' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(tripClient.cancelTrip).toHaveBeenCalledWith(900);
      // SIL-753 r4 — the cancel endpoint clears the fulfillment's carrier
      // assignment in its own transaction (product decision 09/11: true
      // 'Chưa phân xe', every shape). The FE follow-up savePlan is GONE: the
      // SIL-751 status rewind bumps the lot version inside the same cancel,
      // so the stale-version save answered 409 'Lô hàng đã thay đổi' and
      // '4GS / Chờ bổ sung biển' stayed stuck (QA 09/11, lô QA1109-753B).
      expect(plan.savePlan).not.toHaveBeenCalled();
      expect(plan.refresh).toHaveBeenCalled();
    });
  });

  // SIL-1126 — the OTHER branch of the cancel flow: a row that is assigned
  // but has NO live trip (đã điều xe, chưa phát lệnh) has no trip to cancel —
  // confirm must unassign through the plan save (carrierType null +
  // clearVehicle) and leave the lot free for a new assignment, for BOTH
  // carrier kinds.
  it.each([
    ['OWN', { carrierType: 'OWN' as const, carrierName: 'SilverSea', externalCarrierId: null, assignedPlate: '15H-104.03' }],
    ['EXTERNAL', { carrierType: 'EXTERNAL' as const, carrierName: 'QA-TRUCK-2711', externalCarrierId: 77, assignedPlate: '99Q-99999' }],
  ])('SIL-1126: Hủy phân xe on an assigned %s row WITHOUT a live trip unassigns via the plan save', async (_kind, dispatch) => {
    auth.role = 'DISPATCHER';
    // The suite's beforeEach resets getTrip/createPair only — drop the
    // previous test's cancelTrip history so "never called" stays precise.
    vi.mocked(tripClient.cancelTrip).mockClear();
    plan.items = [row(900, {
      taskStatus: 'READY',
      dispatch: {
        ...dispatch,
        externalCarrierVehicleId: null,
        tripId: null,
        tripStatus: null,
        pairKind: null,
      },
    })];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng · TGHU/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hủy phân xe' }));

    // The no-trip confirm names the unassign (not a trip cancel).
    expect(screen.getByText(/Nhà xe và biển số dự kiến sẽ bị gỡ/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy phân xe' }));

    await waitFor(() => {
      expect(plan.savePlan).toHaveBeenCalledTimes(1);
      expect(tripClient.cancelTrip).not.toHaveBeenCalled();
      expect(plan.refresh).toHaveBeenCalled();
    });
    const body = (plan.savePlan.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(body.carrierType).toBeNull();
    expect(body.clearVehicle).toBe(true);
  });
});

describe('DispatchDetailPlanPage — the completion dialog quotes the payment-term reason before the close (K2.45 · SIL-1082)', () => {
  const REASON = 'Chưa xác định hạn thanh toán: nhà cung cấp liên kết đã bị xóa ("QA45-NT04" (#54)); hồ sơ nhà xe "QA45-NT04" (#74) cũng đã bị xóa.';

  function externalRow() {
    const existing = row(900);
    return row(900, {
      dispatch: { ...existing.dispatch, carrierType: 'EXTERNAL', tripId: 55, tripStatus: 'IN_TRANSIT' },
    });
  }

  function openDialog() {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Thao tác dòng · TGHU900' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hoàn thành' }));
    return screen.findByRole('dialog', { name: 'Xác nhận thao tác' });
  }

  it('fetches GET /trips/:id while the dialog is open and quotes the carrier reason before confirming', async () => {
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 55, paymentTermWarning: REASON }));
    plan.items = [externalRow()];

    const dialog = await openDialog();
    await waitFor(() => expect(tripClient.getTrip).toHaveBeenCalledWith(55));
    await waitFor(() => expect(dialog).toHaveTextContent(REASON));
    // Reason only: no completion happened — the close still rides [Hoàn thành chuyến].
    expect(plan.refresh).not.toHaveBeenCalled();
  });

  it('keeps the dialog quiet when the trip resolves no warning', async () => {
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 55 }));
    plan.items = [externalRow()];

    const dialog = await openDialog();
    await waitFor(() => expect(tripClient.getTrip).toHaveBeenCalledWith(55));
    // The identity sentence renders; no reason anywhere in the dialog.
    expect(dialog).toHaveTextContent('Hoàn thành chuyến với xe ngoài TGHU900?');
    expect(dialog).not.toHaveTextContent('hạn thanh toán');
  });
});
