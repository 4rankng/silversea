import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TripDetail } from '@tingting/shared';

vi.mock('../../../hooks/useTripQueries', () => ({
  useTripDetail: vi.fn(),
}));
vi.mock('../../../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { customers: [] } }),
}));
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => ({ data: null }),
}));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { reassignTrip: vi.fn() },
}));

import { useTripDetail } from '../../../hooks/useTripQueries';
import { tripClient } from '../../../api/tripClient';
import { qk } from '../../../api/keys';
import { TripReassignDialog } from './TripReassignDialog';

const useTripDetailMock = vi.mocked(useTripDetail);
const reassignMock = vi.mocked(tripClient.reassignTrip);

const TRIP = {
  id: 3,
  version: 3,
  carrierType: 'OWN',
  truckId: 20,
  driverId: 7,
  externalCarrierId: null,
  externalPlateNumber: null,
  externalDriverName: null,
  externalDriverPhone: null,
} as unknown as TripDetail;

/** Current test client — renderDialog recreates it per render. */
let queryClient: QueryClient;

function dialogElement() {
  return (
    <QueryClientProvider client={queryClient}>
      <TripReassignDialog tripId={3} onClose={vi.fn()} onReassigned={vi.fn()} />
    </QueryClientProvider>
  );
}

function renderDialog() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(dialogElement());
}

describe('TripReassignDialog — fetch-state rendering', () => {
  beforeEach(() => {
    useTripDetailMock.mockReset();
  });

  it('shows the loading label only while the trip fetch is in flight', () => {
    useTripDetailMock.mockReturnValue({
      data: undefined, isLoading: true, error: null, refetch: vi.fn(),
    } as never);
    renderDialog();
    expect(screen.getByText('Đang tải…')).toBeTruthy();
  });

  it('shows a recoverable error state instead of an eternal loading label when the fetch fails', () => {
    // Regression: the 2026-09-10 staging QA block — a failed fetch rendered
    // the eternal "Đang tải…" because the dialog had no error branch.
    useTripDetailMock.mockReturnValue({
      data: undefined, isLoading: false, error: new Error('request failed'), refetch: vi.fn(),
    } as never);
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được chuyến đi');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByText('Đang tải…')).toBeNull();
  });

  it('renders the reassignment form once the trip loads', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    renderDialog();
    expect(screen.getByText('Loại xe')).toBeTruthy();
    expect(screen.getByDisplayValue('Xe nhà')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TripReassignDialog — draft seeding across trip versions', () => {
  beforeEach(() => {
    useTripDetailMock.mockReset();
  });

  it('reseeds the draft when the served trip carries a new version after a reassign', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    const { rerender } = renderDialog();
    expect(screen.getByDisplayValue('Xe nhà')).toBeTruthy();

    // A successful reassign bumps the trip version. Whenever the hook serves
    // that new snapshot — a refetch landing on an open dialog, or the cached
    // pre-reassign copy being replaced on reopen — the draft must follow the
    // fresh data instead of staying on the stale pre-reassign fields.
    const REASSIGNED_TRIP = {
      ...TRIP,
      version: 4,
      carrierType: 'EXTERNAL',
      truckId: null,
      driverId: null,
      externalCarrierId: 9,
      externalPlateNumber: '60C-999.99',
    } as unknown as TripDetail;
    useTripDetailMock.mockReturnValue({
      data: REASSIGNED_TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    rerender(dialogElement());

    expect(screen.getByDisplayValue('Xe ngoài')).toBeTruthy();
    expect(screen.getByDisplayValue('60C-999.99')).toBeTruthy();
  });

  it('keeps in-progress edits when a refetch returns the same version', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    const { rerender } = renderDialog();
    fireEvent.change(screen.getByDisplayValue('Xe nhà'), { target: { value: 'EXTERNAL' } });
    expect(screen.getByDisplayValue('Xe ngoài')).toBeTruthy();

    // Same version, fresh snapshot object — must not reseed over the edit.
    useTripDetailMock.mockReturnValue({
      data: { ...TRIP }, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    rerender(dialogElement());

    expect(screen.getByDisplayValue('Xe ngoài')).toBeTruthy();
    expect(screen.queryByDisplayValue('60C-999.99')).toBeNull();
  });
});

// The reassign save must prime the trip-detail cache with the response —
// with the app-wide 5-minute staleTime, reopening would otherwise keep
// seeding the stale pre-reassign snapshot until a full page reload.
describe('TripReassignDialog — save primes the trip-detail cache', () => {
  beforeEach(() => {
    useTripDetailMock.mockReset();
    reassignMock.mockReset();
  });

  it('writes the reassign response into the cache so reopening seeds the saved values', async () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    const REASSIGNED = { ...TRIP, version: 4, truckId: 30, driverId: 9 } as unknown as TripDetail;
    reassignMock.mockResolvedValue(REASSIGNED);

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phân xe lại' }));

    await waitFor(() => expect(reassignMock).toHaveBeenCalledWith(3, expect.objectContaining({ expectedVersion: 3 })));
    // The fresh trip now rides the detail cache — the next open seeds the
    // SAVED truck/driver immediately, no refetch or reload required.
    await waitFor(() => expect(queryClient.getQueryData(qk.trips.detail('3'))).toEqual(REASSIGNED));
  });
});

// Acceptance lock — mirrors the server guard: an IN_TRANSIT trip whose
// driver acknowledged (ORDER_RECEIVED) shows the lock BEFORE form entry;
// CREATED trips stay reassignable (pre-acceptance correction right).
describe('TripReassignDialog — acceptance lock', () => {
  beforeEach(() => {
    useTripDetailMock.mockReset();
    reassignMock.mockReset();
  });

  it('shows a read-only lock for an acknowledged IN_TRANSIT trip — no inputs, no confirm control', () => {
    useTripDetailMock.mockReturnValue({
      data: {
        ...TRIP,
        status: 'IN_TRANSIT',
        driverAccepted: true,
        truck: { licensePlate: '15H-104.03' },
        driver: { name: 'Bùi Tiến Dũng' },
      } as unknown as TripDetail,
      isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    renderDialog();

    expect(screen.getByText(/Tài xế đã nhận việc/)).toBeTruthy();
    expect(screen.getByText('15H-104.03')).toBeTruthy();
    expect(screen.getByText('Bùi Tiến Dũng')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xác nhận phân xe lại' })).toBeNull();
    expect(screen.queryByText('Xe đầu kéo')).toBeNull();
  });

  it('keeps a CREATED trip editable even with acceptance on record', () => {
    useTripDetailMock.mockReturnValue({
      data: { ...TRIP, status: 'CREATED', driverAccepted: true } as unknown as TripDetail,
      isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    renderDialog();

    expect(screen.getByText('Xe đầu kéo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xác nhận phân xe lại' })).toBeTruthy();
  });

  it('a late conflict surfaces the error and refetches so the lock can land', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch,
    } as never);
    reassignMock.mockRejectedValue(new Error('Không thể điều chỉnh tác vụ đã được lái xe nhận việc.'));
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận phân xe lại' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('đã được lái xe nhận việc');
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
