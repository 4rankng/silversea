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
    // SIL-697 resolved (09/11): e-POD files are OPTIONAL (22/10 law +
    // shipped SIL-733 PASS win). The foot still names the missing files and
    // the soft count warning — informational, never a block claim.
    expect(screen.getAllByText('Chưa có').length).toBeGreaterThan(0);
    expect(screen.getByText(/Thiếu 2 file e-POD — nên bổ sung\./)).toBeTruthy();
    expect(screen.queryByText(/tùy chọn/)).toBeNull();
    expect(screen.getByText(/Tiến độ chứng từ/)).toBeTruthy();
    expect(screen.queryByText(/Điều kiện hoàn thành/)).toBeNull();
    expect(screen.queryByText('Chứng từ bắt buộc')).toBeNull();
  });

  it('keeps the per-card help copy free of any required-before-completion claim', () => {
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

    // One rule per page: the badge says "Tùy chọn" and completion never
    // blocks (SIL-697 soft law), so no help line may claim the files are
    // required before the trip completes.
    expect(screen.queryByText(/Bắt buộc/)).toBeNull();
    expect(screen.getAllByText('Chụp rõ số phiếu và dấu xác nhận bãi hoặc điểm hạ.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nên có đầy đủ chữ ký giao nhận.').length).toBeGreaterThan(0);
  });

  it('SIL-918: an LCL trip renders the biên bản card alone — no FCL phiếu bãi card', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        cargoMode="LCL"
        currentSubmission={draftSubmission()}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    // KB §3.5.2: hàng lẻ uses its own evidence set — the FCL "Phiếu bãi /
    // phiếu hạ" card never renders.
    expect(screen.queryByText('Phiếu bãi / phiếu hạ')).toBeNull();
    expect(screen.getAllByText(/Biên bản giao nhận có ký nhận/).length).toBeGreaterThan(0);
    // The soft count reads the mode's own set: only the biên bản is missing.
    expect(screen.getByText(/Thiếu 1 file e-POD — nên bổ sung\./)).toBeTruthy();
    // A single card collapses the grid to one full-width track.
    expect(document.querySelector('.trip-pod__grid--single')).toBeTruthy();
    expect(document.querySelector('.trip-pod__grid')?.getAttribute('data-required-types')).toBe('1');
  });

  it('SIL-1110: an LCL trip whose own single group is complete reads the LCL set — 100% + "Đủ chứng từ", never the two-type claim', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        cargoMode="LCL"
        currentSubmission={draftSubmission({
          files: [
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

    // K3.65: the hàng-lẻ set is the biên bản alone — one group complete is
    // complete. The foot may never claim "hai loại" of a lot that owes one.
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Đủ chứng từ.')).toBeTruthy();
    expect(screen.queryByText(/Đủ hai loại chứng từ/)).toBeNull();
    expect(screen.queryByText(/Thiếu/)).toBeNull();
  });

  it('SIL-1110: a foreign-set API verdict never demands phiếu bãi of a hàng-lẻ lot', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        cargoMode="LCL"
        currentSubmission={draftSubmission({
          files: [
            {
              id: 2,
              fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
              originalFileName: 'signed-note.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 200,
              createdAt: '2026-08-01T02:05:00.000Z',
            },
          ],
          // Repro SIL-1110 ("API còn thiếu phiếu bãi"): a verdict computed
          // over the FCL set reports "phiếu bãi" missing on a lot whose whole
          // set is the biên bản. The foot reads the verdict against the lot's
          // OWN set, so the progress stays the LCL set's 100%.
          missingRequiredFileTypes: [TripPodFileType.YARD_OR_DROP_RECEIPT],
        })}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );

    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Đủ chứng từ.')).toBeTruthy();
    expect(screen.queryByText(/Đủ hai loại chứng từ/)).toBeNull();
    expect(screen.queryByText(/Thiếu/)).toBeNull();
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

  it('derives the foot claim from the API verdict, never over the API\'s head', () => {
    // The wire carries the server's own completeness verdict
    // (missingRequiredFileTypes). When the API still reports a type missing,
    // the foot must NOT claim a complete set even though the attached files
    // alone would satisfy the client-side recomputation — and the other way
    // round, a complete API verdict reads as complete.
    const { rerender } = render(
      <TripPodSubmission
        tripVersion={3}
        cargoMode="LCL"
        currentSubmission={draftSubmission({
          files: [
            {
              id: 2,
              fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
              originalFileName: 'signed-note.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 200,
              createdAt: '2026-08-01T02:05:00.000Z',
            },
          ],
          missingRequiredFileTypes: [TripPodFileType.SIGNED_DELIVERY_NOTE],
        })}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );
    expect(screen.getByText(/Thiếu 1 file e-POD — nên bổ sung\./)).toBeTruthy();
    expect(screen.queryByText(/Đủ/)).toBeNull();

    rerender(
      <TripPodSubmission
        tripVersion={3}
        cargoMode="LCL"
        currentSubmission={draftSubmission({
          files: [
            {
              id: 2,
              fileType: TripPodFileType.SIGNED_DELIVERY_NOTE,
              originalFileName: 'signed-note.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 200,
              createdAt: '2026-08-01T02:05:00.000Z',
            },
          ],
          missingRequiredFileTypes: [],
        })}
        history={[]}
        creatingDraft={false}
        uploading={false}
        onEnsureDraft={vi.fn()}
        onUploadFile={vi.fn()}
      />,
    );
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('Đủ chứng từ.')).toBeTruthy();
    expect(screen.queryByText(/Thiếu/)).toBeNull();
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

  // Card 261022201006c / PRD ManHinhLaiXe §3.1: the app lái xe shows NO raw
  // internal code. A stored e-POD file name may carry one (the seeded shape is
  // "<tripCode>-<FILE_TYPE>.pdf"), so the driver-facing name drops it and
  // keeps the document label. The stored file is untouched.
  it('never renders the internal trip code carried by a stored file name', () => {
    render(
      <TripPodSubmission
        tripVersion={3}
        currentSubmission={draftSubmission({
          files: [
            {
              id: 1,
              fileType: TripPodFileType.YARD_OR_DROP_RECEIPT,
              originalFileName: 'TRP-202609-0001-YARD_OR_DROP_RECEIPT.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 100,
              createdAt: '2026-08-01T02:00:00.000Z',
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

    // The document label survives; the code never reaches the DOM.
    expect(screen.getByText('YARD_OR_DROP_RECEIPT.pdf')).toBeTruthy();
    expect(screen.queryByText(/TRP-202609-0001/)).toBeNull();
    expect(document.body.innerHTML).not.toContain('TRP-202609-0001');
    // The download affordance names the document, not the code.
    expect(screen.getByRole('button', { name: /Tải chứng từ YARD_OR_DROP_RECEIPT\.pdf/ })).toBeTruthy();
  });
});
