import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripStatus, type TripDetail } from '@tingting/shared';

const listTripsMock = vi.hoisted(() => vi.fn());
const getTripsSummaryMock = vi.hoisted(() => vi.fn());
const bulkUpdateMock = vi.hoisted(() => vi.fn());

vi.mock('../api/tripClient', () => ({
  tripClient: {
    listTrips: listTripsMock,
    getTripsSummary: getTripsSummaryMock,
    bulkUpdateTripFigures: bulkUpdateMock,
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
  useSalaryPeriod: () => ({ data: { start: '2026-08-01', end: '2026-08-31' } }),
}));

vi.mock('./use-trip-list-animations', () => ({
  useTripListAnimations: () => ({ current: null }),
}));

import TripListPage from './TripListPage';

/** Card 20260929_207 — the quick-edit table lost its select column; the row is
 *  now the control. These cases pin the behaviour that replaces it, so a later
 *  refactor cannot quietly take the selection away (or make a row's own input
 *  pick the row it lives in). */

function mkTrip(id: number, status: TripStatus = TripStatus.COMPLETED): TripDetail {
  return {
    id,
    tripCode: `TRP-202608-000${id}`,
    status,
    carrierType: 'OWN',
    departureDate: '2026-08-10',
    customer: { id, name: `Khách ${id}` },
    truck: { id, licensePlate: `30A-1230${id}` },
    route: { id, name: 'Hà Nội → Hải Phòng' },
    containers: [],
    legs: [],
  } as unknown as TripDetail;
}

function renderQuickEdit(items: TripDetail[]) {
  listTripsMock.mockResolvedValue({ items, total: items.length, page: 1, pageSize: 25 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TripListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // Quick edit is the mode that carries a batch action, so it is the mode the
  // selection has to work in.
  fireEvent.click(screen.getByRole('button', { name: 'Bật chế độ sửa nhanh' }));
  return result;
}

const quickRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.quick-edit-row')] as HTMLTableRowElement[];

beforeEach(() => {
  listTripsMock.mockReset();
  getTripsSummaryMock.mockReset().mockResolvedValue({
    statusCounts: { all: 0, CREATED: 0, IN_TRANSIT: 0, COMPLETED: 0, CANCELED: 0 },
    truckOptions: [],
    customerOptions: [],
  });
  bulkUpdateMock.mockReset().mockResolvedValue({ updated: 0, failed: 0, results: [] });
});

describe('card 20260929_207 — row selection replaces the checkbox column', () => {
  it('ships no checkbox anywhere in the quick-edit surface', async () => {
    const { container } = renderQuickEdit([mkTrip(1)]);
    await waitFor(() => expect(quickRows(container)).toHaveLength(1));

    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('picks a row on click and unpicks it on a second click', async () => {
    const { container } = renderQuickEdit([mkTrip(1)]);
    await waitFor(() => expect(quickRows(container)).toHaveLength(1));
    const [first] = quickRows(container);

    expect(first).not.toHaveAttribute('data-selected');
    fireEvent.click(first);
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(first);
    expect(first).not.toHaveAttribute('data-selected');
  });

  // A quick-edit row is full of money inputs. Clicking one must edit it and
  // leave the selection alone — otherwise one tap both types a figure and adds
  // the row to a save batch the operator never chose.
  it('does not pick the row when the press lands on one of its own inputs', async () => {
    const { container } = renderQuickEdit([mkTrip(1)]);
    await waitFor(() => expect(quickRows(container)).toHaveLength(1));
    const [first] = quickRows(container);

    fireEvent.click(first.querySelector('input.quick-money-input') as HTMLElement);
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('leaves a canceled row inert', async () => {
    const { container } = renderQuickEdit([mkTrip(1, TripStatus.CANCELED)]);
    await waitFor(() => expect(quickRows(container)).toHaveLength(1));
    const [first] = quickRows(container);

    expect(first).toHaveClass('locked');
    expect(first).not.toHaveAttribute('tabindex');
    fireEvent.click(first);
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('toggles every pickable row from the toolbar button, and only those', async () => {
    const { container } = renderQuickEdit([
      mkTrip(1),
      mkTrip(2),
      mkTrip(3, TripStatus.CANCELED),
    ]);
    await waitFor(() => expect(quickRows(container)).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: /Chọn cả trang này/ }));

    const rows = quickRows(container);
    expect(rows[0]).toHaveAttribute('data-selected', 'true');
    expect(rows[1]).toHaveAttribute('data-selected', 'true');
    expect(rows[2]).not.toHaveAttribute('data-selected');

    fireEvent.click(screen.getByRole('button', { name: /Bỏ chọn dòng trang này/ }));
    expect(quickRows(container)[0]).not.toHaveAttribute('data-selected');
  });

  // The batch action must still consume exactly the rows that were picked. A
  // pre-departure trip keeps the save out of the completed-trip governance
  // gate, so what is asserted here is the selection reaching the payload.
  it('saves the picked rows and nothing else', async () => {
    const { container } = renderQuickEdit([mkTrip(1), mkTrip(2, TripStatus.CREATED)]);
    await waitFor(() => expect(quickRows(container)).toHaveLength(2));

    fireEvent.click(quickRows(container)[1]);
    // Editing a figure is what makes a row dirty, and it keeps it in the batch.
    const input = quickRows(container)[1].querySelector('input.quick-money-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '120' } });

    bulkUpdateMock.mockResolvedValue({ updated: 1, failed: 0, results: [{ ok: true, tripId: 2 }] });
    fireEvent.click(screen.getByRole('button', { name: /Lưu 1 dòng/ }));

    await waitFor(() => expect(bulkUpdateMock).toHaveBeenCalled());
    const { updates } = bulkUpdateMock.mock.calls[0][0];
    expect(updates.map((u: { tripId: number }) => u.tripId)).toEqual([2]);
  });
});
