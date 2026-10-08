import { AgingDisclosure } from '../components/finance/AgingDisclosure';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency, moneyParts } from '../lib/format';
import { api } from '../lib/api';
import { useToast } from '../components/shared/Toast';
import { toastActionError } from '../lib/api/action-error';
import { SortHeader } from '../components/shared/SortHeader';
import {
  Users,
  Clock,
  CalendarCheck2,
  Hourglass,
  AlertOctagon,
  Building2,
  Phone,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '../components/UI';
import { FilterBar, Pagination, SummaryRail } from '../design-system';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Badge } from '../components/shared/Badge';
import type { CustomerAging } from '../hooks/useQueries';
import { financialClient, type CustomerAgingResponse } from '../api/financialClient';
import { qk } from '../api/keys';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import {
  usePageAnimations,
  useListAnimations,
  useCounterAnimation,
} from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { PartyMonthlyProductionSummary } from '../features/accounting/PartyMonthlyProductionSummary';
import './DebtListPage.css';
import '../styles/table-sort.css';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import { EmptyState } from '../design-system';

interface CustomerDebtInfo {
  customerId: number;
  customerName: string;
  contactInfo: string | null;
  linkedSupplierId: number | null;
  linkedSupplierApBalance: number;
  netBalance: number;
  totalOutstanding: number;
  aging: {
    current: number;
    d30: number;
    d60: number;
    over90: number;
  };
  maxOverdueDays: number;
  riskClass: 'high' | 'med' | 'low';
}

function classifyRisk(totalOutstanding: number, aging: CustomerAging['aging'], _maxOverdueDays: number): 'high' | 'med' | 'low' {
  if (totalOutstanding <= 0) return 'low';
  if (aging.over90 > 0 || totalOutstanding > 100_000_000) return 'high';
  if (aging.d30 > 0 || aging.d60 > 0) return 'med';
  return 'low';
}

/* ─── Aging bucket config ────────────────────────────────────────────────── */

interface AgingBucket {
  key: string;
  label: string;
  /** Semantic state shown as the primary heading on the lane card. */
  shortLabel: string;
  /** Subhead (day range) — secondary, smaller. */
  subLabel: string;
  amountKey: 'current' | 'd30' | 'd60' | 'over90';
  countKey: 'currentCusts' | 'd30Custs' | 'd60Custs' | 'over90Custs';
  dotClass: string;
  color: string;
  /** Each bucket owns its own filter — never grouped. */
  filterMode: BucketFilterMode;
}

/**
 * One filter mode per bucket. The four aging buckets must filter independently
 * so clicking "Quá hạn 1–30" shows only customers in that band, etc.
 * `'all'` is the unfiltered default. `'overdue'` has no lane card — it is the
 * cross-bucket "any overdue portion" aggregate the overview cards deep-link
 * to (?filter=overdue).
 */
type BucketFilterMode = 'all' | 'current' | 'd30' | 'd60' | 'over90' | 'overdue';

const AGING_BUCKETS: AgingBucket[] = [
  // Card 061026221213: the four bands are CONTRACTUAL due-status lanes (days
  // past the effective due date, cut at 30/90 — see computeFifoAging) — "Trong
  // hạn" / "Quá hạn 1–30" / "Quá hạn 31–90" / "Quá hạn trên 90", so every
  // "Trong hạn"/"Quá hạn" word on the page means the same thing as the row
  // chip and the KPI tiles. (P0-W6's lane intent, now truthful about bands.)
  { key: 'current', label: 'Trong hạn (chưa đến hạn)', shortLabel: 'Trong hạn', subLabel: 'chưa đến hạn', amountKey: 'current', countKey: 'currentCusts', dotClass: 'debt-aging__dot--ok', color: 'var(--success, #177448)', filterMode: 'current' },
  { key: 'd30', label: 'Quá hạn 1–30', shortLabel: 'Quá hạn', subLabel: '1–30 ngày', amountKey: 'd30', countKey: 'd30Custs', dotClass: 'debt-aging__dot--warn', color: 'var(--warning, #F5A623)', filterMode: 'd30' },
  { key: 'd60', label: 'Quá hạn 31–90', shortLabel: 'Quá hạn', subLabel: '31–90 ngày', amountKey: 'd60', countKey: 'd60Custs', dotClass: 'debt-aging__dot--deep', color: 'var(--warning-deep, #DD5A1F)', filterMode: 'd60' },
  { key: 'over90', label: 'Quá hạn trên 90', shortLabel: 'Quá hạn', subLabel: 'trên 90 ngày', amountKey: 'over90', countKey: 'over90Custs', dotClass: 'debt-aging__dot--danger', color: 'var(--danger, #E32434)', filterMode: 'over90' },
];

