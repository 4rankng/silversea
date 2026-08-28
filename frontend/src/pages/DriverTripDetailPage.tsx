import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  MapPinned,
  Package2,
  Phone,
  Route,
  ShieldAlert,
  StickyNote,
  Truck,
} from 'lucide-react';
import { DriverProgressEventType, DRIVER_PROGRESS_EVENT_LABELS, TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import TripPodSubmission from '../components/trip/TripPodSubmission';
import { DriverContainerCard } from '../components/trip/DriverContainerCard';
import { ShipmentCostEntryForm } from '../components/trip/ShipmentCostEntryForm';
import { FuelRefillReportForm } from '../components/trip/FuelRefillReportForm';
import { isShipmentCostEntryEnabled } from '../lib/featureFlags';
import { tripStatusVariant } from '../lib/tripStatus';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useAuth } from '../hooks/useAuth';
import { useDriverEvidenceStatus, useDriverTaskDetail, useDriverTaskProgress } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { ApiError } from '../lib/api';
import { compressImageFile } from '../lib/imageCompression';
import { formatCurrency, formatDateTimeShort } from '../lib/format';
import { useOnline } from '../hooks/useOnline';
import { useGeolocation } from '../hooks/useGeolocation';
import { getLocationPermissionIssue, isGeolocationError } from '../lib/gps/geolocation';
import {
  buildOfflineCommandKey,
  type OfflineCommand,
  useOfflineCommandQueue,
} from '../features/driver/useOfflineCommandQueue';
import { sendRoleOfflineCommand } from '../features/offline/roleCommandSender';
import { useToast } from '../components/shared/Toast';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import './DriverTripDetailPage.css';

type MilestoneType =
  | DriverProgressEventType.ORDER_RECEIVED
  | DriverProgressEventType.PICKED_UP
  | DriverProgressEventType.LOADING_OR_RETURNING
  | DriverProgressEventType.DELIVERED;

type MilestoneCommandPayload = {
  kind: 'milestone';
  fulfillmentId: number;
  eventType: MilestoneType;
  occurredAt: string;
  expectedVersion: number;
};

type PodSubmitCommandPayload = {
  kind: 'pod-submit';
  fulfillmentId: number;
  submissionId: number;
  expectedVersion: number;
};

type CompleteCommandPayload = {
  kind: 'complete';
  fulfillmentId: number;
  expectedVersion: number;
};

type DriverTaskCommandPayload =
  | MilestoneCommandPayload
  | PodSubmitCommandPayload
  | CompleteCommandPayload;

type TimelineState = 'done' | 'pending' | 'retry' | 'conflict' | 'available' | 'locked';

const MILESTONES: Array<{
  eventType: MilestoneType;
  title: string;
  help: string;
}> = [
  {
    eventType: DriverProgressEventType.ORDER_RECEIVED,
    title: 'Đã nhận lệnh gốc',
    help: 'Xác nhận đã nhận lệnh giấy từ Ops. Thời điểm này được lưu để theo dõi SLA bàn giao.',
  },
  {
    eventType: DriverProgressEventType.PICKED_UP,
    title: 'Đã lấy vỏ / Lấy hàng',
    help: 'Ghi nhận khi đã nhận vỏ hoặc lấy hàng xong tại điểm đầu.',
  },
  {
    eventType: DriverProgressEventType.LOADING_OR_RETURNING,
    title: 'Đang đóng / Trả hàng',
    help: 'Ghi nhận khi vào giai đoạn đóng hàng hoặc xử lý trả hàng.',
  },
  {
    eventType: DriverProgressEventType.DELIVERED,
    title: 'Đã hạ bãi / Giao hàng xong',
    help: 'Ghi nhận sau khi hạ bãi hoặc giao hàng hoàn tất.',
  },
];

const FUEL_EVIDENCE_OUTCOME_LABELS = {
  ACCEPTED: 'Ảnh bơm hợp lệ',
  UNREADABLE: 'Ảnh mờ hoặc không đọc được',
  MULTI_SCREEN: 'Ảnh có nhiều màn hình',
  NON_PUMP: 'Ảnh không phải màn hình bơm',
  ANOMALY: 'Số liệu cần kế toán soát',
} as const;

