import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { TripPodStatus } from '@tingting/shared';
import {
  downloadShipmentPodFile,
  cancelShipmentFulfillment,
  reviewShipmentPod,
  type ShipmentPodReviewFile,
  type ShipmentPodReviewItem,
} from '../../api/shipmentClient';
import { Modal } from '../UI';

export interface TripPodReviewPanelProps {
  shipmentId: number;
  items: ShipmentPodReviewItem[];
  canReview: boolean;
  canResolveCancellation: boolean;
  onChanged: () => Promise<void> | void;
}

const STATUS_LABELS: Record<TripPodStatus, string> = {
  [TripPodStatus.DRAFT]: 'Đang chuẩn bị',
  [TripPodStatus.SUBMITTED]: 'Chờ duyệt',
  [TripPodStatus.ACCEPTED]: 'Đã duyệt',
  [TripPodStatus.REJECTED]: 'Bị từ chối',
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function statusClass(status: TripPodStatus): string {
  switch (status) {
    case TripPodStatus.ACCEPTED:
      return 'shipment-pod-review__badge shipment-pod-review__badge--accepted';
    case TripPodStatus.REJECTED:
      return 'shipment-pod-review__badge shipment-pod-review__badge--rejected';
    case TripPodStatus.SUBMITTED:
      return 'shipment-pod-review__badge shipment-pod-review__badge--submitted';
    default:
      return 'shipment-pod-review__badge shipment-pod-review__badge--draft';
  }
}

export function TripPodReviewPanel({
  shipmentId,
  items,
  canReview,
  canResolveCancellation,
  onChanged,
}: TripPodReviewPanelProps) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelDraft, setCancelDraft] = useState<{
    item: ShipmentPodReviewItem;
    disposition: 'REPLACED' | 'NOT_REQUIRED';
    reason: string;
  } | null>(null);

  async function handleDownload(file: ShipmentPodReviewFile) {
    setError(null);
    try {
      const blob = await downloadShipmentPodFile(shipmentId, file.id);
      triggerDownload(blob, file.originalFileName);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Không thể tải tệp e-POD.');
    }
  }

  async function handleReview(item: ShipmentPodReviewItem, resolution: 'ACCEPT' | 'REJECT') {
    const submission = item.currentSubmission;
    if (!submission) return;
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rejectionReason = resolution === 'REJECT'
      ? window.prompt('Nhập lý do từ chối e-POD:', submission.rejectionReason ?? '')?.trim() ?? ''
      : null;
    if (resolution === 'REJECT' && !rejectionReason) return;

    setPendingKey(`review-${submission.id}-${resolution}`);
    setError(null);
    try {
      await reviewShipmentPod(
        shipmentId,
        submission.id,
        {
          expectedVersion: submission.version,
          resolution,
          rejectionReason,
        },
        crypto.randomUUID(),
      );
      await onChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Không thể cập nhật e-POD.');
    } finally {
      setPendingKey(null);
      activeElement?.focus();
    }
  }

  function openCancelModal(item: ShipmentPodReviewItem) {
    setError(null);
    setCancelDraft({
      item,
      disposition: item.canceledAt ? (item.cancellationDisposition ?? 'NOT_REQUIRED') : 'REPLACED',
      reason: item.notRequiredReason ?? '',
    });
  }

  async function handleCancelFulfillment() {
    if (!cancelDraft) return;
    const reason = cancelDraft.reason.trim();
    if (!reason) {
      setError('Cần nhập lý do hủy tác vụ.');
      return;
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingKey(`cancel-${cancelDraft.item.fulfillmentId}`);
    setError(null);
    try {
      await cancelShipmentFulfillment(
        shipmentId,
        cancelDraft.item.fulfillmentId,
        {
          expectedVersion: cancelDraft.item.fulfillmentVersion,
          disposition: cancelDraft.disposition,
          reason,
        },
        crypto.randomUUID(),
      );
      await onChanged();
      setCancelDraft(null);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Không thể hủy tác vụ điều phối.');
    } finally {
      setPendingKey(null);
      activeElement?.focus();
    }
  }

  return (
    <section className="shipment-detail__card shipment-pod-review">
      <div className="shipment-pod-review__head">
        <div>
          <h3 className="shipment-detail__section-title">
            <FileText size={16} />
            e-POD &amp; điều kiện đóng lô hàng
          </h3>
          <p className="shipment-pod-review__subtitle">
            Duyệt hồ sơ giao hàng theo từng tác vụ và xử lý các đầu việc đã hủy trước khi hệ thống tự đóng lô hàng.
          </p>
        </div>
      </div>

      {error && (
        <div className="shipment-pod-review__alert" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      {items.length === 0 ? (
        <p className="shipment-detail__empty">Chưa phát sinh tác vụ giao hàng nào để rà soát e-POD.</p>
      ) : (
        <div className="shipment-pod-review__list">
          {items.map((item) => {
            const submission = item.currentSubmission;
            const unresolvedCancellation = item.canceledAt && !item.cancellationDisposition;
            const canCancelFulfillment = canResolveCancellation
              && item.cancellationDisposition == null
              && item.tripStatus !== 'LOCKED'
              && item.tripStatus !== 'COMPLETED';
            return (
              <article key={item.fulfillmentId} className="shipment-pod-review__item">
                <div className="shipment-pod-review__item-head">
                  <div>
                    <div className="shipment-pod-review__title-row">
                      <strong>{item.containerNumber ? `Giao container ${item.containerNumber}` : 'Giao lô hàng lẻ'}</strong>
                      {item.containerNumber && (
                        <span className="shipment-pod-review__meta-pill">{item.containerNumber}</span>
                      )}
                      {submission && (
                        <span className={statusClass(submission.status)}>
                          {STATUS_LABELS[submission.status]}
                        </span>
                      )}
                    </div>
                    <p className="shipment-pod-review__meta">
                      {item.tripCode ? `Chuyến ${item.tripCode}` : 'Chưa có chuyến'}
                      {item.driverName ? ` · Tài xế ${item.driverName}` : ''}
                      {item.tripStatus ? ` · ${item.tripStatus}` : ''}
                    </p>
                  </div>
                  {!item.required && (
                    <span className="shipment-pod-review__meta-pill shipment-pod-review__meta-pill--muted">
                      Không còn là điều kiện bắt buộc
                    </span>
                  )}
                </div>

                {unresolvedCancellation && (
                  <div className="shipment-pod-review__alert shipment-pod-review__alert--warning">
                    <AlertTriangle size={16} />
                    <span>Tác vụ đã hủy nhưng chưa xác định thay thế hoặc miễn trừ, nên lô hàng chưa thể đóng.</span>
                  </div>
                )}

                {item.cancellationDisposition === 'NOT_REQUIRED' && (
                  <div className="shipment-pod-review__alert shipment-pod-review__alert--success">
                    <CheckCircle2 size={16} />
                    <span>Đã phê duyệt bỏ tác vụ khỏi điều kiện đóng lô hàng: {item.notRequiredReason ?? '—'}.</span>
                  </div>
                )}

                {item.cancellationDisposition === 'REPLACED' && (
                  <div className="shipment-pod-review__alert shipment-pod-review__alert--success">
                    <RotateCcw size={16} />
                    <span>Đã liên kết một tác vụ thay thế cho đầu việc đã hủy.</span>
                  </div>
                )}

                {submission ? (
                  <>
                    <div className="shipment-pod-review__submission-meta">
                      <span>Phiên bản {submission.submissionVersion}</span>
                      <span>Gửi lúc {formatDateTime(submission.submittedAt)}</span>
                      <span>Rà soát lúc {formatDateTime(submission.reviewedAt)}</span>
                    </div>

                    {submission.rejectionReason && (
                      <div className="shipment-pod-review__alert shipment-pod-review__alert--danger">
                        <XCircle size={16} />
                        <span>Lý do từ chối gần nhất: {submission.rejectionReason}</span>
                      </div>
                    )}

                    {submission.missingRequiredFileTypes.length > 0 && (
                      <div className="shipment-pod-review__alert shipment-pod-review__alert--warning">
                        <AlertTriangle size={16} />
                        <span>
                          Hồ sơ còn thiếu: {submission.missingRequiredFileTypes.join(', ')}.
                        </span>
                      </div>
                    )}

                    <div className="shipment-pod-review__files">
                      {submission.files.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className="shipment-pod-review__file"
                          onClick={() => void handleDownload(file)}
                        >
                          <div>
                            <strong>{file.label}</strong>
                            <div className="shipment-pod-review__file-meta">
                              {file.originalFileName} · {formatFileSize(file.sizeBytes)}
                            </div>
                          </div>
                          <Download size={16} />
                        </button>
                      ))}
                    </div>

                    {canReview && submission.status === TripPodStatus.SUBMITTED && (
                      <div className="shipment-pod-review__actions">
                        <button
                          type="button"
                          className="btn btn--ghost shipment-pod-review__action"
                          onClick={() => void handleReview(item, 'REJECT')}
                          disabled={pendingKey != null}
                        >
                          {pendingKey === `review-${submission.id}-REJECT` ? <Loader2 size={16} className="spin" /> : <XCircle size={16} />}
                          Từ chối
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary shipment-pod-review__action"
                          onClick={() => void handleReview(item, 'ACCEPT')}
                          disabled={pendingKey != null}
                        >
                          {pendingKey === `review-${submission.id}-ACCEPT` ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                          Duyệt &amp; khóa chuyến
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="shipment-detail__empty">Tác vụ này chưa có hồ sơ e-POD nào được gửi lên.</p>
                )}

                {canCancelFulfillment && (
                  <div className="shipment-pod-review__actions">
                    <button
                      type="button"
                      className="btn btn--danger shipment-pod-review__action"
                      onClick={() => openCancelModal(item)}
                      disabled={pendingKey != null}
                    >
                      {pendingKey === `cancel-${item.fulfillmentId}` ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                      {item.canceledAt ? 'Hoàn tất xử lý hủy' : 'Hủy tác vụ'}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={cancelDraft != null}
        title="Hủy tác vụ điều phối"
        onClose={() => pendingKey == null && setCancelDraft(null)}
        maxWidth={560}
        footer={cancelDraft ? (
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setCancelDraft(null)}
              disabled={pendingKey != null}
            >
              Đóng
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void handleCancelFulfillment()}
              disabled={pendingKey != null || cancelDraft.reason.trim().length === 0}
            >
              {pendingKey === `cancel-${cancelDraft.item.fulfillmentId}` ? <Loader2 size={16} className="spin" /> : <AlertTriangle size={16} />}
              Xác nhận hủy tác vụ
            </button>
          </>
        ) : undefined}
      >
        {cancelDraft && (
          <div className="shipment-pod-review__cancel-form">
            <div className="shipment-pod-review__cancel-summary">
              <strong>{cancelDraft.item.containerNumber ? `Giao container ${cancelDraft.item.containerNumber}` : 'Giao lô hàng lẻ'}</strong>
              <span>
                {cancelDraft.item.containerNumber
                  ? `Container ${cancelDraft.item.containerNumber}`
                  : cancelDraft.item.cargoMode === 'LCL'
                    ? 'Lô hàng lẻ'
                    : 'Tác vụ FCL'}
              </span>
              <span>
                {cancelDraft.item.tripCode
                  ? `Chuyến ${cancelDraft.item.tripCode}${cancelDraft.item.tripStatus ? ` · ${cancelDraft.item.tripStatus}` : ''}`
                  : 'Chưa có chuyến điều xe'}
              </span>
            </div>

            <fieldset className="shipment-pod-review__cancel-options">
              <legend>Hướng xử lý sau khi hủy</legend>
              <label className="shipment-pod-review__cancel-option">
                <input
                  type="radio"
                  name="fulfillment-cancel-disposition"
                  checked={cancelDraft.disposition === 'REPLACED'}
                  onChange={() => setCancelDraft((current) => current ? { ...current, disposition: 'REPLACED' } : current)}
                />
                <span>
                  <strong>Tạo tác vụ thay thế</strong>
                  <small>Hệ thống sẽ tạo ngay một tác vụ mới cùng loại để điều phối lại.</small>
                </span>
              </label>
              <label className="shipment-pod-review__cancel-option">
                <input
                  type="radio"
                  name="fulfillment-cancel-disposition"
                  checked={cancelDraft.disposition === 'NOT_REQUIRED'}
                  onChange={() => setCancelDraft((current) => current ? { ...current, disposition: 'NOT_REQUIRED' } : current)}
                />
                <span>
                  <strong>Bỏ khỏi điều kiện đóng lô</strong>
                  <small>Chỉ dùng khi đầu việc này không còn cần thực hiện.</small>
                </span>
              </label>
            </fieldset>

            <label className="shipment-pod-review__cancel-reason">
              <span>Lý do hủy</span>
              <textarea
                className="input"
                rows={4}
                value={cancelDraft.reason}
                onChange={(event) => setCancelDraft((current) => current ? { ...current, reason: event.target.value } : current)}
                placeholder="Nêu rõ lý do để lưu vết kiểm soát"
                autoFocus
              />
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
}
