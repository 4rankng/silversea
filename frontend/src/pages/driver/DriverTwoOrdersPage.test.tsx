/**
 * Wave 4 M8.3 slice 2 — DriverTwoOrdersPage tests.
 *
 * Mocks `useDriverTwoOrders` at the module boundary so the test exercises
 * the page's own rendering logic (active/next distinct cards, late banner,
 * empty + error states).
 *
 * Coverage (PRD M08-03-03):
 *   - active + next render as DISTINCT cards, each linking to its detail.
 *   - firstOrderLate → advisory banner shown.
 *   - no active (only CREATED today) → "Lệnh đang chạy" empty slot + next card.
 *   - no next (only IN_TRANSIT today) → next empty slot.
 *   - allToday empty → "Hôm nay không có lệnh".
 *   - loading → spinner; error → error state.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { useDriverTwoOrdersMock } = vi.hoisted(() => ({
  useDriverTwoOrdersMock: vi.fn(),
}));

vi.mock('../../hooks/useDriverQueries', () => ({
  useDriverTwoOrders: useDriverTwoOrdersMock,
}));

// usePageAnimations depends on browser animation APIs jsdom doesn't ship.
vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import DriverTwoOrdersPage from './DriverTwoOrdersPage';

const TRIP = (overrides: Partial<{ id: number; tripCode: string; status: string; routeName: string; customerName: string; truckPlate: string; containerNumbers: string[] }> = {}) => ({
  id: 1, tripCode: 'TRIP-1', departureDate: '2026-07-26', status: 'CREATED',
  routeName: 'Cảng Cát Lái → Kho BD', customerName: 'Công ty ABC',
  truckPlate: '51C-1234', containerNumbers: ['MSKU1234565'],
  ...overrides,
});

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/my-trips/two-orders']}>
      <Routes>
        <Route path="/my-trips/two-orders" element={<DriverTwoOrdersPage />} />
        <Route path="/my-trips/:id" element={<div data-testid="trip-detail" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DriverTwoOrdersPage — M8.3 two-orders view', () => {
  beforeEach(() => { useDriverTwoOrdersMock.mockReset(); });

  it('renders active + next as distinct cards linking to their detail', async () => {
    useDriverTwoOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26',
        active: TRIP({ id: 10, tripCode: 'TRIP-A', status: 'IN_TRANSIT' }),
        next: TRIP({ id: 20, tripCode: 'TRIP-B', status: 'CREATED' }),
        firstOrderLate: false,
        allToday: [TRIP({ id: 10 }), TRIP({ id: 20 })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    const activeCard = await screen.findByTestId('two-orders-card-Lệnh đang chạy');
    const nextCard = screen.getByTestId('two-orders-card-Lệnh tiếp theo');
    expect(activeCard.getAttribute('href')).toBe('/my-trips/10');
    expect(nextCard.getAttribute('href')).toBe('/my-trips/20');
    expect(activeCard).not.toBe(nextCard);
  });

  it('shows the firstOrderLate advisory banner when the flag is true', async () => {
    useDriverTwoOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26',
        active: null,
        next: TRIP({ id: 20, status: 'CREATED' }),
        firstOrderLate: true,
        allToday: [TRIP({ id: 20 }), TRIP({ id: 21, status: 'CREATED' })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    const banner = await screen.findByTestId('first-order-late-banner');
    expect(banner.textContent).toMatch(/chưa khởi hành/);
  });

  it('does NOT show the late banner when firstOrderLate is false', async () => {
    useDriverTwoOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26',
        active: TRIP({ id: 10, status: 'IN_TRANSIT' }),
        next: TRIP({ id: 20, status: 'CREATED' }),
        firstOrderLate: false,
        allToday: [TRIP({ id: 10 }), TRIP({ id: 20 })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.queryByTestId('first-order-late-banner')).toBeNull());
  });

  it('shows the active empty slot when only a CREATED trip is present', async () => {
    useDriverTwoOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26', active: null,
        next: TRIP({ id: 20, status: 'CREATED' }),
        firstOrderLate: false,
        allToday: [TRIP({ id: 20 })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    await screen.findByTestId('active-empty');
    expect(screen.getByText(/Chưa có lệnh nào đang chạy/)).toBeTruthy();
  });

  it('shows the next empty slot when only an IN_TRANSIT trip is present', async () => {
    useDriverTwoOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26',
        active: TRIP({ id: 10, status: 'IN_TRANSIT' }), next: null,
        firstOrderLate: false,
        allToday: [TRIP({ id: 10 })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    await screen.findByTestId('next-empty');
    expect(screen.getByText(/Không có lệnh tiếp theo/)).toBeTruthy();
  });

  it('shows the empty state when there are no trips today', async () => {
    useDriverTwoOrdersMock.mockReturnValue({
      data: { date: '2026-07-26', active: null, next: null, firstOrderLate: false, allToday: [] },
      isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Hôm nay không có lệnh/)).toBeTruthy());
  });

  it('shows the loading spinner while loading', () => {
    useDriverTwoOrdersMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderAt();
    expect(screen.getByText(/Đang tải hai lệnh hôm nay/)).toBeTruthy();
  });

  it('shows the error state when the query fails', async () => {
    useDriverTwoOrdersMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Không thể tải thông tin hai lệnh/)).toBeTruthy());
  });
});