const FUEL_EVIDENCE_REVIEW_LABELS = {
  PENDING: 'Chờ kế toán xác nhận',
  CONFIRMED: 'Kế toán đã xác nhận',
  REJECTED: 'Kế toán từ chối',
} as const;

const formatDateTime = formatDateTimeShort;

// Post-accept milestone labels. The driver UI no longer records these
// (27.8 A5 removed the milestone timeline); the backend completion endpoint
// auto-records them on the driver's behalf, so they are never shown as
// pre-click blockers.
const AUTO_RECORDED_MILESTONE_LABELS = new Set([
  DRIVER_PROGRESS_EVENT_LABELS.PICKED_UP,
  DRIVER_PROGRESS_EVENT_LABELS.LOADING_OR_RETURNING,
  DRIVER_PROGRESS_EVENT_LABELS.DELIVERED,
]);

function valueOrDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

/**
 * Classify a fuel-evidence upload error for the driver.
 *
 * A 409 (version mismatch, sequencing violation, or a domain conflict such as
 * "vehicle already on another trip") or 428 (precondition required) is a
 * terminal *conflict* — surface the server's Vietnamese message so the driver
 * understands the blocker. Geolocation failures map to actionable permission
 * hints. Any other failure (network blip, 5xx, auth) falls back to a generic
 * retry message.
 *
 * NOTE: we inspect `ApiError.status`, never the message. The message is a
 * Vietnamese human-readable string and never contains the HTTP status code, so
 * a regex on `error.message` would silently misclassify every API error.
 */
function fuelEvidenceUploadErrorMessage(error: unknown): string {
  if (isGeolocationError(error)) {
    const issue = getLocationPermissionIssue(error);
    switch (issue.type) {
      case 'denied':
        return 'Chưa được cấp quyền vị trí. Hãy cho phép GPS rồi chụp lại ảnh nhiên liệu.';
      case 'timeout':
        return 'GPS phản hồi chậm. Vui lòng thử lại khi thiết bị bắt vị trí tốt hơn.';
      case 'unavailable':
        return 'Thiết bị chưa bắt được GPS. Vui lòng thử lại ở nơi có tín hiệu tốt hơn.';
      case 'inaccurate':
        return 'GPS chưa đủ chính xác để lưu ảnh nhiên liệu. Vui lòng thử lại.';
      default:
        return 'Thiết bị không hỗ trợ GPS để lưu ảnh nhiên liệu.';
    }
  }
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message
    ? error.message
    : 'Không thể tải ảnh nhiên liệu. Vui lòng thử lại.';
}

function getLatestMilestoneEvent(
  trip: ReturnType<typeof useDriverTaskProgress>['data'],
  eventType: MilestoneType,
) {
  return [...(trip?.items ?? [])]
    .reverse()
    .find((item) => item.eventType === eventType);
}

function isCommandPayload(
  payload: Record<string, unknown> | null,
): payload is DriverTaskCommandPayload {
  return payload != null && typeof payload.kind === 'string' && typeof payload.fulfillmentId === 'number';
}

function isMilestonePayload(payload: Record<string, unknown> | null): payload is MilestoneCommandPayload {
  return isCommandPayload(payload)
    && payload.kind === 'milestone'
    && typeof payload.eventType === 'string'
    && typeof payload.occurredAt === 'string'
    && typeof payload.expectedVersion === 'number';
}

function commandStateForMilestone(
  commands: OfflineCommand[],
  fulfillmentId: number,
  eventType: MilestoneType,
): OfflineCommand | null {
  return commands.find((command) =>
    command.endpoint === 'driver.task.milestone'
    && isMilestonePayload(command.payload)
    && command.payload.fulfillmentId === fulfillmentId
    && command.payload.eventType === eventType,
  ) ?? null;
}

