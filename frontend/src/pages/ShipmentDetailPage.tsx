import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, FileText, FileCheck2, Container, History,
} from 'lucide-react';
import { ApiError } from '../lib/api';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState } from '../design-system';
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_DOCUMENT_TYPE_LABELS,
  type ShipmentStatus,
  Role,
} from '@tingting/shared';
import { usePageAnimations } from '../hooks/animations';
import { useAuth } from '../hooks/useAuth';
import {
  getShipmentDetail as getShipmentDetailRequest,
  type ShipmentDetail as ShipmentDetailData,
} from '../api/shipmentClient';
import { ShipmentCoordinationPanel } from '../components/shipment/ShipmentCoordinationPanel';
import { DebitNoteFreightOverride } from '../components/billing/DebitNoteFreightOverride';
import { useDebitNoteOverride, useSaveDebitNoteOverride } from '../hooks/usePricingQueries';
import { CarrierAllocationSummary } from '../components/shipment/CarrierAllocationSummary';
import { ShipmentExpensePanel } from '../features/expense-accounting/ShipmentExpensePanel';
import { ShipmentFinancePanel } from '../features/shipment-finance/ShipmentFinancePanel';
import { formatDate, formatDateTimeVN as formatDateTime } from '../lib/format';
import { formatVnd, allocationSummaryFromDetail } from '../features/shipments/detail/shipment-detail-view';
import './WorkflowFinance.css';
import './ShipmentDetailPage.css';

