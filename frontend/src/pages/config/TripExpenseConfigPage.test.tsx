/**
 * Card 20261004_333 — `/config/trip-expense` fetch-error regression (sibling of
 * FuelConfigPage's "does not turn a failed config read into an empty
 * first-save form" pin).
 *
 * Before the fix a failed `useRoadConfig` read left the form showing its
 * hardcoded defaults as if they were saved config, with save enabled — saving
 * would overwrite the real config with those defaults. The error state names
 * the failure, offers "Tải lại cấu hình", and blocks save.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query, save } = vi.hoisted(() => ({
  query: {
    data: null as null | Record<string, string>,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  save: vi.fn(),
}));

vi.mock('../../hooks/useCatalogQueries', () => ({
  useRoadConfig: () => query,
  useSaveRoadConfig: () => ({ mutateAsync: save }),
}));

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

import TripExpenseConfigPage from './TripExpenseConfigPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TripExpenseConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  query.data = null;
  query.isLoading = false;
  query.isError = false;
  query.isFetching = false;
  query.refetch = vi.fn();
  save.mockReset();
});

describe('TripExpenseConfigPage fetch-error states (card 20261004_333)', () => {
  it('does not turn a failed config read into a saveable defaults form', () => {
    query.isError = true;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được cấu hình chi phí chuyến đi');
    expect(screen.getByRole('button', { name: /Tải lại cấu hình/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lưu cấu hình/ })).toBeDisabled();
  });

  it('calls refetch from the retry action', () => {
    query.isError = true;
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Tải lại cấu hình/ }));
    expect(query.refetch).toHaveBeenCalledOnce();
  });

  it('keeps save enabled with no error banner when the read succeeded', () => {
    query.data = {
      defaultDriverSalary: '410000',
      twoPointDeliveryBonus: '210000',
      vehicleShiftDefault: '210000',
      tollPerStation: '56000',
      returnCargoBonus: '310000',
    };
    renderPage();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lưu cấu hình/ })).toBeEnabled();
  });
});
