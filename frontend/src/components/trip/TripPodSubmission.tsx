import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  Loader2,
  Lock,
  Upload,
} from 'lucide-react';
import { TRIP_POD_REQUIRED_FILE_TYPES, TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodFile, DriverTaskPodSubmission } from '../../api/driverClient';
import { formatDateTime } from '../../features/driver/driver-trip-model';
import { usePodUpload } from './usePodUpload';
import { PodPendingFile } from './PodPendingFile';
import { PhotoViewer } from '../PhotoViewer';
import { driverClient } from '../../api/driverClient';
import { ContainerScanner, dataUrlToFile } from '../shared/ContainerScanner';
import './TripPodSubmission.css';

export interface TripPodSubmissionProps {
  tripCode?: string | null;
  tripVersion: number;
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
}

const REQUIRED_FILE_TYPES = TRIP_POD_REQUIRED_FILE_TYPES;

const FILE_TYPE_LABELS: Record<string, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Phiếu bãi / phiếu hạ',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Biên bản giao nhận có ký nhận',
};

const FILE_TYPE_HELP: Record<string, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Bắt buộc. Chụp rõ số phiếu và dấu xác nhận bãi hoặc điểm hạ.',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Bắt buộc. Phải có chữ ký giao nhận đầy đủ.',
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
  tripCode,
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
}: TripPodSubmissionProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // Which required slot the fullscreen scanner is capturing for (vantaiphucloc
  // EPOD pattern: "Chụp" opens the live-camera overlay with torch + gallery,
  // not a bare <input capture> — camera-denied devices still get the picker).
  const [scanning, setScanning] = useState<TripPodFileType | null>(null);

  // Ticket 36d0183d: uploaded e-POD images render as tappable thumbnails
  // (authenticated blob fetch through the pod-files endpoint) that open the
  // fullscreen PhotoViewer; PDFs and not-yet-loaded files keep the meta row.
  const [thumbUrls, setThumbUrls] = useState<Record<number, string>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const createdUrlsRef = useRef<string[]>([]);
  const fetchedIdsRef = useRef<Set<number>>(new Set());

  const imageFiles = useMemo(
    () => (currentSubmission?.files ?? []).filter((file) => (file.mimeType ?? '').startsWith('image/')),
    [currentSubmission],
  );
  const viewableImages = imageFiles.filter((file) => Boolean(thumbUrls[file.id]));

  useEffect(() => () => {
    createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const fulfillmentId = currentSubmission?.fulfillmentId;
    if (!fulfillmentId) return;
    let cancelled = false;
    const pendingIds = new Set<number>();
    for (const file of imageFiles) {
      if (fetchedIdsRef.current.has(file.id)) continue;
      fetchedIdsRef.current.add(file.id);
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
          fetchedIdsRef.current.delete(file.id);
        });
    }
    return () => {
      cancelled = true;
      // Release canceled requests before the replacement effect starts. A late
      // response must not clear markers owned by the replacement request.
      pendingIds.forEach((id) => fetchedIdsRef.current.delete(id));
    };
  }, [currentSubmission, imageFiles]);

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
  const missingRequired = REQUIRED_FILE_TYPES.filter((fileType) => groupedFiles[fileType].length === 0);
  const latestHistory = history.filter((submission) => submission.id !== currentSubmission?.id);
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
      link.download = file.originalFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Không thể tải chứng từ. Vui lòng thử lại.');
    } finally {
      setDownloadingId(null);
    }
  }
  async function handlePick(fileType: TripPodFileType, fileList: FileList | null) {
    if (!fileList?.[0]) return;
    await uploadPodFile(fileType, fileList[0], fileRefs[fileType].current);
  }

  /** Scanner path: the overlay hands back a JPEG data URL, convert + upload. */
  async function handleScanCapture(fileType: TripPodFileType, dataUrl: string, capturedAt?: Date) {
    await uploadPodFile(fileType, dataUrlToFile(dataUrl, `pod-${fileType.toLowerCase()}.jpg`), null, capturedAt);
  }

  const uploadProgressPercent = Math.round(
    ((REQUIRED_FILE_TYPES.length - missingRequired.length) / REQUIRED_FILE_TYPES.length) * 100,
  );

  return (
    <section className="trip-pod">
      <div className="trip-pod__head">
        <div>
          <h2 className="trip-pod__title">Chứng từ bắt buộc</h2>
          {tripCode && <p className="trip-pod__subtitle">{tripCode}</p>}
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

      <div className="trip-pod__grid" data-editable={!isLocked}>
        {REQUIRED_FILE_TYPES.map((fileType) => {
          const files = groupedFiles[fileType];
          return (
            <article key={fileType} className="trip-pod__card">
              <div className="trip-pod__card-head">
                <div>
                  <h3 className="trip-pod__card-title">
                    {FILE_TYPE_LABELS[fileType]}
                    <span className="trip-pod__required">Bắt buộc</span>
                  </h3>
                  <p className="trip-pod__card-help">{FILE_TYPE_HELP[fileType]}</p>
                </div>
                <div className="trip-pod__state">
                  {files.length > 0 ? (
                    <span className="trip-pod__state-ok"><CheckCircle2 size={15} /> {files.length} tệp</span>
                  ) : (
                    <span className="trip-pod__state-missing">Thiếu</span>
                  )}
                </div>
              </div>

              {!isLocked && (
                <>
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

                  <input
                    ref={fileRefs[fileType]}
                    className="trip-pod__input"
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={busy || disabled}
                    onChange={(event) => void handlePick(fileType, event.target.files)}
                  />
                </>
              )}

              {pendingFiles[fileType] && !processing && (
                <PodPendingFile name={pendingFiles[fileType].file.name} busy={busy} readOnly={disabled || isLocked}
                  onRetry={() => void retryUpload(fileType)} onDiscard={() => discardUpload(fileType)} />
              )}

              {files.length > 0 ? (
                <ul className="trip-pod__file-list">
                  {files.map((file) => {
                    const isImage = (file.mimeType ?? '').startsWith('image/');
                    const thumb = thumbUrls[file.id];
                    if (isImage && thumb) {
                      const fileIndex = viewableImages.findIndex((item) => item.id === file.id);
                      return (
                        <li key={file.id} className="trip-pod__file">
                          <button
                            type="button"
                            className="trip-pod__file-thumb"
                            onClick={() => setViewerIndex(fileIndex)}
                          >
                            <img src={thumb} alt={file.originalFileName} />
                          </button>
                          <span className="trip-pod__file-time">Tải lên {formatDateTime(file.createdAt)}</span>
                        </li>
                      );
                    }
                    return (
                      <li key={file.id} className="trip-pod__file">
                        <button type="button" className="trip-pod__file-meta trip-pod__file-download" onClick={() => void downloadFile(file)} disabled={downloadingId != null} aria-label={`Tải chứng từ ${file.originalFileName}`}>
                          {(file.mimeType ?? '').startsWith('image/') ? <FileImage size={15} /> : <FileText size={15} />}
                          <span className="trip-pod__file-name" title={file.originalFileName}>{file.originalFileName}</span>
                          {downloadingId === file.id ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                        </button>
                        <span className="trip-pod__file-time">Tải lên {formatDateTime(file.createdAt)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="trip-pod__empty">Chưa có tệp nào cho mục này.</p>
              )}
            </article>
          );
        })}
      </div>

      <div className="trip-pod__foot">
        <div className="trip-pod__readiness">
          <strong>
            Điều kiện hoàn thành
            <span className="trip-pod__progress-pct">{uploadProgressPercent}%</span>
          </strong>
          {/* Spec (Phần 4): the literal "thanh tiến trình" — submit unlocks at 100%. */}
          <div
            className="trip-pod__progress"
            role="progressbar"
            aria-label="Tiến độ hồ sơ e-POD bắt buộc"
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
            <span>{isLocked ? 'Đã lưu đủ hai loại chứng từ.' : 'Đủ hai loại chứng từ để hoàn thành chuyến.'}</span>
          ) : (
            <span>
              Còn thiếu {missingRequired.map((fileType) => FILE_TYPE_LABELS[fileType]).join(', ')}.
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
