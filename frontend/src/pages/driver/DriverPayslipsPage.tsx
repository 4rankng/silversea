// DriverPayslipsPage — M8.6 driver payslip view (PRD M08-06-03).
//
// Lists the driver's issued salary periods (CLOSED / REOPENED), newest-first,
// each as a card showing the period, status, and earnings summary. Each card
// links to the existing DriverEarningsPage (via /my-earnings?month=X&year=Y)
// for the per-line basis detail. REOPENED periods show a prominent badge.

import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Calendar, DollarSign, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { PageHeader } from '../../components/UI';
import { useDriverPayslips } from '../../hooks/useDriverQueries';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import './DriverSecondaryPages.css';
import { EmptyState } from '../../design-system';

interface PayslipEarnings {
  salarySnapshotState?: 'LIVE' | 'CONFIRMED' | 'UNAVAILABLE';
  salaryReconciliationRequired?: boolean;
  netIncome: string;
  productionSalary: string;
  roadAllowance: string;
  penalties: string;
  paidOrAdvanced: string;
  payableBalance: string;
  periodStart: string;
  periodEnd: string;
}

interface PayslipPeriod {
  period: string;
  status: string;
  closedAt: string | null;
  closedByName: string | null;
  note: string | null;
  earnings: PayslipEarnings;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'REOPENED') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 12, fontSize: 'var(--text-caption-size)', fontWeight: 600,
        background: 'rgba(217,119,6,0.12)', color: 'var(--warn, #d97706)',
      }}>
        <AlertTriangle size={12} /> Mở lại
      </span>
    );
  }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 'var(--text-caption-size)', fontWeight: 600,
      background: 'rgba(22,163,74,0.12)', color: 'var(--ok, #16a34a)',
    }}>
      Đã chốt
    </span>
  );
}

function PayslipCard({ p, idx }: { p: PayslipPeriod; idx: number }) {
  const [yearStr, monthStr] = p.period.split('-');
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  const e = p.earnings;

  return (
    <Link
      to={`/my-earnings?month=${month}&year=${year}`}
      className="driver-trip-card"
      data-testid={`payslip-card-${p.period}`}
      style={{ '--strip': p.status === 'REOPENED' ? 'var(--warn, #d97706)' : 'var(--ok, #16a34a)', animationDelay: `${idx * 40}ms` } as React.CSSProperties}
    >
      <div className="dt-card__header">
        <span className="dt-card__label" style={{ fontWeight: 700, fontSize: 'var(--text-section-size)' }}>
          {String(month).padStart(2, '0')}/{year}
        </span>
        {e.salarySnapshotState === 'UNAVAILABLE' ? <span>Cần đối chiếu bản gốc</span> : <StatusBadge status={p.status} />}
      </div>

      <div className="dt-card__meta">
        <span className="dt-card__meta-item">
          <DollarSign size={14} />
          <span className="driver-payslip__salary">
            <span>Lương ngày công</span>
            <strong>{formatCurrency(e.netIncome)}</strong>
          </span>
        </span>
      </div>

      {e.salaryReconciliationRequired && <p role="status">{e.salarySnapshotState === 'UNAVAILABLE'
        ? 'Số liệu tham khảo; chưa có bản lương đã chốt.'
        : 'Có ngày công bổ sung sau chốt; bản lương giữ nguyên.'}</p>}
      <div className="driver-payslip__metrics">
        <span className="driver-payslip__metric">
          <span><TrendingUp size={12} /> Lương sản xuất</span>
          <strong>{formatCurrency(e.productionSalary)}</strong>
        </span>
        <span className="driver-payslip__metric">
          <span><Calendar size={12} /> Tiền đường</span>
          <strong>{formatCurrency(e.roadAllowance)}</strong>
        </span>
        {parseFloat(e.penalties) > 0 && (
          <span className="driver-payslip__metric driver-payslip__metric--deduction">
            <span><TrendingDown size={12} /> Kỷ luật</span>
            <strong>{formatCurrency(e.penalties)}</strong>
          </span>
        )}
      </div>

      {p.note && (
        <div style={{ marginTop: 6, fontSize: 'var(--text-caption-size)', color: 'var(--ink-3)', fontStyle: 'italic' }}>
          {p.note}
        </div>
      )}
      <div className="dt-card__footer driver-payslip__footer">
        <span>Xem chi tiết thu nhập</span>
        <ArrowRight size={14} aria-hidden="true" />
      </div>
    </Link>
  );
}

export default function DriverPayslipsPage() {
  const { data, isLoading: loading, error: queryError, refetch, isFetching } = useDriverPayslips();
  const error = queryError ? 'Không thể tải bảng lương' : null;
  const { rootRef } = usePageAnimations({ ready: !loading });

  if (loading) return (
    <div className="driver-secondary-page">
      <PageHeader title="Bảng lương" description="Các kỳ đã phát hành phiếu lương" />
      <div className="driver-secondary-state" role="status">
        <Loader2 size={20} className="spin" />
        <p>Đang tải bảng lương…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="driver-secondary-page">
      <PageHeader title="Bảng lương" description="Các kỳ đã phát hành phiếu lương" />
      <EmptyState
        role="alert"
        variant="compact"
        icon={AlertTriangle}
        title={error}
        description="Hệ thống tạm thời không phản hồi."
        action={<button type="button" className="btn btn--secondary btn--sm" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? 'Đang tải…' : 'Thử lại'}
        </button>}
      />
    </div>
  );

  const items: PayslipPeriod[] = data?.items ?? [];

  if (items.length === 0) return (
    <div className="driver-secondary-page">
      <PageHeader title="Bảng lương" description="Các kỳ đã phát hành phiếu lương" />
      <EmptyState
        variant="compact"
        illustration="empty-trips"
        title="Chưa có kỳ lương nào"
        description="Bảng lương sẽ xuất hiện ở đây khi kế toán chốt kỳ."
      />
    </div>
  );

  return (
    <div ref={rootRef} className="driver-secondary-page">
      <PageHeader title="Bảng lương" description={`${items.length} kỳ đã phát hành`} />
      <div className="driver-secondary-list">
        {items.map((p, idx) => (
          <PayslipCard key={p.period} p={p} idx={idx} />
        ))}
      </div>
    </div>
  );
}
