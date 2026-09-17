import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DriverTwoOrdersPage from './DriverTwoOrdersPage';

// Red repro (code sweep wave 2, 2026-09-16): the pair summary reads
// emptyDistanceKm/combinedEfficiencyPercent with truthiness while the
// gap-minutes line correctly uses != null. A pair whose distance or
// efficiency is legitimately 0 renders the em-dash "no data" glyph —
// same defect class the gap line was already fixed against.
const trip = (id: number, status: 'CREATED' | 'IN_TRANSIT') => ({
  id,
  fulfillmentId: id,
  tripCode: `TRP-${id}`,
  departureDate: '2026-09-15',
  status,
  routeName: 'LH — Biên Hòa',
  truckPlate: '15E-016.26',
  customerName: 'Công ty ABC',
  containerNumbers: ['TCKU1234567'],
});

vi.mock('../../hooks/useDriverQueries', () => ({
  useDriverTwoOrders: () => ({
    data: {
      date: '2026-09-15',
      firstOrderLate: false,
      allToday: [trip(1, 'IN_TRANSIT'), trip(2, 'CREATED')],
      pair: {
        first: trip(1, 'IN_TRANSIT'),
        second: trip(2, 'CREATED'),
        emptyDistanceKm: 0,
        combinedEfficiencyPercent: 0,
        actualGapMinutes: 30,
        requiredGapMinutes: 45,
      },
    },
    isLoading: false,
    error: null,
  }),
}));

describe('DriverTwoOrdersPage — zero pair metrics render as values, not em-dash', () => {
  it('renders 0 km and 0% for a pair whose empty distance and efficiency are 0', () => {
    render(
      <MemoryRouter>
        <DriverTwoOrdersPage />
      </MemoryRouter>,
    );
    const summary = screen.getByTestId('ordered-pair-summary');
    expect(within(summary).getByText('0 km')).toBeTruthy();
    expect(within(summary).getByText('0%')).toBeTruthy();
    // Control: the gap-minutes line (correct != null check) shows its value.
    expect(within(summary).getByText('30/45 phút')).toBeTruthy();
  });
});
