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
import { DriverProgressEventType, TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import TripPodSubmission from '../components/trip/TripPodSubmission';
import { ShipmentCostEntryForm } from '../components/trip/ShipmentCostEntryForm';
import { FuelRefillReportForm } from '../components/trip/FuelRefillReportForm';
import { isShipmentCostEntryEnabled } from '../lib/featureFlags';
import { compressImageFile } from '../lib/imageCompression';
import { tripStatusVariant } from '../lib/tripStatus';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useAuth } from '../hooks/useAuth';
import { useDriverEvidenceStatus, useDriverTaskDetail, useDriverTaskProgress } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { ApiError } from '../lib/api';
import { photoSrc } from '../lib/api/photo';
import { formatDateTimeShort } from '../lib/format';
import { useOnline } from '../hooks/useOnline';
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

const formatDateTime = formatDateTimeShort;

function valueOrDash(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : '—';
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
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [uploadingPod, setUploadingPod] = useState(false);
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
    await runDrain('Chuyến đã hoàn thành.', idempotencyKey);
  }

  async function handleUploadContainerSealPhoto(type: 'CONTAINER' | 'SEAL', file: File) {
    if (!trip) return;
    const setUploading = type === 'CONTAINER' ? setUploadingContainerPhoto : setUploadingSealPhoto;
    setUploading(true);
    try {
      // Spec (Khối 2): cont/seal photos must carry the capture timestamp in
      // the image, and every driver photo upload is compressed on-device.
      const prepared = await compressImageFile(file, { timestamp: new Date() });
      await driverClient.uploadContainerOrSealPhoto({ tripId: trip.id, type, file: prepared });
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
  // Khối 5 (spec): site rules plus the shipment-level note CUS wrote for the
  // driver ("note dành cho lái xe") — both belong on this section.
  const driverNotes = fulfillment?.driverNotes ?? trip.notes ?? null;
  const invoiceInfo = fulfillment?.invoiceInfo ?? null;
  const containerSealPhotos = fulfillment?.containerSealPhotos ?? [];
  const containerPhotos = containerSealPhotos.filter((photo) => photo.type === 'CONTAINER');
  const sealPhotos = containerSealPhotos.filter((photo) => photo.type === 'SEAL');
  const completionReady = evidence.data?.ready === true
    && getLatestMilestoneEvent(progress.data, DriverProgressEventType.DELIVERED) != null;
  const accountingLock = trip.accountingLock ?? null;
  // Spec (Phần 4): "HOÀN THÀNH CHUYẾN" requires both e-POD photos uploaded.
  const podFilesByType = currentSubmission?.files ?? [];
  const hasYardReceipt = podFilesByType.some((f) => f.fileType === 'YARD_OR_DROP_RECEIPT');
  const hasSignedNote = podFilesByType.some((f) => f.fileType === 'SIGNED_DELIVERY_NOTE');
  const podReady = hasYardReceipt && hasSignedNote;
  // The single-action flow submits the draft e-POD itself inside the click
  // handler, so the button gate must NOT demand an already-submitted e-POD
  // (evidence.data.ready includes "e-POD đã gửi") — that deadlocks the driver
  // at 100% with no separate submit button left. Milestones + both photos +
  // IN_TRANSIT + no accounting lock is the correct pre-click contract; the
  // backend re-validates everything after the submit half of the action.
  const delivered = getLatestMilestoneEvent(progress.data, DriverProgressEventType.DELIVERED) != null;
  const completionBlocked = Boolean(accountingLock) || trip.status !== 'IN_TRANSIT' || !delivered || !podReady;
  const completionReasons = evidence.data?.missingItems ?? [];
  // "e-POD đã gửi" resolves the moment the single-action button is pressed
  // (the handler submits the draft first) — showing it as a blocker next to
  // an enabled button reads as a contradiction.
  const blockingReasons = completionReasons.filter((item) => !(podReady && item.label.includes('đã gửi')));
  const paperOrderReady = Boolean(trip.paperOrderCollectedAt && trip.paperOrderCollectedBy);

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
          <p className="driver-task-empty">Chưa có quy định bổ sung cho điểm làm hàng này.</p>
        )}
      </section>

      {/* Spec (Phần 1, Lưu ý xây dựng app): Tạm thời ẨN module Chi phí
          (Frontend). Bốn mốc thực hiện + Ảnh nhiên liệu + Thu nhập tham chiếu
          không render trên UI. Backend vẫn giữ schema + endpoints (xem
          driver_incidental_costs / fuel_evidence_reviews / driver_salary /
          total_road_allowance) cho phase tiếp theo. */}
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
          {delivered && podReady && trip.status === 'IN_TRANSIT' && (
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
