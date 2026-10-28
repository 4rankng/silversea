import { useState, useMemo, useEffect } from 'react';
import { formatCurrency, moneyParts } from '../lib/format';
import { useToast } from '../components/shared/Toast';
import { billBookingReference } from '../lib/business-reference';
import { downloadCSV } from '../lib/csv';
import type { PayableSummary, PayablesCategory } from '@tingting/shared';
import { ChevronRight, Gift, Download, Clock } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { SortHeader } from '../components/shared/SortHeader';
import { PageHeader, Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { ClickableCard } from '../components/shared/ClickableCard';
import { SkeletonTable } from '../components/shared/Skeleton';
import { usePostCommission } from '../hooks/useQueries';
import { financialClient } from '../api/financialClient';
import { useTableQueryState } from '../design-system/hooks/useTableQueryState';
import { useCatalogs } from '../hooks/useCatalogs';
import { useAuth } from '../hooks/useAuth';
import { PartyMonthlyProductionSummary } from '../features/accounting/PartyMonthlyProductionSummary';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import { usePageAnimations } from '../hooks/animations';
import { FuelInvoicesPanel } from './payables-fuel-invoices';
import './PayableListPage.css';
import '../styles/table-sort.css';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import { useQuery } from '@tanstack/react-query';
import { tripClient } from '../api/tripClient';
import { qk } from '../api/keys';
import { EmptyState, FilterBar, NumberField, Pagination, SearchableSelect, Tabs, UuiSelectField } from '../design-system';

/* ─── Types ───────────────────────────────────────────────────────────────── */

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
      billBookingReference(trip.customerReference),
      trip.customer?.name || 'Khách hàng chưa xác định',
      trip.route?.name || 'Tuyến chưa xác định',
      trip.departureDate || 'Chưa có ngày khởi hành',
    ].join(' · '),
    searchText: `${trip.customerReference ?? ''} ${trip.customer?.name ?? ''} ${trip.route?.name ?? ''} ${trip.departureDate ?? ''}`,
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
          <button className="btn btn--primary btn--sm" onClick={handleSubmit} disabled={!canSubmit} title={canSubmit ? undefined : 'Nhập đủ nhà cung cấp và số tiền hợp lệ để ghi hoa hồng'}>
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
          label="Nhà cung cấp"
          required
          value={form.supplierId === null || form.supplierId === undefined ? '' : String(form.supplierId)}
          onChange={e => setForm(f => ({ ...f, supplierId: e.target.value === '' ? '' : Number(e.target.value) }))}
          options={[
            { value: '', label: '— Chọn nhà cung cấp —' },
            ...suppliers.map(s => ({ value: String(s.id), label: s.name })),
          ]}
          wrapperClassName="commission-form__field--full"
        />
        <div className="field">
          <label htmlFor="commission-amount">Số tiền hoa hồng <span className="req" aria-hidden="true">*</span></label>
          <NumberField
            id="commission-amount"
            grouped
            placeholder="Ví dụ: 500000"
            value={form.amount === '' ? '' : Number(form.amount)}
            onChange={(n) => setForm(f => ({ ...f, amount: n === '' ? '' : String(n) }))}
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
        <div className="field commission-form__field--full">
          <label htmlFor="commission-note">Ghi chú (tuỳ chọn)</label>
          <input
            id="commission-note"
            className="input"
            type="text"
            maxLength={500}
            placeholder="Ví dụ: Hoa hồng giới thiệu khách"
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </div>
    </Modal>
  );
}

/* ─── Aging segments (SIL-470) ────────────────────────────────────────────── */
/* Same bucket colors as the /debt aging lanes — the two công nợ surfaces read
 * as one visual language. The summary band renders these as one segmented bar
 * with a legend; the table renders them per-row as a mini stacked bar. */

interface AgingSegment {
  key: 'current' | 'd30' | 'd60' | 'over90';
  countKey: 'currentCount' | 'd30Count' | 'd60Count' | 'over90Count';
  shortLabel: string;
  barLabel: string;
  color: string;
}

