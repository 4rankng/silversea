import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import { TripPodSubmission } from './TripPodSubmission';

function draftSubmission(overrides: Partial<Parameters<typeof TripPodSubmission>[0]['currentSubmission']> = {}) {
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
    files: [],
    ...overrides,
  };
}

describe('TripPodSubmission', () => {
  it('shows missing required documents and disables submit until required files exist', () => {
    render(
      <TripPodSubmission
        tripId={55}
        tripVersion={3}
        currentSubmission={draftSubmission()}
        history={[]}
        pendingCommands={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Phiếu bãi \/ phiếu hạ/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Biên bản giao nhận có ký nhận/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Gửi e-POD/i }).hasAttribute('disabled')).toBe(true);
  });

  it('creates a draft if needed before uploading a picked file', async () => {
    const ensureDraft = vi.fn().mockResolvedValue(draftSubmission({ status: TripPodStatus.DRAFT }));
    const uploadFile = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <TripPodSubmission
        tripId={55}
        tripVersion={3}
        currentSubmission={null}
        history={[]}
        pendingCommands={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={ensureDraft}
        onUploadFile={uploadFile}
        onSubmit={vi.fn()}
      />,
    );

    const inputs = container.querySelectorAll('input[type="file"]');
    const file = new File(['proof'], 'yard-receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => expect(ensureDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 81 }),
      TripPodFileType.YARD_OR_DROP_RECEIPT,
      file,
    ));
  });

  it('submits the current draft once required files are present', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TripPodSubmission
        tripId={55}
        tripVersion={3}
        currentSubmission={draftSubmission({
          files: [
            {
              id: 1,
              fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
              originalFileName: 'yard.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 100,
              createdAt: '2026-08-01T02:00:00.000Z',
            },
            {
              id: 2,
              fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
              originalFileName: 'signed-note.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 200,
              createdAt: '2026-08-01T02:05:00.000Z',
            },
          ],
        })}
        history={[]}
        pendingCommands={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const button = screen.getByRole('button', { name: /Gửi e-POD/i });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 81 })));
  });
});
