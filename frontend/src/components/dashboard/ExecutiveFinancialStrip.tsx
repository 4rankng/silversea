import { useEffect, useState } from 'react';
import { AlertTriangle, Landmark } from 'lucide-react';
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
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.get<{ executive?: ExecutiveDashboard }>('/reports/dashboard').then((response) => {
      if (active) setData(response.executive ?? null);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [enabled]);
  if (!enabled) return null;
  if (error) return <div className="workflow-notice workflow-notice--error" role="alert">Không thể tải chỉ số tài chính điều hành. Các khu vực vận hành khác vẫn sử dụng được.</div>;
  if (!data) return <div className="executive-strip" role="status" aria-label="Đang tải chỉ số điều hành">Đang tải chỉ số tài chính…</div>;
  const metrics = [
    ['Doanh thu hôm nay', data.revenueToday], ['Doanh thu tháng', data.revenueMonth],
    ['Chi phí tháng', data.costMonth], ['Lợi nhuận tháng', data.profitMonth],
    ['Phải thu', data.accountsReceivable], ['Quá hạn', data.overdueAccountsReceivable],
  ] as const;
  const partial = data.cash.completeness === 'PARTIAL' || data.bank.completeness === 'PARTIAL' || data.reconciliation.status === 'PARTIAL';
  return <section className="executive-strip" aria-label="Tổng quan tài chính điều hành">
    {partial && <div className="workflow-notice workflow-notice--partial"><AlertTriangle size={18}/><span>Một phần số liệu chưa đầy đủ. Các chỉ số bị ảnh hưởng được ghi rõ bên dưới.</span></div>}
    <div className="executive-strip__metrics">{metrics.map(([label, value]) => <div key={label}><span>{label}</span><strong>{formatCurrency(value)}</strong></div>)}</div>
    <div className="executive-strip__liquidity"><div><Landmark size={18}/><span>Tiền mặt — ghi sổ</span><strong>{data.cash.accountCount === 0 ? 'Chưa khả dụng' : formatCurrency(data.cash.bookBalance)}</strong><small>{data.cash.completeness === 'COMPLETE' ? 'Đầy đủ' : 'Một phần'}</small></div><div><Landmark size={18}/><span>Ngân hàng — ghi sổ</span><strong>{data.bank.accountCount === 0 ? 'Chưa khả dụng' : formatCurrency(data.bank.bookBalance)}</strong><small>{data.bank.completeness === 'COMPLETE' ? 'Đầy đủ' : 'Một phần'}</small></div></div>
    <footer>Cập nhật đến {formatDateTimeVN(data.asOf)} · Định nghĩa {data.definitionVersion}</footer>
  </section>;
}
