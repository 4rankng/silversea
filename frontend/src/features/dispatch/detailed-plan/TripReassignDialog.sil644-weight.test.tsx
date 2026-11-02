import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TripDetail } from '@tingting/shared';

vi.mock('../../../hooks/useTripQueries', () => ({
  useTripDetail: vi.fn(),
}));
const catalogsMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCatalogs', () => ({
  useCatalogs: catalogsMock,
}));
const trucksDriversMock = vi.hoisted(() => vi.fn());
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: trucksDriversMock,
}));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { reassignTrip: vi.fn() },
}));
const { listDispatchFleetResources, updateCusShipmentContainerLine } = vi.hoisted(() => ({
  listDispatchFleetResources: vi.fn(),
  updateCusShipmentContainerLine: vi.fn(),
}));
vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/dispatchPlanningClient')>()),
  listDispatchFleetResources,
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/shipmentClient')>()),
  updateCusShipmentContainerLine,
}));

import { useTripDetail } from '../../../hooks/useTripQueries';
import { tripClient } from '../../../api/tripClient';
import { TripReassignDialog, type TripReassignContainerContext } from './TripReassignDialog';

const useTripDetailMock = vi.mocked(useTripDetail);
const reassignMock = vi.mocked(tripClient.reassignTrip);
const lineWriteMock = updateCusShipmentContainerLine as unknown as ReturnType<typeof vi.fn>;
catalogsMock.mockReturnValue({ data: { customers: [], externalCarriers: [] } });
trucksDriversMock.mockReturnValue({ data: null });
listDispatchFleetResources.mockResolvedValue({ items: [], nextCursor: null });

/**
 * SIL-644 (id 749) wave 2 — the assignment-window weight write on the dialog
 * the dispatcher actually reaches for an issued-but-still-CREATED trip: the
 * row ⋯ menu's "Phân xe lại" (openEditor reroutes live-trip rows here — the
 * "Sửa điều phối" plan editor never opens for them). The staging dead-end row
 * (lô 285: dispatched, weight NULL) opens THIS dialog, so the weight field
 * must live here too. Law: editable while trip.status === 'CREATED', disabled
 * with the reason once the trip left CREATED; the write rides the same
 * cus-workspace container-line command the CUS ledger uses (DISPATCHER is an
 * allowed writer) BEFORE the reassign PATCH.
 */

const trip = (status: 'CREATED' | 'IN_TRANSIT') => ({
  id: 3,
  version: 3,
  status,
  carrierType: 'OWN',
  truckId: 20,
  driverId: 7,
  externalCarrierId: null,
  externalPlateNumber: null,
  externalDriverName: null,
  externalDriverPhone: null,
  truck: { id: 20, licensePlate: '15H-052.82' },
  driver: { id: 7, name: 'Phạm Văn Hùng' },
} as unknown as TripDetail);

const CONTAINER: TripReassignContainerContext = {
  shipmentId: 11,
  containerId: 777,
  cargoWeightKg: null,
  shipmentVersion: 5,
};

let queryClient: QueryClient;

function renderDialog(container: TripReassignContainerContext | null = CONTAINER) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TripReassignDialog tripId={3} container={container} onClose={vi.fn()} onReassigned={vi.fn()} />
    </QueryClientProvider>,
  );
}

function seedTrip(status: 'CREATED' | 'IN_TRANSIT') {
  useTripDetailMock.mockReturnValue({
    data: trip(status), isLoading: false, error: null, refetch: vi.fn(),
  } as never);
}

async function saveDialog() {
  fireEvent.change(screen.getByLabelText('Lý do điều chuyển *'), { target: { value: 'bổ sung trọng tải' } });
  fireEvent.click(screen.getByRole('button', { name: /Xác nhận phân xe lại/ }));
}

describe('SIL-644 — TripReassignDialog weight field (the assignment window)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    catalogsMock.mockReturnValue({ data: { customers: [], externalCarriers: [] } });
    trucksDriversMock.mockReturnValue({ data: null });
    listDispatchFleetResources.mockResolvedValue({ items: [], nextCursor: null });
    reassignMock.mockResolvedValue(trip('CREATED'));
    lineWriteMock.mockResolvedValue({ line: { shipmentVersion: 6 } });
  });

  it('renders the Trọng lượng field when the caller wires the container context, seeded from the container row', async () => {
    seedTrip('CREATED');
    renderDialog({ ...CONTAINER, cargoWeightKg: '21500.00' });
    await waitFor(() => expect(screen.getByText('Loại xe')).toBeTruthy());
    const weight = screen.getByLabelText('Trọng lượng');
    expect((weight as HTMLInputElement).disabled).toBe(false);
    expect((weight as HTMLInputElement).value).toBe('21500');
  });

  it('renders no weight field without the container context (other callers keep their dialog)', async () => {
    seedTrip('CREATED');
    renderDialog(null);
    await waitFor(() => expect(screen.getByText('Loại xe')).toBeTruthy());
    expect(screen.queryByLabelText('Trọng lượng')).toBeNull();
  });

  it('a CREATED trip keeps the weight editable and the save writes the line BEFORE the reassign', async () => {
    seedTrip('CREATED');
    renderDialog();
    await waitFor(() => expect(screen.getByText('Loại xe')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Trọng lượng'), { target: { value: '20000' } });
    await saveDialog();
    await waitFor(() => expect(lineWriteMock).toHaveBeenCalledTimes(1));
    expect(lineWriteMock).toHaveBeenCalledWith(11, 777, {
      expectedShipmentVersion: 5,
      cargoWeightKg: '20000',
    });
    // The reassign PATCH still runs — the weight write must not swallow it.
    await waitFor(() => expect(reassignMock).toHaveBeenCalledTimes(1));
  });

  it('an untouched weight never reaches the wire (omit = untouched)', async () => {
    seedTrip('CREATED');
    renderDialog();
    await waitFor(() => expect(screen.getByText('Loại xe')).toBeTruthy());
    await saveDialog();
    await waitFor(() => expect(reassignMock).toHaveBeenCalledTimes(1));
    expect(lineWriteMock).not.toHaveBeenCalled();
  });

  it('an IN_TRANSIT trip locks the field (disabled + reason, value stays visible) and saves no weight', async () => {
    seedTrip('IN_TRANSIT');
    renderDialog({ ...CONTAINER, cargoWeightKg: '21400.00' });
    await waitFor(() => expect(screen.getByText('Loại xe')).toBeTruthy());
    const weight = screen.getByLabelText('Trọng lượng');
    expect((weight as HTMLInputElement).disabled).toBe(true);
    expect((weight as HTMLInputElement).value).toBe('21400');
    expect(screen.getByText(/Đã phát hành lệnh điều xe/)).toBeTruthy();
    await saveDialog();
    await waitFor(() => expect(reassignMock).toHaveBeenCalledTimes(1));
    expect(lineWriteMock).not.toHaveBeenCalled();
  });

  it('a refused weight write aborts the reassign and surfaces the server message', async () => {
    seedTrip('CREATED');
    lineWriteMock.mockRejectedValue(Object.assign(
      new Error('Container đã gắn chuyến xe (TRP-9). Vui lòng đổi lịch trên chuyến xe hoặc gỡ phân xe trước khi sửa.'),
      { status: 409 },
    ));
    renderDialog();
    await waitFor(() => expect(screen.getByText('Loại xe')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Trọng lượng'), { target: { value: '20000' } });
    await saveDialog();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Container đã gắn chuyến xe'));
    expect(reassignMock).not.toHaveBeenCalled();
  });
});
