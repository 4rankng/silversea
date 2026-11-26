import { useRef, useState } from 'react';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../../api/driverClient';
import { compressImageFile } from '../../lib/imageCompression';
import { actionErrorMessage } from '../../lib/api/action-error';
import { ApiError } from '../../lib/api/errors';

interface PodUploadOptions {
  currentSubmission: DriverTaskPodSubmission | null;
  blocked: boolean;
  onEnsureDraft: () => Promise<DriverTaskPodSubmission>;
  onUploadFile: (submission: DriverTaskPodSubmission, fileType: TripPodFileType, file: File) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string | null) => void;
}
interface PendingPodFile { file: File; prepared: boolean; capturedAt?: Date; unreadable?: boolean }

/** SIL-1073 (K3.104, Layer 1) — the file the driver handed over exists but
 *  the system cannot read it (KB e-POD state "Chưa đọc được"). The upload
 *  endpoint answers 400 exactly when it cannot accept/process the file
 *  CONTENT (trip-pod.service: corrupt bytes, empty body, decode failure);
 *  everything else (offline, version conflict, permission) keeps the file
 *  merely "chưa gửi". QA staging b9ab12e1: a corrupt PNG sat in the
 *  pending lane with only "Chưa gửi" + a raw error sentence — the KB state
 *  label never appeared anywhere on the page. */
function isUnreadableFileRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

/** In-memory failed evidence only; nothing is queued or replayed on reconnect. */
export function usePodUpload({ currentSubmission, blocked, onEnsureDraft, onUploadFile, onBusyChange, onError }: PodUploadOptions) {
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const [pendingFiles, setPendingFiles] = useState<Partial<Record<TripPodFileType, PendingPodFile>>>({});

  function discardUpload(fileType: TripPodFileType) {
    if (processingRef.current) return;
    setPendingFiles((previous) => {
      const next = { ...previous };
      delete next[fileType];
      return next;
    });
    onError(null);
  }

  async function send(fileType: TripPodFileType, pending: PendingPodFile, input: HTMLInputElement | null) {
    // Lock before decoding so simultaneous selections cannot share a draft version.
    if (processingRef.current || blocked) {
      if (input) input.value = '';
      return;
    }
    processingRef.current = true;
    setProcessing(true);
    onBusyChange?.(true);
    onError(null);
    setPendingFiles((previous) => ({ ...previous, [fileType]: pending }));
    try {
      const file = pending.prepared ? pending.file
        : await compressImageFile(pending.file, { timestamp: pending.capturedAt });
      // Keep the exact prepared bytes on failure: idempotent retries must not
      // generate another image or move its capture timestamp.
      setPendingFiles((previous) => ({ ...previous, [fileType]: { ...pending, file, prepared: true } }));
      const submission = currentSubmission?.status === TripPodStatus.DRAFT
        ? currentSubmission : await onEnsureDraft();
      await onUploadFile(submission, fileType, file);
      setPendingFiles((previous) => {
        const next = { ...previous };
        delete next[fileType];
        return next;
      });
    } catch (error) {
      // SIL-1035 — a raw fetch TypeError surfaces as the offline sentence,
      // never engine English; server refusals stay verbatim. An aborted/raced
      // request surfaces NOTHING (the pending file stays for a retry).
      const message = actionErrorMessage('tải tệp e-POD', error, 'Không thể tải tệp e-POD.');
      if (message !== null) onError(message);
      // SIL-1073 — a content refusal turns the pending lane's label into the
      // KB state "Chưa đọc được" (the file is unreadable, not merely
      // undelivered). A retry keeps re-classifying: success clears the lane,
      // a different failure kind overwrites the flag.
      if (isUnreadableFileRefusal(error)) {
        setPendingFiles((previous) => {
          const current = previous[fileType];
          if (!current) return previous;
          return { ...previous, [fileType]: { ...current, unreadable: true } };
        });
      }
    } finally {
      if (input) input.value = '';
      processingRef.current = false;
      setProcessing(false);
      onBusyChange?.(false);
    }
  }

  function uploadPodFile(fileType: TripPodFileType, file: File, input: HTMLInputElement | null, capturedAt?: Date) {
    return send(fileType, { file, prepared: false, capturedAt }, input);
  }
  async function retryUpload(fileType: TripPodFileType) {
    const pending = pendingFiles[fileType];
    if (pending) await send(fileType, pending, null);
  }
  return { processing, uploadPodFile, pendingFiles, retryUpload, discardUpload };
}
