import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TruckStatus, DriverStatus } from '@tingting/shared';
import type { Truck, Driver } from '@tingting/shared';

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
    render(<FleetDriversView />);

    expect(screen.getByText('Nguyễn Văn B')).toBeTruthy();
    expect(screen.getByText('0901234567')).toBeTruthy();
    expect(screen.getByText('51H-123.45')).toBeTruthy();
    expect(screen.getByText('Trần Thị C')).toBeTruthy();
    expect(screen.getByText('Ngưng')).toBeTruthy();
  });

  it('shows loading then empty states', () => {
    fleetState.isLoading = true;
    const { rerender } = render(<FleetDriversView />);
    expect(screen.getByText('Đang tải…')).toBeTruthy();

    fleetState.isLoading = false;
    fleetState.data = { trucks: [], drivers: [] };
    rerender(<FleetDriversView />);
    expect(screen.getByText('Chưa có tài xế nào')).toBeTruthy();
  });

  it('renders no mutation affordances (read-only)', () => {
    fleetState.data = { trucks: [truck()], drivers: [driver()] };
    render(<FleetDriversView />);
    expect(screen.queryByRole('button', { name: /thêm|sửa|xóa/i })).toBeNull();
  });
});
