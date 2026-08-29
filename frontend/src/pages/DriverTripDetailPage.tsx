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
  Zap,
} from 'lucide-react';
import { DriverProgressEventType, TRIP_STATUS_LABELS } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import { DriverContainerCard } from '../components/trip/DriverContainerCard';
import { tripStatusVariant } from '../lib/tripStatus';
import { podRequiredFilesReady } from '../lib/podReadiness';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useAuth } from '../hooks/useAuth';
import { useDriverTaskDetail, useDriverTaskProgress } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { ApiError, getAuthenticatedPhotoUrl } from '../lib/api';
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
import { ContainerScanner, dataUrlToFile } from '../components/shared/ContainerScanner';
import './DriverTripDetailPage.css';

type MilestoneType = DriverProgressEventType.ORDER_RECEIVED;

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

// Spec AC-DETAIL-003: BỎ HOÀN TOÀN 4 mốc thực hiện truyền thống. Only the
// ORDER_RECEIVED action remains — the driver accepts the dispatch order in one
// tap. No check-in milestones for pickup, loading, or delivery.
const MILESTONES: Array<{
  eventType: MilestoneType;
  title: string;
  help: string;
}> = [
  {
    eventType: DriverProgressEventType.ORDER_RECEIVED,
    title: 'Đã nhận lệnh',
    help: 'Xác nhận đã nhận lệnh vận chuyển. Thời điểm này được lưu để theo dõi SLA.',
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

function TaskFact({ icon, label, value, fullWidth }: { icon: React.ReactNode; label: string; value: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`driver-task-fact${fullWidth ? ' driver-task-fact--full' : ''}`}>
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
  const [uploadingFuelEvidence, setUploadingFuelEvidence] = useState(false);
  // 27.8 "GIỮ NGUYÊN" fuel screenshot — captured through the same fullscreen
  // scanner overlay as the e-POD photos (vantaiphucloc pattern) instead of a
  // bare <input capture>, so camera-denied devices still get the gallery.
  const [fuelScanning, setFuelScanning] = useState(false);

  const fulfillmentId = Number(id);
  const validFulfillmentId = Number.isInteger(fulfillmentId) && fulfillmentId > 0 ? fulfillmentId : undefined;

  const taskDetail = useDriverTaskDetail(validFulfillmentId);
  const progress = useDriverTaskProgress(validFulfillmentId);
  const { commands, enqueue, drain, remove, pendingCount, failedCount, conflictCount } = useOfflineCommandQueue({
    maxPending: 12,
    storageScope: user ? `${user.role}:${user.userId}` : null,
  });
  const { rootRef } = usePageAnimations({
    ready: !taskDetail.isLoading && !progress.isLoading,
  });

  const handleBack = useCallback(() => navigate('/my-trips'), [navigate]);
  useBackShortcut(handleBack);

  const tripCommands = useMemo(() => commands.filter((command) =>
    isCommandPayload(command.payload) && command.payload.fulfillmentId === validFulfillmentId,
  ), [commands, validFulfillmentId]);

  // Deps are the refetch functions (referentially stable in TanStack v5), not
  // the query result objects — whole-result deps re-create this callback on
  // every render and re-fire the auto-drain effect below in a loop.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      taskDetail.refetch(),
      progress.refetch(),
    ]);
  }, [progress.refetch, taskDetail.refetch]);

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

  // D1 fix: a terminal CONFLICT on the accept command used to dead-end the
  // sticky bar (button relabelled but stayed disabled forever, no dismissal
  // UI anywhere). Reloading now discards this fulfillment's CONFLICT commands
  // — the server is the source of truth; if the blocker (e.g. truck busy on
  // another running trip) has cleared, the bar returns to available.
  async function handleConflictReload() {
    const stuck = tripCommands.filter((command) => command.status === 'CONFLICT');
    stuck.forEach((command) => remove(command.id));
    await refreshAll();
    toast({
      kind: stuck.length > 0 ? 'success' : 'info',
      message: stuck.length > 0
        ? 'Đã tải lại chuyến và bỏ lệnh xung đột. Thử nhận lại nếu xe đã rảnh.'
        : 'Đã tải lại dữ liệu chuyến.',
    });
  }

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
  // Spec (Phần 4): the completion gate lives on the e-POD screen
  // (/my-trips/:id/pod) — this page only links there. The footer still
  // surfaces the two mandatory-photo gaps so the driver knows what is missing
  // before tapping through.
  const { hasYardReceipt, hasSignedNote, podReady } = podRequiredFilesReady(currentSubmission);
  const latestFuelEvidence = trip.fuelEvidenceReviews?.[0] ?? null;

  // Layer 2 Block 7: "Nhận lệnh vận chuyển" is a sticky button pinned to the
  // bottom of the screen (spec: "Ghim cố định nút bấm ở đáy màn hình"), not
  // an inline timeline step — computed here from the same milestone state
  // machine the timeline uses, scoped to the ORDER_RECEIVED (index 0) step.
  const acceptEvent = getLatestMilestoneEvent(progress.data, DriverProgressEventType.ORDER_RECEIVED);
  const acceptCommand = commandStateForMilestone(tripCommands, trip.fulfillment?.id ?? validFulfillmentId, DriverProgressEventType.ORDER_RECEIVED);
  const acceptState = timelineState(Boolean(acceptEvent), acceptCommand, nextMilestoneIndex, 0);
  const showAcceptStickyBar = acceptState !== 'done';
  // 'conflict' must stay clickable (D1): the click reloads the trip and
  // discards the stuck command instead of accepting — see handleConflictReload.
  const acceptClickable = acceptState === 'available' || acceptState === 'retry' || acceptState === 'conflict';
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

      {/* Spec Phần 3 / AC-DISPATCH-002: the Ops field-confirmation step is
          bypassed while the Ops module is unfinished — tell the driver the
          order is acceptable immediately instead of leaving them guessing. */}
      {acceptState === 'available' && (
        <section className="driver-task-section driver-task-section--banner" data-testid="bypass-ops-banner">
          <div className="driver-task-bypass">
            <Zap size={16} />
            <div>
              <strong>Nhận lệnh ngay, không cần chờ Ops</strong>
              <p>App tạm bỏ qua xác nhận hiện trường — bấm nhận lệnh để bắt đầu chuyến.</p>
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
          {/* Nhà máy stays paired with Ngày giờ kế hoạch: under the locked A4
              order a fullWidth here leaves row 1's right column empty (auto
              placement never backfills). Long factory names wrap within the
              half column — verified at 390px. */}
          <TaskFact icon={<Building2 size={16} />} label="Nhà máy" value={valueOrDash(fulfillment?.factoryName)} />
          <TaskFact icon={<Route size={16} />} label="Tuyến" value={valueOrDash(fulfillment?.routeSummary ?? trip.routeName)} fullWidth />
          <TaskFact icon={<Phone size={16} />} label="Người liên hệ" value={valueOrDash(contactName)} />
          <TaskFact
            icon={<Phone size={16} />}
            label="Số điện thoại"
            value={contactPhone ? <a href={`tel:${contactPhone}`} className="driver-task-link">{contactPhone}</a> : '—'}
          />
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={containerLine} fullWidth />
          <TaskFact icon={<MapPinned size={16} />} label="Điểm lấy" value={pickupPoint} fullWidth />
          <TaskFact icon={<MapPinned size={16} />} label="Điểm trả" value={dropPoint} fullWidth />
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
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí nâng" value={`${invoiceInfo.liftFeeInvoiceName}${invoiceInfo.liftFeeTaxCode ? ` · MST ${invoiceInfo.liftFeeTaxCode}` : ''}`} fullWidth />
            )}
            {invoiceInfo.dropFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí hạ" value={`${invoiceInfo.dropFeeInvoiceName}${invoiceInfo.dropFeeTaxCode ? ` · MST ${invoiceInfo.dropFeeTaxCode}` : ''}`} fullWidth />
            )}
            {invoiceInfo.cleaningInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn vệ sinh cont" value={`${invoiceInfo.cleaningInvoiceName}${invoiceInfo.cleaningTaxCode ? ` · MST ${invoiceInfo.cleaningTaxCode}` : ''}`} fullWidth />
            )}
          </div>
        </section>
      )}

      <section className="driver-task-section">
        <div className="driver-task-section__head">
          {/* 27.8 spec — "Ô 'Quy định tại điểm làm hàng' → Ghi chú: Mục ghi
              chú này nhận thông tin từ ghi chú cus/điều vận trên hệ thống
              'ghi chú cho lái xe'". Renamed to surface the spec wording. */}
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
          <p className="driver-task-empty">Chưa có ghi chú cho chuyến này.</p>
        )}
      </section>

      {/* Phần 4 ticket 2026-08-28: e-POD moved to its own screen
          (/my-trips/:id/pod) so the driver focuses on the two mandatory
          photos (Phiếu bãi/hạ + Biên bản giao nhận). The "Hoàn thành"
          CTA at the bottom navigates there. The cost-entry form is hidden
          here per the trial-readiness plan ("kế toán từ từ"). Backend
          schema + endpoints for both are retained for the post-trial phase. */}
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
              <button
                type="button"
                className={`btn btn--secondary btn--sm driver-task-fuel-btn${uploadingFuelEvidence ? ' is-loading driver-task-fuel-loading' : ''}`}
                disabled={uploadingFuelEvidence}
                onClick={() => setFuelScanning(true)}
              >
                <Camera size={16} />
                <span>{latestFuelEvidence ? 'Chụp lại ảnh mới' : 'Chụp ảnh nhiên liệu'}</span>
              </button>
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
                    src={getAuthenticatedPhotoUrl(latestFuelEvidence.photoUrl)}
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

      {/* Phần 1 ticket: BOTH cost forms ("Nhập chi phí lô hàng" and "Báo cáo
          đổ dầu") are coded but temporarily hidden — kế toán tài chính is the
          post-trial phase. Backend schema + endpoints retained. 27.8's
          "GIỮ NGUYÊN" covers the fuel SCREENSHOT upload below, not this form. */}

      <footer className="driver-task-footer">
        <div className="driver-task-footer__body">
          <div className="driver-task-footer__summary">
            <strong>Hoàn tất lệnh vận chuyển</strong>
            <p>
              Tải đủ 2 ảnh e-POD bắt buộc trên màn e-POD, rồi bấm "HOÀN THÀNH CHUYẾN" ở đó — hệ thống
              gửi e-POD và chốt chuyến hoàn thành (CUS + Điều vận sẽ thấy trạng thái "Hoàn thành" ngay).
            </p>
            {(!hasYardReceipt || !hasSignedNote) && (
              <ul className="driver-task-footer__issues">
                {!hasYardReceipt && <li>Thiếu Phiếu bãi / phiếu hạ</li>}
                {!hasSignedNote && <li>Thiếu Biên bản giao nhận</li>}
              </ul>
            )}
          </div>
          {trip.status === 'IN_TRANSIT' ? (
            <button
              type="button"
              className="driver-task-complete"
              onClick={() => navigate(`/my-trips/${validFulfillmentId}/pod`)}
            >
              <FileCheck2 size={18} />
              <span>Hoàn tất lệnh vận chuyển</span>
            </button>
          ) : (
            <button type="button" className="driver-task-complete" disabled>
              <FileCheck2 size={18} />
              <span>{trip.status === 'COMPLETED' ? 'Đã hoàn thành chuyến' : 'HOÀN THÀNH CHUYẾN'}</span>
            </button>
          )}
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
              onClick={() => void (acceptState === 'conflict'
                ? handleConflictReload()
                : handleMilestone(DriverProgressEventType.ORDER_RECEIVED))}
            >
              {acceptState === 'pending' ? <Loader2 size={18} className="spin" /> : <CheckCircle2 size={18} />}
              <span>{acceptButtonLabel}</span>
            </button>
          </div>
        </div>
      )}
      </fieldset>

      {fuelScanning && (
        <ContainerScanner
          onCapture={(dataUrl) => {
            setFuelScanning(false);
            void handleUploadFuelEvidence(dataUrlToFile(dataUrl, 'fuel-pump.jpg'));
          }}
          onClose={() => setFuelScanning(false)}
        />
      )}
    </div>
  );
}
