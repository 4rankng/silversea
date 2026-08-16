import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronRight, AlertTriangle, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { configClient } from '../api/configClient';
import { formatCurrency, formatNumber, formatDate } from '../lib/format';
import { splitKpi } from '../features/dashboard/utils';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Alert } from '../components/shared/Alert';
import { AssetIcon } from '../components/AssetIcon';
import { EmptyState, Pagination, DateInput } from '../design-system';
import { ClickableCard } from '../components/shared/ClickableCard';
import { StatusStrip } from '../components/shared/StatusStrip';
import { useCatalogs } from '../hooks/useCatalogs';
import { useQuery } from '@tanstack/react-query';
import { usePageAnimations, useListAnimations } from '../hooks/animations';
import { FINANCIAL } from '@tingting/shared';
import type { ExpenseWithRefs, PaginatedResponse } from '@tingting/shared';
import { qk } from '../api/keys';
import { resolveExpenseCatalogs } from '../features/expenses/expenseCatalogs';
import type { ExpenseCatalogs } from '../features/expenses/expenseCatalogs';
import './ExpenseListPage.css';

const PAGE_SIZE = 20;

const EXPENSE_STATUS_COLORS: Record<string, string> = {
  PAID: '#059669',
  UNPAID: '#D97706',
};

// eslint-disable-next-line react-refresh/only-export-components -- page-scoped query hook co-located with its consumer page
export function useExpenses(params: {
  page: number;
  supplierId?: number;
  categoryId?: number;
  truckId?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  const qs = new URLSearchParams({
    page: String(params.page),
    pageSize: String(PAGE_SIZE),
  });
  if (params.supplierId) qs.set('supplierId', String(params.supplierId));
  if (params.categoryId) qs.set('categoryId', String(params.categoryId));
  if (params.truckId) qs.set('truckId', String(params.truckId));
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);

  return useQuery<PaginatedResponse<ExpenseWithRefs>>({
    queryKey: qk.financial.expenses(params),
    queryFn: () => api.get(`${FINANCIAL.EXPENSES}?${qs}`),
  });
}

