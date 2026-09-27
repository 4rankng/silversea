import { useState, useMemo } from 'react';
import { formatCurrency, formatDate } from '../lib/format';
import { Money } from '../components/shared/Money';
import { ShieldCheck, AlertTriangle, AlertOctagon, Loader2, Calendar, Truck } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { useSalaryPeriod, useDriverPenalties } from '../hooks/useQueries';
import { usePageAnimations, useListAnimations } from '../hooks/animations';
import { UuiSelectField } from '../design-system';
import './DriverPenaltyPage.css';
import { EmptyState } from '../design-system';

interface DriverPenaltyRow {
  id: number;
  driverId: number;
  tripId: number | null;
  tripCode?: string | null;
  reasonId: number | null;
  customReason: string | null;
  amount: string;
  date: string;
  reasonText?: string;
}

export default function DriverPenaltyPage() {
  const [monthFilter, setMonthFilter] = useState('');

  const { data: allPenaltiesData, isLoading: loading, isError: loadError, refetch, isFetching } = useDriverPenalties();
  const allPenalties = useMemo((): DriverPenaltyRow[] => {
    if (Array.isArray(allPenaltiesData)) return allPenaltiesData;
    if (allPenaltiesData && 'items' in allPenaltiesData) return allPenaltiesData.items;
    return [];
  }, [allPenaltiesData]);
  const { rootRef } = usePageAnimations({ ready: !loading });

  const filterMonthNum = monthFilter ? parseInt(monthFilter.split('-')[1]) : 0;
  const filterYearNum = monthFilter ? parseInt(monthFilter.split('-')[0]) : 0;
  const { data: filterPeriod, isError: filterPeriodError, refetch: refetchFilterPeriod } = useSalaryPeriod(filterMonthNum, filterYearNum);

  const { data: filteredPenaltiesData, isFetching: filteredFetching, isError: filteredError, refetch: refetchFiltered } = useDriverPenalties(
    filterPeriod ? { dateFrom: filterPeriod.start, dateTo: filterPeriod.end } : undefined
  );
  const filteredPenalties = useMemo((): DriverPenaltyRow[] => {
    if (!monthFilter) return allPenalties;
    if (Array.isArray(filteredPenaltiesData)) return filteredPenaltiesData;
    if (filteredPenaltiesData && 'items' in filteredPenaltiesData) return filteredPenaltiesData.items;
    return allPenalties;
  }, [monthFilter, filteredPenaltiesData, allPenalties]);
  const { rootRef: listRef } = useListAnimations({ itemSelector: '.penalty-violation-row', mode: 'rows', deps: [filteredPenalties] });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const monthLabel = `T${currentMonth}/${currentYear}`;

  const {
    data: currentPeriod,
    isLoading: periodLoading,
    isError: currentPeriodError,
    isFetching: currentPeriodFetching,
    refetch: refetchCurrentPeriod,
  } = useSalaryPeriod(currentMonth, currentYear);

  const monthPenalties = useMemo(() => {
    if (!currentPeriod) return [] as DriverPenaltyRow[];
    return allPenalties.filter(p => {
      const d = p.date || '';
      return d >= currentPeriod.start && d <= currentPeriod.end;
    });
  }, [allPenalties, currentPeriod]);
  const totalMonthAmount = monthPenalties.reduce((s, p) => s + parseFloat(p.amount), 0);
  const incidentCount = monthPenalties.length;

  const isLoadingPeriod = periodLoading || loading;
  const summaryUnavailable = currentPeriodError || (!periodLoading && !currentPeriod);
  const summaryReady = !isLoadingPeriod && !summaryUnavailable;
  const isFiltering = Boolean(monthFilter) && !filterPeriodError && (!filterPeriod || filteredFetching);

  // A failed fetch must not read as "no violations": the unfiltered query
  // drives every zone on this page, so the error screen gates on THAT call
  // only — the month-filtered call can fail without the page being broken.
  if (loadError) return (
    <div className="driver-penalty-page">
      <PageHeader title="Kỷ luật của tôi" description="Lịch sử vi phạm và khấu trừ lương của bạn" iconName="alert" />
      <EmptyState
        role="alert"
        variant="compact"
        context="error"
        title="Không thể tải biên bản vi phạm"
        action={<button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          Thử lại
        </button>}
      />
    </div>
  );

  return (
    <div ref={rootRef} className="driver-penalty-page">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <PageHeader title="Kỷ luật của tôi" description="Lịch sử vi phạm và khấu trừ lương của bạn" iconName="alert" />

      {/* ── Zone 1: Period summary state ─────────────────────────────────────
          2026-09-27: the "Không vi phạm T…" status banner restated the two
          month-scoped KPI cards below it (count + deduction) — the same zero
          signalled twice, plus again in the violations-card header. The KPI
          grid is the single data surface; the banner's own facts are gone.
          Loading + the period-read failure alert stay, because they carry
          state the KPIs cannot (a failed read must not read as "0 vụ"). */}
      {isLoadingPeriod ? (
        <div className="penalty-loading-banner">
          <Loader2 size={16} className="spin" />
          Đang tải dữ liệu kỳ lương...
        </div>
      ) : summaryUnavailable ? (
        <div className="penalty-summary-error" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Chưa tải được tổng hợp {monthLabel}</strong>
            <p>Lịch sử vi phạm vẫn có thể xem bên dưới.</p>
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={currentPeriodFetching}
            onClick={() => void refetchCurrentPeriod()}
          >
            {currentPeriodFetching ? 'Đang tải…' : 'Thử lại'}
          </button>
        </div>
      ) : null}

      {/* ── Zone 2: KPI grid ──────────────────────────────────────────────── */}
      <div className="kpi-grid cols-3 penalty-kpi-grid">
        <div className={`kpi ${!summaryReady ? 'kpi--neutral' : incidentCount > 0 ? 'kpi--danger' : 'kpi--success'}`}>
          <div className="kpi__top"><span className="kpi__label">Vi phạm {monthLabel}</span></div>
          <div className="kpi__value">
            {summaryReady ? incidentCount : '—'}{summaryReady && <span className="kpi__value-unit"> vụ</span>}
          </div>
          <div className="kpi__meta">Trong tháng này</div>
          <div className="kpi__watermark" aria-hidden="true">
            {incidentCount > 0 ? <AlertTriangle size={72} /> : <ShieldCheck size={72} />}
          </div>
        </div>

        <div className={`kpi ${!summaryReady ? 'kpi--neutral' : totalMonthAmount > 0 ? 'kpi--warn' : 'kpi--success'}`}>
          <div className="kpi__top"><span className="kpi__label">Khấu trừ {monthLabel}</span></div>
          <div className="kpi__value">
            {summaryReady ? <Money value={totalMonthAmount} /> : '—'}
          </div>
          <div className="kpi__meta">Trừ vào lương tháng</div>
          <div className="kpi__watermark" aria-hidden="true">
            <svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </div>

        <div className="kpi kpi--neutral">
          <div className="kpi__top"><span className="kpi__label">Tổng biên bản</span></div>
          <div className="kpi__value">
            {loading ? '—' : allPenalties.length}{!loading && <span className="kpi__value-unit"> vụ</span>}
          </div>
          <div className="kpi__meta">Toàn lịch sử</div>
          <div className="kpi__watermark" aria-hidden="true"><AlertOctagon size={72} /></div>
        </div>
      </div>

      {/* ── Zone 3: Violations data card ───────────────────────────────────── */}
      <div className="penalty-data-card">
        <div className="penalty-data-card__header">
          {/* No count here: the KPI grid already states the violation totals,
              and the card header count restated them as a fourth zero. */}
          <span className="penalty-data-card__title">Sổ vi phạm</span>
          <UuiSelectField
            id="penalty-month-filter"
            label="Thời gian"
            hideLabel
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            controlClassName="penalty-month-select"
            wrapperClassName="penalty-month-field"
            options={[
              { value: '', label: 'Tất cả thời gian' },
              ...Array.from({ length: 12 }, (_, i) => {
                const d = new Date();
                d.setDate(1);
                d.setMonth(d.getMonth() - i);
                const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                return { value, label: `Tháng ${d.getMonth() + 1}/${d.getFullYear()}` };
              }),
            ]}
          />
        </div>

        {loading || isFiltering ? (
          <div className="penalty-empty-state" role="status">
            <Loader2 size={24} className="spin" />
            <p className="penalty-empty-state__loading-text">Đang tải…</p>
          </div>
        ) : monthFilter && (filterPeriodError || filteredError) ? (
          <EmptyState
            role="alert"
            variant="compact"
            context="error"
            title="Không thể tải kỳ đã chọn"
            action={<button type="button" className="btn btn--secondary btn--sm" onClick={() => void (filterPeriodError ? refetchFilterPeriod() : refetchFiltered())}>
              Thử lại
            </button>}
          />
        ) : filteredPenalties.length === 0 ? (
          <EmptyState
            variant="compact"
            context="cleared"
            title="Không có biên bản vi phạm"
            description={monthFilter ? 'Không có vi phạm trong khoảng thời gian này.' : 'Bạn chưa có biên bản vi phạm nào.'}
          />
        ) : (
          <div ref={listRef} className="penalty-violation-list">
            {filteredPenalties.map(p => (
              <div key={p.id} className="penalty-violation-row">
                <div className="penalty-violation-row__icon">
                  <AlertTriangle size={16} />
                </div>
                <div className="penalty-violation-row__content">
                  <div className="penalty-violation-row__top">
                    <div className="penalty-violation-row__reason">
                      {p.reasonText || p.customReason || 'Vi phạm nội quy'}
                    </div>
                    <div className="penalty-violation-row__amount">
                      -{formatCurrency(Number(p.amount))}
                    </div>
                  </div>
                  <div className="penalty-violation-row__meta">
                    <span><Calendar size={12} /> {formatDate(p.date)}</span>
                    {p.tripId && p.tripCode && <span><Truck size={12} /> {p.tripCode}</span>}
                  </div>
                  {p.customReason && p.reasonText && (
                    <div className="penalty-violation-row__note">
                      {p.customReason}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Zone 4: Footer note ─────────────────────────────────────────────── */}
      {allPenalties.length > 0 && (
        <div className="penalty-footer-note">
          Các khoản phạt được khấu trừ trực tiếp vào lương sản lượng hàng tháng.
          Liên hệ quản lý nếu có thắc mắc.
        </div>
      )}
    </div>
  );
}
