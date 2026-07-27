import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Calendar, MapPin, Package, Plus, CheckCircle2, RotateCcw } from 'lucide-react';
import { formatDate } from '../lib/format';
import { api } from '../lib/api';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  ExpenseEntryStatus,
  FORWARDER_EXPENSE_TYPE_DEFAULTS,
  NO_INVOICE_EVIDENCE_TYPE_LABELS,
} from '@tingting/shared';
import { TRIP_STATUS_LABELS, type TripStatus } from '@tingting/shared';
import { StatusPill, FormGroup, useConfirm } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import { qk } from '../api/keys';
import { useForwarderTripDetail, useCreateForwarderContainer, useCreateForwarderExpense, useDeleteForwarderExpense } from '../hooks/useQueries';
import { useUpdateForwarderExpense, useSetForwarderExpenseCompletion } from '../hooks/useForwarderQueries';
import { useCatalogs } from '../hooks/useCatalogs';
import { useQuery } from '@tanstack/react-query';
import { forwarderClient } from '../api/forwarderClient';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { ForwarderContainersSection, ForwarderExpenseRow, ForwarderTripError, ForwarderTripLoading, type ForwarderContainer } from './forwarder-trip-detail-sections';
import './ForwarderTripDetailPage.css';

function tripStatusVariant(status: TripStatus): 'neutral' | 'info' | 'warn' | 'success' | 'danger' {
  if (status === 'IN_TRANSIT') return 'info';
  if (status === 'COMPLETED') return 'success';
  if (status === 'CANCELED') return 'danger';
  return 'neutral';
}


