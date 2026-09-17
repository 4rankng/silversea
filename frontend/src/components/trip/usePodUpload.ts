import { useRef, useState } from 'react';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodSubmission } from '../../api/driverClient';
import { compressImageFile } from '../../lib/imageCompression';

interface PodUploadOptions {
  currentSubmission: DriverTaskPodSubmission | null;
  blocked: boolean;
  onEnsureDraft: () => Promise<DriverTaskPodSubmission>;
  onUploadFile: (submission: DriverTaskPodSubmission, fileType: TripPodFileType, file: File) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string | null) => void;
}
interface PendingPodFile { file: File; prepared: boolean; capturedAt?: Date }

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
      onError(error instanceof Error ? error.message : 'Không thể tải tệp e-POD.');
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