/* Map bucket → lucide icon (semantic progression: on-time → critical) */
const BUCKET_ICONS: Record<string, typeof CalendarCheck2> = {
  current: CalendarCheck2,
  d30: Clock,
  d60: Hourglass,
  over90: AlertOctagon,
};

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function DebtListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Bucket filter can arrive via ?filter= (aging-card and overview due-group
  // deep links; `overdue` = any overdue portion).
  const urlBucket = searchParams.get('filter') === 'current' ? 'current'
    : searchParams.get('filter') === 'd30' ? 'd30'
    : searchParams.get('filter') === 'd60' ? 'd60'
    : searchParams.get('filter') === 'over90' ? 'over90'
    : searchParams.get('filter') === 'overdue' ? 'overdue'
    : undefined;
  // Server-side pagination + bucket filter + debounced search + column sort;
  // totals are full-set. Search input, page-reset-on-filter and caching live in
  // the hook. `?asOf=` (from the accounting overview due-group deep links)
  // pins the aging snapshot date so the list matches the clicked counts.
  const urlAsOf = searchParams.get('asOf') ?? undefined;
  const table = useTableQueryState<
    CustomerAging,
    { bucket?: 'current' | 'd30' | 'd60' | 'over90' | 'overdue'; asOfDate?: string; sortBy?: string; sortDir?: 'asc' | 'desc' },
    CustomerAgingResponse & { items: CustomerAging[] }
  >({
    endpoint: async (params) => {
      const response = await financialClient.getCustomerAging(params);
      return { ...response, items: response.customers };
    },
    queryKey: qk.financial.customerAgingAll,
    defaultPageSize: 25,
    initialFilters: urlBucket || urlAsOf ? { bucket: urlBucket, asOfDate: urlAsOf } : {},
  });
  const { search: searchInput, setSearch: setSearchInput, page, setPage, query } = table;
  const filterMode: BucketFilterMode = (table.filters.bucket as BucketFilterMode | undefined) ?? 'all';
  // Card 061026172807: inside a bucket view each row carries its SHARE of that
  // bucket (the same value the bucket card sums), so the drill-down rows sum to
  // the card amount — the card sums band shares while the rows previously
  // displayed total outstanding, and the two disagreed on every mixed row.
  const activeBucket = AGING_BUCKETS.find((bucket) => bucket.filterMode === filterMode) ?? null;
  const isOverdueAggregate = filterMode === 'overdue';
  const bucketShareOf = (d: { aging: { current: number; d30: number; d60: number; over90: number } }) =>
    filterMode === 'current' ? d.aging.current
      : filterMode === 'd30' ? d.aging.d30
        : filterMode === 'd60' ? d.aging.d60
          : filterMode === 'over90' ? d.aging.over90
            : isOverdueAggregate ? d.aging.d30 + d.aging.d60 + d.aging.over90
              : 0;
  const bucketShareLabel = activeBucket
    ? `Nợ ${activeBucket.subLabel}`
    : isOverdueAggregate ? 'Nợ quá hạn' : null;
  // Sort rides in the hook's filters bag: setFilter resets the page to 1 and
  // the queryKey stays keyed on the primitive param values (no refetch loops).
  const sortState: TableSortState | null = table.filters.sortBy != null && table.filters.sortDir != null
    ? { by: table.filters.sortBy, dir: table.filters.sortDir }
    : null;
  const handleSortChange = (key: string) => {
    const next = nextTableSort(sortState, key);
    table.setFilter('sortBy', next.by);
    table.setFilter('sortDir', next.dir);
  };
  const data = query.data;
  const loading = table.isLoading;
  const queryError = query.error;
  const { toast: showToast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const q = searchInput.trim() ? `?search=${encodeURIComponent(searchInput.trim())}` : '';
      const blob = await api.getBlob(`/reports/receivables-aging/export${q}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cong-no-phai-thu-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      // Card 081026230550: the export stayed silent on success — every export
      // button confirms like /finance and /fleet/productivity do.
      showToast({ kind: 'success', message: 'Đã xuất báo cáo công nợ phải thu ra tệp Excel.' });
    } catch (err) {
      toastActionError(showToast, 'xuất báo cáo', err, 'Lỗi xuất báo cáo');
    } finally {
      setExporting(false);
    }
  };
  const rawCustomers = useMemo(() => data?.customers ?? [], [data?.customers]);
  const totalCustomers = data?.total ?? rawCustomers.length;
  const error = queryError ? (queryError as Error).message : null;

  /* ── Animation hooks ── */
  const prefersReduced = usePrefersReducedMotion();
  const compact = false; // full VND everywhere — no short form (e.g. "12,5 tr")
  const { rootRef } = usePageAnimations({
    ready: !loading,
    selectors: ['.debt-aging-card', '.debt-data-card'],
  });
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 300, stagger: 80 });

  /* ── Counter refs ── */
  const counterRefs = useRef<{
    currentAmount: HTMLSpanElement | null;
    d30Amount: HTMLSpanElement | null;
    d60Amount: HTMLSpanElement | null;
    over90Amount: HTMLSpanElement | null;
  }>({
    currentAmount: null,
    d30Amount: null,
    d60Amount: null,
    over90Amount: null,
  });

  /* ── Data processing (preserved exactly) ── */
  const customerDebts = useMemo<CustomerDebtInfo[]>(() => {
    return rawCustomers.map(c => {
      return {
      customerId: c.customerId,
      customerName: c.customerName,
      contactInfo: c.contactInfo,
      linkedSupplierId: c.linkedSupplierId ?? null,
      linkedSupplierApBalance: c.linkedSupplierApBalance,
      netBalance: c.netBalance,
      totalOutstanding: c.totalOutstanding,
      aging: c.aging,
      maxOverdueDays: c.maxOverdueDays,
      riskClass: classifyRisk(c.totalOutstanding, c.aging, c.maxOverdueDays),
      };
    });
  }, [rawCustomers]);

  // Full-set totals arrive server-computed (page-independent), so the KPI strip
  // stays stable while paging or narrowing to one aging bucket.
  const totals = useMemo(() => data?.totals ?? {
    total: 0, current: 0, d30: 0, d60: 0, over90: 0,
    currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
    overdueCount: 0, highRiskCount: 0,
  }, [data?.totals]);

  // Bucket + page + search filtering happen server-side; the rows below render
  // the current window only.
  const debts = customerDebts;
  const totalDebtPages = data?.totalPages ?? 1;
  const effectivePage = Math.min(page, totalDebtPages);
  const { rootRef: listRef } = useListAnimations({ itemSelector: '.m-card, table tbody tr', deps: [debts] });

  /* ── Counter animation trigger ── */
  useEffect(() => {
    if (loading || prefersReduced) return;

    const r = counterRefs.current;
    animateCounters([
      { el: r.currentAmount, value: totals.current, format: moneyParts(totals.current, compact).format },
      { el: r.d30Amount, value: totals.d30, format: moneyParts(totals.d30, compact).format },
      { el: r.d60Amount, value: totals.d60, format: moneyParts(totals.d60, compact).format },
      { el: r.over90Amount, value: totals.over90, format: moneyParts(totals.over90, compact).format },
    ]);
  }, [loading, totals, prefersReduced, animateCounters, compact]);

  /* ── Helpers ── */
  const heroMoney = moneyParts(totals.total, false);

  const handleBucketClick = (bucket: AgingBucket) => {
    table.setFilter('bucket', bucket.filterMode === 'all' ? undefined : bucket.filterMode);
  };

  return (
    <div ref={rootRef} className="debt-list-page">
      <Breadcrumbs
        className="debt-list-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Công nợ phải thu' },
        ]}
        renderLink={(to, children) => (
          <a onClick={() => navigate(to)} style={{ cursor: 'pointer' }}>{children}</a>
        )}
      />
      <PageHeader
        title="Công nợ phải thu"
        description={`${totalCustomers} khách hàng · cập nhật vừa xong`}
        iconName="receivables"
        action={
          <div className="page-actions">
            <button 
              className="btn btn--secondary btn--sm" 
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Đang xuất...' : (
                <>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Xuất báo cáo
                </>
              )}
            </button>
          </div>
        }
      />

      {/* ══════════════════════════════════════════════════════════════════════
        *  ZONE 1 — Summary rail: one ruled row the accountant can scan
        *  ("Tổng 360tr · 80 KH · 0 quá hạn · 0 rủi ro cao") before the lanes.
        * ══════════════════════════════════════════════════════════════════════ */}
      <SummaryRail
        ariaLabel="Tóm tắt công nợ phải thu"
        items={[
          { label: 'Tổng công nợ phải thu', value: `${heroMoney.num} ${heroMoney.unit}` },
          { label: 'Khách hàng', value: totalCustomers },
          { label: 'Quá hạn', value: totals.overdueCount, tone: totals.overdueCount > 0 ? 'warning' : undefined },
          { label: 'Rủi ro cao', value: totals.highRiskCount, tone: totals.highRiskCount > 0 ? 'warning' : undefined },
        ]}
      />

      <AgingDisclosure label="Nhóm hạn nợ khách hàng · mở chi tiết">
      <div className="debt-aging-grid" data-tour-id="debt-aging">
        {AGING_BUCKETS.map((bucket) => {
          const amount = totals[bucket.amountKey];
          const count = totals[bucket.countKey];
          const money = moneyParts(amount, compact);
          const isActive = filterMode === bucket.filterMode;
          const BucketIcon = BUCKET_ICONS[bucket.key];

          return (
            <button
              key={bucket.key}
              type="button"
              className={`debt-aging-card${isActive ? ' is-active' : ''}`}
              onClick={() => handleBucketClick(bucket)}
              style={{ '--bucket-color': bucket.color } as React.CSSProperties}
              aria-label={`${bucket.label}: ${formatCurrency(amount)}, ${count} khách hàng`}
            >
              <div className="debt-aging-card__header">
                {BucketIcon && (
                  <BucketIcon
                    size={16}
                    strokeWidth={2}
                    aria-hidden="true"
                    style={{ color: bucket.color, flex: '0 0 auto' }}
                  />
                )}
                <span className={`debt-aging__dot ${bucket.dotClass}`} />
                <span className="debt-aging-card__label">
                  <strong>{bucket.shortLabel}</strong>
                  <small>{bucket.subLabel}</small>
                </span>
              </div>
              <div className="debt-aging-card__amount">
                <span ref={(el) => {
                  if (bucket.amountKey === 'current') counterRefs.current.currentAmount = el;
                  else if (bucket.amountKey === 'd30') counterRefs.current.d30Amount = el;
                  else if (bucket.amountKey === 'd60') counterRefs.current.d60Amount = el;
                  else if (bucket.amountKey === 'over90') counterRefs.current.over90Amount = el;
                }}>
                  {prefersReduced ? money.num : '0'}
                </span>
                <span className="debt-aging-card__unit">{money.unit}</span>
              </div>
              <div className="debt-aging-card__count">{count} khách hàng</div>
            </button>
          );
        })}
      </div>
      </AgingDisclosure>

      {/* ══════════════════════════════════════════════════════════════════════
        *  ZONE 3 — Data Section (full-width card with filters + table/cards)
        * ══════════════════════════════════════════════════════════════════════ */}
      <div className="debt-data-card" data-tour-id="debt-customer-list">
        {/* Card 20260927_152 — the shared bar owns the strip's layout, the
            search chrome and every control width; this surface has no secondary
            criterion, so the one status chip rides the quick-filter slot.
            Cross-bucket "Quá hạn" / "Rủi ro cao" pills stay removed: per-bucket
            filtering lives on the aging cards above, and mixing the two models
            grouped d30+d60 against an amount-based criterion. */}
        <FilterBar
          search={{
            value: searchInput,
            onChange: setSearchInput,
            placeholder: 'Tìm khách hàng...',
            ariaLabel: 'Tìm công nợ theo khách hàng',
            inputProps: { name: 'customerDebtSearch' },
          }}
          quickFilters={(
            <button
              type="button"
              className={`filter-chip${filterMode === 'all' ? ' is-active' : ''}`}
              onClick={() => table.setFilter('bucket', undefined)}
            >
              <Users size={14} />
              <span>Tất cả</span>
              <span className="filter-chip__count">{customerDebts.length}</span>
            </button>
          )}
        />

        {error && (
          <div style={{ padding: 16, color: 'var(--danger)', marginBottom: 20 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="debt-loading">
            <Loader2 size={28} className="debt-loading__spin" aria-hidden="true" />
            <span>Đang tải dữ liệu công nợ…</span>
          </div>
        ) : (
          <>
            {/* ── Mobile card list (<=640px) ── */}
            <div className="mobile-only mobile-table-wrap" ref={listRef}>
              <div className="m-card-list">
                {debts.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <EmptyState variant="compact" context="debts" title="Không tìm thấy dữ liệu." />
                  </div>
                ) : (
                  debts.map(d => {
                    return (
                      <ClickableCard key={d.customerId} to={`/debt/${d.customerId}`} className="m-card">
                        <div className="m-card__top">
                          <span className="m-card__title">
                            <span className={`risk-dot risk-dot--${d.riskClass}`} />
                            <Building2 size={15} aria-hidden="true" style={{ color: 'var(--ink-3)', flex: '0 0 auto' }} />
                            {d.customerName}
                            {d.linkedSupplierId != null && (
                              <Badge variant="success" style={{ marginLeft: 6 }}>2 chiều</Badge>
                            )}
                          </span>
                          <span className={`m-card__row-value${d.totalOutstanding > 0 ? '--warning' : '--success'} m-card__row-value debt-list-page__amount`}>
                            {formatCurrency(d.totalOutstanding)}
                          </span>
                        </div>
                        {bucketShareLabel && (
                          <div className="m-card__row">
                            <span className="m-card__row-label">{bucketShareLabel}</span>
                            <span className="m-card__row-value" style={{ color: 'var(--warning-text)' }}>{formatCurrency(bucketShareOf(d))}</span>
                          </div>
                        )}
                        {d.totalOutstanding > 0 && (
                          <>
                            {d.contactInfo && (
                              <div className="m-card__meta">
                                <Phone size={12} aria-hidden="true" style={{ marginRight: 5, verticalAlign: '-1px', color: 'var(--ink-3)' }} />
                                {d.contactInfo}
                              </div>
                            )}
                            {d.maxOverdueDays > 0 && (
                              <div className="m-card__row">
                                <span className="m-card__row-label">
                                  <Clock size={12} aria-hidden="true" style={{ marginRight: 5, verticalAlign: '-1px' }} />
                                  Quá hạn
                                </span>
                                <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: d.maxOverdueDays > 60 ? 'var(--danger)' : 'var(--warning)' }}>
                                  {d.maxOverdueDays} ngày
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </ClickableCard>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Desktop table (>640px) — record-table base owns the thead
                  skin, neutral gated hover and the card collapse. ── */}
            <div className="desktop-only">
              <div className="record-table-wrap">
                <table className="record-table ops-table debt-list-table">
                    <thead>
                      <tr>
                        <SortHeader label="Khách hàng" sortKey="customerName" sort={sortState} onSortChange={handleSortChange} />
                        {bucketShareLabel && <th className="num">{bucketShareLabel}</th>}
                        <SortHeader label="Tổng nợ" sortKey="totalOutstanding" sort={sortState} onSortChange={handleSortChange} className="num" />
                        <SortHeader label="Net công nợ" sortKey="netBalance" sort={sortState} onSortChange={handleSortChange} className="num" />
                        <SortHeader label="Quá hạn" sortKey="maxOverdueDays" sort={sortState} onSortChange={handleSortChange} className="num" style={{ textAlign: 'center' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {debts.map(d => {
                        return (
                          <tr
                            key={d.customerId}
                            role="button"
                            tabIndex={0}
                            style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/debt/${d.customerId}`)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                navigate(`/debt/${d.customerId}`);
                              }
                            }}
                          >
                          <td data-label="Khách hàng" className="debt-list-table__customer">
                            <div className="debt-list-table__customer-main">
                              <span className={`risk-dot risk-dot--${d.riskClass}`} />
                              <Building2 size={14} aria-hidden="true" style={{ color: 'var(--fg-3)', flex: '0 0 auto' }} />
                              <span className="debt-list-table__customer-name">{d.customerName}</span>
                              {d.linkedSupplierId != null && (
                                <Badge variant="success">2 chiều</Badge>
                              )}
                            </div>
                            <div style={{ fontSize: 'var(--text-caption-size)', lineHeight: 1.35, color: 'var(--fg-3)', marginLeft: 16 }}>
                              {d.totalOutstanding > 0
                                ? (d.maxOverdueDays > 0 ? "Nợ quá hạn" : "Trong hạn")
                                : (d.totalOutstanding < 0 ? "Trả trước" : "Cân bằng")}
                            </div>
                          </td>

                          {bucketShareLabel && (
                            <td data-label={bucketShareLabel} className="num typo-mono" style={{ color: 'var(--warning-text)' }}>
                              {formatCurrency(bucketShareOf(d))}
                            </td>
                          )}

                          <td data-label="Tổng nợ" className="num typo-mono" style={{
                            fontWeight: 700,
                            color: d.totalOutstanding > 0 ? 'var(--warning-text)' : 'var(--success)'
                          }}>
                            {formatCurrency(d.totalOutstanding)}
                          </td>

                          {/* Card 071026211110: the backend always computes netBalance
                            (aging.service.ts:685 — the linked supplier's AP balance is 0 when
                            none is linked, so net === outstanding), and this page's own export
                            writes that number for every row (statement-customer.service.ts:483).
                            Rendering an em dash here made the screen and its own export disagree
                            about the same customer, and hid the overdue balances this page
                            exists to show. The muted colour still marks "no linked supplier";
                            only the digit is no longer swallowed. */}
                          <td data-label="Net công nợ" className="num typo-mono" style={{
                            fontWeight: 600,
                            color: d.linkedSupplierId == null
                              ? 'var(--fg-3)'
                              : (d.netBalance > 0 ? 'var(--warning-text)' : d.netBalance < 0 ? 'var(--success)' : 'var(--fg-3)')
                          }}>
                            {formatCurrency(d.netBalance)}
                          </td>

                          <td data-label="Quá hạn" className="num" style={{ textAlign: 'center', fontWeight: 600 }}>
                            {d.maxOverdueDays > 0 ? (
                              <span style={{ color: d.maxOverdueDays > 60 ? 'var(--danger)' : 'var(--warning)' }}>
                                {d.maxOverdueDays} ngày
                              </span>
                            ) : (
                              <span style={{ color: 'var(--fg-3)' }}>&mdash;</span>
                            )}
                          </td>

                        </tr>
                      );
                    })}

                    {debts.length === 0 && (
                      <tr>
                        <td colSpan={4} data-label="" style={{ textAlign: 'center', padding: '24px 40px', color: 'var(--fg-3)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                            <EmptyState variant="compact" context="debts" title="Không tìm thấy dữ liệu công nợ thỏa mãn bộ lọc." />
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={effectivePage} totalPages={totalDebtPages} totalItems={data?.total ?? 0} pageSize={data?.limit ?? 25} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
        *  ZONE 4 — Card 380: monthly transport production summary. The ledger
        *  table above stays primary; this band reuses the page's own card skin
        *  and its còn-nợ column reconciles with the table's Tổng nợ (same
        *  ledger endpoint — pinned by the summary's component tests).
        * ══════════════════════════════════════════════════════════════════════ */}
      <PartyMonthlyProductionSummary variant="receivable" className="debt-data-card" />
    </div>
  );
}
