import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StuckTripsBanner } from './StuckTripsBanner';
import type { StuckRunningTrip } from '../../api/tripClient';

const listStuckTripsMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/tripClient', () => ({
  tripClient: { listStuckTrips: listStuckTripsMock },
}));

function makeRow(overrides: Partial<StuckRunningTrip> = {}): StuckRunningTrip {
  return {
    tripId: 13,
    tripCode: 'TRP-202609-0011',
    status: 'IN_TRANSIT',
    driverId: 5,
    driverName: 'Nguyễn Huy Vương',
    truckPlate: '15E-019.80',
    shipmentId: 36,
    shipmentCode: 'SHP-2609-00036',
    fulfillmentId: 62,
    plannedStartAt: '2026-09-21T00:00:00.000Z',
    stuckSince: '2026-09-21T00:00:00.000Z',
    daysStuck: 53,
    activeHandoff: { id: 38, status: 'UNSEEN', handlerId: null },
    ...overrides,
  };
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StuckTripsBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listStuckTripsMock.mockReset();
});

describe('StuckTripsBanner (SIL-817 dispatch watchlist)', () => {
  it('renders nothing when no trips are stuck', async () => {
    listStuckTripsMock.mockResolvedValue({ days: 7, items: [] });
    const { container } = renderBanner();
    await waitFor(() => expect(listStuckTripsMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the fetch fails — a watchlist must never break the plan grid', async () => {
    listStuckTripsMock.mockRejectedValue(new Error('network down'));
    const { container } = renderBanner();
    await waitFor(() => expect(listStuckTripsMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('names the stranded trip and flags the handler-less handoff', async () => {
    listStuckTripsMock.mockResolvedValue({ days: 7, items: [makeRow()] });
    renderBanner();

    const banner = await screen.findByRole('region', { name: /Chuyến kẹt quá 7 ngày/ });
    expect(banner.textContent).toContain('TRP-202609-0011');
    expect(banner.textContent).toContain('Nguyễn Huy Vương');
    expect(banner.textContent).toContain('53 ngày');
    // The PROD 13/11 signal: handoff UNSEEN with handler NULL must be visible.
    expect(banner.textContent).toContain('lệnh phát #38 UNSEEN — chưa có người phụ trách');
  });

  it('collapses past the row cap and expands on demand', async () => {
    listStuckTripsMock.mockResolvedValue({
      days: 7,
      items: Array.from({ length: 7 }, (_, i) => makeRow({ tripId: i + 1, tripCode: `TRP-${i + 1}` })),
    });
    renderBanner();

    const banner = await screen.findByRole('region', { name: /Chuyến kẹt quá 7 ngày/ });
    expect(banner.textContent).toContain('… còn 2 chuyến nữa');
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng danh sách chuyến kẹt' }));
    await waitFor(() => expect(banner.textContent).not.toContain('… còn 2 chuyến nữa'));
    expect(banner.textContent).toContain('TRP-7');
  });

  it('shows the no-handoff chip when the trip has no active handoff at all', async () => {
    listStuckTripsMock.mockResolvedValue({ days: 7, items: [makeRow({ activeHandoff: null })] });
    renderBanner();

    const banner = await screen.findByRole('region', { name: /Chuyến kẹt quá 7 ngày/ });
    expect(banner.textContent).toContain('không có lệnh phát');
  });
});
