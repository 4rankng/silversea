import type { ReactNode } from 'react';
import { Money } from '../../components/shared/Money';
import { formatDate } from '../../lib/format';

/**
 * SIL-169 verdict (a): the customers screens' three inline header metrics —
 * Công nợ quá hạn / Ngừng phát sinh 30 ngày / Rủi ro cao — ride INLINE beside
 * the H1 (no card boxes, no extra chrome row). Both /customers and
 * /config/customers render the same row from the same existing feeds (the
 * receivables-aging projection + the customer ledger), so the two screens can
 * never disagree about the numbers.
 *
 * A metric whose feed is unavailable (still loading, or a role the endpoint
 * does not serve) renders '—' — never a fake 0 — and keeps a stable
 * data-testid so a later lane can wire a missing feed without touching markup.
 */
export interface CustomerMetricsData {
  /** d30+d60+over90 outstanding, aging projection; null = unavailable. */
  overdueAmount: number | null;
  /** Customers with any contractual overdue span; null = unavailable. */
  overdueCount: number | null;
  /** Customers idle >30 days by ledger activity; null = feed unavailable. */
  idleCount: number | null;
  /** Oldest idle-since date (ISO); null = no idle customer / unavailable. */
  idleSince: string | null;
  /** Whole-dataset high-risk census; null = unavailable. */
  riskCount: number | null;
}

export function HeaderMetric({ testId, label, value, sub, tone }: {
  testId: string;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: 'overdue';
}) {
  return (
    <div className="cus-metric" data-testid={testId}>
      <span className="cus-metric__label">{label}</span>
      <span className="cus-metric__value" data-tone={tone}>{value}</span>
      {sub != null && <span className="cus-metric__sub">{sub}</span>}
    </div>
  );
}

export function CustomerMetricsRow({ data, extra }: { data: CustomerMetricsData; extra?: ReactNode }) {
  return (
    <div className="cus-metrics" role="group" aria-label="Tổng quan công nợ khách hàng">
      <HeaderMetric
        testId="cus-metric-overdue"
        label="Công nợ quá hạn"
        value={data.overdueAmount != null ? <Money value={data.overdueAmount} compact /> : '—'}
        sub={data.overdueCount != null ? `${data.overdueCount} KH` : 'chưa có dữ liệu'}
        tone={data.overdueAmount != null && data.overdueAmount > 0 ? 'overdue' : undefined}
      />
      <HeaderMetric
        testId="cus-metric-idle30"
        label="Ngừng phát sinh 30 ngày"
        value={data.idleCount != null ? `${data.idleCount} KH` : '—'}
        sub={data.idleSince ? `từ ${formatDate(data.idleSince).slice(0, 5)}` : 'không giao dịch 30 ngày qua'}
      />
      <HeaderMetric
        testId="cus-metric-risk"
        label="Rủi ro cao"
        value={data.riskCount != null ? `${data.riskCount} KH` : '—'}
        sub="cần xử lý"
      />
      {extra}
    </div>
  );
}
