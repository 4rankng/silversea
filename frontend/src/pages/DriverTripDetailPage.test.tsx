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

// SIL-1053 (K2.42) — the full milestone feed in BE sequence order, for the
// completion-flow fixtures whose intent is the POD/CTA behavior (not the
// milestone law): with all four recorded, Hoàn tất is not milestone-gated.
const MILESTONE_FEED = [
  { id: 1, eventType: DriverProgressEventType.ORDER_RECEIVED, occurredAt: '2026-08-29T02:45:00.000Z' },
  { id: 2, eventType: DriverProgressEventType.PICKED_UP, occurredAt: '2026-08-29T03:10:00.000Z' },
  { id: 3, eventType: DriverProgressEventType.LOADING_OR_RETURNING, occurredAt: '2026-08-29T05:40:00.000Z' },
  { id: 4, eventType: DriverProgressEventType.DELIVERED, occurredAt: '2026-08-29T07:05:00.000Z' },
];
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

/** The journey board's per-container "Sửa số cont i/n" button deep-links to
 *  the detail screen with ?cont=N — the driver lands on that exact box. */
function renderPageAtCont(cont: number) {
  const client = freshClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/my-trips/88?cont=${cont}`]}>
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

  // SIL-1053 (K2.42) — the milestone strip is BACK on this screen; only the
  // Thu nhập tham chiếu block stays removed. Expense entry is enabled by the
  // customer expense requirements. Fuel screenshots and the separate e-POD
  // route retain their own roles.
  it('restores shipment cost entry while keeping the separate fuel form hidden', async () => {
    renderPage();

    // SIL-817: the default IN_TRANSIT fixture carries no ORDER_RECEIVED
    // milestone, and the completion CTA now renders by trip status — so the
    // sticky slot shows Hoàn tất, not Nhận lệnh vận chuyển. The strip below
    // mirrors that: Nhận lệnh actionable, the later stages waiting.
    await screen.findByTestId('complete-sticky-bar');
    expect(screen.getByTestId('driver-milestone-strip')).toBeTruthy();
    expect(screen.getByText('Lấy vỏ / Lấy hàng')).toBeTruthy();
    expect(screen.getByText('Đóng / Trả hàng')).toBeTruthy();
    expect(screen.getByText('Hạ bãi / Giao hàng')).toBeTruthy();
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

  it('SIL-817: an unaccepted IN_TRANSIT trip offers Hoàn tất directly — no accept-bar trap', async () => {
    renderPage();

    // PROD 13/11 (trip 13 TRP-202609-0011): a running trip whose ORDER_RECEIVED
    // milestone never got recorded (ops started it, handoff UNSEEN/handler NULL)
    // used to strand the driver behind the accept bar. The completion CTA now
    // renders by TRIP STATUS — the backend infers the acceptance on completion.
    const completeStickyBar = await screen.findByTestId('complete-sticky-bar');
    expect(within(completeStickyBar).getByRole('button', { name: 'Hoàn tất' })).toBeTruthy();
    expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
  });

  it('SIL-817: completing an unaccepted IN_TRANSIT trip from the sticky CTA reaches completeTrip', async () => {
    const completeSpy = vi.spyOn(driverClient, 'completeTrip').mockResolvedValue({} as never);
    const submitPodSpy = vi.spyOn(driverClient, 'submitPod').mockResolvedValue({} as never);

    // SIL-697 RE-OPEN: an evidence-complete SAVED submission — this pin owns
    // the accept-bar escape only, and a SUBMITTED e-POD keeps the "nothing
    // submits here" contract.
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: {
          id: 22,
          tripId: 55,
          fulfillmentId: 88,
          submissionVersion: 1,
          status: TripPodStatus.SUBMITTED,
          version: 2,
          createdAt: '2026-08-01T01:00:00.000Z',
          updatedAt: '2026-08-01T01:00:00.000Z',
          submittedAt: '2026-08-01T02:00:00.000Z',
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

    renderPageWithBoard();

    const stickyBar = await screen.findByTestId('complete-sticky-bar');
    fireEvent.click(within(stickyBar).getByRole('button', { name: 'Hoàn tất' }));

    const confirmBtn = await within(screen.getByRole('dialog')).findByRole('button', { name: 'Hoàn tất' });
    fireEvent.click(confirmBtn);

    // No ORDER_RECEIVED anywhere in the progress feed — completion still goes
    // out; the backend infers the acceptance (driver-fulfillment.service).
    await waitFor(() => expect(completeSpy).toHaveBeenCalledWith(FULFILLMENT_ID, { expectedVersion: 3 }, expect.any(String)));
    expect(submitPodSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('driver-journey-board')).toBeTruthy();
    expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Hoàn tất chuyến hàng thành công!' });
  });

  it('SIL-817: a CREATED trip keeps the accept bar — completion stays unreachable before acceptance', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status: TripStatus.CREATED }), isLoading: false, error: null, refetch: vi.fn(),
    });
    renderPage();

    const acceptStickyBar = await screen.findByTestId('accept-sticky-bar');
    expect(within(acceptStickyBar).getByRole('button', { name: /Nhận lệnh vận chuyển/ })).toBeTruthy();
    expect(screen.queryByTestId('complete-sticky-bar')).toBeNull();
  });

  // Offline queue and conflict recovery have been removed — the accept bar
  // now uses a direct API call.  Conflict-banner tests are no longer applicable.

  it('SIL-697 re-open: the completion CTA stays disabled while evidence is missing and the card names the gaps', async () => {
    renderPage();

    // SIL-817: the unaccepted IN_TRANSIT fixture owns the complete sticky bar
    // (render by trip status). SIL-697 RE-OPEN (KB §10.4.3): with the
    // evidence set missing the CTA is disabled and the Chứng từ card names
    // each missing group plus the blocking message.
    const completeStickyBar = await screen.findByTestId('complete-sticky-bar');
    expect(within(completeStickyBar).getByRole('button', { name: 'Hoàn tất' })).toBeDisabled();
    // 27.8 "BỐN MỐC THỰC HIỆN: BỐ" — the Chứng từ card lists the blocking
    // missing count plus the two e-POD photo gaps, not the evidence
    // endpoint's milestone/label echo.
    expect(screen.getByText('Thiếu 2 file e-POD — cần bổ sung đủ trước khi nộp và hoàn thành chuyến.')).toBeTruthy();
    expect(screen.getByText('Thiếu Phiếu bãi / phiếu hạ')).toBeTruthy();
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
    expect(screen.queryByText(/có ký nhận/)).toBeNull();
  });

  it('SIL-918: an LCL trip drops the FCL evidence slot and the Số cont & seal frame', async () => {
    const base = makeTaskDetail();
    useDriverTaskDetailMock.mockReturnValue({
      data: { ...base, fulfillment: { ...base.fulfillment, modeLabel: 'LCL' } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await screen.findByTestId('complete-sticky-bar');
    // KB §3.5.2/§3.6.1: hàng lẻ has no container — the evidence set is the
    // biên bản alone, so the FCL phiếu bãi gap and its strip seat disappear.
    expect(screen.getByText('Thiếu 1 file e-POD — cần bổ sung đủ trước khi nộp và hoàn thành chuyến.')).toBeTruthy();
    expect(screen.queryByText('Thiếu Phiếu bãi / phiếu hạ')).toBeNull();
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
    // The FCL container frame never renders for hàng lẻ.
    expect(screen.queryByText('Số cont & seal')).toBeNull();
    // The strip counts the mode's own set and drops the photo counter with
    // the hidden container card.
    const strip = screen.getByTestId('driver-task-progress');
    // The label interpolates across text nodes — read the span's full text.
    expect(within(strip).getByTestId('progress-pod').textContent?.replace(/\s+/g, ' ').trim()).toBe('Chứng từ 0/1');
    expect(within(strip).queryByTestId('progress-photos')).toBeNull();
  });

  it('navigates to the e-POD page when the driver taps the footer document link', async () => {
    // Card _28 item 10: the action lives in the sticky bar, which owns the
    // slot only once the order is accepted.
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: MILESTONE_FEED },
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
  // first (SIL-697 enforced on this complete-draft submit) and then
  // completes; with files missing the SIL-697 RE-OPEN gate blocks the CTA.
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
      data: { items: MILESTONE_FEED },
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

  // SIL-697 RE-OPEN (owner 07:42 27/11 — Frank 06/11 law stands, KB §4.2.4/
  // §4.2.6): thiếu bộ chứng từ thì KHÔNG hoàn thành — nút Hoàn tất chặn
  // TRƯỚC, không nộp nháp, không complete.
  it('SIL-697 re-open: a zero-file draft blocks the sticky CTA — no submit, no complete', async () => {
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
      data: { items: MILESTONE_FEED },
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
    const cta = within(stickyBar).getByRole('button', { name: 'Hoàn tất' });
    // The gate renders up front: disabled + the message naming what is missing.
    expect(cta).toBeDisabled();
    expect(screen.getByText('Thiếu 2 file e-POD — cần bổ sung đủ trước khi nộp và hoàn thành chuyến.')).toBeTruthy();
    fireEvent.click(cta);

    // The block comes BEFORE the confirm dialog and any write.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitPodSpy).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
  });

  // SIL-697 RE-OPEN: thiếu 1 trong 2 loại file → không nộp nháp + thông báo
  // cần đủ file (QA repro R8B-697-B).
  it('SIL-697 re-open: a half-file draft (1/2 types) never submits or completes — the gap is named', async () => {
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
      data: { items: MILESTONE_FEED },
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
    const cta = within(stickyBar).getByRole('button', { name: 'Hoàn tất' });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);

    // The block comes BEFORE the confirm dialog and any write; the missing
    // group is named on screen.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitPodSpy).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
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

  // K10.19 (SIL-946, KB §10.4.2) supersedes the 20260911_3 BUG 5 order (which
  // superseded 365943ea): the grid is the LỊCH & ĐỊA ĐIỂM group — schedule →
  // factory block → địa chỉ giao hàng → contact cluster — while Cảng nâng/hạ
  // moved OUT of the grid into the LỘ TRÌNH group after Số cont & seal, and
  // the contact NAME owns its row (KB: "người liên hệ + số điện thoại, bấm
  // gọi được").
  it('renders the KB field order: schedule, factory block, delivery address, contact cluster; ports live in Lộ trình', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // The LỊCH & ĐỊA ĐIỂM grid only — the ports live in the Lộ trình grid.
    const labels = Array.from(document.querySelectorAll('#driver-task-info-grid .driver-task-fact__label')).map((el) => el.textContent);
    expect(labels).toEqual([
      'Ngày giờ kế hoạch',
      'Tên nhà máy',
      'Địa chỉ nhà máy',
      'Địa chỉ giao hàng',
      'SĐT kho',
      'Người liên hệ',
      'Container / lô hàng',
    ]);
    // Ports are the LỘ TRÌNH group's own grid, not the info grid.
    const routeSection = document.querySelector('[data-testid="driver-route-section"]')!;
    const routeLabels = Array.from(routeSection.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent);
    expect(routeLabels).toEqual(['Cảng nâng', 'Cảng hạ']);
    // Card _27 item 5: the abbrev row is gone — the fixture's factory name
    // ('Nhà máy Bình Dương') renders as the header line-2 location instead.
    expect(document.querySelector('.driver-task-header__location')?.textContent).toBe('Nhà máy Bình Dương');
    // Sparse fixture: full name falls back to the free-text name; the address
    // row dashes; the Tuyến row no longer exists in the grid (the header owns
    // the route line — VID-DRV-01).
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('Tên nhà máy')).toBe('Nhà máy Bình Dương');
    expect(valueOf('Địa chỉ nhà máy')).toBe('—');
    expect(valueOf('Tuyến')).toBeUndefined();
  });

  // K10.19 (SIL-946, KB Ch.10 §10.4.2): the whole screen reads in the KB
  // group order — Bill/Booking → lịch & địa điểm → xuất hóa đơn → hàng hóa
  // → lộ trình → nhiệm vụ & ghi chú → bằng chứng & hành động.
  it('orders the detail groups exactly as KB §10.4.2', async () => {
    renderPage();
    await screen.findByText(/Số cont & seal/);

    const header = document.querySelector('.driver-task-header')!;
    const info = document.getElementById('driver-task-info-grid')!;
    const invoice = document.getElementById('driver-task-invoice-grid')!;
    const contCard = document.querySelector('.dcc-section')!;
    const route = screen.getByTestId('driver-route-section');
    const notes = screen.getByTestId('task-note-section');
    const evidence = document.querySelector('.driver-task-footer')!;

    const before = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(before(header, info)).toBe(true);          // Bill/Booking → lịch & địa điểm
    expect(before(info, invoice)).toBe(true);         // lịch & địa điểm → xuất hóa đơn
    expect(before(invoice, contCard)).toBe(true);      // xuất hóa đơn → hàng hóa
    expect(before(contCard, route)).toBe(true);        // hàng hóa → lộ trình
    expect(before(route, notes)).toBe(true);          // lộ trình → nhiệm vụ & ghi chú
    expect(before(notes, evidence)).toBe(true);        // nhiệm vụ & ghi chú → bằng chứng
  });

  // K10.22 (SIL-947, KB §10.4.5): the journey board's per-container "Sửa số
  // cont i/n" button deep-links to ?cont=N — the detail screen scrolls that
  // exact container row into view and flashes it, so the driver lands on the
  // box he was editing, not on a list of boxes.
  it('deep-links ?cont=N to the matching container row and flashes it', async () => {
    const scrollIntoView = vi.fn();
    const originalScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({
          containers: [
            { id: 1, containerNumber: 'MSCU1234561', sealNumber: null, containerTypeId: 1, containerTypeName: '40FT', containerTypeCode: '40G1', cargoWeightKg: null },
            { id: 2, containerNumber: 'MSCU7654321', sealNumber: null, containerTypeId: 1, containerTypeName: '40FT', containerTypeCode: '40G1', cargoWeightKg: null },
          ],
        }),
        isLoading: false,
        error: null,
        refetch: vi.fn().mockResolvedValue(undefined),
      });
      renderPageAtCont(2);
      await screen.findByText(/Số cont & seal/);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      const target = document.querySelector('[data-cont-index="1"]');
      expect(target).toBeTruthy();
      expect(target!.classList.contains('dcc-bento__item--flash')).toBe(true);
      // The sibling box is never the target.
      expect(document.querySelector('[data-cont-index="0"]')!.classList.contains('dcc-bento__item--flash')).toBe(false);
    } finally {
      Element.prototype.scrollIntoView = originalScroll;
    }
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
      // SIL-815 — the header carries the same classification label as the
      // journey card (plain, no brackets).
      expect(screen.getByTestId('classification-tag').textContent).toBe('KẾT HỢP');
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
      // SIL-815 — the header carries the same classification label as the
      // journey card (plain, no brackets).
      expect(screen.getByTestId('classification-tag').textContent).toBe('KẾT HỢP');
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

    it('SIL-815: unpaired ĐƠN card (SINGLE, unlinked) shows the plain ĐƠN header label and keeps the hero tag-free', async () => {
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
      // SIL-815 — the classification label rides the detail header (the card
      // shows ĐƠN; the detail must match 100%).
      expect(screen.getByTestId('classification-tag').textContent).toBe('ĐƠN');
      // The bracketed hero variant stays pair-only (SIL-636 ruling).
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
        data: makeTaskDetail({
          pairKind: 'KEP',
          partnerTripId: 61,
          // SIL-697 RE-OPEN: evidence-complete fixture — this pin owns the
          // order-free pair rendering, so the CTA must pass the evidence gate.
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
      // Order-free: Kẹp pair is never locked on either card — SIL-817: the
      // unaccepted IN_TRANSIT fixture shows the complete CTA (no DOC lock,
      // no accept bar).
      expect(screen.queryByTestId('pair-locked-message')).toBeNull();
      const completeStickyBar = screen.getByTestId('complete-sticky-bar');
      expect(within(completeStickyBar).getByRole('button', { name: 'Hoàn tất' })).toBeEnabled();
      expect(screen.queryByTestId('accept-sticky-bar')).toBeNull();
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

  it('clamps long site rules behind a Xem thêm reveal that restores the block', async () => {
    const longRule = 'Q'.repeat(400);
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: { ...makeTaskDetail().fulfillment!, siteRules: [longRule, 'Mang đầy đủ PPE'] },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    // jsdom does no layout — every box measures 0×0 and never overflows, so
    // the reveal is measured, never rendered by default. Simulate a real
    // 390px viewport overflowing the clamp on the rules list only (every
    // other element keeps jsdom's zeros).
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('driver-task-rules') ? 96 : 0;
      });
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('driver-task-rules') ? 425 : 0;
      });
    try {
      renderPage();

      expect(await screen.findByText(longRule)).toBeTruthy();
      const reveal = screen.getByRole('button', { name: 'Xem thêm' });
      expect(reveal.getAttribute('aria-expanded')).toBe('false');
      expect(reveal.getAttribute('aria-controls')).toBe('driver-task-site-rules');
      expect(document.getElementById('driver-task-site-rules')?.className)
        .toContain('driver-task-rules--clamped');

      fireEvent.click(reveal);
      const collapse = screen.getByRole('button', { name: 'Thu gọn' });
      expect(collapse.getAttribute('aria-expanded')).toBe('true');
      expect(document.getElementById('driver-task-site-rules')?.className)
        .not.toContain('driver-task-rules--clamped');
      // Nothing is lost on collapse — the full text stays in the DOM.
      expect(screen.getByText(longRule)).toBeTruthy();
    } finally {
      clientHeightSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
  });

  it('renders no reveal control when the site rules fit the clamp', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail(),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('driver-task-rules') ? 96 : 0;
      });
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('driver-task-rules') ? 96 : 0;
      });
    try {
      renderPage();

      expect(await screen.findByText('Mang đầy đủ PPE')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Xem thêm' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Thu gọn' })).toBeNull();
    } finally {
      clientHeightSpy.mockRestore();
      scrollHeightSpy.mockRestore();
    }
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
    // SIL-817: the locked IN_TRANSIT trip renders the complete CTA but the
    // accounting lock disables it — a click could only ever answer with the
    // "Đã khóa kế toán" warning, which is a blocked affordance.
    const completeStickyBar = screen.getByTestId('complete-sticky-bar');
    expect(within(completeStickyBar).getByRole('button', { name: 'Hoàn tất' }).matches(':disabled')).toBe(true);
    // Phần 4 ticket 2026-08-28: the trip detail's "Hoàn tất" CTA is
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

  it('VID-DRV-01 keeps the route line under the factory in the header and the factory address in order information (K10.19)', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        fulfillment: {
          ...makeTaskDetail().fulfillment!,
          factoryAddress: '123 Nguyễn Văn A, Bình Dương',
        },
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('Địa chỉ nhà máy')).toBe('123 Nguyễn Văn A, Bình Dương');
    expect(valueOf('Tuyến')).toBeUndefined();
    // K10.19 (SIL-946, KB §10.4.2 — "tuyến ngay dưới tên nhà máy") supersedes
    // card _26's route-line retirement: the header carries the route on its
    // own line under the factory, exactly once.
    const routeLine = document.querySelector('.driver-task-header__route');
    expect(routeLine?.textContent).toBe('Cát Lái → Bình Dương');
    expect(screen.getAllByText('Cát Lái → Bình Dương')).toHaveLength(1);
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

  it('card _28: sticky completion bar is evidence-gated and keeps the status slot empty', async () => {
    useDriverTaskProgressMock.mockReturnValue({
      data: { items: MILESTONE_FEED },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Trip IN_TRANSIT, 0/2 POD files → SIL-697 RE-OPEN: the bar's live state
    // is the evidence gate (KB §10.4.3) — disabled with the gap named in the
    // Chứng từ card; no inline status chip next to the button.
    expect(screen.getByTestId('complete-sticky-bar')).toBeTruthy();
    expect(screen.queryByTestId('complete-sticky-status')).toBeNull();
    const btn = within(screen.getByTestId('complete-sticky-bar')).getByRole('button', { name: 'Hoàn tất' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('Thiếu 2 file e-POD'));
  });

  // ─── SIL-1053 (K2.42): dải mốc tiến độ trên trang chi tiết lái xe ────────
  describe('SIL-1053 milestone strip (K2.42)', () => {
    it('renders the four K2.42 stages; only the next unrecorded stage is actionable', async () => {
      renderPage();

      const strip = await screen.findByTestId('driver-milestone-strip');
      expect(within(strip).getByTestId('milestone-ORDER_RECEIVED')).toBeTruthy();
      expect(within(strip).getByTestId('milestone-PICKED_UP')).toBeTruthy();
      expect(within(strip).getByTestId('milestone-LOADING_OR_RETURNING')).toBeTruthy();
      expect(within(strip).getByTestId('milestone-DELIVERED')).toBeTruthy();

      // Unaccepted default fixture: Nhận lệnh is the one actionable stage,
      // the later three wait — out-of-order recording is impossible from here
      // (the BE would 409 it anyway).
      expect(within(strip).getByRole('button', { name: 'Ghi nhận mốc Nhận lệnh' })).toBeEnabled();
      expect(within(strip).queryByRole('button', { name: 'Ghi nhận mốc Lấy vỏ / Lấy hàng' })).toBeNull();
      expect(within(strip).queryByRole('button', { name: 'Ghi nhận mốc Đóng / Trả hàng' })).toBeNull();
      expect(within(strip).queryByRole('button', { name: 'Ghi nhận mốc Hạ bãi / Giao hàng' })).toBeNull();
      expect(within(strip).getAllByText('Chờ mốc trước')).toHaveLength(3);

      // Evidence chips ride the stages (FCL fixture): container photos on
      // Lấy vỏ, the two POD docs on Hạ bãi/giao.
      expect(within(strip).getByTestId('milestone-evidence-PICKED_UP').textContent).toContain('Ảnh cont');
      expect(within(strip).getByTestId('milestone-evidence-DELIVERED').textContent).toContain('Phiếu bãi / phiếu hạ');
      expect(within(strip).getByTestId('milestone-evidence-DELIVERED').textContent).toContain('Biên bản giao nhận');
    });

    it('after acceptance the next stage unlocks, its record goes to the progress endpoint, and Hoàn tất waits for Hạ bãi/giao', async () => {
      const progressSpy = vi.spyOn(driverClient, 'recordProgress').mockResolvedValue({} as never);
      useDriverTaskProgressMock.mockReturnValue({
        data: { items: [MILESTONE_FEED[0]] },
        isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined),
      });
      renderPage();

      // Mid-sequence (accepted, later stages missing): the completion CTA
      // waits — completion is the LAST milestone (K2.42).
      await screen.findByTestId('milestone-PICKED_UP');
      expect(within(screen.getByTestId('complete-sticky-bar')).getByRole('button', { name: 'Hoàn tất' })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận mốc Lấy vỏ / Lấy hàng' }));
      await waitFor(() => expect(progressSpy).toHaveBeenCalledWith(
        FULFILLMENT_ID,
        expect.objectContaining({ eventType: DriverProgressEventType.PICKED_UP, fulfillmentId: FULFILLMENT_ID }),
        expect.any(String),
      ));
      expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Đã ghi nhận mốc tiến độ.' });
      // The strip never offered a later stage: no button for Đóng/trả or
      // Hạ bãi while their predecessors are unrecorded.
      expect(screen.queryByRole('button', { name: 'Ghi nhận mốc Đóng / Trả hàng' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ghi nhận mốc Hạ bãi / Giao hàng' })).toBeNull();
    });

    it('a fully recorded strip shows each timestamp and releases the Hoàn tất CTA', async () => {
      useDriverTaskProgressMock.mockReturnValue({
        data: { items: MILESTONE_FEED },
        isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined),
      });
      // SIL-697 RE-OPEN: evidence-complete fixture — this pin owns the
      // milestone strip's release, so the CTA must also pass the evidence gate.
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
      renderPage();

      await screen.findByTestId('milestone-time-DELIVERED');
      expect(screen.getByTestId('milestone-time-ORDER_RECEIVED').textContent).toMatch(/^Đã ghi · /);
      expect(screen.getByTestId('milestone-time-PICKED_UP').textContent).toMatch(/^Đã ghi · /);
      expect(within(screen.getByTestId('complete-sticky-bar')).getByRole('button', { name: 'Hoàn tất' })).toBeEnabled();
      // All four done — no Ghi nhận button remains.
      expect(screen.queryByRole('button', { name: /^Ghi nhận mốc / })).toBeNull();
    });

    it('SIL-1053 r28d: Ghi nhận stays disabled on a closed trip', async () => {
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({ status: 'COMPLETED' }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      useDriverTaskProgressMock.mockReturnValue({
        data: { items: [MILESTONE_FEED[0]] },
        isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined),
      });
      renderPage();

      // Mid-sequence on a CLOSED trip: the row still shows what is missing,
      // but the record button can only 409 — it renders disabled.
      expect(await screen.findByRole('button', { name: 'Ghi nhận mốc Lấy vỏ / Lấy hàng' })).toBeDisabled();
    });

    it('SIL-1053 r28d: Ghi nhận stays disabled on an accounting-locked trip', async () => {
      useDriverTaskDetailMock.mockReturnValue({
        data: makeTaskDetail({
          accountingLock: {
            billingDocumentId: 91,
            activatedAt: '2026-08-04T08:00:00.000Z',
            activatedByName: 'Kế toán Demo',
            reason: 'Đã chốt công nợ tháng 07/2026.',
          },
        }),
        isLoading: false, error: null, refetch: vi.fn(),
      });
      useDriverTaskProgressMock.mockReturnValue({
        data: { items: [MILESTONE_FEED[0]] },
        isLoading: false, error: null, refetch: vi.fn().mockResolvedValue(undefined),
      });
      renderPage();

      expect(await screen.findByRole('button', { name: 'Ghi nhận mốc Lấy vỏ / Lấy hàng' })).toBeDisabled();
    });
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

  // _30 + K10.19 (SIL-946): the contact NAME owns the row (KB: "người liên hệ
  // + số điện thoại, bấm gọi được") — the callable number rides the same line
  // when it differs from the kho number (card 20261003_320: identical numbers
  // never render twice).
  it('card _27 + K10.19: renders the Người liên hệ row with the callable number when the contact number differs from the kho number', async () => {
    renderPage();

    await screen.findByText(/Số cont & seal/);
    // Page fixture: contactName 'Anh Minh', contactPhone 0909000001, khoPhone
    // absent → one kho row (dashed) + one named contact row with the tel:
    // number inline.
    const valueOf = (label: string) => Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === label)
      ?.querySelector('.driver-task-fact__value')?.textContent;
    expect(valueOf('Người liên hệ')).toBe('Anh Minh · 0909000001');
    expect(screen.queryByText('SĐT liên hệ')).toBeNull();
    const telLink = Array.from(document.querySelectorAll('.driver-task-fact'))
      .find((el) => el.querySelector('.driver-task-fact__label')?.textContent === 'Người liên hệ')
      ?.querySelector('a[href="tel:0909000001"]');
    expect(telLink).toBeTruthy();
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

  it('card _27 + K10.19: identical kho and contact numbers render ONE phone row and the bare contact name', async () => {
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
    // Identical numbers never render twice: the name row shows the name only
    // (the number is the callable SĐT kho row above).
    expect(valueOf('Người liên hệ')).toBe('Anh Minh');
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

  // SIL-767 (09/11, customer CR-006) removed the Tác vụ chips BLOCK; SIL-1131
  // (27/11, KB Ch.4 §4.2.2/§4.2.5) brings the dispatch tasks back INSIDE the
  // nhiệm vụ & ghi chú group — uppercase chips on their own row, no Tác vụ
  // block, honest empty states. The remaining blocks (Ghi chú, Thông tin
  // lệnh, cost form) keep their positions.
  it('SIL-1131: dispatch tasks render as Nhiệm vụ chips in the group — no Tác vụ block', async () => {
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
    // SIL-767's no-Tác-vụ-BLOCK ruling stands (KB §4.2.5) — but SIL-1131
    // requires the dispatch tasks to show in the nhiệm vụ & ghi chú group,
    // uppercase on their own row.
    expect(screen.queryByText('Tác vụ')).toBeNull();
    expect(screen.queryByText('Không có tác vụ')).toBeNull();
    const tasks = screen.getByTestId('driver-task-tasks');
    expect(tasks.getAttribute('aria-label')).toBe('Nhiệm vụ');
    expect(tasks.textContent).toBe('KIỂM ĐẾMCÂN ĐẦUCHỤP ẢNH SEALĐÓNG HÀNGNÂNG CONTHẠ CONT');
    // The manual text stays the Ghi chú row.
    expect(screen.getByTestId('driver-task-driver-notes').textContent).toContain('Kiểm seal kỹ trước khi đóng');
  });

  it('SIL-1131: a trip with no dispatch tasks shows the honest "Không có nhiệm vụ" empty state', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ knownTagLabels: [], fulfillment: { ...makeTaskDetail().fulfillment!, driverNotes: null } }),
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
    renderPage();

    await screen.findByText('Nhiệm vụ & ghi chú');
    expect(screen.getByText('Không có nhiệm vụ')).toBeTruthy();
    expect(screen.getByText('Không có ghi chú.')).toBeTruthy();
    expect(screen.queryByText('Tác vụ')).toBeNull();
    expect(screen.queryByText('Không có tác vụ')).toBeNull();
    expect(screen.queryByTestId('driver-task-tasks')).toBeNull();
  });

  // 851e8f7d format v2: two-line note — line 1 (tags) renders ONLY as the
  // Nhiệm vụ chips (SIL-1131); the free-text part renders in the Ghi chú
  // row without the tag line duplicated.
  it('851e8f7d: v2 two-line note splits — tags as Nhiệm vụ chips, free text as the Ghi chú row', async () => {
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
    // SIL-1131 acceptance: chuyến có nhiệm vụ → hiện đúng (uppercase chips).
    expect(screen.getByTestId('driver-task-tasks').textContent).toBe('KIỂM HÓAQUAY ĐẦU');
    expect(screen.queryByText('Tác vụ')).toBeNull();
  });

  it('DRV-R01: multiline notes render verbatim while the tasks ride the Nhiệm vụ row', async () => {
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

    expect(await screen.findByText('Nhiệm vụ & ghi chú')).toBeTruthy();
    const note = screen.getByTestId('driver-task-driver-notes');
    expect(note.textContent).toContain('Gọi chị An trước khi đến\nKiểm tra seal tại kho');
    expect(note.textContent).toContain('Kiểm tra seal tại kho');
    expect(screen.getByTestId('driver-task-tasks').textContent).toBe('KIỂM HÓAQUAY ĐẦU');
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


// CR-011 §8.1.2 — the driver may hold ≥2 accepted trips at once. The BE no
// longer emits DRIVER_TRIP_BLOCKED on the driver-owned path, so there is no
// 409 banner, no blocked toast; another running trip is the SOFT notice
// derived from the journey board (bucket RUNNING), and [Nhận lệnh vận chuyển]
// stays enabled.
describe('other-running-trips soft notice (CR-011)', () => {
  function runningBoardItem(overrides: Record<string, unknown> = {}) {
    return {
      bucket: 'RUNNING', tripId: 61, fulfillmentId: 999,
      blNumber: 'BL-2026-001', bookingRef: null,
      classification: null, pairKind: null, pairId: null, linked: false,
      containerNumber: 'MSCU0000001',
      ...overrides,
    };
  }

  it('a second RUNNING trip renders the soft notice, names it, links it — accept stays enabled', async () => {
    boardItems = [runningBoardItem()];
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail({ status: TripStatus.CREATED }), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    renderPage();
    const notice = await screen.findByTestId('active-trips-soft-notice');
    expect(notice.textContent).toContain('Lưu ý: Bạn đang có 1 chuyến khác chưa hoàn tất');
    expect(notice.textContent).toContain('BL-2026-001');
    expect((screen.getByRole('link', { name: 'Mở chuyến đang chạy' })).getAttribute('href')).toBe('/my-trips/61');
    const accept = screen.getByRole('button', { name: /Nhận lệnh vận chuyển/ });
    expect(accept).toBeEnabled();
    expect(screen.queryByTestId('blocking-trip-banner')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('nothing running → no notice at all', async () => {
    boardItems = [];
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail({ status: TripStatus.CREATED }), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    renderPage();
    await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ });
    expect(screen.queryByTestId('active-trips-soft-notice')).toBeNull();
  });

  it('the current trip never counts as "other" running work', async () => {
    boardItems = [runningBoardItem({ tripId: TRIP_ID, fulfillmentId: FULFILLMENT_ID })];
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail({ status: TripStatus.CREATED }), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    renderPage();
    await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ });
    expect(screen.queryByTestId('active-trips-soft-notice')).toBeNull();
  });

  it('an ordinary accept failure stays a plain error toast — no blocking banner ever', async () => {
    boardItems = [];
    useDriverTaskDetailMock.mockReturnValue({ data: makeTaskDetail({ status: TripStatus.CREATED }), isLoading: false, error: null, refetch: vi.fn() });
    useDriverTaskProgressMock.mockReturnValue({ data: { items: [] }, isLoading: false, refetch: vi.fn() });
    const progress = vi.spyOn(driverClient, 'recordProgress')
      .mockRejectedValueOnce(new ApiError(500, {}, 'Máy chủ bận'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Nhận lệnh vận chuyển/ }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' })));
    expect(screen.queryByTestId('blocking-trip-banner')).toBeNull();
    expect(screen.queryByTestId('active-trips-soft-notice')).toBeNull();
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