function timelineState(eventFound: boolean, command: OfflineCommand | null, nextMilestoneIndex: number, index: number): TimelineState {
  if (eventFound) return 'done';
  if (command?.status === 'CONFLICT') return 'conflict';
  if (command?.status === 'FAILED') return 'retry';
  if (command && (command.status === 'QUEUED' || command.status === 'IN_PROGRESS')) return 'pending';
  if (nextMilestoneIndex === index) return 'available';
  return 'locked';
}

function TaskFact({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="driver-task-fact">
      <span className="driver-task-fact__icon">{icon}</span>
      <div className="driver-task-fact__body">
        <div className="driver-task-fact__label">{label}</div>
        <div className="driver-task-fact__value">{value}</div>
      </div>
    </div>
  );
}

export default function DriverTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const online = useOnline();
  const geolocation = useGeolocation();
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [uploadingPod, setUploadingPod] = useState(false);
  const [uploadingFuelEvidence, setUploadingFuelEvidence] = useState(false);

  const fulfillmentId = Number(id);
  const validFulfillmentId = Number.isInteger(fulfillmentId) && fulfillmentId > 0 ? fulfillmentId : undefined;

  const taskDetail = useDriverTaskDetail(validFulfillmentId);
  const progress = useDriverTaskProgress(validFulfillmentId);
  const evidence = useDriverEvidenceStatus(validFulfillmentId);
  const { commands, enqueue, drain, pendingCount, failedCount, conflictCount } = useOfflineCommandQueue({
    maxPending: 12,
    storageScope: user ? `${user.role}:${user.userId}` : null,
  });
  const { rootRef } = usePageAnimations({
    ready: !taskDetail.isLoading && !progress.isLoading && !evidence.isLoading,
  });

  const handleBack = useCallback(() => navigate('/my-trips'), [navigate]);
  useBackShortcut(handleBack);

  const tripCommands = useMemo(() => commands.filter((command) =>
    isCommandPayload(command.payload) && command.payload.fulfillmentId === validFulfillmentId,
  ), [commands, validFulfillmentId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      taskDetail.refetch(),
      progress.refetch(),
      evidence.refetch(),
    ]);
  }, [evidence, progress, taskDetail]);

  const runDrain = useCallback(async (successMessage?: string, currentCommandId?: string) => {
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
        message: result.messageById?.[currentCommandId!] ?? (currentStatus === 'CONFLICT' ? 'Dữ liệu đã đổi trên hệ thống. Vui lòng tải lại chuyến.' : 'Máy chủ từ chối lệnh. Bản nháp vẫn được giữ để kiểm tra.'),
      });
    } else if (currentCommandId) {
      toast({ kind: 'info', message: 'Lệnh đang chờ đồng bộ; chưa được xem là hoàn tất.' });
    }
    return result;
  }, [drain, refreshAll, toast]);

  useEffect(() => {
    if (!online || tripCommands.length === 0) return;
    void runDrain();
  }, [online, runDrain, tripCommands.length]);

  const trip = taskDetail.data as DriverTaskDetail | undefined;
  const currentSubmission = (trip?.currentPod ?? null) as DriverTaskPodSubmission | null;
  const podHistory = trip?.podHistory ?? [];

  const latestCompletedIndex = useMemo(() => {
    let index = -1;
    for (const [milestoneIndex, milestone] of MILESTONES.entries()) {
      if (getLatestMilestoneEvent(progress.data, milestone.eventType)) {
        index = milestoneIndex;
      }
    }
    return index;
  }, [progress.data]);

  const nextMilestoneIndex = latestCompletedIndex >= MILESTONES.length - 1 ? -1 : latestCompletedIndex + 1;

  async function handleMilestone(eventType: MilestoneType) {
    if (!trip) return;
    const milestoneIndex = MILESTONES.findIndex((milestone) => milestone.eventType === eventType);
    if (milestoneIndex !== nextMilestoneIndex) return;
    const idempotencyKey = buildOfflineCommandKey('driver', 'task', validFulfillmentId, 'milestone', eventType, 'version', trip.version);
    enqueue({
      id: idempotencyKey,
      endpoint: 'driver.task.milestone',
      method: 'POST',
      path: `/driver/me/fulfillments/${validFulfillmentId}/progress`,
      fulfillmentScopeKey: `fulfillment:${validFulfillmentId}`,
      expectedVersion: trip.version,
      actionKind: `MILESTONE_${eventType}`,
      payload: {
        kind: 'milestone',
        fulfillmentId: validFulfillmentId,
        eventType,
        occurredAt: new Date().toISOString(),
        expectedVersion: trip.version,
      },
    });
    await runDrain('Đã ghi nhận mốc tiến độ.', idempotencyKey);
  }

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

  async function handleUploadPodFile(submission: DriverTaskPodSubmission, fileType: Parameters<typeof driverClient.attachPodFile>[0]['fileType'], file: File) {
    if (!validFulfillmentId) throw new Error('Không thể xác định tác vụ giao hàng.');
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

  async function handleSubmitPod(submission: DriverTaskPodSubmission) {
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
  }

  async function handleCompleteTrip() {
    if (!trip) return;
    // Spec (Phần 4): "HOÀN THÀNH CHUYẾN" is a single action — submit e-POD
    // then complete the trip. The separate "Gửi e-POD" step is removed.
    if (currentSubmission?.status === 'DRAFT') {
      await handleSubmitPod(currentSubmission);
      // Re-fetch to get the updated submission status after e-POD submit.
      await refreshAll();
    }
    const idempotencyKey = buildOfflineCommandKey('driver', 'task', validFulfillmentId, 'complete', 'version', trip.version);
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
    const result = await runDrain('Chuyến đã hoàn thành.', idempotencyKey);
    // Spec A7: completing a trip jumps the driver off this screen. The e-POD
    // upload happens *before* completion in this flow, so the destination is
    // the journey board, where the trip lands in the Lịch sử bucket. Only a
    // confirmed-online completion navigates; a queued or still-syncing
    // command keeps the driver on this screen.
    if (result.statusById?.[idempotencyKey] === 'DONE') {
      navigate('/my-trips', { replace: true });
    }
  }

  async function handleUploadFuelEvidence(file: File) {
    if (!trip) return;
    if (!online) {
      toast({ kind: 'warning', message: 'Cần có mạng để gửi ảnh nhiên liệu cho kế toán.' });
      return;
    }
    setUploadingFuelEvidence(true);
    try {
      const location = await geolocation.awaitAccurateSample();
      const prepared = await compressImageFile(file, { timestamp: new Date() });
      await driverClient.uploadFuelEvidence({
        tripId: trip.id,
        file: prepared,
        location: {
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          timestamp: location.timestamp,
          source: 'phone',
        },
      });
      await refreshAll();
      toast({ kind: 'success', message: 'Đã lưu ảnh nhiên liệu và chuyển kế toán soát OCR.' });
    } catch (error) {
      toast({ kind: 'error', message: fuelEvidenceUploadErrorMessage(error) });
    } finally {
      setUploadingFuelEvidence(false);
    }
  }

  // Spec A6: after a container save, refetch so the read-only bento view and
  // photo keys reflect the persisted row.
  function handleContainerSaved() {
    void refreshAll();
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
        <div className="driver-task-feedback">
          <Loader2 size={24} className="spin" />
          <p>Đang tải tác vụ tài xế…</p>
        </div>
      </div>
    );
  }

  if (!trip || taskDetail.error) {
    return (
      <div className="driver-task-screen driver-task-screen--feedback">
        <div className="driver-task-feedback">
          <AlertTriangle size={28} />
          <p>Không thể tải lệnh vận chuyển này.</p>
          <button type="button" className="driver-task-back" onClick={handleBack}>
            <ArrowLeft size={16} />
            <span>Quay lại danh sách</span>
          </button>
        </div>
      </div>
    );
  }

  const fulfillment = trip.fulfillment ?? null;
  const pickupPoint = fulfillment?.pickupPortName ?? fulfillment?.pickupWarehouseName ?? fulfillment?.lclWarehouseName ?? '—';
  const dropPoint = fulfillment?.dropPortName ?? fulfillment?.dropWarehouseName ?? fulfillment?.lclWarehouseName ?? '—';
  // Spec A4: container number, type and seal share one line (same idiom as
  // the journey-board card).
  const containerLine = trip.containers.length > 0
    ? trip.containers.map((container) => [
        container.containerNumber,
        container.containerTypeName,
        container.sealNumber ? `Seal ${container.sealNumber}` : null,
      ].filter(Boolean).join(' · ') || '—').join(' · ')
    : valueOrDash(fulfillment?.modeLabel ?? trip.cargoTypeName);
  const contactName = fulfillment?.contactName ?? trip.instructions?.contactName ?? null;
  const contactPhone = fulfillment?.contactPhone ?? trip.instructions?.contactPhone ?? null;
  const siteRules = fulfillment?.siteRules ?? [];
  // Khối 5 (spec): site rules plus the shipment-level note CUS wrote for the
  // driver ("note dành cho lái xe") — both belong on this section.
  const driverNotes = fulfillment?.driverNotes ?? trip.notes ?? null;
  const invoiceInfo = fulfillment?.invoiceInfo ?? null;
  const containerSealPhotos = fulfillment?.containerSealPhotos ?? [];
  const contPhotoKey = containerSealPhotos.find((p) => p.type === 'CONTAINER')?.storageKey ?? null;
  const sealPhotoKey = containerSealPhotos.find((p) => p.type === 'SEAL')?.storageKey ?? null;
  const accountingLock = trip.accountingLock ?? null;
  // Spec (Phần 4): "HOÀN THÀNH CHUYẾN" requires both e-POD photos uploaded.
  const podFilesByType = currentSubmission?.files ?? [];
  const hasYardReceipt = podFilesByType.some((f) => f.fileType === 'YARD_OR_DROP_RECEIPT');
  const hasSignedNote = podFilesByType.some((f) => f.fileType === 'SIGNED_DELIVERY_NOTE');
  const podReady = hasYardReceipt && hasSignedNote;
  // The single-action flow submits the draft e-POD itself inside the click
  // handler, so the button gate must NOT demand an already-submitted e-POD
  // (evidence.data.ready includes "e-POD đã gửi") — that deadlocked the driver
  // at 100% with no separate submit button left. Post-accept milestones are
  // the same class: the driver UI no longer records them (27.8 A5 removed the
  // milestone timeline), and the backend completion endpoint auto-records
  // PICKED_UP → DELIVERED on the driver's behalf before re-validating
  // evidence. So the pre-click contract is: both photos uploaded + IN_TRANSIT
  // + no accounting lock; everything else resolves inside the action.
  const completionBlocked = Boolean(accountingLock) || trip.status !== 'IN_TRANSIT' || !podReady;
  const completionReasons = evidence.data?.missingItems ?? [];
  // Labels that resolve the moment the single-action button is pressed (the
  // handler submits the draft e-POD, and completion auto-records milestones) —
  // showing them as blockers next to an enabled button reads as a
  // contradiction.
  const blockingReasons = completionReasons.filter((item) => !(
    (podReady && item.label.includes('đã gửi'))
    || AUTO_RECORDED_MILESTONE_LABELS.has(item.label)
  ));
  const latestFuelEvidence = trip.fuelEvidenceReviews?.[0] ?? null;

  // Layer 2 Block 7: "Nhận lệnh vận chuyển" is a sticky button pinned to the
  // bottom of the screen (spec: "Ghim cố định nút bấm ở đáy màn hình"), not
  // an inline timeline step — computed here from the same milestone state
  // machine the timeline uses, scoped to the ORDER_RECEIVED (index 0) step.
  const acceptEvent = getLatestMilestoneEvent(progress.data, DriverProgressEventType.ORDER_RECEIVED);
  const acceptCommand = commandStateForMilestone(tripCommands, trip.fulfillment?.id ?? validFulfillmentId, DriverProgressEventType.ORDER_RECEIVED);
  const acceptState = timelineState(Boolean(acceptEvent), acceptCommand, nextMilestoneIndex, 0);
  const showAcceptStickyBar = acceptState !== 'done';
  const acceptClickable = acceptState === 'available' || acceptState === 'retry';
  const acceptButtonLabel = acceptState === 'pending'
    ? 'Đang gửi…'
    : acceptState === 'retry'
      ? 'Thử gửi lại'
      : acceptState === 'conflict'
        ? 'Tải lại để xử lý xung đột'
        : 'Nhận lệnh vận chuyển';

  return (
    <div ref={rootRef} className={`driver-task-screen${showAcceptStickyBar ? ' driver-task-screen--has-accept-bar' : ''}`}>
      <header className="driver-task-header">
        <button type="button" className="driver-task-back" onClick={handleBack} aria-label="Quay lại">
          <ArrowLeft size={18} />
        </button>
        <div className="driver-task-header__body">
          <p className="driver-task-header__eyebrow">Tác vụ tài xế</p>
          <h1 className="driver-task-header__title">{trip.routeName || 'Lệnh vận chuyển'}</h1>
          <div className="driver-task-header__meta">
            <StatusPill variant={tripStatusVariant(trip.status)}>
              {TRIP_STATUS_LABELS[trip.status] || trip.status}
            </StatusPill>
            {trip.customerName && <span className="driver-task-header__customer">{trip.customerName}</span>}
          </div>
        </div>
      </header>

      {(pendingCount > 0 || failedCount > 0 || conflictCount > 0) && (
        <section className="driver-task-section driver-task-section--banner">
          <div className="driver-task-sync">
            <Clock3 size={16} />
            <div>
              <strong>Đồng bộ hiện trường</strong>
              <p>
                {pendingCount > 0 && `${pendingCount} lệnh đang chờ gửi. `}
                {failedCount > 0 && `${failedCount} lệnh sẽ thử lại. `}
                {conflictCount > 0 && `${conflictCount} lệnh cần tải lại để xử lý xung đột.`}
              </p>
            </div>
          </div>
        </section>
      )}

      {accountingLock && <AccountingLockBanner lock={accountingLock} />}

      <fieldset disabled={Boolean(accountingLock)} className="driver-task-fieldset">

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Thông tin lệnh</span>
        </div>
        {/* Spec A4 field order (matches the journey-board card): Ngày giờ kế
            hoạch → Nhà máy → Tuyến → Người liên hệ → SĐT → Container/loại
            cont/số seal (one line) → điểm nâng → điểm hạ → Đầu kéo → Mooc. */}
        <div className="driver-task-grid">
          <TaskFact icon={<CalendarClock size={16} />} label="Ngày giờ kế hoạch" value={formatDateTime(fulfillment?.plannedAt ?? trip.departureDate)} />
          <TaskFact icon={<Building2 size={16} />} label="Nhà máy" value={valueOrDash(fulfillment?.factoryName)} />
          <TaskFact icon={<Route size={16} />} label="Tuyến" value={valueOrDash(fulfillment?.routeSummary ?? trip.routeName)} />
          <TaskFact icon={<Phone size={16} />} label="Người liên hệ" value={valueOrDash(contactName)} />
          <TaskFact
            icon={<Phone size={16} />}
            label="Số điện thoại"
            value={contactPhone ? <a href={`tel:${contactPhone}`} className="driver-task-link">{contactPhone}</a> : '—'}
          />
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={containerLine} />
          <TaskFact icon={<MapPinned size={16} />} label="Điểm lấy" value={pickupPoint} />
          <TaskFact icon={<MapPinned size={16} />} label="Điểm trả" value={dropPoint} />
          <TaskFact icon={<Truck size={16} />} label="Đầu kéo" value={valueOrDash(trip.truckPlate)} />
          <TaskFact
            icon={<Truck size={16} />}
            label="Rơ moóc"
            value={trip.trailerPlate ? `${trip.trailerPlate}${trip.trailerType ? ` (${trip.trailerType})` : ''}` : '—'}
          />
        </div>
      </section>

      <section className="driver-task-section">
        <DriverContainerCard
          tripId={trip.id}
          containers={trip.containers}
          contPhotoKey={contPhotoKey}
          sealPhotoKey={sealPhotoKey}
          tradeDirection={trip.tradeDirection ?? null}
          onSaved={handleContainerSaved}
        />
      </section>

      {invoiceInfo && (
        <section className="driver-task-section">
          <div className="driver-task-section__head">
            <span>Thông tin hóa đơn</span>
          </div>
          <div className="driver-task-grid">
            {invoiceInfo.liftFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí nâng" value={`${invoiceInfo.liftFeeInvoiceName}${invoiceInfo.liftFeeTaxCode ? ` · MST ${invoiceInfo.liftFeeTaxCode}` : ''}`} />
            )}
            {invoiceInfo.dropFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí hạ" value={`${invoiceInfo.dropFeeInvoiceName}${invoiceInfo.dropFeeTaxCode ? ` · MST ${invoiceInfo.dropFeeTaxCode}` : ''}`} />
            )}
            {invoiceInfo.cleaningInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn vệ sinh cont" value={`${invoiceInfo.cleaningInvoiceName}${invoiceInfo.cleaningTaxCode ? ` · MST ${invoiceInfo.cleaningTaxCode}` : ''}`} />
            )}
          </div>
        </section>
      )}

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Ghi chú</span>
        </div>
        {driverNotes ? (
          <p className="driver-task-rules__note" data-testid="driver-task-driver-notes">
            <StickyNote size={16} />
            <span>{driverNotes}</span>
          </p>
        ) : null}
        {siteRules.length > 0 ? (
          <ul className="driver-task-rules">
            {siteRules.map((rule, index) => (
              <li key={`${index}-${rule}`} className="driver-task-rules__item">
                <ShieldAlert size={16} />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        ) : driverNotes ? null : (
          <p className="driver-task-empty">Chưa có ghi chú cho chuyến này.</p>
        )}
      </section>

      {/* Spec (Phần 1, Lưu ý xây dựng app): Tạm thời ẨN module Chi phí
          (Frontend) — Bốn mốc thực hiện + Thu nhập tham chiếu không render.
          Ảnh nhiên liệu được PHỤC HỒI theo 27.8 spec ("GIỮ NGUYÊN"). Backend
          vẫn giữ schema + endpoints (driver_incidental_costs /
          fuel_evidence_reviews / driver_salary / total_road_allowance) cho
          phase tiếp theo. */}
      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>e-POD giao hàng</span>
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

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Ảnh nhiên liệu</span>
        </div>
        <div className="driver-task-fuel-section">
          <div className="driver-task-fuel-card">
            <div className="driver-task-fuel-header">
              <div>
                <strong className="driver-task-fuel-title">Chụp màn hình bơm gần nhất</strong>
                <div className="driver-task-fuel-subtitle">
                  {latestFuelEvidence
                    ? `${FUEL_EVIDENCE_OUTCOME_LABELS[latestFuelEvidence.ocrOutcome]} · ${FUEL_EVIDENCE_REVIEW_LABELS[latestFuelEvidence.reviewStatus]}`
                    : 'Chưa có ảnh nhiên liệu nào cho chuyến này.'}
                </div>
              </div>
              <label className={`btn btn--secondary btn--sm${uploadingFuelEvidence ? ' is-loading driver-task-fuel-loading' : ''}`}>
                <Camera size={16} />
                <span>{latestFuelEvidence ? 'Chụp lại ảnh mới' : 'Chụp ảnh nhiên liệu'}</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  disabled={uploadingFuelEvidence}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void handleUploadFuelEvidence(file);
                  }}
                />
              </label>
            </div>

            {!online && (
              <div className="driver-task-fuel-offline">
                Thiết bị đang ngoại tuyến. Ảnh nhiên liệu chỉ gửi được khi có mạng.
              </div>
            )}

            {latestFuelEvidence && (
              <div className="driver-task-fuel-details">
                <div className="driver-task-fuel-grid">
                  <img
                    src={latestFuelEvidence.photoUrl}
                    alt={`Ảnh nhiên liệu ${trip.tripCode ?? trip.id}`}
                    className="driver-task-fuel-img"
                  />
                  <div className="driver-task-fuel-facts">
                    <div><strong>Thời điểm chụp:</strong> {formatDateTime(latestFuelEvidence.capturedAt)}</div>
                    <div><strong>Lít:</strong> {latestFuelEvidence.litres ?? '—'}</div>
                    <div><strong>Đơn giá:</strong> {latestFuelEvidence.unitPrice ? formatCurrency(latestFuelEvidence.unitPrice) : '—'}</div>
                    <div><strong>Thành tiền:</strong> {latestFuelEvidence.totalAmount ? formatCurrency(latestFuelEvidence.totalAmount) : '—'}</div>
                    <div><strong>Tính lại:</strong> {latestFuelEvidence.computedTotal ? formatCurrency(latestFuelEvidence.computedTotal) : '—'}</div>
                    <div><strong>GPS:</strong> {latestFuelEvidence.latitude && latestFuelEvidence.longitude ? `${latestFuelEvidence.latitude}, ${latestFuelEvidence.longitude}` : 'Chưa có'}</div>
                  </div>
                </div>
                {(latestFuelEvidence.anomalyReason || latestFuelEvidence.ocrError || latestFuelEvidence.reviewNote) && (
                  <div className="driver-task-fuel-notes">
                    {latestFuelEvidence.anomalyReason && <div><strong>Lưu ý OCR:</strong> {latestFuelEvidence.anomalyReason}</div>}
                    {latestFuelEvidence.ocrError && <div><strong>Lỗi OCR:</strong> {latestFuelEvidence.ocrError}</div>}
                    {latestFuelEvidence.reviewNote && <div><strong>Ghi chú kế toán:</strong> {latestFuelEvidence.reviewNote}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {trip.legs.length > 0 && (
        <section className="driver-task-section driver-task-section--legs">
          <div className="driver-task-section__head">
            <span>Lộ trình chi tiết</span>
          </div>
          <TripLegsPanel legs={trip.legs} />
        </section>
      )}

      {isShipmentCostEntryEnabled() && (
        <section className="driver-task-section">
          <ShipmentCostEntryForm tripId={trip.id} />
        </section>
      )}

      {isShipmentCostEntryEnabled() && (
        <section className="driver-task-section">
          <FuelRefillReportForm tripId={trip.id} />
        </section>
      )}

      <footer className="driver-task-footer">
        <div className="driver-task-footer__body">
          <div className="driver-task-footer__summary">
            <strong>Hoàn thành chuyến</strong>
            <p>
              Tải đủ 2 ảnh e-POD bắt buộc, ghi nhận đủ mốc, rồi bấm "Hoàn thành chuyến" — hệ thống gửi e-POD và chuyển chuyến sang Chờ duyệt phí.
            </p>
            {(blockingReasons.length > 0) && (
              <ul className="driver-task-footer__issues">
                {!hasYardReceipt && <li>Thiếu Phiếu bãi / phiếu hạ</li>}
                {!hasSignedNote && <li>Thiếu Biên bản giao nhận</li>}
                {blockingReasons.map((item) => (
                  <li key={item.code}>{item.label}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="driver-task-complete"
            disabled={completionBlocked}
            onClick={() => void handleCompleteTrip()}
          >
            <FileCheck2 size={18} />
            <span>{trip.status === 'COMPLETED' ? 'Đã hoàn thành chuyến' : 'Hoàn thành chuyến'}</span>
          </button>
          {podReady && trip.status === 'IN_TRANSIT' && (
            <div className="driver-task-footer__ready">
              <CheckCircle2 size={16} />
              <span>Đủ điều kiện hoàn thành chuyến.</span>
            </div>
          )}
        </div>
      </footer>

      {showAcceptStickyBar && (
        <div className="driver-task-accept-sticky" data-testid="accept-sticky-bar">
          <div className="driver-task-accept-sticky__inner">
            <button
              type="button"
              className="driver-task-accept-sticky__btn"
              disabled={!acceptClickable}
              onClick={() => void handleMilestone(DriverProgressEventType.ORDER_RECEIVED)}
            >
              {acceptState === 'pending' ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
              <span>{acceptButtonLabel}</span>
            </button>
          </div>
        </div>
      )}
      </fieldset>
    </div>
  );
}
