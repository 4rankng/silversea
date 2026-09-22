import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, Loader2, Calendar, Minus } from 'lucide-react';
import { formatCurrency, formatNumber, formatDate } from '../lib/format';
import { PageHeader } from '../components/UI';
import { useSalaryPeriod, useDriverEarnings, useDriverPenalties, useDriverVehicleAlerts } from '../hooks/useQueries';
import { useDriverEarningsPeriod } from '../hooks/useDriverEarningsPeriod';
import { usePageAnimations } from '../hooks/animations';
import './DriverEarningsPage.css';
import { EmptyState } from '../design-system';

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
  const { data: penaltiesData, isLoading: penaltiesLoading, error: penaltiesError, refetch: refetchPenalties, isFetching: penaltiesFetching } = useDriverPenalties(penaltyParams);
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
      <EmptyState
        role="alert"
        variant="compact"
        icon={AlertTriangle}
        title={error}
        action={<button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => void refetchEarnings()}
          disabled={earningsFetching}
        >
          Thử lại
        </button>}
      />
    </div>
  );

  if (!earnings) return null;

  const netNum = parseFloat(earnings.netIncome);
  const payableNum = parseFloat(earnings.payableBalance);
  const adjustmentNum = earnings.adjustment ?? 0;
  // Surface color encodes money state: green only for a truly positive
  // balance, bronze for negative, neutral for zero or missing data.
  const payableState = payableNum > 0 ? 'positive' : payableNum < 0 ? 'negative' : 'zero';
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
      <div className={`earnings-hero-bento fade-up earnings-hero-bento--${payableState}`}>
        <div className="earnings-hero-bento__content">
          <p className="earnings-hero-bento__eyebrow">{payableLabel}</p>
          <div className="earnings-hero-bento__amount">
            <span>{formatNumber(earnings.payableBalance)}</span>
            <span className="earnings-hero-bento__currency">đ</span>
          </div>
          <p className="earnings-hero-bento__note">
            Số dư sổ lương hiện tại. Các khoản đã tạm ứng/đã thanh toán nằm trong phần tóm tắt bên dưới.
          </p>
        </div>
        <div className="earnings-hero-bento__icon">
          {payableState === 'positive'
            ? <TrendingUp size={24} />
            : payableState === 'negative'
              ? <TrendingDown size={24} />
              : <Minus size={24} />
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
            <strong>{formatNumber(earnings.paidOrAdvanced ?? '0')} đ</strong>
          </div>
          <div className={`earnings-equation__item earnings-equation__item--total ${payableState === 'negative' ? 'earnings-equation__item--danger' : payableState === 'positive' ? 'earnings-equation__item--success' : 'earnings-equation__item--zero'}`}>
            <span>Còn chưa thanh toán</span>
            <strong>{formatNumber(earnings.payableBalance)} đ</strong>
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
              <dd>{formatNumber(earnings.baseSalary)} đ</dd>
            </div>
            {adjustmentNum !== 0 && (
              <div>
                <dt>{adjustmentLabel}</dt>
                <dd className={adjustmentNum >= 0 ? 'is-success' : 'is-danger'}>{adjustmentValue} đ</dd>
              </div>
            )}
            <div>
              <dt>Khấu trừ kỷ luật</dt>
              <dd className={penaltyNum > 0 ? 'is-danger' : ''}>{penaltyNum > 0 ? '-' : ''}{formatNumber(earnings.penalties)} đ</dd>
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
              <dd>{formatNumber(earnings.productionSalary)} đ</dd>
            </div>
            <div>
              <dt>Tiền đi đường</dt>
              <dd>{formatNumber(earnings.roadAllowance)} đ</dd>
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
          {!penaltiesError && <span className="earnings-penalties-panel__count">{penalties.length} khoản khấu trừ</span>}
        </div>
        {penaltiesError ? (
          <div className="earnings-penalties-empty" role="alert">
            <p>Không thể tải lịch sử khấu trừ</p>
            <button type="button" className="btn btn--secondary btn--sm" aria-label="Thử lại lịch sử khấu trừ" disabled={penaltiesFetching} onClick={() => void refetchPenalties()}>
              Thử lại
            </button>
          </div>
        ) : penalties.length === 0 ? (
          <div className="earnings-penalties-empty">
            <EmptyState variant="compact" context="earnings" title="Chưa có khoản khấu trừ nào" />
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
