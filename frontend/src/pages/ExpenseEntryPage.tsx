import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, X, Plus, Check } from 'lucide-react';
import { api } from '../lib/api';
import { configClient } from '../api/configClient';
import { PageHeader, useConfirm } from '../components/UI';
import { useCatalogs } from '../hooks/useCatalogs';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { useDirtyGuard } from '../hooks/useDirtyGuard';
import { useToast } from '../components/shared/Toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePageAnimations } from '../hooks/animations';
import { FINANCIAL, CONFIG } from '@tingting/shared';
import { expenseSchema } from '@tingting/shared';
import type { ExpenseWithRefs, Supplier, ExpenseCategory } from '@tingting/shared';
import { qk } from '../api/keys';
import { resolveExpenseCatalogs } from '../features/expenses/expenseCatalogs';
import type { ExpenseCatalogs } from '../features/expenses/expenseCatalogs';
import {
  expenseSubmissionMessage,
  initialForm,
  type FormState,
} from './expense-entry-utils';
import { ExpenseBasicFields, ExpenseLoading, ExpensePhotoAside } from './expense-entry-sections';
import { useExpenseReceiptPhotos } from '../features/expenses/useExpenseReceiptPhotos';
import { DateInput } from '../design-system/forms/DateInput';
import { UuiSelectField } from '../design-system';
import './ExpenseEntryPage.css';

