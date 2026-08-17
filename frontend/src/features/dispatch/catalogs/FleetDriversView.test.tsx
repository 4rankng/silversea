import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TruckStatus, DriverStatus } from '@tingting/shared';
import type { Truck, Driver } from '@tingting/shared';

const { apiPost, invalidateAllCatalogs } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  invalidateAllCatalogs: vi.fn(async () => []),
}));

const fleetState = {
  data: undefined as { trucks: Truck[]; drivers: Driver[] } | undefined,
  isLoading: false,
  error: null as unknown,
};

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => fleetState,
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../../lib/api', () => ({
  api: { post: apiPost },
}));

vi.mock('../../../api/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/keys')>()),
  invalidateAllCatalogs,
}));

import { FleetDriversView } from './FleetDriversView';

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

describe('FleetDriversView (dispatcher read-only)', () => {
  beforeEach(() => {
    fleetState.data = undefined;
    fleetState.isLoading = false;
    fleetState.error = null;
  });

  it('renders driver rows with name, phone, assigned plate, status', () => {
    fleetState.data = {
      trucks: [truck()],
      drivers: [driver(), driver({ id: 11, name: 'Trần Thị C', phone: null, assignedTruckId: null, status: DriverStatus.INACTIVE })],
    };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FleetDriversView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Nguyễn Văn B')).toBeTruthy();
    expect(screen.getByText('0901234567')).toBeTruthy();
    expect(screen.getByText('51H-123.45')).toBeTruthy();
    expect(screen.getByText('Trần Thị C')).toBeTruthy();
    expect(screen.getByText('Ngưng')).toBeTruthy();
  });

  it('shows loading then empty states', () => {
    fleetState.isLoading = true;
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FleetDriversView />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Đang tải…')).toBeTruthy();

    fleetState.isLoading = false;
    fleetState.data = { trucks: [], drivers: [] };
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FleetDriversView />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Chưa có tài xế nào')).toBeTruthy();
  });

  it('renders no edit/delete affordances — create only', () => {
    fleetState.data = { trucks: [truck()], drivers: [driver()] };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FleetDriversView />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /sửa|xóa/i })).toBeNull();
    expect(screen.getByRole('button', { name: /thêm tài xế/i })).toBeTruthy();
  });

  it('creates a driver without salary fields and refreshes catalogs', async () => {
    apiPost.mockReset();
    apiPost.mockResolvedValueOnce({});
    fleetState.data = { trucks: [truck()], drivers: [] };
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FleetDriversView />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thêm tài xế' }));
    // Salary is hidden, not silently discarded — DISPATCHER creates are
    // identity-only; salary belongs to the governed admin flow.
    expect(screen.queryByLabelText(/lương cơ bản/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/họ và tên/i), { target: { value: 'Trần Văn Mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm lái xe' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/drivers', expect.objectContaining({
      name: 'Trần Văn Mới',
      // baseSalary must be stripped: DISPATCHER cannot make the governance
      // action a salaried driver create would route into.
      status: 'ACTIVE',
    })));
    expect(apiPost.mock.calls[0]?.[1]).not.toHaveProperty('baseSalary');
    await waitFor(() => expect(invalidateAllCatalogs).toHaveBeenCalled());
  });
});
