import { useState, useCallback, useRef } from 'react';
import { api, fileCommandFingerprint } from '../lib/api';

type PhotoType = 'CONTAINER' | 'SEAL' | 'OTHER';

/** Result shape from POST /api/ocr. */
export interface OcrResponse {
  ok: boolean;
  containerNumbers?: string[];
  sealNumber?: string | null;
  checkDigitWarnings?: string[];
  photoUrl?: string;
  storageKey?: string;
  model?: string | null;
  error?: string | null;
}

/** A create-mode OCR photo held in RAM until the trip has an id. */
interface PendingPhoto {
  file: File;
  type: 'CONTAINER' | 'SEAL';
  objectUrl: string;
}

/** A per-container OCR photo held in RAM until its row has a server id
 *  (create mode, or an unsaved new row in edit mode). Flushed by
 *  `flushPendingContainerPhotos` once `saveContainers` assigns ids. */
interface PendingContainerPhoto {
  rowKey: string;
  type: 'CONTAINER' | 'SEAL';
  file: File;
  objectUrl: string;
}

export interface ContainerPhotoUploadResult {
  /** Renderable URL — `/api/photos/...` (persisted) or `blob:...` (pending). */
  url: string;
  /** Raw OCR response (always populated — OCR runs even when buffering so the
   *  number can fill the row immediately). */
  ocrResult: OcrResponse;
  /** True when the photo is buffered in RAM (not yet persisted). */
  pending: boolean;
}

export type OcrResultHandler = (
  containerNumbers: string[],
  sealNumber: string | null,
  type: 'CONTAINER' | 'SEAL',
) => void;

/** Per-zone upload-in-progress flag. Tracks CONTAINER, SEAL, and OTHER
 *  independently so a pending container upload doesn't grey out the seal
 *  button (and vice-versa). */
export type UploadingState = Record<PhotoType, boolean>;

/** True when any zone is currently uploading. Use this for save/submit
 *  disable checks where any in-flight upload should block the action. */
export function isAnyUploading(uploading: UploadingState): boolean {
  return Object.values(uploading).some(Boolean);
}

function buildPhotoRetryFingerprint(
  scope: string,
  file: File,
  parts: Array<string | number | null | undefined>,
): string {
  return [
    scope,
    fileCommandFingerprint(file),
    ...parts.map((part) => String(part ?? '')),
  ].join(':');
}

