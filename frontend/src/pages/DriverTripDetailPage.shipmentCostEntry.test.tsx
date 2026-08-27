import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodStatus } from '@tingting/shared';

/**
 * Driver-app spec (260827) — "Nhập chi phí lô hàng" and "Báo cáo đổ dầu" are
 * deliberately hidden behind the same `isShipmentCostEntryEnabled()` flag
 * until the rollout is approved. This suite verifies both sections are
 * genuinely absent from the render tree when the flag is off (not just
 * visually hidden), and both reappear when it's on. Mirrors the mocking
 * conventions of `DriverTripDetailPage.test.tsx` — kept as a separate file
 * so that suite's existing tests stay untouched.
 */

const { isShipmentCostEntryEnabledMock } = vi.hoisted(() => ({
  isShipmentCostEntryEnabledMock: vi.fn(),
}));

vi.mock('../lib/featureFlags', () => ({
  isShipmentCostEntryEnabled: isShipmentCostEntryEnabledMock,
}));

vi.mock('../components/trip/ShipmentCostEntryForm', () => ({
  ShipmentCostEntryForm: () => <div data-testid="shipment-cost-entry-form">Nhập chi phí lô hàng</div>,
  default: () => <div data-testid="shipment-cost-entry-form">Nhập chi phí lô hàng</div>,
}));

vi.mock('../components/trip/FuelRefillReportForm', () => ({
  FuelRefillReportForm: () => <div data-testid="fuel-refill-report-form">Báo cáo đổ dầu</div>,
  default: () => <div data-testid="fuel-refill-report-form">Báo cáo đổ dầu</div>,
}));

const {
  useDriverTaskDetailMock,
  useDriverTaskProgressMock,
  useDriverEvidenceStatusMock,
  awaitAccurateSampleMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  useDriverTaskProgressMock: vi.fn(),
  useDriverEvidenceStatusMock: vi.fn(),
  awaitAccurateSampleMock: vi.fn(),
}));

vi.mock('../hooks/useDriverQueries', () => ({
  useDriverTaskDetail: useDriverTaskDetailMock,
  useDriverTaskProgress: useDriverTaskProgressMock,
  useDriverEvidenceStatus: useDriverEvidenceStatusMock,
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: vi.fn(),
}));

vi.mock('../hooks/useOnline', () => ({
  useOnline: () => true,
}));

vi.mock('../hooks/useGeolocation', () => ({
  useGeolocation: () => ({
    awaitAccurateSample: awaitAccurateSampleMock,
  }),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 88, role: 'DRIVER' } }),
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../components/trip/TripLegsPanel', () => ({
  default: () => null,
}));

vi.mock('../components/trip/TripPodSubmission', () => ({
  default: () => <div data-testid="pod-submission">pod</div>,
}));

vi.mock('../features/driver/useOfflineCommandQueue', () => ({
  buildOfflineCommandKey: (...parts: Array<string | number>) => parts.join(':'),
  useOfflineCommandQueue: () => ({
    commands: [],
    enqueue: vi.fn(),
    drain: vi.fn(),
    pendingCount: 0,
    failedCount: 0,
    conflictCount: 0,
  }),
}));

import DriverTripDetailPage from './DriverTripDetailPage';

function makeTaskDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 55,
    version: 3,
    tripCode: 'TRIP-55',
    status: 'IN_TRANSIT',
    departureDate: '2026-08-01',
    routeName: 'Cảng Cát Lái → Nhà máy Bình Dương',
    truckPlate: '51C-12345',
    trailerPlate: '51R-55555',
    trailerType: '40FT',
    customerName: 'SilverSea',
    cargoTypeName: 'Hàng nhập',
    fuelLiters: null,
    fuelMode: null,
    fuelSupplierName: null,
    totalRoadAllowance: '450000',
    driverSalary: '1500000',
    hasReturnCargo: false,
    notes: null,
    customerReference: 'CUS-REF',
    instructions: {
      contactName: 'Anh Minh',
      contactPhone: '0909000001',
      notes: 'Vào cổng số 2',
    },
    fuelEvidenceReviews: [],
    paperOrderCollectedAt: '2026-08-01T07:45:00.000Z',
    paperOrderCollectedBy: 12,
    paperOrderCollectedByName: 'Ops điều độ',
    containers: [{ id: 1, containerNumber: 'MSCU1234561', sealNumber: 'SEAL-9', containerTypeId: 1, containerTypeName: '40FT', containerTypeCode: '40G1', cargoWeightKg: null }],
    legs: [],
    fulfillment: {
      id: 88,
      code: 'FUL-88',
      taskCode: 'TASK-88',
      type: 'FCL_CONTAINER',
      modeLabel: 'FCL',
      factoryName: 'Nhà máy Bình Dương',
      pickupPortName: 'Cát Lái',
      dropPortName: 'Sóng Thần',
      pickupWarehouseName: null,
      dropWarehouseName: null,
      lclWarehouseName: null,
      plannedAt: '2026-08-01T09:00:00.000Z',
      contactName: 'Anh Minh',
      contactPhone: '0909000001',
      routeSummary: 'Cát Lái → Bình Dương',
      siteRules: ['Mang đầy đủ PPE', 'Liên hệ bảo vệ trước 15 phút'],
      invoiceInfo: null,
      containerSealPhotos: [],
    },
    currentPod: {
      id: 22,
      tripId: 55,
      fulfillmentId: 88,
      submissionVersion: 1,
      status: TripPodStatus.DRAFT,
      sourceTripVersion: 3,
      version: 2,
      createdAt: '2026-08-01T01:00:00.000Z',
      updatedAt: '2026-08-01T01:00:00.000Z',
      submittedAt: null,
      reviewedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      acceptedAt: null,
      supersedesSubmissionId: null,
      files: [],
    },
    podHistory: [],
    accountingLock: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-trips/88']}>
      <Routes>
        <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DriverTripDetailPage — shipment cost entry feature flag', () => {
  beforeEach(() => {
    isShipmentCostEntryEnabledMock.mockReset();
    awaitAccurateSampleMock.mockReset();
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail(),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    useDriverEvidenceStatusMock.mockReturnValue({
      data: { ready: false, missingItems: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('does not render the cost-entry or fuel-refill sections when the flag is off (default)', async () => {
    isShipmentCostEntryEnabledMock.mockReturnValue(false);
    renderPage();

    expect(await screen.findByText(/Bốn mốc thực hiện/)).toBeTruthy();
    expect(screen.queryByText('Nhập chi phí lô hàng')).toBeNull();
    expect(screen.queryByTestId('shipment-cost-entry-form')).toBeNull();
    expect(screen.queryByText('Báo cáo đổ dầu')).toBeNull();
    expect(screen.queryByTestId('fuel-refill-report-form')).toBeNull();
  });

  it('renders the cost-entry and fuel-refill sections when the flag is on', async () => {
    isShipmentCostEntryEnabledMock.mockReturnValue(true);
    renderPage();

    expect(await screen.findByText('Nhập chi phí lô hàng')).toBeTruthy();
    expect(screen.getByTestId('shipment-cost-entry-form')).toBeTruthy();
    expect(screen.getByText('Báo cáo đổ dầu')).toBeTruthy();
    expect(screen.getByTestId('fuel-refill-report-form')).toBeTruthy();
  });
});
