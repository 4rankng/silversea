import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';

const listTripsMock = vi.hoisted(() => vi.fn());

vi.mock('../api/tripClient', () => ({
  tripClient: {
    listTrips: listTripsMock,
    getTripsSummary: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 1, role: 'ADMIN' } }),
}));

vi.mock('../hooks/useMonth', () => ({
  useMonth: () => ({ month: 8, year: 2026 }),
}));

vi.mock('../hooks/useQueries', () => ({
  useFuelConfig: () => ({ data: undefined }),
  useSalaryPeriod: () => ({ data: undefined }),
}));

vi.mock('./use-trip-list-animations', () => ({
  useTripListAnimations: () => ({ current: null }),
}));

import TripListPage from './TripListPage';

function mkTrip(id: number, tripCode: string): TripDetail {
  return {
    id,
    tripCode,
    status: 'COMPLETED',
    carrierType: 'OWN',
    departureDate: '2026-08-1' + (id % 9),
    customer: { id, name: `Khách ${id}` },
    truck: { id, licensePlate: `30A-1230${id}` },
    route: { id, name: 'Hà Nội → Hải Phòng' },
    containers: [],
    legs: [],
  } as unknown as TripDetail;
}

const envelope = {
  items: [mkTrip(1, 'TRP-202608-0001'), mkTrip(2, 'TRP-202608-0002')],
  total: 60,
  page: 1,
  pageSize: 25,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TripListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastCallParams(): Record<string, unknown> {
  const calls = listTripsMock.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  listTripsMock.mockReset().mockResolvedValue(envelope);
});

describe('TripListPage server-side column sort', () => {
  it('loads page 1 without sort params so the default order stays untouched', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Doanh thu' })).toBeTruthy());
    expect(lastCallParams()).toMatchObject({ page: 1, limit: 25 });
    expect(lastCallParams().sortBy).toBeUndefined();
    expect(lastCallParams().sortDir).toBeUndefined();
    // Every data column header is a sort button (the quick-edit select column
    // is decorative and has no header).
    for (const label of ['Chuyến · Mã', 'Xe', 'Tuyến', 'Container', 'Tiêu hao', 'Tổng đi đường', 'Doanh thu', 'Tổng chi phí', 'LN gộp', 'Trạng thái']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('sends sortBy/sortDir when a header is clicked and flips asc → desc on repeat', async () => {
    renderPage();
    const header = screen.getByRole('columnheader', { name: 'Doanh thu' });
    await waitFor(() => expect(header.getAttribute('aria-sort')).toBe('none'));

    fireEvent.click(screen.getByRole('button', { name: 'Doanh thu' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'revenue', sortDir: 'asc' }));
    expect(header.getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: 'Doanh thu' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'revenue', sortDir: 'desc' }));
    expect(header.getAttribute('aria-sort')).toBe('descending');

    // A fresh column starts ascending again.
    fireEvent.click(screen.getByRole('button', { name: 'Tổng chi phí' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'totalCost', sortDir: 'asc' }));
  });

  it('resets to page 1 when a sort is applied from a later page', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('TRP-202608-0001').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Xe' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 1, sortBy: 'truck', sortDir: 'asc' }));
  });
});
