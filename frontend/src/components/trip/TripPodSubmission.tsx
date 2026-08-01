import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  ReceiptText,
  Upload,
} from 'lucide-react';
import { TripPodFileType, TripPodStatus } from '@tingting/shared';
import type { OfflineCommand } from '../../features/driver/useOfflineCommandQueue';
import type { DriverTaskPodFile, DriverTaskPodSubmission } from '../../api/driverClient';
import './TripPodSubmission.css';

type SubmitState = 'idle' | 'pending' | 'retry' | 'conflict';

export interface TripPodSubmissionProps {
  tripId: number;
  tripCode?: string | null;
  tripVersion: number;
  currentSubmission: DriverTaskPodSubmission | null;
  history: DriverTaskPodSubmission[];
  pendingCommands: OfflineCommand[];
  creatingDraft: boolean;
  uploading: boolean;
  onEnsureDraft: () => Promise<DriverTaskPodSubmission>;
  onUploadFile: (submission: DriverTaskPodSubmission, fileType: TripPodFileType, file: File) => Promise<void>;
  onSubmit: (submission: DriverTaskPodSubmission) => Promise<void>;
}

const REQUIRED_FILE_TYPES = [
  TripPodFileType.YARD_OR_DROP_RECEIPT,
  TripPodFileType.SIGNED_DELIVERY_NOTE,
] as const;

const FILE_TYPE_LABELS: Record<TripPodFileType, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Phiếu bãi / phiếu hạ',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Biên bản giao nhận có ký nhận',
  [TripPodFileType.TOLL_TICKET]: 'Vé cầu đường',
};

const FILE_TYPE_HELP: Record<TripPodFileType, string> = {
  [TripPodFileType.YARD_OR_DROP_RECEIPT]: 'Bắt buộc. Chụp rõ số phiếu và dấu xác nhận bãi hoặc điểm hạ.',
  [TripPodFileType.SIGNED_DELIVERY_NOTE]: 'Bắt buộc. Phải có chữ ký giao nhận đầy đủ.',
  [TripPodFileType.TOLL_TICKET]: 'Không bắt buộc. Có thể tải lên nhiều vé nếu chuyến phát sinh nhiều trạm.',
};

