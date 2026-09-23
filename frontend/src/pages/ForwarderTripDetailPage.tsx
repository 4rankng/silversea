import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Calendar, MapPin, Package, Plus, CheckCircle2, RotateCcw } from 'lucide-react';
import { formatDate } from '../lib/format';
import { api, fileCommandFingerprint } from '../lib/api';
import { ExpenseEntryStatus } from '@tingting/shared';
import { TRIP_STATUS_LABELS, type TripStatus } from '@tingting/shared';
import { StatusPill, useConfirm } from '../components/UI';
import { useReasonPrompt } from '../components/reason-prompt';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import { qk } from '../api/keys';
import { useForwarderTripDetail, useDeleteForwarderExpense } from '../hooks/useQueries';
import { useSetForwarderExpenseCompletion } from '../hooks/useForwarderQueries';
import { useCatalogs } from '../hooks/useCatalogs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { forwarderClient } from '../api/forwarderClient';
import { geotagClient } from '../api/geotagClient';
import { useToast } from '../components/shared/Toast';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useGeolocation } from '../hooks/useGeolocation';
import { buildIdempotencyKey } from '../lib/idempotency';
import { expensePhotoUploadErrorMessage } from '../features/forwarder/forwarder-expense-model';
import { ForwarderExpenseForm } from '../features/forwarder/ForwarderExpenseForm';
import { useForwarderContainerForm } from '../features/forwarder/use-forwarder-container-form';
import { useForwarderExpenseForm } from '../features/forwarder/use-forwarder-expense-form';
import {
  ForwarderContainersSection,
  ForwarderExpenseRow,
  ForwarderTripError,
  ForwarderTripLoading,
  getForwarderContainerScopeLabel,
  type ForwarderContainer,
} from '../features/forwarder/forwarder-trip-detail-sections';
import { tripStatusVariant } from '../lib/tripStatus';
import './ForwarderTripDetailPage.css';

interface ForwarderTripWorkspaceProps {
  tripId: number;
  embedded?: boolean;
  onClose?: () => void;
}

