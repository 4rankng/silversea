import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoadingType } from '@tingting/shared';
import { JourneyLegRow } from '../components/trip/JourneyLegRow';

// ── AC1: leg fields expose accessible names ────────────────────────────────

vi.mock('../components/LocationAutocomplete', () => ({
  LocationAutocomplete: (props: { ariaLabel?: string; placeholder?: string }) => (
    <input aria-label={props.ariaLabel ?? props.placeholder} readOnly />
  ),
}));

vi.mock('../design-system', () => ({
  UuiSelectField: () => null,
}));

describe('_41 AC1: leg point fields expose accessible names', () => {
  it('labels each leg origin/destination/km field with its sequence', () => {
    render(
      <JourneyLegRow
        leg={{ id: 'l1', sequence: 2, origin: '', destination: '', km: '', loadingType: LoadingType.HANG }}
        onRemove={() => {}}
        onUpdate={() => {}}
        canRemove={false}
      />,
    );
    expect(screen.getByLabelText('Chặng 2: điểm đi')).toBeTruthy();
    expect(screen.getByLabelText('Chặng 2: điểm đến')).toBeTruthy();
    expect(screen.getByLabelText('Chặng 2: cự ly (km)')).toBeTruthy();
  });
});

// ── AC2: trailer select survives options churn (route re-pricing refetch) ──

const getDriverTripApiMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, api: { ...actual.api, get: getDriverTripApiMock } };
});

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useTripFormState } from './useTripFormState';
import { useTripFormDispatch } from './useTripFormDispatch';

const trucks = [{ id: 1, currentTrailerId: 7 }];
const trailers = [{ id: 7, type: '40FT' }];

function options() {
  // Fresh identities every render — mirrors the post-refetch options churn
  // that used to re-run the auto-pin and revert the user's trailer choice.
  return {
    routes: [],
    trucks: trucks.map((t) => ({ ...t })),
    trailers: trailers.map((t) => ({ ...t })),
    customers: [],
    drivers: [],
    cargoTypes: [],
    containerTypes: [],
    trailerTypes: [],
  } as unknown as Parameters<typeof useTripFormDispatch>[0]['options'];
}

function Harness() {
  const s = useTripFormState({ isEditMode: false, existingTrip: undefined });
  useTripFormDispatch({ state: s, options: options(), isEditMode: false, existingTrip: undefined });
  return (
    <div>
      <span data-testid="trailer-type">{s.trailerType}</span>
      <button type="button" onClick={() => s.setTruckId('1')}>pick truck</button>
      <button type="button" onClick={() => s.setTrailerType('20FT')}>user picks 20FT</button>
    </div>
  );
}

describe('_41 AC2: trailer type survives re-pricing re-renders', () => {
  it('auto-pins once per truck and never clobbers the explicit user choice', async () => {
    getDriverTripApiMock.mockResolvedValue({ price: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    // Truck picked → the truck's current-trailer type auto-pins once.
    fireEvent.click(screen.getByRole('button', { name: 'pick truck' }));
    await screen.findByText('40FT', { selector: '[data-testid="trailer-type"]' });

    // The user explicitly chooses 20FT.
    fireEvent.click(screen.getByRole('button', { name: 'user picks 20FT' }));
    expect(screen.getByTestId('trailer-type').textContent).toBe('20FT');

    // Options churn (route re-pricing refetch) must NOT revert the choice.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(screen.getByTestId('trailer-type').textContent).toBe('20FT');
  });
});
