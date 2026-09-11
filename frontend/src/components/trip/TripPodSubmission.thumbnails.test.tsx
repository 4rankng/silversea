import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodStatus, TripPodFileType } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../../api/driverClient';

const { downloadPodFileMock, PhotoViewerStub } = vi.hoisted(() => ({
  downloadPodFileMock: vi.fn(),
  PhotoViewerStub: vi.fn(() => <div data-testid="photo-viewer-stub" />),
}));

vi.mock('../../api/driverClient', () => ({
  driverClient: { downloadPodFile: downloadPodFileMock },
}));

vi.mock('../PhotoViewer', () => ({
  PhotoViewer: PhotoViewerStub,
}));

import { TripPodSubmission } from './TripPodSubmission';

function makeSubmission(overrides: Record<string, unknown> = {}): DriverTaskPodSubmission {
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
    requiredReviewAt: null,
    reviewedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    acceptedAt: null,
    supersedesSubmissionId: null,
    files: [],
    ...overrides,
  } as unknown as DriverTaskPodSubmission;
}

function renderSubmission(submission: DriverTaskPodSubmission) {
  return render(
    <TripPodSubmission
      tripCode="TRIP-55"
      tripVersion={3}
      currentSubmission={submission}
      history={[]}
      pendingCommands={[]}
      creatingDraft={false}
      uploading={false}
      onEnsureDraft={vi.fn().mockResolvedValue(submission)}
      onUploadFile={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe('TripPodSubmission thumbnails (e-POD photos)', () => {
  beforeEach(() => {
    downloadPodFileMock.mockReset();
    downloadPodFileMock.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
    PhotoViewerStub.mockClear();
  });

  it('renders loaded image files as tappable thumbnails that open the fullscreen viewer', async () => {
    const submission = makeSubmission({
      files: [{
        id: 1,
        fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
        originalFileName: 'bbgn.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        createdAt: '2026-08-01T02:00:00.000Z',
      }],
    });
    renderSubmission(submission);

    const thumb = await screen.findByRole('button', { name: /bbgn\.jpg/ });
    expect(thumb.querySelector('img')).toBeTruthy();
    fireEvent.click(thumb);
    expect(PhotoViewerStub).toHaveBeenCalled();
    const props = (PhotoViewerStub.mock.calls as unknown[][]).at(-1)?.[0] as { initialIndex: number };
    expect(props.initialIndex).toBe(0);
  });
});
