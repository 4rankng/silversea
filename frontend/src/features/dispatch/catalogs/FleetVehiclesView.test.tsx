import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TruckStatus, DriverStatus } from '@tingting/shared';
import type { Truck, Driver, Trailer } from '@tingting/shared';

const { apiPost, invalidateAllCatalogs } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  invalidateAllCatalogs: vi.fn(async () => []),
}));

const fleetState = {
  data: { trucks: [] as Truck[], drivers: [] as Driver[] } as
    | { trucks: Truck[]; drivers: Driver[] }
    | undefined,
  isLoading: false,
  error: null as unknown,
};

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => fleetState,
  useTrailers: () => ({ data: [] as Trailer[] }),
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../../api/configClient', () => ({
  configClient: { getTrailers: vi.fn(async () => [] as Trailer[]) },
}));

vi.mock('../../../lib/api', () => ({
  api: { post: apiPost },
}));

vi.mock('../../../api/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/keys')>()),
  invalidateAllCatalogs,
}));

import { FleetVehiclesView } from './FleetVehiclesView';

const renderView = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetVehiclesView />
    </QueryClientProvider>,
  );
};

const truck = (overrides: Partial<Truck> = {}): Truck => ({
  id: 1,
  licensePlate: '51H-123.45',
  trailerPlateNumber: null,
  trailerType: null,
  currentTrailerId: null,
  status: TruckStatus.ACTIVE,
  nextInspectionDate: null,
  insuranceExpiryDate: null,
  lastOilServiceDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: 10,
  userId: null,
  name: 'Nguyễn Văn B',
  phone: '0901234567',
  assignedTruckId: 1,
  baseSalary: null,
  socialInsurance: null,
  status: DriverStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...overrides,
});

describe('FleetVehiclesView (dispatcher read-only)', () => {
  beforeEach(() => {
    fleetState.data = undefined;
    fleetState.isLoading = false;
    fleetState.error = null;
  });

  it('renders truck rows with plate, assigned driver, status', () => {
    fleetState.data = {
      trucks: [truck(), truck({ id: 2, licensePlate: '51H-999.99', status: TruckStatus.MAINTENANCE, currentTrailerId: 7 })],
      drivers: [driver()],
    };
    renderView();

    expect(screen.getByText('51H-123.45')).toBeTruthy();
    expect(screen.getByText('51H-999.99')).toBeTruthy();
    expect(screen.getByText('Nguyễn Văn B')).toBeTruthy();
    // "Hoạt động" appears in the KPI label and the ACTIVE status pill;
    // the maintenance pill is the only exact "Bảo trì" text.
    expect(screen.getAllByText('Hoạt động').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Bảo trì')).toBeTruthy();
  });

  it('shows loading then empty states', () => {
    fleetState.isLoading = true;
    const view = renderView();
    expect(screen.getByText('Đang tải…')).toBeTruthy();

    fleetState.isLoading = false;
    fleetState.data = { trucks: [], drivers: [] };
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FleetVehiclesView />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Chưa có xe đầu kéo nào')).toBeTruthy();
  });

  it('renders no edit/delete affordances — create only', () => {
    fleetState.data = { trucks: [truck()], drivers: [driver()] };
    renderView();
    expect(screen.queryByRole('button', { name: /sửa|xóa/i })).toBeNull();
    // The one mutation affordance is the header create button.
    expect(screen.getByRole('button', { name: /thêm xe đầu kéo/i })).toBeTruthy();
  });

  it('creates a tractor through the form modal and refreshes catalogs', async () => {
    apiPost.mockReset();
    apiPost.mockResolvedValueOnce({});
    fleetState.data = { trucks: [], drivers: [] };
    renderView();

    // Header opens the modal; the modal's own submit button is exactly "Thêm xe".
    fireEvent.click(screen.getByRole('button', { name: 'Thêm xe đầu kéo' }));
    fireEvent.change(screen.getByLabelText(/biển số xe đầu kéo/i), { target: { value: '51H-777.77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm xe' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/trucks', expect.objectContaining({
      licensePlate: '51H-777.77',
    })));
    await waitFor(() => expect(invalidateAllCatalogs).toHaveBeenCalled());
  });
});
