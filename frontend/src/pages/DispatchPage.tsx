import { useEffect, useMemo, useState } from 'react';
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
import { localDateTimeToIso } from '../lib/shipment-operations';
import './DispatchPage.css';

type MobilePane = 'TASKS' | 'FLEET' | 'DETAIL';
interface AssignmentForm {
  carrierType: 'OWN' | 'EXTERNAL'; truckId: string; driverId: string; trailerId: string;
  externalCarrierId: string; externalPlateNumber: string; externalDriverName: string; externalDriverPhone: string;
  plannedStartAt: string; plannedEndAt: string; endTimeConfirmed: boolean;
}

const EMPTY_ASSIGNMENT: AssignmentForm = {
  carrierType: 'OWN', truckId: '', driverId: '', trailerId: '', externalCarrierId: '', externalPlateNumber: '', externalDriverName: '', externalDriverPhone: '', plannedStartAt: '', plannedEndAt: '', endTimeConfirmed: false,
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function DetailLine({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="dispatch-detail-line"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

export default function DispatchPage() {
  const [items, setItems] = useState<DispatchQueueItem[]>([]);
  const [fleet, setFleet] = useState<DispatchFleet | null>(null);
  const [handoffs, setHandoffs] = useState<DispatchHandoffItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [urgency, setUrgency] = useState<'' | 'NORMAL' | 'URGENT'>('');
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('TASKS');
  const [assignment, setAssignment] = useState<AssignmentForm>(EMPTY_ASSIGNMENT);
  const selected = useMemo(() => items.find((item) => item.fulfillmentId === selectedId) ?? null, [items, selectedId]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [inbox, queue, resources] = await Promise.all([
        listDispatchHandoffs({ limit: 50, q: query.trim() || undefined, urgency }),
        listDispatchQueue({ limit: 50, status: 'READY', q: query.trim() || undefined, urgency }),
        getDispatchFleet(),
      ]);
      setHandoffs(inbox.items.slice(0, 50));
      setItems(queue.items.slice(0, 50));
      setFleet({ ...resources, trucks: resources.trucks.slice(0, 100), drivers: resources.drivers.slice(0, 100) });
      setSelectedId((current) => current && queue.items.some((item) => item.fulfillmentId === current) ? current : queue.items[0]?.fulfillmentId ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải bảng điều phối');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [urgency]);

  useEffect(() => {
    if (!selected) { setAssignment(EMPTY_ASSIGNMENT); return; }
    setAssignment({
      ...EMPTY_ASSIGNMENT,
      carrierType: selected.dispatch.carrierType ?? 'OWN',
      truckId: selected.dispatch.truckId ? String(selected.dispatch.truckId) : '',
      driverId: selected.dispatch.driverId ? String(selected.dispatch.driverId) : '',
      trailerId: selected.dispatch.trailerId ? String(selected.dispatch.trailerId) : '',
      externalCarrierId: selected.dispatch.externalCarrierId ? String(selected.dispatch.externalCarrierId) : '',
      externalPlateNumber: selected.dispatch.externalPlateNumber ?? '', externalDriverName: selected.dispatch.externalDriverName ?? '', externalDriverPhone: selected.dispatch.externalDriverPhone ?? '',
    });
  }, [selectedId]);

  function update<K extends keyof AssignmentForm>(key: K, value: AssignmentForm[K]) {
    setAssignment((current) => ({ ...current, [key]: value })); setError(null); setSuccess(null);
  }

  async function issue() {
    if (!selected) return;
    if (!assignment.plannedStartAt || !assignment.plannedEndAt) { setError('Vui lòng nhập giờ bắt đầu và giờ kết thúc dự kiến'); return; }
    if (assignment.carrierType === 'OWN' && (!assignment.truckId || !assignment.driverId)) { setError('Vui lòng chọn rõ xe và lái xe'); return; }
    if (assignment.carrierType === 'EXTERNAL' && (!assignment.externalCarrierId || !assignment.externalPlateNumber || !assignment.externalDriverName)) { setError('Vui lòng chọn nhà xe và nhập biển số, tên lái xe'); return; }
    if (selected.route.serviceDurationMinutes == null && !assignment.endTimeConfirmed) { setError('Tuyến chưa có thời lượng chuẩn; cần xác nhận giờ kết thúc đã nhập'); return; }
    setIssuing(true); setError(null); setSuccess(null);
    try {
      const result = await issueDispatchOrder(selected, {
        plannedStartAt: localDateTimeToIso(assignment.plannedStartAt)!, plannedEndAt: localDateTimeToIso(assignment.plannedEndAt)!, endTimeConfirmed: assignment.endTimeConfirmed,
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
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể phát hành lệnh điều xe'); }
    finally { setIssuing(false); }
  }

  async function acceptHandoff(handoff: DispatchHandoffItem) {
    setError(null); setSuccess(null);
    try {
      await resolveDispatchHandoff(handoff, 'ACCEPTED');
      setSuccess(`Đã tiếp nhận lô ${handoff.shipment.code || handoff.shipment.bookingRef || handoff.shipmentId} và tạo tác vụ điều phối.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể tiếp nhận lô hàng'); }
  }

  const eligibleDrivers = fleet?.drivers.filter((driver) => driver.status === 'ACTIVE' && driver.userId != null) ?? [];
  const activeTrucks = fleet?.trucks.filter((truck) => truck.status === 'ACTIVE') ?? [];

  return (
    <div className="dispatch-workbench">
      <header className="dispatch-workbench__header">
        <div><div className="dispatch-workbench__eyebrow">Bảng kế hoạch</div><h1>Điều phối chuyến xe</h1><p>Mỗi container FCL là một tác vụ; mỗi lô LCL là một tác vụ.</p></div>
        <button type="button" onClick={() => void load()} disabled={loading} className="dispatch-icon-button"><RefreshCw size={18} /> Tải lại</button>
      </header>
      <div className="dispatch-toolbar">
        <label><span>Tìm tác vụ</span><div className="dispatch-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} placeholder="Khách hàng, booking, container…" /></div></label>
        <SelectField label="Mức ưu tiên" value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}><option value="">Tất cả</option><option value="URGENT">Gấp</option><option value="NORMAL">Bình thường</option></SelectField>
        <button type="button" onClick={() => void load()} className="dispatch-search-button">Tìm kiếm</button>
      </div>
      <div className="dispatch-mobile-tabs" role="tablist" aria-label="Khu vực điều phối">
        {([['TASKS', `Tác vụ (${handoffs.length + items.length})`], ['FLEET', `Đội xe (${fleet?.trucks.length ?? 0})`], ['DETAIL', 'Chi tiết']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mobilePane === value} onClick={() => setMobilePane(value)}>{label}</button>)}
      </div>
      {error && <div role="alert" className="dispatch-message dispatch-message--error"><AlertTriangle size={18} />{error}</div>}
      {success && <div role="status" className="dispatch-message dispatch-message--success"><CheckCircle2 size={18} />{success}</div>}

      <div className="dispatch-workbench__grid">
        <section className={`dispatch-pane dispatch-pane--tasks ${mobilePane === 'TASKS' ? 'is-mobile-active' : ''}`} aria-label="Danh sách tác vụ">
          <div className="dispatch-pane__head"><strong>Tác vụ chờ điều phối</strong><span>{handoffs.length + items.length}/50 đang tải</span></div>
          <div className="dispatch-pane__scroll">
            {loading ? <div className="dispatch-loading">Đang tải…</div> : handoffs.length === 0 && items.length === 0 ? <EmptyState title="Không có tác vụ chờ điều phối" description="Các lô hợp lệ từ CUS sẽ xuất hiện tại đây." /> : <>
            {handoffs.map((handoff) => <div key={`handoff-${handoff.handoffId}`} className="dispatch-handoff"><div><span className="dispatch-urgent">Lô mới</span><strong>{handoff.shipment.code || handoff.shipment.bookingRef || `Lô #${handoff.shipmentId}`}</strong><small>{handoff.customer.name} · {handoff.shipment.cargoMode === 'FCL' ? `${handoff.shipment.containerCount} container` : handoff.summary.lclLabel}</small></div><button type="button" onClick={() => void acceptHandoff(handoff)}>Tiếp nhận</button></div>)}
            {items.map((item) => (
              <button key={item.fulfillmentId} type="button" className={`dispatch-task ${selectedId === item.fulfillmentId ? 'is-selected' : ''}`} onClick={() => { setSelectedId(item.fulfillmentId); setMobilePane('DETAIL'); }}>
                <div className="dispatch-task__top"><strong>{item.unitSummary.label}</strong>{item.urgency === 'URGENT' && <span className="dispatch-urgent">Gấp</span>}</div>
                <div>{item.customer.name}</div><small>{item.route.name}</small>
                <div className="dispatch-task__dates"><span>Cut-off: {formatDateTime(item.shipment.customsCutoffAt)}</span><span>Đóng: {formatDateTime(item.shipment.closingAt)}</span></div>
              </button>
            ))}</>}
          </div>
        </section>

        <section className={`dispatch-pane dispatch-pane--fleet ${mobilePane === 'FLEET' ? 'is-mobile-active' : ''}`} aria-label="Đội xe">
          <div className="dispatch-pane__head"><strong>Đội xe sẵn sàng</strong><span>{activeTrucks.length} xe</span></div>
          <div className="dispatch-pane__scroll">{activeTrucks.map((truck) => <div key={truck.id} className="dispatch-fleet-row"><Truck size={19} /><div><strong>{truck.licensePlate}</strong><small>{truck.currentTrailerPlate ? `Rơ-moóc ${truck.currentTrailerPlate}` : 'Chưa gắn rơ-moóc'} · {truck.assignedDriverName ?? 'Chưa gán lái xe'}</small></div></div>)}</div>
        </section>

        <section className={`dispatch-pane dispatch-pane--detail ${mobilePane === 'DETAIL' ? 'is-mobile-active' : ''}`} aria-label="Chi tiết và phân xe">
          <div className="dispatch-pane__head"><strong>Chi tiết và phân xe</strong></div>
          <div className="dispatch-pane__scroll dispatch-detail">
            {!selected ? <EmptyState title="Chọn một tác vụ" description="Thông tin lô hàng và biểu mẫu phân xe sẽ hiển thị tại đây." /> : <>
              <div className="dispatch-detail__summary"><h2>{selected.unitSummary.label}</h2><DetailLine label="Khách hàng" value={selected.customer.name} /><DetailLine label="Bill / Booking" value={selected.shipment.blNumber || selected.shipment.bookingRef} /><DetailLine label="Tờ khai" value={selected.shipment.declarationNumbers.join(', ')} /><DetailLine label="Tuyến" value={selected.route.name} /><DetailLine label="Nhà máy" value={selected.operationalSite.name} /><DetailLine label="Cảng nâng → Cảng hạ" value={[selected.unitSummary.pickupPortName, selected.unitSummary.dropoffPortName].filter(Boolean).join(' → ')} />
                {selected.operationalSite.googleMapsUrl && <a href={selected.operationalSite.googleMapsUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Mở Google Maps</a>}
                {selected.operationalSite.strictRules && <div className="dispatch-site-rules"><strong>Quy định nhà máy</strong><p>{selected.operationalSite.strictRules}</p></div>}
                {selected.shipment.operationalNotes && <div className="dispatch-note"><strong>Ghi chú điều xe</strong><p>{selected.shipment.operationalNotes}</p></div>}
              </div>
              <div className="dispatch-assignment">
                <SelectField label="Hình thức nhà xe" value={assignment.carrierType} onChange={(event) => update('carrierType', event.target.value as AssignmentForm['carrierType'])} disabled={issuing}><option value="OWN">Đội xe nội bộ</option><option value="EXTERNAL">Nhà xe đối tác</option></SelectField>
                {assignment.carrierType === 'OWN' ? <>
                  <SelectField label="Biển số xe" value={assignment.truckId} onChange={(event) => { const truckId = event.target.value; const suggestion = fleet?.trucks.find((truck) => String(truck.id) === truckId); setAssignment((current) => ({ ...current, truckId, trailerId: suggestion?.currentTrailerId ? String(suggestion.currentTrailerId) : '', driverId: suggestion?.assignedDriverId ? String(suggestion.assignedDriverId) : current.driverId })); }} disabled={issuing}><option value="">— Chọn xe —</option>{activeTrucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.licensePlate}</option>)}</SelectField>
                  <SelectField label="Lái xe" value={assignment.driverId} onChange={(event) => update('driverId', event.target.value)} disabled={issuing}><option value="">— Chọn lái xe —</option>{eligibleDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</SelectField>
                  <TextField label="Rơ-moóc" value={fleet?.trucks.find((truck) => String(truck.currentTrailerId) === assignment.trailerId)?.currentTrailerPlate ?? ''} disabled helpText="Tự điền theo xe; hệ thống kiểm tra lại khi phát lệnh." />
                </> : <>
                  <SelectField label="Nhà xe" value={assignment.externalCarrierId} onChange={(event) => update('externalCarrierId', event.target.value)} disabled={issuing}><option value="">— Chọn nhà xe —</option>{(fleet?.externalCarriers ?? []).map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}</SelectField>
                  <TextField label="Biển số xe" value={assignment.externalPlateNumber} onChange={(event) => update('externalPlateNumber', event.target.value.toUpperCase())} disabled={issuing} />
                  <TextField label="Tên lái xe" value={assignment.externalDriverName} onChange={(event) => update('externalDriverName', event.target.value)} disabled={issuing} />
                  <TextField label="Số điện thoại lái xe" value={assignment.externalDriverPhone} onChange={(event) => update('externalDriverPhone', event.target.value)} disabled={issuing} />
                </>}
                <TextField label="Ngày giờ chạy" type="datetime-local" value={assignment.plannedStartAt} onChange={(event) => update('plannedStartAt', event.target.value)} disabled={issuing} />
                <TextField label="Kết thúc dự kiến" type="datetime-local" value={assignment.plannedEndAt} onChange={(event) => update('plannedEndAt', event.target.value)} disabled={issuing} />
                {selected.route.serviceDurationMinutes == null && <label className="dispatch-confirm"><input type="checkbox" checked={assignment.endTimeConfirmed} onChange={(event) => update('endTimeConfirmed', event.target.checked)} />Tôi xác nhận giờ kết thúc vì tuyến chưa có thời lượng chuẩn.</label>}
                <button type="button" onClick={() => void issue()} disabled={issuing} className="dispatch-issue"><Send size={18} />{issuing ? 'Đang phát hành…' : 'Phát hành lệnh điều xe'}</button>
              </div>
            </>}
          </div>
        </section>
      </div>
    </div>
  );
}
