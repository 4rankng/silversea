import type { PeriodSummary } from '@tingting/shared';
import { formatCurrency } from '../../lib/format';

/**
 * Three-card summary row (Số dư đầu kỳ / Phát sinh trong kỳ / Số dư cuối kỳ)
 * shown above the AR/AP ledger table when a period filter is active.
 *
 * daisyUI `d-stats` is used (prefixed per tokens.css) — stacked through the
 * app's phone/tablet shell, then horizontal on desktop. The "Phát sinh" cell
 * is color-coded by sign:
 *   - positive (net increase in debt) → text-error (more to collect / pay)
 *   - negative (net decrease)         → text-success
 *
 * `entityType` only affects the sub-line wording ("Tăng/Giảm"), not the
 * arithmetic — the backend `periodActivity` is already sign-adjusted per
 * entity type (see `computePeriodSummary` in statement.service.ts).
 */

export interface PeriodSummaryCardsProps {
  summary: PeriodSummary | undefined;
  isLoading: boolean;
  entityType: 'CUSTOMER' | 'VENDOR';
}

export function PeriodSummaryCards({ summary, isLoading, entityType }: PeriodSummaryCardsProps) {
  if (isLoading || !summary) {
    return (
      <div className="d-stats d-stats-vertical w-full overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm period-summary period-summary--loading" aria-busy="true">
        <SkeletonStat label="Số dư đầu kỳ" />
        <SkeletonStat label="Phát sinh trong kỳ" />
        <SkeletonStat label="Số dư cuối kỳ" />
      </div>
    );
  }

  const { openingBalance, closingBalance, periodActivity, debitTotal, creditTotal } = summary;
  // periodActivity > 0 means outstanding balance grew during the period — i.e.
  // more debt accrued than was paid off. We surface that as "danger" (more to
  // collect from the customer / pay the supplier).
  const activityClass = periodActivity > 0
    ? 'text-error'
    : periodActivity < 0
      ? 'text-success'
      : '';
  const activitySign = periodActivity > 0 ? '+' : periodActivity < 0 ? '−' : '';

  // Sub-line "Tăng/Giảm nợ" wording matches the sign convention computed in
  // the backend's `computePeriodSummary`: for AR (CUSTOMER) debits grow the
  // balance; for AP (VENDOR) credits grow the balance. We surface those as
  // "Tăng nợ" / "Giảm nợ" with the entity-appropriate totals.
  const increaseAmount = entityType === 'CUSTOMER' ? debitTotal : creditTotal;
  const decreaseAmount = entityType === 'CUSTOMER' ? creditTotal : debitTotal;

  return (
    <div className="d-stats d-stats-vertical w-full overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm period-summary">
      <div className="d-stat min-w-0">
        <div className="d-stat-title">Số dư đầu kỳ</div>
        <div className="d-stat-value">{formatCurrency(openingBalance)}</div>
        <div className="d-stat-desc">
          {summary.dateFrom ? `Tính đến trước ${summary.dateFrom}` : 'Toàn bộ lịch sử'}
        </div>
      </div>

      <div className="d-stat min-w-0">
        <div className="d-stat-title">Phát sinh trong kỳ</div>
        <div className={`d-stat-value ${activityClass}`}>
          {activitySign}{formatCurrency(Math.abs(periodActivity))}
        </div>
        <div className="d-stat-desc">
          Tăng nợ {formatCurrency(increaseAmount)} · Giảm nợ {formatCurrency(decreaseAmount)}
        </div>
      </div>

      <div className="d-stat min-w-0">
        <div className="d-stat-title">Số dư cuối kỳ</div>
        <div className="d-stat-value">{formatCurrency(closingBalance)}</div>
        <div className="d-stat-desc">
          {summary.dateTo ? `Đến ${summary.dateTo}` : 'Đến hiện tại'}
        </div>
      </div>
    </div>
  );
}

function SkeletonStat({ label }: { label: string }) {
  return (
    <div className="d-stat">
      <div className="d-stat-title">{label}</div>
      <div className="d-stat-value">
        <span className="d-loading d-loading-dots d-loading-sm" aria-label="Đang tải" />
      </div>
      <div className="d-stat-desc">&nbsp;</div>
    </div>
  );
}
