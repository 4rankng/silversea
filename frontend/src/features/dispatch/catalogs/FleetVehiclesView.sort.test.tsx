import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Driver, Trailer, Truck } from '@tingting/shared';

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => ({ data: fleetFixture, isLoading: false, error: null }),
  useTrailers: () => ({ data: trailersFixture }),
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import { FleetVehiclesView } from './FleetVehiclesView';

const trucks: Truck[] = [
  { id: 21, licensePlate: '51C-111.11', currentTrailerId: 31, status: 'ACTIVE' },
  { id: 22, licensePlate: '51C-222.22', currentTrailerId: null, status: 'MAINTENANCE' },
  { id: 23, licensePlate: '51C-333.33', currentTrailerId: 32, status: 'ACTIVE' },
] as unknown as Truck[];

const trailersFixture: Trailer[] = [
  { id: 31, licensePlate: '50R-001.00' },
  { id: 32, licensePlate: '50R-002.00' },
] as unknown as Trailer[];

const drivers: Driver[] = [
  { id: 1, name: 'Trần Zeta', assignedTruckId: 21 },
  { id: 2, name: 'Nguyễn An', assignedTruckId: 23 },
] as unknown as Driver[];

const fleetFixture = { trucks, drivers };

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetVehiclesView />
    </QueryClientProvider>,
  );
}

function bodyRows() {
  return Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr'));
}

function plateColumn(): string[] {
  return bodyRows().map((row) =>
    (row.querySelector('td[data-label="Biển số"]')?.textContent ?? '').trim());
}

function driverColumn(): Array<string | null> {
  return bodyRows().map((row) => {
    const cell = row.querySelector('td[data-label="Tài xế được gán"]');
    return cell?.textContent === '—' || cell?.textContent === 'Chưa phân công' ? null : cell?.textContent ?? null;
  });
}

describe('FleetVehiclesView client-side sort headers', () => {
  it('keeps the catalog order until a header is pressed, then sorts plate asc → desc', () => {
    renderView();
    expect(screen.getByText('51C-111.11')).toBeTruthy();
    expect(plateColumn()).toEqual(['51C-111.11', '51C-222.22', '51C-333.33']);

    fireEvent.click(screen.getByRole('button', { name: 'Biển số' }));
    expect(plateColumn()).toEqual(['51C-111.11', '51C-222.22', '51C-333.33']);

    fireEvent.click(screen.getByRole('button', { name: 'Biển số' }));
    expect(plateColumn()).toEqual(['51C-333.33', '51C-222.22', '51C-111.11']);
  });

  it('sorts the assigned driver with unassigned trucks last in both directions', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Tài xế được gán' }));
    expect(driverColumn()).toEqual(['Nguyễn An', 'Trần Zeta', null]);

    fireEvent.click(screen.getByRole('button', { name: 'Tài xế được gán' }));
    expect(driverColumn()).toEqual(['Trần Zeta', 'Nguyễn An', null]);
  });
});
