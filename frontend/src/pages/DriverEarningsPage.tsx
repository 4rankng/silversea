import { useRef, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, Loader2, Calendar } from 'lucide-react';
import { formatCurrency, formatNumber, formatDate } from '../lib/format';
import { PageHeader } from '../components/UI';
import { useSalaryPeriod, useDriverEarnings, useDriverPenalties, useDriverVehicleAlerts } from '../hooks/useQueries';
import { useDriverEarningsPeriod } from '../hooks/useDriverEarningsPeriod';
import { usePageAnimations, useCounterAnimation } from '../hooks/animations';
import type { CounterTarget } from '../hooks/animations';
import './DriverEarningsPage.css';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';

interface PenaltyEntry {
  id: number;
  amount: string;
  date: string;
  customReason: string | null;
  reasonText: string | null;
}

export default function DriverEarningsPage() {
  const { month, year } = useDriverEarningsPeriod();
  const { data: period } = useSalaryPeriod(month, year);
  const {
    data: earnings,
    isLoading: earningsLoading,
    error: earningsError,
    refetch: refetchEarnings,
    isFetching: earningsFetching,
  } = useDriverEarnings(month, year);
  const penaltyParams = period ? { dateFrom: period.start, dateTo: period.end } : undefined;
  const { data: penaltiesData, isLoading: penaltiesLoading } = useDriverPenalties(penaltyParams);
  // N5 / B4: truck compliance/service reminders (overdue/due). Fetched
  // unconditionally; the section is only rendered when there's at least one
  // non-'ok' alert, so drivers with everything in order see nothing.
  const { data: vehicleAlertsData } = useDriverVehicleAlerts();
  const vehicleAlerts = vehicleAlertsData?.items ?? [];
  const rawPenalties = Array.isArray(penaltiesData)
    ? penaltiesData
    : (penaltiesData && !Array.isArray(penaltiesData) && 'items' in penaltiesData ? penaltiesData.items : []);
  const penalties: PenaltyEntry[] = rawPenalties.map((p) => ({
    id: p.id,
    amount: p.amount,
    date: p.date,
    customReason: p.customReason ?? null,
    reasonText: p.reasonText ?? null,
  }));
  const loading = earningsLoading || penaltiesLoading;
  const error = earningsError ? 'Không thể tải dữ liệu thu nhập' : null;
  const { rootRef } = usePageAnimations({ ready: !loading });
  const heroValueRef = useRef<HTMLSpanElement>(null);
  const kpiRefs = useRef<{
    baseSalary: HTMLSpanElement | null;
    adjustment: HTMLSpanElement | null;
    penalties: HTMLSpanElement | null;
    productionSalary: HTMLSpanElement | null;
    roadAllowance: HTMLSpanElement | null;
    paidOrAdvanced: HTMLSpanElement | null;
    payableBalance: HTMLSpanElement | null;
  }>({ baseSalary: null, adjustment: null, penalties: null, productionSalary: null, roadAllowance: null, paidOrAdvanced: null, payableBalance: null });
  const { animateCounters } = useCounterAnimation({ delay: 100 });

  useEffect(() => {
    if (!earnings) return;
    const targets: CounterTarget[] = [];
    const salaryNum = parseFloat(earnings.baseSalary);
    const penaltyNum = parseFloat(earnings.penalties);

    // The hero ("LƯƠNG CHƯA THANH TOÁN") and the summary tile
    // ("CÒN CHƯA THANH TOÁN") show the same payableBalance value. Animating
    // them separately in a single staggered list caused them to render
    // different values mid-animation (hero at 500.000 while summary was
    // still ticking up through 498.720). Render both as static so the
    // headline number and its summary tile are always in lockstep, and
    // keep the counter animation for the supporting breakdown KPIs only.
    if (kpiRefs.current.baseSalary) targets.push({ el: kpiRefs.current.baseSalary, value: salaryNum, suffix: ' đ' });
    // F2 / B2 — trip-income cards always animate (headline breakdown).
    const productionNum = parseFloat(earnings.productionSalary);
    const roadNum = parseFloat(earnings.roadAllowance);
    const paidOrAdvancedNum = parseFloat(earnings.paidOrAdvanced ?? '0');
    if (kpiRefs.current.productionSalary) targets.push({ el: kpiRefs.current.productionSalary, value: productionNum, suffix: ' đ' });
    if (kpiRefs.current.roadAllowance) targets.push({ el: kpiRefs.current.roadAllowance, value: roadNum, suffix: ' đ' });
    if (kpiRefs.current.paidOrAdvanced) targets.push({ el: kpiRefs.current.paidOrAdvanced, value: paidOrAdvancedNum, suffix: ' đ' });
    if (penaltyNum > 0 && kpiRefs.current.penalties) targets.push({ el: kpiRefs.current.penalties, value: penaltyNum, prefix: '-', suffix: ' đ' });
    if (earnings.adjustment !== undefined && earnings.adjustment !== 0 && kpiRefs.current.adjustment) {
      targets.push({ el: kpiRefs.current.adjustment, value: Math.abs(earnings.adjustment), prefix: earnings.adjustment > 0 ? '+' : '-', suffix: ' đ' });
    }
    if (targets.length > 0) animateCounters(targets);
  }, [earnings, animateCounters]);

  if (loading) return (
    <div className="driver-earnings-page">
      <PageHeader title="Thu nhập" description="Tổng hợp thu nhập và khấu trừ" />
      <div className="earnings-loading">
        <Loader2 size={20} className="spin" />
        <p>Đang tải dữ liệu thu nhập…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="driver-earnings-page">
      <PageHeader title="Thu nhập" description="Tổng hợp thu nhập và khấu trừ" />
      <div className="empty-state" role="alert">
        <AlertTriangle size={36} style={{ color: 'var(--danger)', opacity: 0.7 }} />
        <h3 className="empty-state-title">{error}</h3>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => void refetchEarnings()}
          disabled={earningsFetching}
        >
          Thử lại
        </button>
      </div>
    </div>
  );

  if (!earnings) return null;

  const netNum = parseFloat(earnings.netIncome);
  const payableNum = parseFloat(earnings.payableBalance);
  const adjustmentNum = earnings.adjustment ?? 0;
  const isPositive = payableNum >= 0;
  const penaltyNum = parseFloat(earnings.penalties);
  const tripIncomeNum = parseFloat(earnings.productionSalary) + parseFloat(earnings.roadAllowance);
  const adjustmentLabel = adjustmentNum >= 0 ? 'Thưởng công' : 'Trừ công';
  const adjustmentValue = `${adjustmentNum >= 0 ? '+' : '-'}${formatNumber(Math.abs(adjustmentNum))}`;
  // KP-172: negative balance can be from excess advances, penalty
  // deductions, or both. Compare pre-penalty income to advances to
  // pick an accurate hero label.
  const paidOrAdvancedNum2 = parseFloat(earnings.paidOrAdvanced ?? '0');
  const incomeBeforePenalties = netNum + penaltyNum + tripIncomeNum;
  const payableLabel = payableNum >= 0
    ? 'Lương chưa thanh toán'
    : (incomeBeforePenalties < paidOrAdvancedNum2
        ? 'Số dư sổ lương'
        : 'Khấu trừ vượt thu nhập');

  return (
    <div ref={rootRef} className="driver-earnings-page">
      <PageHeader
        title="Thu nhập"
        description="Tổng hợp thu nhập và khấu trừ"
      />

      {/* ═══ N5 / B4 — Vehicle reminders (only when overdue/due) ═══ */}
      {vehicleAlerts.length > 0 && (
        <div className="vehicle-alerts-strip fade-up" role="status" aria-live="polite">
          <div className="vehicle-alerts-strip__head">
            <AlertTriangle size={16} />
            <span className="vehicle-alerts-strip__title">Nhắc nhở xe</span>
          </div>
          <ul className="vehicle-alerts-strip__list">
            {vehicleAlerts.map(a => (
              <li
                key={a.field}
                className={`vehicle-alerts-strip__item vehicle-alerts-strip__item--${a.status}`}
              >
                <span className="vehicle-alerts-strip__label">{a.label}</span>
                <span className="vehicle-alerts-strip__date">{formatDate(a.date)}</span>
                <span className="vehicle-alerts-strip__days">
                  {a.daysUntil < 0
                    ? `Quá hạn ${Math.abs(a.daysUntil)} ngày`
                    : `Còn ${a.daysUntil} ngày`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ═══ Zone 1 — Salary answer card ═══ */}
      <div className={`earnings-hero-bento fade-up ${isPositive ? 'earnings-hero-bento--positive' : 'earnings-hero-bento--negative'}`}>
        <div className="earnings-hero-bento__content">
          <p className="earnings-hero-bento__eyebrow">{payableLabel}</p>
          <div className="earnings-hero-bento__amount">
            <span ref={heroValueRef}>{formatNumber(earnings.payableBalance)}</span>
            <span className="earnings-hero-bento__currency">đ</span>
          </div>
          <p className="earnings-hero-bento__note">
            Số dư sổ lương hiện tại. Các khoản đã tạm ứng/đã thanh toán nằm trong phần tóm tắt bên dưới.
          </p>
        </div>
        <div className="earnings-hero-bento__icon">
          {isPositive
            ? <TrendingUp size={24} />
            : <TrendingDown size={24} />
          }
        </div>
        <div className="earnings-hero-bento__watermark">
          <DollarSign size={120} />
        </div>
      </div>

      {earnings.salaryReconciliationRequired && (
        <p className="earnings-empty-note" role="status">
          {earnings.salarySnapshotState === 'UNAVAILABLE'
            ? 'Kỳ cũ chưa có bản lương đã chốt. Số liệu chỉ tham khảo; liên hệ kế toán để đối chiếu chứng từ gốc.'
            : 'Ngày công được bổ sung sau khi chốt. Bản lương giữ nguyên; kế toán sẽ ghi điều chỉnh ở kỳ đang mở nếu có chênh lệch.'}
        </p>
      )}
      {/* ═══ Zone 2 — Payslip summary ═══ */}
      <div className="earnings-equation-card fade-up-2" aria-label="Tóm tắt thu nhập">
        <div className="earnings-equation-card__head">
          <span>Tóm tắt kỳ này</span>
          <strong>{month.toString().padStart(2, '0')}/{year}</strong>
        </div>
        <div className="earnings-equation">
          <div className="earnings-equation__item">
            <span>Lương ngày công</span>
            <strong>{formatNumber(earnings.netIncome)} đ</strong>
          </div>
          <div className="earnings-equation__item">
            <span>Lương chuyến + đi đường</span>
            <strong>{formatNumber(tripIncomeNum)} đ</strong>
          </div>
          <div className="earnings-equation__item">
            <span>Đã tạm ứng/đã thanh toán</span>
            <strong ref={(el) => { kpiRefs.current.paidOrAdvanced = el; }}>{formatNumber(earnings.paidOrAdvanced ?? '0')} đ</strong>
          </div>
          <div className={`earnings-equation__item earnings-equation__item--total ${payableNum < 0 ? 'earnings-equation__item--danger' : 'earnings-equation__item--success'}`}>
            <span>Còn chưa thanh toán</span>
            <strong ref={(el) => { kpiRefs.current.payableBalance = el; }}>{formatNumber(earnings.payableBalance)} đ</strong>
          </div>
        </div>
      </div>

      <div className="earnings-ledger-grid fade-up-2">
        <section className="earnings-ledger-card">
          <div className="earnings-ledger-card__header">
            <span>Lương ngày công</span>
            <strong>{formatNumber(netNum)} đ</strong>
          </div>
          <dl className="earnings-ledger-list">
            <div>
              <dt>Lương cơ bản</dt>
              <dd ref={(el) => { kpiRefs.current.baseSalary = el; }}>{formatNumber(earnings.baseSalary)} đ</dd>
            </div>
            {adjustmentNum !== 0 && (
              <div>
                <dt>{adjustmentLabel}</dt>
                <dd className={adjustmentNum >= 0 ? 'is-success' : 'is-danger'}>{adjustmentValue} đ</dd>
              </div>
            )}
            <div>
              <dt>Khấu trừ kỷ luật</dt>
              <dd ref={(el) => { kpiRefs.current.penalties = el; }} className={penaltyNum > 0 ? 'is-danger' : ''}>{penaltyNum > 0 ? '-' : ''}{formatNumber(earnings.penalties)} đ</dd>
            </div>
            <div>
              <dt>Lương thực tế</dt>
              <dd>{formatNumber(earnings.netIncome)} đ</dd>
            </div>
          </dl>
        </section>

        <section className="earnings-ledger-card">
          <div className="earnings-ledger-card__header">
            <span>Lương chuyến & thanh toán</span>
            <strong>{formatNumber(tripIncomeNum)} đ</strong>
          </div>
          <dl className="earnings-ledger-list">
            <div>
              <dt>Lương sản xuất</dt>
              <dd ref={(el) => { kpiRefs.current.productionSalary = el; }}>{formatNumber(earnings.productionSalary)} đ</dd>
            </div>
            <div>
              <dt>Tiền đi đường</dt>
              <dd ref={(el) => { kpiRefs.current.roadAllowance = el; }}>{formatNumber(earnings.roadAllowance)} đ</dd>
            </div>
            <div>
              <dt>Đã tạm ứng/đã thanh toán</dt>
              <dd>{formatNumber(earnings.paidOrAdvanced ?? '0')} đ</dd>
            </div>
            <div className="earnings-ledger-list__note">
              <dt>Ghi chú</dt>
              <dd>Số chưa thanh toán là số dư sổ lương hiện tại, không phải phép cộng trực tiếp của các dòng phía trên. "Đã tạm ứng/đã thanh toán" chỉ tính tiền mặt công ty đã thực chi cho lái xe (không bao gồm khấu trừ kỷ luật).</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* ═══ Zone 3 — Work-day Strip ═══ */}
      {earnings.standardWorkDays !== undefined && (
        <div className="earnings-workday-strip fade-up-3">
          <span>Công chuẩn: <strong>{earnings.standardWorkDays} ngày</strong></span>
          {earnings.paidDays !== undefined && (
            <span>Công hưởng lương: <strong>{earnings.paidDays} ngày</strong></span>
          )}
          {earnings.dailyRate !== undefined && earnings.dailyRate > 0 && (
            <span>Đơn giá ngày: <strong>{formatNumber(earnings.dailyRate)} đ</strong></span>
          )}
        </div>
      )}

      {/* ═══ Zone 4 — Penalties Panel ═══ */}
      <div className="earnings-penalties-panel fade-up-3">
        <div className="earnings-penalties-panel__header">
          <span className="earnings-penalties-panel__title">Lịch sử khấu trừ</span>
          <span className="earnings-penalties-panel__count">{penalties.length} khoản khấu trừ</span>
        </div>
        {penalties.length === 0 ? (
          <div className="earnings-penalties-empty">
            <img
              src={resolveEmptyIllustration('empty-earnings')}
              alt=""
              aria-hidden="true"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <p>Chưa có khoản khấu trừ nào</p>
          </div>
        ) : (
          penalties.map((p) => (
            <div key={p.id} className="earnings-penalty-row">
              <div className="earnings-penalty-row__icon">
                <AlertTriangle size={14} />
              </div>
              <div className="earnings-penalty-row__content">
                <div className="earnings-penalty-row__reason">
                  {p.reasonText || p.customReason || 'Vi phạm nội quy'}
                </div>
                <div className="earnings-penalty-row__date">
                  <Calendar size={11} />
                  {formatDate(p.date)}
                </div>
              </div>
              <div className="earnings-penalty-row__amount">
                -{formatCurrency(p.amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
