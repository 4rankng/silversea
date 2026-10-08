// Card 071026212500 — a driver who uploaded the wrong photo had no way to take
// it back. These cases pin the affordance to the same boundary the API
// enforces: offered on a DRAFT, absent once the submission is submitted, so the
// screen never shows an action the server will refuse.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import { TripPodSubmission } from './TripPodSubmission';

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 81,
    tripId: 55,
    fulfillmentId: 90,
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
    files: [
      {
        id: 31,
        fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
        label: 'Phiếu bãi / phiếu hạ',
        originalFileName: 'test-photo.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        createdAt: '2026-08-01T01:05:00.000Z',
        downloadUrl: '/api/driver/me/fulfillments/90/pod-files/31',
      },
    ],
    ...overrides,
  };
}

function renderPod(currentSubmission: unknown, onRemoveFile = vi.fn().mockResolvedValue(undefined)) {
  const utils = render(
    <TripPodSubmission
      tripVersion={3}
      currentSubmission={currentSubmission as never}
      history={[]}
      creatingDraft={false}
      uploading={false}
      onEnsureDraft={vi.fn()}
      onUploadFile={vi.fn()}
      onRemoveFile={onRemoveFile}
    />,
  );
  return { ...utils, onRemoveFile };
}

describe('TripPodSubmission — draft file removal (card 071026212500)', () => {
  it('offers a remove control on the draft file and reports which file', async () => {
    const { onRemoveFile } = renderPod(submission());

    fireEvent.click(screen.getByRole('button', { name: /Xóa chứng từ test-photo.png/ }));

    await waitFor(() => expect(onRemoveFile).toHaveBeenCalledTimes(1));
    expect(onRemoveFile).toHaveBeenCalledWith(expect.objectContaining({ id: 81 }), 31);
  });

  it('shows no remove control once the submission is submitted', () => {
    renderPod(submission({ status: TripPodStatus.SUBMITTED, submittedAt: '2026-08-02T02:00:00.000Z' }));

    expect(screen.queryByRole('button', { name: /Xóa chứng từ/ })).toBeNull();
  });

  it('shows no remove control when the caller has not wired removal', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={submission() as never}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Xóa chứng từ/ })).toBeNull();
  });

  it('surfaces a failed removal instead of swallowing it', async () => {
    const onRemoveFile = vi.fn().mockRejectedValue(new Error('Chỉ gỡ được chứng từ khi e-POD còn ở trạng thái nháp.'));
    renderPod(submission(), onRemoveFile);

    fireEvent.click(screen.getByRole('button', { name: /Xóa chứng từ test-photo.png/ }));

    expect(await screen.findByText(/Chỉ gỡ được chứng từ khi e-POD còn ở trạng thái nháp/)).toBeTruthy();
  });
});