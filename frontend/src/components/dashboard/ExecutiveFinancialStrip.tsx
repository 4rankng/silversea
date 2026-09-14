import { useEffect, useState } from 'react';
import { AlertTriangle, Banknote, Landmark, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';
import { formatCurrency, formatDateTimeVN } from '../../lib/format';

interface ExecutiveDashboard {
  asOf: string;
  definitionVersion: string;
  revenueToday: number;
  revenueMonth: number;
  costMonth: number;
  profitMonth: number;
  accountsReceivable: number;
  overdueAccountsReceivable: number;
  cash: { bookBalance: number; completeness: 'COMPLETE' | 'PARTIAL'; accountCount: number };
  bank: { bookBalance: number; completeness: 'COMPLETE' | 'PARTIAL'; accountCount: number };
  reconciliation: { status: 'RECONCILED' | 'PARTIAL'; difference: number; note: string };
}

export function ExecutiveFinancialStrip({ enabled }: { enabled: boolean }) {
  const [data, setData] = useState<ExecutiveDashboard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.get<{ executive?: ExecutiveDashboard }>('/reports/dashboard').then((response) => {
      if (active) {
        setData(response.executive ?? null);
        setLoaded(true);
      }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [enabled]);
  if (!enabled) return null;
  if (error) return <div className="workflow-notice workflow-notice--error" role="alert">Không thể tải chỉ số tài chính điều hành. Các khu vực vận hành khác vẫn sử dụng được.</div>;
  if (!loaded) return <div className="executive-strip" role="status" aria-label="Đang tải chỉ số điều hành">Đang tải chỉ số tài chính…</div>;
  if (!data) return <div className="workflow-notice workflow-notice--partial" role="status">Chưa có dữ liệu tài chính điều hành cho kỳ này.</div>;
  const partial = data.cash.completeness === 'PARTIAL' || data.bank.completeness === 'PARTIAL' || data.reconciliation.status === 'PARTIAL';
  const overdueShare = data.accountsReceivable > 0
    ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format((data.overdueAccountsReceivable / data.accountsReceivable) * 100)}% tổng phải thu`
    : 'Không có công nợ phải thu';
  const items = [
    {
      label: 'Doanh thu hôm nay',
      value: formatCurrency(data.revenueToday),
      detail: 'Phát sinh trong ngày',
      icon: TrendingUp,
    },
    {
      label: 'Công nợ quá hạn',
      value: formatCurrency(data.overdueAccountsReceivable),
      detail: overdueShare,
      icon: AlertTriangle,
    },
    {
      label: 'Tiền mặt ghi sổ',
      value: data.cash.accountCount === 0 ? 'Chưa cấu hình' : formatCurrency(data.cash.bookBalance),
      detail: data.cash.completeness === 'COMPLETE' ? 'Dữ liệu đầy đủ' : 'Dữ liệu một phần',
      icon: Banknote,
    },
    {
      label: 'Ngân hàng ghi sổ',
      value: data.bank.accountCount === 0 ? 'Chưa cấu hình' : formatCurrency(data.bank.bookBalance),
      detail: data.bank.completeness === 'COMPLETE' ? 'Dữ liệu đầy đủ' : 'Dữ liệu một phần',
      icon: Landmark,
    },
  ] as const;

  return (
    <section className="executive-strip" aria-labelledby="executive-strip-title">
      <header className="executive-strip__header">
        <div>
          <h2 id="executive-strip-title">Dòng tiền & đối soát</h2>
          <p>Các chỉ số bổ sung không lặp lại báo cáo tháng bên dưới.</p>
        </div>
        <span className={`executive-strip__quality${partial ? ' is-partial' : ''}`}>
          {partial && <AlertTriangle size={14} aria-hidden="true" />}
          {partial ? 'Dữ liệu một phần' : 'Đã đối soát'}
        </span>
      </header>

      <div className="executive-strip__metrics">
        {items.map(({ label, value, detail, icon: Icon }) => (
          <div className="executive-strip__item" key={label}>
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>

      {/* The definition identifier stays available to support via tooltip —
          out of the visible summary an admin reads (QA-033 family). */}
      <footer title={`Định nghĩa dữ liệu: ${data.definitionVersion}`}>
        Cập nhật {formatDateTimeVN(data.asOf)}
      </footer>
    </section>
  );
}