export default function ExpenseListPage() {
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [truckId, setTruckId] = useState<number | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: expenseData, isLoading, error: queryError, refetch } = useExpenses({
    page,
    supplierId: supplierId || undefined,
    categoryId: categoryId || undefined,
    truckId: truckId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

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

  const expenses = expenseData?.items ?? [];
  const total = expenseData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const error = queryError ? 'Không thể tải dữ liệu' : null;

  useListAnimations({
    itemSelector: '.expense-table tbody tr',
    mode: 'rows',
    deps: [expenses, isLoading],
  });
  useListAnimations({
    itemSelector: '.m-card',
    mode: 'cards',
    deps: [expenses, isLoading],
  });

  const resetFilters = () => {
    setSupplierId('');
    setCategoryId('');
    setTruckId('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const stats = useMemo(() => {
    const items = expenseData?.items ?? [];
    const totalAmount = items.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    const unpaidItems = items.filter(e => e.paymentStatus === 'UNPAID');
    const paidItems = items.filter(e => e.paymentStatus === 'PAID');
    const unpaidAmount = unpaidItems.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    const paidAmount = paidItems.reduce((s, e) => s + parseFloat(String(e.amount)), 0);
    return { totalAmount, unpaidCount: unpaidItems.length, unpaidAmount, paidCount: paidItems.length, paidAmount };
  }, [expenseData]);

  const hasFilters = supplierId || categoryId || truckId || dateFrom || dateTo;
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
        <select
          className="expense-filter-bar__select"
          value={supplierId}
          disabled={loadingExpenseCatalogs}
          onChange={e => { setSupplierId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
        >
          <option value="">{loadingExpenseCatalogs ? 'Đang tải NCC…' : 'Tất cả NCC'}</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <select
          className="expense-filter-bar__select"
          value={categoryId}
          disabled={loadingExpenseCatalogs}
          onChange={e => { setCategoryId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
        >
          <option value="">{loadingExpenseCatalogs ? 'Đang tải hạng mục…' : 'Tất cả hạng mục'}</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          className="expense-filter-bar__select"
          value={truckId}
          onChange={e => { setTruckId(e.target.value ? Number(e.target.value) : ''); setPage(1); }}
        >
          <option value="">Tất cả xe</option>
          {trucks.map(t => (
            <option key={t.id} value={t.id}>{t.licensePlate}</option>
          ))}
        </select>

        <div className="expense-filter-bar__divider" />

        <DateInput
          name="expenseDateFrom"
          aria-label="Từ ngày"
          className="expense-filter-bar__date"
          value={dateFrom}
          onChange={(value) => { setDateFrom(value); setPage(1); }}
          placeholder="Từ ngày"
        />
        <DateInput
          name="expenseDateTo"
          aria-label="Đến ngày"
          className="expense-filter-bar__date"
          value={dateTo}
          onChange={(value) => { setDateTo(value); setPage(1); }}
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

      {/* Mobile card view */}
      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {isLoading ? (
            renderLoadingState()
          ) : expenses.length === 0 ? (
            renderEmptyState()
          ) : (
            expenses.map(e => (
              <ClickableCard
                key={e.id}
                to={`/expenses/${e.id}/edit`}
                className="m-card m-card--strip"
                style={{ cursor: 'pointer' }}
              >
                <StatusStrip color={EXPENSE_STATUS_COLORS[e.paymentStatus] ?? '#999'} />
                <div className="m-card__top">
                  <span className="m-card__title">
                    {(e.supplier?.name) || '—'}
                  </span>
                  {renderStatusBadge(e.paymentStatus)}
                </div>
                <div className="m-card__meta">
                  {formatDate(e.expenseDate)}
                  {e.createdAt?.slice(0, 10) && e.createdAt.slice(0, 10) !== e.expenseDate.slice(0, 10) && (
                    <><span className="m-card__meta-sep">·</span><span style={{ color: 'var(--ink-4)' }}>nhập {formatDate(e.createdAt)}</span></>
                  )}
                  {e.category && <><span className="m-card__meta-sep">·</span>{e.category.name}</>}
                </div>
                <div className="expense-mobile-card__summary">
                  <span className={`expense-amount expense-amount--${e.paymentStatus === 'PAID' ? 'paid' : 'unpaid'}`}>
                    {formatCurrency(e.amount)}
                  </span>
                  <span className="expense-mobile-card__vehicle">
                    {(e.truck || e.trailer) ? (
                      <span className="expense-plate">
                        {e.vehicleComponent === 'TRAILER'
                          ? (e.trailer?.licensePlate || '—')
                          : (e.truck?.licensePlate || '—')
                        }
                      </span>
                    ) : (
                      <span className="expense-mobile-card__muted">Không gắn xe</span>
                    )}
                    {e.vehicleComponent && (
                      <span className="expense-mobile-card__component">
                        {e.vehicleComponent === 'TRAILER' ? 'Rơ-mooc' : 'Đầu kéo'}
                      </span>
                    )}
                  </span>
                </div>
              </ClickableCard>
            ))
          )}
        </div>
      </div>

      {/* Desktop table */}
      <div className="desktop-only expense-table-wrap">
        <div className="expense-table-scroll">
          <table className="expense-table">
            <thead>
              <tr>
                <th>Ngày phát sinh</th>
                <th>Nhà cung cấp</th>
                <th>Hạng mục</th>
                <th>Xe</th>
                <th>Thành phần</th>
                <th className="num">Số tiền</th>
                <th>Trạng thái</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8}>{renderLoadingState()}</td>
                </tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={8}>{renderEmptyState()}</td>
                </tr>
              ) : (
                expenses.map(e => (
                  <tr key={e.id} role="button" tabIndex={0}
                    className="expense-row--strip"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/expenses/${e.id}/edit`)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                    onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); navigate(`/expenses/${e.id}/edit`); } }}
                  >
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--ink-2)', position: 'relative' }}>
                      <StatusStrip color={EXPENSE_STATUS_COLORS[e.paymentStatus] ?? '#999'} />
                      {formatDate(e.expenseDate)}
                      {e.createdAt?.slice(0, 10) && e.createdAt.slice(0, 10) !== e.expenseDate.slice(0, 10) && (
                        <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ink-4)' }} title="Ngày nhập dữ liệu (khác ngày phát sinh = nhập luồng)">
                          nhập {formatDate(e.createdAt)}
                        </div>
                      )}
                    </td>
                    <td style={{ fontWeight: 600 }}>{e.supplier?.name || '—'}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{e.category?.name || '—'}</td>
                    <td>
                      {e.vehicleComponent === 'TRAILER'
                        ? (e.trailer?.licensePlate ? <span className="expense-plate">{e.trailer.licensePlate}</span> : <span style={{ color: 'var(--ink-4)' }}>—</span>)
                        : (e.truck?.licensePlate ? <span className="expense-plate">{e.truck.licensePlate}</span> : <span style={{ color: 'var(--ink-4)' }}>—</span>)
                      }
                    </td>
                    <td style={{ color: 'var(--ink-2)' }}>{e.vehicleComponent === 'TRAILER' ? 'Rơ-mooc' : e.vehicleComponent === 'TRUCK' ? 'Đầu kéo' : ''}</td>
                    <td className={`num expense-amount expense-amount--${e.paymentStatus === 'PAID' ? 'paid' : 'unpaid'}`}>
                      {formatCurrency(e.amount)}
                    </td>
                    <td>
                      {renderStatusBadge(e.paymentStatus)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <ChevronRight size={14} style={{ color: 'var(--ink-4)' }} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={PAGE_SIZE} onChange={setPage} disabled={isLoading} />
      </div>
    </div>
  );
}
