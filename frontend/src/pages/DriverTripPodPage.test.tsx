import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodStatus, TripStatus } from '@tingting/shared';
import type { TripPodSubmissionProps } from '../components/trip/TripPodSubmission';
import { qk } from '../api/keys';

/**
 * DriverTripPodPage — Phần 4 ticket 2026-08-28: e-POD is its own screen the
 * driver reaches from the trip detail ("Hoàn tất lệnh vận chuyển"). These tests pin
 * the re-homed completion lifecycle: the footer gate needs both mandatory
 * photos, "HOÀN THÀNH CHUYẾN" submits the open DRAFT then completes the trip,
 * and only a confirmed-online completion navigates back to /my-trips.
 */

const {
  useDriverTaskDetailMock,
  refetchMock,
  toastMock,
  submitPodMock,
  completeTripMock,
  getDriverTripMock,
  podSubmissionMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  refetchMock: vi.fn(),
  toastMock: vi.fn(),
  submitPodMock: vi.fn(),
  completeTripMock: vi.fn(),
  getDriverTripMock: vi.fn(),
  podSubmissionMock: vi.fn((_props: TripPodSubmissionProps) => <div data-testid="trip-pod-submission">pod</div>),
}));

vi.mock('../api/driverClient', () => ({
  driverClient: {
    submitPod: submitPodMock,
    completeTrip: completeTripMock,
    getDriverTrip: getDriverTripMock,
  },
}));

