import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  History,
  Loader2,
  Lock,
  Repeat,
  Trash2,
  Upload,
} from 'lucide-react';
import { TripPodFileType, TripPodStatus, TRIP_POD_FILE_LABELS } from '@tingting/shared';
import type { DriverTaskPodFileRevision, DriverTaskPodFile, DriverTaskPodSubmission } from '../../api/driverClient';
import { formatDateTime } from '../../features/driver/driver-trip-model';
import { stripInternalCodeFromFileName } from '../../lib/internalCode';
import { compressImageFile } from '../../lib/imageCompression';
import { requiredPodFileTypes } from '../../lib/podReadiness';
import { usePodUpload } from './usePodUpload';
import { PodPendingFile } from './PodPendingFile';
import { PhotoViewer } from '../PhotoViewer';
import { driverClient } from '../../api/driverClient';
import { actionErrorMessage } from '../../lib/api/action-error';
import { ContainerScanner, dataUrlToFile } from '../shared/ContainerScanner';
import './TripPodSubmission.css';

export interface TripPodSubmissionProps {
  documentNumber?: string | null;
  tripVersion: number;
  /** Lot cargo mode (KB §3.5.2, SIL-918): an LCL trip renders the LCL
   *  evidence set — the biên bản giao nhận card alone; the FCL "Phiếu bãi /
   *  phiếu hạ" card does not apply to hàng lẻ. Absent/unknown = FCL set. */
  cargoMode?: string | null;
  currentSubmission: DriverTaskPodSubmission | null;
  history: DriverTaskPodSubmission[];
  creatingDraft: boolean;
  uploading: boolean;
  disabled?: boolean;
  readOnlyReason?: string | null;
  onBusyChange?: (busy: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
  onEnsureDraft: () => Promise<DriverTaskPodSubmission>;
  onUploadFile: (submission: DriverTaskPodSubmission, fileType: TripPodFileType, file: File) => Promise<void>;
  // Optional so a caller that has not wired removal simply shows no remove
  // button rather than a dead control. The single page caller does wire it.
  onRemoveFile?: (submission: DriverTaskPodSubmission, fileId: number) => Promise<void>;
  // SIL-1086 (K2.57) — replace one file of a SAVED (submitted/accepted)
  // submission. Present = the slot shows a per-file "Thay thế" control; the
  // server keeps the old version in the replacement history. The page only
  // wires it while the lot is not accounting-locked and the trip is not
  // canceled, so a refused context shows no dead control either.
  onReplaceFile?: (submission: DriverTaskPodSubmission, fileId: number, file: File) => Promise<void>;
}

const FILE_TYPE_HELP: Record<string, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Chụp rõ số phiếu và dấu xác nhận bãi hoặc điểm hạ.',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Nên có đầy đủ chữ ký giao nhận.',
};

// Driver submission completes directly; legacy review states remain readable
// without presenting customer approval as a required step.
const STATUS_LABELS: Record<TripPodStatus, string> = {
  [TripPodStatus.DRAFT]: 'Chưa gửi',
  [TripPodStatus.SUBMITTED]: 'Đã gửi chứng từ',
  [TripPodStatus.ACCEPTED]: 'Đã lưu chứng từ',
  [TripPodStatus.REJECTED]: 'Cần bổ sung chứng từ',
};

function statusClass(status: TripPodStatus): string {
  switch (status) {
    case TripPodStatus.ACCEPTED:
      return 'trip-pod__status trip-pod__status--accepted';
    case TripPodStatus.REJECTED:
      return 'trip-pod__status trip-pod__status--rejected';
    case TripPodStatus.SUBMITTED:
      return 'trip-pod__status trip-pod__status--submitted';
    default:
      return 'trip-pod__status trip-pod__status--draft';
  }
}

