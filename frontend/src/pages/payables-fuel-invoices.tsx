import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Droplets, FilePenLine, Plus, ShieldCheck, Truck, XCircle } from 'lucide-react';
import { SupplierType, round2dp, type TripExpense } from '@tingting/shared';

import { qk } from '../api/keys';
import { tripClient } from '../api/tripClient';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';
import { Panel, Modal } from '../components/UI';
import { FuelInvoiceFilters } from '../features/payables/FuelInvoiceFilters';
import { SearchableSelect, DateInput, UuiSelectField } from '../design-system';
import { SortHeader } from '../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../lib/table-sort';
import { useAuth } from '../hooks/useAuth';
import { useAllSuppliers } from '../hooks/useCatalogQueries';
import {
  useCreateFuelInvoice,
  useFuelInvoice,
  useFuelInvoices,
  useFuelInvoiceTripOptions,
  useUpdateFuelInvoice,
} from '../hooks/useQueries';
import type {
  FuelInvoice,
  FuelInvoiceStatus,
} from '../api/financialClient';
import {
  buildForm,
  buildFuelInvoicePayload,
  computeCompletion,
  emptyForm,
  emptyRow,
  resolveEditingInvoice,
  toDecimal,
  todayValue,
  validateFuelInvoiceForm,
  type FuelInvoiceEditorState,
  type FuelInvoiceFormRow,
  type FuelInvoiceFormState,
} from './payables-fuel-invoices.logic';
import './payables-fuel-invoices.css';
import '../styles/table-sort.css';

const STATUS_META: Record<FuelInvoiceStatus, { label: string; className: string; icon: typeof ClipboardList }> = {
  DRAFT: { label: 'Bản nháp', className: 'fuel-invoice-status fuel-invoice-status--pending', icon: ClipboardList },
  RECORDED: { label: 'Đã ghi nhận', className: 'fuel-invoice-status fuel-invoice-status--approved', icon: CheckCircle2 },
  VOIDED: { label: 'Đã hủy', className: 'fuel-invoice-status fuel-invoice-status--rejected', icon: XCircle },
  REVERSED: { label: 'Đã hoàn tác', className: 'fuel-invoice-status fuel-invoice-status--rejected', icon: XCircle },
  PENDING: { label: 'Bản nháp cũ', className: 'fuel-invoice-status fuel-invoice-status--pending', icon: ClipboardList },
  APPROVED: { label: 'Đã ghi nhận (lịch sử)', className: 'fuel-invoice-status fuel-invoice-status--approved', icon: CheckCircle2 },
  REJECTED: { label: 'Từ chối (lịch sử)', className: 'fuel-invoice-status fuel-invoice-status--rejected', icon: XCircle },
};

function supplierNameFor(invoice: FuelInvoice, suppliersById: Map<number, string>) {
  return suppliersById.get(invoice.supplierId) ?? 'Nhà cung cấp không còn trong danh mục';
}

function plateForTrip(
  tripId: number,
  tripOptionsById: Map<number, { truckPlate: string | null }>,
  explicitTruckId: number | null,
) {
  const fromTrip = tripOptionsById.get(tripId)?.truckPlate;
  if (fromTrip) return fromTrip;
  return explicitTruckId != null ? 'Xe không còn trong danh mục' : 'Chưa gắn xe';
}

function invoiceMatchesSearch(invoice: FuelInvoice, supplierName: string, search: string) {
  if (!search.trim()) return true;
  const normalized = search.trim().toLocaleLowerCase('vi');
  return invoice.invoiceNumber.toLocaleLowerCase('vi').includes(normalized)
    || supplierName.toLocaleLowerCase('vi').includes(normalized);
}

function FuelInvoiceSummaryMetric({
  icon: Icon,
  label,
  value,
  tone = 'default',
}: {
  icon: typeof Droplets;
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger' | 'success';
}) {
  return (
    <div className={`fuel-invoice-metric fuel-invoice-metric--${tone}`}>
      <div className="fuel-invoice-metric__icon" aria-hidden="true">
        <Icon size={18} />
      </div>
      <div>
        <div className="fuel-invoice-metric__label">{label}</div>
        <div className="fuel-invoice-metric__value">{value}</div>
      </div>
    </div>
  );
}