const STATUS_DOT_CLASS: Record<ShipmentStatus, string> = {
  NEW: 'shipment-detail__dot--draft',
  PENDING_DATE: 'shipment-detail__dot--draft',
  READY_FOR_DISPATCH: 'shipment-detail__dot--warning',
  DISPATCHED: 'shipment-detail__dot--info',
  IN_TRANSIT: 'shipment-detail__dot--info',
  COMPLETED: 'shipment-detail__dot--success',
  CANCELED: 'shipment-detail__dot--danger',
};

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const shipmentId = Number(id);
  const coordinationActive = Boolean(user?.capabilities?.includes('shipments.read'));
  const canWriteCoordination = coordinationActive
    && Boolean(user?.capabilities?.includes('shipments.write'));

  const [data, setData] = useState<ShipmentDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Debit-note freight override (docx §4) — the financial trio negotiates the
  // final debit value on the latest frozen snapshot. GET override 404 (none
  // yet) reads as null, never an error state.
  const latestFreightSnapshot = data?.freightRate?.latest ?? null;
  const canOverrideFreight = user?.role === Role.ADMIN
    || user?.role === Role.MANAGER
    || user?.role === Role.ACCOUNTANT;
  const overrideSnapshotId = canOverrideFreight && latestFreightSnapshot ? latestFreightSnapshot.id : null;
  const [overrideError, setOverrideError] = useState(false);
  const overrideQuery = useDebitNoteOverride(overrideSnapshotId);
  const saveOverride = useSaveDebitNoteOverride(overrideSnapshotId);

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
  const shipmentLabel = shipment.shipmentCode?.trim() || 'Chưa có mã lô hàng';
  const customerLabel = shipment.customerName?.trim() || 'Chưa có tên khách hàng';
  const accountingLock = data.accountingLock ?? null;
  const carrierAllocationSummary = allocationSummaryFromDetail(data);
  const carrierAssignmentByContainerId = new Map(data.carrierAssignments
    .filter((assignment) => assignment.shipmentContainerId != null)
    .map((assignment) => [assignment.shipmentContainerId as number, assignment]));
  const lockReason = accountingLock
    ? `Khóa lô do CUS${accountingLock.activatedByName ? ` (${accountingLock.activatedByName})` : ''}${accountingLock.activatedAt ? ` lúc ${formatDateTime(accountingLock.activatedAt)}` : ''}. ${accountingLock.reason}`
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
            <div><dt>Nơi nhận</dt><dd>{shipment.pickupLocation ?? '—'}</dd></div>
            <div><dt>Nơi giao</dt><dd>{shipment.deliveryLocation ?? '—'}</dd></div>
            <div><dt>Liên hệ</dt><dd>{shipment.contactName ?? '—'}{shipment.contactPhone ? ` · ${shipment.contactPhone}` : ''}</dd></div>
            <div><dt>Ngày tạo</dt><dd>{formatDateTime(shipment.createdAt)}</dd></div>
            <div><dt>Chiều hàng</dt><dd>{shipment.tradeDirection === 'IMPORT' ? 'Nhập khẩu' : shipment.tradeDirection === 'EXPORT' ? 'Xuất khẩu' : '—'}</dd></div>
            <div><dt>Loại lô</dt><dd>{shipment.cargoMode === 'FCL' ? 'Container (FCL)' : shipment.cargoMode === 'LCL' ? 'Hàng lẻ (LCL)' : '—'}</dd></div>
            <div><dt>Nhà máy / công trường</dt><dd>{shipment.effectiveFactoryName ?? shipment.factoryName ?? '—'}</dd></div>
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
            <div className="shipment-detail__field--wide"><dt>Ghi chú cho lái xe</dt><dd>{shipment.operationalNotes ?? '—'}</dd></div>
          </dl>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-2)', paddingTop: 16, display: 'grid', gap: 8 }}>
            <strong style={{ fontSize: 'var(--text-body-size)' }}>Ghi nhận giá theo cấu hình hiện hành</strong>
            <p style={{ margin: 0, color: shipment.pricingProjection?.readiness === 'READY' ? 'var(--fg-2)' : 'var(--warn, #b45309)' }}>
              {shipment.pricingProjection?.message ?? 'Chưa có dữ liệu giá dự kiến.'}
            </p>
            {shipment.pricingProjection?.freightFormula && (
              <p style={{ margin: 0, color: 'var(--fg-3)', fontSize: 'var(--text-caption-size)' }}>
                Công thức cước: {shipment.pricingProjection.freightFormula}
              </p>
            )}
          </div>
        </section>

        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <Container size={16} /> {carrierAllocationSummary.length > 0 ? 'Nhà xe đã gán' : 'Nhà xe'}
          </h3>
          <CarrierAllocationSummary
            allocations={carrierAllocationSummary.map((row) => ({
              carrierType: row.carrierType,
              externalCarrierId: row.externalCarrierId,
              carrierLabel: row.carrierName?.trim() || (row.carrierType === 'OWN' ? 'Đội xe nội bộ SilverSea' : 'Nhà xe chưa xác định'),
              count20: row.count20,
              count40: row.count40,
            }))}
            emptyLabel="Chưa phân nhà xe"
          />
        </section>

        {coordinationActive && (
          <ShipmentCoordinationPanel shipmentId={shipment.id} canWrite={canWriteCoordination} />
        )}

        {canOverrideFreight && latestFreightSnapshot && !overrideQuery.isPending && (
          <section className="shipment-detail__card" aria-label="Điều chỉnh giá cước báo nợ">
            <h3 className="shipment-detail__section-title">
              <FileCheck2 size={16} aria-hidden="true" /> Giá cước — điều chỉnh báo nợ
            </h3>
            <DebitNoteFreightOverride
              systemFreight={latestFreightSnapshot.totalAmount}
              initialFinal={overrideQuery.data?.finalDebitFreight ?? null}
              initialReason={overrideQuery.data?.overrideReason ?? null}
              saving={saveOverride.isPending}
              onSave={(payload) => {
                setOverrideError(false);
                saveOverride.mutate(payload, {
                  onSuccess: () => void fetchDetail(),
                  onError: () => setOverrideError(true),
                });
              }}
            />
            {overrideError && (
              <p className="shipment-detail__empty" role="alert">Không lưu được điều chỉnh. Vui lòng thử lại.</p>
            )}
          </section>
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
                  <th>Nhà xe</th>
                  <th>Xe đã gán</th>
                  <th>Số seal</th>
                  <th>Lịch giao</th>
                  <th>Trọng lượng (kg)</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c) => (
                  <tr key={c.id}>
                    <td>{c.containerTypeName ?? c.containerTypeCode ?? '—'}</td>
                    <td>
                      {c.containerNumber ?? '—'}
                      {c.pairKind && (
                        <span className="shipment-detail__pair-tag">
                          {c.pairKind === 'KEP' ? '[KẸP]' : '[KẾT HỢP]'}
                        </span>
                      )}
                    </td>
                    <td>{(() => {
                      const assignment = carrierAssignmentByContainerId.get(c.id);
                      if (!assignment?.carrierType) return '—';
                      return assignment.carrierType === 'OWN'
                        ? 'Đội xe nội bộ SilverSea'
                        : assignment.externalCarrierName ?? 'Nhà xe chưa xác định';
                    })()}</td>
                    <td>{c.plannedVehiclePlate ?? '—'}</td>
                    <td>{c.sealNumber ?? '—'}</td>
                    <td>{formatDateTime(c.customerAppointmentAt)}</td>
                    <td>{c.cargoWeightKg ?? '—'}</td>
                    <td>{c.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Documents */}
        {[Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS].includes(user?.role as Role) && (
          <><ShipmentExpensePanel shipmentId={shipment.id} readOnly={Boolean(accountingLock)} chargeOnly={user?.role === Role.CUS} /><ShipmentFinancePanel shipmentId={shipment.id} accountingLocked={Boolean(accountingLock)} /></>
        )}

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
