/**
 * Card 20261008_1 sweep — /dispatch-detail action buttons that disabled
 * silently must explain themselves through the aria-described +
 * aria-disabled pattern (components/shared/DisabledActionTip, landed by card
 * 081026093510). This file pins the grid retry, the filter reset, the quick
 * issue button and the pair dialog; the plan-editor
 * cell pins live in DispatchPlanEditorCell.disabled-reason.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import type { DispatchShipmentResponse } from '../../../api/shipmentClient';
import type * as DispatchPlanningClientModule from '../../../api/dispatchPlanningClient';
import type * as UseCatalogsModule from '../../../hooks/useCatalogs';
import type * as UseCatalogQueriesModule from '../../../hooks/useCatalogQueries';

const listFleet = vi.hoisted(() => vi.fn());
vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => {
  const actual = await importOriginal<typeof DispatchPlanningClientModule>();
  return { ...actual, listDispatchFleetResources: listFleet };
});
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getTrip: vi.fn(), createPair: vi.fn() },
}));
const useTripDetailMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useTripQueries', () => ({ useTripDetail: useTripDetailMock }));
const catalogsMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCatalogs', async (importOriginal) => ({
  ...await importOriginal<typeof UseCatalogsModule>(),
  useCatalogs: catalogsMock,
}));
const trucksDriversMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCatalogQueries', async (importOriginal) => ({
  ...await importOriginal<typeof UseCatalogQueriesModule>(),
  useTrucksAndDrivers: trucksDriversMock,
}));
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => ({ tags: [{ id: 1, label: 'Đặt đầu' }], isLoading: false, error: null }),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(async (label: string) => ({ id: 99, label })), isCreating: false }),
}));

import { tripClient } from '../../../api/tripClient';
import { MonthProvider } from '../../../hooks/useMonth';
import { DetailedPlanGrid } from './DetailedPlanGrid';
import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS, createDefaultDetailedPlanFilters } from './useDispatchDetailPlan';
import { QuickIssueOrderButton } from './QuickIssueOrderButton';
import { PairTripsDialog } from './PairTripsDialog';

function reasonOf(button: HTMLElement): string {
  const reasonId = button.getAttribute('aria-describedby');
  expect(reasonId).toBeTruthy();
  return document.getElementById(reasonId!)?.textContent ?? '';
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthProvider>{ui}</MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho', routeName: 'LH — Biên Hòa' },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'TGHU1111111', containerTypeLabel: "20'GP", cargoWeightKg: '11000.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51D-123', tripId: null, tripStatus: null, pairKind: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

function renderGrid(extraProps: Record<string, unknown>) {
  return render(wrap(
    <DetailedPlanGrid
      filters={EMPTY_DETAILED_PLAN_FILTERS}
      onFilterChange={vi.fn()}
      loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
      loadPickupPortFacets={vi.fn().mockResolvedValue([])}
      loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
      items={[]}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      assignmentError={null}
      lotBanner={null}
      onClearLotBanner={vi.fn()}
      presence={null}
      zones={[]}
      sortKey={null}
      sortDirection="asc"
      onToggleSort={vi.fn()}
      onAtomicSave={vi.fn()}
      onCompleteExternalTrip={vi.fn()}
      onIssueOrder={vi.fn()}
      {...extraProps}
    />,
  ));
}

describe('DetailedPlanGrid retry (card 20261008_1 sweep)', () => {
  it('while a cold load is in flight the retry explains its busy disable and stays inert', () => {
    const onRetry = vi.fn();
    renderGrid({ error: 'Không tải được kế hoạch chi tiết.', loading: true, onRetry });
    const retry = screen.getByRole('button', { name: 'Thử lại' });
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).not.toBeDisabled();
    expect(reasonOf(retry)).toBe('Đang tải dữ liệu…');
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('an idle retry carries no reason and retries', () => {
    const onRetry = vi.fn();
    renderGrid({ error: 'Không tải được kế hoạch chi tiết.', loading: false, onRetry });
    const retry = screen.getByRole('button', { name: 'Thử lại' });
    expect(retry).not.toHaveAttribute('aria-disabled');
    expect(retry).not.toHaveAttribute('aria-describedby');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('DetailedPlanFilters clear (card 20261008_1 sweep)', () => {
  const baseProps = () => ({
    filters: { ...EMPTY_DETAILED_PLAN_FILTERS },
    onChange: vi.fn(),
    loadDeliveryPointFacets: vi.fn().mockResolvedValue([]),
    loadPickupPortFacets: vi.fn().mockResolvedValue([]),
    loadDropoffPortFacets: vi.fn().mockResolvedValue([]),
    zones: [{ code: 'LACH_HUYEN', label: 'Lạch Huyện' }],
  });

  it('without active filters the reset explains there is nothing to clear and stays inert', () => {
    const props = baseProps();
    render(wrap(<DetailedPlanFilters {...props} />));
    const clear = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(clear).toHaveAttribute('aria-disabled', 'true');
    expect(clear).not.toBeDisabled();
    expect(reasonOf(clear)).toBe('Không có bộ lọc nào đang áp dụng.');
    fireEvent.click(clear);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('with an active filter the reset is armed and resets', () => {
    const props = { ...baseProps(), filters: { ...EMPTY_DETAILED_PLAN_FILTERS, q: '51D' } };
    render(wrap(<DetailedPlanFilters {...props} />));
    const clear = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(clear).not.toHaveAttribute('aria-disabled');
    expect(clear).not.toHaveAttribute('aria-describedby');
    fireEvent.click(clear);
    expect(props.onChange).toHaveBeenCalledWith(createDefaultDetailedPlanFilters());
  });
});

describe('QuickIssueOrderButton (card 20261008_1 sweep)', () => {
  const quickRow = (carrierType: 'OWN' | 'EXTERNAL' = 'OWN') => ({
    fulfillmentId: 1, version: 3, shipmentId: 4, shipmentCode: 'VID-DSP', taskStatus: 'READY',
    container: { containerNumber: 'CSQU3054383' }, docs: { billNumber: 'VID-DSP-BL' },
    time: { deliveryDate: '2026-09-15', runHour: 14, runAt: '2026-09-15T07:17:00.000Z' },
    dispatch: { carrierType, assignedPlate: '15H-012.34', externalCarrierId: carrierType === 'EXTERNAL' ? 8 : null, externalCarrierVehicleId: null },
  } as DispatchDetailPlanRow);

  beforeEach(() => {
    vi.clearAllMocks();
    listFleet.mockResolvedValue({ items: [{ id: 12, licensePlate: '15H-012.34', assignedDriverId: 34, assignedDriverName: 'Anh Bình' }] });
  });

  it('while an issue is in flight the button explains the busy disable', async () => {
    // Executor form on purpose: Promise.withResolvers is outside this
    // project's TS lib (TS2550).
    let resolveIssue: (value: DispatchShipmentResponse) => void = () => {};
    const issue = vi.fn(() => new Promise<DispatchShipmentResponse>((resolve) => { resolveIssue = resolve; }));
    render(wrap(<QuickIssueOrderButton row={quickRow()} onIssueOrder={issue} />));
    fireEvent.click(screen.getByRole('button', { name: 'Phát lệnh · CSQU3054383' }));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));

    const button = screen.getByRole('button', { name: 'Đang phát lệnh · CSQU3054383' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(reasonOf(button)).toBe('Đang phát lệnh — vui lòng đợi.');
    resolveIssue({} as DispatchShipmentResponse);
  });

  it('idle it is armed (no reason) and releases the order', async () => {
    const issue = vi.fn().mockResolvedValue({});
    render(wrap(<QuickIssueOrderButton row={quickRow()} onIssueOrder={issue} />));
    const button = screen.getByRole('button', { name: 'Phát lệnh · CSQU3054383' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-describedby');
    fireEvent.click(button);
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
  });
});

describe('PairTripsDialog (card 20261008_1 sweep)', () => {
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
  const pairRow = (tripId: number) => row({
    taskStatus: 'DISPATCHED',
    dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51D-123', tripId, tripStatus: 'CREATED', pairKind: null },
  });
  const renderPair = () => render(
    <PairTripsDialog row={pairRow(900)} candidates={[pairRow(901)]} onClose={vi.fn()} onPaired={vi.fn()} />,
  );

  beforeEach(() => {
    vi.mocked(tripClient.createPair).mockReset();
    vi.mocked(tripClient.getTrip).mockReset();
    useTripDetailMock.mockReset();
  });

  it('without a partner picked the submit explains the missing partner and stays inert', () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    renderPair();
    const submit = screen.getByRole('button', { name: /^Ghép chuyến$/ });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).not.toBeDisabled();
    expect(reasonOf(submit)).toBe('Chọn lệnh ghép cùng để tiếp tục.');
    fireEvent.click(submit);
    expect(tripClient.createPair).not.toHaveBeenCalled();
  });

  it('while the base trip loads the submit explains the loading disable', () => {
    useTripDetailMock.mockReturnValue({ data: undefined, isLoading: true });
    renderPair();
    const submit = screen.getByRole('button', { name: /^Ghép chuyến$/ });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(reasonOf(submit)).toBe('Đang tải dữ liệu lệnh ghép…');
    fireEvent.click(submit);
    expect(tripClient.createPair).not.toHaveBeenCalled();
  });

  it('when the base trip fails to load the submit says so instead of the generic partner hint', () => {
    useTripDetailMock.mockReturnValue({ data: undefined, isLoading: false });
    renderPair();
    const submit = screen.getByRole('button', { name: /^Ghép chuyến$/ });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(reasonOf(submit)).toBe('Không tải được thông tin lệnh — thử mở lại.');
  });

  it('with a partner picked it is armed (no reason) and pairs', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901, version: 7 }));
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: [] } as never);

    renderPair();
    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));

    const submit = screen.getByRole('button', { name: /^Ghép chuyến$/ });
    expect(submit).not.toHaveAttribute('aria-disabled');
    expect(submit).not.toHaveAttribute('aria-describedby');
    fireEvent.click(submit);
    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(1));
  }, 20_000);

  it('a warned save leaves an enabled Xong acknowledge that closes the dialog', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901, version: 7 }));
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: ['Có phát sinh phí chờ.'] } as never);

    const onClose = vi.fn();
    render(<PairTripsDialog row={pairRow(900)} candidates={[pairRow(901)]} onClose={onClose} onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));

    // Disposition (sweep card 20261008_1): "Xong" is never disabled — a new
    // save clears the warning list and unmounts it, so its old
    // `disabled={saving}` was unreachable. Always enabled when present.
    const done = await screen.findByRole('button', { name: 'Xong' });
    expect(done).not.toHaveAttribute('aria-disabled');
    expect(done).not.toHaveAttribute('aria-describedby');
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 20_000);

  it('while a pair save is in flight the submit explains its busy disable and stays inert', async () => {
    useTripDetailMock.mockReturnValue({ data: tripDetail({ id: 900 }), isLoading: false });
    vi.mocked(tripClient.getTrip).mockResolvedValue(tripDetail({ id: 901, version: 7 }));
    vi.mocked(tripClient.createPair).mockResolvedValue({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: ['Có phát sinh phí chờ.'] } as never);

    const onClose = vi.fn();
    render(<PairTripsDialog row={pairRow(900)} candidates={[pairRow(901)]} onClose={onClose} onPaired={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Chọn lệnh ghép/i }));
    fireEvent.click(await screen.findByRole('option', { name: /TGHU1111111/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));
    await screen.findByRole('button', { name: 'Xong' });

    // Executor form on purpose: Promise.withResolvers is outside this
    // project's TS lib (TS2550).
    let resolvePair: (value: unknown) => void = () => {};
    vi.mocked(tripClient.createPair).mockReturnValue(new Promise((resolve) => { resolvePair = resolve; }) as never);
    fireEvent.click(screen.getByRole('button', { name: /^Ghép chuyến$/ }));
    await waitFor(() => expect(tripClient.createPair).toHaveBeenCalledTimes(2));

    // The save start clears the warning list, so "Xong" unmounts rather than
    // ever rendering disabled (disposition above).
    expect(screen.queryByRole('button', { name: 'Xong' })).toBeNull();

    const submit = screen.getByRole('button', { name: 'Đang ghép…' });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).not.toBeDisabled();
    expect(reasonOf(submit)).toBe('Đang ghép chuyến…');
    fireEvent.click(submit);
    expect(tripClient.createPair).toHaveBeenCalledTimes(2);

    resolvePair({ id: 55, status: 'ACTIVE', pairKind: 'KET_HOP', warnings: [] });
  }, 20_000);
});
