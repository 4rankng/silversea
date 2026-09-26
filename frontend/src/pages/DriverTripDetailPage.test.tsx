import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProgressEventType, TripPodStatus, TripStatus } from '@tingting/shared';
import { setToken } from '../lib/token';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getDriverTripMock = vi.hoisted(() => vi.fn());

// Synchronous trip payload for the page's first render — the trip →
// fulfillmentId resolution is seeded into the query cache so existing
// tests keep their synchronous shape.
const tripBasic88: Record<string, unknown> = {
  id: 88, shipmentId: null, fulfillmentId: 88, tripCode: 'TRP-88',
  departureDate: null, plannedStartAt: null, status: 'IN_TRANSIT',
  routeName: null, truckPlate: null, customerName: null, notes: null,
};
function freshClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['driver-trip-basic', '88'], tripBasic88);
  return client;
}

vi.mock('../api/driverClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/driverClient')>();
  // getDriverTrip is replaced per-test via vi.spyOn in the resolution suite —
  // the spy binds to THIS module instance, which the page also imports.
  void getDriverTripMock;
  return actual;
});

const {
  useDriverTaskDetailMock,
  useDriverTaskProgressMock,
  useDriverEvidenceStatusMock,
  toastMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  useDriverTaskProgressMock: vi.fn(),
  useDriverEvidenceStatusMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../hooks/useDriverQueries', () => ({
  useDriverTaskDetail: useDriverTaskDetailMock,
  useDriverJourneyBoard: () => ({ data: { items: boardItems } }),
  useDriverTaskProgress: useDriverTaskProgressMock,
  useDriverEvidenceStatus: useDriverEvidenceStatusMock,
}));

