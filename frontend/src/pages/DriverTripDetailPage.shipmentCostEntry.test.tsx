import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

function freshClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['driver-trip-basic', '9'], { id: 9, shipmentId: null, fulfillmentId: 9, tripCode: 'TRP-9', departureDate: null, plannedStartAt: null, status: 'IN_TRANSIT', routeName: null, truckPlate: null, customerName: null, notes: null });
  return client;
}
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Driver expense entry is available in the expense rollout. POD remains on
 * its dedicated screen; the unrelated fuel-refill form stays hidden.
 */

vi.mock('../components/trip/ShipmentCostEntryForm', () => ({
  ShipmentCostEntryForm: () => <div data-testid="shipment-cost-entry-form">Nhập chi phí lô hàng</div>,
  default: () => <div data-testid="shipment-cost-entry-form">Nhập chi phí lô hàng</div>,
}));

vi.mock('../components/trip/TripPodSubmission', () => ({
  TripPodSubmission: () => <div data-testid="trip-pod-submission">e-POD bắt buộc</div>,
  default: () => <div data-testid="trip-pod-submission">e-POD bắt buộc</div>,
}));

vi.mock('../components/trip/FuelRefillReportForm', () => ({
  FuelRefillReportForm: () => <div data-testid="fuel-refill-report-form">Báo cáo đổ dầu</div>,
  default: () => <div data-testid="fuel-refill-report-form">Báo cáo đổ dầu</div>,
}));

const {
  useDriverTaskDetailMock,
  useDriverTaskProgressMock,
  useDriverEvidenceStatusMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  useDriverTaskProgressMock: vi.fn(),
  useDriverEvidenceStatusMock: vi.fn(),
}));

vi.mock('../hooks/useDriverQueries', () => ({
  useDriverTaskDetail: useDriverTaskDetailMock,
  useDriverTaskProgress: useDriverTaskProgressMock,
  useDriverEvidenceStatus: useDriverEvidenceStatusMock,
}));

vi.mock('../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ awaitAccurateSample: vi.fn().mockResolvedValue({ lat: 0, lng: 0, accuracy: 5, timestamp: 0 }) }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 5, role: 'DRIVER' } }),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../lib/idempotency', () => ({
  buildIdempotencyKey: (...parts: (string | number)[]) => parts.join(':'),
}));

vi.mock('../api/driverClient', () => ({
  driverClient: {
    createPodSubmission: vi.fn(),
    attachPodFile: vi.fn(),
    submitPod: vi.fn(),
    uploadFuelEvidence: vi.fn(),
    getEvidenceStatus: vi.fn(),
  },
}));

import DriverTripDetailPage from './DriverTripDetailPage';

describe('DriverTripDetailPage — expense and POD layout', () => {
  beforeEach(() => {
    useDriverTaskDetailMock.mockReturnValue({
      data: {
        id: 9,
        tripCode: 'TRP-2608-0009',
        status: 'IN_TRANSIT',
        version: 4,
        driverNotes: null,
        notes: 'Hàng dễ vỡ, bốc cẩn thận.',
        currentPod: null,
        podHistory: [],
        legs: [],
        containers: [],
        operationalNote: null,
        siteRules: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    useDriverTaskProgressMock.mockReturnValue({
      data: { events: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    useDriverEvidenceStatusMock.mockReturnValue({
      data: { ready: false, missingItems: [], hasDeliveredMilestone: true, hasSubmittedPod: false },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('shows expense entry for the assigned driver during an active trip', () => {
    render(
      <QueryClientProvider client={freshClient()}>
        <MemoryRouter initialEntries={['/my-trips/9']}>
          <Routes>
            <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('shipment-cost-entry-form')).toBeInTheDocument();
  });

  it('hides the e-POD widget (moved to /pod screen)', () => {
    render(
      <QueryClientProvider client={freshClient()}>
        <MemoryRouter initialEntries={['/my-trips/9']}>
          <Routes>
            <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('trip-pod-submission')).toBeNull();
  });

  it('hides the fuel-refill cost form (Phần 1; GIỮ NGUYÊN is the screenshot upload)', () => {
    render(
      <QueryClientProvider client={freshClient()}>
        <MemoryRouter initialEntries={['/my-trips/9']}>
          <Routes>
            <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('fuel-refill-report-form')).toBeNull();
  });

  it('renders the operational-note card from cus/điều vận', () => {
    render(
      <QueryClientProvider client={freshClient()}>
        <MemoryRouter initialEntries={['/my-trips/9']}>
          <Routes>
            <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Hàng dễ vỡ, bốc cẩn thận.')).toBeInTheDocument();
  });
});
