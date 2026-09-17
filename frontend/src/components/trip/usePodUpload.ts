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

/** Serializes the entire document operation, including image preparation. */
export function usePodUpload({ currentSubmission, blocked, onEnsureDraft, onUploadFile, onBusyChange, onError }: PodUploadOptions) {
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  async function uploadPodFile(fileType: TripPodFileType, raw: File, input: HTMLInputElement | null) {
    // Lock before decoding starts: concurrent selections would send the same
    // draft version. The ref also closes the gap before React re-renders.
    if (processingRef.current || blocked) {
      if (input) input.value = '';
      return;
    }
    processingRef.current = true;
    setProcessing(true);
    onBusyChange?.(true);
    onError(null);
    try {
      const file = await compressImageFile(raw, { timestamp: new Date() });
      const submission = currentSubmission?.status === TripPodStatus.DRAFT
        ? currentSubmission : await onEnsureDraft();
      await onUploadFile(submission, fileType, file);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể tải tệp e-POD.');
    } finally {
      if (input) input.value = '';
      processingRef.current = false;
      setProcessing(false);
      onBusyChange?.(false);
    }
  }

  return { processing, uploadPodFile };
}