function FuelInvoiceStatusPill({ status }: { status: FuelInvoiceStatus }) {
  const { label, className, icon: Icon } = STATUS_META[status];
  return (
    <span className={className}>
      <Icon size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

function FuelInvoiceDetailBody({
  invoice,
  suppliersById,
  tripOptionsById,
}: {
  invoice: FuelInvoice;
  suppliersById: Map<number, string>;
  tripOptionsById: Map<number, { truckPlate: string | null; tripCode: string | null; routeName: string | null }>;
}) {
  const completion = computeCompletion(invoice.totalLiters, invoice.unitPrice, invoice.allocations ?? []);

  return (
    <div className="fuel-invoice-detail">
      <div className="fuel-invoice-detail__hero">
        <div>
          <div className="fuel-invoice-detail__eyebrow">Hóa đơn nhiên liệu</div>
          <h3>{invoice.invoiceNumber}</h3>
          <p>
            {supplierNameFor(invoice, suppliersById)} · ngày {formatDate(invoice.invoiceDate)}
          </p>
        </div>
        <FuelInvoiceStatusPill status={invoice.approvalStatus} />
      </div>

      <div className="fuel-invoice-detail__metrics">
        <FuelInvoiceSummaryMetric icon={Droplets} label="Tổng số lít" value={`${formatNumber(completion.totalLiters)} l`} />
        <FuelInvoiceSummaryMetric icon={Truck} label="Đã phân bổ" value={`${formatNumber(completion.allocatedLiters)} l`} tone={completion.isComplete ? 'success' : 'warn'} />
        <FuelInvoiceSummaryMetric icon={ShieldCheck} label="Tổng tiền" value={formatCurrency(completion.totalAmount)} />
      </div>

      {!completion.isComplete && (
        <div className="fuel-invoice-warning" role="alert">
          <strong>Chưa đủ phân bổ.</strong> Còn thiếu {formatNumber(completion.remainingLiters)} lít
          tương ứng {formatCurrency(Math.max(0, completion.remainingAmount))}. Không chia đều tự động;
          phải phân bổ theo lít thực tế từng chuyến.
        </div>
      )}

      {invoice.note && (
        <div className="fuel-invoice-note">
          <strong>Ghi chú:</strong> {invoice.note}
        </div>
      )}

      <div className="fuel-invoice-detail__allocations">
        {(invoice.allocations ?? []).length === 0 ? (
          <div className="fuel-invoice-empty">Chưa có dòng phân bổ theo chuyến/xe.</div>
        ) : (
          <div className="fuel-invoice-allocation-list">
            {(invoice.allocations ?? []).map((allocation) => {
              const tripMeta = tripOptionsById.get(allocation.tripId);
              return (
                <div key={allocation.id ?? `${allocation.tripId}-${allocation.voucherReference}`} className="fuel-invoice-allocation-card">
                  <div className="fuel-invoice-allocation-card__head">
                    <div>
                      <strong>{tripMeta?.tripCode ?? 'Chuyến chưa có mã'}</strong>
                      <span>{tripMeta?.routeName ?? 'Chuyến đã chốt'}</span>
                    </div>
                    <div className="fuel-invoice-allocation-card__amount">
                      {formatCurrency(allocation.amount)}
                    </div>
                  </div>
                  <div className="fuel-invoice-allocation-card__grid">
                    <span>Xe: {plateForTrip(allocation.tripId, tripOptionsById, allocation.truckId)}</span>
                    <span>Phiếu: {allocation.voucherReference}</span>
                    <span>Ngày đổ: {formatDate(allocation.voucherDate)}</span>
                    <span>Số lít: {formatNumber(allocation.liters)} l</span>
                  </div>
                  {allocation.note && <p>{allocation.note}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TripExpenseReferenceSelect({
  tripId,
  supplierId,
  value,
  onChange,
}: {
  tripId: number | null;
  supplierId: number | null;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const tripExpensesQuery = useQuery<TripExpense[]>({
    queryKey: qk.tripForm.tripExpenses(tripId ?? 0),
    enabled: tripId != null,
    queryFn: async () => {
      const response = await tripClient.listTripExpenses(tripId!);
      return response.items ?? [];
    },
  });
  const options = useMemo(() => {
    if (!tripExpensesQuery.data || supplierId == null) return [];
    return tripExpensesQuery.data.filter((expense) =>
      !['REJECTED', 'VOIDED'].includes(expense.approvalStatus ?? '')
      && expense.supplierId === supplierId
      && expense.expenseType.toLocaleLowerCase('vi').includes('fuel'));
  }, [supplierId, tripExpensesQuery.data]);

  if (tripId == null) {
    return <div className="fuel-invoice-editor__helper">Chọn chuyến trước để liên kết chi phí nhiên liệu thực tế.</div>;
  }

  if (tripExpensesQuery.isLoading) {
    return <div className="fuel-invoice-editor__helper">Đang tải chi phí nhiên liệu của chuyến…</div>;
  }

  if (tripExpensesQuery.error) {
    return <div className="fuel-invoice-editor__helper fuel-invoice-editor__helper--error">Không tải được danh sách chi phí đã ghi nhận.</div>;
  }

  if (options.length === 0) {
    return (
      <div className="fuel-invoice-editor__helper fuel-invoice-editor__helper--error">
        Chuyến này chưa có chi phí nhiên liệu đã ghi nhận khớp nhà cung cấp để làm căn cứ phân bổ.
      </div>
    );
  }

  return (
    <UuiSelectField
      label="Liên kết chi phí nhiên liệu đã ghi nhận"
      hideLabel
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      aria-label="Liên kết chi phí nhiên liệu đã ghi nhận"
      options={[{ value: '', label: 'Chọn chi phí nhiên liệu đã ghi nhận' }, ...options.map((expense) => ({
        value: String(expense.id),
        label: `${formatDate(expense.expenseDate ?? expense.createdAt)} · ${formatCurrency(expense.buyAmount)}`
      }))]}
    />
  );
}

function FuelInvoiceEditor({
  mode,
  form,
  setForm,
  suppliers,
  tripOptions,
  error,
}: {
  mode: 'create' | 'edit';
  form: FuelInvoiceFormState;
  setForm: Dispatch<SetStateAction<FuelInvoiceFormState>>;
  suppliers: Array<{ id: number; name: string }>;
  tripOptions: Array<{ id: number; tripCode: string | null; truckId: number | null; truckPlate: string | null; departureDate: string | null; routeName: string | null }>;
  error: string | null;
}) {
  const completion = computeCompletion(form.totalLiters, form.unitPrice, form.allocations);
  const supplierOptions = suppliers
    .map((supplier) => ({ value: String(supplier.id), label: supplier.name }))
    .sort((left, right) => left.label.localeCompare(right.label, 'vi'));
  const tripOptionsById = new Map(tripOptions.map((trip) => [trip.id, trip]));

  const updateRow = (localId: string, updater: (current: FuelInvoiceFormRow) => FuelInvoiceFormRow) => {
    setForm((current) => ({
      ...current,
      allocations: current.allocations.map((row) => (row.localId === localId ? updater(row) : row)),
    }));
  };

  return (
    <div className="fuel-invoice-editor">
      {error && <div className="fuel-invoice-warning fuel-invoice-warning--error" role="alert">{error}</div>}

      <div className="fuel-invoice-editor__grid">
        <div className="field">
          <label htmlFor="fuel-invoice-supplier">Nhà cung cấp <span className="req" aria-hidden="true">*</span></label>
          <SearchableSelect
            id="fuel-invoice-supplier"
            value={form.supplierId}
            onChange={(value) => setForm((current) => ({ ...current, supplierId: value }))}
            options={supplierOptions}
            placeholder="Chọn nhà cung cấp nhiên liệu"
            searchPlaceholder="Tìm nhà cung cấp…"
            emptyMessage="Không có nhà cung cấp nhiên liệu phù hợp."
            required
          />
        </div>
        <div className="field">
          <label htmlFor="fuel-invoice-number">Số hóa đơn <span className="req" aria-hidden="true">*</span></label>
          <input
            id="fuel-invoice-number"
            className="input"
            value={form.invoiceNumber}
            onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))}
            placeholder="Ví dụ: HD-PTX-0726-001"
          />
        </div>
        <div className="field">
          <label htmlFor="fuel-invoice-date">Ngày hóa đơn <span className="req" aria-hidden="true">*</span></label>
          <DateInput
            id="fuel-invoice-date"
            className="input"
            value={form.invoiceDate}
            onChange={(value) => setForm((current) => ({
              ...current,
              invoiceDate: value,
              allocations: current.allocations.map((row) => row.voucherDate ? row : { ...row, voucherDate: value }),
            }))}
          />
        </div>
        <div className="field">
          <label htmlFor="fuel-invoice-liters">Tổng số lít <span className="req" aria-hidden="true">*</span></label>
          <input
            id="fuel-invoice-liters"
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={form.totalLiters}
            onChange={(event) => setForm((current) => ({ ...current, totalLiters: event.target.value }))}
            placeholder="Ví dụ: 100"
          />
        </div>
        <div className="field">
          <label htmlFor="fuel-invoice-price">Đơn giá (VND/lít) <span className="req" aria-hidden="true">*</span></label>
          <input
            id="fuel-invoice-price"
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={form.unitPrice}
            onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))}
            placeholder="Ví dụ: 22000"
          />
        </div>
        <div className="field fuel-invoice-editor__note-field">
          <label htmlFor="fuel-invoice-note">Ghi chú</label>
          <textarea
            id="fuel-invoice-note"
            className="input fuel-invoice-editor__textarea"
            rows={3}
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="Giải trình hóa đơn điều chỉnh hoặc ghi chú nội bộ."
          />
        </div>
      </div>

      <div className="fuel-invoice-editor__summary">
        <FuelInvoiceSummaryMetric icon={Droplets} label="Tổng lít hóa đơn" value={`${formatNumber(completion.totalLiters)} l`} />
        <FuelInvoiceSummaryMetric icon={Truck} label="Đã phân bổ" value={`${formatNumber(completion.allocatedLiters)} l`} tone={completion.isComplete ? 'success' : 'warn'} />
        <FuelInvoiceSummaryMetric icon={ShieldCheck} label="Tổng tiền hóa đơn" value={formatCurrency(completion.totalAmount)} />
      </div>

      <div className="fuel-invoice-editor__banner">
        Một hóa đơn có thể gắn nhiều chuyến và nhiều xe. Hệ thống chỉ lưu khi tổng lít phân bổ khớp
        chính xác số lít trên hóa đơn; không có tuỳ chọn chia đều.
      </div>

      <div className="fuel-invoice-editor__allocations">
        <div className="fuel-invoice-editor__allocations-head">
          <div>
            <h4>{mode === 'create' ? 'Dòng phân bổ theo chuyến/xe' : 'Chỉnh sửa dòng phân bổ'}</h4>
            <p>Mỗi dòng phải có chuyến, số phiếu/nhật ký đổ dầu, ngày đổ và số lít thực tế.</p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setForm((current) => ({
              ...current,
              allocations: [...current.allocations, emptyRow(current.invoiceDate || todayValue())],
            }))}
          >
            <Plus size={14} aria-hidden="true" />
            Thêm dòng
          </button>
        </div>

        {form.allocations.map((row, index) => {
          const tripOption = tripOptionsById.get(Number(row.tripId));
          const allocationAmount = round2dp(toDecimal(row.liters) * toDecimal(form.unitPrice));
          return (
            <div key={row.localId} className="fuel-invoice-editor__row">
              <div className="fuel-invoice-editor__row-head">
                <strong>Dòng {index + 1}</strong>
                {form.allocations.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setForm((current) => ({
                      ...current,
                      allocations: current.allocations.filter((candidate) => candidate.localId !== row.localId),
                    }))}
                  >
                    Xóa
                  </button>
                )}
              </div>

              <div className="fuel-invoice-editor__row-grid">
                <div className="field">
                  <label htmlFor={`fuel-trip-${row.localId}`}>Chuyến</label>
                  <SearchableSelect
                    id={`fuel-trip-${row.localId}`}
                    value={row.tripId}
                    onChange={(value) => {
                      const selectedTrip = tripOptionsById.get(Number(value));
                      updateRow(row.localId, (current) => ({
                        ...current,
                        tripId: value,
                        truckId: selectedTrip?.truckId ?? current.truckId,
                        voucherDate: current.voucherDate || form.invoiceDate || todayValue(),
                      }));
                    }}
                    options={tripOptions.map((trip) => ({
                      value: String(trip.id),
                      label: `${trip.tripCode ?? 'Chuyến chưa có mã'} · ${trip.truckPlate ?? 'Chưa gắn xe'}`,
                      searchText: `${trip.routeName ?? ''} ${trip.departureDate ?? ''}`,
                    }))}
                    placeholder="Chọn chuyến"
                    searchPlaceholder="Tìm theo mã chuyến hoặc biển số…"
                    emptyMessage="Không tìm thấy chuyến phù hợp."
                  />
                </div>
                <div className="field">
                  <label htmlFor={`fuel-voucher-${row.localId}`}>Phiếu / nhật ký đổ dầu</label>
                  <input
                    id={`fuel-voucher-${row.localId}`}
                    className="input"
                    value={row.voucherReference}
                    onChange={(event) => updateRow(row.localId, (current) => ({
                      ...current,
                      voucherReference: event.target.value,
                    }))}
                    placeholder="Ví dụ: PXD-0726-18"
                  />
                </div>
                <div className="field">
                  <label htmlFor={`fuel-voucher-date-${row.localId}`}>Ngày đổ dầu</label>
                  <DateInput
                    id={`fuel-voucher-date-${row.localId}`}
                    className="input"
                    value={row.voucherDate}
                    onChange={(value) => updateRow(row.localId, (current) => ({
                      ...current,
                      voucherDate: value,
                    }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`fuel-liters-${row.localId}`}>Số lít thực tế</label>
                  <input
                    id={`fuel-liters-${row.localId}`}
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.liters}
                    onChange={(event) => updateRow(row.localId, (current) => ({
                      ...current,
                      liters: event.target.value,
                    }))}
                    placeholder="Ví dụ: 40"
                  />
                </div>
                <div className="field">
                  <label>Chi phí nhiên liệu liên kết</label>
                  <TripExpenseReferenceSelect
                    tripId={row.tripId ? Number(row.tripId) : null}
                    supplierId={form.supplierId ? Number(form.supplierId) : null}
                    value={row.tripExpenseId}
                    onChange={(value) => updateRow(row.localId, (current) => ({
                      ...current,
                      tripExpenseId: value,
                    }))}
                  />
                </div>
                <div className="fuel-invoice-editor__row-meta">
                  <span>Xe: {tripOption?.truckPlate ?? (row.truckId != null ? 'Xe không còn trong danh mục' : 'Chưa gắn xe')}</span>
                  <span>Thành tiền: {formatCurrency(allocationAmount)}</span>
                </div>
                <div className="field fuel-invoice-editor__row-note">
                  <label htmlFor={`fuel-note-${row.localId}`}>Ghi chú dòng</label>
                  <input
                    id={`fuel-note-${row.localId}`}
                    className="input"
                    value={row.note}
                    onChange={(event) => updateRow(row.localId, (current) => ({
                      ...current,
                      note: event.target.value,
                    }))}
                    placeholder="Lý do điều chỉnh hoặc ghi chú phân bổ."
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FuelInvoicesPanel() {
  const { user } = useAuth();
  const canCreateOrEdit = user?.role === 'ADMIN' || user?.role === 'ACCOUNTANT';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FuelInvoiceStatus | ''>('');
  const [supplierFilter, setSupplierFilter] = useState('');
  // Full set is already loaded client-side (cursor fetch), so column sorting
  // happens in-page; the server's newest-first order stays until a header is used.
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSortChange = (key: string) => setSort(current => nextTableSort(current, key));
  const [detailInvoiceId, setDetailInvoiceId] = useState<number | null>(null);
  const [editorState, setEditorState] = useState<FuelInvoiceEditorState>(null);
  const [form, setForm] = useState<FuelInvoiceFormState>(emptyForm);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const suppliersQuery = useAllSuppliers();
  const tripsQuery = useFuelInvoiceTripOptions();
  const invoicesQuery = useFuelInvoices({
    supplierId: supplierFilter ? Number(supplierFilter) : undefined,
    status: statusFilter || undefined,
  });
  const detailQuery = useFuelInvoice(detailInvoiceId);
  const createMutation = useCreateFuelInvoice();
  const updateMutation = useUpdateFuelInvoice();

  const suppliers = useMemo(
    () => (suppliersQuery.data ?? []).filter((supplier) => supplier.isFuelSupplier || (supplier.types ?? []).includes(SupplierType.FUEL)),
    [suppliersQuery.data],
  );
  const suppliersById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  );
  const tripOptions = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const tripOptionsById = useMemo(
    () => new Map(tripOptions.map((trip) => [trip.id, trip])),
    [tripOptions],
  );

  const filteredInvoices = useMemo(
    () => (invoicesQuery.data ?? []).filter((invoice) =>
      invoiceMatchesSearch(invoice, supplierNameFor(invoice, suppliersById), search)),
    [invoicesQuery.data, search, suppliersById],
  );

  const sortedInvoices = useMemo(() => sortClientSide(filteredInvoices, sort, {
    invoiceNumber: (invoice: FuelInvoice) => invoice.invoiceNumber,
    supplierName: (invoice: FuelInvoice) => suppliersById.get(invoice.supplierId) ?? null,
    status: (invoice: FuelInvoice) => STATUS_META[invoice.approvalStatus].label,
    totalLiters: (invoice: FuelInvoice) => computeCompletion(invoice.totalLiters, invoice.unitPrice, invoice.allocations ?? []).totalLiters,
    allocatedLiters: (invoice: FuelInvoice) => computeCompletion(invoice.totalLiters, invoice.unitPrice, invoice.allocations ?? []).allocatedLiters,
    unitPrice: (invoice: FuelInvoice) => Number(invoice.unitPrice),
    totalAmount: (invoice: FuelInvoice) => Number(invoice.totalAmount),
  }, (a: FuelInvoice, b: FuelInvoice) => a.id - b.id), [filteredInvoices, sort, suppliersById]);

  const summary = useMemo(() => {
    const invoices = invoicesQuery.data ?? [];
    let pending = 0;
    let incomplete = 0;
    let totalAmount = 0;
    for (const invoice of invoices) {
      if (invoice.approvalStatus === 'DRAFT' || invoice.approvalStatus === 'PENDING') pending += 1;
      const completion = computeCompletion(invoice.totalLiters, invoice.unitPrice, invoice.allocations ?? []);
      if (!completion.isComplete) incomplete += 1;
      totalAmount += completion.totalAmount;
    }
    return { total: invoices.length, pending, incomplete, totalAmount: round2dp(totalAmount) };
  }, [invoicesQuery.data]);

  useEffect(() => {
    if (!editorState || editorState.mode !== 'edit' || !detailQuery.data) return;
    setForm(buildForm(detailQuery.data));
  }, [detailQuery.data, editorState]);

  const editorCompletion = useMemo(
    () => computeCompletion(form.totalLiters, form.unitPrice, form.allocations),
    [form],
  );

  const openCreate = () => {
    setSubmitError(null);
    setForm(emptyForm());
    setEditorState({ mode: 'create', invoiceId: null });
  };

  const openDetail = (invoiceId: number) => {
    setActionError(null);
    setActionNotice(null);
    setDetailInvoiceId(invoiceId);
  };

  const openEditFromDetail = () => {
    if (!detailQuery.data) return;
    setSubmitError(null);
    setForm(buildForm(detailQuery.data));
    setEditorState({ mode: 'edit', invoiceId: detailQuery.data.id });
  };

  const closeDetail = () => setDetailInvoiceId(null);
  const closeEditor = () => setEditorState(null);

  const submitEditor = async () => {
    setSubmitError(null);
    const supplierId = Number(form.supplierId);
    const totalLiters = Number(form.totalLiters);
    const unitPrice = Number(form.unitPrice);

    const validationError = validateFuelInvoiceForm(form, editorCompletion);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    const payload = buildFuelInvoicePayload(form, supplierId, totalLiters, unitPrice);

    const editingInvoice = resolveEditingInvoice(editorState, detailQuery.data);
    if (editorState?.mode === 'edit' && !editingInvoice) {
      setSubmitError('Không tải được phiên bản hiện tại của hóa đơn. Vui lòng mở lại chi tiết trước khi lưu.');
      return;
    }

    try {
      // `resolveEditingInvoice` returns a row only when its id equals
      // `editorState.invoiceId`, so that id is the update target; anything else
      // is a create. The old inner re-check of that invariant was unreachable.
      const response = editingInvoice
        ? await updateMutation.mutateAsync({
          id: editingInvoice.id,
          data: payload,
          expectedVersion: editingInvoice.version,
        })
        : await createMutation.mutateAsync(payload);
      setEditorState(null);
      setActionNotice('Đã ghi nhận hóa đơn. Thanh toán nhà cung cấp được ghi riêng.');
      setDetailInvoiceId(response.id);
    } catch (error) {
      setSubmitError((error as Error).message || 'Không thể lưu hóa đơn nhiên liệu.');
    }
  };


  return (
    <>
      <Panel
        className="fuel-invoices-panel"
        title="Hóa đơn nhiên liệu nhiều xe"
        subtitle="Quản lý hóa đơn và nhiều dòng phân bổ theo chuyến/xe. Số tiền mỗi dòng luôn bằng số lít thực tế × đơn giá hóa đơn."
        action={canCreateOrEdit ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={openCreate}>
            <Plus size={14} aria-hidden="true" />
            Tạo hóa đơn nhiên liệu
          </button>
        ) : undefined}
      >
        <div className="fuel-invoices-panel__summary">
          <FuelInvoiceSummaryMetric icon={ClipboardList} label="Tổng hóa đơn" value={formatNumber(summary.total)} />
          <FuelInvoiceSummaryMetric icon={ShieldCheck} label="Bản nháp" value={formatNumber(summary.pending)} tone={summary.pending > 0 ? 'warn' : 'success'} />
          <FuelInvoiceSummaryMetric icon={Droplets} label="Cần xử lý" value={formatNumber(summary.incomplete)} tone={summary.incomplete > 0 ? 'danger' : 'success'} />
          <FuelInvoiceSummaryMetric icon={Truck} label="Giá trị hóa đơn" value={formatCurrency(summary.totalAmount)} />
        </div>

        {/* Card 20260927_152: the ONE shared strip — the search cell plus the
            supplier/status criteria, which render inline while the strip fits
            two rows and fold into `Bộ lọc` when the width leaves no other
            choice. The panel declares no filter layout of its own. */}
        <FuelInvoiceFilters
          search={search}
          onSearchChange={setSearch}
          supplier={supplierFilter}
          onSupplierChange={setSupplierFilter}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          suppliers={suppliers}
        />

        {invoicesQuery.error && (
          <div className="fuel-invoice-warning fuel-invoice-warning--error" role="alert">
            {(invoicesQuery.error as Error).message}
          </div>
        )}

        {invoicesQuery.isLoading ? (
          <div className="fuel-invoice-empty">Đang tải hóa đơn nhiên liệu…</div>
        ) : (
          <>
            <div className="desktop-only table-wrap fuel-invoices-table-wrap">
              <div className="table-scroll">
                <table className="fuel-invoices-table">
                  <thead>
                    <tr>
                      <SortHeader label="Hóa đơn" sortKey="invoiceNumber" sort={sort} onSortChange={handleSortChange} />
                      <SortHeader label="Nhà cung cấp" sortKey="supplierName" sort={sort} onSortChange={handleSortChange} />
                      <SortHeader label="Trạng thái" sortKey="status" sort={sort} onSortChange={handleSortChange} />
                      <SortHeader label="Tổng lít" sortKey="totalLiters" sort={sort} onSortChange={handleSortChange} className="num" />
                      <SortHeader label="Đã phân bổ" sortKey="allocatedLiters" sort={sort} onSortChange={handleSortChange} className="num" />
                      <SortHeader label="Đơn giá" sortKey="unitPrice" sort={sort} onSortChange={handleSortChange} className="num" />
                      <SortHeader label="Thành tiền" sortKey="totalAmount" sort={sort} onSortChange={handleSortChange} className="num" />
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInvoices.map((invoice) => {
                      const completion = computeCompletion(invoice.totalLiters, invoice.unitPrice, invoice.allocations ?? []);
                      return (
                        <tr key={invoice.id}>
                          <td>
                            <div className="fuel-invoice-cell-title">{invoice.invoiceNumber}</div>
                            <div className="fuel-invoice-cell-subtitle">Ngày {formatDate(invoice.invoiceDate)}</div>
                          </td>
                          <td>{supplierNameFor(invoice, suppliersById)}</td>
                          <td>
                            <FuelInvoiceStatusPill status={invoice.approvalStatus} />
                            {!completion.isComplete && (
                              <div className="fuel-invoice-cell-subtitle fuel-invoice-cell-subtitle--danger">
                                Còn thiếu {formatNumber(Math.max(0, completion.remainingLiters))} l
                              </div>
                            )}
                          </td>
                          <td className="num typo-mono">{formatNumber(completion.totalLiters)} l</td>
                          <td className="num typo-mono">{formatNumber(completion.allocatedLiters)} l</td>
                          <td className="num typo-mono">{formatCurrency(invoice.unitPrice)}</td>
                          <td className="num typo-mono">{formatCurrency(invoice.totalAmount)}</td>
                          <td className="fuel-invoices-table__actions">
                            <button type="button" className="btn btn--secondary btn--sm" onClick={() => openDetail(invoice.id)}>
                              Xem
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredInvoices.length === 0 && (
                      <tr>
                        <td colSpan={8}>
                          <div className="fuel-invoice-empty">Chưa có hóa đơn nhiên liệu phù hợp với bộ lọc hiện tại.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mobile-only fuel-invoice-card-list">
              {sortedInvoices.length === 0 ? (
                <div className="fuel-invoice-empty">Chưa có hóa đơn nhiên liệu phù hợp với bộ lọc hiện tại.</div>
              ) : (
                sortedInvoices.map((invoice) => {
                  const completion = computeCompletion(invoice.totalLiters, invoice.unitPrice, invoice.allocations ?? []);
                  return (
                    <button
                      key={invoice.id}
                      type="button"
                      className="fuel-invoice-mobile-card"
                      onClick={() => openDetail(invoice.id)}
                    >
                      <div className="fuel-invoice-mobile-card__head">
                        <div>
                          <strong>{invoice.invoiceNumber}</strong>
                          <span>{supplierNameFor(invoice, suppliersById)}</span>
                        </div>
                        <FuelInvoiceStatusPill status={invoice.approvalStatus} />
                      </div>
                      <div className="fuel-invoice-mobile-card__grid">
                        <span>{formatDate(invoice.invoiceDate)}</span>
                        <span>{formatNumber(completion.totalLiters)} l</span>
                        <span>{formatNumber(completion.allocatedLiters)} l đã phân bổ</span>
                        <span>{formatCurrency(invoice.totalAmount)}</span>
                      </div>
                      {!completion.isComplete && (
                        <div className="fuel-invoice-mobile-card__warning">
                          Còn thiếu {formatNumber(Math.max(0, completion.remainingLiters))} lít, chưa ghi nhận.
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </Panel>

      <Modal
        isOpen={detailInvoiceId != null}
        onClose={closeDetail}
        title="Chi tiết hóa đơn nhiên liệu"
        maxWidth={960}
        footer={
          <div className="fuel-invoice-modal__footer">
            {detailQuery.data && !['VOIDED', 'REVERSED', 'REJECTED'].includes(detailQuery.data.approvalStatus) && canCreateOrEdit && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={openEditFromDetail}>
                <FilePenLine size={14} aria-hidden="true" />
                Sửa / hoàn tất hóa đơn
              </button>
            )}

            <button type="button" className="btn btn--ghost btn--sm" onClick={closeDetail}>
              Đóng
            </button>
          </div>
        }
      >
        {actionError && <div className="fuel-invoice-warning fuel-invoice-warning--error" role="alert">{actionError}</div>}
        {actionNotice && <div className="fuel-invoice-warning" role="status">{actionNotice}</div>}
        {detailQuery.isLoading || !detailQuery.data ? (
          <div className="fuel-invoice-empty">Đang tải chi tiết hóa đơn…</div>
        ) : (
          <FuelInvoiceDetailBody
            invoice={detailQuery.data}
            suppliersById={suppliersById}
            tripOptionsById={tripOptionsById}
          />
        )}
      </Modal>

      <Modal
        isOpen={editorState != null}
        onClose={closeEditor}
        title={editorState?.mode === 'edit' ? 'Sửa hóa đơn nhiên liệu' : 'Tạo hóa đơn nhiên liệu'}
        maxWidth={1120}
        footer={
          <div className="fuel-invoice-modal__footer">
            <button type="button" className="btn btn--secondary btn--sm" onClick={closeEditor} disabled={createMutation.isPending || updateMutation.isPending}>
              Hủy
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={submitEditor}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
        }
      >
        <FuelInvoiceEditor
          mode={editorState?.mode ?? 'create'}
          form={form}
          setForm={setForm}
          suppliers={suppliers}
          tripOptions={tripOptions}
          error={submitError}
        />
      </Modal>
    </>
  );
}
