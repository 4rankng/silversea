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
  it('shows missing required documents and readiness status', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={draftSubmission()}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Phiếu bãi \/ phiếu hạ/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Biên bản giao nhận có ký nhận/).length).toBeGreaterThan(0);
    // Card 261022213755a: photos are optional — the card state reads
    // "Chưa có" and the foot names the missing types as optional under the
    // informational "Tiến độ chứng từ", never a mandatory-gate claim.
    expect(screen.getAllByText('Chưa có').length).toBeGreaterThan(0);
    expect(screen.getByText(/Chưa có .+ \(tùy chọn\)\./)).toBeTruthy();
    expect(screen.getByText(/Tiến độ chứng từ/)).toBeTruthy();
    expect(screen.queryByText(/Điều kiện hoàn thành/)).toBeNull();
    expect(screen.queryByText('Chứng từ bắt buộc')).toBeNull();
  });

  it('creates a draft if needed before uploading a picked file', async () => {
    const ensureDraft = vi.fn().mockResolvedValue(draftSubmission({ status: TripPodStatus.DRAFT }));
    const uploadFile = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={null}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={ensureDraft}
        onUploadFile={uploadFile}
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

  it('shows 100% readiness when both required files are present', () => {
    render(
      <TripPodSubmission
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
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    expect(screen.getByText('100%')).toBeTruthy();
    // Card 261022213755a: optional copy — the foot names the fact without the
    // retired completion-gate claim.
    expect(screen.getByText('Đủ hai loại chứng từ.')).toBeTruthy();
  });

  // vantaiphucloc EPOD pattern: "Chụp" opens the fullscreen camera overlay
  // (live preview + torch + gallery fallback), not a bare <input capture>.
  it('opens the fullscreen scanner overlay from Chụp and closes back', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={draftSubmission()}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    // Two capture buttons (one per required slot); open the first.
    const captureButtons = screen.getAllByRole('button', { name: 'Chụp' });
    expect(captureButtons.length).toBe(2);
    fireEvent.click(captureButtons[0]);

    // The overlay portals to body: jsdom has no getUserMedia, so the scanner
    // renders its camera-error state — the gallery fallback must survive.
    expect(screen.getByLabelText('Chọn ảnh từ thư viện')).toBeTruthy();
    expect(screen.getByLabelText('Đóng')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Đóng'));
    expect(screen.queryByLabelText('Chọn ảnh từ thư viện')).toBeNull();
  });

  it('locks capture/upload once the submission is SUBMITTED, avoiding the 409 dead-end', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={draftSubmission({ status: TripPodStatus.SUBMITTED })}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Chụp' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tải tệp' })).toBeNull();
    // One shared banner, not one per card — avoids repeating the identical
    // sentence twice on screen.
    expect(screen.getAllByText('Chứng từ đã gửi. Bạn có thể xem ảnh hoặc tải lại tệp bên dưới.')).toHaveLength(1);
  });

  it('keeps capture/upload open after a REJECTED submission so the driver can retry', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={draftSubmission({
          status: TripPodStatus.REJECTED,
          rejectionReason: 'Ảnh mờ, không đọc được số phiếu.',
        })}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Chụp' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Tải tệp' }).length).toBe(2);
  });
});