vi.mock('../hooks/useDriverQueries', () => ({
  useDriverTaskDetail: useDriverTaskDetailMock,
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

vi.mock('../components/trip/TripPodSubmission', () => ({
  default: podSubmissionMock,
}));

vi.mock('../lib/idempotency', () => ({
  buildIdempotencyKey: (...parts: Array<string | number>) => parts.join(':'),
}));

import { DriverTripPodPage } from './DriverTripPodPage';

// Card 071026141570: the route `/my-trips/:id/pod` carries a TRIP id, but every
// e-POD endpoint is FULFILLMENT-scoped. These two must stay numerically
// distinct in every fixture below, otherwise a page that (wrongly) hands the
// route id straight to the fulfillment endpoint still renders green.
const TRIP_ID = 88;
const FULFILLMENT_ID = 4242;

function makePod(files: Array<{ fileType: string }>) {
  return {
    id: 22,
    tripId: 55,
    fulfillmentId: FULFILLMENT_ID,
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
    files: files.map((file, index) => ({
      id: index + 1,
      fileType: file.fileType,
      originalFileName: `${file.fileType.toLowerCase()}.jpg`,
      storageKey: `k${index + 1}`,
      createdAt: '2026-08-01T01:05:00.000Z',
    })),
  };
}

function makeTaskDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 55,
    version: 3,
    tripCode: 'TRIP-55',
    status: 'IN_TRANSIT',
    routeName: 'Cảng Cát Lái → Nhà máy Bình Dương',
    customerName: 'SilverSea',
    cargoTypeName: 'Hàng nhập',
    notes: null,
    accountingLock: null,
    fulfillment: {
      id: FULFILLMENT_ID,
      documentNumber: ' BILL-POD-55 ',
      driverNotes: null,
    },
    currentPod: makePod([]),
    podHistory: [],
    ...overrides,
  };
}

function renderPage(
  client: QueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  tripPayload: { id: number; fulfillmentId: number | null } = { id: TRIP_ID, fulfillmentId: FULFILLMENT_ID },
) {
  // The page resolves the fulfillment id from the TRIP payload. Seed that
  // payload into the cache so the resolution happens without a network round
  // trip and the existing synchronous assertions keep their meaning.
  client.setQueryData(qk.driver.tripBasic(TRIP_ID), tripPayload);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/my-trips/${TRIP_ID}/pod`]}>
        <Routes>
          <Route path="/my-trips/:id/pod" element={<DriverTripPodPage />} />
          <Route path="/my-trips" element={<div data-testid="driver-journey-board" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DriverTripPodPage', () => {
  beforeEach(() => {
    refetchMock.mockReset();
    refetchMock.mockResolvedValue(undefined);
    toastMock.mockReset();
    submitPodMock.mockReset().mockResolvedValue({});
    completeTripMock.mockReset().mockResolvedValue({});
    podSubmissionMock.mockClear();
    getDriverTripMock.mockReset().mockResolvedValue({ id: TRIP_ID, fulfillmentId: FULFILLMENT_ID });
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail(),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
  });

  // Card 071026141570 (P2, driver e-POD hard error on staging trip 79).
  //
  // The route `/my-trips/:id/pod` carries a TRIP id. Every e-POD endpoint is
  // FULFILLMENT-scoped (`DRIVER_TASK.DETAIL = /driver/me/fulfillments/{id}`).
  // The page used to hand the route id straight to that endpoint, so every trip
  // 404'd and fell into the hard-error branch. The fulfillment id must come
  // from the TRIP payload instead.
  it('resolves the fulfillment id from the trip payload, never from the route trip id', async () => {
    renderPage();

    // The pod screen renders from the fulfillment's task detail...
    expect(await screen.findByTestId('trip-pod-submission')).toBeTruthy();
    expect(screen.queryByText('Không tải được chuyến. Vui lòng thử lại.')).toBeNull();
    // ...and the fulfillment id it holds is the one from the trip payload.
    expect(screen.getByText('BILL-POD-55')).toBeInTheDocument();
  });

  it('does not query the fulfillment endpoint with the route trip id (regression pin, card 071026141570)', async () => {
    // Both mandatory photos present so the completion gate opens and the write
    // actually fires — that write is the observable proof of which id the page holds.
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: makePod([
          { fileType: 'YARD_OR_DROP_RECEIPT' },
          { fileType: 'SIGNED_DELIVERY_NOTE' },
        ]),
      }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Deliberately do NOT seed the cache: this test asserts the page's own
    // trip→fulfillment resolution by observing what it asks the API for.
    renderPage(client);

    expect(await screen.findByTestId('trip-pod-submission')).toBeTruthy();
    expect(screen.queryByText('Không tải được chuyến. Vui lòng thử lại.')).toBeNull();

    // The trip was fetched BY TRIP id...
    expect(getDriverTripMock).toHaveBeenCalledWith(TRIP_ID);
    // ...and the completion write carries the FULFILLMENT id, never the route id.
    fireEvent.click(screen.getByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }));
    await waitFor(() => expect(completeTripMock).toHaveBeenCalled());
    expect(completeTripMock.mock.calls[0][0]).toBe(FULFILLMENT_ID);
    expect(completeTripMock.mock.calls[0][0]).not.toBe(TRIP_ID);
  });

  it('shows the no-fulfillment guard (not a hard error) when the trip has no fulfillment', async () => {
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false } } }), {
      id: TRIP_ID,
      fulfillmentId: null,
    });

    // Ad-hoc trips carry fulfillmentId: null — they have no e-POD surface at all.
    expect(await screen.findByText('Không thể xác định chuyến đi từ liên kết này.')).toBeTruthy();
    expect(screen.queryByText('Không tải được chuyến. Vui lòng thử lại.')).toBeNull();
  });

  it('QA-AUDIT-DRV-POD-01 uses the business reference in the header and document panel', () => {
    renderPage();
    expect(screen.getByText('BILL-POD-55')).toBeInTheDocument();
    expect(screen.queryByText('TRIP-55')).toBeNull();
    expect(podSubmissionMock.mock.calls.at(-1)?.[0].documentNumber).toBe('BILL-POD-55');
  });

  it.each([null, '   '])('QA-AUDIT-DRV-POD-01 names a missing document number (%s)', (documentNumber) => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ fulfillment: { id: FULFILLMENT_ID, documentNumber, driverNotes: null } }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    renderPage();
    expect(screen.getByText('Chưa có số Bill/Booking')).toBeInTheDocument();
    expect(screen.queryByText('TRIP-55')).toBeNull();
    expect(podSubmissionMock.mock.calls.at(-1)?.[0].documentNumber).toBe('Chưa có số Bill/Booking');
  });

  it('renders the e-POD screen with the mandatory-photo footer gate', async () => {
    renderPage();

    expect(await screen.findByTestId('trip-pod-submission')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /e-POD giao hàng/ })).toBeTruthy();
    // The section label lives inside TripPodSubmission's own eyebrow — the
    // page must not stack a second "e-POD bắt buộc" head above it.
    expect(screen.queryByText('e-POD bắt buộc')).toBeNull();
    // Both mandatory photos are listed as missing and completion is gated.
    expect(screen.getByText('Thiếu Phiếu bãi / phiếu hạ')).toBeTruthy();
    expect(screen.getByText('Thiếu Biên bản giao nhận')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }).hasAttribute('disabled')).toBe(true);
    // DRV-DET-06: the e-POD screen states that the e-POD is mandatory and
    // names the uppercase command — without minting a second `e-POD bắt buộc`
    // label (asserted absent above).
    expect(screen.getByText(/e-POD là bắt buộc/)).toBeTruthy();
    expect(screen.getByText('HOÀN THÀNH CHUYẾN')).toBeTruthy();
  });

  it('enables HOÀN THÀNH CHUYẾN once both mandatory photos are on the draft', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: makePod([
          { fileType: 'YARD_OR_DROP_RECEIPT' },
          { fileType: 'SIGNED_DELIVERY_NOTE' },
        ]),
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });

    renderPage();

    const complete = await screen.findByRole('button', { name: 'HOÀN THÀNH CHUYẾN' });
    expect(complete.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Đủ điều kiện hoàn thành chuyến.')).toBeTruthy();
    expect(screen.queryByText(/Thiếu/)).toBeNull();
  });

  it('shows the operational note from cus/điều vận above the upload card', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        notes: 'Hàng dễ vỡ, bốc cẩn thận.',
        fulfillment: { id: FULFILLMENT_ID, driverNotes: 'Vào cổng số 2.' },
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });

    renderPage();

    // fulfillment.driverNotes wins over trip.notes (same chain as the detail page).
    expect(await screen.findByText('Vào cổng số 2.')).toBeTruthy();
    expect(screen.queryByText('Hàng dễ vỡ, bốc cẩn thận.')).toBeNull();
  });

  // Spec A7 (re-homed from the trip detail): only a confirmed-online
  // completion navigates; the command carries the fulfillment id + trip version.
  it('navigates back to the journey board after an online completion', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: makePod([
          { fileType: 'YARD_OR_DROP_RECEIPT' },
          { fileType: 'SIGNED_DELIVERY_NOTE' },
        ]),
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
    renderPage();

    const complete = await screen.findByRole('button', { name: 'HOÀN THÀNH CHUYẾN' });
    fireEvent.click(complete);

    expect(await screen.findByTestId('driver-journey-board')).toBeTruthy();
    // Card 071026141570: both writes carry the FULFILLMENT id from the trip
    // payload (4242), never the route's trip id (88).
    expect(submitPodMock).toHaveBeenCalledWith(FULFILLMENT_ID, 22, { expectedVersion: 2 }, expect.any(String));
    expect(completeTripMock).toHaveBeenCalledWith(FULFILLMENT_ID, { expectedVersion: 3 }, expect.any(String));
    expect(submitPodMock.mock.invocationCallOrder[0]).toBeLessThan(completeTripMock.mock.invocationCallOrder[0]);
    expect(toastMock).toHaveBeenCalledWith({ kind: 'success', message: 'Đã lưu chứng từ giao hàng.' });
  });

  it.each(['submit', 'complete'])('keeps the driver on the POD screen when %s fails', async (stage) => {
    const error = new Error('Không thể lưu, vui lòng thử lại.');
    (stage === 'submit' ? submitPodMock : completeTripMock).mockRejectedValue(error);
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ currentPod: makePod([{ fileType: 'YARD_OR_DROP_RECEIPT' }, { fileType: 'SIGNED_DELIVERY_NOTE' }]) }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ kind: 'error', message: error.message }));
    expect(screen.queryByTestId('driver-journey-board')).toBeNull();
    expect(screen.getByTestId('trip-pod-submission')).toBeTruthy();
    if (stage === 'submit') expect(completeTripMock).not.toHaveBeenCalled();
  });

  it('shows the accounting-lock banner and disables completion while locked', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        accountingLock: {
          billingDocumentId: 7,
          billingDocumentNumber: 'DN-0007',
          activatedByName: 'Kế toán Anh',
          activatedAt: '2026-08-01T02:00:00.000Z',
          reason: 'Chốt kỳ tháng 7',
        },
        currentPod: makePod([
          { fileType: 'YARD_OR_DROP_RECEIPT' },
          { fileType: 'SIGNED_DELIVERY_NOTE' },
        ]),
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });

    renderPage();

    expect(await screen.findByRole('status', { name: 'Lô hàng đã khóa kế toán' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }).hasAttribute('disabled')).toBe(true);
    expect(podSubmissionMock.mock.lastCall?.[0].readOnlyReason).toBe('Lô hàng đã khóa kế toán. Không thể thay đổi chứng từ.');
  });

  it('parses the dispatch note — task tags render as chips, manual text as the note', () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: ['BỐC HÀNG'],
        fulfillment: { id: FULFILLMENT_ID, driverNotes: 'BỐC HÀNG\nGọi cổng 2' },
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
    renderPage();

    expect(screen.getByTestId('pod-operation-chips')).toBeTruthy();
    expect(screen.getByTestId('pod-operation-chips').textContent).toContain('BỐC HÀNG');
    expect(screen.getByText('Gọi cổng 2')).toBeTruthy();
    // The composed raw note must never leak as a literal blob.
    expect(screen.queryByText('BỐC HÀNG\nGọi cổng 2')).toBeNull();
  });

  it('renders a tags-only dispatch note as chips without an empty note paragraph', () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: ['BỐC HÀNG'],
        fulfillment: { id: FULFILLMENT_ID, driverNotes: 'BỐC HÀNG' },
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
    renderPage();

    expect(screen.getByTestId('pod-operation-chips')).toBeTruthy();
    // Exactly one rendering of the tag (the chip) — no raw note paragraph.
    expect(screen.getAllByText('BỐC HÀNG')).toHaveLength(1);
    expect(document.querySelector('.driver-trip-pod-note p')).toBeNull();
  });

  it('DRV-FOLLOWUP-001 blocks completion during document preparation and enables it after the operation ends', () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ currentPod: makePod([{ fileType: 'YARD_OR_DROP_RECEIPT' }, { fileType: 'SIGNED_DELIVERY_NOTE' }]) }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    renderPage();
    const complete = screen.getByRole('button', { name: 'HOÀN THÀNH CHUYẾN' });
    expect(complete).toBeEnabled();
    act(() => podSubmissionMock.mock.lastCall?.[0].onBusyChange?.(true));
    expect(complete).toBeDisabled();
    expect(complete).toHaveTextContent('Đang lưu chứng từ…');
    fireEvent.click(complete);
    expect(submitPodMock).not.toHaveBeenCalled();
    expect(completeTripMock).not.toHaveBeenCalled();
    act(() => podSubmissionMock.mock.lastCall?.[0].onBusyChange?.(false));
    expect(complete).toBeEnabled();
  });

  it.each([
    [TripStatus.COMPLETED, 'Chuyến đã hoàn thành. Bạn có thể xem hoặc tải lại chứng từ.'],
    [TripStatus.CANCELED, 'Chuyến đã hủy. Không thể thay đổi chứng từ.'],
  ])('DRV-FOLLOWUP-001 makes %s documents read-only and removes completion controls', (status, reason) => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ status }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    renderPage();
    expect(podSubmissionMock.mock.lastCall?.[0].readOnlyReason).toBe(reason);
    expect(document.querySelector('.driver-task-footer')).toBeNull();
  });

  it('AC-CP-KT-22 lets the API determine availability without closing the POD form', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ currentPod: makePod([{ fileType: 'YARD_OR_DROP_RECEIPT' }, { fileType: 'SIGNED_DELIVERY_NOTE' }]) }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    submitPodMock.mockRejectedValueOnce(new Error('Máy chủ không khả dụng'));
    renderPage();
    expect(podSubmissionMock.mock.lastCall?.[0].readOnlyReason).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }));
    await waitFor(() => expect(submitPodMock).toHaveBeenCalledTimes(1));
    expect(completeTripMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('trip-pod-submission')).toBeTruthy();
  });

  // Offline queue conflict/recovery tests removed — completion now uses direct API calls.
  it('UI-DC-22 warns on Back only while unsent evidence remains and preserves it on cancel', async () => {
    renderPage();
    const props = podSubmissionMock.mock.calls.at(-1)![0];
    await act(async () => props.onPendingChange?.(true));
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(await screen.findByText('Còn tệp chưa gửi. Bỏ tệp và rời trang?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hủy|Ở lại/ }));
    expect(screen.getByTestId('trip-pod-submission')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Còn tệp chưa gửi. Bỏ tệp và rời trang?')).toBeNull());
    await act(async () => props.onPendingChange?.(false));
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.queryByText('Còn tệp chưa gửi. Bỏ tệp và rời trang?')).toBeNull();
  });

  it('UI-DC-25 does not silently discard a failed supplementary file when completing saved evidence', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ currentPod: makePod([
        { fileType: 'YARD_OR_DROP_RECEIPT' }, { fileType: 'SIGNED_DELIVERY_NOTE' },
      ]) }), isLoading: false, isError: false, refetch: refetchMock,
    });
    renderPage();
    await act(async () => podSubmissionMock.mock.calls.at(-1)![0].onPendingChange?.(true));
    fireEvent.click(screen.getByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }));
    expect(await screen.findByText('Còn tệp bổ sung chưa gửi. Bỏ tệp này và hoàn thành với chứng từ đã lưu?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(submitPodMock).not.toHaveBeenCalled();
    expect(completeTripMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('trip-pod-submission')).toBeInTheDocument();
  });

  // Card 051026230654 — completion moves the trip NEW/RUNNING → HISTORY, but
  // the journey board (list + "Lệnh mới" badge) and the day-view chip kept
  // their pre-completion cache: the global 5-minute staleTime masked the
  // remount refetch, so the driver saw stale counts until the 15 s poll or a
  // manual tab flip. The completion must invalidate its consumers BEFORE
  // navigating back so /my-trips refetches on mount.
  it('invalidates the journey board and day view when the trip completes', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: makePod([
          { fileType: 'YARD_OR_DROP_RECEIPT' },
          { fileType: 'SIGNED_DELIVERY_NOTE' },
        ]),
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderPage(client);

    fireEvent.click(await screen.findByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }));
    expect(await screen.findByTestId('driver-journey-board')).toBeTruthy();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.driver.journeyBoard });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.driver.twoOrders });
  });

  it('does not invalidate the board when the completion fails', async () => {
    completeTripMock.mockRejectedValueOnce(new Error('Không thể hoàn thành chuyến.'));
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        currentPod: makePod([
          { fileType: 'YARD_OR_DROP_RECEIPT' },
          { fileType: 'SIGNED_DELIVERY_NOTE' },
        ]),
      }),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderPage(client);

    fireEvent.click(await screen.findByRole('button', { name: 'HOÀN THÀNH CHUYẾN' }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ kind: 'error', message: 'Không thể hoàn thành chuyến.' }));
    expect(screen.queryByTestId('driver-journey-board')).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: qk.driver.journeyBoard });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: qk.driver.twoOrders });
  });

});