export function useTripFormPhotos(onError: (msg: string) => void, onOcrResult?: OcrResultHandler) {
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState<UploadingState>({ CONTAINER: false, SEAL: false, OTHER: false });
  // Create-mode OCR photos are kept in RAM (no trip id yet) and uploaded once
  // the trip is created — see flushPendingPhotos.
  const pendingRef = useRef<PendingPhoto[]>([]);
  // Per-container OCR photos buffered until the row has a server id — see
  // uploadContainerPhoto / flushPendingContainerPhotos / revokeRowPhotos.
  const pendingContainerPhotosRef = useRef<PendingContainerPhoto[]>([]);

  const uploadPhotos = useCallback(async (files: FileList, tripId?: number, type: PhotoType = 'OTHER') => {
    setUploading(prev => ({ ...prev, [type]: true }));
    try {
      for (const file of Array.from(files)) {
        if (type === 'CONTAINER' || type === 'SEAL') {
          // Route container/seal uploads through OCR (auto-fill + persist when trip exists).
          const formData = new FormData();
          formData.append('file', file);
          formData.append('type', type);
          if (tripId) formData.append('trip_id', String(tripId));

          const retryFingerprint = buildPhotoRetryFingerprint(
            'trip-form-ocr',
            file,
            [type, tripId ?? 'create-preview'],
          );
          const result = await api.upload('/ocr', formData, { retryFingerprint }) as OcrResponse;
          onOcrResult?.(result.containerNumbers ?? [], result.sealNumber ?? null, type);

          if (result.photoUrl) {
            // Edit branch: photo persisted server-side.
            setPhotoUrls(prev => [...prev, result.photoUrl!]);
          } else if (!tripId) {
            // Create branch: hold the file in RAM + local preview until the trip exists.
            const objectUrl = URL.createObjectURL(file);
            pendingRef.current.push({ file, type, objectUrl });
            setPhotoUrls(prev => [...prev, objectUrl]);
          }

          // Surface a friendly OCR error (e.g. key not configured, no numbers) —
          // the photo may still have been saved (Edit) so this is informational.
          if (result.error) onError(result.error);
        } else {
          // OTHER → existing upload endpoint.
          const formData = new FormData();
          formData.append('file', file);
          if (tripId) formData.append('trip_id', String(tripId));
          formData.append('type', type);
          const retryFingerprint = buildPhotoRetryFingerprint(
            'trip-form-upload',
            file,
            [type, tripId ?? 'create-preview'],
          );
          const result = await api.upload('/upload', formData, { retryFingerprint }) as { url: string };
          setPhotoUrls(prev => [...prev, result.url]);
        }
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Lỗi khi tải ảnh.');
    } finally {
      setUploading(prev => ({ ...prev, [type]: false }));
    }
  }, [onError, onOcrResult]);

  const removePhoto = useCallback((idx: number) => {
    setPhotoUrls(prev => {
      const url = prev[idx];
      // Revoke any local object-URL preview we were holding.
      if (url && url.startsWith('blob:')) {
        pendingRef.current = pendingRef.current.filter(p => p.objectUrl !== url);
        URL.revokeObjectURL(url);
      }
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  /**
   * After a trip is created (create mode), upload the held OCR photos with the
   * new trip id and replace their local object-URL previews with real server
   * URLs. Returns the final photoUrls array so the caller can use it directly
   * in the create payload (state updates are async).
   */
  const flushPendingPhotos = useCallback(async (tripId: number): Promise<string[]> => {
    const pending = pendingRef.current;
    if (pending.length === 0) return photoUrls;

    const objToReal = new Map<string, string>();
    const succeeded: PendingPhoto[] = [];
    for (const p of pending) {
      const formData = new FormData();
      formData.append('file', p.file);
      formData.append('trip_id', String(tripId));
      formData.append('type', p.type);
      const retryFingerprint = buildPhotoRetryFingerprint(
        'trip-form-flush-upload',
        p.file,
        [p.type, tripId, p.objectUrl],
      );
      try {
        const result = await api.upload('/upload', formData, { retryFingerprint }) as { url: string };
        if (result.url) {
          objToReal.set(p.objectUrl, result.url);
          succeeded.push(p);
          // Server confirmed — safe to release blob URL.
          URL.revokeObjectURL(p.objectUrl);
        }
        // Missing URL in response: keep photo in pending buffer for retry.
      } catch {
        // Upload failed: keep photo in pending buffer for retry.
      }
    }

    // Remove only successfully flushed photos from the pending buffer.
    if (succeeded.length > 0) {
      const succeededSet = new Set(succeeded);
      pendingRef.current = pendingRef.current.filter(p => !succeededSet.has(p));
    }

    const finalUrls = photoUrls.map(u => objToReal.get(u) ?? u);
    setPhotoUrls(finalUrls);
    return finalUrls;
  }, [photoUrls]);

  /**
   * Capture a container/seal photo FOR A SPECIFIC ROW. Runs OCR immediately so
   * the recognized number can fill that row right away. Persists + links the
   * photo to the container ONLY when both `tripId` and `containerId` are known
   * (edit mode, row already saved); otherwise buffers the file in RAM
   * (`pending: true`) for flush after `saveContainers` assigns an id.
   *
   * Deliberately does NOT broadcast via `onOcrResult` — row-scoped capture
   * fills only the originating row, not the first empty slot (side-panel
   * trip-level OCR still uses `uploadPhotos` for that).
   *
   * We avoid sending `trip_id` alone: `/ocr` would persist the photo at trip
   * level with no container link, creating an orphan we can't re-link after the
   * row is saved. Buffering instead keeps it in RAM until linkable.
   */
  const uploadContainerPhoto = useCallback(async (
    file: File,
    tripId: number | undefined,
    rowKey: string,
    type: 'CONTAINER' | 'SEAL',
    containerId?: number,
  ): Promise<ContainerPhotoUploadResult> => {
    const canLink = !!tripId && !!containerId;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    if (canLink) {
      formData.append('trip_id', String(tripId));
      formData.append('container_id', String(containerId));
    }
    // Capture NEEDS the recognition result to fill the row, so it stays on the
    // full `/ocr` endpoint. Flush (`flushPendingContainerPhotos`) uses
    // `/ocr/persist-only` instead — it already has the number and only persists.
    const retryFingerprint = buildPhotoRetryFingerprint(
      'trip-form-row-ocr',
      file,
      [type, tripId ?? 'unsaved-trip', rowKey, containerId ?? 'pending'],
    );
    const result = await api.upload('/ocr', formData, { retryFingerprint }) as OcrResponse;
    if (result.photoUrl) {
      return { url: result.photoUrl, ocrResult: result, pending: false };
    }
    const objectUrl = URL.createObjectURL(file);
    pendingContainerPhotosRef.current.push({ rowKey, type, file, objectUrl });
    return { url: objectUrl, ocrResult: result, pending: true };
  }, []);

  /**
   * After `saveContainers` assigns ids, persist + link the buffered per-container
   * photos and return a map of `blob:` → server URL so the caller can patch
   * `photoKeys`. Rows deleted before save are dropped (object URL revoked).
   *
   * Uses `/ocr/persist-only` (NOT `/ocr`): recognition already ran at capture
   * (`uploadContainerPhoto`), so flushing via the full `/ocr` endpoint would
   * re-run OCR for nothing. `/persist-only` persists + links the photo and
   * SKIPS recognition. The consumed response shape is unchanged (`result.photoUrl`).
   */
  const flushPendingContainerPhotos = useCallback(async (
    tripId: number,
    rowKeyToContainerId: Map<string, number>,
  ): Promise<Map<string, string>> => {
    const pending = pendingContainerPhotosRef.current;
    if (pending.length === 0) return new Map();

    const swaps = new Map<string, string>();
    const succeeded: PendingContainerPhoto[] = [];
    for (const p of pending) {
      const containerId = rowKeyToContainerId.get(p.rowKey);
      if (!containerId) {
        // Row deleted before save — drop this buffered photo.
        URL.revokeObjectURL(p.objectUrl);
        succeeded.push(p);
        continue;
      }
      const formData = new FormData();
      formData.append('file', p.file);
      formData.append('type', p.type);
      formData.append('trip_id', String(tripId));
      formData.append('container_id', String(containerId));
      const retryFingerprint = buildPhotoRetryFingerprint(
        'trip-form-row-persist',
        p.file,
        [p.type, tripId, p.rowKey, containerId, p.objectUrl],
      );
      try {
        const result = await api.upload('/ocr/persist-only', formData, { retryFingerprint }) as OcrResponse;
        if (result.photoUrl) {
          swaps.set(p.objectUrl, result.photoUrl);
          succeeded.push(p);
          // Server confirmed — safe to release blob URL.
          URL.revokeObjectURL(p.objectUrl);
        }
        // Missing photoUrl: keep in pending buffer for retry.
      } catch {
        // Upload failed: keep in pending buffer for retry.
      }
    }

    // Remove only successfully flushed photos from the pending buffer.
    if (succeeded.length > 0) {
      const succeededSet = new Set(succeeded);
      pendingContainerPhotosRef.current = pendingContainerPhotosRef.current.filter(p => !succeededSet.has(p));
    }

    return swaps;
  }, []);

  /** Revoke + drop all buffered photos for a row (row deleted before save). */
  const revokeRowPhotos = useCallback((rowKey: string) => {
    const keep: PendingContainerPhoto[] = [];
    for (const p of pendingContainerPhotosRef.current) {
      if (p.rowKey === rowKey) URL.revokeObjectURL(p.objectUrl);
      else keep.push(p);
    }
    pendingContainerPhotosRef.current = keep;
  }, []);

  /** Revoke + drop one buffered per-container photo before the row is saved. */
  const revokeContainerPhoto = useCallback((rowKey: string, type: 'CONTAINER' | 'SEAL', objectUrl: string) => {
    if (!objectUrl.startsWith('blob:')) return;
    const keep: PendingContainerPhoto[] = [];
    for (const p of pendingContainerPhotosRef.current) {
      if (p.rowKey === rowKey && p.type === type && p.objectUrl === objectUrl) {
        URL.revokeObjectURL(p.objectUrl);
      } else {
        keep.push(p);
      }
    }
    pendingContainerPhotosRef.current = keep;
  }, []);

  return {
    photoUrls, setPhotoUrls, uploading, uploadPhotos, removePhoto, flushPendingPhotos,
    uploadContainerPhoto, flushPendingContainerPhotos, revokeRowPhotos, revokeContainerPhoto,
  };
}
