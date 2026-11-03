/**
 * Wave 4 M8.3 slice 2 — DriverPairedOrdersPage tests.
 *
 * Mocks `useDriverPairedOrders` at the module boundary so the test exercises
 * the page's own rendering logic (active/next distinct cards, late banner,
 * empty + error states) and the SIL-664 date-scoping laws:
 *
 * Coverage (PRD M08-03-03 + SIL-664):
 *   - ?date=X is forwarded to the query; no param → undefined (server default
 *     today).
 *   - active + next render as DISTINCT cards, each linking to its detail.
 *   - firstOrderLate → advisory banner shown.
 *   - no active (only CREATED today) → "Lệnh đang chạy" empty slot + next card.
 *   - no next (only IN_TRANSIT today) → next empty slot.
 *   - allToday empty → "Hôm nay không có lệnh"; with ?date → day-named empty
 *     state ("Không có lệnh ngày …"), never today's data.
 *   - persisted pair block names its day.
 *   - a malformed ?date renders a bad-link state instead of another day's data.
 *   - loading → spinner; error → error state.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { useDriverPairedOrdersMock } = vi.hoisted(() => ({
  useDriverPairedOrdersMock: vi.fn(),
}));

vi.mock('../../hooks/useDriverQueries', () => ({
  useDriverPairedOrders: useDriverPairedOrdersMock,
}));

// usePageAnimations depends on browser animation APIs jsdom doesn't ship.
vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import DriverPairedOrdersPage from './DriverPairedOrdersPage';

const TRIP = (overrides: Partial<{
  id: number;
  fulfillmentId: number | null;
  tripCode: string;
  departureDate: string;
  status: string;
  routeName: string;
  customerName: string;
  truckPlate: string;
  containerNumbers: string[];
}> = {}) => ({
  id: 1, fulfillmentId: 101, tripCode: 'TRIP-1', departureDate: '2026-07-26', status: 'CREATED',
  routeName: 'Cảng Cát Lái → Kho BD', customerName: 'Công ty ABC',
  truckPlate: '51C-1234', containerNumbers: ['MSKU1234565'],
  ...overrides,
});

function renderAt(initialEntry = '/my-trips/paired-orders') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/my-trips/paired-orders" element={<DriverPairedOrdersPage />} />
        <Route path="/my-trips/:id" element={<div data-testid="trip-detail" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DriverPairedOrdersPage — M8.3 paired-orders view (SIL-664 date-scoped)', () => {
  beforeEach(() => { useDriverPairedOrdersMock.mockReset(); });

  it('forwards ?date=YYYY-MM-DD to the query', () => {
    useDriverPairedOrdersMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderAt('/my-trips/paired-orders?date=2026-11-20');
    expect(useDriverPairedOrdersMock.mock.lastCall?.[0]).toBe('2026-11-20');
  });

  it('without ?date forwards undefined so the backend defaults to today', () => {
    useDriverPairedOrdersMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderAt();
    expect(useDriverPairedOrdersMock.mock.lastCall?.[0]).toBeUndefined();
  });

  it('renders active + next as distinct cards linking to their detail', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26',
        active: TRIP({ id: 10, fulfillmentId: 110, tripCode: 'TRIP-A', status: 'IN_TRANSIT' }),
        next: TRIP({ id: 20, fulfillmentId: 120, tripCode: 'TRIP-B', status: 'CREATED' }),
        firstOrderLate: false,
        allToday: [TRIP({ id: 10 }), TRIP({ id: 20 })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    const activeCard = await screen.findByTestId('paired-orders-card-Lệnh đang chạy');
    const nextCard = screen.getByTestId('paired-orders-card-Lệnh tiếp theo');
    expect(activeCard.getAttribute('href')).toBe('/my-trips/10');
    expect(nextCard.getAttribute('href')).toBe('/my-trips/20');
    expect(activeCard).not.toBe(nextCard);
  });

  // QA-2026-09-27-01 (#5) / internal-ids law: the Truck icon belongs to the
  // PLATE — the driver-facing vehicle identity. The internal TRP/SHP code must
  // never ride this line (it is not a number the driver can act on).
  it('labels the plate with the truck icon and keeps the internal trip code off the card', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-26',
        active: TRIP({ id: 10, fulfillmentId: 110, tripCode: 'TRP-202609-0013', status: 'IN_TRANSIT' }),
        next: null,
        firstOrderLate: false,
        allToday: [TRIP({ id: 10 })],
      },
      isLoading: false, error: null,
    });
    renderAt();
    const card = await screen.findByTestId('paired-orders-card-Lệnh đang chạy');
    const truckRow = card.querySelector('.dt-card__meta .dt-card__meta-item');
    expect(truckRow?.querySelector('svg')).toBeTruthy();
    expect(truckRow?.textContent).toBe('51C-1234');
    expect(within(card).queryByText(/TRP-202609-0013/)).toBeNull();
  });

  it('prefers the persisted ordered pair view and names its day in the summary block', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
      data: {
        date: '2026-07-27',
        active: null,
        next: null,
        firstOrderLate: false,
        allToday: [],
        pair: {
          pairId: 55,
          status: 'ACTIVE',
          breakReason: null,
          emptyDistanceKm: '22.5',
          combinedEfficiencyPercent: '88.2',
          requiredGapMinutes: 70,
          actualGapMinutes: 95,
          lateByMinutes: null,
          first: TRIP({ id: 10, fulfillmentId: 110, tripCode: 'TRIP-A', departureDate: '2026-07-27', status: 'IN_TRANSIT' }),
          second: TRIP({ id: 20, fulfillmentId: 120, tripCode: 'TRIP-B', departureDate: '2026-07-28', status: 'CREATED' }),
        },
      },
      isLoading: false, error: null,
    });
    renderAt('/my-trips/paired-orders?date=2026-07-27');
    expect(await screen.findByTestId('ordered-pair-summary')).toBeTruthy();
    expect(screen.getByTestId('paired-orders-card-Chuyến 1').getAttribute('href')).toBe('/my-trips/10');
    expect(screen.getByTestId('paired-orders-card-Chuyến 2').getAttribute('href')).toBe('/my-trips/20');
    expect(screen.getByText(/22.5 km/)).toBeTruthy();
    // SIL-664 — the driver must be able to tell WHICH day the pair belongs to.
    expect(screen.getByText(/Cặp điều vận ngày 27\/07\/2026/)).toBeTruthy();
  });

  it('shows the firstOrderLate advisory banner when the flag is true', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
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
    useDriverPairedOrdersMock.mockReturnValue({
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
    useDriverPairedOrdersMock.mockReturnValue({
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
    useDriverPairedOrdersMock.mockReturnValue({
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

  it('shows the legacy today empty state when no ?date is given and the day is empty', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
      data: { date: '2026-07-26', active: null, next: null, firstOrderLate: false, allToday: [] },
      isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Hôm nay không có lệnh/)).toBeTruthy());
  });

  // SIL-664 AC2 — an empty REQUESTED day names itself; it must never present
  // another day's (e.g. today's) orders as if they were that day's.
  it('names the requested day in the empty state instead of "Hôm nay"', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
      data: { date: '2026-11-20', active: null, next: null, firstOrderLate: false, allToday: [] },
      isLoading: false, error: null,
    });
    renderAt('/my-trips/paired-orders?date=2026-11-20');
    await waitFor(() => expect(screen.getByText(/Không có lệnh ngày 20\/11\/2026/)).toBeTruthy());
    expect(screen.queryByText(/Hôm nay không có lệnh/)).toBeNull();
    expect(screen.queryByTestId(/^paired-orders-card-/)).toBeNull();
  });

  it('shows the state-free page title on an empty day so it does not contradict the empty state', async () => {
    useDriverPairedOrdersMock.mockReturnValue({
      data: { date: '2026-07-26', active: null, next: null, firstOrderLate: false, allToday: [] },
      isLoading: false, error: null,
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Hôm nay không có lệnh/)).toBeTruthy());
    // SIL-672: the paired-orders screen is named "Lệnh ghép" — it is the
    // pair view, not the generic day view.
    expect(screen.getByRole('heading', { level: 1, name: 'Lệnh ghép' })).toBeTruthy();
    expect(screen.queryByText(/Hai lệnh hôm nay/)).toBeNull();
  });

  it('renders a bad-link state for a malformed ?date instead of silently showing today', () => {
    useDriverPairedOrdersMock.mockReturnValue({ data: undefined, isLoading: false, error: null });
    renderAt('/my-trips/paired-orders?date=05-11-2026');
    expect(screen.getByText(/Đường liên kết không hợp lệ/)).toBeTruthy();
    expect(screen.queryByTestId(/^paired-orders-card-/)).toBeNull();
  });

  it('shows the loading spinner while loading', () => {
    useDriverPairedOrdersMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderAt();
    expect(screen.getByText(/Đang tải lệnh ghép/)).toBeTruthy();
  });

  it('shows the error state when the query fails', async () => {
    useDriverPairedOrdersMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Không thể tải thông tin lệnh ghép/)).toBeTruthy());
  });
});
