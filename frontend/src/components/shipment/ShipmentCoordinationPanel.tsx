import { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Plus, RotateCcw, Send } from 'lucide-react';
import { Modal } from '../UI';
import { ApiError } from '../../lib/api';
import { formatDateTimeVN } from '../../lib/format';
import { customerServiceFinanceClient, type CustomerVisibleEvent } from '../../api/customerServiceFinanceClient';

const EVENT_TYPE_LABELS: Record<CustomerVisibleEvent['eventType'], string> = {
  MILESTONE: 'Mốc vận chuyển', DELIVERY_PLAN: 'Kế hoạch giao hàng',
  DOCUMENT_UPDATE: 'Cập nhật chứng từ', DEBIT_NOTE_CONFIRMATION: 'Xác nhận Giấy báo nợ',
};

export function ShipmentCoordinationPanel({ shipmentId, canWrite }: { shipmentId: number; canWrite: boolean }) {
  const [events, setEvents] = useState<CustomerVisibleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ eventType: CustomerVisibleEvent['eventType']; title: string; message: string }>({ eventType: 'DELIVERY_PLAN', title: '', message: '' });
  const load = useCallback(async () => { setLoading(true); setError(null); try { setEvents((await customerServiceFinanceClient.listShipmentEvents(shipmentId)).items); } catch (err) { setError(err instanceof ApiError ? err.message : 'Không thể tải lịch sử phối hợp.'); } finally { setLoading(false); } }, [shipmentId]);
  useEffect(() => { void load(); }, [load]);
  const submit = async () => {
    if (!form.title.trim() || !form.message.trim()) return;
    setSaving(true); setError(null);
    try {
      await customerServiceFinanceClient.createShipmentEvent(shipmentId, {
        eventKey: `cus-${shipmentId}-${crypto.randomUUID()}`, eventType: form.eventType,
        title: form.title.trim(), message: form.message.trim(), occurredAt: new Date().toISOString(),
      });
      setOpen(false); setForm({ eventType: 'DELIVERY_PLAN', title: '', message: '' }); await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Không thể gửi cập nhật khách hàng.'); }
    finally { setSaving(false); }
  };
  return <section className="shipment-detail__card shipment-coordination">
    <div className="shipment-coordination__head"><h3 className="shipment-detail__section-title"><MessageSquareText size={16}/> Phối hợp khách hàng</h3>{canWrite && <button className="btn btn--primary" onClick={() => setOpen(true)}><Plus size={16}/> Tạo cập nhật</button>}</div>
    <p className="shipment-coordination__hint">Các cập nhật dưới đây là bản nội dung đã phân loại để khách hàng xem; đây không phải hội thoại trực tiếp.</p>
    {error && <div className="workflow-notice workflow-notice--error" role="alert">{error}<button className="btn btn--ghost" onClick={() => void load()}><RotateCcw size={15}/> Thử lại</button></div>}
    {loading ? <p role="status">Đang tải lịch sử phối hợp…</p> : events.length === 0 ? <p className="shipment-detail__empty">Chưa có cập nhật nào đã gửi khách hàng.</p> : <ol className="shipment-coordination__timeline">{events.map((event) => <li key={event.id}><span className="shipment-coordination__dot" aria-hidden/><div><div className="shipment-coordination__meta"><span>Đã gửi khách hàng</span><time dateTime={event.occurredAt}>{formatDateTimeVN(event.occurredAt)}</time></div><strong>{event.title}</strong><p>{event.message}</p><small>{EVENT_TYPE_LABELS[event.eventType]} · Phiên bản {event.version}</small></div></li>)}</ol>}
    <Modal isOpen={open} title="Tạo cập nhật cho khách hàng" onClose={() => !saving && setOpen(false)} footer={<><button className="btn btn--ghost" onClick={() => setOpen(false)} disabled={saving}>Hủy</button><button className="btn btn--primary" onClick={() => void submit()} disabled={saving || !form.title.trim() || !form.message.trim()}><Send size={16}/>{saving ? 'Đang gửi…' : 'Gửi khách hàng'}</button></>}>
      <div className="workflow-form"><label htmlFor="coordination-type">Loại cập nhật<select id="coordination-type" className="input" value={form.eventType} onChange={(e) => setForm((current) => ({ ...current, eventType: e.target.value as CustomerVisibleEvent['eventType'] }))}>{Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label htmlFor="coordination-title">Tiêu đề<input id="coordination-title" className="input" maxLength={160} value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}/></label><label htmlFor="coordination-message">Nội dung khách hàng sẽ thấy<textarea id="coordination-message" className="input" rows={5} maxLength={1000} value={form.message} onChange={(e) => setForm((current) => ({ ...current, message: e.target.value }))}/></label><small>{form.message.length}/1.000 ký tự</small></div>
    </Modal>
  </section>;
}
