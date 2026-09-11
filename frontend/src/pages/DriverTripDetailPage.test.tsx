import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProgressEventType, TripPodStatus } from '@tingting/shared';
import { setToken } from '../lib/token';

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
  commandsMock,
  enqueueMock,
  drainMock,
  removeMock,
  toastMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  useDriverTaskProgressMock: vi.fn(),
  useDriverEvidenceStatusMock: vi.fn(),
  commandsMock: vi.fn<() => MockOfflineCommand[]>(() => []),
  enqueueMock: vi.fn(),
  drainMock: vi.fn(),
  removeMock: vi.fn(),
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
  default: () => <div data-testid="trip-pod-submission">pod</div>,
}));

vi.mock('../components/trip/ShipmentCostEntryForm', () => ({
  ShipmentCostEntryForm: () => <div data-testid="shipment-cost-entry-form">Nhập chi phí lô hàng</div>,
  default: () => <div data-testid="shipment-cost-entry-form">Nhập chi phí lô hàng</div>,
}));

vi.mock('../components/trip/FuelRefillReportForm', () => ({
  FuelRefillReportForm: () => <div data-testid="fuel-refill-report-form">Báo cáo đổ dầu</div>,
  default: () => <div data-testid="fuel-refill-report-form">Báo cáo đổ dầu</div>,
}));

