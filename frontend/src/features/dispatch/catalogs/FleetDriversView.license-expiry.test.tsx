import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { FleetDriversView, licenseExpiryState } from './FleetDriversView';
import { businessDateOffsetISO } from '../../../lib/format';

vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => ({
    data: {
      trucks: [],
      drivers: [
        { id: 1, name: 'Đã quá hạn', code: 'TX01', licenseExpiryDate: businessDateOffsetISO(-10) },
        { id: 2, name: 'Còn dài', code: 'TX02', licenseExpiryDate: businessDateOffsetISO(200) },
      ],
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../../lib/api', () => ({
  api: { post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetDriversView />
    </QueryClientProvider>,
  );
}

describe('licenseExpiryState', () => {
  const today = '2026-09-20';

  it('flags a past date as overdue with the day count', () => {
    expect(licenseExpiryState('2026-09-10', today)).toEqual({ level: 'overdue', days: 10 });
  });

  it('flags the ≤30-day window as soon, including expiry day itself', () => {
    expect(licenseExpiryState('2026-10-20', today)).toEqual({ level: 'soon', days: 30 });
    expect(licenseExpiryState('2026-09-20', today)).toEqual({ level: 'soon', days: 0 });
  });

  it('stays neutral beyond the window', () => {
    expect(licenseExpiryState('2026-11-20', today)).toBeNull();
  });
});

describe('FleetDriversView license flags', () => {
  it('renders the overdue flag with icon + label and leaves long dates neutral', () => {
    renderView();
    const overdue = screen.getByText('Quá hạn 10 ngày');
    expect(overdue.className).toContain('license-flag--overdue');
    const neutralRow = screen.getByText('TX02').closest('tr');
    expect(neutralRow?.querySelectorAll('.dispatch-catalogs__license-flag')).toHaveLength(0);
  });
});
