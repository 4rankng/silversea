import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import type { TripDetail } from '@tingting/shared';
import type { TripDetailPageData } from '../features/trip-detail/types';

// The trip detail read derives the carrier payment-term reason at read time
// (KB spec/2 §2.2.5); the page must show it as a persistent banner quoting
// the server sentence verbatim — and render no banner while the condition
// does not hold. The heavy card chrome is stubbed: this pin is about the
// banner, not the cards.
const page = vi.hoisted(() => ({ current: null as TripDetailPageData | null }));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useParams: () => ({ id: '5' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: null }),
}));

vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: () => {},
}));

vi.mock('../features/trip-detail', () => ({
  useTripDetailPage: () => page.current,
  TripHeader: () => <div data-testid="trip-header" />,
  KpiStrip: () => null,
  BasicInfoCard: () => null,
  ContainersCard: () => null,
  FinancialCard: () => null,
  FuelCard: () => null,
  ServiceCostsCard: () => null,
  ExternalCarrierCard: () => null,
  PhotosCard: () => null,
}));

import TripDetailPage from './TripDetailPage';

const REASON = 'Chưa xác định hạn thanh toán: nhà xe chưa có nhà cung cấp liên kết.';

function tripData(overrides: Partial<TripDetail> = {}): TripDetailPageData {
  return {
    trip: {
      id: 5,
      version: 1,
      status: 'COMPLETED',
      carrierType: 'EXTERNAL',
      customerReference: null,
      podRecoveredAt: '2026-11-26T10:00:00.000Z',
      accountingLock: null,
      notes: null,
      instructions: null,
      photoUrls: [],
      ...overrides,
    } as unknown as TripDetail,
    loading: false,
    error: '',
    refetchTrip: vi.fn(),
    derived: {} as TripDetailPageData['derived'],
    permissions: {} as TripDetailPageData['permissions'],
    ui: {
      actionLoading: false,
      actionError: '',
      showAdjust: false,
      adjustAmount: '',
      adjustNote: '',
      adjustRef: '',
      adjustSubmitting: false,
      adjustError: '',
    },
    fuelPriceConfig: null,
    carrierCustomers: [],
    adjustments: [],
    confirm: vi.fn(async () => true),
    confirmDialog: null,
    handleAction: vi.fn(async () => undefined),
    handleChangeDepartureDate: vi.fn(async () => undefined),
    openAdjust: vi.fn(),
    handleMarkPodRecovered: vi.fn(async () => undefined),
    handleAdjustSubmit: vi.fn(async () => undefined),
    setShowAdjust: vi.fn(),
    setAdjustAmount: vi.fn(),
    setAdjustNote: vi.fn(),
    setAdjustRef: vi.fn(),
    cancelLoading: false,
  };
}

describe('TripDetailPage — the carrier payment-term warning persists on the detail read', () => {
  it('renders the server reason verbatim while the condition holds', () => {
    page.current = tripData({ paymentTermWarning: REASON });
    render(<TripDetailPage />);
    expect(screen.getByRole('status').textContent).toBe(REASON);
    expect(document.querySelector('.tdp-warning-banner')).not.toBeNull();
  });

  it('renders no warning banner while the carrier link resolves', () => {
    page.current = tripData({ paymentTermWarning: null });
    render(<TripDetailPage />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('.tdp-warning-banner')).toBeNull();
  });
});