vi.mock('../features/driver/useOfflineCommandQueue', () => ({
  buildOfflineCommandKey: (...parts: Array<string | number>) => parts.join(':'),
  useOfflineCommandQueue: () => ({
    commands: commandsMock(),
    enqueue: enqueueMock,
    drain: drainMock,
    remove: removeMock,
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

// Board route target for the A7 completion-navigation assertion. Also stubs
// the pod route with the :id param echoed into the testid, so the CTA test can
// prove the driver lands on the RIGHT trip's e-POD screen (fulfillment id, not
// trip.id — the regression Phần 4 fixed).
function renderPageWithBoard() {
  return render(
    <MemoryRouter initialEntries={['/my-trips/88']}>
      <Routes>
        <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
        <Route path="/my-trips" element={<div data-testid="driver-journey-board" />} />
        <Route
          path="/my-trips/:id/pod"
          element={<PodRouteStub />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function PodRouteStub() {
  const { id } = useParams<{ id: string }>();
  return <div data-testid={`pod-route-stub-${id}`} />;
}

describe('DriverTripDetailPage', () => {
  beforeEach(() => {
    commandsMock.mockReset();
    commandsMock.mockReturnValue([]);
    enqueueMock.mockReset();
    drainMock.mockReset();
    removeMock.mockReset();
    toastMock.mockReset();
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

  // Phần 4 ticket 2026-08-28: Bốn mốc + Thu nhập tham chiếu stay removed.
  // BOTH cost forms are hidden (kế toán từ từ): "Nhập chi phí lô hàng" and
  // the fuel-refill "Báo cáo đổ dầu". 27.8's "GIỮ NGUYÊN" covers the fuel
  // SCREENSHOT upload, not the refill cost form. The e-POD widget is
  // moved to its own /pod page; here we verify it is NOT in the tree.
  it('hides both cost forms, removes milestone/income modules', async () => {
    renderPage();

    await screen.findByTestId('accept-sticky-bar');
    expect(screen.queryByText(/Bốn mốc thực hiện/)).toBeNull();
    expect(screen.queryByText('Đã lấy vỏ / Lấy hàng')).toBeNull();
    expect(screen.queryByText('Đang đóng / Trả hàng')).toBeNull();
    expect(screen.queryByText('Đã hạ bãi / Giao hàng xong')).toBeNull();
    expect(screen.queryByText('Thu nhập tham chiếu')).toBeNull();
    expect(screen.queryByText('Lương phân bổ')).toBeNull();
    expect(screen.queryByText('Tiền đi đường')).toBeNull();
    // cost form hidden
    expect(screen.queryByTestId('shipment-cost-entry-form')).toBeNull();
    // e-POD widget hidden (moved to /pod)
    expect(screen.queryByTestId('trip-pod-submission')).toBeNull();
    // fuel-refill cost form hidden (Phần 1; GIỮ NGUYÊN is the screenshot upload)
    expect(screen.queryByTestId('fuel-refill-report-form')).toBeNull();
  });

  // 27.8 spec: "ẢNH NHIÊN LIỆU (Chụp màn hình bơm gần nhất) : GIỮ NGUYÊN" —
  // the fuel-evidence upload stays visible for the driver.
  it('renders the fuel evidence upload section', async () => {
    renderPage();

    expect(await screen.findByText('Ảnh nhiên liệu')).toBeTruthy();
    expect(screen.getByText('Chụp màn hình bơm gần nhất')).toBeTruthy();
    expect(screen.getByText('Chưa có ảnh nhiên liệu nào cho chuyến này.')).toBeTruthy();
    expect(screen.getByText('Chụp ảnh nhiên liệu')).toBeTruthy();
  });

  // Regression: the fuel-evidence <img> consumed the raw /api/photos/ URL.
  // <img> cannot send the Authorization header, so assetAuthMiddleware 401'd
  // and the browser rendered a broken image; OCR was unaffected (the backend
  // reads the stored bytes directly). The src must go through
  // getAuthenticatedPhotoUrl so the JWT rides along as ?token=.
  it('renders the fuel evidence photo through the token-authenticated URL', async () => {
    setToken('jwt-for-img-test');
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fuelEvidenceReviews: [{
          id: 7,
          tripId: 55,
          tripCode: 'TRIP-55',
          photoUrl: '/api/photos/fuel-evidence%2F55%2F3%2Fhash-rand.jpg',
          ocrOutcome: 'ACCEPTED',
          reviewStatus: 'PENDING',
          litres: '20.84',
          unitPrice: '23490',
          totalAmount: '500000',
          computedTotal: '489532',
          capturedAt: '2026-08-29T05:46:00.000Z',
          latitude: '1.4274301',
          longitude: '103.8421095',
          anomalyReason: null,
          ocrError: null,
          reviewNote: null,
        }],
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    const img = await screen.findByAltText('Ảnh nhiên liệu TRIP-55');
    expect(img.getAttribute('src')).toContain('token=jwt-for-img-test');
  });

  it('renders the sticky accept bar and the Hoàn tất lệnh vận chuyển footer button (e-POD lives on its own page now)', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
    // AC-DISPATCH-002: the bypass banner tells the driver the order is
    // acceptable immediately (Ops field confirmation is skipped for now).
    expect(screen.getByTestId('bypass-ops-banner').textContent).toContain('Nhận lệnh ngay, không cần chờ Ops');
  });

  // D1 fix: a terminal CONFLICT on the accept command must not dead-end the
  // sticky bar. The reload action discards the stuck command for THIS
  // fulfillment and refetches — the bar then returns to available.
  it('recovers the accept bar from a terminal CONFLICT via the reload action', async () => {
    commandsMock.mockReturnValue([
      {
        id: 'cmd-conflict-1',
        endpoint: 'driver.task.milestone',
        method: 'POST',
        path: '/driver/me/fulfillments/88/progress',
        payload: { kind: 'milestone', fulfillmentId: 88, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:00:00.000Z', expectedVersion: 3 },
        status: 'CONFLICT',
        retryCount: 1,
        lastError: 'Xe đang chạy chuyến khác. Vui lòng hoàn thành chuyến đó trước.',
        createdAt: '2026-08-29T02:00:00.000Z',
        updatedAt: '2026-08-29T02:00:05.000Z',
      },
    ]);
    renderPage();

    const reloadBtn = await screen.findByRole('button', { name: /Tải lại để xử lý xung đột/ });
    // The defect: this button used to be permanently disabled.
    expect(reloadBtn.matches(':disabled')).toBe(false);
    // No bypass banner while stuck — the driver cannot accept yet.
    expect(screen.queryByTestId('bypass-ops-banner')).toBeNull();

    fireEvent.click(reloadBtn);
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('cmd-conflict-1'));
    // Refetch ran so the bar re-derives from fresh server state.
    const detailCalls = useDriverTaskDetailMock.mock.results.at(-1)?.value;
    expect(detailCalls?.data).toBeTruthy();
  });

  // AC-DISPATCH-002 counterpart: once the order is accepted, the bypass
  // banner disappears (no longer acceptable — already running).
  it('hides the bypass banner once the order is accepted', async () => {
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    // Accept recorded → acceptState 'done' → no sticky bar at all.
    await screen.findByRole('button', { name: /Hoàn tất lệnh vận chuyển/ });
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
    expect(screen.queryByTestId('bypass-ops-banner')).toBeNull();
  });

  it('renders the e-POD footer CTA enabled and gates on the two missing photos', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
    // Phần 4 ticket 2026-08-28: the trip detail's "Hoàn thành" CTA is now a
    // "Hoàn tất lệnh vận chuyển" link that navigates to /my-trips/:id/pod. The
    // actual complete action lives on the e-POD page.
    const cta = screen.getByRole('button', { name: /Hoàn tất lệnh vận chuyển/ });
    expect(cta.hasAttribute('disabled')).toBe(false);
    // 27.8 "BỐN MỐC THỰC HIỆN: BỎ" — the footer lists only the two e-POD photo
    // gaps, not the evidence endpoint's milestone/label echo (old code echoed
    // the backend label "Thiếu biên bản giao nhận có ký nhận" here).
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
    expect(screen.queryByText(/có ký nhận/)).toBeNull();
  });

  it('navigates to the e-POD page when the driver taps Hoàn tất lệnh vận chuyển (the trip detail no longer completes the trip inline)', async () => {
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

    renderPageWithBoard();

    // Clicking "Hoàn tất lệnh vận chuyển" navigates to the pod page; we don't fire
    // any completion command from the trip detail anymore.
    const cta = await screen.findByRole('button', { name: /Hoàn tất lệnh vận chuyển/ });
    fireEvent.click(cta);

    // The driver lands on THIS trip's pod screen — the route param is the
    // fulfillment id (88), not trip.id (55). Wrong-id navigation here would
    // open another trip's e-POD screen.
    expect(await screen.findByTestId('pod-route-stub-88')).toBeTruthy();
    expect(screen.queryByTestId('pod-route-stub-55')).toBeNull();

    // The trip detail no longer triggers the "complete" offline command on
    // click — that's the pod page's job. The driver is on the trip detail
    // until they actually submit the e-POD.
    expect(drainMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  // Spec A7 (re-homed on the pod page): "Hoàn thành chuyến" auto-navigates off
  // the pod screen once completion is confirmed online. On the trip detail
  // page, the driver just sees the "Hoàn tất lệnh vận chuyển" CTA — actual completion
  // lives at /my-trips/:id/pod (covered by DriverTripPodPage tests).
  it('does not trigger any complete/enqueue command from the trip detail CTA', async () => {
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

    const cta = await screen.findByRole('button', { name: /Hoàn tất lệnh vận chuyển/ });
    fireEvent.click(cta);

    // The trip detail must NOT issue the complete offline command anymore
    // (the pod page owns the completion lifecycle).
    expect(drainMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('stays on the trip detail (the e-POD CTA is a navigation link, not a submit)', async () => {
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

    renderPageWithBoard();

    const cta = await screen.findByRole('button', { name: /Hoàn tất lệnh vận chuyển/ });
    fireEvent.click(cta);

    // The trip detail doesn't navigate away on the CTA (a real router would
    // change the URL, but the click is wired through react-router's
    // <Link> and we don't have a Router assertion here). The point is: the
    // driver is NOT shown a queued complete or a journey-board jump.
    expect(screen.queryByTestId('driver-journey-board')).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  // Spec A4: the detail fact grid mirrors the journey-card order, with
  // container number + type + seal sharing one line.
  it('renders the ticket-365943ea field order with container, type and seal on one line', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const labels = Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);
    expect(labels).toEqual([
      'Nhà máy',
      'Tuyến',
      'Container / lô hàng',
      'Cảng nâng',
      'Cảng hạ',
      'Ngày giờ kế hoạch',
      'Người liên hệ',
      'Số điện thoại',
    ]);
    expect(screen.getByText('MSCU1234561 · 40FT · Seal SEAL-9')).toBeTruthy();
    expect(screen.queryByText('Loại container')).toBeNull();
    expect(screen.queryByText('Số seal')).toBeNull();
  });

  // KẾT HỢP / paired trips carry multiple containers — the one-line fact must
  // separate them (a bare .map() renders adjacent text nodes with no gap).
  it('separates multiple containers on the one-line container fact', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        containers: [
          { id: 1, containerNumber: 'MSCU1234561', sealNumber: 'SEAL-9', containerTypeId: 1, containerTypeName: '40FT', containerTypeCode: '40G1', cargoWeightKg: null },
          { id: 2, containerNumber: 'MSCU7654321', sealNumber: 'SEAL-8', containerTypeId: 1, containerTypeName: '40FT', containerTypeCode: '40G1', cargoWeightKg: null },
        ],
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    expect(await screen.findByText('MSCU1234561 · 40FT · Seal SEAL-9 · MSCU7654321 · 40FT · Seal SEAL-8')).toBeTruthy();
  });

  it('renders the container card and hides the invoice block when there is no invoice info', async () => {
    renderPage();

    expect(await screen.findByText(/Số cont & seal/)).toBeTruthy();
    expect(screen.queryByText(/Thông tin xuất hóa đơn/)).toBeNull();
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
    expect(await screen.findByText(/Chưa có ghi chú cho chuyến này/)).toBeTruthy();
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
    // Phần 4 ticket 2026-08-28: the trip detail's "Hoàn tất lệnh vận chuyển" CTA is
    // a navigation link, not a destructive action. The accounting lock
    // gates the *completion* (now on the pod page), so the trip-detail CTA
    // here is not the place to assert disabled. We keep the lock banner
    // assertion; the disabled state is covered in DriverTripPodPage tests.
    expect(screen.queryByRole('button', { name: /HOÀN THÀNH CHUYẾN/ })).toBeNull();
  });

  it('queues the ORDER_RECEIVED milestone with the trip version and fulfillment id when sticky accept is clicked', async () => {
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

    expect(await screen.findByText(/Số cont & seal/)).toBeTruthy();
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
  });
  // ─── 36d0183d driver-app enhancements (wave 2026-09-11) ──────────────────

  // TC-DA-004 (re-confirmed 2a618442): "Bỏ đầu kéo - moóc" = BOTH vehicle
  // rows stay OFF the driver mobile grid; wire fields remain.
  it('TC-DA-004: hides the Đầu kéo / Rơ moóc fact rows', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    expect(screen.queryByText('Đầu kéo')).toBeNull();
    expect(screen.queryByText('Rơ moóc')).toBeNull();
    expect(screen.queryByText('51C-12345')).toBeNull();
    expect(screen.queryByText('51R-55555')).toBeNull();
  });

  // TC-DA-002: Tuyến row carries the factory site street ADDRESS when the
  // site join provides one — never the factory name.
  it('TC-DA-002: Tuyến row shows the factory address, not the name', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          factoryAddress: '123 Nguyễn Văn A, Bình Dương',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const routeRow = Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === 'Tuyến');
    const routeValue = routeRow?.querySelector('.driver-task-fact__value')?.textContent ?? '';
    expect(routeValue).toBe('123 Nguyễn Văn A, Bình Dương');
  });

  // TC-DA-003: kho phone row hidden when absent — no dash placeholder.
  // 2a618442: label follows the mockup copy "SĐT kho".
  it('TC-DA-003: hides the SĐT kho row when the site has no phone', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const labels = Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);
    expect(labels).not.toContain('SĐT kho');
  });

  it('TC-DA-003: renders the Kho row as a tel link when the site has a phone', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          khoPhone: '0901234567',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const khoLink = await screen.findByText('0901234567');
    expect(khoLink.getAttribute('href')).toBe('tel:0901234567');
  });

  // TC-DA-005: customer master-data invoice rows render with the exact
  // Vietnamese labels and per-row graceful hide. 2a618442: head follows the
  // mockup copy "Thông tin xuất hóa đơn", row order company → address → MST.
  it('TC-DA-005: renders Tên công ty / Địa chỉ / MST from master data, hiding nulls', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        invoiceMaster: { taxCode: '3701234567', companyName: 'Công ty TNHH ABC', address: null },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText('Thông tin xuất hóa đơn');
    const headLabels = Array.from(document.querySelectorAll('.driver-task-grid .driver-task-fact__label'))
      .map((el) => el.textContent)
      .filter((label) => ['Tên công ty', 'Địa chỉ', 'MST'].includes(label ?? ''));
    expect(headLabels).toEqual(['Tên công ty', 'MST']);
    expect(screen.getByText('3701234567')).toBeTruthy();
    expect(screen.getByText('Công ty TNHH ABC')).toBeTruthy();
    expect(screen.queryByText('Địa chỉ')).toBeNull();
  });

  // TC-DA-006: ONE chip carries the close status (EXPORT→Đóng, IMPORT→Trả),
  // hidden when tradeDirection is null.
  it('TC-DA-006: renders one Đóng chip for EXPORT and none without tradeDirection', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ tradeDirection: 'EXPORT' }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    const { unmount } = renderPage();
    await screen.findByText(/Số cont & seal/);
    expect(screen.getAllByTestId('close-status-chip').map((chip) => chip.textContent)).toEqual(['Đóng']);
    unmount();

    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail(),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();
    await screen.findByText(/Số cont & seal/);
    expect(screen.queryByTestId('close-status-chip')).toBeNull();
  });

  it('TC-DA-006: renders Trả for IMPORT', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ tradeDirection: 'IMPORT' }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    expect(screen.getAllByTestId('close-status-chip').map((chip) => chip.textContent)).toEqual(['Trả']);
  });

  // TC-DA-001: chips resolve via parseNote against the wire tag pool; N ≥ 6
  // collapses to the first 4 behind a Mở rộng/Thu gọn toggle.
  it('TC-DA-001: collapses 6+ chips behind a Mở rộng/Thu gọn toggle', async () => {
    const tags = ['Kiểm đếm', 'Cân đầu', 'Chụp ảnh seal', 'Đóng hàng', 'Nâng cont', 'Hạ cont'];
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: tags,
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'Kiểm đếm; Cân đầu; Chụp ảnh seal; Đóng hàng; Nâng cont; Hạ cont',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByTestId('operation-chips');
    let chips = screen.getAllByTestId('operation-chip');
    expect(chips).toHaveLength(4);
    // Scope to the chips region: the 2a618442 header toggle's accessible name
    // also contains "Mở rộng", so a page-wide query would be ambiguous.
    const chipsRegion = screen.getByTestId('operation-chips');
    const toggle = within(chipsRegion).getByRole('button', { name: /Mở rộng/ });
    fireEvent.click(toggle);
    chips = screen.getAllByTestId('operation-chip');
    expect(chips).toHaveLength(6);
    expect(within(chipsRegion).getByRole('button', { name: /Thu gọn/ })).toBeTruthy();
    fireEvent.click(within(chipsRegion).getByRole('button', { name: /Thu gọn/ }));
    expect(screen.getAllByTestId('operation-chip')).toHaveLength(4);
  });

  it('TC-DA-001: short lists render fully expanded without a toggle', async () => {
    const tags = ['Kiểm đếm', 'Cân đầu', 'Chụp ảnh seal'];
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: tags,
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'Kiểm đếm; Cân đầu; Chụp ảnh seal',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByTestId('operation-chips');
    expect(screen.getAllByTestId('operation-chip')).toHaveLength(3);
    // No chips toggle here — and the header toggle (also matching "Mở rộng")
    // lives OUTSIDE the chips region, so scoping keeps this assertion honest.
    expect(within(screen.getByTestId('operation-chips')).queryByRole('button', { name: /Mở rộng|Thu gọn/ })).toBeNull();
  });

  // 851e8f7d format v2: two-line note — line 1 feeds the chips, the free-text
  // part renders in the note section WITHOUT the tag line duplicated.
  it('851e8f7d: v2 two-line note renders chips + free text without duplication', async () => {
    const tags = ['KIỂM HÓA', 'QUAY ĐẦU'];
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: tags,
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'KIỂM HÓA; QUAY ĐẦU\nghép cont với lô khác, cẩn thận seal',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByTestId('operation-chips');
    expect(screen.getAllByTestId('operation-chip').map((chip) => chip.textContent)).toEqual(tags);
    const note = await screen.findByTestId('driver-task-driver-notes');
    expect(note.textContent).toContain('ghép cont với lô khác, cẩn thận seal');
    expect(note.textContent).not.toContain('KIỂM HÓA');
  });

  // 2a618442: the TÁC VỤ TÀI XẾ header is DEFAULT EXPANDED (route title +
  // customer); collapsing is the user's opt-out — collapsed shows the factory
  // short name + Tuyến line and hides the customer name. Status pill +
  // Đóng/Trả chip stay visible in both states.
  it('2a618442: collapses to factory short name + route line on toggle, expanding restores route + customer', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          factoryShortName: 'ASKEY',
          factoryAddress: 'KCN Quế Võ, Bắc Ninh',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Default EXPANDED: route title + customer, no route line.
    const toggle = screen.getByRole('button', { name: 'Thu gọn thông tin tác vụ' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Cảng Cát Lái → Nhà máy Bình Dương')).toBeTruthy();
    expect(screen.getByText('SilverSea')).toBeTruthy();
    expect(document.querySelector('.driver-task-header__route')).toBeNull();

    fireEvent.click(toggle);
    // Collapsed: factory short name + Tuyến line, customer hidden.
    expect(screen.getByText('ASKEY')).toBeTruthy();
    expect(document.querySelector('.driver-task-header__route')?.textContent).toBe('KCN Quế Võ, Bắc Ninh');
    expect(screen.queryByText('SilverSea')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mở rộng thông tin tác vụ' })).toBeTruthy();
  });

  // 2a618442: without factory data the collapsed title falls back to the
  // route name and the redundant route line stays hidden (it belongs under a
  // factory title only).
  it('2a618442: falls back to the route title and hides the route line without factory name', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          factoryName: null,
          factoryShortName: null,
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Collapse first — expanded title is the route either way.
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn thông tin tác vụ' }));
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('Cảng Cát Lái → Nhà máy Bình Dương');
    expect(document.querySelector('.driver-task-header__route')).toBeNull();
  });

  // 40f3ae15: the biên bản giao hàng capture block lives in the SỐ CONT & SEAL
  // section (always reachable — outside the container form/bento switch); its
  // thumbnail shows only when an OTHER photo rides the wire.
  it('40f3ae15: shows the biên bản capture block and hides its thumbnail without an OTHER photo', async () => {
    renderPage();

    await screen.findByTestId('delivery-note-block');
    expect(screen.getByText('Chụp / chọn ảnh biên bản giao hàng')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mở camera biên bản' })).toBeTruthy();
    expect(screen.queryByAltText('Ảnh biên bản giao hàng')).toBeNull();
  });

  it('40f3ae15: renders the biên bản thumbnail when a DELIVERY_NOTE photo rides the wire', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          containerSealPhotos: [
            { id: 3, type: 'DELIVERY_NOTE', storageKey: 'trips/55/delivery-note.jpg', uploadedAt: '2026-08-01T02:00:00.000Z' },
          ],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    const img = await screen.findByAltText('Ảnh biên bản giao hàng');
    expect(img.getAttribute('src')).toContain(encodeURIComponent('trips/55/delivery-note.jpg'));
    expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản' })).toBeTruthy();
  });
});
