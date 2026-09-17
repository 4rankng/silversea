import { useCallback, useEffect, useMemo, useState } from 'react';
import { Role } from '@tingting/shared';
import { useAuth } from '../hooks/useAuth';
import { TreasuryAccountDrawer } from '../features/treasury/TreasuryAccountDrawer';
import { Banknote, Landmark, RotateCcw } from 'lucide-react';
import { PageHeader, StatusPill } from '../components/UI';
import { SortHeader } from '../components/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState } from '../design-system';
import { formatCurrency, formatDateTimeVN } from '../lib/format';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import { customerServiceFinanceClient, type TreasuryPosition } from '../api/customerServiceFinanceClient';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './TreasuryPositionPage.css';

const COVERAGE = { COMPLETE: 'Đầy đủ', PARTIAL: 'Một phần', UNAVAILABLE: 'Chưa khả dụng' } as const;
const COVERAGE_VARIANT = { COMPLETE: 'success', PARTIAL: 'warn', UNAVAILABLE: 'neutral' } as const;

export default function TreasuryPositionPage() {
  const { user } = useAuth();
  const canConfigure = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const [editing, setEditing] = useState<TreasuryPosition['accounts'][number] | 'new' | null>(null);
  const [data, setData] = useState<TreasuryPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Server-side column sort; primitives ride the load callback so changing the
  // sort refetches without any object-identity dep (the infinite-refetch trap).
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const load = useCallback(async () => { setLoading(true); setError(null); try { setData(await customerServiceFinanceClient.getTreasuryPosition(sortBy ? { sortBy, sortDir } : undefined)); } catch (err) { setError(err instanceof Error ? err.message : 'Không thể tải số dư ghi sổ.'); } finally { setLoading(false); } }, [sortBy, sortDir]);
  useEffect(() => { void load(); }, [load]);
  const sort = useMemo<TableSortState | null>(() => (sortBy ? { by: sortBy, dir: sortDir } : null), [sortBy, sortDir]);
  const handleSortChange = useCallback((key: string) => {
    const next = nextTableSort(sort, key);
    setSortBy(next.by);
    setSortDir(next.dir);
  }, [sort]);
  const totals = useMemo(() => data?.accounts.reduce((acc, account) => { acc[account.type] += account.bookBalance; return acc; }, { CASH: 0, BANK: 0 }) ?? { CASH: 0, BANK: 0 }, [data]);
  return <div className="treasury-page">
    <Breadcrumbs items={[{ label: 'Tài chính', to: '/finance' }, { label: 'Sổ quỹ / ngân hàng' }]} />
    <PageHeader title="Sổ quỹ / ngân hàng" iconName="cashflow" description="Số dư ghi sổ từ các khoản thu, chi đã liên kết nguồn tiền." action={canConfigure ? <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing('new')}>Thêm tài khoản</button> : undefined} />
    {data?.accounts.some(account => !account.fundCode) && <p className="treasury-notice">Tài khoản chưa phân nguồn quỹ không dùng được ở phiếu chi phí. {canConfigure ? 'Chọn “Phân nguồn quỹ” tại tài khoản để cấu hình.' : 'Nhờ quản lý hoặc quản trị phân nguồn tại màn hình này.'}</p>}
    {data && <div className={`treasury-notice treasury-notice--${data.coverage.toLowerCase()}`}><strong>{COVERAGE[data.coverage]}</strong><span>Cập nhật đến {formatDateTimeVN(data.asOf)}. Đây là số dư ghi sổ, không phải số dư sao kê ngân hàng.</span></div>}
    <div className="treasury-rail"><div className="treasury-rail__item"><Banknote/><span>Tiền mặt — Số dư ghi sổ</span><strong>{loading ? '—' : formatCurrency(totals.CASH)}</strong></div><div className="treasury-rail__item"><Landmark/><span>Ngân hàng — Số dư ghi sổ</span><strong>{loading ? '—' : formatCurrency(totals.BANK)}</strong></div></div>
    {error ? <div className="treasury-notice treasury-notice--error" role="alert">{error}<button className="btn btn--ghost" onClick={() => void load()}><RotateCcw size={16}/> Thử lại</button></div> : !loading && data?.accounts.length === 0 ? <EmptyState icon={Landmark} title="Chưa có tài khoản ghi sổ" description="Số dư sẽ xuất hiện sau khi tài khoản được thiết lập và chuyển đổi." /> : data ? <div className="record-table-wrap">
      <table className="record-table ops-table treasury-table">
        <thead><tr>
          <SortHeader label="Tài khoản" sortKey="name" sort={sort} onSortChange={handleSortChange} />
          <SortHeader label="Đầu kỳ" sortKey="openingBalance" sort={sort} onSortChange={handleSortChange} className="num" />
          <SortHeader label="Thu" sortKey="totalIn" sort={sort} onSortChange={handleSortChange} className="num" />
          <SortHeader label="Chi" sortKey="totalOut" sort={sort} onSortChange={handleSortChange} className="num" />
          <SortHeader label="Số dư ghi sổ" sortKey="bookBalance" sort={sort} onSortChange={handleSortChange} className="num" />
          <SortHeader label="Trạng thái" sortKey="completeness" sort={sort} onSortChange={handleSortChange} />
        </tr></thead>
        <tbody>{data?.accounts.map((account) => <tr key={account.accountId}>
          <td data-label="Tài khoản"><div className="treasury-table__account"><strong>{account.name}</strong><span>{account.code} · {account.type === 'CASH' ? 'Tiền mặt' : 'Ngân hàng'}</span><span>{account.fundCode === 'COMPANY' ? 'Quỹ công ty' : account.fundCode === 'TM' ? 'Quỹ TM' : 'Chưa phân nguồn quỹ'}</span>{canConfigure && <button type="button" className="btn btn--ghost btn--sm" aria-label={`Phân nguồn quỹ · ${account.name}`} onClick={() => setEditing(account)}>Phân nguồn quỹ</button>}<small>{account.cutoverAt ? `Chuyển đổi: ${formatDateTimeVN(account.cutoverAt)}` : 'Chưa chuyển đổi đầy đủ'}</small></div></td>
          <td data-label="Đầu kỳ" className="num">{formatCurrency(account.openingBalance)}</td>
          <td data-label="Thu" className="num">{formatCurrency(account.totalIn)}</td>
          <td data-label="Chi" className="num">{formatCurrency(account.totalOut)}</td>
          <td data-label="Số dư ghi sổ" className="num treasury-table__balance"><strong>{formatCurrency(account.bookBalance)}</strong></td>
          <td data-label="Trạng thái" className="treasury-table__status"><StatusPill variant={COVERAGE_VARIANT[account.completeness]}>{COVERAGE[account.completeness]}</StatusPill></td>
        </tr>)}</tbody>
      </table>
    </div> : null}
    {editing && <TreasuryAccountDrawer account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
  </div>;
}
