import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, Search, Send, Truck } from 'lucide-react';
import { EmptyState, SelectField, TextField } from '../design-system';
import {
  getDispatchFleet,
  issueDispatchOrder,
  listDispatchHandoffs,
  listDispatchQueue,
  resolveDispatchHandoff,
  type DispatchFleet,
  type DispatchHandoffItem,
  type DispatchQueueItem,
} from '../api/dispatchPlanningClient';
import { formatVietnamDateTimeInput, localDateTimeToIso } from '../lib/shipment-operations';
import './DispatchPage.css';

type MobilePane = 'TASKS' | 'FLEET' | 'DETAIL';

interface AssignmentForm {
  carrierType: 'OWN' | 'EXTERNAL';
  truckId: string;
  driverId: string;
  trailerId: string;
  externalCarrierId: string;
  externalPlateNumber: string;
  externalDriverName: string;
  externalDriverPhone: string;
  plannedStartAt: string;
  plannedEndAt: string;
  endTimeConfirmed: boolean;
}

interface TaskCursorState {
  handoffCursor: string | null;
  queueCursor: string | null;
}

const TASK_PAGE_LIMIT = 50;
const FLEET_PAGE_LIMIT = 100;
const INITIAL_TASK_CURSOR: TaskCursorState = { handoffCursor: null, queueCursor: null };

