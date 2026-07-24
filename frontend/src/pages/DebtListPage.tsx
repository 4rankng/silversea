import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatCurrency, moneyParts } from '../lib/format';
import { api } from '../lib/api';
import { useToast } from '../components/shared/Toast';
import {
  Search,
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
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { ClickableCard } from '../components/shared/ClickableCard';
import { useCustomerAging } from '../hooks/useQueries';
import type { CustomerAging } from '../hooks/useQueries';
import {
  usePageAnimations,
  useListAnimations,
  useCounterAnimation,
} from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { AssetIcon } from '../components/AssetIcon';
import './DebtListPage.css';
import '../components/shared/HeroKpiRow.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';

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
  amountKey: 'current' | 'd30' | 'd60' | 'over90';
  countKey: 'currentCusts' | 'd30Custs' | 'd60Custs' | 'over90Custs';
  dotClass: string;
  color: string;
  /** Each bucket owns its own filter — never grouped. */
  filterMode: BucketFilterMode;
}

/**
 * One filter mode per bucket. The four aging buckets must filter independently
 * so clicking "31–60 ngày" shows only customers in that bucket, etc.
 * `'all'` is the unfiltered default.
 */
type BucketFilterMode = 'all' | 'current' | 'd30' | 'd60' | 'over90';

