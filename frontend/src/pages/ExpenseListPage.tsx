import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight, AlertTriangle, X, Loader2, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { api } from '../lib/api';
import { configClient } from '../api/configClient';
import { formatNumber, formatDate } from '../lib/format';
import { splitKpi } from '../features/dashboard/utils';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { AssetIcon } from '../components/AssetIcon';
import { EmptyState, Pagination, DateInput, UuiSelectField, useTableQueryState } from '../design-system';
import { Money } from '../components/shared/Money';
import { StatusStrip } from '../components/shared/StatusStrip';
import { useCatalogs } from '../hooks/useCatalogs';
import { useQuery } from '@tanstack/react-query';
import { usePageAnimations, useListAnimations } from '../hooks/animations';
import { FINANCIAL } from '@tingting/shared';
import type { ExpenseWithRefs, PaginatedResponse } from '@tingting/shared';
import { qk } from '../api/keys';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import { resolveExpenseCatalogs } from '../features/expenses/expenseCatalogs';
import type { ExpenseCatalogs } from '../features/expenses/expenseCatalogs';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './ExpenseListPage.css';
import './ExpenseListRecordTable.css';

const PAGE_SIZE = 20;

const EXPENSE_STATUS_COLORS: Record<string, string> = {
  PAID: '#059669',
  UNPAID: '#D97706',
};

/** Filter bag for GET /api/expenses (server-paginated; no search param yet).
 * sortBy/sortDir ride the bag so every sort change resets the page too. */
type ExpenseTableFilters = {
  supplierId?: number;
  categoryId?: number;
  truckId?: number;
  fromDate?: string;
  toDate?: string;
  sortBy?: 'expenseDate' | 'supplierName' | 'categoryName' | 'vehiclePlate' | 'vehicleComponent' | 'amount' | 'paymentStatus';
  sortDir?: 'asc' | 'desc';
};

