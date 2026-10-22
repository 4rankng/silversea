import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, FileCheck2, Container, History, Loader2, Pencil, Trash2, X, Plus,
} from 'lucide-react';
import { ApiError } from '../lib/api';
import { PageHeader, Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState } from '../design-system';
import { resolveLiftDropPoints } from '../features/shipments/liftDropPoints';
import { qk } from '../api/keys';
import { expenseAccountingClient } from '../api/expenseAccountingClient';
import { ExpenseCreateDrawer } from '../features/expense-accounting/ExpenseCreateDrawer';
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_DOCUMENT_TYPE_LABELS,
  type ShipmentStatus,
  type ShipmentCusWorkspaceDetail,
  Role,
} from '@tingting/shared';
import { usePageAnimations } from '../hooks/animations';
import { useAuth } from '../hooks/useAuth';
import {
  getShipmentDetail as getShipmentDetailRequest,
  getCusShipmentWorkspaceDetail,
  deleteCusShipment,
  createShipmentDeclaration,
  deleteShipmentDeclaration,
  type ShipmentDetail as ShipmentDetailData,
  type ShipmentDeclaration,
} from '../api/shipmentClient';
import { ShipmentCoordinationPanel } from '../components/shipment/ShipmentCoordinationPanel';
import { DebitNoteFreightOverride } from '../components/billing/DebitNoteFreightOverride';
import { useDebitNoteOverride, useSaveDebitNoteOverride } from '../hooks/usePricingQueries';
import { CarrierAllocationSummary } from '../components/shipment/CarrierAllocationSummary';
import { ShipmentExpensePanel } from '../features/expense-accounting/ShipmentExpensePanel';
import { ShipmentFinancePanel } from '../features/shipment-finance/ShipmentFinancePanel';
import { formatCurrency, formatDate, formatDateTimeShort as formatDateTime, formatWeight } from '../lib/format';
import { formatQuantity } from '../features/shipments/cus/cusUtils';
import { allocationSummaryFromDetail } from '../features/shipments/detail/shipment-detail-view';
import { ShipmentDetailContainers } from '../features/shipments/detail/ShipmentDetailContainers';
import { ShipmentDetailContainerManagement } from '../features/shipments/detail/ShipmentDetailContainerManagement';
import { billBookingReference } from '../lib/business-reference';
import { useCusQuickEdit } from '../features/shipments/cus/use-cus-quick-edit';
import { ShipmentQuickEditModal } from '../features/shipments/cus/ShipmentQuickEditModal';
import { QUICK_EDIT_GROUP_LABELS } from '../features/shipments/cus/cusUtils';
import { quickEditGroupGate, type QuickEditField } from '../features/shipments/cus/cusQuickEditModel';
import { useToast } from '../components/shared/Toast';
import './WorkflowFinance.css';
// Card 261022095235b: the shared container-management ledger (hosted below)
// is styled by the CUS workspace page's stylesheet — import it here so the
// detail route carries the styles even when /shipments was never opened.
import './ShipmentsPage.css';
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

  // FB-098 (card 141026230750) — nút "Khai chi phí" ngay trên chi tiết lô, mở
  // đúng drawer "Thêm khoản chi" dùng chung (khớp thao tác khách mô tả).
  const [costDrawerOpen, setCostDrawerOpen] = useState(false);
  const queryClient = useQueryClient();
  const costCatalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog, enabled: costDrawerOpen });

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

  // FB-005 (round 16): the detail page's tờ khai section was read-only only.
  // The declaration CRUD already serving the CUS quick-edit (POST/DELETE
  // /shipments/:id/declarations…) now also backs an add + per-row remove here.
  // The gate mirrors the workspace fieldAccess model for declarationNumber:
  // CUS/ADMIN/MANAGER may write; an active accounting lock closes the section.
  const canManageDeclarations = user?.role === Role.ADMIN
    || user?.role === Role.MANAGER
    || user?.role === Role.CUS;
  const [declAddOpen, setDeclAddOpen] = useState(false);
  const [declNumberDraft, setDeclNumberDraft] = useState('');
  const [declDeleteTarget, setDeclDeleteTarget] = useState<ShipmentDeclaration | null>(null);
  const [declSaving, setDeclSaving] = useState(false);
  const [declError, setDeclError] = useState<string | null>(null);

  const openDeclAdd = useCallback(() => {
    setDeclNumberDraft('');
    setDeclError(null);
    setDeclAddOpen(true);
  }, []);

  const handleConfirmDeclAdd = useCallback(async () => {
    if (!data || declSaving) return;
    const declarationNumber = declNumberDraft.trim();
    if (!declarationNumber) return;
    setDeclSaving(true);
    setDeclError(null);
    try {
      await createShipmentDeclaration(data.shipment.id, { declarationNumber });
      setDeclAddOpen(false);
      await fetchDetail();
    } catch (err) {
      setDeclError(err instanceof ApiError ? err.message : 'Không thêm được tờ khai. Vui lòng thử lại.');
    } finally {
      setDeclSaving(false);
    }
  }, [data, declNumberDraft, declSaving, fetchDetail]);

  const handleConfirmDeclDelete = useCallback(async () => {
    if (!data || !declDeleteTarget || declSaving) return;
    setDeclSaving(true);
    setDeclError(null);
    try {
      await deleteShipmentDeclaration(data.shipment.id, declDeleteTarget.id);
      setDeclDeleteTarget(null);
      await fetchDetail();
    } catch (err) {
      setDeclError(err instanceof ApiError ? err.message : 'Không xóa được tờ khai. Vui lòng thử lại.');
    } finally {
      setDeclSaving(false);
    }
  }, [data, declDeleteTarget, declSaving, fetchDetail]);

  // ─── Sửa lô (FB-086 R29 remainder, steer 21/10) ─────────────────────────
  //
  // Reconciliation: TICKET-09 (card 171026182554) superseded FB-086 at this
  // surface for CONTAINERS — /shipments/:id stays read-only on the container
  // set (composition lives solely in the Tổng quan drawer). The valid
  // remainder is lot-INFORMATION editing: the header "Sửa lô" button opens a
  // picker over the same six field groups the Tổng quan grid edits, then the
  // SAME shared quick-edit modal (one lot-info editor, two hosts). Roles =
  // SHIPMENT_INTAKE_MUTATION_ROLES (ADMIN/MANAGER/CUS/DISPATCHER) — exactly
  // what PUT /shipments/:id authorizes; per-field gating is the workspace
  // payload's own fieldAccess, so the button never widens what the server
  // accepts. Hidden while the accounting lock is active — a deliberate
  // narrowing for THIS page: the server still honors notes-only edits under
  // lock (ruling 2026-09-20), so the Tổng quan grid keeps Ghi chú editable on
  // locked lots while this host does not surface that carve-out (known
  // limitation — see testplan/cases case-QA-2026-10-21-fb086).
  const { toast } = useToast();
  const canEditLot = !data?.accountingLock && (
    user?.role === Role.ADMIN || user?.role === Role.MANAGER
    || user?.role === Role.CUS || user?.role === Role.DISPATCHER
  );
  const [lotEditPickerOpen, setLotEditPickerOpen] = useState(false);
  const [lotEditDetail, setLotEditDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [lotEditLoading, setLotEditLoading] = useState(false);
  const [lotEditError, setLotEditError] = useState<string | null>(null);
  const lotEditRequestRef = useRef(0);

  const loadLotEditDetail = useCallback(async () => {
    const reqId = ++lotEditRequestRef.current;
    setLotEditLoading(true);
    setLotEditError(null);
    try {
      const detail = await getCusShipmentWorkspaceDetail(shipmentId);
      if (lotEditRequestRef.current !== reqId) return;
      setLotEditDetail(detail);
    } catch (err) {
      if (lotEditRequestRef.current !== reqId) return;
      setLotEditError(err instanceof ApiError ? err.message : 'Không thể tải thông tin lô để sửa.');
    } finally {
      if (lotEditRequestRef.current === reqId) setLotEditLoading(false);
    }
  }, [shipmentId]);

  const openLotEditPicker = useCallback(() => {
    setLotEditPickerOpen(true);
    void loadLotEditDetail();
  }, [loadLotEditDetail]);

  // Route param transitions (/shipments/1 → /shipments/2) reuse this element
  // (no key on the route), so the previous lot's picker summary/gates must not
  // survive the id change — the reopened picker refetches fresh.
  useEffect(() => {
    setLotEditPickerOpen(false);
    setLotEditDetail(null);
    setLotEditError(null);
    lotEditRequestRef.current += 1; // invalidate any in-flight fetch for the old id
  }, [shipmentId]);

  const closeLotEditPicker = useCallback(() => {
    setLotEditPickerOpen(false);
  }, []);

  // The shared editor's save/409 self-heal paths call these page hooks; on
  // the detail page "reload the list" means refreshing the visible detail AND
  // the editor's own summary seed, and feedback rides the house toasts.
  const qe = useCusQuickEdit({
    setError: useCallback((message: string | null) => { if (message) toast({ kind: 'error', message }); }, [toast]),
    setNotice: useCallback((message: string | null) => { if (message) toast({ kind: 'success', message }); }, [toast]),
    loadList: useCallback(async () => {
      await Promise.all([fetchDetail(), loadLotEditDetail()]);
    }, [fetchDetail, loadLotEditDetail]),
    invalidateDetail: useCallback(() => { /* page holds no react-query workspace cache */ }, []),
  });
  const { quickEditDraft, setQuickEditDraft, savingQuickEdit, quickEditError, startQuickEdit, closeQuickEdit, saveQuickEdit } = qe;

  const handlePickLotEditGroup = useCallback((field: QuickEditField) => {
    if (!lotEditDetail) return;
    setLotEditPickerOpen(false);
    startQuickEdit(lotEditDetail.summary, field);
  }, [lotEditDetail, startQuickEdit]);

  // Card 171026182554 (supersedes FB-086's composition point here): adding or
  // removing a lot's containers now lives ONLY in the Tổng quan drawer
  // (/shipments). The detail screen stays read + business-edit; a second
  // composition surface raced the drawer's optimistic version and dead-ended
  // its dialog on 409s.
  // ── SUPERSEDED 22/10 09:50 (card 261022095235b): the customer asked for
  // the detail-screen add/remove back; see canManageContainersFromDetail
  // below (defined after the detail destructuring).

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
  // FB-113 (card 171026122140): the header's Số tờ khai line reads the same
  // declaration numbers the Tờ khai hải quan section renders — trimmed,
  // comma-joined when a lot carries several.
  const declarationNumbers = declarations
    .map((d) => d.declarationNumber?.trim() ?? '')
    .filter(Boolean);
  // CUS-11 (card 211026125915): the header used to read ONLY the lot-level
  // declaration rows, so a lot whose containers each carry their per-cont
  // số tờ khai (card 261013200312) still read "—" — QA took the header for
  // an unimplemented feature. Lot rows keep precedence; when the lot has
  // none, the FIRST per-container number found in the lot stands in (the
  // value names its source in the title so the provenance is not a guess).
  // Only a lot with zero declarations anywhere reads "Chưa có" — with the
  // same Thêm tờ khai flow the section below owns, linked beside the value.
  const firstContainerDeclarationNumber = containers
    .map((c) => c.declarationNumber?.trim() ?? '')
    .find(Boolean) ?? null;
  const customerLabel = shipment.customerName?.trim() || 'Chưa có tên khách hàng';
  const accountingLock = data.accountingLock ?? null;
  // Card 261022095235b (ruling 22/10 09:50, supersedes TICKET-09 of 17/10 /
  // card 171026182554): container add/remove works FROM the lot-detail
  // screen again. The version-race concern that motivated TICKET-09 is
  // answered by hosting the drawer's OWN ledger (idempotent writes +
  // FB-086-r19 stale-version reload), not a second bespoke dialog — one
  // shared implementation, two hosts. Mirrors requireWorkspaceWriter roles;
  // locked and terminal lots stay on the read-only facts section (the
  // server refuses those writes, so the affordance must not offer them).
  // LCL is containerless BY DESIGN (card 20261007_395) — a management card
  // that can never add a row would be a dead surface, so LCL keeps the
  // read-only facts section too (review 22/10 medium #3). Legacy null
  // cargoMode lots that own container rows still get the ledger.
  const canManageContainersFromDetail = !accountingLock
    && shipment.cargoMode !== 'LCL'
    && shipment.status !== 'COMPLETED' && shipment.status !== 'CANCELED'
    && (user?.role === Role.ADMIN || user?.role === Role.MANAGER
      || user?.role === Role.CUS || user?.role === Role.DISPATCHER);
  // FB-098 — cùng vai trò với nút "+ Thêm khoản chi" trong panel chi phí.
  const canDeclareCost = !accountingLock
    && (user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT);
  const carrierAllocationSummary = allocationSummaryFromDetail(data);
  // FB-106 (card 171026115810) — "Tạo lô mới" đi thẳng tới /shipments/new.
  // Cùng bộ vai trò với ShipmentsPage.canCreateShipment và route guard
  // `shipmentCreatorOnly` (App.tsx): vai trò mà route tạo lô từ chối thì
  // không được thấy nút này.
  const canCreateShipment = user?.role === Role.ADMIN || user?.role === Role.CUS
    || user?.role === Role.MANAGER || user?.role === Role.DISPATCHER;
  // FB-107 (card 171026115820) — Nơi nhận / Nơi giao là hai điểm Nâng/Hạ thật
  // của lô, theo đúng một luật dùng chung (`resolveLiftDropPoints`): FCL lấy
  // tên cảng của container (không đảo theo chiều), LCL đổi vai theo Nhập/Xuất
  // (Nhập: Nâng = Kho, Hạ = Nhà máy; Xuất: ngược lại). Hai cột
  // pickup_location/delivery_location được form tạo lô ghi đúng chiều cho hàng
  // lẻ (FB-105) và là dự phòng khi nửa điểm chưa từng chọn danh mục — các lô
  // tạo trước FB-105/seed có thể để trống cả hai.
  const liftDropPoints = resolveLiftDropPoints({
    cargoMode: shipment.cargoMode,
    tradeDirection: shipment.tradeDirection,
    warehouseName: shipment.pickupWarehouseSiteName,
    factoryName: shipment.effectiveFactoryName ?? shipment.factoryName,
    containerLiftNames: containers.map((container) => container.pickupPortName),
    containerDropNames: containers.map((container) => container.dropoffPortName),
    liftFallback: shipment.pickupLocation,
    dropFallback: shipment.deliveryLocation,
  });
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
          (canDeclareCost || canEditLot || canCreateShipment || canDeleteLot) ? (
            <>
              {canDeclareCost && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setCostDrawerOpen(true)}
                >
                  Khai chi phí
                </button>
              )}
              {canEditLot && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={openLotEditPicker}
                >
                  <Pencil size={14} aria-hidden="true" /> Sửa lô
                </button>
              )}
              {canCreateShipment && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => navigate('/shipments/new')}
                >
                  <Plus size={14} aria-hidden="true" /> Tạo lô mới
                </button>
              )}
              {canDeleteLot && (
                <button
                  type="button"
                  className="btn btn--danger-outline btn--sm"
                  onClick={handleRequestDelete}
                >
                  <Trash2 size={14} aria-hidden="true" /> Xóa lô
                </button>
              )}
            </>
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
            {/* FB-113 (card 171026122140, R24/R25 "standing"): this page shares
                the nav title "Chi tiết lô hàng" with the /shipments-detail
                ledger and is the surface QA's "header thiếu Số tờ khai, thứ tự
                sai" points at — the popup (v1) and ledger (v2) fixes never
                reached it. The header now presents the documents group in the
                card's order: Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu.
                Bill and Booking are direction-exclusive (the quick-edit model
                clears the other), so one reference line rides the shared
                billBookingReference; tờ khai numbers are the same `declarations`
                the Tờ khai hải quan section below already shows.
                CUS-11 (card 211026125915): the value never reads "—" — lot
                rows, else the first per-container number, else "Chưa có" with
                the add-flow link so the flow is visible where QA looks. */}
            <div><dt>Số Bill / Số Booking</dt><dd>{shipmentLabel}</dd></div>
            <div>
              <dt>Số tờ khai</dt>
              <dd
                title={declarationNumbers.length === 0 && firstContainerDeclarationNumber
                  ? 'Lô chưa có tờ khai cấp lô; giá trị là số tờ khai của container đầu tiên có tờ khai trong lô.'
                  : undefined}
              >
                {declarationNumbers.length > 0 ? declarationNumbers.join(', ') : firstContainerDeclarationNumber ?? (
                  <>
                    Chưa có
                    {canManageDeclarations && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="shipment-detail__decl-link"
                          onClick={openDeclAdd}
                          disabled={Boolean(accountingLock) || declSaving}
                          title={accountingLock ? 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.' : 'Thêm tờ khai cho lô này'}
                        >
                          Thêm tờ khai
                        </button>
                      </>
                    )}
                  </>
                )}
              </dd>
            </div>
            {/* Card 261022213755c: hàng lẻ đọc "Nhập lẻ"/"Xuất lẻ" — lô lẻ
                phân biệt rõ với cont ngay ở dòng direction (cùng luật với
                badge cus-direction-badge trên list). */}
            <div><dt>Xuất / Nhập</dt><dd>{shipment.tradeDirection === 'IMPORT' ? (shipment.cargoMode === 'LCL' ? 'Nhập lẻ' : 'Nhập') : shipment.tradeDirection === 'EXPORT' ? (shipment.cargoMode === 'LCL' ? 'Xuất lẻ' : 'Xuất') : '—'}</dd></div>
            <div><dt>Hãng tàu</dt><dd>{shipment.shippingLineName ?? '—'}</dd></div>
            <div><dt>Nâng</dt><dd>{liftDropPoints.lift ?? '—'}</dd></div>
            <div><dt>Hạ</dt><dd>{liftDropPoints.drop ?? '—'}</dd></div>
            <div><dt>Liên hệ</dt><dd>{shipment.contactName ?? '—'}{shipment.contactPhone ? ` · ${shipment.contactPhone}` : ''}</dd></div>
            <div><dt>Ngày tạo</dt><dd>{formatDateTime(shipment.createdAt)}</dd></div>
            <div><dt>Loại lô</dt><dd>{shipment.cargoMode === 'FCL' ? 'Container (FCL)' : shipment.cargoMode === 'LCL' ? 'Hàng lẻ (LCL)' : '—'}</dd></div>
            <div><dt>Nhà máy / công trường</dt><dd>{shipment.effectiveFactoryName ?? shipment.factoryName ?? '—'}</dd></div>
            {/* Card 101026163040 (FB-074): the overview names the lot's route;
                the detail must carry the same fact or the two views disagree. */}
            <div><dt>Tuyến đường</dt><dd>{shipment.routeName ?? '—'}</dd></div>
            <div><dt>Cut-off hải quan</dt><dd>{formatDateTime(shipment.customsCutoffAt)}</dd></div>
            <div><dt>Giờ đóng hàng</dt><dd>{formatDateTime(shipment.closingAt)}</dd></div>
            <div><dt>Thời gian trả</dt><dd>{formatDateTime(shipment.plannedReturnAt)}</dd></div>
            {/* Cards 101026163030 / 101026163040: the numeric columns arrive
                as storage decimals ("500.00", "2.000") — ride the same measure
                axis as the overview rows instead of echoing the column. */}
            <div><dt>Trọng lượng</dt><dd>{formatWeight(shipment.cargoWeightKg)}</dd></div>
            {shipment.cargoMode === 'LCL' && (
              <>
                <div><dt>Thể tích</dt><dd>{shipment.cargoVolumeCbm ? `${formatQuantity(shipment.cargoVolumeCbm)} CBM` : '—'}</dd></div>
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

        {/* ── Card 261022095235b (ruling 22/10 09:50, supersedes TICKET-09 of
            17/10): container add/remove works FROM the lot-detail screen
            again. Writers get the SAME management ledger the Tổng quan
            drawer hosts (one shared implementation); readers and locked or
            terminal lots keep the read-only facts section. */}
        {canManageContainersFromDetail ? (
          <ShipmentDetailContainerManagement shipmentId={shipment.id} onChanged={() => void fetchDetail()} />
        ) : (
          <ShipmentDetailContainers
            containers={containers}
            assignments={data.carrierAssignments}
          />
        )}

        {/* Documents */}
        {/* chiphispec §1 — the cost-entry affordance must not hide from OPS:
            the expense panel (with "+ Thêm khoản chi") mounts for OPS too, the
            finance-only ShipmentFinancePanel keeps its original role set. */}
        {[Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.OPS].includes(user?.role as Role) && (
          <ShipmentExpensePanel shipmentId={shipment.id} shipmentCode={shipmentLabel} readOnly={Boolean(accountingLock)} chargeOnly={user?.role === Role.CUS}
            carrier={(() => {
              // chiphispec QA 181026183500 — "Nhà cung cấp" defaults to the
              // route's truck: the lot's first EXTERNAL carrier assignment
              // (drawer matches by supplierId, falls back by name).
              const external = data.carrierAssignments.find(a => a.carrierType === 'EXTERNAL' && (a.externalCarrierId != null || a.externalCarrierName));
              return external ? { supplierId: external.externalCarrierId, name: external.externalCarrierName } : undefined;
            })()} />
        )}
        {[Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS].includes(user?.role as Role) && (
          <ShipmentFinancePanel shipmentId={shipment.id} accountingLocked={Boolean(accountingLock)} />
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
          <div className="shipment-detail__section-head">
            <h3 className="shipment-detail__section-title">
              <FileCheck2 size={16} /> Tờ khai hải quan ({declarations.length})
            </h3>
            {canManageDeclarations && (
              <button
                type="button"
                className="btn btn--secondary btn--sm shipment-detail__decl-add"
                onClick={openDeclAdd}
                disabled={Boolean(accountingLock) || declSaving}
                title={accountingLock ? 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.' : undefined}
              >
                + Thêm tờ khai
              </button>
            )}
          </div>
          {declarations.length === 0 ? (
            <EmptyState variant="compact" context="documents" title="Chưa có tờ khai nào." />
          ) : (
            <ul className="shipment-detail__decls">
              {declarations.map((d) => (
                <li key={d.id} className="shipment-detail__decl">
                  <div className="shipment-detail__decl-body">
                    <div><strong>{d.declarationNumber?.trim() || 'Chưa có số tờ khai'}</strong></div>
                    <div className="shipment-detail__decl-meta">
                      Loại: {d.scope === 'SHARED' ? 'Chung' : 'Riêng'} · Ngày phát hành: {formatDate(d.issuedAt)}
                    </div>
                    {d.note && <div className="shipment-detail__decl-note">{d.note}</div>}
                  </div>
                  {canManageDeclarations && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm shipment-detail__decl-remove"
                      onClick={() => { setDeclError(null); setDeclDeleteTarget(d); }}
                      disabled={Boolean(accountingLock) || declSaving}
                      title={accountingLock ? 'Lô hàng đã khóa kế toán; không thể sửa tờ khai.' : undefined}
                      aria-label={`Xóa tờ khai ${d.declarationNumber?.trim() || 'trống'}`}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}
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

      {costDrawerOpen && !costCatalog.data && <p role="status">Đang tải danh mục khoản chi…</p>}
      {costDrawerOpen && costCatalog.data && (
        <ExpenseCreateDrawer
          work={{ tripId: null, shipmentId: shipment.id, shipmentCode: shipmentLabel, containerNumber: null }}
          catalog={costCatalog.data}
          onClose={() => setCostDrawerOpen(false)}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: qk.expenseAccounting.all }); }}
        />
      )}

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

      {declAddOpen && (
        <Modal
          isOpen={declAddOpen}
          title="Thêm tờ khai"
          onClose={() => { if (!declSaving) setDeclAddOpen(false); }}
          onConfirm={() => void handleConfirmDeclAdd()}
          footer={(
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDeclAddOpen(false)}
                disabled={declSaving}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleConfirmDeclAdd()}
                disabled={declSaving || !declNumberDraft.trim()}
              >
                {declSaving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
                Thêm tờ khai
              </button>
            </>
          )}
        >
          <label className="cus-action-reason" style={{ display: 'grid', gap: 6 }}>
            <span>Số tờ khai</span>
            <input
              className="input"
              value={declNumberDraft}
              onChange={(e) => setDeclNumberDraft(e.target.value)}
              maxLength={50}
              placeholder="Nhập số tờ khai..."
              disabled={declSaving}
              autoFocus
            />
            <small style={{ color: 'var(--fg-3)', textAlign: 'left' }}>Số tờ khai chỉ định cho lô này; số đã thuộc lô khác sẽ bị từ chối.</small>
          </label>
          {declError && (
            <p className="shipment-detail__empty" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>
              {declError}
            </p>
          )}
        </Modal>
      )}

      {declDeleteTarget && (
        <Modal
          isOpen={Boolean(declDeleteTarget)}
          title="Xóa tờ khai"
          onClose={() => { if (!declSaving) setDeclDeleteTarget(null); }}
          onConfirm={() => void handleConfirmDeclDelete()}
          footer={(
            <>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setDeclDeleteTarget(null)}
                disabled={declSaving}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleConfirmDeclDelete()}
                disabled={declSaving}
              >
                {declSaving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
                Xác nhận xóa
              </button>
            </>
          )}
        >
          <p>Xóa tờ khai {declDeleteTarget.declarationNumber?.trim() || 'trống'} khỏi lô hàng. Thao tác không thể hoàn tác.</p>
          {declError && (
            <p className="shipment-detail__empty" role="alert" style={{ color: 'var(--danger, #dc2626)' }}>
              {declError}
            </p>
          )}
        </Modal>
      )}
      {/* Sửa lô — group picker (FB-086 R29 remainder). Fetches the same
          workspace detail the Tổng quan edits from, then hands the picked
          group to the shared quick-edit modal below. */}
      {lotEditPickerOpen && (
        <Modal
          isOpen
          title="Sửa thông tin lô"
          onClose={closeLotEditPicker}
          footer={(
            <button
              type="button"
              className="btn btn--ghost"
              onClick={closeLotEditPicker}
            >
              Đóng
            </button>
          )}
        >
          <p className="cus-quick-edit-modal__context">{shipmentLabel}</p>
          {lotEditLoading && <p role="status" style={{ color: 'var(--fg-2)' }}>Đang tải thông tin lô…</p>}
          {lotEditError && (
            <div className="cus-inline-error" role="alert">
              <span>{lotEditError}</span>
              <button type="button" onClick={() => void loadLotEditDetail()}>Thử lại</button>
            </div>
          )}
          {lotEditDetail && (
            <div className="lot-edit-picker" style={{ display: 'grid', gap: 8 }}>
              {(Object.keys(QUICK_EDIT_GROUP_LABELS) as QuickEditField[]).map((field) => {
                const gate = quickEditGroupGate(lotEditDetail.summary, field);
                return (
                  <button
                    key={field}
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={gate.disabled}
                    title={gate.reason ?? undefined}
                    onClick={() => handlePickLotEditGroup(field)}
                  >
                    {QUICK_EDIT_GROUP_LABELS[field]}
                  </button>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* Same shared lot-info editor the Tổng quan grid opens (one editor,
          two hosts). Containers are deliberately NOT part of it — TICKET-09
          (card 171026182554) keeps container composition in the drawer. */}
      <ShipmentQuickEditModal
        open={quickEditDraft != null && lotEditDetail?.summary.id === quickEditDraft.shipmentId}
        draft={quickEditDraft}
        item={lotEditDetail?.summary ?? null}
        saving={savingQuickEdit}
        error={quickEditError}
        onDraftChange={setQuickEditDraft}
        close={closeQuickEdit}
        save={() => { if (lotEditDetail) void saveQuickEdit(lotEditDetail.summary); }}
      />
    </div>
  );
}
