/**
 * DriverTripPodPage — separate e-POD submission screen for the driver app.
 *
 * Phần 4 ticket 2026-08-28 customer feedback: the e-POD section used to live
 * inline in the trip detail page alongside the cost form. The customer asked
 * for e-POD to move to its OWN screen that the driver sees AFTER the trip is
 * accepted. Driver expenses remain on trip detail. This page owns the e-POD
 * lifecycle: ensure-draft, upload files, submit, and complete the trip.
 *
 * The trip detail page (`DriverTripDetailPage`) keeps the task info, the
 * container card, the fuel image, and a "Hoàn tất lệnh vận chuyển" CTA that
 * navigates here while the trip is IN_TRANSIT. The `HOÀN THÀNH CHUYẾN` action
 * that used to live on the trip detail is the footer button of THIS page.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  Loader2,
  StickyNote,
} from 'lucide-react';
import { parseDriverTaskNote, TRIP_STATUS_LABELS, TripPodFileType, TripStatus } from '@tingting/shared';
import { StatusPill, useConfirm } from '../components/UI';
import TripPodSubmission from '../components/trip/TripPodSubmission';
import { tripStatusVariant } from '../lib/tripStatus';
import { podRequiredFilesReady } from '../lib/podReadiness';
import { usePageAnimations } from '../hooks/animations';
import { usePageLeaveGuard } from '../hooks/usePageLeaveGuard';
import { useDriverScreenEntry } from '../features/driver/useDriverScreenEntry';
import { useDriverTaskDetail } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { qk } from '../api/keys';
import { buildIdempotencyKey } from '../lib/idempotency';
import { useToast } from '../components/shared/Toast';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import { podCompleteCtaLabel } from '../features/driver/driver-trip-model';
import './DriverTripDetailPage.css';
import './DriverTripPodPage.css';

export function DriverTripPodPage() {
  const { id: tripIdParam } = useParams<{ id: string }>();
  useDriverScreenEntry(tripIdParam);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pendingFiles, setPendingFiles] = useState(false);

  const tripId = Number(tripIdParam);
  const validTripId = Number.isInteger(tripId) && tripId > 0 ? tripId : undefined;

  // Card 071026141570: the route `/my-trips/:id/pod` carries a TRIP id, but every
  // e-POD endpoint is FULFILLMENT-scoped. This page used to feed the route id
  // straight into `useDriverTaskDetail`, so every trip 404'd on
  // `/driver/me/fulfillments/{id}` and the screen fell into the hard-error
  // branch. Resolve the fulfillment id from the trip payload first — the same
  // shape the sibling DriverTripDetailPage uses since card 20260915_1.
  // Ad-hoc trips carry `fulfillmentId: null` and correctly render the
  // no-fulfillment guard instead.
  const tripQuery = useQuery({
    queryKey: qk.driver.tripBasic(validTripId),
    queryFn: () => driverClient.getDriverTrip(validTripId as number),
    enabled: validTripId != null,
  });
  const fulfillmentId = tripQuery.data?.fulfillmentId ?? undefined;
  const validFulfillmentId = Number.isInteger(fulfillmentId) && Number(fulfillmentId) > 0
    ? fulfillmentId
    : undefined;

  const taskDetail = useDriverTaskDetail(validFulfillmentId);

  const { rootRef } = usePageAnimations({
    ready: !tripQuery.isLoading && !taskDetail.isLoading,
  });

  const [creatingDraft, setCreatingDraft] = useState(false);
  const [uploadingPod, setUploadingPod] = useState(false);
  const [preparingPod, setPreparingPod] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);

  const refetchDetail = taskDetail.refetch;
  const refreshAll = useCallback(async () => {
    await refetchDetail();
  }, [refetchDetail]);

  const trip = taskDetail.data as DriverTaskDetail | undefined;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;
  const podHistory = trip?.podHistory ?? [];
  const documentNumber = trip?.fulfillment?.documentNumber?.trim() || 'Chưa có số Bill/Booking';
  const documentReadOnlyReason = trip?.accountingLock
    ? 'Lô hàng đã khóa kế toán. Không thể thay đổi chứng từ.'
    : trip?.status === TripStatus.COMPLETED
      ? 'Chuyến đã hoàn thành. Bạn có thể xem hoặc tải lại chứng từ.'
      : trip?.status === TripStatus.CANCELED
        ? 'Chuyến đã hủy. Không thể thay đổi chứng từ.'
        : null;
  // The dispatch note is tag-composed (format v2): parse it like the detail
  // page does — tags become chips, manual text the note — so the raw
  // tag-line structure never leaks to the driver. The trip.memo fallback was
  // never tag-composed and renders verbatim.
  const parsedDriverNote = trip?.fulfillment?.driverNotes != null
    ? parseDriverTaskNote(trip.fulfillment.driverNotes, trip?.knownTagLabels ?? [])
    : null;
  const noteChips = parsedDriverNote?.selectedLabels ?? [];
  const operationalNote = parsedDriverNote
    ? (parsedDriverNote.manualText || null)
    : (trip?.notes ?? null);

  const { hasYardReceipt, hasSignedNote, podReady } = podRequiredFilesReady(currentSubmission);
  const documentBusy = preparingPod || creatingDraft || uploadingPod;
  const completionBlocked = !validFulfillmentId
    || Boolean(trip?.accountingLock)
    || trip?.status !== 'IN_TRANSIT'
    || documentBusy
    || !podReady;

  async function handleEnsureDraft(): Promise<DriverTaskPodSubmission> {
    if (!trip || !validFulfillmentId) {
      throw new Error('Không tìm thấy chuyến để tạo e-POD.');
    }
    if (documentReadOnlyReason) throw new Error(documentReadOnlyReason);
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
      toast({ kind: 'success', message: 'Đã tạo hồ sơ chứng từ giao hàng.' });
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
    if (documentReadOnlyReason) throw new Error(documentReadOnlyReason);
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
    if (!trip || !validFulfillmentId) return false;
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
    if (!trip || !validFulfillmentId || documentBusy || submitting || completing) return;
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
      if (pendingFiles && !await confirm('Còn tệp bổ sung chưa gửi. Bỏ tệp này và hoàn thành với chứng từ đã lưu?', { variant: 'warning', confirmLabel: 'Bỏ tệp và hoàn thành' })) return;
      if (currentSubmission?.status === 'DRAFT') {
        const podSubmitted = await handleSubmitPod(currentSubmission);
        if (!podSubmitted) return;
      }
      const idempotencyKey = buildIdempotencyKey(
        'driver', 'task', validFulfillmentId, 'complete', 'version', trip.version,
      );
      await driverClient.completeTrip(validFulfillmentId, { expectedVersion: trip.version }, idempotencyKey);
      // Card 051026230654 — completion moves the trip NEW/RUNNING → HISTORY.
      // The journey board (list + tab counts) and the day-view chip keep their
      // cached pre-completion data otherwise: the app-wide 5-minute staleTime
      // masks the remount refetch on /my-trips, so both consumers must be
      // invalidated BEFORE navigating back for the badge and list to refresh
      // immediately.
      await queryClient.invalidateQueries({ queryKey: qk.driver.journeyBoard });
      await queryClient.invalidateQueries({ queryKey: qk.driver.twoOrders });
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

  const navigateBack = useCallback(
    // The POD route is fulfillment-scoped; the detail route is trip-scoped.
    () => navigate(trip?.id ? `/my-trips/${trip.id}` : '/my-trips', { replace: true }),
    [navigate, trip?.id],
  );
  // ESC/hardware back mirrors the header back button: both return to the trip
  // detail the driver came from, not straight to the journey board.
  const handleBack = usePageLeaveGuard({
    dirty: pendingFiles, saving: documentBusy || submitting || completing,
    message: 'Còn tệp chưa gửi. Bỏ tệp và rời trang?',
    confirm: (message) => confirm(message, { variant: 'warning', confirmLabel: 'Bỏ tệp và rời trang' }),
    onBack: navigateBack,
  });

  // While the trip is still resolving we do not yet know whether this trip has
  // a fulfillment, so show the loader rather than flashing either the
  // no-fulfillment guard or the hard error.
  if (!validTripId || tripQuery.isLoading) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback"><Loader2 size={24} className="spin" />
          <p>Đang tải chuyến…</p>
        </div>
      </div>
    );
  }

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
      {confirmDialog}
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
            <span className="driver-task-header__customer">{documentNumber}</span>
          </div>
        </div>
      </header>

      <main className="driver-trip-pod-main">
        {trip.accountingLock && <AccountingLockBanner lock={trip.accountingLock} />}

        {/* Ghi chú from cus/điều vận (spec A3): shown read-only above the e-POD
            so the driver has the operational note in mind before uploading.
            Parsed like the detail page — tag chips + manual text. */}
        {(operationalNote || noteChips.length > 0) && (
          <section className="driver-trip-pod-note">
            <StickyNote size={18} />
            <div>
              <strong>Ghi chú giao hàng</strong>
              {noteChips.length > 0 && (
                <div className="driver-task-ops" data-testid="pod-operation-chips">
                  {noteChips.map((tag) => (
                    <span key={tag} className="driver-task-ops-chip">{tag.toLocaleUpperCase('vi-VN')}</span>
                  ))}
                </div>
              )}
              {operationalNote && <p>{operationalNote}</p>}
            </div>
          </section>
        )}

        {/* No section __head here: TripPodSubmission already opens with its
            own "e-POD bắt buộc" eyebrow — a second copy stacks duplicate
            labels at the top of the card. */}
        <section className="driver-task-section">
          <TripPodSubmission
            key={trip.id}
            documentNumber={documentNumber}
            tripVersion={trip.version}
            currentSubmission={currentSubmission}
            history={podHistory}
            creatingDraft={creatingDraft}
            uploading={uploadingPod}
            disabled={submitting || completing}
            readOnlyReason={documentReadOnlyReason}
            onBusyChange={setPreparingPod}
            onPendingChange={setPendingFiles}
            onEnsureDraft={handleEnsureDraft}
            onUploadFile={handleUploadPodFile}
          />
        </section>
      </main>

      {trip.status !== TripStatus.COMPLETED && trip.status !== TripStatus.CANCELED && <footer className="driver-task-footer">
        <div className="driver-task-footer__body">
          <div className="driver-task-footer__summary">
            <strong>Hoàn thành chuyến</strong>
            {/* DRV-DET-06 + DRV-DET-05: the screen states that the e-POD is
                mandatory without a second `e-POD bắt buộc` label (the
                TripPodSubmission card above owns that literal), and names the
                uppercase command the driver must press. */}
            <p>
              e-POD là bắt buộc: thêm đủ hai loại chứng từ — Phiếu bãi / phiếu hạ và Biên bản
              giao nhận — rồi bấm HOÀN THÀNH CHUYẾN để gửi hồ sơ và kết thúc lệnh.
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
            disabled={completionBlocked || submitting || completing}
            onClick={() => void handleCompleteTrip()}
          >
            <FileCheck2 size={18} />
            <span>
              {completing || submitting ? 'Đang gửi…' : documentBusy ? 'Đang lưu chứng từ…' : podCompleteCtaLabel(trip.status)}
            </span>
          </button>
        </div>
      </footer>}
    </div>
  );
}

export default DriverTripPodPage;