export default function ForwarderTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tripId = parseInt(id || '0', 10);

  const { data: trip, isLoading: loading, error: queryError } = useForwarderTripDetail(tripId);
  const { rootRef } = usePageAnimations({ ready: !loading });

  const createContainerMut = useCreateForwarderContainer();
  const createExpenseMut = useCreateForwarderExpense();
  const updateExpenseMut = useUpdateForwarderExpense();
  const completionMut = useSetForwarderExpenseCompletion();
  const deleteExpenseMut = useDeleteForwarderExpense();

  const { data: catalogs } = useCatalogs();
  const forwarderExpenseTypeOptions = catalogs?.forwarderExpenseTypes ?? [];

  const { data: suppliersResp } = useQuery({
    queryKey: qk.forwarder.suppliers,
    queryFn: () => forwarderClient.listSuppliers(),
    staleTime: 5 * 60 * 1000,
  });
  const supplierOptions = suppliersResp?.items ?? [];

  const [showContainerForm, setShowContainerForm] = useState(false);
  const [containerForm, setContainerForm] = useState({ containerNumber: '', sealNumber: '', notes: '' });

  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [expenseForm, setExpenseForm] = useState({
    expenseType: 'LIFTING' as string,
    buyAmount: '',
    sellAmount: '',
    settlementMethod: 'FORWARDER_ADVANCE' as 'FORWARDER_ADVANCE' | 'COMPANY_DIRECT',
    supplierId: '',
    tripContainerId: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    payeeName: '',
    invoiceNumber: '',
    invoiceDate: '',
    declarationNumber: '',
    note: '',
    noInvoiceEvidenceTypes: [] as string[],
  });
  const [expenseErrors, setExpenseErrors] = useState<{ buyAmount?: string; declarationNumber?: string; supplierId?: string }>({});
  const [expenseSubmitError, setExpenseSubmitError] = useState<string | null>(null);

  // Expense photo state: maps expenseId → photo URLs
  const [expensePhotos, setExpensePhotos] = useState<Record<number, string[]>>({});
  const [uploadingExpenseId, setUploadingExpenseId] = useState<number | null>(null);

  const { confirm, dialog } = useConfirm();
  const handleBack = () => navigate('/my-forwarder-trips');
  const isDirty = () =>
    (showContainerForm && Boolean(containerForm.containerNumber || containerForm.sealNumber || containerForm.notes)) ||
    (showExpenseForm && Boolean(expenseForm.buyAmount || expenseForm.supplierId || expenseForm.invoiceNumber || expenseForm.declarationNumber || expenseForm.note));
  useBackShortcut(handleBack, {
    isDirty,
    confirmDiscard: () => confirm('Thoát mà không lưu? Các thay đổi chưa lưu sẽ bị mất.', { variant: 'warning', confirmLabel: 'Thoát' }),
  });

  async function loadExpensePhotos(expenseId: number) {
    try {
      const res = await api.get<{ items: Array<{ id: number; storageKey: string }> }>(`/forwarder/me/expenses/${expenseId}/photos`);
      const urls = res.items.map((p) => `/api/photos/${encodeURIComponent(p.storageKey)}`);
      setExpensePhotos(prev => ({ ...prev, [expenseId]: urls }));
    } catch { /* ignore */ }
  }

  async function handleUploadPhoto(expenseId: number, file: File) {
    setUploadingExpenseId(expenseId);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/forwarder/me/expenses/${expenseId}/photos`, form);
      await loadExpensePhotos(expenseId);
    } finally {
      setUploadingExpenseId(null);
    }
  }

  if (loading) return <ForwarderTripLoading />;

  if (queryError || !trip) return <ForwarderTripError queryError={Boolean(queryError)} onBack={handleBack} />;

  const handleAddContainer = () => {
    if (!containerForm.containerNumber.trim()) return;
    createContainerMut.mutate(
      {
        tripId,
        data: {
          containerNumber: containerForm.containerNumber,
          sealNumber: containerForm.sealNumber || undefined,
          notes: containerForm.notes || undefined,
        },
      },
      { onSuccess: () => { setContainerForm({ containerNumber: '', sealNumber: '', notes: '' }); setShowContainerForm(false); } },
    );
  };

  const handleExpenseTypeChange = (newType: string) => {
    const hasMarkup = FORWARDER_EXPENSE_TYPE_DEFAULTS[newType]?.defaultMarkup ?? false;
    setExpenseForm(f => ({
      ...f,
      expenseType: newType,
      // For at-cost types, keep sell in sync; for markup types, clear it for manual entry
      sellAmount: hasMarkup ? '' : f.buyAmount,
    }));
    setExpenseErrors({});
  };

  const handleBuyAmountChange = (val: string) => {
    const hasMarkup = FORWARDER_EXPENSE_TYPE_DEFAULTS[expenseForm.expenseType]?.defaultMarkup ?? false;
    setExpenseForm(f => ({
      ...f,
      buyAmount: val,
      // Auto-sync sell for at-cost types
      sellAmount: hasMarkup ? f.sellAmount : val,
    }));
    if (expenseErrors.buyAmount) setExpenseErrors(e => ({ ...e, buyAmount: undefined }));
  };

  const handleAddExpense = () => {
    setExpenseSubmitError(null);
    const buyAmount = parseFloat(expenseForm.buyAmount);
    const errors: { buyAmount?: string; declarationNumber?: string; supplierId?: string } = {};
    if (!buyAmount || buyAmount <= 0) errors.buyAmount = 'Giá mua vào phải lớn hơn 0';
    if (expenseForm.expenseType === 'CUSTOMS' && !expenseForm.declarationNumber.trim()) {
      errors.declarationNumber = 'Số tờ khai hải quan là bắt buộc cho phí hải quan';
    }
    if (expenseForm.settlementMethod === 'COMPANY_DIRECT' && !expenseForm.supplierId) {
      errors.supplierId = 'Cần chọn NCC khi công ty trả trực tiếp';
    }
    if (Object.keys(errors).length > 0) { setExpenseErrors(errors); return; }

    const sellAmount = parseFloat(expenseForm.sellAmount) || 0;
    const supplierIdNum = expenseForm.supplierId ? parseInt(expenseForm.supplierId, 10) : undefined;
    const payload = {
      tripId,
      expenseType: expenseForm.expenseType,
      buyAmount,
      sellAmount: sellAmount >= 0 ? sellAmount : 0,
      settlementMethod: expenseForm.settlementMethod,
      supplierId: supplierIdNum,
      expenseDate: expenseForm.expenseDate || undefined,
      payeeName: expenseForm.payeeName.trim() || undefined,
      invoiceNumber: expenseForm.invoiceNumber.trim() || undefined,
      invoiceDate: expenseForm.invoiceDate || undefined,
      declarationNumber: expenseForm.declarationNumber.trim() || undefined,
      tripContainerId: expenseForm.tripContainerId ? parseInt(expenseForm.tripContainerId, 10) : undefined,
      note: expenseForm.note.trim() || undefined,
      noInvoiceEvidenceTypes: expenseForm.noInvoiceEvidenceTypes,
    };
    if (!expenseForm.invoiceNumber.trim() && !noInvoiceAllowed) {
      setExpenseSubmitError('Hạng mục này không cho phép chi không hóa đơn. Vui lòng bổ sung hóa đơn hoặc đổi hạng mục.');
      return;
    }
    const mutation = editingExpenseId
      ? updateExpenseMut.mutate.bind(updateExpenseMut, {
          ...payload,
          id: editingExpenseId,
          supplierId: supplierIdNum ?? null,
          expenseDate: expenseForm.expenseDate || null,
          payeeName: expenseForm.payeeName.trim() || null,
          invoiceNumber: expenseForm.invoiceNumber.trim() || null,
          invoiceDate: expenseForm.invoiceDate || null,
          declarationNumber: expenseForm.declarationNumber.trim() || null,
          tripContainerId: expenseForm.tripContainerId ? parseInt(expenseForm.tripContainerId, 10) : null,
          note: expenseForm.note.trim() || null,
          noInvoiceEvidenceTypes: expenseForm.noInvoiceEvidenceTypes,
        })
      : createExpenseMut.mutate.bind(createExpenseMut, payload);
    mutation(
      {
        onSuccess: () => {
          setExpenseForm({
            expenseType: 'LIFTING',
            buyAmount: '',
            sellAmount: '',
            settlementMethod: 'FORWARDER_ADVANCE',
            supplierId: '',
            tripContainerId: '',
            expenseDate: new Date().toISOString().slice(0, 10),
            payeeName: '',
            invoiceNumber: '',
            invoiceDate: '',
            declarationNumber: '',
            note: '',
            noInvoiceEvidenceTypes: [],
          });
          setExpenseErrors({});
          setEditingExpenseId(null);
          setShowExpenseForm(false);
        },
        onError: (error) => {
          setExpenseSubmitError(error instanceof Error ? error.message : 'Không thể lưu điều chỉnh chi phí');
        },
      },
    );
  };

  const handleDeleteExpense = (expenseId: number) => {
    deleteExpenseMut.mutate({ id: expenseId, tripId });
  };

  const containers = (trip.containers || []) as ForwarderContainer[];
  const expenses = trip.expenses || [];
  const completionScopes = trip.completionScopes ?? [];
  const completedScopeCount = completionScopes.filter(scope => scope.status === ExpenseEntryStatus.COMPLETED).length;
  const totalScopeCount = completionScopes.length;
  const legs = (trip.legs || []) as Array<{ id: number; sequence: number; origin: string; destination: string; km: number; loadingType: string; polylinePath?: string | null }>;
  const selectedExpenseContainer = containers.find(c => String(c.id) === expenseForm.tripContainerId);
  const selectedExpenseTypeConfig = forwarderExpenseTypeOptions.find(type => type.code === expenseForm.expenseType);
  const noInvoiceAllowed = !selectedExpenseTypeConfig?.requiresInvoice && selectedExpenseTypeConfig?.substituteEvidenceAllowed !== false;
  const allowedEvidenceTypes = selectedExpenseTypeConfig?.noInvoiceEvidenceTypes?.length
    ? selectedExpenseTypeConfig.noInvoiceEvidenceTypes
    : [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES];
  const openExpenseForm = () => {
    setShowExpenseForm(prev => {
      const willOpen = !prev;
      if (willOpen && !expenseForm.tripContainerId && containers.length === 1) {
        setExpenseForm(f => ({ ...f, tripContainerId: String(containers[0].id) }));
      }
      return willOpen;
    });
  };
  const openExpenseEditor = (exp: typeof expenses[number]) => {
    if (exp.activeSettlementId || !exp.canEdit) return;
    setEditingExpenseId(exp.id);
    setExpenseForm({
      expenseType: exp.expenseType,
      buyAmount: String(exp.buyAmount),
      sellAmount: String(exp.sellAmount ?? ''),
      settlementMethod: exp.settlementMethod === 'COMPANY_DIRECT' ? 'COMPANY_DIRECT' : 'FORWARDER_ADVANCE',
      supplierId: exp.supplierId ? String(exp.supplierId) : '',
      tripContainerId: exp.tripContainerId ? String(exp.tripContainerId) : '',
      expenseDate: exp.expenseDate ? String(exp.expenseDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
      payeeName: exp.payeeName ?? '',
      invoiceNumber: exp.invoiceNumber ?? '',
      invoiceDate: exp.invoiceDate ? String(exp.invoiceDate).slice(0, 10) : '',
      declarationNumber: exp.declarationNumber ?? '',
      note: exp.note ?? '',
      noInvoiceEvidenceTypes: exp.noInvoiceEvidenceTypes ?? [],
    });
    setExpenseErrors({});
    setExpenseSubmitError(null);
    setShowExpenseForm(true);
  };
  const generalExpenses = expenses.filter(exp => !exp.tripContainerId);
  const expenseGroups = [
    ...containers.map(container => ({
      key: String(container.id),
      tripContainerId: container.id as number | null,
      label: `Container ${container.containerNumber}`,
      expenses: expenses.filter(exp => exp.tripContainerId === container.id),
    })),
    ...(generalExpenses.length > 0 || completionScopes.some(scope => scope.tripContainerId == null)
      ? [{ key: 'general', tripContainerId: null, label: 'Chi phí chung', expenses: generalExpenses }]
      : []),
  ];

  return (
    <div ref={rootRef} style={{ maxWidth: 700, margin: '0 auto', paddingBottom: 40 }}>
      {dialog}
      {/* Back button + Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 0 8px' }}>
        <button
          className="btn btn--ghost btn--icon"
          onClick={handleBack}
          aria-label="Quay lại"
          style={{ width: 40, height: 40, borderRadius: '50%' }}
        >
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg-1)', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/assets/icons/03-trip-log-so-chuyen-chuyen-xe.png" alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
              {trip.routeName || 'Chuyến đi'}
            </h1>
            <StatusPill variant={tripStatusVariant(trip.status)}>
              {TRIP_STATUS_LABELS[trip.status as TripStatus] || trip.status}
            </StatusPill>
            {trip.tripCode && (
              <span style={{ fontSize: 12, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>{trip.tripCode}</span>
            )}
          </div>
          {trip.customerName && (
            <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: '4px 0 0' }}>{trip.customerName}</p>
          )}
        </div>
      </div>

      {/* Trip Info Card */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ padding: '4px 20px 4px', borderBottom: '1px solid var(--border-1)' }}>
          <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Thông tin chuyến
          </span>
        </div>
        <div style={{ padding: '0 20px' }}>
          <div className="info-row">
            <span className="info-row__icon"><Truck size={16} /></span>
            <div className="info-row__body">
              <div className="info-row__label">Xe đầu kéo</div>
              <div className="info-row__value">{trip.truckPlate || '—'}</div>
            </div>
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
      <ForwarderContainersSection containers={(trip.containers ?? []) as ForwarderContainer[]} show={showContainerForm} setShow={setShowContainerForm} form={containerForm} setForm={setContainerForm} onAdd={handleAddContainer} pending={createContainerMut.isPending} selectedContainerId={expenseForm.tripContainerId} onSelectContainer={(tripContainerId) => setExpenseForm(prev => ({ ...prev, tripContainerId }))} />

      {/* Expenses Section */}
      <div className="panel panel--solid" style={{ marginBottom: 16 }}>
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Chi phí phát sinh ({expenses.length}) · {completedScopeCount}/{totalScopeCount} nhóm đã kê xong
          </span>
          <button
            className="btn btn--secondary btn--sm"
            onClick={openExpenseForm}
            style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={12} /> Thêm
          </button>
        </div>

        {showExpenseForm && (
          <div className="fwd-expense-form">
            {/* Row 1: type + amounts + settlement */}
            <div className="fwd-expense-grid fwd-expense-grid--primary">
              <FormGroup label="Loại chi phí">
                <select
                  className="input"
                  value={expenseForm.expenseType}
                  onChange={e => handleExpenseTypeChange(e.target.value)}
                >
                  {(forwarderExpenseTypeOptions.length > 0
                    ? forwarderExpenseTypeOptions.map((type) => [type.code, { name: type.name }] as const)
                    : Object.entries(FORWARDER_EXPENSE_TYPE_DEFAULTS)
                  ).map(([code, cfg]) => (
                    <option key={code} value={code}>{cfg.name}</option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup
                label="Giá mua vào (VNĐ) *"
              >
                <input
                  className={`input${expenseErrors.buyAmount ? ' input--error' : ''}`}
                  type="number"
                  value={expenseForm.buyAmount}
                  onChange={e => handleBuyAmountChange(e.target.value)}
                  placeholder="0"
                  min="1"
                />
                {expenseErrors.buyAmount && (
                  <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--danger)', display: 'block', marginTop: 2 }}>
                    {expenseErrors.buyAmount}
                  </span>
                )}
              </FormGroup>

              <FormGroup
                label="Giá bán ra (VNĐ)"
              >
                <input
                  className="input"
                  type="number"
                  value={expenseForm.sellAmount}
                  onChange={e => setExpenseForm(f => ({ ...f, sellAmount: e.target.value }))}
                  placeholder="0"
                  min="0"
                  readOnly={!FORWARDER_EXPENSE_TYPE_DEFAULTS[expenseForm.expenseType]?.defaultMarkup}
                  style={
                    !FORWARDER_EXPENSE_TYPE_DEFAULTS[expenseForm.expenseType]?.defaultMarkup
                      ? { background: 'var(--bg-3)', color: 'var(--fg-3)' }
                      : undefined
                  }
                />
              </FormGroup>

              <FormGroup label="Hình thức chi">
                <select
                  className="input"
                  value={expenseForm.settlementMethod}
                  onChange={e => {
                    const v = e.target.value as 'FORWARDER_ADVANCE' | 'COMPANY_DIRECT';
                    setExpenseForm(f => ({ ...f, settlementMethod: v, supplierId: v === 'FORWARDER_ADVANCE' ? '' : f.supplierId }));
                    if (expenseErrors.supplierId) setExpenseErrors(e => ({ ...e, supplierId: undefined }));
                  }}
                >
                  <option value="FORWARDER_ADVANCE">Chi hộ tạm ứng</option>
                  <option value="COMPANY_DIRECT">Công ty trả trực tiếp</option>
                </select>
              </FormGroup>
            </div>

            {/* Row 2: supplier (when company-direct) + container number */}
            <div className="fwd-expense-grid fwd-expense-grid--context">
              {expenseForm.settlementMethod === 'COMPANY_DIRECT' && (
                <FormGroup label="Nhà cung cấp *">
                  <select
                    className={`input${expenseErrors.supplierId ? ' input--error' : ''}`}
                    value={expenseForm.supplierId}
                    onChange={e => {
                      const selectedSupplier = supplierOptions.find(item => String(item.id) === e.target.value);
                      setExpenseForm(f => ({
                        ...f,
                        supplierId: e.target.value,
                        payeeName: f.payeeName || selectedSupplier?.name || '',
                      }));
                      if (expenseErrors.supplierId) setExpenseErrors(err => ({ ...err, supplierId: undefined }));
                    }}
                  >
                    <option value="">-- Chọn NCC --</option>
                    {supplierOptions.map(s => (
                      <option key={s.id} value={String(s.id)}>{s.name}</option>
                    ))}
                  </select>
                  {expenseErrors.supplierId && (
                    <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--danger)', display: 'block', marginTop: 2 }}>
                      {expenseErrors.supplierId}
                    </span>
                  )}
                </FormGroup>
              )}

              {containers.length === 0 && (
                <div className="fwd-expense-empty-container">
                  Chưa có container; chi phí này sẽ lưu như chi phí chung của chuyến.
                </div>
              )}

              {containers.length === 1 && selectedExpenseContainer && (
                <FormGroup label="Container áp dụng">
                  <div
                    className="input"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      background: 'var(--brand-subtle, rgba(0,177,79,0.08))',
                      borderColor: 'rgba(0, 107, 63, 0.22)',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{selectedExpenseContainer.containerNumber}</span>
                    {selectedExpenseContainer.sealNumber && (
                      <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>Seal {selectedExpenseContainer.sealNumber}</span>
                    )}
                  </div>
                </FormGroup>
              )}

              {containers.length > 1 && (
                <FormGroup label="Container áp dụng">
                  <select
                    className="input"
                    value={expenseForm.tripContainerId}
                    onChange={e => setExpenseForm(f => ({ ...f, tripContainerId: e.target.value }))}
                  >
                    <option value="">Chi phí chung của chuyến</option>
                    {containers.map(c => (
                      <option key={c.id} value={String(c.id)}>
                        {c.containerNumber}{c.sealNumber ? ` · Seal ${c.sealNumber}` : ''}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', display: 'block', marginTop: 4 }}>
                    Chọn container từ danh sách đã nhập, không cần gõ lại số container.
                  </span>
                </FormGroup>
              )}
            </div>

            {/* Row 3: invoice + declaration + note */}
            <div className="fwd-expense-grid fwd-expense-grid--invoice">
              {expenseForm.expenseType !== 'INFRASTRUCTURE' && (
                <>
                  <FormGroup label="Số hóa đơn">
                    <input
                      className="input"
                      value={expenseForm.invoiceNumber}
                      onChange={e => setExpenseForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                      placeholder="Số hóa đơn"
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </FormGroup>
                  <FormGroup label="Ngày hóa đơn">
                    <input
                      className="input"
                      type="date"
                      value={expenseForm.invoiceDate}
                      onChange={e => setExpenseForm(f => ({ ...f, invoiceDate: e.target.value }))}
                    />
                  </FormGroup>
                </>
              )}

              {expenseForm.expenseType === 'CUSTOMS' && (
                <FormGroup label="Số tờ khai hải quan *">
                  <input
                    className={`input${expenseErrors.declarationNumber ? ' input--error' : ''}`}
                    value={expenseForm.declarationNumber}
                    onChange={e => {
                      setExpenseForm(f => ({ ...f, declarationNumber: e.target.value }));
                      if (expenseErrors.declarationNumber) setExpenseErrors(err => ({ ...err, declarationNumber: undefined }));
                    }}
                    placeholder="Số tờ khai"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  {expenseErrors.declarationNumber && (
                    <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--danger)', display: 'block', marginTop: 2 }}>
                      {expenseErrors.declarationNumber}
                    </span>
                  )}
                </FormGroup>
              )}

              <FormGroup label={expenseForm.invoiceNumber.trim() ? 'Ghi chú' : 'Lý do chi *'}>
                <input
                  className="input"
                  value={expenseForm.note}
                  onChange={e => setExpenseForm(f => ({ ...f, note: e.target.value }))}
                  placeholder={expenseForm.invoiceNumber.trim() ? 'Ghi chú (tuỳ chọn)' : 'Mô tả lý do chi và chứng từ bổ sung'}
                />
              </FormGroup>
            </div>

            {!expenseForm.invoiceNumber.trim() && (
              <div className="fwd-expense-grid fwd-expense-grid--invoice" style={{ borderTop: '1px solid var(--border-1)', paddingTop: 12 }}>
                <FormGroup label="Ngày chi">
                  <input
                    className="input"
                    type="date"
                    value={expenseForm.expenseDate}
                    onChange={e => setExpenseForm(f => ({ ...f, expenseDate: e.target.value }))}
                  />
                </FormGroup>

                <FormGroup label="Người nhận">
                  <input
                    className="input"
                    value={expenseForm.payeeName}
                    onChange={e => setExpenseForm(f => ({ ...f, payeeName: e.target.value }))}
                    placeholder="Tên người nhận / đơn vị nhận"
                  />
                </FormGroup>

                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 8 }}>Chứng cứ thay thế</div>
                  {!noInvoiceAllowed ? (
                    <div style={{ fontSize: 12, color: 'var(--danger)' }}>
                      Hạng mục này không cho phép chi không hóa đơn.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                        {allowedEvidenceTypes.map((value) => (
                          <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg-2)' }}>
                            <input
                              type="checkbox"
                              checked={expenseForm.noInvoiceEvidenceTypes.includes(value)}
                              onChange={(event) => {
                                setExpenseForm((current) => ({
                                  ...current,
                                  noInvoiceEvidenceTypes: event.target.checked
                                    ? [...current.noInvoiceEvidenceTypes, value]
                                    : current.noInvoiceEvidenceTypes.filter((item) => item !== value),
                                }));
                              }}
                            />
                            <span>{NO_INVOICE_EVIDENCE_TYPE_LABELS[value as keyof typeof NO_INVOICE_EVIDENCE_TYPE_LABELS] ?? value}</span>
                          </label>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginTop: 8 }}>
                        Ngưỡng hiện tại: {Number(selectedExpenseTypeConfig?.noInvoicePerItemLimit ?? 1_000_000).toLocaleString('vi-VN')} đ/khoản,
                        {' '}{Number(selectedExpenseTypeConfig?.noInvoicePerDayLimit ?? 5_000_000).toLocaleString('vi-VN')} đ/người/ngày.
                        Nếu chọn ảnh hiện trường, hãy lưu xong rồi tải ảnh lên ngay dưới dòng chi phí.
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {expenseSubmitError && (
              <div
                className="animate-shake"
                role="alert"
                style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 6, background: 'var(--danger-soft)', color: 'var(--danger-text)', fontSize: 13 }}
              >
                {expenseSubmitError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => { setShowExpenseForm(false); setEditingExpenseId(null); setExpenseErrors({}); setExpenseSubmitError(null); }}
                disabled={createExpenseMut.isPending || updateExpenseMut.isPending}
              >
                Hủy
              </button>
              <button
                className="btn btn--primary btn--sm"
                onClick={handleAddExpense}
                disabled={createExpenseMut.isPending || updateExpenseMut.isPending}
              >
                {createExpenseMut.isPending || updateExpenseMut.isPending ? 'Đang lưu…' : editingExpenseId ? 'Lưu điều chỉnh' : 'Lưu chi phí'}
              </button>
            </div>
          </div>
        )}

        {expenses.length === 0 ? (
          <div style={{ padding: '16px 20px', color: 'var(--fg-3)', fontSize: 13, textAlign: 'center' }}>
            Chưa có chi phí phát sinh nào
          </div>
        ) : (
          <div style={{ padding: '4px 0' }}>
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
                {group.expenses.map((exp) => (
              <ForwarderExpenseRow exp={exp} expenseTypeOptions={forwarderExpenseTypeOptions} uploadingExpenseId={uploadingExpenseId} photos={expensePhotos[exp.id]} onUpload={handleUploadPhoto} onEdit={openExpenseEditor} onDelete={handleDeleteExpense} deletePending={deleteExpenseMut.isPending} onLoadPhotos={loadExpensePhotos} />
                ))}
              </section>;
            })}
          </div>
        )}
      </div>

      <TripLegsPanel legs={legs} />

      {/* Ghi chú */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 20px' }}>
          <div style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Ghi chú
          </div>
          {trip.notes ? (
            <p style={{ fontSize: 13, color: 'var(--fg-2)', margin: 0, lineHeight: 1.6 }}>{trip.notes}</p>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--fg-3)', margin: 0, fontStyle: 'italic' }}>Không có ghi chú</p>
          )}
        </div>
      </div>

      {/* Liên hệ & hướng dẫn — manager-authored guidance for the field user */}
      {trip.instructions && (trip.instructions.contactName || trip.instructions.contactPhone || trip.instructions.notes) && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ padding: '12px 20px' }}>
            <div style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Liên hệ & hướng dẫn
            </div>
            {trip.instructions.contactName && (
              <div style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
                <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 60 }}>Liên hệ</span>
                <span style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{trip.instructions.contactName}</span>
              </div>
            )}
            {trip.instructions.contactPhone && (
              <div style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
                <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 60 }}>SĐT</span>
                <a href={`tel:${trip.instructions.contactPhone}`} style={{ color: 'var(--brand, #00B14F)', textDecoration: 'none', fontWeight: 500 }}>{trip.instructions.contactPhone}</a>
              </div>
            )}
            {trip.instructions.notes && (
              <p style={{ fontSize: 13, color: 'var(--fg-2)', margin: '8px 0 0', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{trip.instructions.notes}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
