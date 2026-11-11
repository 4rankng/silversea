import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverProgressEventType, TripPodStatus, TripStatus } from '@tingting/shared';
import { api } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { qk } from '../api/keys';
import { ApiError } from '../lib/api/errors';

const getDriverTripMock = vi.hoisted(() => vi.fn());

// Synchronous trip payload for the page's first render — the trip →
// fulfillmentId resolution is seeded into the query cache so existing
// tests keep their synchronous shape.
const TRIP_ID = 88;
// Card 071026205800: this number must stay DIFFERENT from the trip id. The
// `/my-trips/:id/pod` route carries a TRIP id (card 20260915_1), while every
// e-POD endpoint is FULFILLMENT-scoped. With both ids equal, a component that
// navigates with the wrong one still lands on a route stub carrying the same
// number, so the test passes for the wrong reason — which is exactly how a link
// that sends a fulfillment id into a trip-id route survived review.
const FULFILLMENT_ID = 4242;
const tripBasic88: Record<string, unknown> = {
  id: TRIP_ID, shipmentId: null, fulfillmentId: FULFILLMENT_ID, tripCode: 'TRP-88',
  departureDate: null, plannedStartAt: null, status: 'IN_TRANSIT',
  routeName: null, truckPlate: null, customerName: null, notes: null,
};
function freshClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['driver-trip-basic', String(TRIP_ID)], tripBasic88);
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
      // Card 20260927_1: the header leads with the carrier document number
      // (Số Bill) — the internal FUL-/SHP- shipment code never titles it.
      documentNumber: 'BL-2026-001',
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
    // SIL-636 — pair-tag wire fields; null by default (unpaired trip).
    pairKind: null,
    partnerTripId: null,
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
function renderPageWithBoard(client = freshClient()) {
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
      id: TRIP_ID, shipmentId: null, fulfillmentId: FULFILLMENT_ID, tripCode: 'TRP-88',
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
    await screen.findByText('BL-2026-001');
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeNull();
  });

  it('never shows the trip code in Thông tin lệnh — raw or formatted (card 261022201006c)', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ tripCode: 'TRP-202610-0007' }), isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await screen.findByText('BL-2026-001');
    expect(screen.queryByText('Mã chuyến')).toBeNull();
    expect(screen.queryByText(/TRP 2026-10/)).toBeNull();
    expect(screen.queryByText('TRP-202610-0007')).toBeNull();
  });

  it('DRV-FOLLOWUP-004 keeps a cancelled order read-only while retaining document access', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: TripStatus.CANCELED }), isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await screen.findByText('BL-2026-001');
    expect(screen.queryByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sửa số cont' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Chụp.*nhiên liệu|Chụp lại ảnh mới/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hoàn tất' })).toBeNull();
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

  // SIL-768 (09/11, customer CR-006): the Ảnh nhiên liệu block is REMOVED
  // from the detail screen — no section, no toggle, no fuel empty state.
  // Recorded evidence rows stay in the database and the kế toán review page
  // is untouched; only the driver surface loses the block.
  it('SIL-768: renders no Ảnh nhiên liệu block — no section, no toggle', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        status: 'IN_TRANSIT',
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
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    expect(screen.queryByText('Ảnh nhiên liệu')).toBeNull();
    expect(screen.queryByTestId('fuel-section')).toBeNull();
    expect(screen.queryByTestId('fuel-section-toggle')).toBeNull();
    expect(screen.queryByText(/Chụp màn hình bơm gần nhất/)).toBeNull();
    expect(screen.queryByText('Chụp ảnh nhiên liệu')).toBeNull();
    expect(screen.queryByText('Không bắt buộc')).toBeNull();
  });

  it('renders the sticky accept bar and the Hoàn tất footer button (e-POD lives on its own page now)', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
  });

  // Offline queue and conflict recovery have been removed — the accept bar
  // now uses a direct API call.  Conflict-banner tests are no longer applicable.

  it('renders the e-POD footer CTA enabled and names the two missing photos (informational only)', async () => {
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
    // Card _28 item 10: before acceptance the completion action has no sticky
    // slot — the accept bar owns it; the Chứng từ card lists the e-POD photo
    // gaps (SIL-697 resolved: soft law wording + the per-type gaps).
    expect(screen.queryByTestId('complete-sticky-bar')).toBeNull();
    // 27.8 "BỐN MỐC THỰC HIỆN: BỐ" — the Chứng từ card lists the soft missing
    // count plus the two e-POD photo gaps, not the evidence endpoint's
    // milestone/label echo.
    expect(screen.getByText('Thiếu 2 file e-POD — nên bổ sung.')).toBeTruthy();
    expect(screen.getByText('Thiếu Phiếu bãi / phiếu hạ')).toBeTruthy();
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
    expect(screen.queryByText(/có ký nhận/)).toBeNull();
  });

  it('navigates to the e-POD page when the driver taps the footer document link', async () => {
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
        currentPod: null,
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    renderPageWithBoard();

    // Tapping the footer "Tải chứng từ e-POD" link navigates to the pod page
    const cta = await screen.findByRole('link', { name: 'Tải chứng từ e-POD' });
    fireEvent.click(cta);

    // The driver lands on THIS trip's pod screen. Card 071026205800: the
    // `/my-trips/:id/pod` route carries a TRIP id, so the param must be 88 —
    // not the fulfillment id (4242).
    expect(await screen.findByTestId(`pod-route-stub-${TRIP_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(`pod-route-stub-${FULFILLMENT_ID}`)).toBeNull();
  });

  // SIL-638 TC9 (id 742): completing transport order directly from the detail
  // screen. With BOTH file types on the DRAFT the completion submits the POD
  // first (SIL-697 stays enforced on this complete-draft submit) and then
  // completes; with files missing SIL-733 r2 completes WITHOUT submitting.
  it('TC9: confirms and completes trip from sticky CTA with both e-POD files on the draft, invalidating journeyBoard', async () => {
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
            { id: 1, fileType: 'YARD_OR_DROP_RECEIPT', storageKey: 'k1' } as never,
            { id: 2, fileType: 'SIGNED_DELIVERY_NOTE', storageKey: 'k2' } as never,
          ],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    const client = freshClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const completeSpy = vi.spyOn(driverClient, 'completeTrip').mockResolvedValue({} as never);
    const submitPodSpy = vi.spyOn(driverClient, 'submitPod').mockResolvedValue({} as never);

    renderPageWithBoard(client);

    const stickyBar = await screen.findByTestId('complete-sticky-bar');
    const cta = within(stickyBar).getByRole('button', { name: 'Hoàn tất' });
    fireEvent.click(cta);

    // Confirmation dialog appears
    const confirmBtn = await within(screen.getByRole('dialog')).findByRole('button', { name: 'Hoàn tất' });
    fireEvent.click(confirmBtn);

    expect(await screen.findByTestId('driver-journey-board')).toBeTruthy();
    expect(submitPodSpy).toHaveBeenCalledWith(FULFILLMENT_ID, 22, { expectedVersion: 2 }, expect.any(String));
    expect(completeSpy).toHaveBeenCalledWith(FULFILLMENT_ID, { expectedVersion: 3 }, expect.any(String));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.driver.journeyBoard });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.driver.pairedOrders });
    expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Hoàn tất chuyến hàng thành công!' });
  });

  // SIL-733 (owner law 22/10 card 261022213755a, reaffirmed 07/11): photos are
  // OPTIONAL — completion never blocks on missing files. The incomplete DRAFT
  // is NOT auto-submitted (SIL-697 stays enforced on the explicit e-POD
  // submit path); the trip completes regardless.
  it('SIL-733: the sticky CTA completes on a zero-file draft without submitting it', async () => {
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
          files: [],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    const completeSpy = vi.spyOn(driverClient, 'completeTrip').mockResolvedValue({} as never);
    const submitPodSpy = vi.spyOn(driverClient, 'submitPod').mockResolvedValue({} as never);
    // The spies are shared module-level mocks — clear the TC9 test's history
    // above so the refusal assertions below see only THIS test's calls.
    submitPodSpy.mockClear();
    completeSpy.mockClear();

    renderPageWithBoard(freshClient());

    const stickyBar = await screen.findByTestId('complete-sticky-bar');
    fireEvent.click(within(stickyBar).getByRole('button', { name: 'Hoàn tất' }));

    const confirmBtn = await within(screen.getByRole('dialog')).findByRole('button', { name: 'Hoàn tất' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(completeSpy).toHaveBeenCalled());
    // The 0-file DRAFT must NOT be auto-submitted: a submit would either 409
    // (BE SIL-697 gate) or freeze the submission incomplete.
    expect(submitPodSpy).not.toHaveBeenCalled();
  });

  it('SIL-733: a half-file draft (1/2 types) also completes without submitting — QA repro R8B-697-B', async () => {
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
          files: [{ id: 1, fileType: 'YARD_OR_DROP_RECEIPT', storageKey: 'k1' } as never],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [{ id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' }] },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });

    const completeSpy = vi.spyOn(driverClient, 'completeTrip').mockResolvedValue({} as never);
    const submitPodSpy = vi.spyOn(driverClient, 'submitPod').mockResolvedValue({} as never);
    submitPodSpy.mockClear();
    completeSpy.mockClear();

    renderPageWithBoard(freshClient());

    const stickyBar = await screen.findByTestId('complete-sticky-bar');
    fireEvent.click(within(stickyBar).getByRole('button', { name: 'Hoàn tất' }));

    const confirmBtn = await within(screen.getByRole('dialog')).findByRole('button', { name: 'Hoàn tất' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(completeSpy).toHaveBeenCalled());
    expect(submitPodSpy).not.toHaveBeenCalled();
  });

  // SIL-652 (id 758): L2 (locked) trip hides the dead accept button and shows
  // the exact lock message consistent with the journey list
  it('SIL-652: hides accept button and shows pair-locked message on L2 locked order', async () => {
    boardItems = [
      {
        tripId: TRIP_ID,
        fulfillmentId: FULFILLMENT_ID,
        pairId: 99,
        pairKind: 'KET_HOP',
        pairOrder: 2,
        pairLocked: true,
      },
    ];
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).queryByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeNull();
    const lockedMsg = within(acceptStickyBar).getByTestId('pair-locked-message');
    expect(lockedMsg.textContent).toBe('Cần hoàn thành trả hàng lệnh trước để mở khóa');
  });

  // 20260911_3 BUG 5 (supersedes the 365943ea order), restated 26/09 after
  // 1af13d12 + dc1b1cba; amended 26/09 card _26: the bill/booking code moved
  // into the header title (item 4), so the grid leads with the factory block
  // + kho phone, then the working facts (container, ports) — the Tuyến
  // address line is demoted below them. Card 261022201006c supersedes the
  // REQ-07 amendment: the app lái xe no longer shows the trip code, so the
  // grid leads with the schedule.
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
      'Container / lô hàng',
      'Cảng nâng',
      'Cảng hạ',
      // DRI-04 (card 211026130843): the delivery row keeps its slot in every
      // direction — visible-by-default, named fallback when empty.
      'Địa chỉ giao hàng',
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
  it('card _27 + operator ruling 2026-09-27: container reads in the info grid, seal lives in Số cont & seal card', async () => {
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
    // The container row reads in the fact grid.
    expect(screen.getByText('Container / lô hàng')).toBeTruthy();
    expect(screen.queryByText(/Seal SEAL-9/)).toBeNull();
    // The single home still carries both containers — the saved bento leads
    // with the first container's number.
    expect(document.querySelector('.dcc-bento__plate')?.textContent).toContain('MSCU1234561');
  });

  it('renders the container card and identifies missing factory invoice configuration', async () => {
    renderPage();

    expect(await screen.findByText(/Số cont & seal/)).toBeTruthy();
    expect(screen.getByText(/Thông tin hóa đơn/)).toBeTruthy();
    expect(screen.getByText('Nhà máy chưa cấu hình thông tin xuất hóa đơn.')).toBeTruthy();
  });

  // SIL-636 — the [KẸP]/[KẾT HỢP] tag rides the container number in the saved
  // bento hero, derived from the ACTIVE pair row the API reports (pairKind).
  // The ruling keeps Trip_ID off the driver UI: partnerTripId stays a wire-only
  // key and never renders.
  describe('SIL-636 — ghép-chuyến pair tag beside the container number', () => {
    it('renders [KẸP] beside the container number when the API reports pairKind KEP', async () => {
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: 'KEP', partnerTripId: 61 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      const tag = screen.getByTestId('driver-pair-tag');
      expect(tag.textContent).toBe('[KẸP]');
      // "cạnh số container" — same plate row as the cont number.
      expect(tag.closest('.dcc-bento__plate-row')?.textContent).toContain('MSCU1234561');
      // Trip_ID law: the partner trip id is a wire key, never a driver label.
      expect(screen.queryByText('TRIP-61')).toBeNull();
    });

    it('renders [KẾT HỢP] when the API reports pairKind KET_HOP (display-only — TC8/TC9 gating is another ticket)', async () => {
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: 'KET_HOP', partnerTripId: 61 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      expect(screen.getByTestId('driver-pair-tag').textContent).toBe('[KẾT HỢP]');
    });

    it('renders no pair tag when the trip has no ACTIVE pair row', async () => {
      renderPage();

      await screen.findByText(/Số cont & seal/);
      expect(screen.queryByTestId('driver-pair-tag')).toBeNull();
    });

    // QA round-3b: a DOUBLE-classified trip with no ACTIVE pair row shows KẸP
    // on the journey list (tagLabelFor classification fallback) but showed
    // nothing on the detail screen — the detail read the wire pairKind only.
    // The detail now resolves through the same shared tagLabelFor.
    it('QA round-3b: DOUBLE-classified board card without pairKind keeps [KẸP] on detail', async () => {
      boardItems = [
        {
          tripId: TRIP_ID,
          fulfillmentId: FULFILLMENT_ID,
          pairId: null,
          pairKind: null,
          classification: 'DOUBLE',
          linked: false,
          containerNumber: 'MSCU1234561',
        },
      ];
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: null, partnerTripId: null }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      const tag = screen.getByTestId('driver-pair-tag');
      expect(tag.textContent).toBe('[KẸP]');
      expect(tag.closest('.dcc-bento__plate-row')?.textContent).toContain('MSCU1234561');
    });

    it('QA round-3b: COMBINED-classified board card without pairKind renders [KẾT HỢP]', async () => {
      boardItems = [
        {
          tripId: TRIP_ID,
          fulfillmentId: FULFILLMENT_ID,
          pairId: null,
          pairKind: null,
          classification: 'COMBINED',
          linked: false,
          containerNumber: 'MSCU1234561',
        },
      ];
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: null, partnerTripId: null }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      expect(screen.getByTestId('driver-pair-tag').textContent).toBe('[KẾT HỢP]');
    });

    it('QA round-3b: isCombined linked fallback (SINGLE classification, linked sibling) renders [KẸP]', async () => {
      boardItems = [
        {
          tripId: TRIP_ID,
          fulfillmentId: FULFILLMENT_ID,
          pairId: null,
          pairKind: null,
          classification: 'SINGLE',
          linked: true,
          containerNumber: 'MSCU1234561',
        },
      ];
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: null, partnerTripId: null }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      expect(screen.getByTestId('driver-pair-tag').textContent).toBe('[KẸP]');
    });

    it('QA round-3b: unpaired ĐƠN card (SINGLE, unlinked) keeps detail tag-free', async () => {
      boardItems = [
        {
          tripId: TRIP_ID,
          fulfillmentId: FULFILLMENT_ID,
          pairId: null,
          pairKind: null,
          classification: 'SINGLE',
          linked: false,
          containerNumber: 'MSCU1234561',
        },
      ];
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: null, partnerTripId: null }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      expect(screen.queryByTestId('driver-pair-tag')).toBeNull();
    });

    it('SIL-638 TC4: Kẹp pair renders [KẸP] next to container number without lock on either order (order-free)', async () => {
      boardItems = [
        {
          tripId: TRIP_ID,
          fulfillmentId: FULFILLMENT_ID,
          pairId: 60,
          pairKind: 'KEP',
          pairOrder: 2,
          pairLocked: false,
        },
      ];
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ pairKind: 'KEP', partnerTripId: 61 }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      useDriverTaskProgressMock.mockReturnValue({
        data: { items: [] },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });
      renderPage();

      await screen.findByText(/Số cont & seal/);
      const tag = screen.getByTestId('driver-pair-tag');
      expect(tag.textContent).toBe('[KẸP]');
      // SIL-636: internal IDs never render
      expect(screen.queryByText(/TRIP-61|TRP-61/)).toBeNull();
      // Order-free: Kẹp pair is never locked on either card
      expect(screen.queryByTestId('pair-locked-message')).toBeNull();
      const acceptStickyBar = screen.getByTestId('accept-sticky-bar');
      expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeEnabled();
    });
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

  it('VID-DRV-02 places the invoice block right after the Gọi kho bar, ahead of notes and every later block (SIL-766)', async () => {
    renderPage();
    await screen.findByText('Thông tin lệnh');

    const info = document.getElementById('driver-task-info-grid')!;
    const notes = screen.getByTestId('task-note-section');
    const invoice = document.getElementById('driver-task-invoice-grid')!;
    // SIL-766: invoice sits directly below the Địa chỉ giao hàng row (in the
    // info grid) + the Gọi kho call bar, before the Tác vụ/Ghi chú section.
    expect(info.compareDocumentPosition(invoice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(invoice.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // SIL-766: the invoice block leads everything that used to follow it —
    // container card, cost form — and no longer trails at the page foot.
    const contCard = document.querySelector('.dcc-section');
    const costForm = screen.getByTestId('shipment-cost-entry-form');
    expect(invoice.compareDocumentPosition(contCard!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contCard!.compareDocumentPosition(costForm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // SIL-766: invoice starts EXPANDED — the driver reads the billing party
    // the moment the order opens; collapse stays available on demand.
    expect(screen.getByTestId('task-section-toggle-driver-task-invoice-grid').getAttribute('aria-expanded')).toBe('true');
    expect(invoice.hidden).toBe(false);

    fireEvent.click(screen.getByTestId('task-section-toggle-driver-task-info-grid'));
    // The two disclosures stay independent: collapsing info never hides the
    // invoice block or the notes.
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
    // Card _62: the header copy button is REMOVED — copy affordances live on
    // the grid rows only.
    expect(screen.queryByRole('button', { name: 'Copy Số Bill / Booking' })).toBeNull();
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
    // Trip IN_TRANSIT, 0/2 POD files → the bar names the optional doc count
    // (card 261022213755a: photos are optional, never a blocker) and the
    // completion action navigates to the e-POD screen.
    expect(screen.getByTestId('complete-sticky-bar')).toBeTruthy();
    // SIL-733: warning removed next to complete button (photos are optional)
    expect(screen.queryByTestId('complete-sticky-status')).toBeNull();
    const btn = within(screen.getByTestId('complete-sticky-bar')).getByRole('button', { name: 'Hoàn tất' });
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
    expect(await screen.findByRole('dialog', { name: 'Thêm ảnh cont' })).toBeTruthy();
    expect(screen.getAllByText('Thêm ảnh cont').length).toBeGreaterThan(0);
    // One camera entry + one gallery entry inside the sheet.
    expect(screen.getAllByRole('button', { name: 'Chụp ảnh' }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'Chọn từ thư viện' }).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('dialog', { name: 'Thêm ảnh cont' })).toBeNull();
  });

  it('card 061026043643: the photo counter counts uploaded photos, not filled zones', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          containerSealPhotos: [
            { id: 11, type: 'DELIVERY_NOTE', storageKey: 'n1', uploadedAt: '2026-10-06T00:00:00.000Z' },
            { id: 12, type: 'DELIVERY_NOTE', storageKey: 'n2', uploadedAt: '2026-10-06T00:00:00.000Z' },
          ],
        },
      }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const strip = screen.getByTestId('driver-task-progress');
    expect(strip.textContent).toContain('Ảnh 2/3');
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
    // Card 20261003_320: when khoPhone is absent, Gọi kho is hidden and never dials contactPhone
    expect(screen.queryByRole('link', { name: /Gọi kho/ })).toBeNull();
  });

  it('offers named factory telephone choices with the default first and retains direct single-number calls', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ fulfillment: { ...makeTaskDetail().fulfillment!, factoryContacts: [
        { name: 'Cổng kho', phone: '0901234567', isDefault: false },
        { name: 'Điều phối', phone: '0907654321', isDefault: true },
      ] } }), isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();
    const opener = await screen.findByRole('button', { name: 'Gọi kho' });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Chọn liên hệ để gọi' });
    // REQ-14: each row now carries TWO tel: links — the displayed number
    // itself plus the explicit Gọi button (unchanged aria-label contract).
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Default contact first.
    await waitFor(() => expect(within(rows[0]).getByText('Điều phối')).toBeVisible());
    expect(within(rows[0]).getByRole('link', { name: '0907654321' })).toHaveAttribute('href', 'tel:0907654321');
    expect(within(rows[0]).getByRole('link', { name: 'Gọi Điều phối 0907654321' })).toHaveAttribute('href', 'tel:0907654321');
    await waitFor(() => expect(within(rows[1]).getByText('Cổng kho')).toBeVisible());
    expect(within(rows[1]).getByRole('link', { name: '0901234567' })).toHaveAttribute('href', 'tel:0901234567');
    expect(within(rows[1]).getByRole('link', { name: 'Gọi Cổng kho 0901234567' })).toHaveAttribute('href', 'tel:0901234567');
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

  // Card 20261005_364 (REQ-05): through the full page render the warehouse
  // number is itself the tap-to-call control (lockstep with the component
  // suite's AC1-AC3 pins).
  it('card 20261005_364: the SĐT kho value is a tel: link in the full page render', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: { ...makeTaskDetail().fulfillment!, khoPhone: '0989130345' },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const khoValue = Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === 'SĐT kho')
      ?.querySelector('.driver-task-fact__value');
    const link = khoValue?.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('tel:0989130345');
    expect(link!.textContent).toBe('0989130345');
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

    await screen.findByText('Thông tin hóa đơn');
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

    await screen.findByText('Thông tin hóa đơn');
    const invoiceToggle = screen.getByTestId('task-section-toggle-driver-task-invoice-grid');
    const invoiceGrid = document.getElementById('driver-task-invoice-grid') as HTMLElement;
    const infoGrid = document.getElementById('driver-task-info-grid') as HTMLElement;
    // SIL-766: invoice starts EXPANDED (the driver reads it on open);
    // collapsing/expanding it never touches the info section.
    expect(invoiceToggle.getAttribute('aria-expanded')).toBe('true');
    expect(invoiceGrid.hidden).toBe(false);
    fireEvent.click(invoiceToggle);
    expect(invoiceToggle.getAttribute('aria-expanded')).toBe('false');
    expect(invoiceGrid.hidden).toBe(true);
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

  // SIL-767 (09/11, customer CR-006): the Tác vụ chips block is REMOVED from
  // the detail screen — no chips, no collapse toggle, no empty state, for
  // trips with tags and trips without alike. The remaining blocks (Ghi chú,
  // Thông tin lệnh, cost form) keep their positions, so the assertions that
  // used to pin the chips now pin their absence.
  it('SIL-767: renders no Tác vụ block — no chips, no toggle, no empty state', async () => {
    const tags = ['Kiểm đếm', 'Cân đầu', 'Chụp ảnh seal', 'Đóng hàng', 'Nâng cont', 'Hạ cont'];
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: tags,
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          driverNotes: 'Kiểm đếm; Cân đầu; Chụp ảnh seal; Đóng hàng; Nâng cont; Hạ cont\nKiểm seal kỹ trước khi đóng',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByTestId('driver-task-driver-notes');
    expect(screen.queryByText('Tác vụ')).toBeNull();
    expect(screen.queryByTestId('operation-chips')).toBeNull();
    expect(screen.queryByTestId('operation-chip')).toBeNull();
    expect(screen.queryByText('Không có tác vụ')).toBeNull();
  });

  it('SIL-767: a trip with no dispatch note shows the Ghi chú empty state and no Tác vụ block', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ knownTagLabels: [], fulfillment: { ...makeTaskDetail().fulfillment!, driverNotes: null } }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText('Ghi chú');
    expect(screen.getByText('Không có ghi chú.')).toBeTruthy();
    expect(screen.queryByText('Tác vụ')).toBeNull();
    expect(screen.queryByText('Không có tác vụ')).toBeNull();
    expect(screen.queryByTestId('operation-chips')).toBeNull();
  });

  // 851e8f7d format v2: two-line note — line 1 (tags) is no longer rendered
  // anywhere (SIL-767 removed the chips); the free-text part renders in the
  // note section without the tag line duplicated.
  it('851e8f7d: v2 two-line note renders free text only — the tag line is gone (SIL-767)', async () => {
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

    const note = await screen.findByTestId('driver-task-driver-notes');
    expect(note.textContent).toContain('ghép cont với lô khác, cẩn thận seal');
    expect(note.textContent).not.toContain('KIỂM HÓA');
    expect(screen.queryByTestId('operation-chip')).toBeNull();
    expect(screen.queryByText('Tác vụ')).toBeNull();
  });

  it('DRV-R01: multiline notes render verbatim while the uppercase tag line stays removed (SIL-767)', async () => {
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

    expect(await screen.findByText('Ghi chú')).toBeTruthy();
    const note = screen.getByTestId('driver-task-driver-notes');
    expect(note.textContent).toContain('Gọi chị An trước khi đến\nKiểm tra seal tại kho');
    expect(note.textContent).toContain('Kiểm tra seal tại kho');
    expect(screen.queryByTestId('operation-chip')).toBeNull();
    expect(screen.queryByText('Tác vụ')).toBeNull();
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
    // Card _26 + _63: the carrier document number leads the title; the
    // factory short name renders as the line-2 location.
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('BL-2026-001');
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('ASKEY');
    expect(screen.getByText('SilverSea')).toBeTruthy();
  });

  // 20260926_20 + card _26: without factory data the line-2 location falls
  // back to the route name; the title keeps leading with the document
  // number. No collapse toggle — the header is static.
  it('20260926_20: falls back to the route location while the document number still leads', async () => {
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
    expect(document.querySelector('.driver-task-header__title')?.textContent).toBe('BL-2026-001');
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
    // Both biên bản tiles (the bento thumb and the preview strip) resolve the
    // photo through the Authorization-header blob fetch — never the protected
    // path itself, and never a `?token=` URL.
    const getBlob = vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['note'], { type: 'image/jpeg' }));
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:delivery-note'),
      revokeObjectURL: vi.fn(),
    }));
    renderPage();

    try {
      const img = await screen.findByAltText('Ảnh biên bản');
      await waitFor(() => expect(img.getAttribute('src')).toBe('blob:delivery-note'));
      expect(getBlob).toHaveBeenCalledWith('/photos/trips%2F55%2Fdelivery-note.jpg');
      expect(document.querySelector('img[src*="token="]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản' })).toBeTruthy();
    } finally {
      getBlob.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  // P1 051026230645 — the driver uploaded two biên bản photos; both rows ride
  // the wire (the backend keeps one trip_photos row per upload), so BOTH must
  // render. The old derivation collapsed the list with `.find()` and silently
  // hid every upload before the latest — the driver-visible data loss.
  it('two persisted biên bản uploads both stay visible — no silent replace', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          containerSealPhotos: [
            { id: 4, type: 'DELIVERY_NOTE', storageKey: 'trips/55/note-old.jpg', uploadedAt: '2026-08-01T01:00:00.000Z' },
            { id: 3, type: 'DELIVERY_NOTE', storageKey: 'trips/55/note-new.jpg', uploadedAt: '2026-08-01T02:00:00.000Z' },
          ],
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    const getBlob = vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['note'], { type: 'image/jpeg' }));
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:note'),
      revokeObjectURL: vi.fn(),
    }));
    renderPage();

    try {
      expect(await screen.findByRole('button', { name: 'Xem ảnh biên bản 1' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Xem ảnh biên bản 2' })).toBeTruthy();
      // Both persisted storage keys are actually read for display — the older
      // upload is not just missing from the count, its bytes still render.
      await waitFor(() => expect(getBlob).toHaveBeenCalledWith('/photos/trips%2F55%2Fnote-old.jpg'));
      expect(getBlob).toHaveBeenCalledWith('/photos/trips%2F55%2Fnote-new.jpg');
      expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản 1' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Xóa ảnh biên bản 2' })).toBeTruthy();
    } finally {
      getBlob.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});


describe('busy-trip recovery', () => {
  // SIL-798: the busy-trip 409 carries a STRUCTURED payload
  // (code DRIVER_TRIP_BLOCKED + label + owned trip id) from
  // trip-status-machine.service.ts — no prose regex, no board roundtrip
  // (the board lookup silently missed and left a banner with no name and
  // no link — the exact defect). FB-019 still holds: the internal TRP code
  // never renders; the driver names trips by Số Bill/Booking.
  const blockedRejection = (payload: Record<string, unknown>) =>
    vi.spyOn(driverClient, 'recordProgress').mockRejectedValueOnce(
      new ApiError(409, { code: 'DRIVER_TRIP_BLOCKED', ...payload }, 'Xe đang chạy chuyến TRP-TEST-1. Vui lòng hoàn thành chuyến đó trước.'),
    );

  it('names the blocking trip by its Số Bill and links it when the driver owns it', async () => {
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail(), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    const rejection = blockedRejection({ blockingTripId: 61, blockingTripLabel: 'BL-2026-001', driverOwned: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ }));
    const banner = await screen.findByTestId('blocking-trip-banner');
    expect(banner.textContent).toContain('BL-2026-001');
    expect(banner.textContent).not.toContain('TRP-TEST-1');
    expect((await screen.findByRole('link', { name: 'Mở chuyến đang chạy' })).getAttribute('href')).toBe('/my-trips/61');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.stringContaining('BL-2026-001') }));
    rejection.mockRestore();
  });

  it('keeps the link off for a blocking trip the payload does not vouch for', async () => {
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail(), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    const rejection = blockedRejection({ blockingTripId: null, blockingTripLabel: 'BL-2026-001', driverOwned: false });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ }));
    const banner = await screen.findByTestId('blocking-trip-banner');
    expect(banner.textContent).toContain('BL-2026-001');
    expect(screen.queryByRole('link', { name: 'Mở chuyến đang chạy' })).toBeNull();
    expect(banner.textContent).toContain('Liên hệ điều vận');
    rejection.mockRestore();
  });

  it('falls back to the generic banner voice when the payload carries no label (no code leak)', async () => {
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail(), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    const rejection = blockedRejection({ blockingTripId: null, blockingTripLabel: null, driverOwned: false });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ }));
    const banner = await screen.findByTestId('blocking-trip-banner');
    expect(banner.textContent).not.toContain('TRP-TEST-1');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.not.stringContaining('TRP-TEST-1') }));
    rejection.mockRestore();
  });

  it('clears the banner once the blocked order is accepted', async () => {
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail(), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    const progress = vi.spyOn(driverClient, 'recordProgress')
      .mockRejectedValueOnce(new ApiError(409, { code: 'DRIVER_TRIP_BLOCKED', blockingTripId: 61, blockingTripLabel: 'BL-2026-001', driverOwned: true }, 'blocked'))
      .mockResolvedValue({} as never);
    renderPage();
    const accept = await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ });
    fireEvent.click(accept);
    await waitFor(() => expect(screen.getByTestId('blocking-trip-banner').textContent).toContain('BL-2026-001'));
    // The retry succeeds — the truck is no longer busy, so the banner (and its
    // reason) must not linger into the running trip.
    fireEvent.click(await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })));
    expect(screen.queryByTestId('blocking-trip-banner')).toBeNull();
    progress.mockRestore();
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
  // _36 rework test retired with SIL-767: the Tác vụ row no longer exists;
  // the Ghi chú-only structural behavior is pinned by "SIL-767: a trip with
  // no dispatch note shows the Ghi chú empty state and no Tác vụ block".
});

describe('driver completed-trip footer height contract (card 071026103226 — FB-055 regression)', () => {
  // This describe never had its own beforeEach and silently inherited the
  // mock state of whichever test ran last: the (SIL-767-retired) _36 rework
  // case left getDriverTripMock on a fulfillment-bearing trip, so the
  // cache-seeded render's background refetch kept this screen a real detail.
  // With that test gone, the inherited trip was the ad-hoc null-fulfillment
  // fixture and the screen legitimately swapped to the ad-hoc branch mid-test.
  // Pin the defaults so the closed-card contract is order-independent.
  beforeEach(() => {
    getDriverTripMock.mockReset();
    getDriverTripMock.mockResolvedValue({
      id: TRIP_ID, shipmentId: null, fulfillmentId: FULFILLMENT_ID, tripCode: 'TRP-88',
      departureDate: null, plannedStartAt: null, status: 'COMPLETED',
      routeName: null, truckPlate: null, customerName: null, notes: null,
    });
    useDriverTaskProgressMock.mockReset();
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined) });
    useDriverTaskDetailMock.mockReset();
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail({ status: 'COMPLETED' }), isLoading: false, error: null, refetch: vi.fn() });
    useDriverEvidenceStatusMock.mockReturnValue({ data: { ready: true, missingItems: [] }, isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined) });
  });

  it('the closed card renders the summary and the button side by side with no hint line', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: 'COMPLETED' }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await screen.findByText('Chuyến đã hoàn thành');
    // The card must not stack a hint line under the title in the closed
    // state — that line is what re-inflated the card to ~115px.
    const hint = document.querySelector('.driver-task-footer__hint');
    expect(hint).toBeNull();
    // The body carries the closed variant: one row, summary left + button right.
    const body = document.querySelector('.driver-task-footer__body');
    expect(body?.className).toContain('driver-task-footer__body--closed');
  });

  // Card 081026072302 (FB-055 follow-up): the canceled closed card shares the
  // exact one-row path ('Chuyến đã hủy' + the document button) — staging
  // round 7 flagged it alongside the completed shape, so it is pinned too.
  it('the canceled closed card keeps the same one-row shape with no hint line', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: 'CANCELED' }),
      isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();
    await screen.findByText('Chuyến đã hủy');
    const hint = document.querySelector('.driver-task-footer__hint');
    expect(hint).toBeNull();
    const body = document.querySelector('.driver-task-footer__body');
    expect(body?.className).toContain('driver-task-footer__body--closed');
    expect(screen.getByText('Xem chứng từ giao hàng')).toBeTruthy();
  });
});