export function ForwarderTripWorkspace({ tripId, embedded = false, onClose }: ForwarderTripWorkspaceProps) {
  const navigate = useNavigate();

  const { data: trip, isLoading: loading, error: queryError } = useForwarderTripDetail(tripId);
  const queryClient = useQueryClient();
  const { rootRef } = usePageAnimations({ ready: !loading });

  const completionMut = useSetForwarderExpenseCompletion();
  const deleteExpenseMut = useDeleteForwarderExpense();
  const geolocation = useGeolocation();

  const { data: catalogs } = useCatalogs();
  const forwarderExpenseTypeOptions = catalogs?.forwarderExpenseTypes ?? [];

  const { data: suppliersResp } = useQuery({
    queryKey: qk.forwarder.suppliers,
    queryFn: () => forwarderClient.listSuppliers(),
    staleTime: 5 * 60 * 1000,
  });
  const supplierOptions = suppliersResp?.items ?? [];

  const containerFormCtrl = useForwarderContainerForm(tripId);
  const expenseFormCtrl = useForwarderExpenseForm({ tripId, trip, forwarderExpenseTypeOptions });

  // Expense photo state: maps expenseId → photo URLs
  const [expensePhotos, setExpensePhotos] = useState<Record<number, string[]>>({});
  const [uploadingExpenseId, setUploadingExpenseId] = useState<number | null>(null);
  const [paperOrderSubmitting, setPaperOrderSubmitting] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { prompt, dialog: reasonDialog } = useReasonPrompt();
  const { toast } = useToast();

  const handleBack = () => embedded ? onClose?.() : navigate('/my-forwarder-trips');
  const isDirty = () => containerFormCtrl.isDirty || expenseFormCtrl.isDirty;
  useBackShortcut(handleBack, {
    enabled: !embedded,
    isDirty,
    confirmDiscard: () => confirm('Thoát mà không lưu? Các thay đổi chưa lưu sẽ bị mất.', { variant: 'warning', confirmLabel: 'Thoát' }),
  });

  async function loadExpensePhotos(expenseId: number) {
    try {
      const res = await api.get<{ items: Array<{ id: number; storageKey: string }> }>(`/forwarder/me/expenses/${expenseId}/photos`);
      const items = res.items.map((p) => ({
        id: p.id,
        url: `/api/photos/${encodeURIComponent(p.storageKey)}`,
      }));
      const urls = items.map((item) => item.url);
      setExpensePhotos(prev => ({ ...prev, [expenseId]: urls }));
    } catch {
      // Photo list is supplementary UI: failures leave the section empty
      // rather than blocking the expense detail view.
    }
  }

  async function handleUploadPhoto(expenseId: number, file: File) {
    setUploadingExpenseId(expenseId);
    try {
      const location = await geolocation.awaitAccurateSample();
      const form = new FormData();
      form.append('file', file);
      const retryFingerprint = [
        'forwarder-expense-photo',
        fileCommandFingerprint(file),
        expenseId,
      ].join(':');
      const photo = await api.upload(
        `/forwarder/me/expenses/${expenseId}/photos`,
        form,
        { retryFingerprint },
      ) as { id: number };
      try {
        await geotagClient.submit({
          entityType: 'trip_expense_photo',
          entityId: photo.id,
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          gpsAt: location.timestamp,
          source: 'phone',
        });
      } catch {
        toast({
          kind: 'warning',
          message: 'Ảnh đã được tải lên nhưng chưa lưu được vị trí GPS. Ảnh vẫn hiển thị trong chứng từ.',
        });
      }
      await loadExpensePhotos(expenseId);
    } catch (error) {
      toast({
        kind: 'error',
        message: expensePhotoUploadErrorMessage(error),
      });
    } finally {
      setUploadingExpenseId(null);
    }
  }

  if (loading) return <ForwarderTripLoading />;

  if (queryError || !trip) return <ForwarderTripError queryError={Boolean(queryError)} onBack={handleBack} />;

  const handleDeleteExpense = async (expenseId: number) => {
    const expense = trip.expenses.find(item => item.id === expenseId);
    if (!expense) return;
    // Q10 (card 20260922_78): the void asks for a mandatory free-text reason;
    // cancel aborts without any request.
    const reason = await prompt('Xóa khoản chi này? Dòng phí được giữ lại ở trạng thái đã hủy kèm lý do để đối chiếu.', {
      confirmLabel: 'Xóa khoản chi',
    });
    if (reason == null) return;
    deleteExpenseMut.mutate({ id: expenseId, tripId, expectedUpdatedAt: expense.updatedAt, reason });
  };

  const containers = (trip.containers || []) as ForwarderContainer[];
  const expenses = trip.expenses || [];
  const completionScopes = trip.completionScopes ?? [];
  const completedScopeCount = completionScopes.filter(scope => scope.status === ExpenseEntryStatus.COMPLETED).length;
  const totalScopeCount = completionScopes.length;
  const legs = (trip.legs || []) as Array<{ id: number; sequence: number; origin: string; destination: string; km: number; loadingType: string; }>;
  const portOptions = catalogs?.ports ?? [];
  const containerTypeOptions = catalogs?.containerTypes ?? [];
  const generalExpenses = expenses.filter(exp => !exp.tripContainerId);
  const expenseGroups = [
    ...containers.map(container => ({
      key: String(container.id),
      tripContainerId: container.id as number | null,
      label: getForwarderContainerScopeLabel(container),
      expenses: expenses.filter(exp => exp.tripContainerId === container.id),
    })),
    ...(generalExpenses.length > 0 || completionScopes.some(scope => scope.tripContainerId == null)
      ? [{ key: 'general', tripContainerId: null, label: 'Chi phí chung', expenses: generalExpenses }]
      : []),
  ];

  async function handleCollectPaperOrder() {
    if (!trip) return;
    setPaperOrderSubmitting(true);
    try {
      const idempotencyKey = buildIdempotencyKey('forwarder', 'paper-handoff', tripId, 'version', trip.version);
      await forwarderClient.collectPaperOrder(tripId, trip.version, idempotencyKey);
      await queryClient.invalidateQueries({ queryKey: qk.forwarder.tripDetail(tripId) });
      toast({ kind: 'success', message: 'Máy chủ đã xác nhận giao lệnh gốc cho tài xế.' });
    } catch (error) {
      toast({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Không thể xác nhận giao lệnh gốc.',
      });
    } finally {
      setPaperOrderSubmitting(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={embedded ? 'fwd-detail fwd-detail--embedded' : 'fwd-detail'}
      style={{ maxWidth: embedded ? 'none' : 700, margin: '0 auto', paddingBottom: embedded ? 8 : 40 }}
    >
      {dialog}
      {reasonDialog}
      {/* Back button + Header */}
      <div className="fwd-detail-hero">
        {!embedded && (
          <button
            className="btn btn--ghost btn--icon fwd-detail__back-btn"
            onClick={handleBack}
            aria-label="Quay lại"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="fwd-detail-hero__content">
          <span className="fwd-detail-hero__eyebrow">Chi tiết chuyến xe</span>
          <div className="fwd-detail-hero__title-row">
            <h1 className="fwd-detail-hero__title">
              {trip.billNumber || trip.bookingNumber || trip.shipmentCode || trip.routeName || 'Chuyến đi'}
            </h1>
            <StatusPill variant={tripStatusVariant(trip.status)}>
              {TRIP_STATUS_LABELS[trip.status as TripStatus] || trip.status}
            </StatusPill>
            {trip.tripCode && (
              <span className="fwd-detail-hero__trip-code">{trip.tripCode}</span>
            )}
          </div>
          <p className="fwd-detail-hero__subtitle">
            {[trip.customerName, trip.factoryName, trip.routeName].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {trip.accountingLock && <AccountingLockBanner lock={trip.accountingLock} />}

      <fieldset disabled={Boolean(trip.accountingLock)} className="fwd-detail__fieldset">

      {/* Trip Info Card */}
      <div className="panel fwd-order-panel">
        <div className="fwd-order-panel__header">
          <span>
            Thông tin lệnh vận chuyển
          </span>
        </div>
        <div className="fwd-order-panel__body">
          <div className="info-row">
            <span className="info-row__icon"><Truck size={16} /></span>
            <div className="info-row__body">
              <div className="info-row__label">Xe đầu kéo</div>
              <div className="info-row__value">{trip.truckPlate || '—'}</div>
            </div>
          </div>
          <div className="fwd-order-facts">
            <div><span>Số Bill / Booking</span><strong>{trip.billNumber || trip.bookingNumber || '—'}</strong></div>
            <div><span>Số tờ khai</span><strong>{trip.declarationNumbers || '—'}</strong></div>
            <div><span>Nhập / Xuất</span><strong>{trip.tradeDirection === 'IMPORT' ? 'Nhập' : trip.tradeDirection === 'EXPORT' ? 'Xuất' : '—'}</strong></div>
            <div><span>Loại container</span><strong>{trip.containerTypeSummary || trip.cargoTypeName || '—'}</strong></div>
          </div>
          <div className="info-row">
            <span className="info-row__icon"><Calendar size={16} /></span>
            <div className="info-row__body">
              <div className="info-row__label">Ngày khởi hành</div>
              <div className="info-row__value">{formatDate(trip.departureDate)}</div>
            </div>
          </div>
          {trip.cargoTypeName && (
            <div className="info-row">
              <span className="info-row__icon"><MapPin size={16} /></span>
              <div className="info-row__body">
                <div className="info-row__label">Loại hàng</div>
                <div className="info-row__value">{trip.cargoTypeName}</div>
              </div>
            </div>
          )}
          {trip.customerReference && (
            <div className="info-row">
              <span className="info-row__icon"><Package size={16} /></span>
              <div className="info-row__body">
                <div className="info-row__label">Mã tham chiếu</div>
                <div className="info-row__value">{trip.customerReference}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Containers Section */}
      <ForwarderContainersSection
        containers={(trip.containers ?? []) as ForwarderContainer[]}
        show={containerFormCtrl.show}
        setShow={containerFormCtrl.setShow}
        form={containerFormCtrl.form}
        setForm={containerFormCtrl.setForm}
        onAdd={containerFormCtrl.add}
        pending={containerFormCtrl.pending}
        error={containerFormCtrl.error}
        onApplySuggestion={containerFormCtrl.applySuggestion}
        selectedContainerId={expenseFormCtrl.form.tripContainerId}
        onSelectContainer={(tripContainerId) => expenseFormCtrl.patch({ tripContainerId })}
      />

      <div className="panel fwd-detail__panel--mb16">
        <div className="fwd-paper-order">
          <div>
            <div className="fwd-section-label fwd-section-label--mb6">
              Bàn giao lệnh gốc
            </div>
            <div className="fwd-paper-order__status">
              {trip.paperOrderCollectedAt
                ? `${trip.paperOrderCollectedByName || 'Ops'} đã giao lúc ${formatDate(trip.paperOrderCollectedAt)}`
                : trip.orderExchangeStatus !== 'COMPLETED'
                  ? 'Chưa thể bàn giao: Ops chưa hoàn tất đổi lệnh'
                  : !trip.truckPlate
                    ? 'Chưa thể bàn giao: điều vận chưa phân xe'
                    : 'Đã đổi lệnh và phân xe; sẵn sàng bàn giao lệnh gốc'}
            </div>
            <p className="fwd-paper-order__desc">
              {trip.status === 'COMPLETED' || trip.status === 'CANCELED' ? (
                <>Chuyến đã kết thúc — bàn giao lệnh giấy cho chuyến này cần điều vận xử lý (không thực hiện được trên app).</>
              ) : (
                <>Đổi lệnh: {trip.orderExchangeStatus === 'COMPLETED' ? 'Đã đổi lệnh' : trip.orderExchangeStatus === 'IN_PROGRESS' ? 'Đang đổi lệnh' : 'Chờ đổi lệnh'}. Tài xế chỉ được bấm “Đã nhận lệnh gốc” sau khi Ops xác nhận bàn giao.</>
              )}
            </p>
          </div>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => void handleCollectPaperOrder()}
            disabled={paperOrderSubmitting || Boolean(trip.paperOrderCollectedAt) || trip.orderExchangeStatus !== 'COMPLETED' || !trip.truckPlate || trip.status === 'COMPLETED' || trip.status === 'CANCELED'}
          >
            {paperOrderSubmitting ? 'Đang lưu…' : trip.paperOrderCollectedAt ? 'Đã bàn giao' : 'Xác nhận giao lệnh gốc'}
          </button>
        </div>
      </div>

      {/* Expenses Section */}
      <div className="panel panel--solid fwd-detail__panel--mb16">
        <div className="fwd-expenses-header">
          <span className="fwd-section-label">
            Chi phí phát sinh ({expenses.length}) · {completedScopeCount}/{totalScopeCount} nhóm đã kê xong
          </span>
          <button
            className="btn btn--secondary btn--sm fwd-expenses-header__btn"
            onClick={expenseFormCtrl.open}
          >
            <Plus size={12} /> Thêm
          </button>
        </div>

        <ForwarderExpenseForm
          controller={expenseFormCtrl}
          containers={containers}
          supplierOptions={supplierOptions}
          portOptions={portOptions}
          containerTypeOptions={containerTypeOptions}
          forwarderExpenseTypeOptions={forwarderExpenseTypeOptions}
        />

        {expenses.length === 0 ? (
          <div className="fwd-expenses-empty">
            Chưa có chi phí phát sinh nào
          </div>
        ) : (
          <div className="fwd-expenses-list">
            {expenseGroups.map(group => {
              const scope = completionScopes.find(item => item.tripContainerId === group.tripContainerId);
              const completed = scope?.status === ExpenseEntryStatus.COMPLETED;
              return <section key={group.key} className="fwd-expense-group">
                <div className="fwd-expense-group__header">
                  <div>
                    <strong>{group.label}</strong>
                    <span>{group.expenses.length} khoản</span>
                  </div>
                  <button
                    className={`btn btn--sm ${completed ? 'btn--ghost' : 'btn--secondary'}`}
                    onClick={() => completionMut.mutate({ tripId, tripContainerId: group.tripContainerId, completed: !completed })}
                    disabled={completionMut.isPending}
                    aria-label={`${completed ? 'Mở lại kê khai' : 'Đánh dấu đã kê xong'} cho ${group.label}`}
                  >
                    {completed ? <><RotateCcw size={15} /> Mở lại</> : <><CheckCircle2 size={15} /> Đã kê xong</>}
                  </button>
                </div>
                {group.expenses.length === 0 && <div className="fwd-expense-group__empty">Chưa có khoản chi nào trong nhóm này</div>}
                {group.expenses.map((exp) => {
                  return (
                    <div key={exp.id}>
                      <ForwarderExpenseRow exp={exp} expenseTypeOptions={forwarderExpenseTypeOptions} uploadingExpenseId={uploadingExpenseId} photos={expensePhotos[exp.id]} onUpload={handleUploadPhoto} onEdit={expenseFormCtrl.openEditor} onDelete={handleDeleteExpense} deletePending={deleteExpenseMut.isPending} onLoadPhotos={loadExpensePhotos} />
                    </div>
                  );
                })}
              </section>;
            })}
          </div>
        )}
      </div>

      <TripLegsPanel legs={legs} />

      {/* Ghi chú */}
      <div className="panel fwd-detail__panel--mb16">
        <div className="fwd-notes-panel__content">
          <div className="fwd-section-label fwd-section-label--mb6">
            Ghi chú
          </div>
          {trip.notes ? (
            <p className="fwd-notes-panel__text">{trip.notes}</p>
          ) : (
            <p className="fwd-notes-panel__empty">Không có ghi chú</p>
          )}
        </div>
      </div>

      {/* Liên hệ & hướng dẫn — manager-authored guidance for the field user */}
      {trip.instructions && (trip.instructions.contactName || trip.instructions.contactPhone || trip.instructions.notes) && (
        <div className="panel fwd-detail__panel--mb16">
          <div className="fwd-notes-panel__content">
            <div className="fwd-section-label fwd-section-label--mb8">
              Liên hệ & hướng dẫn
            </div>
            {trip.instructions.contactName && (
              <div className="fwd-instructions__row">
                <span className="fwd-instructions__label">Liên hệ</span>
                <span className="fwd-instructions__value">{trip.instructions.contactName}</span>
              </div>
            )}
            {trip.instructions.contactPhone && (
              <div className="fwd-instructions__row">
                <span className="fwd-instructions__label">SĐT</span>
                <a href={`tel:${trip.instructions.contactPhone}`} className="fwd-instructions__link">{trip.instructions.contactPhone}</a>
              </div>
            )}
            {trip.instructions.notes && (
              <p className="fwd-instructions__notes">{trip.instructions.notes}</p>
            )}
          </div>
        </div>
      )}
      </fieldset>
    </div>
  );
}

export default function ForwarderTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ForwarderTripWorkspace tripId={parseInt(id || '0', 10)} />;
}