/** Sortable header for the record-table markup — mirrors the ledger's
 * SortHeader (ShipmentContainerLedger) so both table systems share the
 * table-sort-button contract. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSortChange,
  numeric = false,
}: {
  label: string;
  sortKey: NonNullable<ExpenseTableFilters['sortBy']>;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  numeric?: boolean;
}) {
  const active = sort?.by === sortKey;
  return (
    <th
      scope="col"
      className={numeric ? 'num' : undefined}
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="table-sort-button" onClick={() => onSortChange(sortKey)}>
        {label}
        {active
          ? (sort!.dir === 'asc'
            ? <ArrowUp size={13} aria-hidden="true" />
            : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
      </button>
    </th>
  );
}

export default function ExpenseListPage() {
  const navigate = useNavigate();

  // Server-side pagination + filters. Search input lives in the hook contract
  // but the endpoint has no `search` param yet, so no search box is rendered
  // and the param is never sent.
  const table = useTableQueryState<ExpenseWithRefs, ExpenseTableFilters>({
    endpoint: (params) => {
      const qs = new URLSearchParams({
        page: String(params.page ?? 1),
        limit: String(params.limit ?? PAGE_SIZE),
      });
      if (params.supplierId) qs.set('supplierId', String(params.supplierId));
      if (params.categoryId) qs.set('categoryId', String(params.categoryId));
      if (params.truckId) qs.set('truckId', String(params.truckId));
      if (params.fromDate) qs.set('fromDate', params.fromDate);
      if (params.toDate) qs.set('toDate', params.toDate);
      if (params.sortBy) qs.set('sortBy', params.sortBy);
      if (params.sortDir) qs.set('sortDir', params.sortDir);
      return api.get<PaginatedResponse<ExpenseWithRefs>>(`${FINANCIAL.EXPENSES}?${qs}`);
    },
    queryKey: qk.financial.expensesAll,
    defaultPageSize: PAGE_SIZE,
  });
  const {
    filters, setFilter, setFilters, reset: resetFilters,
    page, setPage, pageSize,
    rows: expenses, total, totalPages,
    isLoading, error: queryError, query,
  } = table;
  const refetch = query.refetch;

  // Server-side column sort: state rides the filters bag (setFilters resets
  // the page automatically); the endpoint speaks sortBy/sortDir.
  const sort: TableSortState | null = filters.sortBy
    ? { by: filters.sortBy, dir: filters.sortDir ?? 'asc' }
    : null;
  const handleSort = (key: string) => {
    const next = nextTableSort(sort, key);
    setFilters({
      ...filters,
      sortBy: next.by as ExpenseTableFilters['sortBy'],
      sortDir: next.dir,
    });
  };

  const { rootRef } = usePageAnimations({ ready: !isLoading });

  const { data: catalogData } = useCatalogs();
  const trucks = catalogData?.trucks ?? [];

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

  const error = queryError ? 'Không thể tải dữ liệu' : null;

  useListAnimations({
    itemSelector: '.expense-record-table tbody tr',
    mode: 'rows',
    deps: [expenses, isLoading],
  });

  // Full-set headline numbers come from the list envelope's server summary
  // (page-independent, computed over the SAME filters). Page math remains
  // only as a fallback for envelopes that predate the summary field.
  const envelopeSummary = (query.data as (PaginatedResponse<ExpenseWithRefs> & {
    summary?: { totalAmount: number; paidAmount: number; unpaidAmount: number; paidCount: number; unpaidCount: number };
  }) | undefined)?.summary;
  const stats = useMemo(() => {
    if (envelopeSummary) return envelopeSummary;
    const items = expenses;
    const totalAmount = items.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    const unpaidItems = items.filter(e => e.paymentStatus === 'UNPAID');
    const paidItems = items.filter(e => e.paymentStatus === 'PAID');
    const unpaidAmount = unpaidItems.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    const paidAmount = paidItems.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    return { totalAmount, unpaidCount: unpaidItems.length, unpaidAmount, paidCount: paidItems.length, paidAmount };
  }, [envelopeSummary, expenses]);

  const hasFilters = Object.keys(filters).length > 0;
  const kpiTotal = splitKpi(stats.totalAmount);

  const renderStatusBadge = (status: string) => status === 'PAID' ? (
    <span className="expense-status expense-status--paid">
      <span className="expense-status__dot" /> Đã trả
    </span>
  ) : (
    <span className="expense-status expense-status--unpaid">
      <span className="expense-status__dot" /> Ghi nợ
    </span>
  );

  const renderEmptyState = () => (
    <EmptyState
      illustration="/assets/illustrations/empty-expenses.svg"
      title="Chưa có khoản chi phí nào."
      action={<button className="btn btn--primary" onClick={() => navigate('/expenses/new')}><Plus size={15} /> Thêm phiếu chi</button>}
    />
  );

  const renderLoadingState = () => (
    <div className="expense-loading">
      <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
      <p>Đang tải…</p>
    </div>
  );

  return (
    <div ref={rootRef} className="expense-list-page">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>

      <Breadcrumbs
        className="expense-list-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Chi phí phát sinh' },
        ]}
      />
      <PageHeader
        title="Chi phí phát sinh"
        iconName="expense"
        description={`${total} khoản chi phí`}
        action={
          <button className="btn btn--primary" onClick={() => navigate('/expenses/new')}>
            <Plus size={15} /> Thêm phiếu chi
          </button>
        }
      />

      {/* ── KPI Cards ────────────────────────────────────────────────── */}
      <div className="expense-kpi-grid">
        <div className="expense-kpi-card expense-kpi-card--total">
          <div className="expense-kpi-label">
            <span className="expense-kpi-label__icon">
              <AssetIcon name="cashflow" size={22} />
            </span>
            Tổng chi phí
          </div>
          <div className="expense-kpi-value">
            {kpiTotal.num}
            {kpiTotal.suffix && <span className="expense-kpi-value-unit">{kpiTotal.suffix} ₫</span>}
            {!kpiTotal.suffix && <span className="expense-kpi-value-unit">₫</span>}
          </div>
        </div>

        <div className="expense-kpi-card expense-kpi-card--unpaid">
          <div className="expense-kpi-label">
            <span className="expense-kpi-label__icon">
              <AssetIcon name="unpaid" size={22} />
            </span>
            Chưa thanh toán
          </div>
          <div className="expense-kpi-value">
            {stats.unpaidCount}
            <span className="expense-kpi-value-unit">phiếu</span>
          </div>
          <div className="expense-kpi-meta">{formatNumber(stats.unpaidAmount)}</div>
        </div>

        <div className="expense-kpi-card expense-kpi-card--paid">
          <div className="expense-kpi-label">
            <span className="expense-kpi-label__icon">
              <AssetIcon name="paid" size={22} />
            </span>
            Đã thanh toán
          </div>
          <div className="expense-kpi-value">
            {stats.paidCount}
            <span className="expense-kpi-value-unit">phiếu</span>
          </div>
          <div className="expense-kpi-meta">{formatNumber(stats.paidAmount)}</div>
        </div>
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────────── */}
      <div className="expense-filter-bar">
        <UuiSelectField
          id="expense-supplier-filter"
          label="Nhà cung cấp"
          inline
          value={filters.supplierId == null ? '' : String(filters.supplierId)}
          disabled={loadingExpenseCatalogs}
          onChange={e => setFilter('supplierId', e.target.value ? Number(e.target.value) : undefined)}
          controlClassName="expense-filter-bar__select"
          options={[
            { value: '', label: loadingExpenseCatalogs ? 'Đang tải NCC…' : 'Tất cả NCC' },
            ...suppliers.map(s => ({ value: String(s.id), label: s.name })),
          ]}
        />

        <UuiSelectField
          id="expense-category-filter"
          label="Hạng mục"
          inline
          value={filters.categoryId == null ? '' : String(filters.categoryId)}
          disabled={loadingExpenseCatalogs}
          onChange={e => setFilter('categoryId', e.target.value ? Number(e.target.value) : undefined)}
          controlClassName="expense-filter-bar__select"
          options={[
            { value: '', label: loadingExpenseCatalogs ? 'Đang tải hạng mục…' : 'Tất cả hạng mục' },
            ...categories.map(c => ({ value: String(c.id), label: c.name })),
          ]}
        />

        <UuiSelectField
          id="expense-truck-filter"
          label="Xe"
          inline
          value={filters.truckId == null ? '' : String(filters.truckId)}
          onChange={e => setFilter('truckId', e.target.value ? Number(e.target.value) : undefined)}
          controlClassName="expense-filter-bar__select"
          options={[
            { value: '', label: 'Tất cả xe' },
            ...trucks.map(t => ({ value: String(t.id), label: t.licensePlate })),
          ]}
        />

        <div className="expense-filter-bar__divider" />

        <DateInput
          name="expenseDateFrom"
          aria-label="Từ ngày"
          className="expense-filter-bar__date"
          value={filters.fromDate ?? ''}
          onChange={(value) => setFilter('fromDate', value || undefined)}
          placeholder="Từ ngày"
        />
        <DateInput
          name="expenseDateTo"
          aria-label="Đến ngày"
          className="expense-filter-bar__date"
          value={filters.toDate ?? ''}
          onChange={(value) => setFilter('toDate', value || undefined)}
          placeholder="Đến ngày"
        />

        {hasFilters && (
          <button className="expense-filter-bar__reset" onClick={resetFilters}>
            <X size={12} /> Xóa bộ lọc
          </button>
        )}
      </div>

      {error && (
        <Alert
          variant="error"
          style="soft"
          icon={<AlertTriangle size={16} />}
          className="mb-5"
          action={<button className="btn btn--secondary btn--sm" onClick={() => refetch()}>Thử lại</button>}
        >
          {error}
        </Alert>
      )}

      {/* Record table — shared base provides sticky thead, neutral gated
          hover and mobile record cards via container queries. */}
      <div className="record-table-wrap expense-record-table-wrap">
        <table className="record-table ops-table expense-record-table">
          <thead>
            <tr>
              <SortHeader label="Ngày phát sinh" sortKey="expenseDate" sort={sort} onSortChange={handleSort} />
              <SortHeader label="Nhà cung cấp" sortKey="supplierName" sort={sort} onSortChange={handleSort} />
              <SortHeader label="Hạng mục" sortKey="categoryName" sort={sort} onSortChange={handleSort} />
              <SortHeader label="Xe" sortKey="vehiclePlate" sort={sort} onSortChange={handleSort} />
              <SortHeader label="Thành phần" sortKey="vehicleComponent" sort={sort} onSortChange={handleSort} />
              <SortHeader label="Số tiền" sortKey="amount" sort={sort} onSortChange={handleSort} numeric />
              <SortHeader label="Trạng thái" sortKey="paymentStatus" sort={sort} onSortChange={handleSort} />
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} data-label="">{renderLoadingState()}</td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={8} data-label="">{renderEmptyState()}</td>
              </tr>
            ) : (
              expenses.map(e => (
                <tr key={e.id} role="button" tabIndex={0}
                  onClick={() => navigate(`/expenses/${e.id}/edit`)}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); navigate(`/expenses/${e.id}/edit`); } }}
                >
                  <td data-label="Ngày phát sinh" className="expense-record-table__date">
                    <StatusStrip color={EXPENSE_STATUS_COLORS[e.paymentStatus] ?? '#999'} />
                    {formatDate(e.expenseDate)}
                    {e.createdAt?.slice(0, 10) && e.createdAt.slice(0, 10) !== e.expenseDate.slice(0, 10) && (
                      <div className="expense-record-table__entry-date" title="Ngày nhập dữ liệu (khác ngày phát sinh = nhập luồng)">
                        nhập {formatDate(e.createdAt)}
                      </div>
                    )}
                  </td>
                  <td data-label="Nhà cung cấp" className="expense-record-table__supplier">{e.supplier?.name || '—'}</td>
                  <td data-label="Hạng mục" className="expense-record-table__muted">{e.category?.name || '—'}</td>
                  <td data-label="Xe">
                    {e.vehicleComponent === 'TRAILER'
                      ? (e.trailer?.licensePlate ? <span className="expense-plate">{e.trailer.licensePlate}</span> : <span className="expense-record-table__muted">—</span>)
                      : (e.truck?.licensePlate ? <span className="expense-plate">{e.truck.licensePlate}</span> : <span className="expense-record-table__muted">—</span>)
                    }
                  </td>
                  <td data-label="Thành phần" className="expense-record-table__muted">{e.vehicleComponent === 'TRAILER' ? 'Rơ-mooc' : e.vehicleComponent === 'TRUCK' ? 'Đầu kéo' : ''}</td>
                  <td data-label="Số tiền" className="num">
                    <Money
                      value={Number(e.amount)}
                      className={`expense-amount expense-amount--${e.paymentStatus === 'PAID' ? 'paid' : 'unpaid'}`}
                    />
                  </td>
                  <td data-label="Trạng thái">
                    {renderStatusBadge(e.paymentStatus)}
                  </td>
                  <td data-label="" className="record-table__action expense-record-table__action">
                    <ChevronRight size={14} className="expense-record-table__chevron" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={pageSize} onChange={setPage} disabled={isLoading} />
    </div>
  );
}