const AGING_SEGMENTS: AgingSegment[] = [
  { key: 'current', countKey: 'currentCount', shortLabel: 'Trong hạn', barLabel: 'Chưa đến hạn', color: 'var(--success)' },
  { key: 'd30', countKey: 'd30Count', shortLabel: '0–30', barLabel: 'Quá hạn 1–30', color: 'var(--warning)' },
  { key: 'd60', countKey: 'd60Count', shortLabel: '31–90', barLabel: 'Quá hạn 31–90', color: 'var(--warning-deep)' },
  { key: 'over90', countKey: 'over90Count', shortLabel: '>90', barLabel: 'Quá hạn trên 90', color: 'var(--danger)' },
];

/** One row's aging cell (SIL-470 verdict 2): a mini stacked bar (64–80px) plus
 *  the overdue total, with the four-bucket breakdown in the tooltip. Segments
 *  only render for buckets the supplier actually owes in — no '—' filler. */
function PayableAgingCell({ aging }: { aging: PayableSummary['aging'] }) {
  const sum = aging.current + aging.d30 + aging.d60 + aging.over90;
  const overdue = aging.d30 + aging.d60 + aging.over90;
  const pct = (amount: number) => (sum > 0 ? `${(amount / sum) * 100}%` : '0%');
  const tip = AGING_SEGMENTS
    .map((seg) => `${seg.barLabel} ${formatCurrency(aging[seg.key])}`)
    .join(' · ');
  return (
    <div className="payables-aging-cell" title={tip}>
      <div className="payables-aging-cell__bar" aria-hidden="true">
        {AGING_SEGMENTS.map((seg) => (
          aging[seg.key] > 0 && sum > 0 ? (
            <span
              key={seg.key}
              className="payables-aging-cell__seg"
              style={{ width: pct(aging[seg.key]), background: seg.color }}
            />
          ) : null
        ))}
      </div>
      <span className="payables-aging-cell__overdue" data-overdue={overdue > 0 ? 'true' : 'false'}>
        {overdue > 0 ? formatCurrency(overdue) : 'Trong hạn'}
      </span>
      <span className="sr-only">{tip}</span>
    </div>
  );
}

/** SIL-470 verdict 3: the supplier sub-line is contact data, not decoration.
 *  A blank, underscore or dash placeholder renders NOTHING — the wrapper is
 *  not mounted, so no junk character can appear under the name. */
