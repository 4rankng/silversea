import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, FileText, FileCheck2, Container, History, ClipboardPenLine,
} from 'lucide-react';
import { ApiError } from '../lib/api';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, SelectField, TextField } from '../design-system';
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_DOCUMENT_TYPE_LABELS,
  type ShipmentStatus,
  type ShipmentDocumentType,
  Role,
} from '@tingting/shared';
import { usePageAnimations } from '../hooks/animations';
import { useAuth } from '../hooks/useAuth';
import {
  getShipmentDetail as getShipmentDetailRequest,
  activateShipmentAccountingLock,
  type ShipmentDetail as ShipmentDetailData,
  type ShipmentPodReviewItem,
  type ShipmentCarrierAllocationGroup,
} from '../api/shipmentClient';
import { financialClient } from '../api/financialClient';
import type { BillingDocument } from '@tingting/shared';
import { ShipmentCoordinationPanel } from '../components/shipment/ShipmentCoordinationPanel';
import { TripPodReviewPanel } from '../components/shipment/TripPodReviewPanel';
import { CarrierAllocationSummary } from '../components/shipment/CarrierAllocationSummary';
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
  tradeDirection?: 'IMPORT' | 'EXPORT' | null;
  cargoMode?: 'FCL' | 'LCL' | null;
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

const STATUS_DOT_CLASS: Record<ShipmentStatus, string> = {
  NEW: 'shipment-detail__dot--draft',
  PENDING_DATE: 'shipment-detail__dot--draft',
  READY_FOR_DISPATCH: 'shipment-detail__dot--warning',
  DISPATCHED: 'shipment-detail__dot--info',
  IN_TRANSIT: 'shipment-detail__dot--info',
  PENDING_EXPENSE_APPROVAL: 'shipment-detail__dot--warning',
  COMPLETED: 'shipment-detail__dot--success',
  CANCELED: 'shipment-detail__dot--danger',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN');
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN');
}

function formatVnd(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}

