import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarClock,
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
import { DriverProgressEventType, TRIP_STATUS_LABELS, type TripStatus } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import TripPodSubmission from '../components/trip/TripPodSubmission';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useAuth } from '../hooks/useAuth';
import { useDriverEvidenceStatus, useDriverTaskDetail, useDriverTaskProgress } from '../hooks/useDriverQueries';
import { driverClient, type DriverTaskDetail, type DriverTaskPodSubmission } from '../api/driverClient';
import { formatCurrency } from '../lib/format';
import { useOnline } from '../hooks/useOnline';
import {
  buildOfflineCommandKey,
  type OfflineCommand,
  type OfflineCommandSendResult,
  useOfflineCommandQueue,
} from '../features/driver/useOfflineCommandQueue';
import { useToast } from '../components/shared/Toast';
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

function tripStatusVariant(status: TripStatus): 'neutral' | 'info' | 'warn' | 'success' | 'danger' {
  switch (status) {
    case 'IN_TRANSIT':
      return 'info';
    case 'COMPLETED':
      return 'success';
    case 'CANCELED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

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

function isPodSubmitPayload(payload: Record<string, unknown> | null): payload is PodSubmitCommandPayload {
  return isCommandPayload(payload)
    && payload.kind === 'pod-submit'
    && typeof payload.submissionId === 'number'
    && typeof payload.expectedVersion === 'number';
}

function isCompletePayload(payload: Record<string, unknown> | null): payload is CompleteCommandPayload {
  return isCommandPayload(payload)
    && payload.kind === 'complete'
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

  const sendQueuedCommand = useCallback(async (command: OfflineCommand): Promise<OfflineCommandSendResult> => {
    if (command.endpoint === 'driver.task.milestone' && isMilestonePayload(command.payload)) {
      try {
        await driverClient.recordProgress(command.payload.fulfillmentId, {
          eventType: command.payload.eventType,
          occurredAt: command.payload.occurredAt,
          expectedVersion: command.payload.expectedVersion,
          fulfillmentId: command.payload.fulfillmentId,
        }, command.id);
        return { ok: true };
      } catch (error) {
        if (error instanceof Error && /409|428/.test(error.message)) {
          return { ok: false, kind: 'conflict', message: error.message };
        }
        return {
          ok: false,
          kind: 'network',
          message: error instanceof Error ? error.message : 'Không thể đồng bộ mốc tiến độ.',
        };
      }
    }

    if (command.endpoint === 'driver.task.pod.submit' && isPodSubmitPayload(command.payload)) {
      try {
        await driverClient.submitPod(
          command.payload.fulfillmentId,
          command.payload.submissionId,
          { expectedVersion: command.payload.expectedVersion },
          command.id,
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof Error && /409|428/.test(error.message)) {
          return { ok: false, kind: 'conflict', message: error.message };
        }
        return {
          ok: false,
          kind: 'network',
          message: error instanceof Error ? error.message : 'Không thể gửi e-POD.',
        };
      }
    }

    if (command.endpoint === 'driver.task.complete' && isCompletePayload(command.payload)) {
      try {
        await driverClient.completeTrip(
          command.payload.fulfillmentId,
          { expectedVersion: command.payload.expectedVersion },
          command.id,
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof Error && /409|428/.test(error.message)) {
          return { ok: false, kind: 'conflict', message: error.message };
        }
        return {
          ok: false,
          kind: 'network',
          message: error instanceof Error ? error.message : 'Không thể hoàn thành chuyến.',
        };
      }
    }

    return { ok: false, kind: 'conflict', message: 'Lệnh đồng bộ không hợp lệ.' };
  }, []);

  const runDrain = useCallback(async (successMessage?: string) => {
    const result = await drain(sendQueuedCommand);
    if (result.done > 0) {
      await refreshAll();
      if (successMessage) {
        toast({ kind: 'success', message: successMessage });
      }
    } else if (result.failed > 0) {
      toast({ kind: 'info', message: 'Đã lưu ngoại tuyến. Hệ thống sẽ tự gửi lại khi có mạng.' });
    } else if (result.conflicts > 0) {
      toast({ kind: 'error', message: 'Dữ liệu đã đổi trên hệ thống. Vui lòng tải lại chuyến.' });
    }
    return result;
  }, [drain, refreshAll, sendQueuedCommand, toast]);

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
      payload: {
        kind: 'milestone',
        fulfillmentId: validFulfillmentId,
        eventType,
        occurredAt: new Date().toISOString(),
        expectedVersion: trip.version,
      },
    });
    await runDrain('Đã ghi nhận mốc tiến độ.');
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
      payload: {
        kind: 'pod-submit',
        fulfillmentId: validFulfillmentId,
        submissionId: submission.id,
        expectedVersion: submission.version,
      },
    });
    await runDrain('Đã gửi e-POD để duyệt.');
  }

  async function handleCompleteTrip() {
    if (!trip) return;
    const idempotencyKey = buildOfflineCommandKey('driver', 'task', validFulfillmentId, 'complete', 'version', trip.version);
    enqueue({
      id: idempotencyKey,
      endpoint: 'driver.task.complete',
      method: 'POST',
      path: `/driver/me/fulfillments/${validFulfillmentId}/complete`,
      payload: {
        kind: 'complete',
        fulfillmentId: validFulfillmentId,
        expectedVersion: trip.version,
      },
    });
    await runDrain('Chuyến đã chuyển sang chờ kế toán/CUS duyệt phí.');
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
  const completionReady = evidence.data?.ready === true
    && getLatestMilestoneEvent(progress.data, DriverProgressEventType.DELIVERED) != null;
  const completionBlocked = trip.status !== 'IN_TRANSIT' || !completionReady;
  const completionReasons = evidence.data?.missingItems ?? [];

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
        <div className="driver-task-timeline">
          {MILESTONES.map((milestone, index) => {
            const event = getLatestMilestoneEvent(progress.data, milestone.eventType);
            const command = commandStateForMilestone(tripCommands, trip.fulfillment?.id ?? validFulfillmentId, milestone.eventType);
            const state = timelineState(Boolean(event), command, nextMilestoneIndex, index);
            const clickable = state === 'available' || state === 'retry';
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
                <strong className="driver-task-step__title">{milestone.title}</strong>
                <p className="driver-task-step__help">{milestone.help}</p>
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
    </div>
  );
}
