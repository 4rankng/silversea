import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Modal } from '../../components/UI';
import { customerServiceFinanceClient, type CustomerVisibleEvent } from '../../api/customerServiceFinanceClient';
import { SHIPMENT_STATUS_LABELS, SHIPMENT_DOCUMENT_TYPE_LABELS } from '@tingting/shared';
import { EmptyState } from '../../design-system';
import { routes } from '../../lib/routes';
import { useCustomerPortalScope, withCustomerScope } from './CustomerPortalScope';
import { useAuth } from '../../hooks/useAuth';
import './PortalPages.css';

export default function PortalShipmentDetailPage() {
  const user = useAuth()?.user;
  const coordinationActive = user?.workflowRolloutMode === 'ACTIVE';
  const { id } = useParams<{ id: string }>();
  const { selectedCustomerId, ready: customerScopeReady } = useCustomerPortalScope();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<CustomerVisibleEvent[]>([]);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<number>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<CustomerVisibleEvent | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  useEffect(() => {
    if (!customerScopeReady) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<any>(withCustomerScope(`/portal/shipments/${id}`, selectedCustomerId)),
      coordinationActive
        ? customerServiceFinanceClient.listPortalShipmentEvents(Number(id), selectedCustomerId)
        : Promise.resolve({ items: [] }),
    ])
      .then(([response, eventResponse]) => {
        if (active) {
          const nextEvents = eventResponse?.items ?? [];
          setData(response);
          setEvents(nextEvents);
          setAcknowledgedIds(new Set(nextEvents.filter((event) => event.acknowledged).map((event) => event.id)));
        }
      })
      .catch(() => {
        if (active) setError('Không thể tải chi tiết lô hàng');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [coordinationActive, customerScopeReady, id, selectedCustomerId]);

  if (loading) return <div className="portal-page"><div className="portal-panel portal-state" role="status">Đang tải chi tiết lô hàng…</div></div>;
  if (error || !data) return (
    <div className="portal-page">
      <Link to={withCustomerScope(routes.portalShipments, selectedCustomerId)} className="portal-back"><ArrowLeft size={16} /> Quay lại danh sách</Link>
      <div className="portal-panel"><EmptyState title={error ?? 'Không có dữ liệu'} /></div>
    </div>
  );

  const { shipment, containers, documents, declarations, statusHistory } = data;
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';
  const acknowledge = async () => {
    if (!selectedEvent) return;
    setAcknowledging(true);
    try {
      await customerServiceFinanceClient.acknowledgePortalEvent(shipment.id, selectedEvent, selectedCustomerId);
      setAcknowledgedIds((current) => new Set(current).add(selectedEvent.id));
      setSelectedEvent(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xác nhận cập nhật.');
    } finally { setAcknowledging(false); }
  };

  return (
    <div className="portal-page">
      <Link to={withCustomerScope(routes.portalShipments, selectedCustomerId)} className="portal-back"><ArrowLeft size={16} /> Danh sách lô hàng</Link>
      <header className="portal-page__header">
        <span className="portal-page__eyebrow">Chi tiết lô hàng</span>
        <h1>{shipment.shipmentCode ?? `Lô hàng #${shipment.id}`}</h1>
        <p>Trạng thái hiện tại: <span className="portal-status">{SHIPMENT_STATUS_LABELS[shipment.status as keyof typeof SHIPMENT_STATUS_LABELS]}</span></p>
      </header>

      <div className="portal-panel">
        <section className="portal-section">
          <h2>Thông tin chung</h2>
          <dl className="portal-detail-grid">
            <div><dt>Mã đặt chỗ</dt><dd>{shipment.bookingRef ?? '—'}</dd></div>
            <div><dt>Số B/L</dt><dd>{shipment.blNumber ?? '—'}</dd></div>
            <div><dt>Giao dự kiến</dt><dd>{fmt(shipment.expectedDeliveryDate)}</dd></div>
            <div><dt>Nơi nhận</dt><dd>{shipment.pickupLocation ?? '—'}</dd></div>
            <div><dt>Nơi giao</dt><dd>{shipment.deliveryLocation ?? '—'}</dd></div>
          </dl>
        </section>

      {coordinationActive && <section className="portal-section portal-coordination">
        <h2>Cập nhật từ bộ phận Customer Service</h2>
        <p className="portal-section__description">Các mốc và kế hoạch đã được gửi chính thức cho lô hàng này.</p>
        {events.length === 0 ? <p className="portal-list__meta">Chưa có cập nhật nào.</p> : <ol className="portal-timeline">{events.map((event) => {
          const acknowledged = acknowledgedIds.has(event.id);
          return <li key={event.id}><div className="portal-timeline__meta"><span>Đã gửi khách hàng</span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString('vi-VN')}</time></div><strong>{event.title}</strong><p>{event.message}</p><small>Phiên bản {event.version}</small>{acknowledged ? <span className="portal-status portal-status--success"><CheckCircle2 size={15}/> Khách hàng đã xác nhận</span> : <button className="portal-button portal-button--primary" onClick={() => setSelectedEvent(event)}>Xác nhận đã nhận thông tin</button>}</li>;
        })}</ol>}
      </section>}

      {containers?.length > 0 && (
        <section className="portal-section">
          <h2>Containers ({containers.length})</h2>
          <div className="portal-table-wrap"><table className="portal-table">
            <thead><tr><th>Số container</th><th>Seal</th><th>Trọng lượng (kg)</th></tr></thead>
            <tbody>
              {containers.map((c: any) => (
                <tr key={c.id}><td>{c.containerNumber ?? '—'}</td><td>{c.sealNumber ?? '—'}</td><td>{c.cargoWeightKg ?? '—'}</td></tr>
              ))}
            </tbody>
          </table></div>
        </section>
      )}

      {documents?.length > 0 && (
        <section className="portal-section">
          <h2>Chứng từ ({documents.length})</h2>
          <div className="portal-list">
            {documents.map((doc: any) => (
              <div key={doc.id} className="portal-list__row">
                <div className="portal-list__primary">
                  <strong>
                  {SHIPMENT_DOCUMENT_TYPE_LABELS[doc.type as keyof typeof SHIPMENT_DOCUMENT_TYPE_LABELS] ?? doc.type}
                  </strong>
                  <div className="portal-list__meta">
                  Tải lên: {new Date(doc.createdAt).toLocaleString('vi-VN')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {declarations?.length > 0 && (
        <section className="portal-section">
          <h2>Tờ khai ({declarations.length})</h2>
          <div className="portal-list">
            {declarations.map((declaration: any) => (
              <div key={declaration.id} className="portal-list__row">
                <div className="portal-list__primary">
                  <strong>{declaration.declarationNumber}</strong>
                  <div className="portal-list__meta">{declaration.scope === 'SHARED' ? 'Dùng chung' : 'Riêng lẻ'}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {statusHistory?.length > 0 && (
        <section className="portal-section">
          <h2>Lịch sử trạng thái</h2>
          {statusHistory.map((h: any, i: number) => (
            <div key={h.id || i} className="portal-list__meta" style={{ padding: '7px 0' }}>
              <span style={{ fontWeight: 600 }}>{SHIPMENT_STATUS_LABELS[h.toStatus as keyof typeof SHIPMENT_STATUS_LABELS] ?? h.toStatus}</span>
              <span>{new Date(h.changedAt).toLocaleString('vi-VN')}</span>
              {h.reason && <span>{h.reason}</span>}
            </div>
          ))}
        </section>
      )}
      </div>
      <Modal isOpen={selectedEvent != null} title="Xác nhận đã nhận thông tin" onClose={() => !acknowledging && setSelectedEvent(null)} footer={<><button className="btn btn--ghost" onClick={() => setSelectedEvent(null)} disabled={acknowledging}>Hủy</button><button className="btn btn--primary" onClick={() => void acknowledge()} disabled={acknowledging}>{acknowledging ? 'Đang xác nhận…' : 'Xác nhận đã nhận'}</button></>}>
        <p>Bạn xác nhận đã nhận cập nhật <strong>{selectedEvent?.title}</strong> (phiên bản {selectedEvent?.version}). Thao tác này chỉ xác nhận đã nhận thông tin, không phải chấp nhận chi phí.</p>
      </Modal>
    </div>
  );
}
