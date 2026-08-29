import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
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
  it('renders the spec-A4 field order with container, type and seal on one line', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const labels = Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);
    expect(labels).toEqual([
      'Ngày giờ kế hoạch',
      'Nhà máy',
      'Tuyến',
      'Người liên hệ',
      'Số điện thoại',
      'Container / lô hàng',
      'Điểm lấy',
      'Điểm trả',
      'Đầu kéo',
      'Rơ moóc',
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
});
