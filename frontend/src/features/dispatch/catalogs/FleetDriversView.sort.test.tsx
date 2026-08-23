import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Driver, Truck } from '@tingting/shared';

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => ({ data: fleetFixture, isLoading: false, error: null }),
  useTrailers: () => ({ data: [] }),
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import { FleetDriversView } from './FleetDriversView';

const trucks: Truck[] = [
  { id: 11, licensePlate: '51C-888.88' },
] as unknown as Truck[];

const drivers: Driver[] = [
  { id: 1, name: 'Trần Zeta', phone: '0903000001', assignedTruckId: 11, status: 'ACTIVE' },
  { id: 2, name: 'Nguyễn An', phone: null, assignedTruckId: null, status: 'ACTIVE' },
  { id: 3, name: 'Lê Bình', phone: '0903000003', assignedTruckId: null, status: 'INACTIVE' },
] as unknown as Driver[];

const fleetFixture = { trucks, drivers };

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetDriversView />
    </QueryClientProvider>,
  );
}

function bodyRows() {
  return screen.getAllByRole('row').slice(1);
}

function nameColumn(): string[] {
  return bodyRows().map((row) =>
    within(row).getByText(/Trần Zeta|Nguyễn An|Lê Bình/).textContent ?? '');
}

function phoneColumn(): Array<string | null> {
  return bodyRows().map((row) => {
    const cell = row.querySelector('td[data-label="Số điện thoại"]');
    return cell?.textContent === '—' ? null : cell?.textContent ?? null;
  });
}

describe('FleetDriversView client-side sort headers', () => {
  it('keeps the catalog order until a header is pressed, then sorts name asc → desc', () => {
    renderView();
    expect(screen.getByText('Trần Zeta')).toBeTruthy();
    expect(nameColumn()).toEqual(['Trần Zeta', 'Nguyễn An', 'Lê Bình']);

    fireEvent.click(screen.getByRole('button', { name: 'Họ tên' }));
    // Vietnamese collation on full names: "Lê Bình" < "Nguyễn An" < "Trần Zeta".
    expect(nameColumn()).toEqual(['Lê Bình', 'Nguyễn An', 'Trần Zeta']);

    fireEvent.click(screen.getByRole('button', { name: 'Họ tên' }));
    expect(nameColumn()).toEqual(['Trần Zeta', 'Nguyễn An', 'Lê Bình']);
  });

  it('sorts phone with empty cells last in both directions', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Số điện thoại' }));
    expect(phoneColumn()).toEqual(['0903000001', '0903000003', null]);

    fireEvent.click(screen.getByRole('button', { name: 'Số điện thoại' }));
    expect(phoneColumn()).toEqual(['0903000003', '0903000001', null]);
  });
});
