/**
 * SIL-1073 (K3.104, Layer 1) — the e-POD slot carries the full KB state
 * ladder Chưa có · Đã lưu · Chưa đọc được. QA staging b9ab12e1: a saved
 * file showed only "1 tệp" (the words "Đã lưu" appeared nowhere) and a
 * corrupt upload sat in the pending lane as "Chưa gửi" with a raw error —
 * "Chưa đọc được" never rendered anywhere.
 *
 * Pinned here:
 *  - a saved file's state chip NAMES the state: "Đã lưu" beside the count;
 *  - a 400 content refusal turns the pending lane into "Chưa đọc được: <file>"
 *    and an empty slot's chip into the red "Chưa đọc được" state;
 *  - an offline failure keeps the old "Chưa gửi" lane (the file is merely
 *    undelivered, not unreadable) and the slot stays "Chưa có".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../../api/driverClient';

const { downloadPodFileMock } = vi.hoisted(() => ({ downloadPodFileMock: vi.fn() }));
vi.mock('../../api/driverClient', () => ({
  driverClient: { downloadPodFile: downloadPodFileMock },
}));
vi.mock('../PhotoViewer', () => ({
  PhotoViewer: vi.fn(() => <div data-testid="photo-viewer-stub" />),
}));
const compress = vi.hoisted(() => ({ passthrough: vi.fn() }));
vi.mock('../../lib/imageCompression', () => ({
  compressImageFile: compress.passthrough,
}));

import { TripPodSubmission } from './TripPodSubmission';

function makeSubmission(overrides: Partial<DriverTaskPodSubmission> = {}): DriverTaskPodSubmission {
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
    files: [],
    ...overrides,
  } as DriverTaskPodSubmission;
}

function renderSubmission(submission: DriverTaskPodSubmission, onUploadFile?: (submission: DriverTaskPodSubmission, fileType: TripPodFileType, file: File) => Promise<void>) {
  return render(
    <TripPodSubmission
      documentNumber="BILL-55"
      tripVersion={3}
      currentSubmission={submission}
      history={[]}
      creatingDraft={false}
      uploading={false}
      onEnsureDraft={vi.fn().mockResolvedValue(submission)}
      onUploadFile={onUploadFile ?? vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

beforeEach(() => {
  downloadPodFileMock.mockReset();
  downloadPodFileMock.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  compress.passthrough.mockReset();
  compress.passthrough.mockImplementation(async (file: File) => file);
});

describe('SIL-1073 — e-POD nhãn trạng thái đầy đủ (Lớp 1 K3.104)', () => {
  it('a saved file names the KB state: the chip reads "Đã lưu" beside the count', () => {
    renderSubmission(makeSubmission({
      files: [{
        id: 1,
        fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
        originalFileName: 'phieu-bai.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        createdAt: '2026-11-26T09:14:00.000Z',
      }],
    }));
    expect(screen.getByText('Đã lưu')).toBeTruthy();
    expect(screen.getByText('1 tệp')).toBeTruthy();
    const chip = document.querySelector('.trip-pod__state-ok')!;
    expect(chip.className).toContain('trip-pod__state-ok');
    // The other slot, holding nothing, stays "Chưa có".
    expect(screen.getAllByText('Chưa có').length).toBeGreaterThan(0);
  });

  it('a 400 content refusal labels the lane and the empty slot "Chưa đọc được"', async () => {
    const { container } = renderSubmission(
      makeSubmission(),
      vi.fn().mockRejectedValue(new ApiError(400, {}, 'Không thể xử lý tệp e-POD đã tải lên.')),
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    const corrupt = new File(['corrupt'], 'qa-epod-bad.png', { type: 'image/png' });
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { files: [corrupt] } });

    await waitFor(() => {
      const lane = document.querySelector('.trip-pod__pending--unreadable');
      expect(lane).toBeTruthy();
      expect(lane!.textContent).toContain('Chưa đọc được');
      expect(lane!.textContent).toContain('qa-epod-bad.png');
    });
    // The KB state rides the empty slot's chip too — "Chưa có" would lie.
    const chip = document.querySelector('.trip-pod__state-unreadable')!;
    expect(chip.textContent).toBe('Chưa đọc được');
    // The server sentence stays verbatim in the error banner (SIL-1035 law).
    expect(screen.getByText('Không thể xử lý tệp e-POD đã tải lên.')).toBeTruthy();
  });

  it('an offline failure keeps "Chưa gửi" — undelivered is not unreadable', async () => {
    const { container } = renderSubmission(
      makeSubmission(),
      vi.fn().mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource.')),
    );
    const inputs = container.querySelectorAll('input[type="file"]');
    const file = new File(['photo'], 'qa-epod-offline.png', { type: 'image/png' });
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      const lane = document.querySelector('.trip-pod__pending');
      expect(lane).toBeTruthy();
      expect(lane!.className).not.toContain('trip-pod__pending--unreadable');
      expect(lane!.textContent).toContain('Chưa gửi');
      expect(lane!.textContent).toContain('qa-epod-offline.png');
    });
    expect(screen.queryByText(/Chưa đọc được/)).toBeNull();
    // The slot never lies about evidence: nothing saved → still "Chưa có".
    expect(screen.getAllByText('Chưa có').length).toBeGreaterThan(0);
  });
});
