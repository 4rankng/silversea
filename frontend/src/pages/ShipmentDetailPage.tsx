import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, FileText, FileCheck2, Container, History, ClipboardPenLine,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState } from '../design-system';
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_DOCUMENT_TYPE_LABELS,
  type ShipmentStatus,
  type ShipmentDocumentType,
  Role,
} from '@tingting/shared';
import { usePageAnimations } from '../hooks/animations';
import { useAuth } from '../hooks/useAuth';
import { ShipmentCoordinationPanel } from '../components/shipment/ShipmentCoordinationPanel';
import './WorkflowFinance.css';
import './ShipmentDetailPage.css';

// ─── Types (local; see ShipmentsPage for the rationale) ──────────────────────

interface Shipment {
  id: number;
  shipmentCode: string | null;
  customerId: number;
  // Joined from customers.name by getShipmentDetail. Nullable (leftJoin).
  customerName: string | null;
  status: ShipmentStatus;
  bookingRef: string | null;
  blNumber: string | null;
  expectedDeliveryDate: string | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  contactName: string | null;
  contactPhone: string | null;
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  cargoMode: 'FCL' | 'LCL' | null;
  factoryName: string | null;
  shippingLineName: string | null;
  customsCutoffAt: string | null;
  closingAt: string | null;
  plannedReturnAt: string | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
  packageCount: number | null;
  packageType: string | null;
  operationalNotes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ShipmentContainer {
  id: number;
  shipmentId: number;
  containerTypeId: number | null;
  containerNumber: string | null;
  sealNumber: string | null;
  cargoWeightKg: string | null;
  notes: string | null;
}

interface ShipmentDocument {
  id: number;
  shipmentId: number;
  type: ShipmentDocumentType;
  storageKey: string;
  createdAt: string;
}

interface ShipmentDeclaration {
  id: number;
  shipmentId: number;
  declarationNumber: string | null;
  issuedAt: string | null;
  scope: 'SINGLE' | 'SHARED';
  note: string | null;
}

interface ShipmentStatusHistoryRow {
  id: number;
  shipmentId: number;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  reason: string | null;
  changedAt: string;
}

interface ShipmentDetailResponse {
  shipment: Shipment;
  containers: ShipmentContainer[];
  documents: ShipmentDocument[];
  declarations: ShipmentDeclaration[];
  statusHistory: ShipmentStatusHistoryRow[];
}

const STATUS_DOT_CLASS: Record<ShipmentStatus, string> = {
  DRAFT: 'shipment-detail__dot--draft',
  IN_PROGRESS: 'shipment-detail__dot--info',
  DELIVERED: 'shipment-detail__dot--success',
  CLOSED: 'shipment-detail__dot--muted',
  CANCELED: 'shipment-detail__dot--danger',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN');
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN');
}

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const shipmentId = Number(id);
  const canOperate = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.CLERK;
  const coordinationActive = user?.workflowRolloutMode === 'ACTIVE'
    && Boolean(user.capabilities?.includes('shipments.read'));
  const canWriteCoordination = coordinationActive
    && Boolean(user.capabilities?.includes('shipments.write'));

  const [data, setData] = useState<ShipmentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stale-response guard: when navigating from /shipments/1 to /shipments/2
  // while the first request is in flight, the first response must NOT
  // overwrite the second. Increment a request id per fetch; ignore the
  // response if a newer fetch has started.
  const requestIdRef = useRef(0);

  const { rootRef } = usePageAnimations({ ready: !loading && !!data });

