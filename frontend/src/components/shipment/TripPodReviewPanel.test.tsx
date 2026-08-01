import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';

const {
  downloadShipmentPodFileMock,
  cancelShipmentFulfillmentMock,
  reviewShipmentPodMock,
} = vi.hoisted(() => ({
  downloadShipmentPodFileMock: vi.fn(),
  cancelShipmentFulfillmentMock: vi.fn(),
  reviewShipmentPodMock: vi.fn(),
}));

vi.mock('../../api/shipmentClient', () => ({
  downloadShipmentPodFile: downloadShipmentPodFileMock,
  cancelShipmentFulfillment: cancelShipmentFulfillmentMock,
  reviewShipmentPod: reviewShipmentPodMock,
}));

import { TripPodReviewPanel } from './TripPodReviewPanel';

function makeItem(overrides: Partial<Parameters<typeof TripPodReviewPanel>[0]['items'][number]> = {}) {
  return {
    fulfillmentId: 91,
    fulfillmentVersion: 4,
    shipmentId: 42,
    fulfillmentType: 'LCL_SHIPMENT' as const,
    cargoMode: 'LCL' as const,
    shipmentContainerId: null,
    containerNumber: null,
    canceledAt: null,
    cancellationDisposition: null,
    replacementFulfillmentId: null,
    notRequiredReason: null,
    required: true,
    tripId: 77,
    tripCode: 'TRIP-77',
    tripStatus: 'COMPLETED' as const,
    tripVersion: 3,
    driverName: 'Nguyen Van A',
    currentSubmission: {
      id: 81,
      tripId: 77,
      fulfillmentId: 91,
      submissionVersion: 2,
      status: TripPodStatus.SUBMITTED,
      version: 5,
      createdAt: '2026-08-01T01:00:00.000Z',
      submittedAt: '2026-08-01T01:30:00.000Z',
      submittedBy: 12,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      supersedesSubmissionId: 80,
      sourceTripVersion: 3,
      missingRequiredFileTypes: [],
      isReadyForReview: true,
      files: [
        {
          id: 17,
          fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
          label: 'Phiếu hạ bãi / trả hàng',
          originalFileName: 'yard.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          createdAt: '2026-08-01T01:05:00.000Z',
          downloadUrl: '/api/shipments/42/pod-files/17',
        },
      ],
    },
    history: [],
    ...overrides,
  };
}

describe('TripPodReviewPanel', () => {
  beforeEach(() => {
    downloadShipmentPodFileMock.mockReset();
    cancelShipmentFulfillmentMock.mockReset();
    reviewShipmentPodMock.mockReset();
  });

  it('renders the current submission and approves with the guarded version', async () => {
    reviewShipmentPodMock.mockResolvedValue({});
    const onChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <TripPodReviewPanel
        shipmentId={42}
        items={[makeItem()]}
        canReview
        canResolveCancellation={false}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByText(/Chuyến TRIP-77/)).toBeTruthy();
    expect(screen.getByText('Phiếu hạ bãi / trả hàng')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Duyệt & khóa chuyến/i }));

    await waitFor(() => expect(reviewShipmentPodMock).toHaveBeenCalledWith(
      42,
      81,
      {
        expectedVersion: 5,
        resolution: 'ACCEPT',
        rejectionReason: null,
      },
      expect.any(String),
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('submits a replacement cancellation command with the fulfillment version', async () => {
    cancelShipmentFulfillmentMock.mockResolvedValue({});
    const onChanged = vi.fn().mockResolvedValue(undefined);

    render(
      <TripPodReviewPanel
        shipmentId={42}
        items={[makeItem({
          currentSubmission: null,
          tripStatus: 'CREATED',
        })]}
        canReview={false}
        canResolveCancellation
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Hủy tác vụ/i }));
    fireEvent.change(screen.getByLabelText(/Lý do hủy/i), {
      target: { value: 'Khách đổi phương án giao hàng.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận hủy tác vụ/i }));

    await waitFor(() => expect(cancelShipmentFulfillmentMock).toHaveBeenCalledWith(
      42,
      91,
      {
        expectedVersion: 4,
        disposition: 'REPLACED',
        reason: 'Khách đổi phương án giao hàng.',
      },
      expect.any(String),
    ));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });
});