const STATUS_LABELS: Record<TripPodStatus, string> = {
  [TripPodStatus.DRAFT]: 'Đang chuẩn bị',
  [TripPodStatus.SUBMITTED]: 'Đã gửi duyệt',
  [TripPodStatus.ACCEPTED]: 'Đã chấp nhận',
  [TripPodStatus.REJECTED]: 'Bị từ chối',
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function groupFilesByType(submission: DriverTaskPodSubmission | null): Record<TripPodFileType, DriverTaskPodFile[]> {
  const empty: Record<TripPodFileType, DriverTaskPodFile[]> = {
    [TripPodFileType.YARD_OR_DROP_RECEIPT]: [],
    [TripPodFileType.SIGNED_DELIVERY_NOTE]: [],
    [TripPodFileType.TOLL_TICKET]: [],
  };
  if (!submission) return empty;
  for (const file of submission.files ?? []) {
    empty[file.fileType].push(file);
  }
  return empty;
}

function commandState(commands: OfflineCommand[]): SubmitState {
  if (commands.some((command) => command.status === 'CONFLICT')) return 'conflict';
  if (commands.some((command) => command.status === 'FAILED')) return 'retry';
  if (commands.some((command) => command.status === 'QUEUED' || command.status === 'IN_PROGRESS')) return 'pending';
  return 'idle';
}

function triggerInput(ref: React.RefObject<HTMLInputElement | null>) {
  ref.current?.click();
}

export function TripPodSubmission({
  tripId,
  tripCode,
  tripVersion,
  currentSubmission,
  history,
  pendingCommands,
  creatingDraft,
  uploading,
  onEnsureDraft,
  onUploadFile,
  onSubmit,
}: TripPodSubmissionProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const cameraRefs = {
    [TripPodFileType.YARD_OR_DROP_RECEIPT]: useRef<HTMLInputElement | null>(null),
    [TripPodFileType.SIGNED_DELIVERY_NOTE]: useRef<HTMLInputElement | null>(null),
    [TripPodFileType.TOLL_TICKET]: useRef<HTMLInputElement | null>(null),
  };
  const fileRefs = {
    [TripPodFileType.YARD_OR_DROP_RECEIPT]: useRef<HTMLInputElement | null>(null),
    [TripPodFileType.SIGNED_DELIVERY_NOTE]: useRef<HTMLInputElement | null>(null),
    [TripPodFileType.TOLL_TICKET]: useRef<HTMLInputElement | null>(null),
  };

  const groupedFiles = useMemo(() => groupFilesByType(currentSubmission), [currentSubmission]);
  const editableSubmission = currentSubmission?.status === TripPodStatus.DRAFT ? currentSubmission : null;
  const missingRequired = REQUIRED_FILE_TYPES.filter((fileType) => groupedFiles[fileType].length === 0);
  const latestHistory = history.filter((submission) => submission.id !== currentSubmission?.id);
  const submitCommands = pendingCommands.filter((command) => command.endpoint === 'driver.task.pod.submit');
  const submitState = commandState(submitCommands);

  async function handlePick(fileType: TripPodFileType, fileList: FileList | null) {
    if (!fileList?.[0]) return;
    const file = fileList[0];
    setUploadError(null);

    try {
      const submission = editableSubmission ?? await onEnsureDraft();
      await onUploadFile(submission, fileType, file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Không thể tải tệp e-POD.');
    } finally {
      const cameraInput = cameraRefs[fileType].current;
      const fileInput = fileRefs[fileType].current;
      if (cameraInput) cameraInput.value = '';
      if (fileInput) fileInput.value = '';
    }
  }

  async function handleSubmit() {
    if (!editableSubmission) return;
    setSubmitting(true);
    setUploadError(null);
    try {
      await onSubmit(editableSubmission);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Không thể gửi e-POD.');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = editableSubmission != null && missingRequired.length === 0 && !uploading && !creatingDraft;
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

      {uploadError && (
        <div className="trip-pod__banner trip-pod__banner--error" role="alert">
          <AlertTriangle size={16} />
          <span>{uploadError}</span>
        </div>
      )}

      {submitState !== 'idle' && (
        <div className={`trip-pod__banner ${submitState === 'conflict' ? 'trip-pod__banner--error' : 'trip-pod__banner--info'}`}>
          {submitState === 'conflict' ? <AlertTriangle size={16} /> : <Clock3 size={16} />}
          <span>
            {submitState === 'pending' && 'Lệnh gửi e-POD đang chờ đồng bộ.'}
            {submitState === 'retry' && 'Gửi e-POD chưa thành công. Hệ thống sẽ thử lại khi có mạng.'}
            {submitState === 'conflict' && 'Phiên bản e-POD đã thay đổi. Vui lòng tải lại để gửi phiên bản mới.'}
          </span>
        </div>
      )}

      <div className="trip-pod__grid">
        {[...REQUIRED_FILE_TYPES, TripPodFileType.TOLL_TICKET].map((fileType) => {
          const files = groupedFiles[fileType];
          const isRequired = fileType !== TripPodFileType.TOLL_TICKET;
          return (
            <article key={fileType} className="trip-pod__card">
              <div className="trip-pod__card-head">
                <div>
                  <h3 className="trip-pod__card-title">
                    {FILE_TYPE_LABELS[fileType]}
                    {isRequired && <span className="trip-pod__required">Bắt buộc</span>}
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

              <div className="trip-pod__actions">
                <button
                  type="button"
                  className="trip-pod__action"
                  onClick={() => triggerInput(cameraRefs[fileType])}
                  disabled={uploading || creatingDraft || submitState === 'pending'}
                >
                  {creatingDraft || uploading ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
                  <span>Chụp</span>
                </button>
                <button
                  type="button"
                  className="trip-pod__action trip-pod__action--secondary"
                  onClick={() => triggerInput(fileRefs[fileType])}
                  disabled={uploading || creatingDraft || submitState === 'pending'}
                >
                  <Upload size={16} />
                  <span>Tải tệp</span>
                </button>
              </div>

              <input
                ref={cameraRefs[fileType]}
                className="trip-pod__input"
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={(event) => void handlePick(fileType, event.target.files)}
              />
              <input
                ref={fileRefs[fileType]}
                className="trip-pod__input"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => void handlePick(fileType, event.target.files)}
              />

              {files.length > 0 ? (
                <ul className="trip-pod__file-list">
                  {files.map((file) => (
                    <li key={file.id} className="trip-pod__file">
                      <div className="trip-pod__file-meta">
                        {fileType === TripPodFileType.TOLL_TICKET ? <ReceiptText size={15} /> : <FileText size={15} />}
                        <span className="trip-pod__file-name">{file.originalFileName}</span>
                      </div>
                      <span className="trip-pod__file-time">{formatDateTime(file.createdAt)}</span>
                    </li>
                  ))}
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
          <strong>Điều kiện gửi duyệt</strong>
          {missingRequired.length === 0 ? (
            <span>Đủ hồ sơ bắt buộc để gửi duyệt.</span>
          ) : (
            <span>
              Còn thiếu {missingRequired.map((fileType) => FILE_TYPE_LABELS[fileType]).join(', ')}.
            </span>
          )}
        </div>
        <button
          type="button"
          className="trip-pod__submit"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || submitting || submitState === 'pending'}
        >
          {submitting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
          <span>Gửi e-POD</span>
        </button>
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
    </section>
  );
}

export default TripPodSubmission;
