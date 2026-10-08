import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripStatus, type TripDetail } from '@tingting/shared';

const listTripsMock = vi.hoisted(() => vi.fn());
const getTripsSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('../api/tripClient', () => ({
  tripClient: {
    listTrips: listTripsMock,
    getTripsSummary: getTripsSummaryMock,
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
  // The page scopes the list and the summary to the salary period; the strip's
  // criteria (truck/customer options) only exist once that period is present.
  useSalaryPeriod: () => ({ data: { start: '2026-08-01', end: '2026-08-31' } }),
}));

vi.mock('./use-trip-list-animations', () => ({
  useTripListAnimations: () => ({ current: null }),
}));

import TripListPage from './TripListPage';

function mkTrip(id: number, tripCode: string): TripDetail {
  return {
    id,
    tripCode,
    customerReference: 'QA-WF04-114144',
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
  getTripsSummaryMock.mockReset().mockResolvedValue(undefined);
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
    for (const label of ['Bill / Booking', 'Xe', 'Tuyến', 'Container', 'Tiêu hao', 'Tổng đi đường', 'Doanh thu', 'Tổng chi phí', 'LN gộp', 'Trạng thái']) {
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
    await waitFor(() => expect(screen.getAllByText('QA-WF04-114144').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 2 }));

    fireEvent.click(screen.getByRole('button', { name: 'Xe' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ page: 1, sortBy: 'truck', sortDir: 'asc' }));
  });

  it('renders the business reference without the internal trip code', async () => {
    renderPage();
    expect((await screen.findAllByText('QA-WF04-114144')).length).toBeGreaterThan(0);
    expect(screen.queryByText('TRP-202608-0001')).toBeNull();
    expect(screen.queryByText('TRP-202608-0002')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bill / Booking' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ sortBy: 'customerReference', sortDir: 'asc' }));
  });
});

describe('TripListPage filter strip (card 20260927_152)', () => {
  const summary = {
    statusCounts: { all: 12, CREATED: 3, IN_TRANSIT: 4, COMPLETED: 3, CANCELED: 2 },
    truckOptions: [{ id: 1, licensePlate: '30A-12301' }],
    customerOptions: [{ id: 7, name: 'Khách 7' }],
  };

  it('renders the shared filter bar — no page-local card — and keeps the search writer', async () => {
    getTripsSummaryMock.mockResolvedValue(summary);
    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByText('QA-WF04-114144').length).toBeGreaterThan(0));

    expect(container.querySelector('.filter-bar.list-filter-bar')).toBeTruthy();
    for (const retired of ['.filters-card', '.filters-row-top', '.filters-row-bottom', '.filters-divider', '.filters-search']) {
      expect(container.querySelector(retired)).toBeNull();
    }

    fireEvent.change(screen.getByRole('textbox', { name: 'Tìm chuyến đi' }), { target: { value: 'TRP-202608' } });
    await waitFor(() => expect(lastCallParams()).toMatchObject({ search: 'TRP-202608' }), { timeout: 10_000 });
  });

  it('writes the status segment and the criteria into the list query', async () => {
    getTripsSummaryMock.mockResolvedValue(summary);
    const { container } = renderPage();
    await waitFor(() => expect(screen.getAllByText('QA-WF04-114144').length).toBeGreaterThan(0));
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement;

    fireEvent.click(within(bar).getByRole('tab', { name: /Đang chạy/ }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ status: TripStatus.IN_TRANSIT }));

    fireEvent.click(screen.getByRole('button', { name: /Phương tiện$/ }));
    fireEvent.click(screen.getByRole('option', { name: '30A-12301' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ status: TripStatus.IN_TRANSIT, truckId: 1 }));

    fireEvent.click(screen.getByRole('button', { name: /Khách hàng$/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Khách 7' }));
    await waitFor(() => expect(lastCallParams()).toMatchObject({ status: TripStatus.IN_TRANSIT, truckId: 1, customerId: 7 }));
  });
});
