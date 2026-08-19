import { useState, useMemo, useRef, useEffect } from 'react';
import { formatCurrency, moneyParts } from '../lib/format';
import { downloadCSV } from '../lib/csv';
import type { PayableSummary, PayablesCategory } from '@tingting/shared';
import { Search, ChevronRight, Gift } from 'lucide-react';
import { PageHeader, Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { AssetIcon } from '../components/AssetIcon';
import { ClickableCard } from '../components/shared/ClickableCard';
import { usePayablesSummary, usePostCommission } from '../hooks/useQueries';
import { useCatalogs } from '../hooks/useCatalogs';
import { useAuth } from '../hooks/useAuth';
import {
  usePageAnimations,
  useCounterAnimation,
} from '../hooks/animations';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { FuelInvoicesPanel } from './payables-fuel-invoices';
import './PayableListPage.css';
import '../components/shared/HeroKpiRow.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';
import { useQuery } from '@tanstack/react-query';
import { tripClient } from '../api/tripClient';
import { qk } from '../api/keys';
import { Pagination, SearchableSelect, UuiSelectField } from '../design-system';

/* ─── Types ───────────────────────────────────────────────────────────────── */

interface PayablesResponse {
  items: PayableSummary[];
  totalOutstanding: string;
  totalSuppliers: number;
  overdueSuppliers: number;
}

export function payableDetailHref(payable: Pick<PayableSummary, 'kind' | 'supplier'>): string {
  return payable.kind === 'carrier'
    ? `/payables/${payable.supplier.id}?kind=carrier`
    : `/payables/${payable.supplier.id}`;
}

/* ─── Category chips ──────────────────────────────────────────────────────── */

const CATEGORY_CHIPS: Array<{ value: PayablesCategory | undefined; label: string }> = [
  { value: undefined, label: 'Tất cả' },
  { value: 'fuel', label: 'Xăng dầu' },
  { value: 'ancillary', label: 'Phí dịch vụ' },
  { value: 'commission', label: 'Hoa hồng' },
  { value: 'carrier', label: 'Vận chuyển thuê ngoài' },
];

/* ─── Commission modal ────────────────────────────────────────────────────── */

interface CommissionForm {
  supplierId: number | '';
  amount: string;
  tripId: string;
  note: string;
}

export function CommissionModal({
  isOpen,
  onClose,
  onSubmit,
  isPending,
  error,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { supplierId: number; amount: number; tripId?: number; note?: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const { data: catalogData } = useCatalogs();
  const suppliers = useMemo(
    () => (catalogData?.suppliers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    [catalogData?.suppliers],
  );
  const [form, setForm] = useState<CommissionForm>({ supplierId: '', amount: '', tripId: '', note: '' });
  const [tripSearch, setTripSearch] = useState('');
  const tripOptionsQuery = useQuery({
    queryKey: qk.financial.commissionTripSelector(tripSearch),
    queryFn: () => tripClient.listTrips({ limit: 50, page: 1, search: tripSearch || undefined }),
    enabled: isOpen,
    staleTime: 60_000,
  });
  const tripOptions = (tripOptionsQuery.data?.items ?? []).map((trip) => ({
    value: String(trip.id),
    label: [
      trip.tripCode || 'Chuyến chưa có mã',
      trip.customer?.name || 'Khách hàng chưa xác định',
      trip.route?.name || 'Tuyến chưa xác định',
      trip.departureDate || 'Chưa có ngày khởi hành',
    ].join(' · '),
    searchText: `${trip.customer?.name ?? ''} ${trip.route?.name ?? ''} ${trip.departureDate ?? ''}`,
  }));

  useEffect(() => {
    if (isOpen) {
      setForm({ supplierId: '', amount: '', tripId: '', note: '' });
      setTripSearch('');
    }
  }, [isOpen]);

  // Mirror the commissionSchema upper bound (≤ 1 tỷ VND) client-side so a typo
  // like 2,000,000,000 is caught here instead of surfacing as a generic 422.
  const amountNum = Number(form.amount);
  const overLimit = Number.isFinite(amountNum) && amountNum > 1_000_000_000;
  const canSubmit =
    !isPending &&
    form.supplierId !== '' &&
    form.amount.trim() !== '' &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !overLimit;

  const handleSubmit = () => {
    if (!canSubmit || form.supplierId === '') return;
    const tripIdRaw = form.tripId.trim();
    onSubmit({
      supplierId: Number(form.supplierId),
      amount: Number(form.amount),
      tripId: tripIdRaw && Number.isFinite(Number(tripIdRaw)) ? Number(tripIdRaw) : undefined,
      note: form.note.trim() || undefined,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Ghi hoa hồng"
      onClose={onClose}
      onConfirm={handleSubmit}
      maxWidth={480}
      footer={
        <>
          <button className="btn btn--secondary btn--sm" onClick={onClose} disabled={isPending}>
            Hủy bỏ
          </button>
          <button className="btn btn--primary btn--sm" onClick={handleSubmit} disabled={!canSubmit}>
            {isPending ? 'Đang ghi...' : 'Ghi nhận'}
          </button>
        </>
      }
    >
      <div className="commission-form">
        {error && (
          <div className="commission-form__error" role="alert">{error}</div>
        )}
        <UuiSelectField
          id="commission-supplier"
          label="Nhà cung cấp *"
          required
          value={form.supplierId === null || form.supplierId === undefined ? '' : String(form.supplierId)}
          onChange={e => setForm(f => ({ ...f, supplierId: e.target.value === '' ? '' : Number(e.target.value) }))}
          options={[
            { value: '', label: '— Chọn nhà cung cấp —' },
            ...suppliers.map(s => ({ value: String(s.id), label: s.name })),
          ]}
        />
        <div className="field">
          <label htmlFor="commission-amount">Số tiền hoa hồng <span className="req" aria-hidden="true">*</span></label>
          <input
            id="commission-amount"
            className="input"
            type="number"
            min="0"
            max="1000000000"
            step="1000"
            placeholder="VD: 500000"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
          />
          {overLimit && (
            <div className="commission-form__error" role="note">Số tiền vượt quá giới hạn tối đa 1 tỷ VND.</div>
          )}
        </div>
        <div className="field">
          <label htmlFor="commission-trip">Chuyến liên quan (tuỳ chọn)</label>
          <SearchableSelect
            id="commission-trip"
            value={form.tripId}
            onChange={(value) => setForm((current) => ({ ...current, tripId: value }))}
            options={tripOptions}
            onSearchChange={setTripSearch}
            placeholder={tripOptionsQuery.isLoading ? 'Đang tải chuyến…' : 'Chọn theo mã chuyến'}
            emptyMessage={tripOptionsQuery.isFetching ? 'Đang tìm chuyến phù hợp…' : 'Không có chuyến phù hợp.'}
            searchPlaceholder="Tìm theo mã chuyến, khách hàng hoặc tuyến…"
          />
        </div>
        <div className="field">
          <label htmlFor="commission-note">Ghi chú (tuỳ chọn)</label>
          <input
            id="commission-note"
            className="input"
            type="text"
            maxLength={500}
            placeholder="VD: Hoa hồng giới thiệu khách"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function PayableListPage() {
  const [category, setCategory] = useState<PayablesCategory | undefined>(undefined);
  const { data, isLoading: loading, error: queryError } = usePayablesSummary(category);
  const payables = useMemo(
    () => (data as unknown as PayablesResponse | undefined)?.items ?? [],
    [data],
  );
  const apiTotal = (data as unknown as PayablesResponse | undefined)?.totalOutstanding;
  const apiSupplierCount = (data as unknown as PayablesResponse | undefined)?.totalSuppliers ?? 0;
  const apiOverdueCount = (data as unknown as PayablesResponse | undefined)?.overdueSuppliers ?? 0;
  const error = queryError ? (queryError as Error).message : null;
  const [search, setSearch] = useState('');
  const prefersReduced = usePrefersReducedMotion();
  const compact = false; // full VND everywhere — no short form (e.g. "12,5 tr")

  /* ── Commission modal ── */
  const [commissionOpen, setCommissionOpen] = useState(false);
  const postCommission = usePostCommission();
  const commissionError = postCommission.error
    ? (postCommission.error as Error).message
    : null;

  /* ── Role gate: commission posting is ADMIN/MANAGER/ACCOUNTANT (matches the
     backend requireRoles). Hide the button for other roles so they don't fill
     the form only to hit a 403. (defense in depth, code-review HIGH) ── */
  const { user } = useAuth();
  const canPostCommission =
    user?.role === 'ADMIN' || user?.role === 'MANAGER' || user?.role === 'ACCOUNTANT';

  /* ── Page entrance animation (custom selectors for bento zones) ── */
  const { rootRef } = usePageAnimations({
    ready: !loading,
    selectors: [
      '.hero-kpi-card',
      '.hero-kpi-mini',
      '.aging-card',
      '.payables-data-card',
    ],
  });

  /* ── Counter animation ── */
  const { animateCounters } = useCounterAnimation({ duration: 1200, delay: 400 });

  const heroTotalRef = useRef<HTMLSpanElement>(null);
  const overdueRef = useRef<HTMLSpanElement>(null);
  const activeSuppliersRef = useRef<HTMLSpanElement>(null);
  const agingCurrentRef = useRef<HTMLSpanElement>(null);
  const agingD30Ref = useRef<HTMLSpanElement>(null);
  const agingD60Ref = useRef<HTMLSpanElement>(null);
  const agingOver90Ref = useRef<HTMLSpanElement>(null);

  /* ── Derived data ── */
  const totals = useMemo(() => {
    const sum = {
      total: apiTotal ? parseFloat(apiTotal) : 0,
      current: 0,
      d30: 0,
      d60: 0,
      over90: 0,
      currentCount: 0,
      d30Count: 0,
      d60Count: 0,
      over90Count: 0,
      supplierCount: apiSupplierCount,
      overdueCount: apiOverdueCount,
    };

    payables.forEach(d => {
      if (d.totalOutstanding > 0) {
        if (d.aging.current > 0) { sum.current += d.aging.current; sum.currentCount++; }
        if (d.aging.d30 > 0) { sum.d30 += d.aging.d30; sum.d30Count++; }
        if (d.aging.d60 > 0) { sum.d60 += d.aging.d60; sum.d60Count++; }
        if (d.aging.over90 > 0) { sum.over90 += d.aging.over90; sum.over90Count++; }
      }
    });

    return sum;
  }, [payables, apiTotal, apiSupplierCount, apiOverdueCount]);

  const filteredPayables = useMemo(() => {
    let result = payables;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(d =>
        d.supplier.name.toLowerCase().includes(q) ||
        (d.supplier.phone && d.supplier.phone.toLowerCase().includes(q))
      );
    }
    return result;
  }, [payables, search]);

  /* ── Client-side pagination (summary endpoint returns the full list) ── */
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(filteredPayables.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pagedPayables = useMemo(
    () => filteredPayables.slice((effectivePage - 1) * pageSize, effectivePage * pageSize),
    [filteredPayables, effectivePage, pageSize],
  );
  // Search or category change invalidates the current page number.
  useEffect(() => { setPage(1); }, [search, category]);

  /* ── Row click-through destination ── */
  // Keep carrier payables inside the outbound-payment workflow. A carrier may
  // also be a customer, but its receivable ledger is a different account.
  const rowHref = (d: PayableSummary) => payableDetailHref(d);

  /* ── Kick counter animations when data settles ── */
  useEffect(() => {
    if (loading || payables.length === 0 || prefersReduced) return;

    animateCounters([
      { el: heroTotalRef.current, value: totals.total, format: moneyParts(totals.total, false).format },
      { el: overdueRef.current, value: totals.overdueCount },
      { el: activeSuppliersRef.current, value: totals.supplierCount },
      { el: agingCurrentRef.current, value: totals.current, format: moneyParts(totals.current, compact).format },
      { el: agingD30Ref.current, value: totals.d30, format: moneyParts(totals.d30, compact).format },
      { el: agingD60Ref.current, value: totals.d60, format: moneyParts(totals.d60, compact).format },
      { el: agingOver90Ref.current, value: totals.over90, format: moneyParts(totals.over90, compact).format },
    ]);
  }, [loading, payables.length, totals, animateCounters, prefersReduced, compact]);

  /* ── Aging progress percentages ── */
  const agingTotal = totals.current + totals.d30 + totals.d60 + totals.over90 || 1;
  const pctCurrent = (totals.current / agingTotal) * 100;
  const pctD30 = (totals.d30 / agingTotal) * 100;
  const pctD60 = (totals.d60 / agingTotal) * 100;
  const pctOver90 = (totals.over90 / agingTotal) * 100;

  /* ── Money display parts (hero always full; aging compact on narrow cards) ── */
  const heroMoney = moneyParts(totals.total, false);
  const currentMoney = moneyParts(totals.current, compact);
  const d30Money = moneyParts(totals.d30, compact);
  const d60Money = moneyParts(totals.d60, compact);
  const over90Money = moneyParts(totals.over90, compact);

  /* ── CSV export ── */
  const handleExport = async () => {
    const headers = ['Nhà cung cấp', 'Tổng nợ', '0-30 ngày', '31-60 ngày', '61-90 ngày', '>90 ngày'];
    const rows = filteredPayables.map(d => [
      d.supplier.name,
      d.totalOutstanding,
      d.aging.current,
      d.aging.d30,
      d.aging.d60,
      d.aging.over90,
    ]);
    const filterLabel = category ? `Loại: ${category}` : 'Tất cả nhà cung cấp';
    await downloadCSV(`cong-no-phai-tra-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
      title: 'SỔ CÔNG NỢ PHẢI TRẢ',
      subtitle: filterLabel + (search.trim() ? ` · Tìm: "${search.trim()}"` : ''),
      columnTypes: ['text', 'currency', 'currency', 'currency', 'currency', 'currency'],
      totalsColumns: [1, 2, 3, 4, 5],
      totalsLabel: 'TỔNG CỘNG',
    });
  };

  return (
    <div ref={rootRef} className="payables-page">
      <Breadcrumbs
        className="payables-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Công nợ phải trả' },
        ]}
      />
      <PageHeader
        title="Công nợ phải trả"
        iconName="payables"
        description={`Tổng nợ: ${formatCurrency(totals.total)} · ${totals.supplierCount} NCC · cập nhật vừa xong`}
        action={
          <div className="page-actions">
            {canPostCommission && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => setCommissionOpen(true)}
                title="Ghi nhận khoản hoa hồng cho nhà cung cấp"
              >
                <Gift size={14} style={{ marginRight: 6 }} aria-hidden="true" />
                Ghi hoa hồng
              </button>
            )}
            <button className="btn btn--secondary btn--sm" onClick={handleExport}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất báo cáo
            </button>
          </div>
        }
      />

      <FuelInvoicesPanel />

      {/* ── Zone 1: Hero KPI Row ────────────────────────────────────────── */}
      <div className="hero-kpi-row">
        {/* Hero card — span 3 */}
        <div className="hero-kpi-card">
          <span className="hero-kpi-card__eyebrow">Tổng công nợ phải trả</span>
          <span className="hero-kpi-card__amount">
            <span ref={heroTotalRef}>{prefersReduced ? heroMoney.num : 0}</span>
            <span className="hero-kpi-card__currency">{heroMoney.unit}</span>
          </span>
          <span className="hero-kpi-card__subtitle">
            {totals.supplierCount} nhà cung cấp · cập nhật vừa xong
          </span>
          <AssetIcon name="payables" size={86} className="hero-kpi-card__watermark hero-kpi-card__watermark--asset" />
        </div>

        {/* Stacked mini-KPI cards — span 1 */}
        <div className="hero-kpi-stack">
          <div className="hero-kpi-mini hero-kpi-mini--danger">
            <div className="hero-kpi-mini__body">
              <span className="hero-kpi-mini__value" ref={overdueRef}>
                {prefersReduced ? totals.overdueCount : 0}
              </span>
              <span className="hero-kpi-mini__label">quá hạn</span>
            </div>
            <AssetIcon name="overdue" size={44} className="hero-kpi-mini__watermark hero-kpi-mini__watermark--asset" />
          </div>
          <div className="hero-kpi-mini hero-kpi-mini--accent">
            <div className="hero-kpi-mini__body">
              <span className="hero-kpi-mini__value" ref={activeSuppliersRef}>
                {prefersReduced ? totals.supplierCount : 0}
              </span>
              <span className="hero-kpi-mini__label">nhà cung cấp</span>
            </div>
            <AssetIcon name="active-supplier" size={44} className="hero-kpi-mini__watermark hero-kpi-mini__watermark--asset" />
          </div>
        </div>
      </div>

      {/* ── Zone 2: Aging Distribution ──────────────────────────────────── */}
      <div className="payables-aging-grid">
        {/* 0–30 days */}
        <div className="aging-card aging-card--ok">
          <div className="aging-card__header">
            <span className="aging-card__dot aging-card__dot--ok" />
            <span className="aging-card__label">0–30 ngày</span>
          </div>
          <span className="aging-card__value">
            <span ref={agingCurrentRef}>{prefersReduced ? currentMoney.num : 0}</span><span className="aging-card__unit">{currentMoney.unit}</span>
          </span>
          <span className="aging-card__count">{totals.currentCount} NCC</span>
          <div className="aging-card__bar-track">
            <div className="aging-card__bar aging-card__bar--ok" style={{ width: `${pctCurrent}%` }} />
          </div>
        </div>

        {/* 31–60 days */}
        <div className="aging-card aging-card--warn">
          <div className="aging-card__header">
            <span className="aging-card__dot aging-card__dot--warn" />
            <span className="aging-card__label">31–60 ngày</span>
          </div>
          <span className="aging-card__value">
            <span ref={agingD30Ref}>{prefersReduced ? d30Money.num : 0}</span><span className="aging-card__unit">{d30Money.unit}</span>
          </span>
          <span className="aging-card__count">{totals.d30Count} NCC</span>
          <div className="aging-card__bar-track">
            <div className="aging-card__bar aging-card__bar--warn" style={{ width: `${pctD30}%` }} />
          </div>
        </div>

        {/* 61–90 days */}
        <div className="aging-card aging-card--deep">
          <div className="aging-card__header">
            <span className="aging-card__dot aging-card__dot--deep" />
            <span className="aging-card__label">61–90 ngày</span>
          </div>
          <span className="aging-card__value">
            <span ref={agingD60Ref}>{prefersReduced ? d60Money.num : 0}</span><span className="aging-card__unit">{d60Money.unit}</span>
          </span>
          <span className="aging-card__count">{totals.d60Count} NCC</span>
          <div className="aging-card__bar-track">
            <div className="aging-card__bar aging-card__bar--deep" style={{ width: `${pctD60}%` }} />
          </div>
        </div>

        {/* Over 90 days */}
        <div className="aging-card aging-card--danger">
          <div className="aging-card__header">
            <span className="aging-card__dot aging-card__dot--danger" />
            <span className="aging-card__label">Trên 90 ngày</span>
          </div>
          <span className="aging-card__value">
            <span ref={agingOver90Ref}>{prefersReduced ? over90Money.num : 0}</span><span className="aging-card__unit">{over90Money.unit}</span>
          </span>
          <span className="aging-card__count">{totals.over90Count} NCC</span>
          <div className="aging-card__bar-track">
            <div className="aging-card__bar aging-card__bar--danger" style={{ width: `${pctOver90}%` }} />
          </div>
        </div>
      </div>

      {/* ── Zone 3: Data Card ───────────────────────────────────────────── */}
      <div className="payables-data-card">
        {/* Category chips */}
        <div className="payables-category-chips" role="tablist" aria-label="Lọc theo loại công nợ">
          {CATEGORY_CHIPS.map(chip => {
            const isActive = chip.value === category;
            return (
              <button
                key={chip.label}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`payables-category-chip${isActive ? ' is-active' : ''}`}
                onClick={() => setCategory(chip.value)}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Toolbar row */}
        <div className="payables-toolbar">
          <div className="payables-toolbar__spacer" />
          <div className="payables-toolbar__search">
            <Search size={14} style={{ color: 'var(--ink-3)' }} />
            <input
              type="text"
              name="supplierPayableSearch"
              aria-label="Tìm công nợ theo nhà cung cấp"
              placeholder="Tìm nhà cung cấp..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="panel" style={{ padding: 16, color: 'var(--danger)', marginBottom: 20 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>
            Đang tải dữ liệu công nợ phải trả...
          </div>
        ) : (
          <>
            {/* ── Mobile card list (<=640px) ── */}
            <div className="mobile-only mobile-table-wrap">
              <div className="m-card-list">
                {filteredPayables.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <img src={resolveEmptyIllustration('empty-payables')} alt="" aria-hidden="true" style={{ width: 140, height: 116, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    Không tìm thấy dữ liệu.
                  </div>
                ) : (
                  pagedPayables.map(d => {
                    const totalAging = d.aging.current + d.aging.d30 + d.aging.d60 + d.aging.over90;
                    const pctCur = totalAging > 0 ? (d.aging.current / totalAging) * 100 : 100;
                    const pct30 = totalAging > 0 ? (d.aging.d30 / totalAging) * 100 : 0;
                    const pct60 = totalAging > 0 ? (d.aging.d60 / totalAging) * 100 : 0;
                    const pct90 = totalAging > 0 ? (d.aging.over90 / totalAging) * 100 : 0;
                    return (
                      <ClickableCard key={`${d.kind ?? 'vendor'}-${d.supplier.id}`} to={rowHref(d)} className="m-card">
                        <div className="m-card__top">
                          <span className="m-card__title">{d.supplier.name}</span>
                          <span className={`m-card__row-value${d.totalOutstanding > 0 ? '--danger' : '--success'} m-card__row-value`} style={{ fontSize: 13.5 }}>
                            {formatCurrency(d.totalOutstanding)}
                          </span>
                        </div>
                        {d.supplier.phone && (
                          <div className="m-card__meta">{d.supplier.phone}</div>
                        )}
                        {d.totalOutstanding > 0 && (
                          <>
                            <div className="aging-bar" style={{ height: 5, borderRadius: 3, overflow: 'hidden', display: 'flex', marginTop: 8, marginBottom: 4 }}>
                              <div className="aging-bar__seg aging-bar__seg--ok" style={{ width: `${pctCur}%` }} />
                              <div className="aging-bar__seg aging-bar__seg--t1" style={{ width: `${pct30}%` }} />
                              <div className="aging-bar__seg aging-bar__seg--t2" style={{ width: `${pct60}%` }} />
                              <div className="aging-bar__seg aging-bar__seg--t4" style={{ width: `${pct90}%` }} />
                            </div>
                            {d.maxOverdueDays > 0 && (
                              <div className="m-card__row">
                                <span className="m-card__row-label">Quá hạn lớn nhất</span>
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
                <table>
                  <thead>
                    <tr>
                      <th>Nhà cung cấp</th>
                      <th className="num">Tổng nợ</th>
                      <th>0-30 ngày</th>
                      <th>31-60 ngày</th>
                      <th>61-90 ngày</th>
                      <th>&gt;90 ngày</th>
                      <th style={{ width: 48 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPayables.map(d => (
                      <ClickableCard
                        as="tr"
                        key={`${d.kind ?? 'vendor'}-${d.supplier.id}`}
                        to={rowHref(d)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', fontWeight: 600, color: 'var(--fg-1)' }}>
                            {d.supplier.name}
                          </div>
                          <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--fg-3)' }}>
                            {d.supplier.phone || '—'}
                          </div>
                        </td>
                        <td className="num typo-mono" style={{
                          fontWeight: 700,
                          color: d.totalOutstanding > 0 ? 'var(--danger)' : 'var(--success)'
                        }}>
                          {formatCurrency(d.totalOutstanding)}
                        </td>
                        <td className="num" style={{ fontSize: 13, color: d.aging.current > 0 ? 'var(--fg-1)' : 'var(--fg-3)' }}>
                          {d.aging.current > 0 ? formatCurrency(d.aging.current) : '—'}
                        </td>
                        <td className="num" style={{ fontSize: 13, color: d.aging.d30 > 0 ? 'var(--warning)' : 'var(--fg-3)' }}>
                          {d.aging.d30 > 0 ? formatCurrency(d.aging.d30) : '—'}
                        </td>
                        <td className="num" style={{ fontSize: 13, color: d.aging.d60 > 0 ? '#D97706' : 'var(--fg-3)' }}>
                          {d.aging.d60 > 0 ? formatCurrency(d.aging.d60) : '—'}
                        </td>
                        <td className="num" style={{ fontSize: 13, color: d.aging.over90 > 0 ? 'var(--danger)' : 'var(--fg-3)' }}>
                          {d.aging.over90 > 0 ? formatCurrency(d.aging.over90) : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <ChevronRight size={14} style={{ color: 'var(--fg-3)' }} />
                        </td>
                      </ClickableCard>
                    ))}

                    {filteredPayables.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '24px 40px', color: 'var(--fg-3)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                            <img src={resolveEmptyIllustration('empty-payables')} alt="" aria-hidden="true" style={{ width: 130, height: 108, objectFit: 'contain' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            Không tìm thấy dữ liệu công nợ phải trả.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={effectivePage} totalPages={totalPages} totalItems={filteredPayables.length} pageSize={pageSize} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {/* ── Commission posting modal ── */}
      <CommissionModal
        isOpen={commissionOpen}
        onClose={() => {
          if (!postCommission.isPending) setCommissionOpen(false);
        }}
        onSubmit={(data) => {
          postCommission.mutate(data, {
            onSuccess: () => setCommissionOpen(false),
          });
        }}
        isPending={postCommission.isPending}
        error={commissionError}
      />
    </div>
  );
}
