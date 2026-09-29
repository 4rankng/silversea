import { useCallback, useEffect, useMemo, useState } from 'react';
import { Role } from '@tingting/shared';
import { AlertCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { TreasuryAccountDrawer } from '../features/treasury/TreasuryAccountDrawer';
import { PageHeader, StatusPill } from '../components/UI';
import { Alert, SkeletonTable, SortHeader } from '../components/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, SummaryRail } from '../design-system';
import { formatCurrency, formatDateTimeVN } from '../lib/format';
import { nextTableSort, type TableSortState } from '../lib/table-sort';
import { customerServiceFinanceClient, type TreasuryPosition } from '../api/customerServiceFinanceClient';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './TreasuryPositionPage.css';

const COVERAGE = { COMPLETE: 'Đầy đủ', PARTIAL: 'Một phần', UNAVAILABLE: 'Chưa khả dụng' } as const;
const COVERAGE_VARIANT = { COMPLETE: 'success', PARTIAL: 'warn', UNAVAILABLE: 'neutral' } as const;
/* The same coverage fact as a shared `Alert` variant — the quiet face of an
   unavailable read is `info` (`Alert` has no neutral). */
const COVERAGE_ALERT = { COMPLETE: 'success', PARTIAL: 'warning', UNAVAILABLE: 'info' } as const;

function sanitizeAccountDisplayName(name: string): string {
  return name.replace(/\s*\((?:COMPANY|TM|NULL,\s*pre-merge)\)/gi, '').trim();
}

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await customerServiceFinanceClient.getTreasuryPosition(sortBy ? { sortBy, sortDir } : undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải số dư ghi sổ.');
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortDir]);

  useEffect(() => { void load(); }, [load]);

  const sort = useMemo<TableSortState | null>(() => (sortBy ? { by: sortBy, dir: sortDir } : null), [sortBy, sortDir]);
  const handleSortChange = useCallback((key: string) => {
    const next = nextTableSort(sort, key);
    setSortBy(next.by);
    setSortDir(next.dir);
  }, [sort]);

  const totals = useMemo(
    () => data?.accounts.reduce((acc, account) => { acc[account.type] += account.bookBalance; return acc; }, { CASH: 0, BANK: 0 }) ?? { CASH: 0, BANK: 0 },
    [data],
  );
  const accounts = data?.accounts ?? [];
  const hasAccountWithoutFund = accounts.some((account) => !account.fundCode);
  const isEmpty = accounts.length === 0;

  return (
    <div className="treasury-page">
      <Breadcrumbs
        items={[
          { label: 'Tài chính', to: '/finance' },
          { label: 'Sổ quỹ / Ngân hàng' },
        ]}
      />

      <PageHeader
        title="Sổ quỹ / Ngân hàng"
        iconName="cashflow"
        description="Số dư ghi sổ từ các khoản thu, chi đã liên kết nguồn tiền."
        action={canConfigure ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setEditing('new')}>
            Thêm tài khoản
          </button>
        ) : undefined}
      />

      {/* ── Notices — the shared banner primitive (the page-local notice strip
             is retired: one notice look for the whole app). ─────────────── */}
      {hasAccountWithoutFund && (
        <Alert variant="warning" icon={<AlertTriangle size={16} />} className="mb-5">
          Tài khoản chưa phân nguồn quỹ không dùng được ở phiếu chi phí.{' '}
          {canConfigure
            ? 'Chọn “Phân nguồn quỹ” tại tài khoản để cấu hình.'
            : 'Nhờ quản lý hoặc quản trị phân nguồn tại màn hình này.'}
        </Alert>
      )}

      {data && (
        <Alert variant={COVERAGE_ALERT[data.coverage]} className="mb-5">
          <strong>{COVERAGE[data.coverage]}</strong>{' '}
          <span aria-hidden="true">·</span>{' '}
          Cập nhật đến {formatDateTimeVN(data.asOf)}. Đây là số dư ghi sổ, không phải số dư sao kê ngân hàng.
        </Alert>
      )}

      {/* ── Summary rail — the shared workboard strip, not a page-local KPI
             block. It carries no numbers until the read lands, so the pending
             state is the shared skeleton below, never an em-dash placeholder. */}
      {!loading && data && (
        <SummaryRail
          ariaLabel="Tóm tắt số dư ghi sổ"
          items={[
            { label: 'Tiền mặt — Số dư ghi sổ', value: formatCurrency(totals.CASH) },
            { label: 'Ngân hàng — Số dư ghi sổ', value: formatCurrency(totals.BANK) },
          ]}
        />
      )}

      {error ? (
        <Alert
          variant="error"
          icon={<AlertCircle size={16} />}
          action={(
            <button type="button" className="btn btn--ghost" onClick={() => void load()}>
              <RotateCcw size={16} aria-hidden="true" />
              Thử lại
            </button>
          )}
        >
          {error}
        </Alert>
      ) : loading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : data && isEmpty ? (
        <EmptyState
          variant="compact"
          context="finance"
          title="Chưa có tài khoản ghi sổ"
          description="Số dư sẽ xuất hiện sau khi tài khoản được thiết lập và chuyển đổi."
        />
      ) : data ? (
        <section aria-label="Danh sách tài khoản ghi sổ">
          <div className="record-table-wrap">
            <table className="record-table ops-table treasury-table">
              <thead>
                <tr>
                  <SortHeader label="Tài khoản" sortKey="name" sort={sort} onSortChange={handleSortChange} />
                  <SortHeader label="Đầu kỳ" sortKey="openingBalance" sort={sort} onSortChange={handleSortChange} className="num" />
                  <SortHeader label="Thu" sortKey="totalIn" sort={sort} onSortChange={handleSortChange} className="num" />
                  <SortHeader label="Chi" sortKey="totalOut" sort={sort} onSortChange={handleSortChange} className="num" />
                  <SortHeader label="Số dư ghi sổ" sortKey="bookBalance" sort={sort} onSortChange={handleSortChange} className="num" />
                  <SortHeader label="Trạng thái" sortKey="completeness" sort={sort} onSortChange={handleSortChange} />
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((account) => (
                  <tr key={account.accountId}>
                    <td data-label="Tài khoản">
                      <div className="treasury-table__account">
                        <strong>{sanitizeAccountDisplayName(account.name)}</strong>
                        <span>{account.code} · {account.type === 'CASH' ? 'Tiền mặt' : 'Ngân hàng'}</span>
                        <span>
                          {account.fundCode === 'COMPANY' ? 'Quỹ công ty' : account.fundCode === 'TM' ? 'Quỹ TM' : 'Chưa phân nguồn quỹ'}
                        </span>
                        {canConfigure && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={`Phân nguồn quỹ · ${sanitizeAccountDisplayName(account.name)}`}
                            onClick={() => setEditing(account)}
                          >
                            Phân nguồn quỹ
                          </button>
                        )}
                        <small>{account.cutoverAt ? `Chuyển đổi: ${formatDateTimeVN(account.cutoverAt)}` : 'Chưa chuyển đổi đầy đủ'}</small>
                      </div>
                    </td>
                    <td data-label="Đầu kỳ" className="num">{formatCurrency(account.openingBalance)}</td>
                    <td data-label="Thu" className="num">{formatCurrency(account.totalIn)}</td>
                    <td data-label="Chi" className="num">{formatCurrency(account.totalOut)}</td>
                    <td data-label="Số dư ghi sổ" className="num treasury-table__balance">
                      <strong>{formatCurrency(account.bookBalance)}</strong>
                    </td>
                    <td data-label="Trạng thái" className="treasury-table__status">
                      <StatusPill variant={COVERAGE_VARIANT[account.completeness]}>{COVERAGE[account.completeness]}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {editing && (
        <TreasuryAccountDrawer
          account={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}
