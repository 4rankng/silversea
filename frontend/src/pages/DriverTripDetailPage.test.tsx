import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProgressEventType, TripPodStatus } from '@tingting/shared';

type MockOfflineCommand = {
  id: string;
  endpoint: string;
  method: string;
  path: string;
  payload: Record<string, unknown>;
  status: string;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const {
  useDriverTaskDetailMock,
  useDriverTaskProgressMock,
  useDriverEvidenceStatusMock,
  awaitAccurateSampleMock,
  commandsMock,
  enqueueMock,
  drainMock,
  toastMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  useDriverTaskProgressMock: vi.fn(),
  useDriverEvidenceStatusMock: vi.fn(),
  awaitAccurateSampleMock: vi.fn(),
  commandsMock: vi.fn<() => MockOfflineCommand[]>(() => []),
  enqueueMock: vi.fn(),
  drainMock: vi.fn(),
  toastMock: vi.fn(),
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
  useToast: () => ({ toast: toastMock }),
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
    commands: commandsMock(),
    enqueue: enqueueMock,
    drain: drainMock,
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
      driverNotes: null,
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

describe('DriverTripDetailPage', () => {
  beforeEach(() => {
    commandsMock.mockReset();
    commandsMock.mockReturnValue([]);
    enqueueMock.mockReset();
    drainMock.mockReset();
    toastMock.mockReset();
    awaitAccurateSampleMock.mockReset();
    awaitAccurateSampleMock.mockResolvedValue({
      lat: 10.77,
      lng: 106.69,
      accuracy: 12,
      timestamp: Date.now(),
    });
    drainMock.mockResolvedValue({ done: 0, failed: 0, conflicts: 0 });
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
      data: {
        ready: false,
        missingItems: [{ code: 'SIGNED_DELIVERY_NOTE', label: 'Thiếu biên bản giao nhận có ký nhận' }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('renders the four ordered milestones and blocks handoff until evidence is ready', async () => {
    renderPage();

    expect(await screen.findByText(/Bốn mốc thực hiện/)).toBeTruthy();
    // "Nhận lệnh vận chuyển" appears twice by design: as the (now
    // non-clickable) Bước 1 status title, and as the sticky bottom button's
    // label — getAllByText covers both without ambiguity.
    expect(screen.getAllByText('Nhận lệnh vận chuyển').length).toBe(2);
    expect(screen.getByText('Đã lấy vỏ / Lấy hàng')).toBeTruthy();
    expect(screen.getByText('Đang đóng / Trả hàng')).toBeTruthy();
    expect(screen.getByText('Đã hạ bãi / Giao hàng xong')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hoàn thành chuyến/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Thiếu biên bản giao nhận có ký nhận/)).toBeTruthy();
  });

  it('does not deadlock the single-action complete button when the draft e-POD is not yet submitted', async () => {
    // Regression (round-3): the button submits the draft e-POD itself, so the
    // gate must not demand an already-submitted e-POD — with the old
    // evidence.ready gate the driver sat at 100% progress with a forever
    // disabled button and no separate submit button to press.
    const milestone = (eventType: string) => ({
      id: 1, tripId: 55, eventType, occurredAt: '2026-08-01T07:00:00.000Z', note: null, recordedBy: 88,
    });
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [
        milestone('ORDER_RECEIVED'),
        milestone('PICKED_UP'),
        milestone('LOADING_OR_RETURNING'),
        milestone('DELIVERED'),
      ] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    useDriverEvidenceStatusMock.mockReturnValue({
      data: {
        ready: false,
        missingItems: [{ code: 'POD_SUBMITTED', label: 'e-POD đã gửi' }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: {
          id: 22,
          tripId: 55,
          fulfillmentId: 88,
          submissionVersion: 1,
          status: TripPodStatus.DRAFT,
          version: 2,
          createdAt: '2026-08-01T01:00:00.000Z',
          updatedAt: '2026-08-01T01:00:00.000Z',
          submittedAt: null,
          reviewedAt: null,
          rejectedAt: null,
          rejectionReason: null,
          acceptedAt: null,
          supersedesSubmissionId: null,
          files: [
            { id: 1, fileType: 'YARD_OR_DROP_RECEIPT', originalFileName: 'yard.jpg', storageKey: 'k1', createdAt: '2026-08-01T01:05:00.000Z' },
            { id: 2, fileType: 'SIGNED_DELIVERY_NOTE', originalFileName: 'note.jpg', storageKey: 'k2', createdAt: '2026-08-01T01:06:00.000Z' },
          ],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderPage();

    const complete = await screen.findByRole('button', { name: /Hoàn thành chuyến/ });
    expect(complete.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Đủ điều kiện hoàn thành chuyến.')).toBeTruthy();
    // The submit-only requirement resolves on click — it must not be listed
    // as a blocker next to an enabled button.
    expect(screen.queryByText('e-POD đã gửi')).toBeNull();
  });

  it('renders container/seal capture buttons and hides the invoice block when there is no invoice info', async () => {
    renderPage();

    expect(await screen.findByText(/Ảnh Cont \/ Seal/)).toBeTruthy();
    expect(screen.getByText('Chụp Cont')).toBeTruthy();
    expect(screen.getByText('Chụp Seal')).toBeTruthy();
    expect(screen.getByText(/Chưa có ảnh cont nào/)).toBeTruthy();
    expect(screen.getByText(/Chưa có ảnh seal nào/)).toBeTruthy();
    expect(screen.queryByText(/Thông tin hóa đơn/)).toBeNull();
  });

  it('renders the CUS driver note in the site-rules section and keeps the empty state only when both are absent', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'QA e2e: vào kho mang mũ bảo hộ, cân tại cầu 3',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    const { unmount } = renderPage();

    expect(await screen.findByTestId('driver-task-driver-notes')).toBeTruthy();
    expect(screen.getByText(/cân tại cầu 3/)).toBeTruthy();
    expect(screen.getByText('Mang đầy đủ PPE')).toBeTruthy();

    // Note absent + rules absent → the empty state stays truthful.
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: { ...makeTaskDetail().fulfillment!, siteRules: [] },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    unmount();
    renderPage();
    expect(await screen.findByText(/Chưa có quy định bổ sung/)).toBeTruthy();
  });

  it('shows the accounting lock and disables field actions', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        accountingLock: {
          billingDocumentId: 91,
          activatedAt: '2026-08-04T08:00:00.000Z',
          activatedByName: 'Kế toán Demo',
          reason: 'Đã chốt công nợ tháng 07/2026.',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    expect(await screen.findByText(/Đã khóa kế toán · Debit Note #91/)).toBeTruthy();
    const acceptStickyBar = screen.getByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Hoàn thành chuyến/ }).matches(':disabled')).toBe(true);
  });

  it('queues the next available milestone with the trip version and fulfillment id', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    fireEvent.click(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ }));

    await waitFor(() => expect(enqueueMock).toHaveBeenCalledTimes(1));
    expect(enqueueMock.mock.calls[0]?.[0]).toMatchObject({
      endpoint: 'driver.task.milestone',
      method: 'POST',
      path: '/driver/me/fulfillments/88/progress',
      payload: {
        kind: 'milestone',
        fulfillmentId: 88,
        eventType: DriverProgressEventType.ORDER_RECEIVED,
        expectedVersion: 3,
      },
    });
  });

  it('disables the inline Bước 1 card so accepting only happens via the sticky bottom button', async () => {
    renderPage();

    await screen.findByTestId('accept-sticky-bar');
    const inlineAcceptCard = screen.getByRole('button', { name: /Nhận lệnh vận chuyển.*Xác nhận đã nhận lệnh giấy/s });
    expect(inlineAcceptCard.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Dùng nút “Nhận lệnh vận chuyển” ở đáy màn hình')).toBeTruthy();
  });

  it('hides the sticky accept bar once the order has already been accepted', async () => {
    useDriverTaskProgressMock.mockReturnValue({
      data: {
        items: [{
          id: 1,
          tripId: 55,
          eventType: DriverProgressEventType.ORDER_RECEIVED,
          occurredAt: '2026-08-01T07:50:00.000Z',
        }],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Bốn mốc thực hiện/);
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
  });

  it('shows queued milestone retry state when fulfillment id differs from trip id', async () => {
    commandsMock.mockReturnValue([{
      id: 'queued-picked-up',
      endpoint: 'driver.task.milestone',
      method: 'POST',
      path: '/driver/me/fulfillments/88/progress',
      payload: {
        kind: 'milestone',
        fulfillmentId: 88,
        eventType: DriverProgressEventType.PICKED_UP,
        expectedVersion: 3,
        occurredAt: '2026-08-01T01:00:00.000Z',
      },
      status: 'FAILED',
      retryCount: 1,
      lastError: 'offline',
      createdAt: '2026-08-01T01:00:00.000Z',
      updatedAt: '2026-08-01T01:01:00.000Z',
    }]);

    renderPage();

    expect(await screen.findByText('Sẽ thử lại')).toBeTruthy();
  });
});