const AGING_BUCKETS: AgingBucket[] = [
  { key: 'current', label: '0–30 NGÀY', amountKey: 'current', countKey: 'currentCusts', dotClass: 'debt-aging__dot--ok', color: '#00B14F', filterMode: 'current' },
  { key: 'd30', label: '31–60 NGÀY', amountKey: 'd30', countKey: 'd30Custs', dotClass: 'debt-aging__dot--warn', color: '#F5A623', filterMode: 'd30' },
  { key: 'd60', label: '61–90 NGÀY', amountKey: 'd60', countKey: 'd60Custs', dotClass: 'debt-aging__dot--deep', color: '#DD5A1F', filterMode: 'd60' },
  { key: 'over90', label: 'TRÊN 90 NGÀY', amountKey: 'over90', countKey: 'over90Custs', dotClass: 'debt-aging__dot--danger', color: '#E32434', filterMode: 'over90' },
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
  const [search, setSearch] = useState('');
  const { data, isLoading: loading, error: queryError } = useCustomerAging(search);
  const { toast: showToast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const blob = await api.getBlob(`/reports/receivables-aging/export${q}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cong-no-phai-thu-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast({ kind: 'error', message: (err as Error).message || 'Lỗi xuất báo cáo' });
    } finally {
      setExporting(false);
    }
  };
  const rawCustomers = useMemo(() => data?.customers ?? [], [data?.customers]);
  const totalCustomers = data?.total ?? rawCustomers.length;
  const error = queryError ? (queryError as Error).message : null;
  const [filterMode, setFilterMode] = useState<BucketFilterMode>(
    searchParams.get('filter') === 'current' ? 'current'
      : searchParams.get('filter') === 'd30' ? 'd30'
      : searchParams.get('filter') === 'd60' ? 'd60'
      : searchParams.get('filter') === 'over90' ? 'over90'
      : 'all',
  );

  /* ── Animation hooks ── */
  const prefersReduced = usePrefersReducedMotion();
  const compact = false; // full VND everywhere — no short form (e.g. "12,5 tr")
  const { rootRef } = usePageAnimations({
    ready: !loading,
    selectors: ['.hero-kpi-card', '.hero-kpi-mini', '.debt-aging-card', '.debt-data-card'],
  });
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 300, stagger: 80 });

  /* ── Counter refs ── */
  const counterRefs = useRef<{
    heroTotal: HTMLSpanElement | null;
    overdueCount: HTMLSpanElement | null;
    highRiskCount: HTMLSpanElement | null;
    currentAmount: HTMLSpanElement | null;
    d30Amount: HTMLSpanElement | null;
    d60Amount: HTMLSpanElement | null;
    over90Amount: HTMLSpanElement | null;
  }>({
    heroTotal: null,
    overdueCount: null,
    highRiskCount: null,
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

  const totals = useMemo(() => {
    const sum = {
      total: 0,
      current: 0,
      d30: 0,
      d60: 0,
      over90: 0,
      currentCusts: 0,
      d30Custs: 0,
      d60Custs: 0,
      over90Custs: 0,
      overdueCount: 0,
      highRiskCount: 0,
    };

    customerDebts.forEach(d => {
      if (d.totalOutstanding > 0) {
        sum.total += d.totalOutstanding;
        if (d.aging.current > 0) { sum.current += d.aging.current; sum.currentCusts++; }
        if (d.aging.d30 > 0) { sum.d30 += d.aging.d30; sum.d30Custs++; }
        if (d.aging.d60 > 0) { sum.d60 += d.aging.d60; sum.d60Custs++; }
        if (d.aging.over90 > 0) { sum.over90 += d.aging.over90; sum.over90Custs++; }
        if (d.maxOverdueDays > 30) { sum.overdueCount++; }
        if (d.riskClass === 'high') { sum.highRiskCount++; }
      }
    });

    return sum;
  }, [customerDebts]);

  const filteredDebts = useMemo(() => {
    let result = customerDebts;
    if (filterMode === 'current') {
      // 0–30 ngày — on-time/current balance (no overdue amount, but has outstanding).
      result = result.filter(d => d.aging.current > 0 && d.totalOutstanding > 0);
    } else if (filterMode === 'd30') {
      // 31–60 ngày — has balance in the d30 aging bucket specifically.
      result = result.filter(d => d.aging.d30 > 0 && d.totalOutstanding > 0);
    } else if (filterMode === 'd60') {
      // 61–90 ngày — has balance in the d60 aging bucket specifically.
      result = result.filter(d => d.aging.d60 > 0 && d.totalOutstanding > 0);
    } else if (filterMode === 'over90') {
      // Trên 90 ngày — has balance in the over90 aging bucket specifically.
      result = result.filter(d => d.aging.over90 > 0 && d.totalOutstanding > 0);
    }
    return result;
  }, [customerDebts, filterMode]);

  const { rootRef: listRef } = useListAnimations({ itemSelector: '.m-card, table tbody tr', deps: [filteredDebts] });

  /* ── Counter animation trigger ── */
  useEffect(() => {
    if (loading || prefersReduced) return;

    const r = counterRefs.current;
    animateCounters([
      { el: r.heroTotal, value: totals.total, format: moneyParts(totals.total, false).format },
      { el: r.overdueCount, value: totals.overdueCount, suffix: '' },
      { el: r.highRiskCount, value: totals.highRiskCount, suffix: '' },
      { el: r.currentAmount, value: totals.current, format: moneyParts(totals.current, compact).format },
      { el: r.d30Amount, value: totals.d30, format: moneyParts(totals.d30, compact).format },
      { el: r.d60Amount, value: totals.d60, format: moneyParts(totals.d60, compact).format },
      { el: r.over90Amount, value: totals.over90, format: moneyParts(totals.over90, compact).format },
    ]);
  }, [loading, totals, prefersReduced, animateCounters, compact]);

  /* ── Helpers ── */
  const heroMoney = moneyParts(totals.total, false);

  const handleBucketClick = (bucket: AgingBucket) => {
    setFilterMode(bucket.filterMode);
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
        *  ZONE 1 — Hero KPI Row (bento: 3-col hero + 1-col stacked minis)
        * ══════════════════════════════════════════════════════════════════════ */}
      <div className="hero-kpi-row debt-hero-row">
        {/* Hero card — spans 3 columns */}
        <div className="hero-kpi-card debt-hero">
          <div className="debt-hero__content">
            <span className="hero-kpi-card__eyebrow">
              Tổng công nợ phải thu
            </span>
            <div className="hero-kpi-card__amount debt-hero__amount">
              <span ref={(el) => { counterRefs.current.heroTotal = el; }}>
                {prefersReduced ? heroMoney.num : '0'}
              </span>
              <span className="debt-hero__currency">{heroMoney.unit}</span>
            </div>
            <span className="hero-kpi-card__subtitle">
              {totalCustomers} khách hàng · cập nhật vừa xong
            </span>
          </div>
          <div className="debt-hero__art" aria-hidden="true">
            <img
              src={resolveEmptyIllustration('finance')}
              alt=""
              className="debt-hero__illustration"
              draggable={false}
            />
          </div>
        </div>

        {/* Stacked mini-KPI cards — span 1 column */}
        <div className="hero-kpi-stack debt-kpi-stack">
          <div className="hero-kpi-mini debt-kpi-mini--danger">
            <div className="hero-kpi-mini__body">
              <span className="hero-kpi-mini__value">
                <span ref={(el) => { counterRefs.current.overdueCount = el; }}>
                  {prefersReduced ? totals.overdueCount : 0}
                </span>
              </span>
              <span className="hero-kpi-mini__label">quá hạn</span>
            </div>
            <div className="hero-kpi-mini__watermark debt-kpi-mini__asset" aria-hidden="true">
              <AssetIcon name="overdue" size={38} />
            </div>
          </div>
          <div className="hero-kpi-mini debt-kpi-mini--warning">
            <div className="hero-kpi-mini__body">
              <span className="hero-kpi-mini__value">
                <span ref={(el) => { counterRefs.current.highRiskCount = el; }}>
                  {prefersReduced ? totals.highRiskCount : 0}
                </span>
              </span>
              <span className="hero-kpi-mini__label">rủi ro cao</span>
            </div>
            <div className="hero-kpi-mini__watermark debt-kpi-mini__asset" aria-hidden="true">
              <AssetIcon name="alert" size={38} />
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
        *  ZONE 2 — Aging Distribution (4 equal glass cards)
        * ══════════════════════════════════════════════════════════════════════ */}
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
                <span className="debt-aging-card__label">{bucket.label}</span>
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

      {/* ══════════════════════════════════════════════════════════════════════
        *  ZONE 3 — Data Section (full-width card with filters + table/cards)
        * ══════════════════════════════════════════════════════════════════════ */}
      <div className="debt-data-card" data-tour-id="debt-customer-list">
        {/* Filter pill bar */}
        <div className="debt-filter-bar">
          <div className="debt-filter-pills">
            <button
              type="button"
              className={`filter-pill${filterMode === 'all' ? ' is-active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              <Users size={14} />
              <span>Tất cả</span>
              <span className="filter-pill__count">{customerDebts.length}</span>
            </button>
            {/* Cross-bucket "Quá hạn" / "Rủi ro cao" pills removed — per-bucket
                filtering now lives on the 4 aging cards above, and mixing the
                two models caused the bug where 'overdue' grouped d30+d60 and
                'high-risk' used an amount-based criterion unrelated to aging. */}
          </div>
          <div className="debt-filter-spacer" />
          <div className="debt-filter-search">
            <Search size={14} />
            <input
              type="text"
              name="customerDebtSearch"
              aria-label="Tìm công nợ theo khách hàng"
              placeholder="Tìm khách hàng..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

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
                {filteredDebts.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <img src={resolveEmptyIllustration('empty-debts')} alt="" aria-hidden="true" style={{ width: 140, height: 116, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    Không tìm thấy dữ liệu.
                  </div>
                ) : (
                  filteredDebts.map(d => {
                    return (
                      <ClickableCard key={d.customerId} to={`/debt/${d.customerId}`} className="m-card">
                        <div className="m-card__top">
                          <span className="m-card__title">
                            <span className={`risk-dot risk-dot--${d.riskClass}`} />
                            <Building2 size={15} aria-hidden="true" style={{ color: 'var(--ink-3)', flex: '0 0 auto' }} />
                            {d.customerName}
                            {d.linkedSupplierId != null && (
                              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', verticalAlign: 'middle' }}>
                                2 chiều
                              </span>
                            )}
                          </span>
                          <span className={`m-card__row-value${d.totalOutstanding > 0 ? '--danger' : '--success'} m-card__row-value debt-list-page__amount`}>
                            {formatCurrency(d.totalOutstanding)}
                          </span>
                        </div>
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
                                <span style={{ fontSize: 12, fontWeight: 600, color: d.maxOverdueDays > 60 ? 'var(--danger)' : 'var(--warning)' }}>
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

            {/* ── Desktop table (>640px) ── */}
            <div className="desktop-only table-wrap">
              <div className="table-scroll">
                <table className="debt-list-table">
                    <thead>
                      <tr>
                        <th>Khách hàng</th>
                        <th className="num">Tổng nợ</th>
                        <th className="num">Net công nợ</th>
                        <th className="num" style={{ textAlign: 'center' }}>Quá hạn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDebts.map(d => {
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
                          <td className="debt-list-table__customer">
                            <div className="debt-list-table__customer-main">
                              <span className={`risk-dot risk-dot--${d.riskClass}`} />
                              <Building2 size={14} aria-hidden="true" style={{ color: 'var(--fg-3)', flex: '0 0 auto' }} />
                              <span className="debt-list-table__customer-name">{d.customerName}</span>
                              {d.linkedSupplierId != null && (
                                <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 700, color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '3px 7px', letterSpacing: '0.02em' }}>
                                  2 chiều
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)', marginLeft: 16 }}>
                              {d.totalOutstanding > 0
                                ? (d.maxOverdueDays > 30 ? "Nợ quá hạn" : "Trong hạn")
                                : (d.totalOutstanding < 0 ? "Trả trước" : "Cân bằng")}
                            </div>
                          </td>

                          <td className="num typo-mono" style={{
                            fontWeight: 700,
                            color: d.totalOutstanding > 0 ? 'var(--danger)' : 'var(--success)'
                          }}>
                            {formatCurrency(d.totalOutstanding)}
                          </td>

                          <td className="num typo-mono" style={{
                            fontWeight: 600,
                            color: d.linkedSupplierId == null
                              ? 'var(--fg-3)'
                              : (d.netBalance > 0 ? 'var(--danger)' : d.netBalance < 0 ? 'var(--success)' : 'var(--fg-3)')
                          }}>
                            {d.linkedSupplierId == null
                              ? <span style={{ color: 'var(--fg-3)' }}>&mdash;</span>
                              : formatCurrency(d.netBalance)}
                          </td>

                          <td className="num" style={{ textAlign: 'center', fontWeight: 600 }}>
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

                    {filteredDebts.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: '24px 40px', color: 'var(--fg-3)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                            <img src={resolveEmptyIllustration('empty-debts')} alt="" aria-hidden="true" style={{ width: 130, height: 108, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            Không tìm thấy dữ liệu công nợ thỏa mãn bộ lọc.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
