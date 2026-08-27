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
  Truck,
  WalletCards,
} from 'lucide-react';
import { DriverProgressEventType, TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import TripPodSubmission from '../components/trip/TripPodSubmission';
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
import { photoSrc } from '../lib/api/photo';
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

function valueOrDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
}

/**
 * Classify a command send error for the offline queue.
 *
 * A 409 (version mismatch, sequencing violation, or a domain conflict such as
 * "vehicle already on another trip") or 428 (precondition required) is a
 * terminal *conflict* — the queue must stop retrying and surface the server's
 * Vietnamese message so the driver understands the blocker. Any other failure
 * (network blip, 5xx, auth) is treated as a retryable *network* error.
 *
 * NOTE: we inspect `ApiError.status`, never the message. The message is a
 * Vietnamese human-readable string and never contains the HTTP status code, so
 * a regex on `error.message` would silently misclassify every API error as a
 * network failure and trap the command in an infinite auto-retry loop.
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

function timelineStateLabel(state: TimelineState): string {
  switch (state) {
    case 'done':
      return 'Đã ghi nhận';
    case 'pending':
      return 'Đang đồng bộ';
    case 'retry':
      return 'Sẽ thử lại';
    case 'conflict':
      return 'Xung đột';
    case 'available':
      return 'Sẵn sàng';
    default:
      return 'Chờ bước trước';
  }
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
  const [uploadingContainerPhoto, setUploadingContainerPhoto] = useState(false);
  const [uploadingSealPhoto, setUploadingSealPhoto] = useState(false);

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
    await runDrain('Chuyến đã chuyển sang chờ kế toán/CUS duyệt phí.', idempotencyKey);
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
      await driverClient.uploadFuelEvidence({
        tripId: trip.id,
        file,
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

  async function handleUploadContainerSealPhoto(type: 'CONTAINER' | 'SEAL', file: File) {
    if (!trip) return;
    const setUploading = type === 'CONTAINER' ? setUploadingContainerPhoto : setUploadingSealPhoto;
    setUploading(true);
    try {
      await driverClient.uploadContainerOrSealPhoto({ tripId: trip.id, type, file });
      await refreshAll();
      toast({ kind: 'success', message: type === 'CONTAINER' ? 'Đã lưu ảnh container.' : 'Đã lưu ảnh seal.' });
    } catch (error) {
      toast({ kind: 'error', message: error instanceof ApiError ? error.message : 'Không thể tải ảnh. Vui lòng thử lại.' });
    } finally {
      setUploading(false);
    }
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
  const contactName = fulfillment?.contactName ?? trip.instructions?.contactName ?? null;
  const contactPhone = fulfillment?.contactPhone ?? trip.instructions?.contactPhone ?? null;
  const siteRules = fulfillment?.siteRules ?? [];
  const invoiceInfo = fulfillment?.invoiceInfo ?? null;
  const containerSealPhotos = fulfillment?.containerSealPhotos ?? [];
  const containerPhotos = containerSealPhotos.filter((photo) => photo.type === 'CONTAINER');
  const sealPhotos = containerSealPhotos.filter((photo) => photo.type === 'SEAL');
  const completionReady = evidence.data?.ready === true
    && getLatestMilestoneEvent(progress.data, DriverProgressEventType.DELIVERED) != null;
  const accountingLock = trip.accountingLock ?? null;
  const completionBlocked = Boolean(accountingLock) || trip.status !== 'IN_TRANSIT' || !completionReady;
  const completionReasons = evidence.data?.missingItems ?? [];
  const paperOrderReady = Boolean(trip.paperOrderCollectedAt && trip.paperOrderCollectedBy);
  const latestFuelEvidence = trip.fuelEvidenceReviews?.[0] ?? null;

  return (
    <div ref={rootRef} className="driver-task-screen">
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
        <div className="driver-task-grid">
          <TaskFact icon={<Truck size={16} />} label="Đầu kéo" value={valueOrDash(trip.truckPlate)} />
          <TaskFact
            icon={<Truck size={16} />}
            label="Rơ moóc"
            value={trip.trailerPlate ? `${trip.trailerPlate}${trip.trailerType ? ` (${trip.trailerType})` : ''}` : '—'}
          />
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={
            trip.containers.length > 0
              ? trip.containers.map((container) => container.containerNumber).join(' · ')
              : valueOrDash(fulfillment?.modeLabel ?? trip.cargoTypeName)
          } />
          <TaskFact icon={<Package2 size={16} />} label="Loại container" value={valueOrDash(trip.containers[0]?.containerTypeName)} />
          <TaskFact icon={<Package2 size={16} />} label="Số seal" value={valueOrDash(trip.containers[0]?.sealNumber)} />
          <TaskFact icon={<Route size={16} />} label="Tuyến" value={valueOrDash(fulfillment?.routeSummary ?? trip.routeName)} />
          <TaskFact icon={<MapPinned size={16} />} label="Điểm lấy" value={pickupPoint} />
          <TaskFact icon={<MapPinned size={16} />} label="Điểm trả" value={dropPoint} />
          <TaskFact icon={<Building2 size={16} />} label="Nhà máy" value={valueOrDash(fulfillment?.factoryName)} />
          <TaskFact icon={<CalendarClock size={16} />} label="Giờ kế hoạch" value={formatDateTime(fulfillment?.plannedAt ?? trip.departureDate)} />
          <TaskFact icon={<Phone size={16} />} label="Người liên hệ" value={valueOrDash(contactName)} />
          <TaskFact
            icon={<Phone size={16} />}
            label="Số điện thoại"
            value={contactPhone ? <a href={`tel:${contactPhone}`} className="driver-task-link">{contactPhone}</a> : '—'}
          />
        </div>
      </section>

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Ảnh Cont / Seal</span>
        </div>
        <div className="driver-task-photo-section" data-testid="container-seal-photo-section">
          {([
            { type: 'CONTAINER' as const, label: 'Cont', photos: containerPhotos, uploading: uploadingContainerPhoto },
            { type: 'SEAL' as const, label: 'Seal', photos: sealPhotos, uploading: uploadingSealPhoto },
          ]).map((group) => (
            <div key={group.type} className="driver-task-photo-card" data-testid={`photo-card-${group.type}`}>
              <div className="driver-task-photo-header">
                <div>
                  <strong className="driver-task-photo-title">{group.label}</strong>
                  <div className="driver-task-photo-subtitle">
                    {group.photos.length > 0
                      ? `${group.photos.length} ảnh · gần nhất ${formatDateTime(group.photos[0].uploadedAt)}`
                      : `Chưa có ảnh ${group.label.toLowerCase()} nào.`}
                  </div>
                </div>
                <label className={`btn btn--secondary btn--sm${group.uploading ? ' is-loading' : ''}`}>
                  <Camera size={16} />
                  <span>Chụp {group.label}</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    disabled={group.uploading}
                    data-testid={`photo-input-${group.type}`}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void handleUploadContainerSealPhoto(group.type, file);
                    }}
                  />
                </label>
              </div>
              {group.photos.length > 0 && (
                <ul className="trip-pod__file-list">
                  {group.photos.map((photo) => (
                    <li key={photo.id} className="trip-pod__file">
                      <img src={photoSrc(photo.storageKey)} alt={`${group.label} ${photo.id}`} className="driver-task-photo-img" />
                      <span className="trip-pod__file-time">{formatDateTime(photo.uploadedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
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
          <span>Quy định tại điểm làm hàng</span>
        </div>
        {siteRules.length > 0 ? (
          <ul className="driver-task-rules">
            {siteRules.map((rule, index) => (
              <li key={`${index}-${rule}`} className="driver-task-rules__item">
                <ShieldAlert size={16} />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="driver-task-empty">Chưa có quy định bổ sung cho điểm làm hàng này.</p>
        )}
      </section>

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Bốn mốc thực hiện</span>
        </div>
        {!paperOrderReady && nextMilestoneIndex === 0 && (
          <div className="driver-task-paper-order">
            <strong className="driver-task-paper-order__title">Nhận lệnh ngay, không cần chờ Ops</strong>
            <span className="driver-task-paper-order__desc">
              Ops chưa xác nhận bàn giao lệnh gốc, nhưng bạn vẫn có thể bấm “Nhận lệnh vận chuyển” — hệ thống sẽ đối chiếu giấy tờ sau.
            </span>
          </div>
        )}
        <div className="driver-task-timeline">
          {MILESTONES.map((milestone, index) => {
            const event = getLatestMilestoneEvent(progress.data, milestone.eventType);
            const command = commandStateForMilestone(tripCommands, trip.fulfillment?.id ?? validFulfillmentId, milestone.eventType);
            const state = timelineState(Boolean(event), command, nextMilestoneIndex, index);
            const clickable = state === 'available' || state === 'retry';
            const isAcceptStep = milestone.eventType === DriverProgressEventType.ORDER_RECEIVED;
            const stepTitle = isAcceptStep && state !== 'done' ? 'Nhận lệnh vận chuyển' : milestone.title;
            return (
              <button
                type="button"
                key={milestone.eventType}
                className={`driver-task-step driver-task-step--${state}`}
                disabled={!clickable}
                onClick={() => void handleMilestone(milestone.eventType)}
              >
                <div className="driver-task-step__top">
                  <span className="driver-task-step__count">Bước {index + 1}</span>
                  <span className="driver-task-step__state">{timelineStateLabel(state)}</span>
                </div>
                <strong className="driver-task-step__title">{stepTitle}</strong>
                <p className="driver-task-step__help">{milestone.help}</p>
                {state === 'conflict' && command?.lastError ? (
                  <p className="driver-task-step__conflict">{command.lastError}</p>
                ) : null}
                <div className="driver-task-step__foot">
                  <span>{event ? formatDateTime(event.occurredAt) : 'Chưa ghi nhận'}</span>
                  {state === 'available' && <span>Nhấn để xác nhận</span>}
                  {state === 'retry' && <span>Nhấn để gửi lại</span>}
                  {state === 'conflict' && <span>Tải lại dữ liệu chuyến</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

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

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          <span>Thu nhập tham chiếu</span>
        </div>
        <div className="driver-task-finance">
          <TaskFact
            icon={<WalletCards size={16} />}
            label="Lương phân bổ"
            value={trip.driverSalary ? formatCurrency(trip.driverSalary) : '—'}
          />
          <TaskFact
            icon={<WalletCards size={16} />}
            label="Tiền đi đường"
            value={trip.totalRoadAllowance ? formatCurrency(trip.totalRoadAllowance) : '—'}
          />
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
              Sau khi ghi nhận đủ bước 3 và gửi e-POD, chuyến sẽ chuyển sang Chờ duyệt phí để kế toán/CUS xử lý.
            </p>
            {completionReasons.length > 0 && (
              <ul className="driver-task-footer__issues">
                {completionReasons.map((item) => (
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
            <span>{trip.status === 'COMPLETED' ? 'Đã gửi chờ duyệt phí' : 'Gửi chờ duyệt phí'}</span>
          </button>
          {completionReady && trip.status === 'IN_TRANSIT' && (
            <div className="driver-task-footer__ready">
              <CheckCircle2 size={16} />
              <span>Đủ điều kiện gửi Kế toán/CUS duyệt phí.</span>
            </div>
          )}
        </div>
      </footer>
      </fieldset>
    </div>
  );
}
