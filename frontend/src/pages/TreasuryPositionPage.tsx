import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Landmark, RotateCcw } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState } from '../design-system';
import { formatCurrency, formatDateTimeVN } from '../lib/format';
import { customerServiceFinanceClient, type TreasuryPosition } from '../api/customerServiceFinanceClient';
import './WorkflowFinance.css';

const COVERAGE = { COMPLETE: 'Đầy đủ', PARTIAL: 'Một phần', UNAVAILABLE: 'Chưa khả dụng' } as const;

export default function TreasuryPositionPage() {
  const [data, setData] = useState<TreasuryPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await customerServiceFinanceClient.getTreasuryPosition()); } catch (err) { setError(err instanceof Error ? err.message : 'Không thể tải số dư ghi sổ.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => data?.accounts.reduce((acc, account) => { acc[account.type] += account.bookBalance; return acc; }, { CASH: 0, BANK: 0 }) ?? { CASH: 0, BANK: 0 }, [data]);
  return <div className="workflow-page">
    <Breadcrumbs items={[{ label: 'Tài chính', to: '/finance' }, { label: 'Sổ quỹ / ngân hàng' }]} />
    <PageHeader title="Sổ quỹ / ngân hàng" iconName="cashflow" description="Số dư ghi sổ từ các khoản thu, chi đã liên kết nguồn tiền." />
    {data && <div className={`workflow-notice workflow-notice--${data.coverage.toLowerCase()}`}><strong>{COVERAGE[data.coverage]}</strong><span>Cập nhật đến {formatDateTimeVN(data.asOf)}. Đây là số dư ghi sổ, không phải số dư sao kê ngân hàng.</span></div>}
    <div className="workflow-summary"><div><Banknote/><span>Tiền mặt — Số dư ghi sổ</span><strong>{loading ? '—' : formatCurrency(totals.CASH)}</strong></div><div><Landmark/><span>Ngân hàng — Số dư ghi sổ</span><strong>{loading ? '—' : formatCurrency(totals.BANK)}</strong></div></div>
    {error ? <div className="workflow-notice workflow-notice--error" role="alert">{error}<button className="btn btn--ghost" onClick={() => void load()}><RotateCcw size={16}/> Thử lại</button></div> : !loading && data?.accounts.length === 0 ? <EmptyState icon={Landmark} title="Chưa có tài khoản ghi sổ" description="Số dư sẽ xuất hiện sau khi tài khoản được thiết lập và chuyển đổi." /> : <div className="workflow-list">{data?.accounts.map((account) => <article className="workflow-row workflow-row--treasury" key={account.accountId}><div className="workflow-row__primary"><strong>{account.name}</strong><span>{account.code} · {account.type === 'CASH' ? 'Tiền mặt' : 'Ngân hàng'}</span><small>{account.cutoverAt ? `Chuyển đổi: ${formatDateTimeVN(account.cutoverAt)}` : 'Chưa chuyển đổi đầy đủ'}</small></div><dl className="workflow-money"><div><dt>Đầu kỳ</dt><dd>{formatCurrency(account.openingBalance)}</dd></div><div><dt>Thu</dt><dd>{formatCurrency(account.totalIn)}</dd></div><div><dt>Chi</dt><dd>{formatCurrency(account.totalOut)}</dd></div><div><dt>Số dư ghi sổ</dt><dd>{formatCurrency(account.bookBalance)}</dd></div></dl><span className={`workflow-pill workflow-pill--${account.completeness.toLowerCase()}`}>{COVERAGE[account.completeness]}</span></article>)}</div>}
  </div>;
}
