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
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '../hooks/useAuth';
import { useDriverTaskDetail } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { useOnline } from '../hooks/useOnline';
import {
  buildOfflineCommandKey,
  useOfflineCommandQueue,
} from '../features/driver/useOfflineCommandQueue';
import { sendRoleOfflineCommand } from '../features/offline/roleCommandSender';
import { useToast } from '../components/shared/Toast';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import './DriverTripDetailPage.css';
import './DriverTripPodPage.css';

export function DriverTripPodPage() {
  const { id: tripIdParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const online = useOnline();
  const { toast } = useToast();

  const tripId = Number(tripIdParam);
  const validFulfillmentId = Number.isInteger(tripId) && tripId > 0 ? tripId : undefined;

  const taskDetail = useDriverTaskDetail(validFulfillmentId);

  const { rootRef } = usePageAnimations({
    ready: !taskDetail.isLoading,
  });

  const [creatingDraft, setCreatingDraft] = useState(false);
  const [uploadingPod, setUploadingPod] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);

  const { commands, enqueue, drain } = useOfflineCommandQueue({
    maxPending: 12,
    storageScope: user ? `${user.role}:${user.userId}` : null,
  });
  const tripCommands = useMemo(
    () => commands.filter((command) => {
      const p = command.payload as { fulfillmentId?: number } | null;
      return p?.fulfillmentId === validFulfillmentId;
    }),
    [commands, validFulfillmentId],
  );

  // Deps are the refetch function (referentially stable in TanStack v5), not
  // the query result object — a whole-result dep re-creates this callback on
  // every render and re-fires the auto-drain effect below in a loop.
  const refreshAll = useCallback(async () => {
    await taskDetail.refetch();
  }, [taskDetail.refetch]);

  const runDrain = useCallback(
    async (successMessage?: string, currentCommandId?: string) => {
      const result = await drain(sendRoleOfflineCommand);
      const currentStatus = currentCommandId ? result.statusById?.[currentCommandId] : undefined;
      if (currentStatus === 'DONE' || (!currentCommandId && result.done > 0)) {
        await refreshAll();
        if (successMessage && currentStatus === 'DONE') {
          toast({ kind: 'success', message: successMessage });
        }
      } else if (currentStatus === 'FAILED') {
        toast({ kind: 'info', message: 'Đã lưu ngoại tuyến. Hệ thống sẽ tự gửi lại khi có mạng.' });
      } else if (currentStatus === 'CONFLICT' || currentStatus === 'REJECTED') {
        toast({
          kind: 'error',
          message: result.messageById?.[currentCommandId!]
            ?? (currentStatus === 'CONFLICT'
              ? 'Dữ liệu đã đổi trên hệ thống. Vui lòng tải lại chuyến.'
              : 'Máy chủ từ chối lệnh. Bản nháp vẫn được giữ để kiểm tra.'),
        });
      } else if (currentCommandId) {
        toast({ kind: 'info', message: 'Lệnh đang chờ đồng bộ; chưa được xem là hoàn tất.' });
      }
      return result;
    },
    [drain, refreshAll, toast],
  );

  useEffect(() => {
    if (!online || tripCommands.length === 0) return;
    void runDrain();
  }, [online, runDrain, tripCommands.length]);

  const trip = taskDetail.data as DriverTaskDetail | undefined;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;
  const podHistory = trip?.podHistory ?? [];
  // Operational note from CUS / điều vận (spec A3) — same authority chain as
  // the trip detail page (fulfillment.driverNotes first, trip.notes fallback).
  const operationalNote = trip?.fulfillment?.driverNotes ?? trip?.notes ?? null;

  // The two mandatory e-POD categories per 27.8 spec. The driver must upload
  // both before they can hit "Hoàn thành chuyến".
  const { hasYardReceipt, hasSignedNote, podReady } = podRequiredFilesReady(currentSubmission);
  // Same gate the trip-detail footer enforced before the split: an accounting
  // lock freezes the trip — e-POD photos stay visible, completion does not.
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
      const idempotencyKey = buildOfflineCommandKey(
        'driver',
        'task',
        validFulfillmentId,
        'pod-draft',
        'trip-version',
        trip.version,
        'submission-version',
        nextSubmissionVersion,
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
      // TripPodSubmission already compressed this file with the burn-in
      // timestamp before calling — pass it through untouched.
      const uploaded = await driverClient.attachPodFile({
        tripId: validFulfillmentId,
        submissionId: submission.id,
        fileType,
        expectedVersion: submission.version,
        file,
      });
      await refreshAll();
      // Same confirmation the inline e-POD widget gave before the split: the
      // child only surfaces failures, so the page owns the success feedback.
      const label = uploaded.files.find((item) => item.fileType === fileType)?.originalFileName ?? file.name;
      toast({ kind: 'success', message: `Đã lưu tệp ${label}.` });
    } finally {
      setUploadingPod(false);
    }
  }

  async function handleSubmitPod(submission: DriverTaskPodSubmission) {
    if (!trip || !validFulfillmentId) return;
    setSubmitting(true);
    try {
      // Same key shape the trip-detail page used before the split, so a
      // command queued by the old build still dedupes against this one.
      const idempotencyKey = buildOfflineCommandKey(
        'driver',
        'task',
        validFulfillmentId,
        'pod-submit',
        submission.id,
        'version',
        submission.version,
      );
      enqueue({
        id: idempotencyKey,
        endpoint: 'driver.task.pod.submit',
        method: 'POST',
        path: `/driver/me/fulfillments/${validFulfillmentId}/pod/${submission.id}/submit`,
        fulfillmentScopeKey: `fulfillment:${validFulfillmentId}`,
        expectedVersion: submission.version,
        actionKind: 'POD_SUBMIT',
        payload: {
          kind: 'pod-submit',
          fulfillmentId: validFulfillmentId,
          submissionId: submission.id,
          expectedVersion: submission.version,
        },
      });
      await runDrain('Đã gửi e-POD để duyệt.', idempotencyKey);
    } finally {
      setSubmitting(false);
    }
  }

  // The single "Hoàn thành và gửi" action on this page: submit e-POD (if a
  // DRAFT is open) then complete the trip, then jump back to /my-trips.
  async function handleCompleteTrip() {
    if (!trip || !validFulfillmentId) return;
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
        // handleSubmitPod's runDrain already refetches on DONE; an extra
        // serial GET here only delays the complete command on slow links.
        await handleSubmitPod(currentSubmission);
      }
      const idempotencyKey = buildOfflineCommandKey(
        'driver',
        'task',
        validFulfillmentId,
        'complete',
        'version',
        trip.version,
      );
      enqueue({
        id: idempotencyKey,
        endpoint: 'driver.task.complete',
        method: 'POST',
        path: `/driver/me/fulfillments/${validFulfillmentId}/complete`,
        fulfillmentScopeKey: `fulfillment:${validFulfillmentId}`,
        expectedVersion: trip.version,
        actionKind: 'COMPLETE',
        payload: {
          kind: 'complete',
          fulfillmentId: validFulfillmentId,
          expectedVersion: trip.version,
        },
      });
      const result = await runDrain('Hoàn tất chuyến hàng thành công!', idempotencyKey);
      if (result.statusById?.[idempotencyKey] === 'DONE') {
        navigate('/my-trips', { replace: true });
      }
    } finally {
      setCompleting(false);
    }
  }

  const statusLabel = useMemo(() => {
    if (!trip) return '';
    return TRIP_STATUS_LABELS[trip.status] ?? trip.status;
  }, [trip]);

  const handleBack = useCallback(
    () => navigate(validFulfillmentId ? `/my-trips/${validFulfillmentId}` : '/my-trips', { replace: true }),
    [navigate, validFulfillmentId],
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
          <button type="button" className="driver-task-back" onClick={handleBack}>
            <ArrowLeft size={16} />
            <span>Quay lại danh sách</span>
          </button>
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

        <section className="driver-task-section">
          <div className="driver-task-section__head">
            <span>e-POD bắt buộc</span>
          </div>
          <TripPodSubmission
            tripId={trip.id}
            tripCode={trip.tripCode}
            tripVersion={trip.version}
            currentSubmission={currentSubmission}
            history={podHistory}
            pendingCommands={tripCommands}
            creatingDraft={creatingDraft}
            uploading={uploadingPod}
            onEnsureDraft={handleEnsureDraft}
            onUploadFile={handleUploadPodFile}
            onSubmit={handleSubmitPod}
          />
        </section>
      </main>

      <footer className="driver-task-footer">
        <div className="driver-task-footer__body">
          <div className="driver-task-footer__summary">
            <strong>HOÀN THÀNH CHUYẾN</strong>
            <p>
              Tải đủ 2 ảnh e-POD bắt buộc, rồi bấm "HOÀN THÀNH CHUYẾN" — hệ thống gửi e-POD và chuyển
              chuyến sang Chờ duyệt phí.
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
              {completing || submitting
                ? 'Đang gửi…'
                : trip.status === 'COMPLETED'
                  ? 'Đã hoàn thành chuyến'
                  : 'HOÀN THÀNH CHUYẾN'}
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}

export default DriverTripPodPage;