const EMPTY_ASSIGNMENT: AssignmentForm = {
  carrierType: 'OWN',
  truckId: '',
  driverId: '',
  trailerId: '',
  externalCarrierId: '',
  externalPlateNumber: '',
  externalDriverName: '',
  externalDriverPhone: '',
  plannedStartAt: '',
  plannedEndAt: '',
  endTimeConfirmed: false,
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function DetailLine({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="dispatch-detail-line"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

function computePlannedEndAt(plannedStartAt: string, serviceDurationMinutes: number | null | undefined): string {
  if (!plannedStartAt || serviceDurationMinutes == null) return '';
  try {
    const plannedStartIso = localDateTimeToIso(plannedStartAt);
    if (!plannedStartIso) return '';
    return formatVietnamDateTimeInput(new Date(new Date(plannedStartIso).getTime() + serviceDurationMinutes * 60_000));
  } catch {
    return '';
  }
}

function normalizeFleet(resources: DispatchFleet | null): DispatchFleet | null {
  if (!resources) return null;
  const loadedDrivers = resources.drivers.slice(0, FLEET_PAGE_LIMIT);
  return {
    ...resources,
    drivers: loadedDrivers,
    trucks: resources.trucks.slice(0, FLEET_PAGE_LIMIT).map((truck) => {
      const assigned = loadedDrivers.find((driver) => driver.assignedTruckId === truck.id);
      return {
        ...truck,
        assignedDriverId: assigned?.id ?? null,
        assignedDriverName: assigned?.name ?? null,
      };
    }),
  };
}

function isFleetAccessDenied(reason: unknown) {
  const message = reason instanceof Error ? reason.message : '';
  return /không được xem đội xe điều phối|không có quyền xem bảng điều phối|403/i.test(message);
}

export default function DispatchPage() {
  const [items, setItems] = useState<DispatchQueueItem[]>([]);
  const [fleet, setFleet] = useState<DispatchFleet | null>(null);
  const [handoffs, setHandoffs] = useState<DispatchHandoffItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [urgency, setUrgency] = useState<'' | 'NORMAL' | 'URGENT'>('');
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('TASKS');
  const [assignment, setAssignment] = useState<AssignmentForm>(EMPTY_ASSIGNMENT);
  const [truckSearch, setTruckSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [carrierSearch, setCarrierSearch] = useState('');
  const [fleetAccessDenied, setFleetAccessDenied] = useState(false);
  const [taskTotals, setTaskTotals] = useState({ handoffs: 0, queue: 0, ready: 0, dispatched: 0 });
  const [taskCursorStack, setTaskCursorStack] = useState<TaskCursorState[]>([INITIAL_TASK_CURSOR]);
  const [taskPageIndex, setTaskPageIndex] = useState(0);
  const [nextTaskCursor, setNextTaskCursor] = useState<TaskCursorState | null>(null);
  const loadRequestIdRef = useRef(0);

  const currentTaskCursor = taskCursorStack[taskPageIndex] ?? INITIAL_TASK_CURSOR;
  const selected = useMemo(() => items.find((item) => item.fulfillmentId === selectedId) ?? null, [items, selectedId]);
  const taskCountLoaded = handoffs.length + items.length;
  const activeTrucks = fleet?.trucks.filter((truck) => truck.status === 'ACTIVE') ?? [];
  const eligibleDrivers = fleet?.drivers.filter((driver) => driver.status === 'ACTIVE' && driver.userId != null) ?? [];
  const filteredTrucks = activeTrucks.filter((truck) => truck.licensePlate.toLowerCase().includes(truckSearch.trim().toLowerCase()));
  const filteredDrivers = eligibleDrivers.filter((driver) => driver.name.toLowerCase().includes(driverSearch.trim().toLowerCase()));
  const filteredExternalCarriers = (fleet?.externalCarriers ?? []).filter((carrier) => carrier.name.toLowerCase().includes(carrierSearch.trim().toLowerCase()));

  const load = useCallback(async (cursorState: TaskCursorState) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const inbox = await listDispatchHandoffs({
        cursor: cursorState.handoffCursor,
        limit: TASK_PAGE_LIMIT,
        q: searchQuery || undefined,
        urgency,
      });
      const remainingQueueSlots = Math.max(0, TASK_PAGE_LIMIT - inbox.items.length);
      const queue = await listDispatchQueue({
        cursor: cursorState.queueCursor,
        limit: Math.max(remainingQueueSlots, 1),
        status: ['READY', 'DISPATCHED'],
        q: searchQuery || undefined,
        urgency,
      });
      const resources = await getDispatchFleet().catch((reason) => {
        if (isFleetAccessDenied(reason)) return null;
        throw reason;
      });
      if (requestId !== loadRequestIdRef.current) return;

      const queueItems = remainingQueueSlots > 0 ? queue.items.slice(0, remainingQueueSlots) : [];
      const normalizedFleet = normalizeFleet(resources);
      setHandoffs(inbox.items);
      setItems(queueItems);
      setFleet(normalizedFleet);
      setFleetAccessDenied(resources == null);
      setTaskTotals({
        handoffs: inbox.page.total,
        queue: queue.page.total,
        ready: queue.page.readyCount,
        dispatched: queue.page.dispatchedCount,
      });
      const nextCursor = inbox.page.nextCursor
        ? { handoffCursor: inbox.page.nextCursor, queueCursor: cursorState.queueCursor }
        : queue.page.nextCursor
          ? { handoffCursor: null, queueCursor: queue.page.nextCursor }
          : null;
      setNextTaskCursor(nextCursor);
      setSelectedId((current) => current && queueItems.some((item) => item.fulfillmentId === current)
        ? current
        : queueItems[0]?.fulfillmentId ?? null);
    } catch (reason) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Không thể tải bảng điều phối');
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [searchQuery, urgency]);

  useEffect(() => {
    setTaskCursorStack([INITIAL_TASK_CURSOR]);
    setTaskPageIndex(0);
    setNextTaskCursor(null);
  }, [searchQuery, urgency]);

  useEffect(() => {
    void load(currentTaskCursor);
  }, [currentTaskCursor, load]);

  useEffect(() => {
    if (!selected) {
      setAssignment(EMPTY_ASSIGNMENT);
      return;
    }
    setAssignment({
      ...EMPTY_ASSIGNMENT,
      carrierType: selected.dispatch?.carrierType ?? 'OWN',
      truckId: selected.dispatch?.truckId ? String(selected.dispatch.truckId) : '',
      driverId: selected.dispatch?.driverId ? String(selected.dispatch.driverId) : '',
      trailerId: selected.dispatch?.trailerId ? String(selected.dispatch.trailerId) : '',
      externalCarrierId: selected.dispatch?.externalCarrierId ? String(selected.dispatch.externalCarrierId) : '',
      externalPlateNumber: selected.dispatch?.externalPlateNumber ?? '',
      externalDriverName: selected.dispatch?.externalDriverName ?? '',
      externalDriverPhone: selected.dispatch?.externalDriverPhone ?? '',
      plannedStartAt: formatVietnamDateTimeInput(selected.dispatch?.plannedStartAt ?? null),
      plannedEndAt: formatVietnamDateTimeInput(selected.dispatch?.plannedEndAt ?? null),
      endTimeConfirmed: selected.route.serviceDurationMinutes == null && Boolean(selected.dispatch?.plannedEndAt),
    });
    setTruckSearch('');
    setDriverSearch('');
    setCarrierSearch('');
  }, [selected]);

  useEffect(() => {
    if (!selected || selected.route.serviceDurationMinutes == null || !assignment.plannedStartAt) return;
    const computedEndAt = computePlannedEndAt(assignment.plannedStartAt, selected.route.serviceDurationMinutes);
    if (!computedEndAt) return;
    setAssignment((current) => current.plannedEndAt === computedEndAt && current.endTimeConfirmed === false
      ? current
      : { ...current, plannedEndAt: computedEndAt, endTimeConfirmed: false });
  }, [assignment.plannedStartAt, selected]);

  function update<K extends keyof AssignmentForm>(key: K, value: AssignmentForm[K]) {
    setAssignment((current) => ({ ...current, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  function goToNextTaskPage() {
    if (!nextTaskCursor) return;
    setTaskCursorStack((current) => {
      const nextStack = current.slice(0, taskPageIndex + 1);
      nextStack.push(nextTaskCursor);
      return nextStack;
    });
    setTaskPageIndex((current) => current + 1);
    setMobilePane('TASKS');
  }

  function goToPreviousTaskPage() {
    if (taskPageIndex === 0) return;
    setTaskPageIndex((current) => current - 1);
    setMobilePane('TASKS');
  }

  async function issue() {
    if (!selected) return;
    const derivedEndAt = selected.route.serviceDurationMinutes == null
      ? assignment.plannedEndAt
      : computePlannedEndAt(assignment.plannedStartAt, selected.route.serviceDurationMinutes);
    if (!assignment.plannedStartAt || !derivedEndAt) {
      setError('Vui lòng nhập giờ bắt đầu và giờ kết thúc dự kiến');
      return;
    }
    if (assignment.carrierType === 'OWN' && (!assignment.truckId || !assignment.driverId)) {
      setError('Vui lòng chọn rõ xe và lái xe');
      return;
    }
    if (
      assignment.carrierType === 'EXTERNAL'
      && (!assignment.externalCarrierId || !assignment.externalPlateNumber || !assignment.externalDriverName)
    ) {
      setError('Vui lòng chọn nhà xe và nhập biển số, tên lái xe');
      return;
    }
    if (selected.route.serviceDurationMinutes == null && !assignment.endTimeConfirmed) {
      setError('Tuyến chưa có thời lượng chuẩn; cần xác nhận giờ kết thúc đã nhập');
      return;
    }

    setIssuing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await issueDispatchOrder(selected, {
        plannedStartAt: localDateTimeToIso(assignment.plannedStartAt)!,
        plannedEndAt: localDateTimeToIso(derivedEndAt)!,
        endTimeConfirmed: selected.route.serviceDurationMinutes == null ? assignment.endTimeConfirmed : false,
        carrierType: assignment.carrierType,
        truckId: assignment.carrierType === 'OWN' ? Number(assignment.truckId) : null,
        driverId: assignment.carrierType === 'OWN' ? Number(assignment.driverId) : null,
        trailerId: assignment.carrierType === 'OWN' && assignment.trailerId ? Number(assignment.trailerId) : null,
        externalCarrierId: assignment.carrierType === 'EXTERNAL' ? Number(assignment.externalCarrierId) : null,
        externalPlateNumber: assignment.carrierType === 'EXTERNAL' ? assignment.externalPlateNumber : null,
        externalDriverName: assignment.carrierType === 'EXTERNAL' ? assignment.externalDriverName : null,
        externalDriverPhone: assignment.carrierType === 'EXTERNAL' ? assignment.externalDriverPhone || null : null,
      });
      setSuccess(`Đã phát hành lệnh ${result.trip.tripCode} và gửi thông báo trong ứng dụng.`);
      await load(currentTaskCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể phát hành lệnh điều xe');
    } finally {
      setIssuing(false);
    }
  }

  async function acceptHandoff(handoff: DispatchHandoffItem) {
    setError(null);
    setSuccess(null);
    try {
      await resolveDispatchHandoff(handoff, 'ACCEPTED');
      setSuccess(`Đã tiếp nhận lô ${handoff.shipment.code || handoff.shipment.bookingRef || handoff.shipmentId} và tạo tác vụ điều phối.`);
      await load(currentTaskCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tiếp nhận lô hàng');
    }
  }

  return (
    <div className="dispatch-workbench">
      <header className="dispatch-workbench__header">
        <div>
          <div className="dispatch-workbench__eyebrow">Bảng kế hoạch</div>
          <h1>Điều phối chuyến xe</h1>
          <p>Mỗi container FCL là một tác vụ; mỗi lô LCL là một tác vụ.</p>
        </div>
        <button type="button" onClick={() => void load(currentTaskCursor)} disabled={loading} className="dispatch-icon-button">
          <RefreshCw size={18} /> Tải lại
        </button>
      </header>
      <div className="dispatch-toolbar">
        <label>
          <span>Tìm tác vụ</span>
          <div className="dispatch-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') setSearchQuery(query.trim()); }}
              placeholder="Khách hàng, booking, container…"
            />
          </div>
        </label>
        <SelectField label="Mức ưu tiên" value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}>
          <option value="">Tất cả</option>
          <option value="URGENT">Gấp</option>
          <option value="NORMAL">Bình thường</option>
        </SelectField>
        <button type="button" onClick={() => setSearchQuery(query.trim())} className="dispatch-search-button">Tìm kiếm</button>
      </div>
      <div className="dispatch-mobile-tabs" role="tablist" aria-label="Khu vực điều phối">
        {([
          ['TASKS', `Tác vụ (${taskTotals.handoffs + taskTotals.queue})`],
          ['FLEET', fleetAccessDenied ? 'Đội xe (ẩn)' : `Đội xe (${fleet?.page.totalTrucks ?? 0})`],
          ['DETAIL', 'Chi tiết'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={mobilePane === value} onClick={() => setMobilePane(value)}>
            {label}
          </button>
        ))}
      </div>
      {error && <div role="alert" className="dispatch-message dispatch-message--error"><AlertTriangle size={18} />{error}</div>}
      {success && <div role="status" className="dispatch-message dispatch-message--success"><CheckCircle2 size={18} />{success}</div>}

      <div className="dispatch-workbench__grid">
        <section className={`dispatch-pane dispatch-pane--tasks ${mobilePane === 'TASKS' ? 'is-mobile-active' : ''}`} aria-label="Danh sách tác vụ">
          <div className="dispatch-pane__head">
            <strong>Tác vụ chờ điều phối</strong>
            <span>{taskCountLoaded}/{TASK_PAGE_LIMIT} đang tải · {taskTotals.handoffs + taskTotals.queue} tổng</span>
          </div>
          <div className="dispatch-pane__scroll">
            {loading ? <div className="dispatch-loading">Đang tải…</div> : handoffs.length === 0 && items.length === 0 ? <EmptyState title="Không có tác vụ chờ điều phối" description="Các lô hợp lệ từ CUS sẽ xuất hiện tại đây." /> : <>
              {handoffs.map((handoff) => (
                <div key={`handoff-${handoff.handoffId}`} className="dispatch-handoff">
                  <div>
                    <span className="dispatch-urgent">Lô mới</span>
                    <strong>{handoff.shipment.code || handoff.shipment.bookingRef || `Lô #${handoff.shipmentId}`}</strong>
                    <small>
                      {handoff.customer.name} · {handoff.shipment.cargoMode === 'FCL' ? `${handoff.summary.containerNumbers.length} container` : handoff.summary.lclLabel}
                    </small>
                  </div>
                  <button type="button" onClick={() => void acceptHandoff(handoff)}>Tiếp nhận</button>
                </div>
              ))}
              {items.map((item) => (
                <button
                  key={item.fulfillmentId}
                  type="button"
                  className={`dispatch-task ${selectedId === item.fulfillmentId ? 'is-selected' : ''}`}
                  onClick={() => { setSelectedId(item.fulfillmentId); setMobilePane('DETAIL'); }}
                >
                  <div className="dispatch-task__top">
                    <strong>{item.unitSummary.label}</strong>
                    <span className={item.taskStatus === 'DISPATCHED' ? '' : 'dispatch-urgent'}>
                      {item.taskStatus === 'DISPATCHED' ? 'Đã phát hành' : item.urgency === 'URGENT' ? 'Gấp' : 'Sẵn sàng'}
                    </span>
                  </div>
                  <div>{item.customer.name}</div>
                  <small>{item.route.name}</small>
                  <div className="dispatch-task__dates">
                    <span>Cut-off: {formatDateTime(item.shipment.customsCutoffAt)}</span>
                    <span>Đóng: {formatDateTime(item.shipment.closingAt)}</span>
                  </div>
                </button>
              ))}
            </>}
          </div>
          <div className="dispatch-pane__head">
            <span>Sẵn sàng {taskTotals.ready} · Đã phát hành {taskTotals.dispatched}</span>
            <div>
              <button type="button" onClick={goToPreviousTaskPage} disabled={loading || taskPageIndex === 0}>Trang trước</button>
              <button type="button" onClick={goToNextTaskPage} disabled={loading || nextTaskCursor == null}>Trang sau</button>
            </div>
          </div>
        </section>

        <section className={`dispatch-pane dispatch-pane--fleet ${mobilePane === 'FLEET' ? 'is-mobile-active' : ''}`} aria-label="Đội xe">
          <div className="dispatch-pane__head">
            <strong>Đội xe sẵn sàng</strong>
            <span>{fleetAccessDenied ? 'Ẩn theo phân quyền' : `${activeTrucks.length}/${FLEET_PAGE_LIMIT} đang tải`}</span>
          </div>
          <div className="dispatch-pane__scroll">
            {fleetAccessDenied ? <EmptyState title="Không có quyền xem đội xe" description="Tài khoản hiện tại chỉ được xem tác vụ điều phối trong phạm vi cho phép." /> : activeTrucks.map((truck) => (
              <div key={truck.id} className="dispatch-fleet-row">
                <Truck size={19} />
                <div>
                  <strong>{truck.licensePlate}</strong>
                  <small>
                    {truck.currentTrailerPlate ? `Rơ-moóc ${truck.currentTrailerPlate}` : 'Chưa gắn rơ-moóc'}
                    {truck.capacityKg ? ` · Tải trọng ${truck.capacityKg} kg` : ''}
                    {truck.assignedDriverName ? ` · ${truck.assignedDriverName}` : ''}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`dispatch-pane dispatch-pane--detail ${mobilePane === 'DETAIL' ? 'is-mobile-active' : ''}`} aria-label="Chi tiết và phân xe">
          <div className="dispatch-pane__head"><strong>Chi tiết và phân xe</strong></div>
          <div className="dispatch-pane__scroll dispatch-detail">
            {!selected ? <EmptyState title="Chọn một tác vụ" description="Thông tin lô hàng và biểu mẫu phân xe sẽ hiển thị tại đây." /> : <>
              <div className="dispatch-detail__summary">
                <h2>{selected.unitSummary.label}</h2>
                <DetailLine label="Khách hàng" value={selected.customer.name} />
                <DetailLine label="Bill / Booking" value={selected.shipment.blNumber || selected.shipment.bookingRef} />
                <DetailLine label="Tờ khai" value={selected.shipment.declarationNumbers.join(', ')} />
                <DetailLine label="Tuyến" value={selected.route.name} />
                <DetailLine label="Nhà máy" value={selected.operationalSite.name} />
                <DetailLine label="Cảng nâng → Cảng hạ" value={[selected.unitSummary.pickupPortName, selected.unitSummary.dropoffPortName].filter(Boolean).join(' → ')} />
                <DetailLine label="Trạng thái điều xe" value={selected.taskStatus === 'DISPATCHED' ? selected.dispatch?.tripCode || 'Đã phát hành' : 'Chưa phát hành'} />
                {selected.operationalSite.googleMapsUrl && <a href={selected.operationalSite.googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Mở Google Maps</a>}
                {selected.operationalSite.strictRules && <div className="dispatch-site-rules"><strong>Quy định nhà máy</strong><p>{selected.operationalSite.strictRules}</p></div>}
                {selected.shipment.operationalNotes && <div className="dispatch-note"><strong>Ghi chú điều xe</strong><p>{selected.shipment.operationalNotes}</p></div>}
              </div>
              <div className="dispatch-assignment">
                <SelectField label="Hình thức nhà xe" value={assignment.carrierType} onChange={(event) => update('carrierType', event.target.value as AssignmentForm['carrierType'])} disabled={issuing}>
                  <option value="OWN">Đội xe nội bộ</option>
                  <option value="EXTERNAL">Nhà xe đối tác</option>
                </SelectField>
                {assignment.carrierType === 'OWN' ? <>
                  <TextField label="Tìm xe" value={truckSearch} onChange={(event) => setTruckSearch(event.target.value)} placeholder="Nhập biển số xe" disabled={issuing || fleetAccessDenied} />
                  <SelectField
                    label="Biển số xe"
                    value={assignment.truckId}
                    onChange={(event) => {
                      const truckId = event.target.value;
                      const suggestion = fleet?.trucks.find((truck) => String(truck.id) === truckId);
                      setAssignment((current) => ({
                        ...current,
                        truckId,
                        trailerId: suggestion?.currentTrailerId ? String(suggestion.currentTrailerId) : '',
                        driverId: suggestion?.assignedDriverId ? String(suggestion.assignedDriverId) : current.driverId,
                      }));
                    }}
                    disabled={issuing || fleetAccessDenied}
                  >
                    <option value="">— Chọn xe —</option>
                    {filteredTrucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.licensePlate}</option>)}
                  </SelectField>
                  <TextField label="Tìm lái xe" value={driverSearch} onChange={(event) => setDriverSearch(event.target.value)} placeholder="Nhập tên lái xe" disabled={issuing || fleetAccessDenied} />
                  <SelectField label="Lái xe" value={assignment.driverId} onChange={(event) => update('driverId', event.target.value)} disabled={issuing || fleetAccessDenied}>
                    <option value="">— Chọn lái xe —</option>
                    {filteredDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                  </SelectField>
                  <TextField label="Rơ-moóc" value={fleet?.trucks.find((truck) => String(truck.currentTrailerId) === assignment.trailerId)?.currentTrailerPlate ?? ''} disabled helpText="Tự điền theo xe; hệ thống kiểm tra lại khi phát lệnh." />
                </> : <>
                  <TextField label="Tìm nhà xe" value={carrierSearch} onChange={(event) => setCarrierSearch(event.target.value)} placeholder="Nhập tên nhà xe" disabled={issuing} />
                  <SelectField label="Nhà xe" value={assignment.externalCarrierId} onChange={(event) => update('externalCarrierId', event.target.value)} disabled={issuing}>
                    <option value="">— Chọn nhà xe —</option>
                    {filteredExternalCarriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
                  </SelectField>
                  <TextField label="Biển số xe" value={assignment.externalPlateNumber} onChange={(event) => update('externalPlateNumber', event.target.value.toUpperCase())} disabled={issuing} />
                  <TextField label="Tên lái xe" value={assignment.externalDriverName} onChange={(event) => update('externalDriverName', event.target.value)} disabled={issuing} />
                  <TextField label="Số điện thoại lái xe" value={assignment.externalDriverPhone} onChange={(event) => update('externalDriverPhone', event.target.value)} disabled={issuing} />
                </>}
                <TextField label="Ngày giờ chạy" type="datetime-local" value={assignment.plannedStartAt} onChange={(event) => update('plannedStartAt', event.target.value)} disabled={issuing} />
                <TextField label="Kết thúc dự kiến" type="datetime-local" value={assignment.plannedEndAt} onChange={(event) => update('plannedEndAt', event.target.value)} disabled={issuing || selected.route.serviceDurationMinutes != null} />
                {selected.route.serviceDurationMinutes == null && <label className="dispatch-confirm"><input type="checkbox" checked={assignment.endTimeConfirmed} onChange={(event) => update('endTimeConfirmed', event.target.checked)} />Tôi xác nhận giờ kết thúc vì tuyến chưa có thời lượng chuẩn.</label>}
                <button type="button" onClick={() => void issue()} disabled={issuing} className="dispatch-issue">
                  <Send size={18} />{issuing ? 'Đang phát hành…' : 'Phát hành lệnh điều xe'}
                </button>
              </div>
            </>}
          </div>
        </section>
      </div>
    </div>
  );
}
