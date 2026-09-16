import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodStatus, TripStatus } from '@tingting/shared';
import type { TripPodSubmissionProps } from '../components/trip/TripPodSubmission';

/**
 * DriverTripPodPage — Phần 4 ticket 2026-08-28: e-POD is its own screen the
 * driver reaches from the trip detail ("Hoàn tất lệnh vận chuyển"). These tests pin
 * the re-homed completion lifecycle: the footer gate needs both mandatory
 * photos, "Hoàn thành chuyến" submits the open DRAFT then completes the trip,
 * and only a confirmed-online completion navigates back to /my-trips.
 */

const {
  useDriverTaskDetailMock,
  refetchMock,
  toastMock,
  submitPodMock,
  completeTripMock,
  onlineMock,
  podSubmissionMock,
} = vi.hoisted(() => ({
  useDriverTaskDetailMock: vi.fn(),
  refetchMock: vi.fn(),
  toastMock: vi.fn(),
  submitPodMock: vi.fn(),
  completeTripMock: vi.fn(),
  onlineMock: vi.fn(),
  podSubmissionMock: vi.fn((_props: TripPodSubmissionProps) => <div data-testid="trip-pod-submission">pod</div>),
}));

vi.mock('../api/driverClient', () => ({
  driverClient: { submitPod: submitPodMock, completeTrip: completeTripMock },
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

vi.mock('../hooks/useOnline', () => ({
  useOnline: onlineMock,
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

function makePod(files: Array<{ fileType: string }>) {
  return {
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
      id: 88,
      driverNotes: null,
    },
    currentPod: makePod([]),
    podHistory: [],
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-trips/88/pod']}>
      <Routes>
        <Route path="/my-trips/:id/pod" element={<DriverTripPodPage />} />
        <Route path="/my-trips" element={<div data-testid="driver-journey-board" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DriverTripPodPage', () => {
  beforeEach(() => {
    refetchMock.mockReset();
    refetchMock.mockResolvedValue(undefined);
    toastMock.mockReset();
    submitPodMock.mockReset().mockResolvedValue({});
    completeTripMock.mockReset().mockResolvedValue({});
    onlineMock.mockReturnValue(true);
    podSubmissionMock.mockClear();
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail(),
      isLoading: false,
      error: null,
      isError: false,
      refetch: refetchMock,
    });
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
    expect(screen.getByRole('button', { name: /Hoàn thành chuyến/i }).hasAttribute('disabled')).toBe(true);
  });

  it('enables Hoàn thành chuyến once both mandatory photos are on the draft', async () => {
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

    const complete = await screen.findByRole('button', { name: /Hoàn thành chuyến/i });
    expect(complete.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Đủ điều kiện hoàn thành chuyến.')).toBeTruthy();
    expect(screen.queryByText(/Thiếu/)).toBeNull();
  });

  it('shows the operational note from cus/điều vận above the upload card', async () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        notes: 'Hàng dễ vỡ, bốc cẩn thận.',
        fulfillment: { id: 88, driverNotes: 'Vào cổng số 2.' },
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

    const complete = await screen.findByRole('button', { name: /Hoàn thành chuyến/i });
    fireEvent.click(complete);

    expect(await screen.findByTestId('driver-journey-board')).toBeTruthy();
    expect(submitPodMock).toHaveBeenCalledWith(88, 22, { expectedVersion: 2 }, expect.any(String));
    expect(completeTripMock).toHaveBeenCalledWith(88, { expectedVersion: 3 }, expect.any(String));
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
    fireEvent.click(await screen.findByRole('button', { name: /Hoàn thành chuyến/i }));
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
    expect(screen.getByRole('button', { name: /Hoàn thành chuyến/i }).hasAttribute('disabled')).toBe(true);
    expect(podSubmissionMock.mock.lastCall?.[0].readOnlyReason).toBe('Lô hàng đã khóa kế toán. Không thể thay đổi chứng từ.');
  });

  it('parses the dispatch note — task tags render as chips, manual text as the note', () => {
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({
        knownTagLabels: ['BỐC HÀNG'],
        fulfillment: { id: 88, driverNotes: 'BỐC HÀNG\nGọi cổng 2' },
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
        fulfillment: { id: 88, driverNotes: 'BỐC HÀNG' },
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
    const complete = screen.getByRole('button', { name: /Hoàn thành chuyến/i });
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

  it('DRV-FOLLOWUP-001 explains offline document editing and prevents completion', () => {
    onlineMock.mockReturnValue(false);
    useDriverTaskDetailMock.mockReturnValue({
      data: makeTaskDetail({ currentPod: makePod([{ fileType: 'YARD_OR_DROP_RECEIPT' }, { fileType: 'SIGNED_DELIVERY_NOTE' }]) }),
      isLoading: false, error: null, isError: false, refetch: refetchMock,
    });
    renderPage();
    expect(podSubmissionMock.mock.lastCall?.[0].readOnlyReason).toBe('Cần kết nối mạng để tải lên chứng từ. Vui lòng kiểm tra kết nối.');
    expect(screen.getByRole('button', { name: /Hoàn thành chuyến/i })).toBeDisabled();
  });

  // Offline queue conflict/recovery tests removed — completion now uses direct API calls.
});
