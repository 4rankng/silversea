/**
 * DriverTripPodPage — separate e-POD submission screen for the driver app.
 *
 * Phần 4 ticket 2026-08-28 customer feedback: the e-POD section used to live
 * inline in the trip detail page alongside the cost form. The customer asked
 * for e-POD to move to its OWN screen that the driver sees AFTER the trip is
 * ended, and for the cost form to be hidden (kế toán tài chính is the post-trial
 * phase per the trial-readiness plan, "từ từ"). This page owns the e-POD
 * lifecycle: ensure-draft, upload files, submit, and complete the trip.
 *
 * The trip detail page (`DriverTripDetailPage`) keeps the task info, the
 * container card, the fuel image, and a "Bước tiếp: e-POD" CTA that navigates
 * here while the trip is IN_TRANSIT. The `Hoàn thành chuyến` action that used
 * to live on the trip detail is the footer button of THIS page.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Loader2,
  StickyNote,
} from 'lucide-react';
import { TRIP_STATUS_LABELS, TripPodFileType } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripPodSubmission from '../components/trip/TripPodSubmission';
import { tripStatusVariant } from '../lib/tripStatus';
import { podRequiredFilesReady } from '../lib/podReadiness';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDriverTaskDetail } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { useOnline } from '../hooks/useOnline';
import { buildIdempotencyKey } from '../lib/idempotency';
import { useToast } from '../components/shared/Toast';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import './DriverTripDetailPage.css';
import './DriverTripPodPage.css';

// Status-aware completion CTA label — same logic as DriverTripDetailPage:
// only IN_TRANSIT can complete, COMPLETED is done, others read as not-yet.
function completeCtaLabel(status: DriverTaskDetail['status']): string {
  if (status === 'IN_TRANSIT') return 'HOÀN THÀNH CHUYẾN';
  if (status === 'COMPLETED') return 'Đã hoàn thành chuyến';
  return 'Chưa thể hoàn thành chuyến';
}

export function DriverTripPodPage() {
  const { id: fulfillmentIdParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const online = useOnline();
  const { toast } = useToast();

  const fulfillmentId = Number(fulfillmentIdParam);
  const validFulfillmentId = Number.isInteger(fulfillmentId) && fulfillmentId > 0 ? fulfillmentId : undefined;

  const taskDetail = useDriverTaskDetail(validFulfillmentId);

  const { rootRef } = usePageAnimations({
    ready: !taskDetail.isLoading,
  });

  const [creatingDraft, setCreatingDraft] = useState(false);
  const [uploadingPod, setUploadingPod] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);

  const refetchDetail = taskDetail.refetch;
  const refreshAll = useCallback(async () => {
    await refetchDetail();
  }, [refetchDetail]);

  const trip = taskDetail.data as DriverTaskDetail | undefined;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;
  const podHistory = trip?.podHistory ?? [];
  const operationalNote = trip?.fulfillment?.driverNotes ?? trip?.notes ?? null;

  const { hasYardReceipt, hasSignedNote, podReady } = podRequiredFilesReady(currentSubmission);
  const completionBlocked = !validFulfillmentId
    || Boolean(trip?.accountingLock)
    || trip?.status !== 'IN_TRANSIT'
    || !podReady;

  async function handleEnsureDraft(): Promise<DriverTaskPodSubmission> {
    if (!trip || !validFulfillmentId) {
      throw new Error('Không tìm thấy chuyến để tạo e-POD.');
    }
    if (currentSubmission?.status === 'DRAFT') {
      return currentSubmission;
    }
    setCreatingDraft(true);
    try {
      const nextSubmissionVersion = Math.max(
        currentSubmission?.submissionVersion ?? 0,
        ...podHistory.map((submission) => submission.submissionVersion),
      ) + 1;
      const idempotencyKey = buildIdempotencyKey(
        'driver', 'task', validFulfillmentId,
        'pod-draft', 'trip-version', trip.version,
        'submission-version', nextSubmissionVersion,
      );
      const created = await driverClient.createPodSubmission(
        validFulfillmentId,
        { expectedVersion: trip.version },
        idempotencyKey,
      );
      await refreshAll();
      toast({ kind: 'success', message: 'Đã mở phiên bản e-POD mới.' });
      return created;
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleUploadPodFile(
    submission: DriverTaskPodSubmission,
    fileType: TripPodFileType,
    file: File,
  ) {
    if (!trip || !validFulfillmentId) {
      throw new Error('Không tìm thấy chuyến để tải ảnh e-POD.');
    }
    setUploadingPod(true);
    try {
      const uploaded = await driverClient.attachPodFile({
        tripId: validFulfillmentId,
        submissionId: submission.id,
        fileType,
        expectedVersion: submission.version,
        file,
      });
      await refreshAll();
      const label = uploaded.files.find((item) => item.fileType === fileType)?.originalFileName ?? file.name;
      toast({ kind: 'success', message: `Đã lưu tệp ${label}.` });
    } finally {
      setUploadingPod(false);
    }
  }

  async function handleSubmitPod(submission: DriverTaskPodSubmission): Promise<boolean> {
    if (!trip || !validFulfillmentId || !online) return false;
    setSubmitting(true);
    try {
      const idempotencyKey = buildIdempotencyKey(
        'driver', 'task', validFulfillmentId,
        'pod-submit', submission.id, 'version', submission.version,
      );
      await driverClient.submitPod(validFulfillmentId, submission.id, { expectedVersion: submission.version }, idempotencyKey);
      await refreshAll();
      toast({ kind: 'success', message: 'Đã lưu chứng từ giao hàng.' });
      return true;
    } catch (error) {
      toast({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Không thể gửi e-POD. Vui lòng thử lại.',
      });
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteTrip() {
    if (!trip || !validFulfillmentId || !online) return;
    if (trip.status !== 'IN_TRANSIT') {
      toast({ kind: 'warning', message: 'Chuyến không ở trạng thái đang chạy để hoàn thành.' });
      return;
    }
    if (completionBlocked) {
      toast({ kind: 'warning', message: 'Cần đủ 2 ảnh e-POD trước khi hoàn thành chuyến.' });
      return;
    }
    setCompleting(true);
    try {
      if (currentSubmission?.status === 'DRAFT') {
        const podSubmitted = await handleSubmitPod(currentSubmission);
        if (!podSubmitted) return;
      }
      const idempotencyKey = buildIdempotencyKey(
        'driver', 'task', validFulfillmentId, 'complete', 'version', trip.version,
      );
      await driverClient.completeTrip(validFulfillmentId, { expectedVersion: trip.version }, idempotencyKey);
      toast({ kind: 'success', message: 'Hoàn tất chuyến hàng thành công!' });
      navigate('/my-trips', { replace: true });
    } catch (error) {
      toast({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Không thể hoàn thành chuyến. Vui lòng thử lại.',
      });
    } finally {
      setCompleting(false);
    }
  }

  const statusLabel = useMemo(() => {
    if (!trip) return '';
    return TRIP_STATUS_LABELS[trip.status] ?? trip.status;
  }, [trip]);

  const handleBack = useCallback(
    // The POD route is fulfillment-scoped; the detail route is trip-scoped.
    () => navigate(trip?.id ? `/my-trips/${trip.id}` : '/my-trips', { replace: true }),
    [navigate, trip?.id],
  );
  // ESC/hardware back mirrors the header back button: both return to the trip
  // detail the driver came from, not straight to the journey board.
  useBackShortcut(handleBack);

  if (!validFulfillmentId) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <AlertTriangle size={28} />
          <p>Không thể xác định chuyến đi từ liên kết này.</p>
          <button type="button" className="driver-task-back" onClick={handleBack}>
            <ArrowLeft size={16} />
            <span>Quay lại danh sách</span>
          </button>
        </div>
      </div>
    );
  }

  if (taskDetail.isLoading) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback"><Loader2 size={24} className="spin" />
          <p>Đang tải chuyến…</p>
        </div>
      </div>
    );
  }

  if (!trip || taskDetail.isError) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <AlertTriangle size={28} />
          <p>Không tải được chuyến. Vui lòng thử lại.</p>
          <div className="driver-task-feedback__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void taskDetail.refetch()}
            >
              Thử lại
            </button>
            <button type="button" className="driver-task-back" onClick={handleBack}>
              <ArrowLeft size={16} />
              <span>Quay lại danh sách</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="driver-task-screen driver-trip-pod-screen">
      <header className="driver-task-header">
        <button
          type="button"
          className="driver-task-back"
          onClick={handleBack}
          aria-label="Quay lại"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="driver-task-header__body">
          <p className="driver-task-header__eyebrow">Chứng từ giao hàng</p>
          <h1 className="driver-task-header__title">e-POD giao hàng</h1>
          <div className="driver-task-header__meta">
            <StatusPill variant={tripStatusVariant(trip.status)}>
              {statusLabel}
            </StatusPill>
            {trip.tripCode && <span className="driver-task-header__customer">{trip.tripCode}</span>}
          </div>
        </div>
      </header>

      <main className="driver-trip-pod-main">
        {trip.accountingLock && <AccountingLockBanner lock={trip.accountingLock} />}

        {/* Ghi chú from cus/điều vận (spec A3): shown read-only above the e-POD
            so the driver has the operational note in mind before uploading. */}
        {operationalNote && (
          <section className="driver-trip-pod-note">
            <StickyNote size={18} />
            <div>
              <strong>Ghi chú từ điều vận / CUS</strong>
              <p>{operationalNote}</p>
            </div>
          </section>
        )}

        {/* No section __head here: TripPodSubmission already opens with its
            own "e-POD bắt buộc" eyebrow — a second copy stacks duplicate
            labels at the top of the card. */}
        <section className="driver-task-section">
          <TripPodSubmission
            tripCode={trip.tripCode}
            tripVersion={trip.version}
            currentSubmission={currentSubmission}
            history={podHistory}
            creatingDraft={creatingDraft}
            uploading={uploadingPod}
            onEnsureDraft={handleEnsureDraft}
            onUploadFile={handleUploadPodFile}
          />
        </section>
      </main>

      <footer className="driver-task-footer">
        <div className="driver-task-footer__body">
          <div className="driver-task-footer__summary">
            <strong>HOÀN THÀNH CHUYẾN</strong>
            <p>
              Tải đủ 2 ảnh e-POD bắt buộc, rồi bấm "HOÀN THÀNH CHUYẾN" — hệ thống gửi e-POD và chốt
              chuyến hoàn thành (CUS + Điều vận sẽ thấy trạng thái "Hoàn thành" ngay).
            </p>
            {(!hasYardReceipt || !hasSignedNote) && (
              <ul className="driver-task-footer__issues">
                {!hasYardReceipt && <li>Thiếu Phiếu bãi / phiếu hạ</li>}
                {!hasSignedNote && <li>Thiếu Biên bản giao nhận</li>}
              </ul>
            )}
            {podReady && trip.status === 'IN_TRANSIT' && (
              <div className="driver-task-footer__ready">
                <CheckCircle2 size={16} />
                <span>Đủ điều kiện hoàn thành chuyến.</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="driver-task-complete"
            disabled={completionBlocked || submitting || completing || !online}
            onClick={() => void handleCompleteTrip()}
          >
            <FileCheck2 size={18} />
            <span>
              {completing || submitting ? 'Đang gửi…' : completeCtaLabel(trip.status)}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}

export default DriverTripPodPage;