export function supplierSubLine(phone: string | null | undefined): string | null {
  const trimmed = phone?.trim() ?? '';
  if (!trimmed || /^[_\-—.]+$/.test(trimmed)) return null;
  return trimmed;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

type PayablesSummaryEnvelope = Awaited<ReturnType<typeof financialClient.getPayablesSummary>>;

export default function PayableListPage() {
  // Due-group deep links (?filter=current|overdue from the accounting
  // overview) initialize the bucket filter the same way the /debt page does;
  // afterwards the bucket rides the filters bag alongside category and sort.
  // `?asOf=` pins the aging snapshot date so the list matches the clicked counts.
  const [searchParams] = useSearchParams();
  const urlBucket = searchParams.get('filter') === 'current' ? 'current'
    : searchParams.get('filter') === 'overdue' ? 'overdue'
    : undefined;
  const urlAsOf = searchParams.get('asOf') ?? undefined;
  // Server-side search + pagination + column sort; headline numbers and totals
  // are full-set. Search input, page-reset-on-filter and caching live in the
  // table hook.
  const table = useTableQueryState<
    PayableSummary,
    { category?: PayablesCategory; bucket?: 'current' | 'overdue'; asOfDate?: string; sortBy?: string; sortDir?: 'asc' | 'desc' },
    PayablesSummaryEnvelope
  >({
    endpoint: (params) => financialClient.getPayablesSummary(params),
    queryKey: qk.financial.payablesSummaryAll,
    defaultPageSize: 25,
    initialFilters: urlBucket || urlAsOf ? { bucket: urlBucket, asOfDate: urlAsOf } : {},
  });
  const { search: searchInput, setSearch: setSearchInput, page, setPage, query } = table;
  const category = table.filters.category as PayablesCategory | undefined;
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
  const payables = useMemo(() => data?.items ?? [], [data]);
  const apiTotal = data?.totalOutstanding;
  const apiSupplierCount = data?.totalSuppliers ?? 0;
  const apiOverdueCount = data?.overdueSuppliers ?? 0;
  const error = queryError ? (queryError as Error).message : null;
  // Card 071026141620: the summary band's values are only real once the query
  // settled — before that it degrades to an em dash, like the accounting rail.
  const payablesReady = !loading && !error;

  /* ── Commission modal ── */
  const [commissionOpen, setCommissionOpen] = useState(false);
  // Card 071026141590: the export rides the house feedback contract (busy label
  // + success/failure toast) — the silent click hid real failures from kế toán.
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  // Fuel-invoice capture/lookup is secondary here: debt lookup leads.
  const [fuelOpen, setFuelOpen] = useState(false);
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
      '.payables-band',
      '.payables-data-card',
    ],
  });

  /* ── Derived data ── */
  // Aging-bucket totals arrive server-computed over the search-scoped full
  // set; headline numbers (totalOutstanding/totalSuppliers/overdueSuppliers)
  // are always full-set.
  const serverTotals = data?.totals;
  const totals = useMemo(() => ({
    total: apiTotal ? parseFloat(apiTotal) : 0,
    current: serverTotals?.current ?? 0,
    d30: serverTotals?.d30 ?? 0,
    d60: serverTotals?.d60 ?? 0,
    over90: serverTotals?.over90 ?? 0,
    currentCount: serverTotals?.currentCount ?? 0,
    d30Count: serverTotals?.d30Count ?? 0,
    d60Count: serverTotals?.d60Count ?? 0,
    over90Count: serverTotals?.over90Count ?? 0,
    supplierCount: apiSupplierCount,
    overdueCount: apiOverdueCount,
  }), [apiTotal, serverTotals, apiSupplierCount, apiOverdueCount]);

  // Search + pagination happen server-side; rows render the current window.
  const effectivePage = Math.min(page, data?.totalPages ?? 1);
  // Search or category change invalidates the current page number.

  /* ── Row click-through destination ── */
  // Keep carrier payables inside the outbound-payment workflow. A carrier may
  // also be a customer, but its receivable ledger is a different account.
  const rowHref = (d: PayableSummary) => payableDetailHref(d);

  /* ── Summary band (SIL-470): tổng trái + chips + aging segmented bar ── */
  // The bucket pills above narrow the list; "Quá hạn" is the cross-bucket
  // aggregate the overview already deep-links with (?filter=overdue).
  const overdueOnly = table.filters.bucket === 'overdue';
  const toggleOverdueOnly = () => table.setFilter('bucket', overdueOnly ? undefined : 'overdue');

  const agingTotal = totals.current + totals.d30 + totals.d60 + totals.over90 || 1;

  /* ── Money display parts (band total always full VND) ── */
  const heroMoney = moneyParts(totals.total, false);

  /* ── CSV export ── */
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await runExport();
      toast({ kind: 'success', message: 'Đã xuất công nợ phải trả ra tệp CSV.' });
    } catch {
      toast({ kind: 'error', message: 'Chưa xuất được báo cáo công nợ phải trả — vui lòng thử lại.' });
    } finally {
      setExporting(false);
    }
  };
  const runExport = async () => {
    const headers = ['Nhà cung cấp', 'Tổng nợ', 'Chưa đến hạn', 'Quá hạn 1-30', 'Quá hạn 31-90', 'Quá hạn >90'];
    const rows = payables.map(d => [
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
      subtitle: filterLabel + (searchInput.trim() ? ` · Tìm: "${searchInput.trim()}"` : ''),
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
            <button className="btn btn--secondary btn--sm" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Đang xuất…' : 'Xuất báo cáo'}
              <Download size={14} aria-hidden="true" style={{ marginRight: 6 }} />
            </button>
          </div>
        }
      />

      {/* ── SIL-470: Summary band ≤96px — replaces the old rail + four ~110px
              aging cards. Tổng trái, chips quá hạn/NCC, aging segmented bar
              (màu đồng bộ /debt) + legend; đầy đủ dữ liệu 4 bucket khi hover. ── */}
      <section className="payables-band" aria-label="Tóm tắt công nợ phải trả" data-testid="payables-band">
        <div className="payables-band__total">
          <span className="payables-band__total-label">Tổng công nợ phải trả (gồm VAT)</span>
          <span className="payables-band__total-value" data-testid="payables-band-total">
            {payablesReady ? `${heroMoney.num} ${heroMoney.unit}` : '—'}
          </span>
        </div>
        <div className="payables-band__aging">
          <div className="payables-band__chips">
            <span
              className={`payables-band__chip${payablesReady && totals.overdueCount > 0 ? ' payables-band__chip--warning' : ''}`}
              data-testid="payables-band-overdue"
            >
              {payablesReady ? `${totals.overdueCount} quá hạn` : '—'}
            </span>
            <span className="payables-band__chip" data-testid="payables-band-suppliers">
              {payablesReady ? `${totals.supplierCount} NCC` : '—'}
            </span>
          </div>
          <div
            className="payables-band__bar"
            role="img"
            aria-label={`Phân bố hạn nợ: ${AGING_SEGMENTS.map((s) => `${s.barLabel} ${formatCurrency(totals[s.key])}`).join(', ')}`}
          >
            {AGING_SEGMENTS.map((seg) => {
              const amount = totals[seg.key];
              const width = (amount / agingTotal) * 100;
              return width > 0 && payablesReady ? (
                <div
                  key={seg.key}
                  className="payables-band__seg"
                  style={{ width: `${width}%`, background: seg.color }}
                  title={`${seg.barLabel}: ${formatCurrency(amount)} · ${totals[seg.countKey]} NCC`}
                />
              ) : null;
            })}
          </div>
          <div className="payables-band__legend">
            {AGING_SEGMENTS.map((seg) => (
              <span key={seg.key} className="payables-band__legend-item" title={`${seg.barLabel}: ${formatCurrency(totals[seg.key])} · ${totals[seg.countKey]} NCC`}>
                <span className="payables-band__dot" style={{ background: seg.color }} aria-hidden="true" />
                {seg.shortLabel}
                {' '}
                <b>{payablesReady ? formatCurrency(totals[seg.key]) : '—'}</b>
                {payablesReady && <span className="payables-band__legend-count">· {totals[seg.countKey]} NCC</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Zone 3: Data Card ───────────────────────────────────────────── */}
      <div className="payables-data-card">
        {/* Card 20260927_152 — the shared bar owns the strip's layout, the
            search chrome and every control width. The category group is the
            shared boxed `Tabs` primitive (operator ruling 2026-09-27) and rides
            the bar's quick-filter slot, so this page declares no filter layout
            and no control width of its own. */}
        <FilterBar
          search={{
            value: searchInput,
            onChange: setSearchInput,
            placeholder: 'Tìm nhà cung cấp...',
            ariaLabel: 'Tìm công nợ theo nhà cung cấp',
            inputProps: { name: 'supplierPayableSearch' },
          }}
          quickFilters={(
            <>
              <Tabs
                variant="boxed"
                tabs={CATEGORY_CHIPS.map(chip => ({ id: chip.value ?? 'all', label: chip.label }))}
                value={category ?? 'all'}
                onChange={(id) => table.setFilter('category', id === 'all' ? undefined : id as PayablesCategory)}
                ariaLabel="Lọc theo loại công nợ"
              />
              {/* SIL-470 verdict E: lọc nhanh "Quá hạn" — cross-bucket aggregate
                  (?filter=overdue convention) so kế toán không phải đọc cột. */}
              <button
                type="button"
                className={`filter-chip${overdueOnly ? ' is-active' : ''}`}
                aria-pressed={overdueOnly}
                onClick={toggleOverdueOnly}
                title="Chỉ hiện nhà cung cấp có nợ quá hạn"
              >
                <Clock size={14} aria-hidden="true" />
                <span>Quá hạn</span>
                <span className="filter-chip__count">{payablesReady ? totals.overdueCount : '—'}</span>
              </button>
            </>
          )}
        />

        {error && (
          <div className="panel" style={{ padding: 16, color: 'var(--danger)', marginBottom: 20 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div role="status">
            <SkeletonTable rows={6} cols={7} />
            <span className="sr-only">Đang tải dữ liệu công nợ phải trả…</span>
          </div>
        ) : (
          <>
            {/* ── Mobile card list (<=640px) ── */}
            <div className="mobile-only mobile-table-wrap">
              <div className="m-card-list">
                {payables.length === 0 ? (
                  <EmptyState variant="compact" context="payables" title="Không tìm thấy dữ liệu." />
                ) : (
                  payables.map(d => {
                    const sub = supplierSubLine(d.supplier.phone);
                    const totalAging = d.aging.current + d.aging.d30 + d.aging.d60 + d.aging.over90;
                    const pctCur = totalAging > 0 ? (d.aging.current / totalAging) * 100 : 100;
                    const pct30 = totalAging > 0 ? (d.aging.d30 / totalAging) * 100 : 0;
                    const pct60 = totalAging > 0 ? (d.aging.d60 / totalAging) * 100 : 0;
                    const pct90 = totalAging > 0 ? (d.aging.over90 / totalAging) * 100 : 0;
                    return (
                      <ClickableCard key={`${d.kind ?? 'vendor'}-${d.supplier.id}`} to={rowHref(d)} className="m-card">
                        <div className="m-card__top">
                          <span className="m-card__title">{d.supplier.name}</span>
                          <span className={`m-card__row-value${d.totalOutstanding > 0 ? '--warning' : '--success'} m-card__row-value`} style={{ fontSize: 'var(--text-body-size)' }}>
                            {formatCurrency(d.totalOutstanding)}
                          </span>
                        </div>
                        {sub && (
                          <div className="m-card__meta">{sub}</div>
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
                                <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 600, color: d.maxOverdueDays > 60 ? 'var(--danger)' : 'var(--warning-text)' }}>
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
                  skin, neutral gated hover and the card collapse. SIL-470:
                  4 cột aging tiền → 1 cột "Hạn nợ" (mini stacked bar + tooltip
                  breakdown); tên NCC 1 dòng + tooltip; sub-line chỉ khi có SĐT. ── */}
            <div className="desktop-only">
              <div className="record-table-wrap">
                <table className="record-table ops-table">
                  <thead>
                    <tr>
                      <SortHeader label="Nhà cung cấp" sortKey="supplierName" sort={sortState} onSortChange={handleSortChange} />
                      <SortHeader label="Tổng nợ" sortKey="totalOutstanding" sort={sortState} onSortChange={handleSortChange} className="num" style={{ width: 170 }} />
                      <th style={{ width: 220 }}>Hạn nợ</th>
                      <th className="record-table__action-col" style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payables.map(d => {
                      const sub = supplierSubLine(d.supplier.phone);
                      return (
                        <ClickableCard
                          as="tr"
                          key={`${d.kind ?? 'vendor'}-${d.supplier.id}`}
                          to={rowHref(d)}
                        >
                          <td data-label="Nhà cung cấp">
                            <div className="payables-supplier-name" data-testid="payables-supplier-name" title={d.supplier.name}>
                              {d.supplier.name}
                            </div>
                            {sub && (
                              <div className="payables-row-sub">{sub}</div>
                            )}
                          </td>
                          <td data-label="Tổng nợ" className="num typo-mono" style={{
                            fontWeight: 700,
                            color: d.totalOutstanding > 0 ? 'var(--warning-text)' : 'var(--success)'
                          }}>
                            {formatCurrency(d.totalOutstanding)}
                          </td>
                          {/* SIL-470: one aging cell — segmented bar only renders
                              buckets with money; computed 0 shows "Trong hạn"
                              (card 20261002_293), never a '—' filler. */}
                          <td data-label="Hạn nợ">
                            <PayableAgingCell aging={d.aging} />
                          </td>
                          <td data-label="" className="record-table__action" style={{ textAlign: 'right' }}>
                            <ChevronRight size={16} style={{ color: 'var(--fg-3)' }} />
                          </td>
                        </ClickableCard>
                      );
                    })}

                    {payables.length === 0 && (
                      <tr>
                        <td colSpan={4} data-label="">
                          <EmptyState variant="compact" context="payables" title="Không tìm thấy dữ liệu công nợ phải trả." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={effectivePage} totalPages={data?.totalPages ?? 1} totalItems={data?.total ?? 0} pageSize={data?.limit ?? 25} onChange={setPage} />
            </div>
          </>
        )}
      </div>

      {/* ── Card 380: monthly transport production summary — the ledger table
          above stays primary; the section reuses this page's card skin and its
          còn-nợ column reconciles with the table's Tổng nợ (same ledger
          endpoint — pinned by the summary's component tests). ── */}
      <PartyMonthlyProductionSummary variant="payable" className="payables-data-card" />

      {/* ── Fuel invoices: secondary capture/lookup, collapsed by default so
          debt totals, search and the payable queue lead the initial view ── */}
      <div className="payables-fuel-secondary">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          aria-expanded={fuelOpen}
          onClick={() => setFuelOpen((o) => !o)}
        >
          Hóa đơn nhiên liệu nhiều xe {fuelOpen ? '— ẩn' : '— mở'}
        </button>
        {fuelOpen && <FuelInvoicesPanel />}
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