  const fetchDetail = useCallback(async () => {
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      setError('ID lô hàng không hợp lệ');
      setLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ShipmentDetailResponse>(`/shipments/${shipmentId}`);
      // A newer fetch started — drop this response on the floor.
      if (reqId !== requestIdRef.current) return;
      setData(res);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      if (err instanceof ApiError && err.status === 404) {
        setError('Không tìm thấy lô hàng');
      } else {
        setError(err instanceof ApiError ? err.message : 'Không thể tải chi tiết lô hàng');
      }
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => { void fetchDetail(); }, [fetchDetail]);

  if (loading) {
    return (
      <div className="shipment-detail shipment-detail--loading">
        <div className="spin" style={{ width: 24, height: 24, border: '3px solid var(--border-2)', borderTopColor: 'var(--brand)', borderRadius: '50%' }} />
        <span>Đang tải…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="shipment-detail" ref={rootRef}>
        <Breadcrumbs items={[{ label: 'Lô hàng', to: '/shipments' }, { label: 'Chi tiết' }]} />
        <EmptyState
          icon={Package}
          title={error ?? 'Không có dữ liệu'}
          description={error?.includes('Không tìm thấy')
            ? 'Lô hàng có thể đã bị xóa hoặc không tồn tại.'
            : 'Thử tải lại trang.'}
          action={<Link to="/shipments" className="btn btn--ghost btn--sm"><ArrowLeft size={14} /> Quay lại danh sách</Link>}
        />
      </div>
    );
  }

  const { shipment, containers, documents, declarations, statusHistory } = data;

  return (
    <div className="shipment-detail page-anim" ref={rootRef}>
      <Breadcrumbs items={[
        { label: 'Lô hàng', to: '/shipments' },
        { label: shipment.shipmentCode ?? `#${shipment.id}` },
      ]} />

      <PageHeader
        title={shipment.shipmentCode ?? `Lô hàng #${shipment.id}`}
        description={`Trạng thái: ${SHIPMENT_STATUS_LABELS[shipment.status]}`}
        onBack={() => navigate('/shipments')}
        action={canOperate ? (
          <Link
            to={`/clerk/shipments/${shipment.id}/docs`}
            className="btn btn--primary shipment-detail__operate"
          >
            <ClipboardPenLine size={18} aria-hidden="true" />
            Cập nhật &amp; điều xe
          </Link>
        ) : undefined}
      />

      <div className="shipment-detail__grid">
        {/* Header summary */}
        <section className="shipment-detail__card shipment-detail__header">
          <div className="shipment-detail__status-line">
            <span className={`shipment-detail__dot ${STATUS_DOT_CLASS[shipment.status]}`} aria-hidden />
            <span className="shipment-detail__status-label">{SHIPMENT_STATUS_LABELS[shipment.status]}</span>
            <span className="shipment-detail__version">v{shipment.version}</span>
          </div>
          <dl className="shipment-detail__fields">
            <div><dt>Khách hàng</dt><dd>{shipment.customerName ?? `#${shipment.customerId}`}</dd></div>
            <div><dt>Mã đặt chỗ</dt><dd>{shipment.bookingRef ?? '—'}</dd></div>
            <div><dt>Số B/L</dt><dd>{shipment.blNumber ?? '—'}</dd></div>
            <div><dt>Giao dự kiến</dt><dd>{formatDate(shipment.expectedDeliveryDate)}</dd></div>
            <div><dt>Nơi nhận</dt><dd>{shipment.pickupLocation ?? '—'}</dd></div>
            <div><dt>Nơi giao</dt><dd>{shipment.deliveryLocation ?? '—'}</dd></div>
            <div><dt>Liên hệ</dt><dd>{shipment.contactName ?? '—'}{shipment.contactPhone ? ` · ${shipment.contactPhone}` : ''}</dd></div>
            <div><dt>Ngày tạo</dt><dd>{formatDateTime(shipment.createdAt)}</dd></div>
            <div><dt>Chiều hàng</dt><dd>{shipment.tradeDirection === 'IMPORT' ? 'Nhập khẩu' : shipment.tradeDirection === 'EXPORT' ? 'Xuất khẩu' : '—'}</dd></div>
            <div><dt>Loại lô</dt><dd>{shipment.cargoMode === 'FCL' ? 'Container (FCL)' : shipment.cargoMode === 'LCL' ? 'Hàng lẻ (LCL)' : '—'}</dd></div>
            <div><dt>Nhà máy / công trường</dt><dd>{shipment.factoryName ?? '—'}</dd></div>
            <div><dt>Hãng tàu</dt><dd>{shipment.shippingLineName ?? '—'}</dd></div>
            <div><dt>Cut-off hải quan</dt><dd>{formatDateTime(shipment.customsCutoffAt)}</dd></div>
            <div><dt>Closing time</dt><dd>{formatDateTime(shipment.closingAt)}</dd></div>
            <div><dt>Thời gian trả</dt><dd>{formatDateTime(shipment.plannedReturnAt)}</dd></div>
            <div><dt>Trọng lượng</dt><dd>{shipment.cargoWeightKg ? `${shipment.cargoWeightKg} kg` : '—'}</dd></div>
            {shipment.cargoMode === 'LCL' && (
              <>
                <div><dt>Thể tích</dt><dd>{shipment.cargoVolumeCbm ? `${shipment.cargoVolumeCbm} CBM` : '—'}</dd></div>
                <div><dt>Kiện hàng</dt><dd>{shipment.packageCount != null ? `${shipment.packageCount}${shipment.packageType ? ` ${shipment.packageType}` : ' kiện'}` : '—'}</dd></div>
              </>
            )}
            <div className="shipment-detail__field--wide"><dt>Ghi chú vận hành</dt><dd>{shipment.operationalNotes ?? '—'}</dd></div>
          </dl>
        </section>

        {coordinationActive && (
          <ShipmentCoordinationPanel shipmentId={shipment.id} canWrite={canWriteCoordination} />
        )}

        {/* Containers */}
        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <Container size={16} /> Containers ({containers.length})
          </h3>
          {containers.length === 0 ? (
            <p className="shipment-detail__empty">Chưa có container nào.</p>
          ) : (
            <table className="shipment-detail__table">
              <thead>
                <tr>
                  <th>Số container</th>
                  <th>Số seal</th>
                  <th>Trọng lượng (kg)</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c) => (
                  <tr key={c.id}>
                    <td>{c.containerNumber ?? '—'}</td>
                    <td>{c.sealNumber ?? '—'}</td>
                    <td>{c.cargoWeightKg ?? '—'}</td>
                    <td>{c.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Documents */}
        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <FileText size={16} /> Tài liệu ({documents.length})
          </h3>
          {documents.length === 0 ? (
            <p className="shipment-detail__empty">Chưa có tài liệu nào.</p>
          ) : (
            <ul className="shipment-detail__docs">
              {documents.map((d) => (
                <li key={d.id} className="shipment-detail__doc">
                  <FileCheck2 size={16} />
                  <span className="shipment-detail__doc-type">{SHIPMENT_DOCUMENT_TYPE_LABELS[d.type]}</span>
                  <span className="shipment-detail__doc-key">{d.storageKey}</span>
                  <span className="shipment-detail__doc-date">{formatDate(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Declarations */}
        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <FileCheck2 size={16} /> Tờ khai hải quan ({declarations.length})
          </h3>
          {declarations.length === 0 ? (
            <p className="shipment-detail__empty">Chưa có tờ khai nào.</p>
          ) : (
            <ul className="shipment-detail__decls">
              {declarations.map((d) => (
                <li key={d.id} className="shipment-detail__decl">
                  <div><strong>{d.declarationNumber ?? `#${d.id}`}</strong></div>
                  <div className="shipment-detail__decl-meta">
                    Loại: {d.scope === 'SHARED' ? 'Chung' : 'Riêng'} · Ngày phát hành: {formatDate(d.issuedAt)}
                  </div>
                  {d.note && <div className="shipment-detail__decl-note">{d.note}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Status history timeline */}
        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <History size={16} /> Lịch sử trạng thái ({statusHistory.length})
          </h3>
          {statusHistory.length === 0 ? (
            <p className="shipment-detail__empty">Chưa có lịch sử trạng thái.</p>
          ) : (
            <ol className="shipment-detail__timeline">
              {statusHistory.map((h) => (
                <li key={h.id} className="shipment-detail__timeline-item">
                  <span className={`shipment-detail__dot ${h.fromStatus ? STATUS_DOT_CLASS[h.fromStatus] : 'shipment-detail__dot--draft'}`} aria-hidden />
                  <div className="shipment-detail__timeline-body">
                    <div className="shipment-detail__timeline-transition">
                      <span>{h.fromStatus ? SHIPMENT_STATUS_LABELS[h.fromStatus] : '—'}</span>
                      <span aria-hidden>→</span>
                      <strong>{SHIPMENT_STATUS_LABELS[h.toStatus]}</strong>
                    </div>
                    {h.reason && <div className="shipment-detail__timeline-reason">{h.reason}</div>}
                    <div className="shipment-detail__timeline-date">{formatDateTime(h.changedAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
