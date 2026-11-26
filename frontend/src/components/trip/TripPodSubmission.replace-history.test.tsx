// SIL-1086 (K2.57) — a SAVED e-POD file carries a replace control AND a
// replacement-history link. The history names who replaced, when, and keeps
// the old file viewable. The replace affordance is saved-submission-only
// (a draft keeps its upload/remove controls) and never renders as a dead
// control when the page did not wire the handler.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';

const { downloadPodFileMock, downloadPodRevisionMock, PhotoViewerStub } = vi.hoisted(() => ({
  downloadPodFileMock: vi.fn(),
  downloadPodRevisionMock: vi.fn(),
  PhotoViewerStub: vi.fn(() => <div data-testid="photo-viewer-stub" />),
}));

vi.mock('../../api/driverClient', () => ({
  driverClient: {
    downloadPodFile: downloadPodFileMock,
    downloadPodRevision: downloadPodRevisionMock,
  },
}));

vi.mock('../PhotoViewer', () => ({
  PhotoViewer: PhotoViewerStub,
}));

import { TripPodSubmission } from './TripPodSubmission';

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: 81,
    tripId: 55,
    fulfillmentId: 90,
    submissionVersion: 1,
    status: TripPodStatus.ACCEPTED,
    sourceTripVersion: 3,
    version: 2,
    createdAt: '2026-08-01T01:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    submittedAt: '2026-08-02T02:00:00.000Z',
    reviewedAt: '2026-08-02T03:00:00.000Z',
    rejectedAt: null,
    rejectionReason: null,
    acceptedAt: '2026-08-02T03:00:00.000Z',
    supersedesSubmissionId: null,
    files: [
      {
        id: 31,
        fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
        label: 'Phiếu bãi / phiếu hạ',
        originalFileName: 'phieu-bai.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        createdAt: '2026-08-01T01:05:00.000Z',
        downloadUrl: '/api/driver/me/fulfillments/90/pod-files/31',
      },
    ],
    ...overrides,
  };
}

function renderPod(currentSubmission: unknown, onReplaceFile = vi.fn().mockResolvedValue(undefined)) {
  const utils = render(
    <TripPodSubmission
      tripVersion={3}
      currentSubmission={currentSubmission as never}
      history={[]}
      creatingDraft={false}
      uploading={false}
      onEnsureDraft={vi.fn()}
      onUploadFile={vi.fn()}
      onRemoveFile={vi.fn().mockResolvedValue(undefined)}
      onReplaceFile={onReplaceFile}
    />,
  );
  return { ...utils, onReplaceFile };
}

describe('TripPodSubmission — saved-file replace + replacement history (SIL-1086)', () => {
  beforeEach(() => {
    downloadPodFileMock.mockReset().mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
    downloadPodRevisionMock.mockReset().mockResolvedValue(new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }));
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => 'blob:mock-url'),
    });
  });

  it('offers Thay thế and the history link on a saved file', () => {
    renderPod(submission());

    expect(screen.getByRole('button', { name: /Thay thế phieu-bai\.pdf/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lịch sử thay thế' })).toBeTruthy();
    // A saved submission never shows the draft-only remove control.
    expect(screen.queryByRole('button', { name: /Xóa chứng từ/ })).toBeNull();
  });

  it('shows no replace control on a draft — the draft keeps upload/remove', () => {
    renderPod(submission({ status: TripPodStatus.DRAFT, submittedAt: null, reviewedAt: null, acceptedAt: null }));

    expect(screen.queryByRole('button', { name: /Thay thế/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Lịch sử thay thế/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Xóa chứng từ phieu-bai\.pdf/ })).toBeTruthy();
  });

  it('shows no replace control when the caller has not wired the handler', () => {
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

    expect(screen.queryByRole('button', { name: /Thay thế/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Lịch sử thay thế/ })).toBeNull();
  });

  it('routes a picked file through onReplaceFile with the armed file id', async () => {
    const { onReplaceFile, container } = renderPod(submission());

    fireEvent.click(screen.getByRole('button', { name: /Thay thế phieu-bai\.pdf/ }));
    const input = container.querySelector('article input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const picked = new File(['%PDF-1.4'], 'phieu-moi.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [picked] } });

    await waitFor(() => expect(onReplaceFile).toHaveBeenCalledTimes(1));
    expect(onReplaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 81 }),
      31,
      expect.objectContaining({ name: 'phieu-moi.pdf' }),
    );
    // The input resets after the flow, so re-picking the same file re-fires.
    expect(input.value).toBe('');
  });

  it('opens the history panel with who replaced, when, and a working old-file download', async () => {
    const saved = submission({
      fileRevisions: [
        {
          id: 401,
          fileId: 31,
          fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
          label: 'Phiếu bãi / phiếu hạ',
          originalFileName: 'phieu-cu.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          revision: 1,
          uploadedAt: '2026-08-01T01:05:00.000Z',
          uploadedByName: 'Trần Văn B',
          replacedAt: '2026-08-03T04:00:00.000Z',
          replacedByName: 'Nguyễn Văn A',
        },
      ],
    });
    renderPod(saved);

    expect(screen.getByRole('button', { name: 'Lịch sử thay thế (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử thay thế (1)' }));

    expect(screen.getByText('phieu-cu.pdf')).toBeTruthy();
    expect(screen.getByText(/Tải lên .* · Trần Văn B/)).toBeTruthy();
    expect(screen.getByText(/Thay thế .* · bởi Nguyễn Văn A/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Tải phieu-cu\.pdf/ }));
    await waitFor(() => expect(downloadPodRevisionMock).toHaveBeenCalledWith(90, 401));
  });

  it('says so in one sentence when no replacement happened yet', () => {
    renderPod(submission());

    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử thay thế' }));
    expect(screen.getByText('Chưa có lần thay thế nào.')).toBeTruthy();
  });

  it('opens an image revision fullscreen through the shared viewer', async () => {
    const saved = submission({
      fileRevisions: [
        {
          id: 402,
          fileId: 31,
          fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
          label: 'Phiếu bãi / phiếu hạ',
          originalFileName: 'anh-cu.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          revision: 1,
          uploadedAt: '2026-08-01T01:05:00.000Z',
          uploadedByName: 'Trần Văn B',
          replacedAt: '2026-08-03T04:00:00.000Z',
          replacedByName: 'Nguyễn Văn A',
        },
      ],
    });
    renderPod(saved);

    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử thay thế (1)' }));
    // The panel prefetches the old image for the inline thumbnail.
    await waitFor(() => expect(downloadPodRevisionMock).toHaveBeenCalledWith(90, 402));
    fireEvent.click(await screen.findByRole('button', { name: /Xem anh-cu\.png/ }));
    // The viewer mounts after the async blob fetch resolves.
    await waitFor(() => expect(PhotoViewerStub).toHaveBeenCalled());
  });
});
