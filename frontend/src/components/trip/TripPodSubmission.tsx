import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileImage,
  FileText,
  Loader2,
  Lock,
  Upload,
} from 'lucide-react';
import { TRIP_POD_REQUIRED_FILE_TYPES, TRIP_POD_STATUS_LABELS, TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { DriverTaskPodFile, DriverTaskPodSubmission } from '../../api/driverClient';
import { formatDateTimeShort } from '../../lib/format';
import { compressImageFile } from '../../lib/imageCompression';
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

// Canonical labels live in shared (unified 2026-09-01): 'Chờ duyệt' / 'Đã duyệt'.
const STATUS_LABELS = TRIP_POD_STATUS_LABELS;

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

const formatDateTime = formatDateTimeShort;

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
  tripVersion,
  currentSubmission,
  history,
  creatingDraft,
  uploading,
  onEnsureDraft,
  onUploadFile,
}: TripPodSubmissionProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
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

  useEffect(() => {
    const fulfillmentId = currentSubmission?.fulfillmentId;
    if (!fulfillmentId) return;
    let cancelled = false;
    for (const file of imageFiles) {
      if (fetchedIdsRef.current.has(file.id)) continue;
      fetchedIdsRef.current.add(file.id);
      driverClient.downloadPodFile(fulfillmentId, file.id)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          createdUrlsRef.current.push(url);
          setThumbUrls((prev) => ({ ...prev, [file.id]: url }));
        })
        .catch(() => {
          fetchedIdsRef.current.delete(file.id);
        });
    }
    return () => { cancelled = true; };
  }, [currentSubmission, imageFiles]);

  const fileRefs: Record<string, React.RefObject<HTMLInputElement | null>> = {
    [TripPodFileType.YARD_OR_DROP_RECEIPT]: useRef<HTMLInputElement | null>(null),
    [TripPodFileType.SIGNED_DELIVERY_NOTE]: useRef<HTMLInputElement | null>(null),
  };

  const groupedFiles = useMemo(() => groupFilesByType(currentSubmission), [currentSubmission]);
  const editableSubmission = currentSubmission?.status === TripPodStatus.DRAFT ? currentSubmission : null;
  // SUBMITTED/ACCEPTED is locked: onEnsureDraft() would call
  // createPodSubmission, which the backend always rejects with 409 "Đã có một
  // e-POD đang mở cho tác vụ này." while an open version exists (see
  // trip-pod.service.ts). Without this the capture buttons stay clickable and
  // every retap dead-ends in that confusing error. REJECTED is intentionally
  // NOT locked — the backend allows opening a fresh draft on top of a
  // rejected submission, and locking it here would block that retry.
  const isLocked = currentSubmission?.status === TripPodStatus.SUBMITTED
    || currentSubmission?.status === TripPodStatus.ACCEPTED;
  const missingRequired = REQUIRED_FILE_TYPES.filter((fileType) => groupedFiles[fileType].length === 0);
  const latestHistory = history.filter((submission) => submission.id !== currentSubmission?.id);
  async function handlePick(fileType: TripPodFileType, fileList: FileList | null) {
    if (!fileList?.[0]) return;
    await uploadPodFile(fileType, fileList[0], fileRefs[fileType].current);
  }

  /** Scanner path: the overlay hands back a JPEG data URL, convert + upload. */
  async function handleScanCapture(fileType: TripPodFileType, dataUrl: string) {
    await uploadPodFile(fileType, dataUrlToFile(dataUrl, `pod-${fileType.toLowerCase()}.jpg`), null);
  }

  // Spec (Phần 4): e-POD photos are compressed on-device and carry the real
  // capture timestamp in the image file. PDFs pass through untouched.
  async function uploadPodFile(fileType: TripPodFileType, raw: File, input: HTMLInputElement | null) {
    const file = await compressImageFile(raw, { timestamp: new Date() });
    setUploadError(null);
    try {
      const submission = editableSubmission ?? await onEnsureDraft();
      await onUploadFile(submission, fileType, file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Không thể tải tệp e-POD.');
    } finally {
      if (input) input.value = '';
    }
  }

  const uploadProgressPercent = Math.round(
    ((REQUIRED_FILE_TYPES.length - missingRequired.length) / REQUIRED_FILE_TYPES.length) * 100,
  );
  const submissionHeadline = currentSubmission
    ? `Phiên bản ${currentSubmission.submissionVersion}`
    : 'Chưa có phiên bản e-POD';

  return (
    <section className="trip-pod">
      <div className="trip-pod__head">
        <div>
          <p className="trip-pod__eyebrow">e-POD bắt buộc</p>
          <h2 className="trip-pod__title">{submissionHeadline}</h2>
          <p className="trip-pod__subtitle">
            {tripCode || 'Chuyến chưa có mã'} · phiên bản chuyến {tripVersion}
          </p>
        </div>
        {currentSubmission && (
          <span className={statusClass(currentSubmission.status)}>
            {STATUS_LABELS[currentSubmission.status]}
          </span>
        )}
      </div>

      {currentSubmission?.status === TripPodStatus.REJECTED && currentSubmission.rejectionReason && (
        <div className="trip-pod__banner trip-pod__banner--warn" role="alert">
          <AlertTriangle size={16} />
          <span>
            Phiên bản gần nhất bị từ chối: {currentSubmission.rejectionReason}
          </span>
        </div>
      )}

      {isLocked && (
        <div className="trip-pod__banner trip-pod__banner--info" role="status">
          <Lock size={16} />
          <span>e-POD đã gửi duyệt — không thể chụp hoặc tải lại tệp cho phiên bản này.</span>
        </div>
      )}

      {uploadError && (
        <div className="trip-pod__banner trip-pod__banner--error" role="alert">
          <AlertTriangle size={16} />
          <span>{uploadError}</span>
        </div>
      )}

      <div className="trip-pod__grid">
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
                      disabled={uploading || creatingDraft}
                    >
                      {creatingDraft || uploading ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
                      <span>Chụp</span>
                    </button>
                    <button
                      type="button"
                      className="trip-pod__action trip-pod__action--secondary"
                      onClick={() => triggerInput(fileRefs[fileType])}
                      disabled={uploading || creatingDraft}
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
                    onChange={(event) => void handlePick(fileType, event.target.files)}
                  />
                </>
              )}

              {files.length > 0 ? (
                <ul className="trip-pod__file-list">
                  {files.map((file) => {
                    const isImage = (file.mimeType ?? '').startsWith('image/');
                    const thumb = thumbUrls[file.id];
                    if (isImage && thumb) {
                      const fileIndex = imageFiles.findIndex((item) => item.id === file.id);
                      return (
                        <li key={file.id} className="trip-pod__file">
                          <button
                            type="button"
                            className="trip-pod__file-thumb"
                            onClick={() => setViewerIndex(fileIndex)}
                          >
                            <img src={thumb} alt={file.originalFileName} />
                          </button>
                          <span className="trip-pod__file-time">{formatDateTime(file.createdAt)}</span>
                        </li>
                      );
                    }
                    return (
                      <li key={file.id} className="trip-pod__file">
                        <div className="trip-pod__file-meta">
                          {(file.mimeType ?? '').startsWith('image/') ? <FileImage size={15} /> : <FileText size={15} />}
                          <span className="trip-pod__file-name" title={file.originalFileName}>{file.originalFileName}</span>
                        </div>
                        <span className="trip-pod__file-time">{formatDateTime(file.createdAt)}</span>
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
            <span>Đủ hồ sơ bắt buộc. Bấm "HOÀN THÀNH CHUYẾN" ở dưới để gửi.</span>
          ) : (
            <span>
              Còn thiếu {missingRequired.map((fileType) => FILE_TYPE_LABELS[fileType]).join(', ')}.
            </span>
          )}
        </div>
        {/* Spec (Phần 4): nút "Gửi e-POD" riêng đã được gộp vào nút
            "HOÀN THÀNH CHUYẾN" ở footer chuyến (DriverTripDetailPage). */}
      </div>

      {latestHistory.length > 0 && (
        <div className="trip-pod__history">
          <p className="trip-pod__history-title">Lịch sử phiên bản</p>
          <ul className="trip-pod__history-list">
            {latestHistory.map((submission) => (
              <li key={submission.id} className="trip-pod__history-item">
                <div>
                  <strong>Phiên bản {submission.submissionVersion}</strong>
                  <span>{STATUS_LABELS[submission.status]}</span>
                </div>
                <span>{formatDateTime(submission.submittedAt ?? submission.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {viewerIndex != null && imageFiles[viewerIndex] && thumbUrls[imageFiles[viewerIndex].id] && (
        <PhotoViewer
          urls={imageFiles.map((item) => thumbUrls[item.id]).filter(Boolean)}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      {scanning && (
        <ContainerScanner
          onCapture={(dataUrl) => {
            const fileType = scanning;
            setScanning(null);
            void handleScanCapture(fileType, dataUrl);
          }}
          onClose={() => setScanning(null)}
        />
      )}
    </section>
  );
}

export default TripPodSubmission;
