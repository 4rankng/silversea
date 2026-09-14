import { useState, useMemo } from 'react';
import { formatCurrency, formatDate } from '../lib/format';
import { Money } from '../components/shared/Money';
import { ShieldCheck, AlertTriangle, AlertOctagon, Loader2, Calendar, Truck } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { useSalaryPeriod, useDriverPenalties } from '../hooks/useQueries';
import { usePageAnimations, useListAnimations } from '../hooks/animations';
import { UuiSelectField } from '../design-system';
import './DriverPenaltyPage.css';

interface DriverPenaltyRow {
  id: number;
  driverId: number;
  tripId: number | null;
  tripCode?: string | null;
  reasonId: number | null;
  customReason: string | null;
  amount: string;
  date: string;
  status?: 'PENDING' | 'ACTIVE' | 'CANCELED';
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
  const { data: filterPeriod } = useSalaryPeriod(filterMonthNum, filterYearNum);

  const { data: filteredPenaltiesData } = useDriverPenalties(
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

  const { data: currentPeriod, isLoading: periodLoading } = useSalaryPeriod(currentMonth, currentYear);

  // Only approved (ACTIVE) records deduct — pending records are visible in
  // the list below but never count into the deduction figures.
  const monthPenalties = useMemo(() => {
    if (!currentPeriod) return [] as DriverPenaltyRow[];
    return allPenalties.filter(p => {
      const d = p.date || '';
      return d >= currentPeriod.start && d <= currentPeriod.end && p.status !== 'PENDING';
    });
  }, [allPenalties, currentPeriod]);
  const totalMonthAmount = monthPenalties.reduce((s, p) => s + parseFloat(p.amount), 0);
  const incidentCount = monthPenalties.length;
  const isSafeThisMonth = incidentCount === 0;

  const isLoadingPeriod = periodLoading;

  // A failed fetch must not read as "no violations": the unfiltered query
  // drives every zone on this page, so the error screen gates on THAT call
  // only — the month-filtered call can fail without the page being broken.
  if (loadError) return (
    <div className="driver-penalty-page">
      <PageHeader title="Kỷ luật của tôi" description="Lịch sử vi phạm và khấu trừ lương của bạn" iconName="alert" />
      <div className="empty-state" role="alert">
        <AlertTriangle size={36} style={{ color: 'var(--danger)', opacity: 0.7 }} />
        <h3 className="empty-state-title">Không thể tải biên bản vi phạm</h3>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          Thử lại
        </button>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="driver-penalty-page">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <PageHeader title="Kỷ luật của tôi" description="Lịch sử vi phạm và khấu trừ lương của bạn" iconName="alert" />

      {/* ── Zone 1: Status banner ───────────────────────────────────────────── */}
      {isLoadingPeriod ? (
        <div className="penalty-loading-banner">
          <Loader2 size={16} className="spin" />
          Đang tải dữ liệu kỳ lương...
        </div>
      ) : (
        <div className={`penalty-status-banner ${isSafeThisMonth ? 'penalty-status-banner--safe' : 'penalty-status-banner--violation'}`}>
          <div className="penalty-status-banner__icon">
            {isSafeThisMonth ? <ShieldCheck size={22} /> : <AlertOctagon size={22} />}
          </div>
          <div>
            <div className="penalty-status-banner__title">
              {isSafeThisMonth ? `Không vi phạm ${monthLabel}` : `${incidentCount} vi phạm ${monthLabel}`}
            </div>
            <div className="penalty-status-banner__subtitle">
              {isSafeThisMonth
                ? 'Bạn đang chấp hành tốt nội quy công ty. Tiếp tục phát huy!'
                : `Tổng khấu trừ lương: ${formatCurrency(totalMonthAmount)}`
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Zone 2: KPI grid ──────────────────────────────────────────────── */}
      <div className="kpi-grid cols-3 penalty-kpi-grid">
        <div className={`kpi ${incidentCount > 0 ? 'kpi--danger' : 'kpi--success'}`}>
          <div className="kpi__top"><span className="kpi__label">Vi phạm {monthLabel}</span></div>
          <div className="kpi__value">
            {incidentCount}<span className="kpi__value-unit"> vụ</span>
          </div>
          <div className="kpi__meta">Trong tháng này</div>
          <div className="kpi__watermark" aria-hidden="true">
            {incidentCount > 0 ? <AlertTriangle size={72} /> : <ShieldCheck size={72} />}
          </div>
        </div>

        <div className={`kpi ${totalMonthAmount > 0 ? 'kpi--warn' : 'kpi--success'}`}>
          <div className="kpi__top"><span className="kpi__label">Khấu trừ {monthLabel}</span></div>
          <div className="kpi__value">
            {totalMonthAmount > 0 ? <Money value={totalMonthAmount} /> : '—'}
          </div>
          <div className="kpi__meta">Trừ vào lương tháng</div>
          <div className="kpi__watermark" aria-hidden="true">
            <svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
        </div>

        <div className="kpi kpi--neutral">
          <div className="kpi__top"><span className="kpi__label">Tổng biên bản</span></div>
          <div className="kpi__value">
            {allPenalties.length}<span className="kpi__value-unit"> vụ</span>
          </div>
          <div className="kpi__meta">Toàn lịch sử</div>
          <div className="kpi__watermark" aria-hidden="true"><AlertOctagon size={72} /></div>
        </div>
      </div>

      {/* ── Zone 3: Violations data card ───────────────────────────────────── */}
      <div className="penalty-data-card">
        <div className="penalty-data-card__header">
          <span className="penalty-data-card__title">
            Sổ vi phạm · {filteredPenalties.length}
          </span>
          <UuiSelectField
            id="penalty-month-filter"
            label="Thời gian"
            hideLabel
            value={monthFilter}
            onChange={e => setMonthFilter(e.target.value)}
            controlClassName="penalty-month-select"
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

        {loading ? (
          <div className="penalty-empty-state">
            <Loader2 size={24} className="spin" />
            <p className="penalty-empty-state__loading-text">Đang tải…</p>
          </div>
        ) : filteredPenalties.length === 0 ? (
          <div className="penalty-empty-state">
            <div className="penalty-empty-state__icon">
              <ShieldCheck size={32} />
            </div>
            <p className="penalty-empty-state__title">Không có biên bản vi phạm</p>
            <p className="penalty-empty-state__desc">
              {monthFilter ? 'Không có vi phạm trong khoảng thời gian này.' : 'Bạn chưa có biên bản vi phạm nào.'}
            </p>
          </div>
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
                    {p.status === 'PENDING' ? (
                      <span className="penalty-violation-row__amount penalty-violation-row__amount--pending">
                        Chờ duyệt
                      </span>
                    ) : (
                      <div className="penalty-violation-row__amount">
                        -{formatCurrency(Number(p.amount))}
                      </div>
                    )}
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
