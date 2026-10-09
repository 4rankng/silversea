import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileText, FileCheck2, Container, History, Loader2, Trash2,
} from 'lucide-react';
import { ApiError } from '../lib/api';
import { PageHeader, Modal } from '../components/UI';
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
  deleteCusShipment,
  type ShipmentDetail as ShipmentDetailData,
} from '../api/shipmentClient';
import { ShipmentCoordinationPanel } from '../components/shipment/ShipmentCoordinationPanel';
import { DebitNoteFreightOverride } from '../components/billing/DebitNoteFreightOverride';
import { useDebitNoteOverride, useSaveDebitNoteOverride } from '../hooks/usePricingQueries';
import { CarrierAllocationSummary } from '../components/shipment/CarrierAllocationSummary';
import { ShipmentExpensePanel } from '../features/expense-accounting/ShipmentExpensePanel';
import { ShipmentFinancePanel } from '../features/shipment-finance/ShipmentFinancePanel';
import { formatCurrency, formatDate, formatDateTimeShort as formatDateTime } from '../lib/format';
import { allocationSummaryFromDetail } from '../features/shipments/detail/shipment-detail-view';
import { ShipmentDetailContainers } from '../features/shipments/detail/ShipmentDetailContainers';
import { billBookingReference } from '../lib/business-reference';
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

  // Card 091026225720 (FB-031): lot-delete affordance for authorized roles (ADMIN and CUS)
  const canDeleteLot = user?.role === Role.ADMIN || user?.role === Role.CUS;
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | null>(null);

  const handleRequestDelete = useCallback(() => {
    if (!data) return;
    if (
      data.shipment.status === 'DISPATCHED' ||
      data.shipment.status === 'IN_TRANSIT' ||
      data.shipment.status === 'COMPLETED'
    ) {
      setDeleteBlockedMessage(
        'Không thể xóa lô hàng đã có container được điều xe. Chỉ xóa được khi mọi container chưa phát lệnh.',
      );
      return;
    }
    setDeleteBlockedMessage(null);
    setDeleteError(null);
    setDeleteReason('');
    setDeleteModalOpen(true);
  }, [data]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteReason.trim() || !data) return;
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      await deleteCusShipment(data.shipment.id, data.shipment.version, deleteReason.trim());
      navigate('/shipments', { replace: true });
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Không thể xóa lô hàng. Vui lòng thử lại.');
    } finally {
      setDeleteSubmitting(false);
    }
  }, [data, deleteReason, navigate]);
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
          context="search"
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
  const shipmentLabel = billBookingReference(shipment.blNumber, shipment.bookingRef);
  const customerLabel = shipment.customerName?.trim() || 'Chưa có tên khách hàng';
  const accountingLock = data.accountingLock ?? null;
  const carrierAllocationSummary = allocationSummaryFromDetail(data);
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
        action={
          canDeleteLot ? (
            <button
              type="button"
              className="btn btn--danger-outline btn--sm"
              onClick={handleRequestDelete}
            >
              <Trash2 size={14} aria-hidden="true" /> Xóa lô
            </button>
          ) : undefined
        }
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
            <div><dt>Xuất / Nhập</dt><dd>{shipment.tradeDirection === 'IMPORT' ? 'Nhập' : shipment.tradeDirection === 'EXPORT' ? 'Xuất' : '—'}</dd></div>
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
            <div><dt>Cước dự kiến</dt><dd>{formatCurrency(shipment.pricingProjection?.freightPrice)}</dd></div>
            <div><dt>Phụ phí nhiên liệu dự kiến</dt><dd>{formatCurrency(shipment.pricingProjection?.expectedFuelSurcharge)}</dd></div>
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

        <ShipmentDetailContainers containers={containers} assignments={data.carrierAssignments} />

        {/* Documents */}
        {[Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS].includes(user?.role as Role) && (
          <><ShipmentExpensePanel shipmentId={shipment.id} readOnly={Boolean(accountingLock)} chargeOnly={user?.role === Role.CUS} /><ShipmentFinancePanel shipmentId={shipment.id} accountingLocked={Boolean(accountingLock)} /></>
        )}

        <section className="shipment-detail__card">
          <h3 className="shipment-detail__section-title">
            <FileText size={16} /> Tài liệu ({documents.length})
          </h3>
          {documents.length === 0 ? (
            <EmptyState variant="compact" context="documents" title="Chưa có tài liệu nào." />
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
            <EmptyState variant="compact" context="documents" title="Chưa có tờ khai nào." />
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
            <EmptyState variant="compact" context="documents" title="Chưa có lịch sử trạng thái." />
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

      {deleteModalOpen && (
        <Modal
          isOpen={deleteModalOpen}
          title="Xóa lô hàng"
          onClose={() => { if (!deleteSubmitting) setDeleteModalOpen(false); }}
          onConfirm={() => void handleConfirmDelete()}
          footer={(
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleteSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleConfirmDelete()}
                disabled={deleteSubmitting || !deleteReason.trim()}
              >
                {deleteSubmitting ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
                Xác nhận xóa
              </button>
            </>
          )}
        >
          <p>Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu của lô và các container liên quan. Thao tác không thể hoàn tác.</p>
          {deleteError && (
            <p className="shipment-detail__empty" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>
              {deleteError}
            </p>
          )}
          <label className="cus-action-reason" style={{ display: 'grid', gap: 6 }}>
            <span>Lý do xóa</span>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Nhập lý do xóa lô hàng..."
              required
              autoFocus
            />
            <small style={{ color: 'var(--fg-3)' }}>{deleteReason.length}/500 ký tự</small>
          </label>
        </Modal>
      )}

      {deleteBlockedMessage && (
        <Modal
          isOpen={Boolean(deleteBlockedMessage)}
          title="Không thể xóa lô hàng"
          onClose={() => setDeleteBlockedMessage(null)}
          onConfirm={() => setDeleteBlockedMessage(null)}
          footer={(
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setDeleteBlockedMessage(null)}
            >
              Đóng
            </button>
          )}
        >
          <p>{deleteBlockedMessage}</p>
        </Modal>
      )}
    </div>
  );
}
