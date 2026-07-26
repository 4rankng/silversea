// DriverPayslipsPage — M8.6 driver payslip view (PRD M08-06-03).
//
// Lists the driver's issued salary periods (CLOSED / REOPENED), newest-first,
// each as a card showing the period, status, and earnings summary. Each card
// links to the existing DriverEarningsPage (via /my-earnings?month=X&year=Y)
// for the per-line basis detail. REOPENED periods show a prominent badge.

import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2, Calendar, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import { PageHeader } from '../../components/UI';
import { useDriverPayslips } from '../../hooks/useDriverQueries';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { resolveEmptyIllustration } from '../../lib/emptyIllustrations';

interface PayslipEarnings {
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
        padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
        background: 'rgba(217,119,6,0.12)', color: 'var(--warn, #d97706)',
      }}>
        <AlertTriangle size={12} /> Mở lại
      </span>
    );
  }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
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
        <span className="dt-card__label" style={{ fontWeight: 700, fontSize: 16 }}>
          {String(month).padStart(2, '0')}/{year}
        </span>
        <StatusBadge status={p.status} />
      </div>

      <div className="dt-card__meta" style={{ marginTop: 8 }}>
        <span className="dt-card__meta-item">
          <DollarSign size={14} />
          <span className="dt-card__meta-text" style={{ fontWeight: 600 }}>
            {formatCurrency(e.netIncome)}
          </span>
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13, color: 'var(--ink-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <TrendingUp size={12} /> LSX: {formatCurrency(e.productionSalary)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Calendar size={12} /> Đường: {formatCurrency(e.roadAllowance)}
        </span>
        {parseFloat(e.penalties) > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--danger)' }}>
            <TrendingDown size={12} /> KL: {formatCurrency(e.penalties)}
          </span>
        )}
      </div>

      {p.note && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          {p.note}
        </div>
      )}
    </Link>
  );
}

export default function DriverPayslipsPage() {
  const { data, isLoading: loading, error: queryError } = useDriverPayslips();
  const error = queryError ? 'Không thể tải bảng lương' : null;
  const { rootRef } = usePageAnimations({ ready: !loading });

  if (loading) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)' }}>
      <Loader2 size={20} className="spin" style={{ display: 'inline-block' }} />
      <p style={{ marginTop: 8 }}>Đang tải bảng lương…</p>
    </div>
  );

  if (error) return (
    <div>
      <PageHeader title="Bảng lương" description="Các kỳ lương đã chốt" />
      <div className="empty-state">
        <AlertTriangle size={36} style={{ color: 'var(--danger)', opacity: 0.7 }} />
        <h3 className="empty-state-title">{error}</h3>
        <p className="empty-state-desc">Hệ thống tạm thời không phản hồi. Vui lòng thử lại sau ít phút.</p>
      </div>
    </div>
  );

  const items: PayslipPeriod[] = data?.items ?? [];

  if (items.length === 0) return (
    <div>
      <PageHeader title="Bảng lương" description="Các kỳ lương đã chốt" />
      <div className="empty-state">
        <img src={resolveEmptyIllustration('empty-trips')} alt="No payslips" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <h3 className="empty-state-title">Chưa có kỳ lương nào</h3>
        <p className="empty-state-desc">Bảng lương sẽ xuất hiện ở đây khi kế toán chốt kỳ.</p>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="driver-trips-page">
      <PageHeader title="Bảng lương" description={`${items.length} kỳ lương`} />
      <div className="driver-trips-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((p, idx) => (
          <PayslipCard key={p.period} p={p} idx={idx} />
        ))}
      </div>
    </div>
  );
}