function groupFilesByType(submission: DriverTaskPodSubmission | null): Record<string, DriverTaskPodFile[]> {
  const empty: Record<string, DriverTaskPodFile[]> = {
    [TripPodFileType.YARD_OR_DROP_RECEIPT]: [],
    [TripPodFileType.SIGNED_DELIVERY_NOTE]: [],
  };
  if (!submission) return empty;
  for (const file of submission.files ?? []) {
    if (empty[file.fileType]) empty[file.fileType].push(file);
  }
  return empty;
}

function triggerInput(ref: React.RefObject<HTMLInputElement | null>) {
  ref.current?.click();
}

export function TripPodSubmission({
  documentNumber,
  cargoMode,
  currentSubmission,
  history,
  creatingDraft,
  uploading,
  disabled = false,
  readOnlyReason,
  onBusyChange,
  onPendingChange,
  onEnsureDraft,
  onUploadFile,
  onRemoveFile,
  onReplaceFile,
}: TripPodSubmissionProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [removingFileId, setRemovingFileId] = useState<number | null>(null);
  // SIL-1086 — the file id whose "Thay thế" opened the slot input (saved
  // submissions have no upload buttons, so the input only opens through a
  // per-file replace tap), the in-flight flag, and the expanded history slot.
  const [pendingReplaceFileId, setPendingReplaceFileId] = useState<number | null>(null);
  const [replacingBusy, setReplacingBusy] = useState(false);
  const [historySlot, setHistorySlot] = useState<TripPodFileType | null>(null);
  const [openingRevisionId, setOpeningRevisionId] = useState<number | null>(null);
  // Ticket 36d0183d thumbnails, but for history revisions: fetched lazily
  // while the history panel is open; images open the same fullscreen viewer.
  const [revisionThumbUrls, setRevisionThumbUrls] = useState<Record<number, string>>({});
  const [revisionViewerUrl, setRevisionViewerUrl] = useState<string | null>(null);
  const fetchedRevisionIdsRef = useRef<Set<number>>(new Set());
  // Which required slot the fullscreen scanner captures for (live-camera overlay with torch + gallery, not a bare <input capture>).
  const [scanning, setScanning] = useState<TripPodFileType | null>(null);

  // Ticket 36d0183d: uploaded e-POD images (authenticated blob fetch) render as
  // tappable thumbnails opening the fullscreen viewer; PDFs keep the meta row.
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const createdUrlsRef = useRef<string[]>([]);
  const fetchedIdsRef = useRef<Set<number>>(new Set());

  const imageFiles = useMemo(
    () => (currentSubmission?.files ?? []).filter((file) => (file.mimeType ?? '').startsWith('image/')),
    [currentSubmission],
  );
  const viewableImages = imageFiles.filter((file) => Boolean(thumbUrls[file.id]));

  // SIL-1086 — replacement history grouped per evidence type. Empty until the
  // first replace happens; the "Lịch sử thay thế" link on a saved file opens
  // the panel (K2.57: a saved file carries a replace control AND a history
  // link — who replaced, when, old file still viewable).
  const fileRevisions = useMemo(
    () => currentSubmission?.fileRevisions ?? [],
    [currentSubmission],
  );
  const revisionsByType = useMemo(() => {
    const grouped: Partial<Record<TripPodFileType, DriverTaskPodFileRevision[]>> = {};
    for (const revision of fileRevisions) {
      const existing = grouped[revision.fileType] ?? [];
      existing.push(revision);
      grouped[revision.fileType] = existing;
    }
    return grouped;
  }, [fileRevisions]);

  useEffect(() => () => {
    createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const fulfillmentId = currentSubmission?.fulfillmentId;
    if (!fulfillmentId) return;
    let cancelled = false;
    // Marker Set read once: it is mutated in place, never reassigned, so the
    // cleanup below closes over this same object.
    const fetchedIds = fetchedIdsRef.current;
    const pendingIds = new Set<number>();
    for (const file of imageFiles) {
      if (fetchedIds.has(file.id)) continue;
      fetchedIds.add(file.id);
      pendingIds.add(file.id);
      driverClient.downloadPodFile(fulfillmentId, file.id)
        .then((blob) => {
          if (cancelled) return;
          pendingIds.delete(file.id);
          const url = URL.createObjectURL(blob);
          createdUrlsRef.current.push(url);
          setThumbUrls((prev) => ({ ...prev, [file.id]: url }));
        })
        .catch(() => {
          if (cancelled) return;
          pendingIds.delete(file.id);
          fetchedIds.delete(file.id);
        });
    }
    return () => {
      cancelled = true;
      // Release canceled requests before the replacement effect starts. A late
      // response must not clear markers owned by the replacement request.
      pendingIds.forEach((id) => fetchedIds.delete(id));
    };
  }, [currentSubmission, imageFiles]);

  // History thumbnails load only while a slot's history panel is open — the
  // replaced-out images are rarely revisited, so they never ride the initial
  // detail fetch. PDFs keep the meta+download row like current files do.
  useEffect(() => {
    if (!historySlot) return;
    const fulfillmentId = currentSubmission?.fulfillmentId;
    if (!fulfillmentId) return;
    let cancelled = false;
    // Marker Set mutated in place, mirroring fetchedIdsRef above.
    const fetched = fetchedRevisionIdsRef.current;
    for (const revision of revisionsByType[historySlot] ?? []) {
      if (!(revision.mimeType ?? '').startsWith('image/')) continue;
      if (fetched.has(revision.id)) continue;
      fetched.add(revision.id);
      driverClient.downloadPodRevision(fulfillmentId, revision.id)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          createdUrlsRef.current.push(url);
          setRevisionThumbUrls((prev) => ({ ...prev, [revision.id]: url }));
        })
        .catch(() => {
          if (!cancelled) fetched.delete(revision.id);
        });
    }
    return () => { cancelled = true; };
  }, [historySlot, revisionsByType, currentSubmission]);

  const fileRefs: Record<string, React.RefObject<HTMLInputElement | null>> = {
    [TripPodFileType.YARD_OR_DROP_RECEIPT]: useRef<HTMLInputElement | null>(null),
    [TripPodFileType.SIGNED_DELIVERY_NOTE]: useRef<HTMLInputElement | null>(null),
  };

  const groupedFiles = useMemo(() => groupFilesByType(currentSubmission), [currentSubmission]);
  // Preserve recorded versions; only a draft or permitted correction accepts files.
  const isLocked = currentSubmission?.status === TripPodStatus.SUBMITTED
    || currentSubmission?.status === TripPodStatus.ACCEPTED
    || Boolean(readOnlyReason);
  const { processing, uploadPodFile, pendingFiles, retryUpload, discardUpload } = usePodUpload({
    currentSubmission, blocked: uploading || creatingDraft || disabled || isLocked,
    onEnsureDraft, onUploadFile, onBusyChange, onError: setUploadError,
  });
  const hasPendingFiles = Object.keys(pendingFiles).length > 0;
  useEffect(() => { onPendingChange?.(hasPendingFiles); }, [hasPendingFiles, onPendingChange]);
  const busy = processing || uploading || creatingDraft;
  // SIL-918 (KB §3.5.2): the trip's OWN evidence set — LCL drops the FCL
  // "phiếu bãi / phiếu hạ" card entirely; the counters and the foot read
  // the same filtered list so nothing double-counts.
  const requiredTypes = requiredPodFileTypes(cargoMode);
  // The foot's claim reads the API's own verdict when the wire carries it
  // (the server computes the same mode-aware set); without the field it
  // recomputes from the mode's required set. The 100% / "Đủ …" claim can
  // then never disagree with what the API reports as missing.
  const missingRequired = currentSubmission?.missingRequiredFileTypes
    ?? requiredTypes.filter((fileType) => groupedFiles[fileType].length === 0);
  const latestHistory = history.filter((submission) => submission.id !== currentSubmission?.id);
  // Card 071026212500: take back a photo from the driver's own draft. The server
  // refuses this once submitted, so the affordance is draft-only and the two
  // agree rather than the UI hiding a rule the API enforces separately.
  async function handleRemoveFile(fileId: number) {
    if (!currentSubmission || removingFileId != null || !onRemoveFile) return;
    const fulfillmentId = currentSubmission.fulfillmentId;
    if (fulfillmentId == null) {
      setUploadError('Chưa thể gỡ chứng từ của lệnh này. Vui lòng liên hệ điều vận.');
      return;
    }
    setRemovingFileId(fileId);
    setUploadError(null);
    try {
      await onRemoveFile(currentSubmission, fileId);
    } catch (error) {
      // SIL-1035 — a raw fetch TypeError surfaces as the offline sentence,
      // never engine English; server refusals stay verbatim.
      const message = actionErrorMessage('gỡ chứng từ', error, 'Không thể gỡ chứng từ. Vui lòng thử lại.');
      if (message !== null) setUploadError(message);
    } finally {
      setRemovingFileId(null);
    }
  }

  /** SIL-1086 — "Thay thế" on a saved file: arm the slot input for that file. */
  function requestReplaceFile(fileType: TripPodFileType, fileId: number) {
    if (busy || disabled || replacingBusy) return;
    setPendingReplaceFileId(fileId);
    triggerInput(fileRefs[fileType]);
  }

  async function replaceFile(fileId: number, file: File) {
    if (!currentSubmission || !onReplaceFile) return;
    const fulfillmentId = currentSubmission.fulfillmentId;
    if (fulfillmentId == null) {
      setUploadError('Chưa thể thay thế chứng từ của lệnh này. Vui lòng liên hệ điều vận.');
      return;
    }
    setReplacingBusy(true);
    setUploadError(null);
    try {
      // Same client-side compression the draft upload path applies (PDFs pass
      // through unchanged), so a replaced photo costs the same mobile bytes.
      const prepared = await compressImageFile(file);
      await onReplaceFile(currentSubmission, fileId, prepared);
    } catch (error) {
      // SIL-1035 — same offline mapping as the sibling file actions.
      const message = actionErrorMessage('thay thế chứng từ', error, 'Không thể thay thế chứng từ. Vui lòng thử lại.');
      if (message !== null) setUploadError(message);
    } finally {
      setReplacingBusy(false);
      setPendingReplaceFileId(null);
    }
  }

  /** SIL-1086 — open one history revision: images fullscreen, PDFs download. */
  async function openRevision(revision: DriverTaskPodFileRevision) {
    if (!currentSubmission || openingRevisionId != null) return;
    const fulfillmentId = currentSubmission.fulfillmentId;
    if (fulfillmentId == null) {
      setUploadError('Chưa thể mở tệp lịch sử của lệnh này. Vui lòng liên hệ điều vận.');
      return;
    }
    setOpeningRevisionId(revision.id);
    setUploadError(null);
    try {
      const blob = await driverClient.downloadPodRevision(fulfillmentId, revision.id);
      const url = URL.createObjectURL(blob);
      createdUrlsRef.current.push(url);
      if ((revision.mimeType ?? '').startsWith('image/')) {
        setRevisionThumbUrls((prev) => ({ ...prev, [revision.id]: url }));
        setRevisionViewerUrl(url);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = stripInternalCodeFromFileName(revision.originalFileName)
          ?? `${revision.fileType.toLowerCase()}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (error) {
      const message = actionErrorMessage('mở tệp lịch sử', error, 'Không thể mở tệp lịch sử. Vui lòng thử lại.');
      if (message !== null) setUploadError(message);
    } finally {
      setOpeningRevisionId(null);
    }
  }

  async function downloadFile(file: DriverTaskPodFile) {
    if (!currentSubmission || downloadingId != null) return;
    const fulfillmentId = currentSubmission.fulfillmentId;
    if (fulfillmentId == null) {
      setUploadError('Chưa thể tải chứng từ của lệnh này. Vui lòng liên hệ điều vận.');
      return;
    }
    setDownloadingId(file.id);
    setUploadError(null);
    try {
      const blob = await driverClient.downloadPodFile(fulfillmentId, file.id);
      const url = URL.createObjectURL(blob);
      createdUrlsRef.current.push(url);
      const link = document.createElement('a');
      link.href = url;
      // The saved file name is driver-visible too — it must not carry the
      // internal code (card 261022201006c). The stored file is untouched.
      link.download = stripInternalCodeFromFileName(file.originalFileName)
        ?? `${file.fileType.toLowerCase()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      // SIL-1035 — same offline mapping on the download path.
      const message = actionErrorMessage('tải chứng từ', error, 'Không thể tải chứng từ. Vui lòng thử lại.');
      if (message !== null) setUploadError(message);
    } finally {
      setDownloadingId(null);
    }
  }
  async function handlePick(fileType: TripPodFileType, fileList: FileList | null) {
    if (!fileList?.[0]) return;
    const file = fileList[0];
    // SIL-1086 — a locked (saved) slot has no upload buttons; its input opens
    // only through a per-file "Thay thế" tap, which pre-arms the file id.
    if (isLocked) {
      const fileId = pendingReplaceFileId;
      setPendingReplaceFileId(null);
      if (fileId == null || !currentSubmission || !onReplaceFile) return;
      try {
        await replaceFile(fileId, file);
      } finally {
        // Same reset send() applies: re-picking the same file must re-fire.
        const input = fileRefs[fileType].current;
        if (input) input.value = '';
      }
      return;
    }
    await uploadPodFile(fileType, file, fileRefs[fileType].current);
  }

  /** Scanner path: the overlay hands back a JPEG data URL, convert + upload. */
  async function handleScanCapture(fileType: TripPodFileType, dataUrl: string, capturedAt?: Date) {
    await uploadPodFile(fileType, dataUrlToFile(dataUrl, `pod-${fileType.toLowerCase()}.jpg`), null, capturedAt);
  }

  const uploadProgressPercent = Math.round(
    ((requiredTypes.length - missingRequired.length) / requiredTypes.length) * 100,
  );

  return (
    <section className="trip-pod">
      <div className="trip-pod__head">
        <div>
          {/* Card 261022213755a (owner ruling 22/10): e-POD photos are
              OPTIONAL — the title names the section without the retired
              "bắt buộc" claim. */}
          <h2 className="trip-pod__title">Chứng từ giao hàng</h2>
          <p className="trip-pod__subtitle">{documentNumber?.trim() || 'Chưa có số Bill/Booking'}</p>
        </div>
        {currentSubmission && currentSubmission.status !== TripPodStatus.DRAFT && (
          <span className={statusClass(currentSubmission.status)}>
            {STATUS_LABELS[currentSubmission.status]}
          </span>
        )}
      </div>

      {currentSubmission?.status === TripPodStatus.REJECTED && currentSubmission.rejectionReason && (
        <div className="trip-pod__banner trip-pod__banner--warn" role="alert">
          <AlertTriangle size={16} />
          <span>
            Nội dung cần bổ sung: {currentSubmission.rejectionReason}
          </span>
        </div>
      )}

      {isLocked && (
        <div className="trip-pod__banner trip-pod__banner--info" role="status">
          <Lock size={16} />
          <span>{readOnlyReason || 'Chứng từ đã gửi. Bạn có thể xem ảnh hoặc tải lại tệp bên dưới.'}</span>
        </div>
      )}

      {uploadError && (
        <div className="trip-pod__banner trip-pod__banner--error" role="alert">
          <AlertTriangle size={16} />
          <span>{uploadError}</span>
        </div>
      )}

      <div
        className={`trip-pod__grid${requiredTypes.length === 1 ? ' trip-pod__grid--single' : ''}`}
        data-editable={!isLocked}
        data-required-types={requiredTypes.length}
      >
        {requiredTypes.map((fileType) => {
          const files = groupedFiles[fileType];
          // SIL-1073 (K3.104, Layer 1) — a slot holding ONLY an unreadable
          // file is in the KB state "Chưa đọc được", not "Chưa có": the
          // evidence exists, the system just cannot process it.
          const slotUnreadable = files.length === 0 && pendingFiles[fileType]?.unreadable === true;
          return (
            <article key={fileType} className="trip-pod__card">
              <div className="trip-pod__card-head">
                <div>
                  <h3 className="trip-pod__card-title">
                    {/* The label is its own wrapping element: a long title
                        wraps INSIDE this span on the badge's line — the pink
                        "Tùy chọn" badge never drops alone onto a second line
                        under the title. */}
                    <span className="trip-pod__card-title-text">{TRIP_POD_FILE_LABELS[fileType]}</span>
                    <span className="trip-pod__required">Tùy chọn</span>
                  </h3>
                  <p className="trip-pod__card-help">{FILE_TYPE_HELP[fileType]}</p>
                </div>
                <div className="trip-pod__state">
                  {files.length > 0 ? (
                    // SIL-1073 — the state chip must NAME the KB state
                    // "Đã lưu" (QA: "1 tệp" alone never says the file was
                    // saved); the count keeps its own single text node
                    // (card 071026212510 count+unit law).
                    <span className="trip-pod__state-ok"><CheckCircle2 size={15} /><span className="trip-pod__state-label">Đã lưu</span><span className="trip-pod__state-count">{`${files.length} tệp`}</span></span>
                  ) : slotUnreadable ? (
                    <span className="trip-pod__state-unreadable">Chưa đọc được</span>
                  ) : (
                    <span className="trip-pod__state-missing">Chưa có</span>
                  )}
                </div>
              </div>

              {!isLocked && (
                <div className="trip-pod__actions">
                  <button
                    type="button"
                    className="trip-pod__action"
                    onClick={() => setScanning(fileType)}
                    disabled={busy || disabled}
                  >
                    {busy ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
                    <span>Chụp</span>
                  </button>
                  <button
                    type="button"
                    className="trip-pod__action trip-pod__action--secondary"
                    onClick={() => triggerInput(fileRefs[fileType])}
                    disabled={busy || disabled}
                  >
                    <Upload size={16} />
                    <span>Tải tệp</span>
                  </button>
                </div>
              )}

              {/* Always mounted: a locked (saved) slot has no upload buttons,
                  so its input opens only through the per-file "Thay thế"
                  control (SIL-1086). */}
              <input
                ref={fileRefs[fileType]}
                className="trip-pod__input"
                type="file"
                accept="image/*,application/pdf"
                disabled={busy || disabled || replacingBusy}
                onChange={(event) => void handlePick(fileType, event.target.files)}
              />

              {pendingFiles[fileType] && !processing && (
                <PodPendingFile
                  name={pendingFiles[fileType].file.name}
                  busy={busy}
                  readOnly={disabled || isLocked}
                  unreadable={pendingFiles[fileType]?.unreadable === true}
                  onRetry={() => void retryUpload(fileType)}
                  onDiscard={() => discardUpload(fileType)}
                />
              )}

              {files.length > 0 ? (
                <ul className="trip-pod__file-list">
                  {files.map((file) => {
                    const isImage = (file.mimeType ?? '').startsWith('image/');
                    const thumb = thumbUrls[file.id];
                    // PRD ruling (card 261022201006c): the app lái xe never shows
                    // a raw internal code. A stored file name may carry one
                    // (the seeded e-POD shape is "<tripCode>-<FILE_TYPE>.pdf"),
                    // so the driver-facing NAME drops that leading code and
                    // keeps the document part. The stored file is untouched.
                    const displayName = stripInternalCodeFromFileName(file.originalFileName)
                      ?? TRIP_POD_FILE_LABELS[file.fileType as TripPodFileType]
                      ?? 'Chứng từ';
                    // Card 071026212500: a draft is the driver's own editable
                    // work, so the file can be taken back. `isLocked` is exactly
                    // the submitted case the server refuses — same rule the
                    // upload path already follows.
                    const removeButton = !isLocked && !disabled && onRemoveFile ? (
                      <button
                        type="button"
                        className="trip-pod__file-remove"
                        onClick={() => void handleRemoveFile(file.id)}
                        disabled={removingFileId != null}
                        aria-label={`Xóa chứng từ ${displayName}`}
                      >
                        {removingFileId === file.id
                          ? <Loader2 size={15} className="spin" />
                          : <Trash2 size={15} />}
                      </button>
                    ) : null;
                    // SIL-1086 (K2.57) — a SAVED file carries the replace
                    // control; the old version stays viewable in the history.
                    const replaceButton = isLocked && onReplaceFile && !disabled ? (
                      <button
                        type="button"
                        className="trip-pod__file-replace"
                        onClick={() => requestReplaceFile(file.fileType, file.id)}
                        disabled={replacingBusy || downloadingId != null}
                        aria-label={`Thay thế ${displayName}`}
                      >
                        {pendingReplaceFileId === file.id && replacingBusy
                          ? <Loader2 size={15} className="spin" />
                          : <Repeat size={15} />}
                      </button>
                    ) : null;
                    if (isImage && thumb) {
                      const fileIndex = viewableImages.findIndex((item) => item.id === file.id);
                      return (
                        <li key={file.id} className="trip-pod__file">
                          <button
                            type="button"
                            className="trip-pod__file-thumb"
                            onClick={() => setViewerIndex(fileIndex)}
                          >
                            <img src={thumb} alt={displayName} />
                          </button>
                          <span className="trip-pod__file-time">Tải lên {formatDateTime(file.createdAt)}</span>
                          {removeButton}
                          {replaceButton}
                        </li>
                      );
                    }
                    return (
                      <li key={file.id} className="trip-pod__file">
                        <button type="button" className="trip-pod__file-meta trip-pod__file-download" onClick={() => void downloadFile(file)} disabled={downloadingId != null} aria-label={`Tải chứng từ ${displayName}`}>
                          {(file.mimeType ?? '').startsWith('image/') ? <FileImage size={15} /> : <FileText size={15} />}
                          <span className="trip-pod__file-name">{displayName}</span>
                          {downloadingId === file.id ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                        </button>
                        <span className="trip-pod__file-time">Tải lên {formatDateTime(file.createdAt)}</span>
                        {removeButton}
                        {replaceButton}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="trip-pod__empty">Chưa có tệp nào cho mục này.</p>
              )}

              {/* SIL-1086 (K2.57) — a SAVED file always carries the history
                  link, even before the first replacement (the panel then says
                  so in one sentence instead of hiding the affordance).
                  Toggle + panel live in ONE own-row flex wrapper: the saved
                  card spans three subgrid rows (head / files / history), and
                  bare siblings past that range landed in overlapping implicit
                  rows — the "Lịch sử thay thế" link painted over the saved
                  file name. */}
              {(isLocked && onReplaceFile && !disabled && files.length > 0) && (
                <div className="trip-pod__replace-history">
                  <button
                    type="button"
                    className="trip-pod__history-toggle"
                    onClick={() => setHistorySlot(historySlot === fileType ? null : fileType)}
                    aria-expanded={historySlot === fileType}
                  >
                    <History size={14} />
                    <span>
                      {`Lịch sử thay thế${(revisionsByType[fileType]?.length ?? 0) > 0 ? ` (${revisionsByType[fileType]!.length})` : ''}`}
                    </span>
                  </button>

                  {historySlot === fileType && (
                    <div className="trip-pod__revisions">
                      {(revisionsByType[fileType]?.length ?? 0) === 0 ? (
                        <p className="trip-pod__revisions-empty">Chưa có lần thay thế nào.</p>
                      ) : (
                        <ul className="trip-pod__revisions-list">
                          {(revisionsByType[fileType] ?? []).map((revision) => {
                            // Same driver-facing name law as current files: the
                            // internal code never reaches the driver's screen.
                            const revisionName = stripInternalCodeFromFileName(revision.originalFileName)
                              ?? revision.label
                              ?? 'Chứng từ';
                            const isImage = (revision.mimeType ?? '').startsWith('image/');
                            const thumb = revisionThumbUrls[revision.id];
                            return (
                              <li key={revision.id} className="trip-pod__revision">
                                {isImage && thumb && (
                                  <button
                                    type="button"
                                    className="trip-pod__file-thumb"
                                    onClick={() => setRevisionViewerUrl(thumb)}
                                  >
                                    <img src={thumb} alt={revisionName} />
                                  </button>
                                )}
                                <div className="trip-pod__revision-body">
                                  <strong className="trip-pod__file-name">{revisionName}</strong>
                                  <span>
                                    {`Tải lên ${formatDateTime(revision.uploadedAt)}${revision.uploadedByName ? ` · ${revision.uploadedByName}` : ''}`}
                                  </span>
                                  <span>
                                    {`Thay thế ${formatDateTime(revision.replacedAt)}${revision.replacedByName ? ` · bởi ${revision.replacedByName}` : ''}`}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="trip-pod__revision-open"
                                  onClick={() => void openRevision(revision)}
                                  disabled={openingRevisionId != null}
                                  aria-label={`${isImage ? 'Xem' : 'Tải'} ${revisionName}`}
                                >
                                  {openingRevisionId === revision.id
                                    ? <Loader2 size={15} className="spin" />
                                    : isImage ? <FileImage size={15} /> : <FileText size={15} />}
                                  <span>{isImage ? 'Xem' : 'Tải'}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="trip-pod__foot">
        <div className="trip-pod__readiness">
          <strong>
            Tiến độ chứng từ
            <span className="trip-pod__progress-pct">{uploadProgressPercent}%</span>
          </strong>
          {/* SIL-697 resolved: the progress bar tracks the two evidence
              file types — informational only, never a completion gate. */}
          <div
            className="trip-pod__progress"
            role="progressbar"
            aria-label="Tiến độ chứng từ e-POD"
            aria-valuenow={uploadProgressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`trip-pod__progress-fill${uploadProgressPercent === 100 ? ' is-complete' : ''}`}
              style={{ width: `${uploadProgressPercent}%` }}
            />
          </div>
          {missingRequired.length === 0 ? (
            <span>
              {requiredTypes.length === 1
                ? (isLocked ? 'Đã lưu đủ chứng từ.' : 'Đủ chứng từ.')
                : (isLocked ? 'Đã lưu đủ hai loại chứng từ.' : 'Đủ hai loại chứng từ.')}
            </span>
          ) : (
            <span>
              {/* Locked (nộp/duyệt rồi) forms can never accept the missing
                  files — state the fact without the bổ-sung call to action. */}
              {isLocked
                ? `Thiếu ${missingRequired.length} file e-POD.`
                : `Thiếu ${missingRequired.length} file e-POD — nên bổ sung.`}
            </span>
          )}
        </div>
      </div>

      {latestHistory.length > 0 && (
        <div className="trip-pod__history">
          <p className="trip-pod__history-title">Lịch sử chứng từ</p>
          <ul className="trip-pod__history-list">
            {latestHistory.map((submission) => (
              <li key={submission.id} className="trip-pod__history-item">
                <div>
                  <strong>Lần gửi {submission.submissionVersion}</strong>
                  <span>{STATUS_LABELS[submission.status]}</span>
                </div>
                <span>{formatDateTime(submission.submittedAt ?? submission.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewerIndex != null && viewableImages[viewerIndex] && (
        <PhotoViewer
          urls={viewableImages.map((item) => thumbUrls[item.id])}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      {/* SIL-1086 — fullscreen view of one history revision's image. */}
      {revisionViewerUrl != null && (
        <PhotoViewer
          urls={[revisionViewerUrl]}
          onClose={() => setRevisionViewerUrl(null)}
        />
      )}

      {scanning && (
        <ContainerScanner
          onCapture={(dataUrl, capturedAt) => {
            const fileType = scanning;
            setScanning(null);
            void handleScanCapture(fileType, dataUrl, capturedAt);
          }}
          onClose={() => setScanning(null)}
        />
      )}
    </section>
  );
}

export default TripPodSubmission;
