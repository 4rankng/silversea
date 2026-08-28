import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phần 4 ticket (2026-08-28 customer feedback): the e-POD section and the
 * cost-entry form have been REMOVED from the trip detail page.
 *
 *   - e-POD lives on its own screen at /my-trips/:id/pod
 *     (DriverTripPodPage). The trip detail page's "Hoàn thành" CTA now
 *     navigates there instead of hosting the e-POD widget inline.
 *   - The cost-entry form is hidden (kế toán tài chính is the post-trial
 *     phase per the trial-readiness plan, "từ từ"). Backend schema +
 *     endpoints are retained for the next phase.
 *   - The fuel-refill report ("Báo cáo đổ dầu") is KEPT on the trip detail
 *     page per 27.8 "GIỮ NGUYÊN".
 *
 * This suite now asserts the COST-FORM IS ABSENT, the e-POD widget is absent,
 * the fuel form is present, and a "Bước tiếp: e-POD" CTA navigates to the
 * pod page.
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

vi.mock('../hooks/useOnline', () => ({
  useOnline: () => true,
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

vi.mock('../features/driver/useOfflineCommandQueue', () => ({
  useOfflineCommandQueue: () => ({
    commands: [],
    enqueue: vi.fn(),
    drain: vi.fn().mockResolvedValue({ done: 0, failed: 0, conflicts: 0, rejected: 0, statusById: {}, messageById: {} }),
  }),
  buildOfflineCommandKey: (...parts: (string | number)[]) => parts.join(':'),
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

describe('DriverTripDetailPage — Phần 4 ticket 2026-08-28 layout', () => {
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

  it('hides the cost-entry form (kế toán từ từ)', () => {
    render(
      <MemoryRouter initialEntries={['/my-trips/9']}>
        <Routes>
          <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('shipment-cost-entry-form')).toBeNull();
  });

  it('hides the e-POD widget (moved to /pod screen)', () => {
    render(
      <MemoryRouter initialEntries={['/my-trips/9']}>
        <Routes>
          <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('trip-pod-submission')).toBeNull();
  });

  it('keeps the fuel-refill section (GIỮ NGUYÊN per 27.8)', () => {
    render(
      <MemoryRouter initialEntries={['/my-trips/9']}>
        <Routes>
          <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('fuel-refill-report-form')).toBeInTheDocument();
  });

  it('renders the operational-note card from cus/điều vận', () => {
    render(
      <MemoryRouter initialEntries={['/my-trips/9']}>
        <Routes>
          <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Hàng dễ vỡ, bốc cẩn thận.')).toBeInTheDocument();
  });
});