vi.mock('../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../hooks/useBackShortcut', () => ({
  useBackShortcut: vi.fn(),
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

vi.mock('../lib/idempotency', () => ({
  buildIdempotencyKey: (...parts: Array<string | number>) => parts.join(':'),
}));

import DriverTripDetailPage from './DriverTripDetailPage';
import { driverClient } from '../api/driverClient';

/** Board cards the journey-board mock returns (default: none). */
let boardItems: Array<Record<string, unknown>> = [];

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
  const client = freshClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/my-trips/88']}>
        <Routes>
          <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Board route target for the A7 completion-navigation assertion. Also stubs
// the pod route with the :id param echoed into the testid, so the CTA test can
// prove the driver lands on the RIGHT trip's e-POD screen (fulfillment id, not
// trip.id — the regression Phần 4 fixed).
function renderPageWithBoard() {
  const client = freshClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/my-trips/88']}>
        <Routes>
          <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
          <Route path="/my-trips" element={<div data-testid="driver-journey-board" />} />
          <Route
            path="/my-trips/:id/pod"
            element={<PodRouteStub />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function PodRouteStub() {
  const { id } = useParams<{ id: string }>();
  return <div data-testid={`pod-route-stub-${id}`} />;
}

describe('DriverTripDetailPage', () => {
  beforeEach(() => {
    getDriverTripMock.mockResolvedValue({
      id: 88, shipmentId: null, fulfillmentId: 88, tripCode: 'TRP-88',
      departureDate: null, plannedStartAt: null, status: 'IN_TRANSIT',
      routeName: null, truckPlate: null, customerName: null, notes: null,
    });
    boardItems = [];
    toastMock.mockReset();
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

  it.each([TripStatus.COMPLETED, TripStatus.CANCELED])('does not offer acceptance for a %s legacy order without milestone history', async (status) => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status }), isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await screen.findByText('FUL-88');
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
    expect(screen.queryByTestId('bypass-ops-banner')).toBeNull();
    expect(screen.queryByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeNull();
  });

  it('DRV-FOLLOWUP-004 keeps a cancelled order read-only while retaining document access', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: TripStatus.CANCELED }), isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await screen.findByText('FUL-88');
    expect(screen.queryByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa số cont' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chụp.*nhiên liệu|Chụp lại ảnh mới/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hoàn tất lệnh vận chuyển/ })).toBeNull();
    expect(screen.getByText('Chuyến đã hủy')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Xem chứng từ giao hàng' })).toHaveAttribute('href', '/my-trips/88/pod');
  });

  // Phần 4 ticket 2026-08-28: Bốn mốc + Thu nhập tham chiếu stay removed.
  // Expense entry is now enabled by the customer expense requirements.
  // Fuel screenshots and the separate e-POD route retain their own roles.
  it('restores shipment cost entry while keeping the separate fuel form hidden', async () => {
    renderPage();

    await screen.findByTestId('accept-sticky-bar');
    expect(screen.queryByText(/Bốn mốc thực hiện/)).toBeNull();
    expect(screen.queryByText('Đã lấy vỏ / Lấy hàng')).toBeNull();
    expect(screen.queryByText('Đang đóng / Trả hàng')).toBeNull();
    expect(screen.queryByText('Đã hạ bãi / Giao hàng xong')).toBeNull();
    expect(screen.queryByText('Thu nhập tham chiếu')).toBeNull();
    expect(screen.queryByText('Lương phân bổ')).toBeNull();
    expect(screen.queryByText('Tiền đi đường')).toBeNull();
    expect(screen.getByTestId('shipment-cost-entry-form')).toBeTruthy();
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

    // The alt no longer carries the trip code: internal ids never render on
    // a user surface (dc1b1cba), so the code-leading variant would fail here.
    const img = await screen.findByAltText('Ảnh nhiên liệu');
    expect(img.getAttribute('src')).toContain('token=jwt-for-img-test');
    expect(screen.getByText(/OCR chưa xác minh/)).toBeTruthy();
    expect(screen.queryByText(/Chờ kế toán xác nhận/)).toBeNull();
  });

  it('renders the sticky accept bar and the Hoàn tất lệnh vận chuyển footer button (e-POD lives on its own page now)', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
    // AC-DISPATCH-002: the pre-acceptance banner gives one short task
    // instruction plus its effect — plain copy, no rollout/Ops terminology.
    expect(screen.getByTestId('bypass-ops-banner').textContent).toContain('Kiểm tra thông tin chuyến rồi chọn Nhận lệnh');
    expect(screen.getByTestId('bypass-ops-banner').textContent).toContain('Sau khi nhận lệnh, chuyến bắt đầu');
  });

  // Offline queue and conflict recovery have been removed — the accept bar
  // now uses a direct API call.  Conflict-banner tests are no longer applicable.

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

    // Accept recorded → acceptState 'done' → the completion bar owns the
    // sticky slot (card _28 item 10).
    await screen.findByTestId('complete-sticky-bar');
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
    expect(screen.queryByTestId('bypass-ops-banner')).toBeNull();
  });

  it('renders the e-POD footer CTA enabled and gates on the two missing photos', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
    // Card _28 item 10: before acceptance the completion action has no sticky
    // slot — the accept bar owns it; the Chứng từ card still lists the two
    // e-POD photo gaps.
    expect(screen.queryByTestId('complete-sticky-bar')).toBeNull();
    // 27.8 "BỐN MỐC THỰC HIỆN: BỎ" — the Chứng từ card lists only the two
    // e-POD photo gaps, not the evidence endpoint's milestone/label echo.
    expect(screen.getByText('Thiếu Phiếu bãi / phiếu hạ')).toBeTruthy();
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
    expect(screen.queryByText(/có ký nhận/)).toBeNull();
  });

  it('navigates to the e-POD page when the driver taps the sticky completion action (the trip detail no longer completes the trip inline)', async () => {
    // Card _28 item 10: the action lives in the sticky bar, which owns the
    // slot only once the order is accepted.
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
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

    renderPageWithBoard();

    // Tapping the sticky "Hoàn thành" action navigates to the pod page; we
    // don't fire any completion command from the trip detail anymore.
    const cta = await screen.findByRole('button', { name: /Hoàn thành/ });
    fireEvent.click(cta);

    // The driver lands on THIS trip's pod screen — the route param is the
    // fulfillment id (88), not trip.id (55). Wrong-id navigation here would
    // open another trip's e-POD screen.
    expect(await screen.findByTestId('pod-route-stub-88')).toBeTruthy();
    expect(screen.queryByTestId('pod-route-stub-55')).toBeNull();

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

    // Card _28 item 10: the completion action is the sticky bar's button
    // (owning the slot once the order is accepted).
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderPageWithBoard();

    await screen.findByTestId('complete-sticky-bar');
    const cta = screen.getByRole('button', { name: /Hoàn thành/ });
    fireEvent.click(cta);

    // The trip detail doesn't fire a completion command from the sticky
    // action — the driver is NOT shown a queued complete or a journey-board
    // jump; the action navigates to the e-POD screen instead.
    expect(screen.queryByTestId('driver-journey-board')).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  // 20260911_3 BUG 5 (supersedes the 365943ea order), restated 26/09 after
  // 1af13d12 + dc1b1cba; amended 26/09 card _26: the bill/booking code moved
  // into the header title (item 4), so the grid leads with the factory block
  // + kho phone, then the working facts (container, ports) — the Tuyến
  // address line is demoted below them.
  it('renders the customer field order: factory, contact, container, seal and ports (no duplicate route or phone row)', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const labels = Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);
    expect(labels).toEqual([
      'Ngày giờ kế hoạch',
      'Tên nhà máy',
      'Địa chỉ nhà máy',
      'SĐT kho',
      'SĐT liên hệ',
      'Cảng nâng',
      'Cảng hạ',
    ]);
    // Card _27 item 5: the abbrev row is gone — the fixture's factory name
    // ('Nhà máy Bình Dương') renders as the header line-2 location instead.
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('Nhà máy Bình Dương');
    // Sparse fixture: full name falls back to the free-text name; the address
    // row dashes; the Tuyến row no longer exists at all.
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('Tên nhà máy')).toBe('Nhà máy Bình Dương');
    expect(valueOf('Địa chỉ nhà máy')).toBe('—');
    expect(valueOf('Tuyến')).toBeUndefined();
  });
  it('card _27: containers and seals live only in the Số cont & seal card, never in the info grid', async () => {
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

    await screen.findByText(/Số cont & seal/);
    // The read-only duplicate rows are gone from the fact grid.
    expect(screen.queryByText('Container / lô hàng')).toBeNull();
    expect(screen.queryByText(/Seal SEAL-9/)).toBeNull();
    // The single home still carries both containers — the saved bento leads
    // with the first container's number.
    expect(document.querySelector('.dcc-bento__plate')?.textContent).toContain('MSCU1234561');
  });

  it('renders the container card and identifies missing factory invoice configuration', async () => {
    renderPage();

    expect(await screen.findByText(/Số cont & seal/)).toBeTruthy();
    expect(screen.getByText(/Thông tin xuất hóa đơn/)).toBeTruthy();
    expect(screen.getByText('Nhà máy chưa cấu hình thông tin xuất hóa đơn.')).toBeTruthy();
  });

  it('renders driver notes separately and identifies absent site rules even when notes exist', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'QA e2e: vào kho mang mũ bảo hộ, cân tại cầu 3',
          siteRules: [],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    const { unmount } = renderPage();

    expect(await screen.findByTestId('driver-task-driver-notes')).toBeTruthy();
    expect(screen.getByText(/cân tại cầu 3/)).toBeTruthy();
    expect(screen.getByText('Chưa có quy định tại điểm làm hàng.')).toBeTruthy();

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
    expect(await screen.findByText('Chưa có quy định tại điểm làm hàng.')).toBeTruthy();
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

    expect(await screen.findByText(/Đã khóa kế toán · Debit Note —/)).toBeTruthy();
    const acceptStickyBar = screen.getByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ }).matches(':disabled')).toBe(true);
    // Phần 4 ticket 2026-08-28: the trip detail's "Hoàn tất lệnh vận chuyển" CTA is
    // a navigation link, not a destructive action. The accounting lock
    // gates the *completion* (now on the pod page), so the trip-detail CTA
    // here is not the place to assert disabled. We keep the lock banner
    // assertion; the disabled state is covered in DriverTripPodPage tests.
    expect(screen.queryByRole('button', { name: /HOÀN THÀNH CHUYẾN/ })).toBeNull();
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

  it('VID-DRV-01 keeps the route once in the header and the factory address in order information', async () => {
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
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('Địa chỉ nhà máy')).toBe('123 Nguyễn Văn A, Bình Dương');
    expect(valueOf('Tuyến')).toBeUndefined();
    // Card _26: the route line retired from the header — the ports in the
    // grid carry the route; the header shows location, not route text.
    expect(screen.queryByText('Cát Lái → Bình Dương')).toBeNull();
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('Nhà máy Bình Dương');
  });

  it('VID-DRV-02 places task and note instructions before invoice details and keeps them visible through disclosures', async () => {
    renderPage();
    await screen.findByText('Thông tin lệnh');

    const info = document.getElementById('driver-task-info-grid')!;
    const notes = screen.getByTestId('task-note-section');
    const invoice = document.getElementById('driver-task-invoice-grid')!;
    expect(info.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes.compareDocumentPosition(invoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Card _30 item 15: the section spine follows driver priority — Chứng từ
    // giao hàng (checklist card) leads, back-office hóa đơn trails last.
    const podCard = document.querySelector('.driver-task-footer');
    const contCard = document.querySelector('.dcc-section');
    const costForm = screen.getByTestId('shipment-cost-entry-form');
    expect(podCard!.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contCard!.compareDocumentPosition(costForm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(costForm.compareDocumentPosition(invoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Card _30 item 17: hóa đơn is back-office — default-collapsed.
    expect(screen.getByTestId('task-section-toggle-driver-task-invoice-grid').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('task-section-toggle-driver-task-info-grid'));
    // Invoice starts collapsed; one click expands it.
    fireEvent.click(screen.getByTestId('task-section-toggle-driver-task-invoice-grid'));
    expect(info.hidden).toBe(true);
    expect(invoice.hidden).toBe(false);
    expect(notes).toBeVisible();
    // Invoice collapses back on demand.
    fireEvent.click(screen.getByTestId('task-section-toggle-driver-task-invoice-grid'));
    expect(invoice.hidden).toBe(true);
  });

  // Card _30 item 16: compact progress summary at the top — the driver sees
  // what is missing without scrolling.
  it('card _30: progress summary leads the screen with doc/photo/cost counts', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const strip = screen.getByTestId('driver-task-progress');
    // Fixture: no POD files, no cont/seal/biên-bản photos, no costs.
    expect(strip.textContent).toContain('Chứng từ 0/2');
    expect(strip.textContent).toContain('Ảnh 0/3');
    expect(strip.textContent).toContain('Chi phí 0');
  });

  it('card _28: copy affordances ride the header code and the MST rows', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Header: the display key carries a copy button.
    expect(screen.getByRole('button', { name: 'Copy Số Bill / Booking' })).toBeTruthy();
    // Invoice MST rows (collapsed by default): expand, then check both copy
    // buttons. Base fixture has factory MST absent — expand shows the empty
    // note, so assert on the header copy + the invoice section's MST when
    // master data exists.
    fireEvent.click(screen.getByTestId('task-section-toggle-driver-task-invoice-grid'));
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        invoiceMaster: { taxCode: '3701234567', companyName: 'Công ty TNHH ABC', address: null },
      }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
  });

  it('card _28: sticky completion bar shows the live missing count', async () => {
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Trip IN_TRANSIT, 0/2 POD files → the bar shows the missing count and
    // the completion action navigates to the e-POD screen.
    const bar = screen.getByTestId('complete-sticky-bar');
    expect(screen.getByTestId('complete-sticky-status').textContent).toBe('Còn thiếu 2 chứng từ');
    const btn = screen.getByRole('button', { name: /Hoàn thành/ });
    expect(btn).toBeEnabled();
  });

  it('card _28: the sticky bar never stacks with the accept bar', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: 'CREATED' }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // CREATED trip: the accept bar owns the sticky slot; the complete bar
    // stays hidden until the order is accepted.
    expect(screen.queryByTestId('complete-sticky-bar')).toBeNull();
    expect(screen.getByTestId('accept-sticky-bar')).toBeTruthy();
  });

  it('card _28: sticky bar hides on a closed trip (link takes over in the Chứng từ card)', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: 'COMPLETED' }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    expect(screen.queryByTestId('complete-sticky-bar')).toBeNull();
    expect(screen.getByRole('link', { name: 'Xem chứng từ giao hàng' })).toBeTruthy();
  });

  it('card _28: Thêm ảnh opens one action sheet with camera + gallery + Hủy', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ containers: [] }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // No container saved → the form renders with the merged capture zones.
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh cont' }));
    expect(screen.getByRole('dialog', { name: 'Thêm ảnh' })).toBeTruthy();
    expect(screen.getAllByText('Thêm ảnh cont').length).toBeGreaterThan(0);
    // One camera entry + one gallery entry inside the sheet.
    expect(screen.getAllByRole('button', { name: 'Chụp ảnh' }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'Chọn từ thư viện' }).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog', { name: 'Thêm ảnh' })).toBeNull();
  });

  it('card _30: progress summary counts saved POD files, photos and reported cost entries', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: {
          ...makeTaskDetail().currentPod!,
          files: [
            { id: 1, fileType: 'YARD_OR_DROP_RECEIPT', storageKey: 'k1' } as never,
            { id: 2, fileType: 'SIGNED_DELIVERY_NOTE', storageKey: 'k2' } as never,
          ],
        },
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          containerSealPhotos: [
            { id: 1, type: 'CONTAINER', storageKey: 'c1', uploadedAt: '2026-08-01T00:00:00.000Z' },
            { id: 2, type: 'SEAL', storageKey: 's1', uploadedAt: '2026-08-01T00:00:00.000Z' },
            { id: 3, type: 'DELIVERY_NOTE', storageKey: 'd1', uploadedAt: '2026-08-01T00:00:00.000Z' },
          ],
        },
      }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const strip = screen.getByTestId('driver-task-progress');
    expect(strip.textContent).toContain('Chứng từ 2/2');
    expect(strip.textContent).toContain('Ảnh 3/3');
    expect(strip.textContent).toContain('Chi phí 0');
  });

  // _30: the standalone warehouse-phone row is removed at the source — the
  // combined contact row carries the callable number.
  it('card _27: renders the SĐT liên hệ row when the contact number differs from the kho number', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Page fixture: contactPhone 0909000001, khoPhone absent → one kho row
    // (dashed) + one contact row. Identical numbers would render one row.
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('SĐT liên hệ')).toBe('0909000001');
  });

  it('card _27: identical kho and contact numbers render ONE phone row', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: { ...makeTaskDetail().fulfillment!, khoPhone: '0909000001', contactPhone: '0909000001' },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('SĐT kho')).toBe('0909000001');
    expect(screen.queryByText('SĐT liên hệ')).toBeNull();
    expect(screen.getByRole('link', { name: /Gọi kho/ })).toBeTruthy();
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

  // Fee-invoice rows must be complete: name · address · MST on one line,
  // with each segment hiding itself when its field is missing.
  it('TC-DA-005: fee-invoice rows render name, address and MST with per-segment graceful hide', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          invoiceInfo: {
            liftFeeInvoiceName: 'CTY TNHH Nâng Hàng',
            liftFeeInvoiceAddress: '12 Đường Số 5, KCN Sóng Thần',
            liftFeeTaxCode: '3701234567',
            dropFeeInvoiceName: 'CTY TNHH Hạ Hàng',
            dropFeeInvoiceAddress: null,
            dropFeeTaxCode: '3707654321',
            cleaningInvoiceName: 'CTY Vệ Sinh Container',
            cleaningInvoiceAddress: '9 Phạm Ngũ Lão',
            cleaningTaxCode: null,
          },
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    expect(await screen.findByText('CTY TNHH Nâng Hàng · 12 Đường Số 5, KCN Sóng Thần · MST 3701234567')).toBeTruthy();
    expect(screen.getByText('CTY TNHH Hạ Hàng · MST 3707654321')).toBeTruthy();
    expect(screen.getByText('CTY Vệ Sinh Container · 9 Phạm Ngũ Lão')).toBeTruthy();
  });

  // TC-COMP-004 (20260911_2 BUG 1): the task-info section collapses behind its
  // head row to save screen space; collapsed, the head keeps the factory
  // short-name summary so the driver still recognizes the trip.
  it('TC-COMP-004: task info section collapses behind its head and restores', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: { ...makeTaskDetail().fulfillment!, factoryShortName: 'ASKEY' },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText('Thông tin lệnh');
    // Card _27 item 5: the abbrev row is gone from the grid — the factory
    // short name renders as the header line-2 location instead.
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('ASKEY');
    const toggle = screen.getByTestId('task-section-toggle-driver-task-info-grid');
    const grid = document.getElementById('driver-task-info-grid') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(grid.hidden).toBe(false);
    expect(screen.queryByTestId('task-section-summary-driver-task-info-grid')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(grid.hidden).toBe(true);
    expect(screen.getByTestId('task-section-summary-driver-task-info-grid').textContent).toBe('ASKEY');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(grid.hidden).toBe(false);
    expect(screen.queryByTestId('task-section-summary-driver-task-info-grid')).toBeNull();
  });

  // TC-COMP-004b: the invoice section collapses independently — collapsing
  // one section must not touch the other.
  it('TC-COMP-004b: invoice section toggles independently of task info', async () => {
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
    const invoiceToggle = screen.getByTestId('task-section-toggle-driver-task-invoice-grid');
    const invoiceGrid = document.getElementById('driver-task-invoice-grid') as HTMLElement;
    const infoGrid = document.getElementById('driver-task-info-grid') as HTMLElement;
    // Card _30 item 17: invoice starts collapsed (back-office off the
    // critical path) and expands on demand — collapsing/expanding it never
    // touches the info section.
    expect(invoiceToggle.getAttribute('aria-expanded')).toBe('false');
    expect(invoiceGrid.hidden).toBe(true);
    fireEvent.click(invoiceToggle);
    expect(invoiceToggle.getAttribute('aria-expanded')).toBe('true');
    expect(invoiceGrid.hidden).toBe(false);
    expect(infoGrid.hidden).toBe(false);
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
    // Scope to the chips region — page-wide role queries stay scoped to the
    // surface under test even after the 20260926_20 header-toggle removal.
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
    // No chips toggle for short lists — scoped to the chips region so the
    // assertion reads only that surface.
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

  it('DRV-R01: uppercase tasks and original multiline notes render as separate labeled lines', async () => {
    const tags = ['Kiểm hóa', 'Quay đầu'];
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: tags,
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'Kiểm hóa; Quay đầu\nGọi chị An trước khi đến\nKiểm tra seal tại kho',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    expect(await screen.findByText('Tác vụ')).toBeTruthy();
    expect(screen.getByText('Ghi chú')).toBeTruthy();
    const note = screen.getByTestId('driver-task-driver-notes');
    expect(note.textContent).toContain('Gọi chị An trước khi đến\nKiểm tra seal tại kho');
    expect(screen.getAllByTestId('operation-chip').map((chip) => chip.textContent)).toEqual(['KIỂM HÓA', 'QUAY ĐẦU']);
  });

  // 20260926_20: the TÁC VỤ TÀI XẾ header ALWAYS shows fully — the collapse
  // chevron is removed (it hid only the customer name: no real space saving).
  // Status pill + Đóng/Trả chip + customer render unconditionally.
  it('20260926_20: header renders fully — collapse toggle gone, customer always visible', async () => {
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
    // No expand/collapse affordance exists on the header — neither by
    // accessible name nor by the old class hook.
    expect(screen.queryByRole('button', { name: 'Thu gọn thông tin tác vụ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở rộng thông tin tác vụ' })).toBeNull();
    expect(document.querySelector('.driver-task-header__toggle')).toBeNull();
    // Full header content renders without any toggle interaction.
    // Card _26: the bill/booking code leads the title; the factory short
    // name renders as the line-2 location.
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('FUL-88');
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('ASKEY');
    expect(screen.getByText('SilverSea')).toBeTruthy();
  });

  // 20260926_20 + card _26: without factory data the line-2 location falls
  // back to the route name; the title keeps leading with the code. No
  // collapse toggle — the header is static.
  it('20260926_20: falls back to the route location while the code still leads', async () => {
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
    // No factory → the route summary becomes the location; no toggle exists.
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('FUL-88');
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('Cát Lái → Bình Dương');
    expect(screen.queryByRole('button', { name: 'Thu gọn thông tin tác vụ' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mở rộng thông tin tác vụ' })).toBeNull();
  });

  // 40f3ae15 + photo-block unification: biên bản giao hàng capture lives in
  // the ONE SỐ CONT & SEAL card (ghost affordances under the saved slots —
  // always reachable, saved row or not), never a standalone big-button
  // section; its thumbnail shows only when a DELIVERY_NOTE photo rides the wire.
  it('shows the unified biên bản affordances and no standalone section', async () => {
    renderPage();

    // Card _28 item 11: ONE merged Thêm-ảnh entry per zone.
    expect(screen.getByRole('button', { name: 'Thêm ảnh biên bản' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mở camera biên bản' })).toBeNull();
    expect(screen.queryByTestId('delivery-note-block')).toBeNull();
    expect(screen.queryByText('Biên bản giao hàng')).toBeNull();
    expect(screen.queryByAltText('Ảnh biên bản')).toBeNull();
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
    // BentoThumb HEAD-preflights the authenticated photo URL inside its mount
    // effect — the stub must be in place BEFORE renderPage() paints the tile,
    // or the failed preflight permanently falls back to the placeholder.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    renderPage();

    try {
      const img = await screen.findByAltText('Ảnh biên bản');
      expect(img.getAttribute('src')).toContain(encodeURIComponent('trips/55/delivery-note.jpg'));
      expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản' })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe('busy-trip recovery', () => {
  it.each([true, false])('offers only an owned blocking-trip link (owned=%s)', async (owned) => {
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail(), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    const rejection = vi.spyOn(driverClient, 'recordProgress').mockRejectedValueOnce(new Error('Xe đang chạy chuyến TRP-TEST-1. Vui lòng hoàn thành chuyến đó trước.'));
    const board = vi.spyOn(driverClient, 'getJourneyBoard').mockResolvedValueOnce({ items: owned ? [{ tripCode: 'TRP-TEST-1', tripId: 61, fulfillmentId: 99, bucket: 'RUNNING' }] as never : [], knownTagLabels: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ }));
    await waitFor(() => expect(board).toHaveBeenCalledOnce());
    // Card 20260916_8: the backend's busy-trip message must reach the driver
    // through BOTH surfaces — the transient toast (message text as thrown by
    // the API layer) and the inline banner.
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.stringContaining('Xe đang chạy chuyến TRP-TEST-1') })));
    expect(screen.getByTestId('blocking-trip-banner').textContent).toContain('TRP-TEST-1');
    if (owned) expect((await screen.findByRole('link', { name: 'Mở chuyến đang chạy' })).getAttribute('href')).toBe('/my-trips/61');
    else {
      expect(screen.queryByRole('link', { name: 'Mở chuyến đang chạy' })).toBeNull();
      expect(screen.getByTestId('blocking-trip-banner').textContent).toContain('Liên hệ điều vận');
    }
    rejection.mockRestore();
    board.mockRestore();
  });
});

describe('20260915_1: trip → fulfillmentId resolution', () => {
  function bareClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }
  function basicTrip(overrides: Record<string, unknown> = {}) {
    return {
      id: 16, shipmentId: null, fulfillmentId: 31, tripCode: 'TRP-16',
      departureDate: null, plannedStartAt: null, status: 'IN_TRANSIT',
      routeName: null, truckPlate: null, customerName: null, notes: null,
      ...overrides,
    };
  }
  beforeEach(() => {
    getDriverTripMock.mockReset();
    getDriverTripMock.mockResolvedValue(basicTrip());
    vi.spyOn(driverClient, 'getDriverTrip').mockImplementation(getDriverTripMock as unknown as typeof driverClient.getDriverTrip);
    useDriverTaskDetailMock.mockReset();
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail(), isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined) });
    useDriverTaskProgressMock.mockReset();
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined) });
  });
  function bareRender(url: string, client: QueryClient) {
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/my-trips/:id" element={<DriverTripDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('pins fetch order: trips/{id} first, then fulfillment-scoped calls keyed by the payload fulfillmentId', async () => {
    getDriverTripMock.mockResolvedValue(basicTrip());
    const client = bareClient();
    bareRender('/my-trips/16', client);
    // The trip fetch precedes any fulfillment-scoped resolution.
    await waitFor(() => expect(getDriverTripMock).toHaveBeenCalledWith(16));
    await waitFor(() => expect(useDriverTaskDetailMock).toHaveBeenLastCalledWith(31));
    await waitFor(() => expect(useDriverTaskProgressMock).toHaveBeenLastCalledWith(31));
  });

  it('renders ad-hoc trips (fulfillmentId null) without fulfillment-scoped calls', async () => {
    getDriverTripMock.mockResolvedValue(basicTrip({ id: 23, fulfillmentId: null, tripCode: 'TRP-23-ADHOC' }));
    const client = bareClient();
    bareRender('/my-trips/23', client);
    // Lean fulfillment-less detail instead of the hard 404 error.
    expect(await screen.findByText(/chưa có đầu việc vận chuyển/)).toBeTruthy();
    // The ad-hoc title leads with a business descriptor — the internal TRP
    // code never renders as the title.
    expect(screen.queryByText(/TRP-23-ADHOC/)).toBeNull();
    expect(getDriverTripMock).toHaveBeenCalledWith(23);
  });

  it('_36 rework: Tác vụ/Ghi chú rows are structural — they render even with no note data', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ knownTagLabels: [], fulfillment: { ...makeTaskDetail().fulfillment!, driverNotes: null } }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();
    expect(await screen.findByText('Tác vụ')).toBeTruthy();
    expect(screen.getByText('Không có tác vụ')).toBeTruthy();
    expect(screen.getByText('Ghi chú')).toBeTruthy();
    expect(screen.getByText('Không có ghi chú.')).toBeTruthy();
    expect(screen.queryByTestId('operation-chips')).toBeNull();
  });
});
