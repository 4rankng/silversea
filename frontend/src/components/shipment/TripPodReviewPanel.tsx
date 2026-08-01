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
  reviewShipmentPod,
  type ShipmentPodReviewFile,
  type ShipmentPodReviewItem,
  updateFulfillmentCancellationDisposition,
} from '../../api/shipmentClient';

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

  async function handleNotRequired(item: ShipmentPodReviewItem) {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const reason = window.prompt('Nhập lý do bỏ tác vụ khỏi điều kiện đóng lô hàng:', item.notRequiredReason ?? '')?.trim() ?? '';
    if (!reason) return;

    setPendingKey(`not-required-${item.fulfillmentId}`);
    setError(null);
    try {
      await updateFulfillmentCancellationDisposition(
        shipmentId,
        item.fulfillmentId,
        {
          expectedVersion: item.fulfillmentVersion,
          disposition: 'NOT_REQUIRED',
          reason,
        },
        crypto.randomUUID(),
      );
      await onChanged();
    } catch (dispositionError) {
      setError(dispositionError instanceof Error ? dispositionError.message : 'Không thể cập nhật tác vụ đã hủy.');
    } finally {
      setPendingKey(null);
      activeElement?.focus();
    }
  }

  async function handleReplacement(item: ShipmentPodReviewItem) {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const replacementRaw = window.prompt('Nhập ID tác vụ thay thế:', item.replacementFulfillmentId != null ? String(item.replacementFulfillmentId) : '');
    if (!replacementRaw) return;
    const replacementFulfillmentId = Number(replacementRaw);
    if (!Number.isInteger(replacementFulfillmentId) || replacementFulfillmentId <= 0) {
      setError('ID tác vụ thay thế không hợp lệ.');
      activeElement?.focus();
      return;
    }
    const reason = window.prompt('Nhập lý do thay thế tác vụ đã hủy:', '')?.trim() ?? '';
    if (!reason) return;

    setPendingKey(`replacement-${item.fulfillmentId}`);
    setError(null);
    try {
      await updateFulfillmentCancellationDisposition(
        shipmentId,
        item.fulfillmentId,
        {
          expectedVersion: item.fulfillmentVersion,
          disposition: 'REPLACED',
          replacementFulfillmentId,
          reason,
        },
        crypto.randomUUID(),
      );
      await onChanged();
    } catch (dispositionError) {
      setError(dispositionError instanceof Error ? dispositionError.message : 'Không thể liên kết tác vụ thay thế.');
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
            return (
              <article key={item.fulfillmentId} className="shipment-pod-review__item">
                <div className="shipment-pod-review__item-head">
                  <div>
                    <div className="shipment-pod-review__title-row">
                      <strong>Tác vụ #{item.fulfillmentId}</strong>
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
                    <span>Đã liên kết tác vụ thay thế #{item.replacementFulfillmentId} cho đầu việc đã hủy.</span>
                  </div>
                )}

                {submission ? (
                  <>
                    <div className="shipment-pod-review__submission-meta">
                      <span>Phiên bản #{submission.submissionVersion}</span>
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

                {canResolveCancellation && unresolvedCancellation && (
                  <div className="shipment-pod-review__actions">
                    <button
                      type="button"
                      className="btn btn--ghost shipment-pod-review__action"
                      onClick={() => void handleReplacement(item)}
                      disabled={pendingKey != null}
                    >
                      {pendingKey === `replacement-${item.fulfillmentId}` ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />}
                      Gắn tác vụ thay thế
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary shipment-pod-review__action"
                      onClick={() => void handleNotRequired(item)}
                      disabled={pendingKey != null}
                    >
                      {pendingKey === `not-required-${item.fulfillmentId}` ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                      Bỏ khỏi điều kiện đóng
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