export default function ExpenseEntryPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(initialForm);
  const [expenseType, setExpenseType] = useState<'COMPANY' | 'TRUCK' | 'TRAILER'>('COMPANY');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');
  const [governanceReason, setGovernanceReason] = useState('');
  const [savedExpenseId, setSavedExpenseId] = useState<number | null>(null);
  const { photos, uploading, photoError, handlePhotoUpload, removePhoto, savePendingPhotos } = useExpenseReceiptPhotos(id, savedExpenseId);
  // True once an edit-mode expense has been hydrated into the form (see effect
  // below) — the "ready" baseline for the discard-dirty guard so the
  // server-populate pass isn't mistaken for a user edit.
  const [hydrated, setHydrated] = useState(!isEdit);

  const { data: catalogData } = useCatalogs();
  const trucks = catalogData?.trucks ?? [];
  const trailers = catalogData?.trailers ?? [];

  // Quick-create supplier
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  // Quick-create category
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  const { data: expenseCatalogs, isLoading: loadingExpenseCatalogs } = useQuery({
    queryKey: qk.tripForm.expenseFormCatalogs,
    queryFn: async (): Promise<ExpenseCatalogs> => {
      const [suppliers, categories] = await Promise.all([
        configClient.getAllSuppliers(),
        configClient.getAllExpenseCategories(),
      ]);
      return { suppliers, categories };
    },
    staleTime: 60 * 1000,
  });
  const { suppliers, categories } = resolveExpenseCatalogs(expenseCatalogs);

  const { data: existingExpense, isLoading: loadingExpense } = useQuery<ExpenseWithRefs>({
    queryKey: qk.tripForm.expense(id!),
    queryFn: () => api.get(`${FINANCIAL.EXPENSE(Number(id))}`),
    enabled: isEdit,
  });

  const { rootRef } = usePageAnimations({ ready: !loadingExpense });

  const { confirm, dialog } = useConfirm();
  const guard = useDirtyGuard([form, governanceReason, photos.filter(photo => photo.file).map(photo => photo.id)], hydrated);
  const handleBack = () => navigate('/expenses');
  useBackShortcut(handleBack, {
    isDirty: guard.isDirty,
    confirmDiscard: () => confirm('Thoát mà không lưu? Các thay đổi chưa lưu sẽ bị mất.', { variant: 'warning', confirmLabel: 'Thoát' }),
  });

  useEffect(() => {
    if (existingExpense) {
      setForm({
        expenseDate: existingExpense.expenseDate?.slice(0, 10) || '',
        supplierId: existingExpense.supplierId || '',
        categoryId: existingExpense.categoryId || '',
        truckId: existingExpense.truckId || '',
        vehicleComponent: existingExpense.vehicleComponent || 'TRUCK',
        amount: existingExpense.amount || '',
        paymentStatus: (existingExpense.paymentStatus as 'PAID' | 'UNPAID') || 'UNPAID',
        validFrom: existingExpense.validFrom?.slice(0, 10) || '',
        validTo: existingExpense.validTo?.slice(0, 10) || '',
        receiptId: existingExpense.receiptId || '',
        note: existingExpense.note || '',
      });
      setExpenseType(existingExpense.truckId ? (existingExpense.vehicleComponent as 'TRUCK' | 'TRAILER') : 'COMPANY');
      setHydrated(true);
    }
  }, [existingExpense]);

  const selectedCategory = useMemo(
    () => categories.find(c => c.id === form.categoryId),
    [categories, form.categoryId],
  );

  const showValidityFields = selectedCategory?.isRenewable === true;

  const set = (field: keyof FormState, value: FormState[keyof FormState]) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const formatAmountDisplay = (val: string) => {
    if (!val) return '';
    const num = parseFloat(val.replace(/,/g, ''));
    if (isNaN(num)) return val;
    return num.toLocaleString('vi-VN');
  };

  const parseAmountInput = (displayVal: string) => {
    return `${displayVal.trim().startsWith('-') ? '-' : ''}${displayVal.replace(/[^\d]/g, '')}`;
  };

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) return;
    setCreatingSupplier(true);
    try {
      const created = await api.post<Supplier>(CONFIG.SUPPLIERS, { name: newSupplierName.trim(), status: 'ACTIVE' });
      queryClient.setQueryData<ExpenseCatalogs>(
        qk.tripForm.expenseFormCatalogs,
        old => ({
          suppliers: old?.suppliers.some(s => s.id === created.id)
            ? old.suppliers
            : [...(old?.suppliers ?? []), created],
          categories: old?.categories ?? categories,
        }),
      );
      set('supplierId', created.id);
      await queryClient.invalidateQueries({ queryKey: qk.tripForm.expenseFormCatalogs });
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.allSuppliers });
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.all });
      setShowNewSupplier(false);
      setNewSupplierName('');
      toast({ kind: 'success', message: `Đã tạo nhà cung cấp "${created.name}".` });
    } catch (e: unknown) {
      toast({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi tạo nhà cung cấp' });
    } finally {
      setCreatingSupplier(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    setCreatingCategory(true);
    try {
      const created = await api.post<ExpenseCategory>(CONFIG.EXPENSE_CATEGORIES, { name: newCategoryName.trim(), isRenewable: false, reminderLeadDays: 30 });
      queryClient.setQueryData<ExpenseCatalogs>(
        qk.tripForm.expenseFormCatalogs,
        old => ({
          suppliers: old?.suppliers ?? suppliers,
          categories: old?.categories.some(c => c.id === created.id)
            ? old.categories
            : [...(old?.categories ?? []), created],
        }),
      );
      set('categoryId', created.id);
      await queryClient.invalidateQueries({ queryKey: qk.tripForm.expenseFormCatalogs });
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.allExpenseCategories });
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.all });
      setShowNewCategory(false);
      setNewCategoryName('');
      toast({ kind: 'success', message: `Đã tạo hạng mục "${created.name}".` });
    } catch (e: unknown) {
      toast({ kind: 'error', message: e instanceof Error ? e.message : 'Lỗi tạo hạng mục' });
    } finally {
      setCreatingCategory(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || uploading) return;
    setErrors({});
    setPageError('');

    const payload: Record<string, unknown> = {
      expenseDate: form.expenseDate,
      supplierId: Number(form.supplierId),
      categoryId: Number(form.categoryId),
      truckId: form.truckId ? Number(form.truckId) : null,
      // Schema rejects explicit `null` for vehicleComponent (enum + default).
      // For company-wide expenses (no truck), omit the field entirely so the
      // default kicks in. Was previously sending null and the page silently
      // failed validation without surfacing an error to the user.
      ...(form.truckId ? { vehicleComponent: form.vehicleComponent } : {}),
      amount: form.amount,
      paymentStatus: form.paymentStatus,
      validFrom: showValidityFields && form.validFrom ? form.validFrom : null,
      validTo: showValidityFields && form.validTo ? form.validTo : null,
      receiptId: form.receiptId || undefined,
      note: form.note || undefined,
    };

    const result = expenseSchema.safeParse(payload);

    if (expenseType !== 'COMPANY' && !form.truckId) {
      setErrors(prev => ({ ...prev, truckId: 'Vui lòng chọn biển số' }));
      setTimeout(() => document.getElementById('truckId')?.focus(), 0);
      return;
    }

    if (!result.success) {
      // Zod's default messages are in English ("Number must be greater than 0"),
      // which looked broken next to the Vietnamese form labels. Translate the
      // common ones and fall back to the field-specific friendly message.
      const FRIENDLY: Record<string, string> = {
        supplierId: 'Vui lòng chọn nhà cung cấp',
        categoryId: 'Vui lòng chọn hạng mục chi phí',
        amount: 'Số tiền phải là số dương',
        expenseDate: 'Vui lòng chọn ngày phát sinh chi phí',
        paymentStatus: 'Vui lòng chọn trạng thái thanh toán',
      };
      // Some validation errors don't map to a visible field (e.g.
      // vehicleComponent when no truck is selected). Track which fields
      // are visible on screen so we can promote orphan errors to a page
      // banner instead of silently swallowing them.
      const VISIBLE_FIELDS = new Set([
        'expenseDate', 'supplierId', 'categoryId', 'amount',
        'paymentStatus', 'truckId', 'validFrom', 'validTo',
        'receiptId', 'note',
      ]);
      const fieldErrors: Record<string, string> = {};
      const orphanIssues: string[] = [];
      for (const issue of result.error.issues) {
        const field = issue.path[0]?.toString();
        if (!field) { orphanIssues.push(issue.message); continue; }
        if (!VISIBLE_FIELDS.has(field)) {
          orphanIssues.push(`${field}: ${issue.message}`);
          continue;
        }
        if (!fieldErrors[field]) {
          fieldErrors[field] = FRIENDLY[field] ?? issue.message;
        }
      }
      setErrors(fieldErrors);
      if (orphanIssues.length > 0) {
        setPageError(orphanIssues.join(' · '));
      }
      const firstErrorField = result.error.issues[0]?.path[0]?.toString();
      if (firstErrorField) {
        setTimeout(() => document.getElementById(firstErrorField)?.focus(), 0);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    if (showValidityFields && !form.validFrom) {
      setErrors(prev => ({ ...prev, validFrom: 'Trường bắt buộc khi hạng mục có tính gia hạn' }));
      setTimeout(() => document.getElementById('validFrom')?.focus(), 0);
      return;
    }
    if (showValidityFields && !form.validTo) {
      setErrors(prev => ({ ...prev, validTo: 'Trường bắt buộc khi hạng mục có tính gia hạn' }));
      setTimeout(() => document.getElementById('validTo')?.focus(), 0);
      return;
    }
    if (isEdit && !governanceReason.trim()) {
      setErrors(prev => ({ ...prev, governanceReason: 'Vui lòng nhập lý do chi phí' }));
      setTimeout(() => document.getElementById('governanceReason')?.focus(), 0);
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const response = await api.put<Record<string, unknown>>(
          `${FINANCIAL.EXPENSE(Number(id))}`,
          { ...result.data, reason: governanceReason.trim() },
        );
        toast({
          kind: 'success',
          message: expenseSubmissionMessage(true, response),
        });
      } else {
        const response = savedExpenseId ? { id: savedExpenseId } : await api.post<Record<string, unknown>>(FINANCIAL.EXPENSES, {
          ...result.data,
          reason: governanceReason.trim(),
        });
        const expenseId = Number(response.id);
        if (!Number.isInteger(expenseId) || expenseId <= 0) throw new Error('Không xác định được phiếu đã lưu. Kiểm tra danh sách trước khi tạo lại.');
        setSavedExpenseId(expenseId);
        await savePendingPhotos(expenseId);
        toast({ kind: 'success', message: expenseSubmissionMessage(false, response) });
      }
      // Invalidate every cached expenses page so the list refetches with the new row.
      // Broad registered prefix — matches every ['expenses', params] query.
      await queryClient.invalidateQueries({ queryKey: qk.financial.expensesAll });
      navigate('/expenses');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi lưu chi phí';
      setPageError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (isEdit && loadingExpense) {
    return <ExpenseLoading />;
  }

  return (
    <div ref={rootRef} className="expense-page-wrap">
      {dialog}

      <div className="expense-page-container">
        <PageHeader
          title={isEdit ? 'Sửa chi phí' : 'Ghi nhận chi phí'}
          iconName="expense"
          description={isEdit ? 'Cập nhật thông tin chi phí phát sinh' : 'Nhập thông tin chi phí phát sinh'}
          onBack={handleBack}
        />

        <form onSubmit={handleSubmit} className="expense-page-form">
          {(pageError || photoError) && (
            <div className="animate-shake expense-page-error">
              <strong>Lỗi:</strong> {pageError || photoError}
            </div>
          )}

          <div className="expense-page-layout">
            <fieldset disabled={savedExpenseId != null} className="expense-layout__main" style={{ minWidth: 0, border: 0, padding: 0, margin: 0 }}>
              <div className="expense-panel">
                <div className="expense-panel__header">
                  <h2 className="expense-panel__title">Thông tin chung</h2>
                  <p className="expense-panel__subtitle">{isEdit ? 'Cập nhật' : 'Nhập'} các thông tin cơ bản cho phiếu chi</p>
                </div>

                <div className="expense-panel__body expense-grid">
              <ExpenseBasicFields form={form} errors={errors} isEdit={isEdit} existingExpense={existingExpense} set={set} />

              <div className="expense-group expense-group--catalog">
                <div className="expense-label-row">
                  <label htmlFor={showNewSupplier ? 'newSupplierName' : 'supplierId'} className="expense-label">Nhà cung cấp <span className="expense-required">*</span></label>
                  {!showNewSupplier && (
                    <button type="button" onClick={() => setShowNewSupplier(true)} className="expense-add-btn">
                      <Plus size={14} /> Thêm mới
                    </button>
                  )}
                </div>
                {showNewSupplier ? (
                  <div className="expense-quick-create-row">
                    <input
                      type="text"
                      name="newSupplierName"
                      id="newSupplierName"
                      className="expense-input"
                      placeholder="Tên nhà cung cấp…"
                      value={newSupplierName}
                      onChange={e => setNewSupplierName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateSupplier(); } if (e.key === 'Escape') { setShowNewSupplier(false); setNewSupplierName(''); } }}
                      autoFocus
                    />
                    <button type="button" aria-label="Lưu nhà cung cấp mới" className="btn btn--primary expense-quick-create-save" disabled={creatingSupplier || !newSupplierName.trim()} onClick={handleCreateSupplier}>
                      {creatingSupplier ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                    </button>
                    <button type="button" aria-label="Hủy thêm nhà cung cấp" className="btn btn--ghost btn--sm expense-quick-create-cancel" onClick={() => { setShowNewSupplier(false); setNewSupplierName(''); }}>
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <UuiSelectField
                    id="supplierId"
                    label="Nhà cung cấp"
                    hideLabel
                    value={form.supplierId === null || form.supplierId === undefined ? '' : String(form.supplierId)}
                    disabled={loadingExpenseCatalogs}
                    onChange={e => set('supplierId', e.target.value ? Number(e.target.value) : '')}
                    controlClassName="expense-select"
                    options={[
                      { value: '', label: loadingExpenseCatalogs ? 'Đang tải nhà cung cấp…' : 'Chọn nhà cung cấp…' },
                      ...suppliers.map(s => ({ value: String(s.id), label: s.name })),
                    ]}
                  />
                )}
                {errors.supplierId && <p className="expense-field-error">{errors.supplierId}</p>}
              </div>

              <div className="expense-group expense-group--catalog">
                <div className="expense-label-row">
                  <label htmlFor={showNewCategory ? 'newCategoryName' : 'categoryId'} className="expense-label">Hạng mục <span className="expense-required">*</span></label>
                  {!showNewCategory && (
                    <button type="button" onClick={() => setShowNewCategory(true)} className="expense-add-btn">
                      <Plus size={14} /> Thêm mới
                    </button>
                  )}
                </div>
                {showNewCategory ? (
                  <div className="expense-quick-create-row">
                    <input
                      type="text"
                      name="newCategoryName"
                      id="newCategoryName"
                      className="expense-input"
                      placeholder="Tên hạng mục…"
                      value={newCategoryName}
                      onChange={e => setNewCategoryName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateCategory(); } if (e.key === 'Escape') { setShowNewCategory(false); setNewCategoryName(''); } }}
                      autoFocus
                    />
                    <button type="button" aria-label="Lưu hạng mục mới" className="btn btn--primary expense-quick-create-save" disabled={creatingCategory || !newCategoryName.trim()} onClick={handleCreateCategory}>
                      {creatingCategory ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                    </button>
                    <button type="button" aria-label="Hủy thêm hạng mục" className="btn btn--ghost btn--sm expense-quick-create-cancel" onClick={() => { setShowNewCategory(false); setNewCategoryName(''); }}>
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <UuiSelectField
                    id="categoryId"
                    label="Hạng mục"
                    hideLabel
                    value={form.categoryId === null || form.categoryId === undefined ? '' : String(form.categoryId)}
                    disabled={loadingExpenseCatalogs}
                    onChange={e => set('categoryId', e.target.value ? Number(e.target.value) : '')}
                    controlClassName="expense-select"
                    options={[
                      { value: '', label: loadingExpenseCatalogs ? 'Đang tải hạng mục…' : 'Chọn hạng mục…' },
                      ...categories.map(c => ({ value: String(c.id), label: c.name })),
                    ]}
                  />
                )}
                {errors.categoryId && <p className="expense-field-error">{errors.categoryId}</p>}
              </div>

              <div className="expense-group">
                <label htmlFor="expenseType" className="expense-label">Loại chi phí</label>
                <UuiSelectField
                  id="expenseType"
                  label="Loại chi phí"
                  hideLabel
                  value={expenseType}
                  onChange={e => {
                    const val = e.target.value as 'COMPANY' | 'TRUCK' | 'TRAILER';
                    setExpenseType(val);
                    if (val === 'COMPANY') {
                      set('truckId', '');
                    } else {
                      set('vehicleComponent', val);
                      set('truckId', '');
                    }
                  }}
                  controlClassName="expense-select"
                  options={[
                    { value: 'COMPANY', label: 'Chi phí công ty' },
                    { value: 'TRUCK', label: 'Xe (Đầu kéo)' },
                    { value: 'TRAILER', label: 'Rơ-moóc' },
                  ]}
                />
              </div>

              {expenseType === 'TRUCK' && (
                <div className="expense-group">
                  <label htmlFor="truckId" className="expense-label">Biển số xe <span className="expense-required">*</span></label>
                  <UuiSelectField
                    id="truckId"
                    label="Biển số xe"
                    hideLabel
                    value={form.truckId === null || form.truckId === undefined ? '' : String(form.truckId)}
                    onChange={e => set('truckId', e.target.value ? Number(e.target.value) : '')}
                    controlClassName="expense-select"
                    options={[
                      { value: '', label: 'Chọn xe…' },
                      ...trucks.map(t => ({ value: String(t.id), label: t.licensePlate })),
                    ]}
                  />
                  {errors.truckId && <p className="expense-field-error">{errors.truckId}</p>}
                </div>
              )}

              {expenseType === 'TRAILER' && (
                <div className="expense-group">
                  <label htmlFor="truckId" className="expense-label">Biển số rơ-moóc <span className="expense-required">*</span></label>
                  <UuiSelectField
                    id="truckId"
                    label="Biển số rơ-moóc"
                    hideLabel
                    value={form.truckId === null || form.truckId === undefined ? '' : String(form.truckId)}
                    onChange={e => set('truckId', e.target.value ? Number(e.target.value) : '')}
                    controlClassName="expense-select"
                    options={[
                      { value: '', label: 'Chọn rơ-moóc…' },
                      ...trailers.map(t => ({ value: String(t.id), label: t.licensePlate })),
                    ]}
                  />
                  {errors.truckId && <p className="expense-field-error">{errors.truckId}</p>}
                </div>
              )}

              <div className="expense-group">
                <label htmlFor="amount" className="expense-label">Số tiền (đ) <span className="expense-required">*</span></label>
                <div className="expense-amount-wrapper">
                  <input
                    type="text"
                    name="amount"
                    id="amount"
                    inputMode="numeric"
                    className="expense-input expense-amount-input"
                    value={form.amount ? formatAmountDisplay(form.amount) : ''}
                    onChange={e => set('amount', parseAmountInput(e.target.value))}
                    placeholder="0"
                  />
                  <span className="expense-amount-suffix">
                    đ
                  </span>
                </div>
                {errors.amount && <p className="expense-field-error">{errors.amount}</p>}
              </div>

              {showValidityFields && (
                <>
                  {/* QA-088: the validity pair always occupies one grid row
                      together — the conditional fuel-truck group above flips
                      auto-placement parity, which used to push the two
                      dates onto diagonal rows. */}
                  <div className="expense-validity-pair">
                  <div className="expense-group">
                    <label htmlFor="validFrom" className="expense-label">Hiệu lực từ <span className="expense-required">*</span></label>
                    <DateInput
                      name="validFrom"
                      id="validFrom"
                      className="expense-input"
                      value={form.validFrom}
                      onChange={(value) => set('validFrom', value)}
                    />
                    {errors.validFrom && <p className="expense-field-error">{errors.validFrom}</p>}
                  </div>
                  <div className="expense-group">
                    <label htmlFor="validTo" className="expense-label">Hiệu lực đến <span className="expense-required">*</span></label>
                    <DateInput
                      name="validTo"
                      id="validTo"
                      className="expense-input"
                      value={form.validTo}
                      onChange={(value) => set('validTo', value)}
                    />
                    {errors.validTo && <p className="expense-field-error">{errors.validTo}</p>}
                  </div>
                  </div>
                </>
              )}

              <div className="expense-group">
                <label htmlFor="receiptId" className="expense-label">Mã biên lai</label>
                <input
                  type="text"
                  name="receiptId"
                  id="receiptId"
                  className="expense-input"
                  value={form.receiptId}
                  onChange={e => set('receiptId', e.target.value)}
                  placeholder="Nhập mã biên lai…"
                />
              </div>

              <div className="expense-group expense-group--full">
                <label htmlFor="note" className="expense-label">Ghi chú</label>
                <input
                  type="text"
                  name="note"
                  id="note"
                  className="expense-input"
                  value={form.note}
                  onChange={e => set('note', e.target.value)}
                  placeholder="Ghi chú thêm…"
                />
              </div>

              {isEdit && <div className="expense-group expense-group--full">
                <label htmlFor="governanceReason" className="expense-label">
                  Lý do điều chỉnh <span className="expense-required">*</span>
                </label>
                <textarea
                  name="governanceReason"
                  id="governanceReason"
                  className="expense-input"
                  value={governanceReason}
                  onChange={event => {
                    setGovernanceReason(event.target.value);
                    if (errors.governanceReason) {
                      setErrors(previous => {
                        const next = { ...previous };
                        delete next.governanceReason;
                        return next;
                      });
                    }
                  }}
                  placeholder="Nêu mục đích và căn cứ của khoản chi…"
                  rows={3}
                />
                {errors.governanceReason && (
                  <p className="expense-field-error">
                    {errors.governanceReason}
                  </p>
                )}
                <p className="expense-hint">
                  {existingExpense?.paymentStatus === 'PAID'
                    ? 'Đây là phiếu đã quyết toán. Thay đổi sẽ cập nhật trực tiếp; phiếu gốc và chứng từ lịch sử được giữ nguyên.'
                    : 'Khoản chi và công nợ được ghi nhận trực tiếp vào sổ kế toán.'}
                </p>
              </div>}
                </div>
              </div>
            </fieldset>

            <ExpensePhotoAside photos={photos} uploading={uploading} isEdit={isEdit} submitting={submitting} handleBack={handleBack} removePhoto={removePhoto} handlePhotoUpload={handlePhotoUpload} />
          </div>
        </form>
      </div>
    </div>
  );
}