function allocationSummaryFromDetail(data: ShipmentDetailData): ShipmentCarrierAllocationGroup[] {
  const grouped = new Map<string, ShipmentCarrierAllocationGroup>();
  const containerById = new Map(data.containers.map((container) => [container.id, container]));
  for (const assignment of data.carrierAssignments) {
    if (!assignment.carrierType || assignment.shipmentContainerId == null) continue;
    const container = containerById.get(assignment.shipmentContainerId);
    if (!container) continue;
    const rawLabel = `${assignment.containerTypeCode ?? ''} ${assignment.containerTypeName ?? ''}`.toUpperCase();
    const bucket = rawLabel.includes('20') ? 'count20' : rawLabel.includes('40') ? 'count40' : null;
    if (!bucket) continue;
    const key = `${assignment.carrierType}:${assignment.externalCarrierId ?? 'own'}`;
    const current = grouped.get(key) ?? {
      carrierType: assignment.carrierType,
      externalCarrierId: assignment.externalCarrierId,
      carrierName: assignment.carrierType === 'OWN' ? 'Đội xe nội bộ SilverSea' : assignment.externalCarrierName,
      count20: 0,
      count40: 0,
    };
    current[bucket] += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const shipmentId = Number(id);
  const canOperate = user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.CLERK;
  const canReviewPod = user?.role === Role.CLERK;
  const canCompleteShipment = user?.role === Role.ACCOUNTANT;
  const canSeePodReview = canReviewPod || canCompleteShipment || user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const canResolveCancellation = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const coordinationActive = Boolean(user?.capabilities?.includes('shipments.read'));
  const canWriteCoordination = coordinationActive
    && Boolean(user?.capabilities?.includes('shipments.write'));

  const [data, setData] = useState<ShipmentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debitNotes, setDebitNotes] = useState<BillingDocument[]>([]);
  const [selectedDebitNoteId, setSelectedDebitNoteId] = useState('');
  const [lockReasonInput, setLockReasonInput] = useState('Đã phát hành Debit Note và chốt công nợ với khách hàng.');
  const [lockSubmitting, setLockSubmitting] = useState(false);
  const [lockMessage, setLockMessage] = useState<string | null>(null);

  // Stale-response guard: when navigating from /shipments/1 to /shipments/2
  // while the first request is in flight, the first response must NOT
  // overwrite the second. Increment a request id per fetch; ignore the
  // response if a newer fetch has started.
  const requestIdRef = useRef(0);

  const { rootRef } = usePageAnimations({ ready: !loading && !!data });

  const fetchDetail = useCallback(async () => {
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      setError('Đường dẫn lô hàng không hợp lệ');
      setLoading(false);
      return;
    }
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getShipmentDetailRequest(shipmentId);
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

  useEffect(() => {
    if (user?.role !== Role.ACCOUNTANT || !data || data.accountingLock) return;
    let cancelled = false;
    void financialClient.listBillingDocuments('CUSTOMER', data.shipment.customerId, 'DEBIT_NOTE')
      .then((documents) => {
        if (cancelled) return;
        const eligible = documents.filter((document) => (
          ['SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID'].includes(document.debitNoteStatus ?? '')
          && (document.authorityState ?? 'CURRENT') === 'CURRENT'
        ));
        setDebitNotes(eligible);
        setSelectedDebitNoteId((current) => current || (eligible[0] ? String(eligible[0].id) : ''));
      })
      .catch(() => {
        if (!cancelled) setLockMessage('Không thể tải danh sách Debit Note đã phát hành.');
      });
    return () => { cancelled = true; };
  }, [data, user?.role]);

  const handleAccountingLock = useCallback(async () => {
    if (!data || !selectedDebitNoteId || !lockReasonInput.trim()) return;
    setLockSubmitting(true);
    setLockMessage(null);
    try {
      await activateShipmentAccountingLock(data.shipment.id, {
        expectedVersion: data.shipment.version,
        billingDocumentId: Number(selectedDebitNoteId),
        reason: lockReasonInput.trim(),
      });
      await fetchDetail();
      setLockMessage('Đã khóa lô. Mọi thay đổi vận hành hiện đã bị vô hiệu hóa.');
    } catch (reason) {
      setLockMessage(reason instanceof Error ? reason.message : 'Không thể khóa lô.');
    } finally {
      setLockSubmitting(false);
    }
  }, [data, fetchDetail, lockReasonInput, selectedDebitNoteId]);

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

  const { shipment, containers, documents, declarations, statusHistory, podReviews } = data;
  const shipmentLabel = shipment.shipmentCode?.trim() || 'Chưa có mã lô hàng';
  const customerLabel = shipment.customerName?.trim() || 'Chưa có tên khách hàng';
  const accountingLock = data.accountingLock ?? null;
  const carrierAllocationSummary = allocationSummaryFromDetail(data);
  const carrierAssignmentByContainerId = new Map(data.carrierAssignments
    .filter((assignment) => assignment.shipmentContainerId != null)
    .map((assignment) => [assignment.shipmentContainerId as number, assignment]));
  const lockReason = accountingLock
    ? `Đã khóa bởi Kế toán${accountingLock.activatedByName ? ` ${accountingLock.activatedByName}` : ''}${accountingLock.activatedAt ? ` lúc ${formatDateTime(accountingLock.activatedAt)}` : ''}. ${accountingLock.reason}`
    : null;

  return (
    <div className="shipment-detail page-anim" ref={rootRef}>
      <Breadcrumbs items={[
        { label: 'Lô hàng', to: '/shipments' },
        { label: shipmentLabel },
      ]} />

      <PageHeader
        title={shipmentLabel}
        description={`Trạng thái: ${SHIPMENT_STATUS_LABELS[shipment.status]}`}
        onBack={() => navigate('/shipments')}
        action={canOperate ? (
          accountingLock ? (
            <button type="button" className="btn btn--secondary shipment-detail__operate" disabled title={lockReason ?? undefined}>
              <ClipboardPenLine size={18} aria-hidden="true" />
              Đã khóa bởi Kế toán
            </button>
          ) : (
            <Link
              to={`/clerk/shipments/${shipment.id}/docs`}
              className="btn btn--primary shipment-detail__operate"
            >
              <ClipboardPenLine size={18} aria-hidden="true" />
              Cập nhật &amp; điều xe
            </Link>
          )
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
            <div><dt>Khách hàng</dt><dd>{customerLabel}</dd></div>
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
            <div><dt>Giờ đóng hàng</dt><dd>{formatDateTime(shipment.closingAt)}</dd></div>
            <div><dt>Thời gian trả</dt><dd>{formatDateTime(shipment.plannedReturnAt)}</dd></div>
            <div><dt>Trọng lượng</dt><dd>{shipment.cargoWeightKg ? `${shipment.cargoWeightKg} kg` : '—'}</dd></div>
            {shipment.cargoMode === 'LCL' && (
              <>
                <div><dt>Thể tích</dt><dd>{shipment.cargoVolumeCbm ? `${shipment.cargoVolumeCbm} CBM` : '—'}</dd></div>
                <div><dt>Kiện hàng</dt><dd>{shipment.packageCount != null ? `${shipment.packageCount}${shipment.packageType ? ` ${shipment.packageType}` : ' kiện'}` : '—'}</dd></div>
              </>
            )}
            <div><dt>Cước dự kiến</dt><dd>{formatVnd(shipment.pricingProjection?.freightPrice)}</dd></div>
            <div><dt>Phụ phí nhiên liệu dự kiến</dt><dd>{formatVnd(shipment.pricingProjection?.expectedFuelSurcharge)}</dd></div>
            {accountingLock && (
              <div className="shipment-detail__field--wide">
                <dt>Khóa lô</dt>
                <dd>{lockReason}</dd>
              </div>
            )}
            <div className="shipment-detail__field--wide"><dt>Ghi chú vận hành</dt><dd>{shipment.operationalNotes ?? '—'}</dd></div>
          </dl>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-2)', paddingTop: 16, display: 'grid', gap: 8 }}>
            <strong style={{ fontSize: 14 }}>Ghi nhận giá theo cấu hình hiện hành</strong>
            <p style={{ margin: 0, color: shipment.pricingProjection?.readiness === 'READY' ? 'var(--fg-2)' : 'var(--warn, #b45309)' }}>
              {shipment.pricingProjection?.message ?? 'Chưa có dữ liệu giá dự kiến.'}
            </p>
            {shipment.pricingProjection?.freightFormula && (
              <p style={{ margin: 0, color: 'var(--fg-3)', fontSize: 13 }}>
                Công thức cước: {shipment.pricingProjection.freightFormula}
              </p>
            )}
          </div>
        </section>

        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <Container size={16} /> Nhà xe đã gán
          </h3>
          <CarrierAllocationSummary
            allocations={carrierAllocationSummary.map((row) => ({
              carrierType: row.carrierType,
              externalCarrierId: row.externalCarrierId,
              carrierLabel: row.carrierName?.trim() || (row.carrierType === 'OWN' ? 'Đội xe nội bộ SilverSea' : 'Nhà xe chưa xác định'),
              count20: row.count20,
              count40: row.count40,
            }))}
            emptyLabel="Chưa có dữ liệu gán nhà xe cho lô hàng này."
          />
        </section>

        {user?.role === Role.ACCOUNTANT && !accountingLock && (
          <section className="shipment-detail__card" aria-labelledby="accounting-lock-title">
            <h3 id="accounting-lock-title" className="shipment-detail__section-title">
              Khóa lô sau khi xuất Debit Note
            </h3>
            <p>Khóa lô sẽ vô hiệu hóa toàn bộ chỉnh sửa vận hành. Các sai lệch sau đó phải xử lý bằng chứng từ điều chỉnh.</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <SelectField
                label="Debit Note đã phát hành"
                value={selectedDebitNoteId}
                onChange={(event) => setSelectedDebitNoteId(event.target.value)}
                disabled={lockSubmitting}
              >
                <option value="">— Chọn Debit Note —</option>
                {debitNotes.map((document) => (
                  <option key={document.id} value={document.id}>
                    Debit Note #{document.id} · {document.rangeFrom} – {document.rangeTo}
                  </option>
                ))}
              </SelectField>
              <TextField
                label="Lý do khóa"
                value={lockReasonInput}
                onChange={(event) => setLockReasonInput(event.target.value)}
                disabled={lockSubmitting}
              />
              {lockMessage && <p role="status" style={{ margin: 0 }}>{lockMessage}</p>}
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleAccountingLock()}
                disabled={lockSubmitting || !selectedDebitNoteId || !lockReasonInput.trim()}
              >
                {lockSubmitting ? 'Đang khóa…' : 'Khóa lô'}
              </button>
            </div>
          </section>
        )}

        {canSeePodReview && (
          <TripPodReviewPanel
            shipmentId={shipment.id}
            shipmentVersion={shipment.version}
            shipmentStatus={shipment.status}
            items={podReviews}
            canReview={canReviewPod}
            canComplete={canCompleteShipment}
            canResolveCancellation={canResolveCancellation}
            onChanged={fetchDetail}
          />
        )}

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
                  <th>Loại</th>
                  <th>Số container</th>
                  <th>Nhà xe đã gán</th>
                  <th>Xe đã gán</th>
                  <th>Số seal</th>
                  <th>Trọng lượng (kg)</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c) => (
                  <tr key={c.id}>
                    <td>{c.containerTypeName ?? c.containerTypeCode ?? '—'}</td>
                    <td>{c.containerNumber ?? '—'}</td>
                    <td>{(() => {
                      const assignment = carrierAssignmentByContainerId.get(c.id);
                      if (!assignment?.carrierType) return '—';
                      return assignment.carrierType === 'OWN'
                        ? 'Đội xe nội bộ SilverSea'
                        : assignment.externalCarrierName ?? 'Nhà xe chưa xác định';
                    })()}</td>
                    <td>{c.plannedVehiclePlate ?? '—'}</td>
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
                  <span className="shipment-detail__doc-type">{d.type ? SHIPMENT_DOCUMENT_TYPE_LABELS[d.type] : 'Khác'}</span>
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
                  <div><strong>{d.declarationNumber?.trim() || 'Chưa có số tờ khai'}</strong></div>
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
