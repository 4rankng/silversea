import { useCallback, useEffect, useMemo, useState } from 'react';
import { Role, treasuryFundLabel } from '@tingting/shared';
import { AlertCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { TreasuryAccountDrawer } from '../features/treasury/TreasuryAccountDrawer';
import { PageHeader, StatusPill } from '../components/UI';
import { Alert, SkeletonTable, SortHeader } from '../components/shared';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, SummaryRail } from '../design-system';
import { formatCurrency, formatDate, formatDateTimeVN } from '../lib/format';
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

/* Sổ quỹ (K6.17 + K6.51) — the read extensions the position endpoint appends:
   `fundBreakdown` = bốn nguồn tiền (quỹ tiền mặt · quỹ công ty · quỹ tài khoản
   ngân hàng ACB chuyên hoàn cược · quỹ tạm ứng của giao nhận) and `ledger` =
   bảng sổ quỹ (Số phiếu · ngày · đối tượng · mô tả · tài khoản · thu/chi ·
   số dư). The shared client file types the base response shape and is owned
   outside this page, so the extension is typed here at its only consumer. */
type TreasurySourceKey = 'TM' | 'COMPANY' | 'ACB_REFUND' | 'OPS_ADVANCE';

interface TreasurySourceRow {
  source: TreasurySourceKey;
  /** Quỹ tạm ứng của giao nhận chỉ có số dư còn tồn (K6.17) — không có kỳ. */
  openingBalance: number | null;
  totalIn: number | null;
  totalOut: number | null;
  bookBalance: number | null;
}

interface TreasurySourceBreakdown {
  sources: TreasurySourceRow[];
  inDelta: number;
  outDelta: number;
  balanceDelta: number;
}

interface TreasuryLedgerRow {
  id: number;
  valueDate: string;
  direction: 'IN' | 'OUT';
  amount: number;
  accountName: string;
  code: string | null;
  counterpartyName: string | null;
  description: string | null;
}

type TreasuryPositionResponse = TreasuryPosition & {
  fundBreakdown: TreasurySourceBreakdown;
  ledger: TreasuryLedgerRow[];
};

const SOURCE_LABELS: Record<TreasurySourceKey, string> = {
  TM: 'Quỹ tiền mặt',
  COMPANY: 'Quỹ công ty',
  ACB_REFUND: 'Quỹ tài khoản ngân hàng ACB chuyên hoàn cược',
  OPS_ADVANCE: 'Quỹ tạm ứng của giao nhận',
};

const sourceMoney = (value: number | null) => (value == null ? '—' : formatCurrency(value));

export default function TreasuryPositionPage() {
  const { user } = useAuth();
  const canConfigure = user?.role === Role.ADMIN || user?.role === Role.MANAGER;
  const [editing, setEditing] = useState<TreasuryPosition['accounts'][number] | 'new' | null>(null);
  const [data, setData] = useState<TreasuryPositionResponse | null>(null);
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
      setData((await customerServiceFinanceClient.getTreasuryPosition(sortBy ? { sortBy, sortDir } : undefined)) as TreasuryPositionResponse);
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
    () => data?.accounts.reduce((acc, account) => {
      acc.opening += account.openingBalance;
      acc.totalIn += account.totalIn;
      acc.totalOut += account.totalOut;
      acc.bookBalance += account.bookBalance;
      return acc;
    }, { opening: 0, totalIn: 0, totalOut: 0, bookBalance: 0 }) ?? { opening: 0, totalIn: 0, totalOut: 0, bookBalance: 0 },
    [data],
  );
  // K6.51 — cột Số dư của bảng sổ quỹ là số cộng dồn, chạy từ tổng số dư đầu kỳ
  // của toàn sổ (mọi tài khoản ghi sổ), nên dòng cuối khớp "Tổng số dư".
  const ledgerRows = useMemo(() => {
    let balance = totals.opening;
    return (data?.ledger ?? []).map((row) => {
      balance += row.direction === 'IN' ? row.amount : -row.amount;
      return { ...row, balance };
    });
  }, [data, totals.opening]);
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
             state is the shared skeleton below, never an em-dash placeholder.
             Card 20261002_291: the five core fund figures in ONE bar — the
             cash/bank split lives in the table rows below. */}
      {!loading && data && (
        <SummaryRail
          ariaLabel="Tóm tắt số dư ghi sổ"
          items={[
            { label: 'Đầu kỳ', value: formatCurrency(totals.opening) },
            { label: 'Thu', value: formatCurrency(totals.totalIn) },
            { label: 'Chi', value: formatCurrency(totals.totalOut) },
            { label: 'Số dư ghi sổ', value: formatCurrency(totals.bookBalance) },
            { label: 'Tạm ứng OPS còn tồn', value: formatCurrency(data.opsAdvance.totalOutstanding) },
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
        <>
          {/* Sổ quỹ đối soát (ticket 18/11 Task 3.5a) — side-by-side per-fund
              book totals: Quỹ tiền mặt (CASH) vs Quỹ tài khoản ngân hàng
              (BANK) over the account ledger's Đầu kỳ | Thu | Chi | Số dư cuối,
              closed by the đối soát line (CASH − BANK deltas). The ledger has
              no inter-fund transfer law — every treasury movement binds
              exactly one external money source — so the note says the delta
              is the whole reconciliation. */}
          <section aria-label="Đối soát quỹ" className="treasury-recon mb-5">
            <h2 className="treasury-recon__title">Đối soát quỹ</h2>
            <div className="record-table-wrap">
              <table className="record-table ops-table treasury-table">
                <thead>
                  <tr>
                    <th scope="col">Quỹ</th>
                    <th scope="col" className="num">Đầu kỳ</th>
                    <th scope="col" className="num">Thu</th>
                    <th scope="col" className="num">Chi</th>
                    <th scope="col" className="num">Số dư cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {/* K6.17 — bốn nguồn tiền của Sổ quỹ; quỹ tạm ứng của giao
                      nhận chỉ mang số dư còn tồn nên các cột kỳ hiện '—'. */}
                  {data.fundBreakdown.sources.map((source) => (
                    <tr key={source.source}>
                      <td data-label="Quỹ"><strong>{SOURCE_LABELS[source.source]}</strong></td>
                      <td data-label="Đầu kỳ" className="num"><span className="data-token">{sourceMoney(source.openingBalance)}</span></td>
                      <td data-label="Thu" className="num"><span className="data-token">{sourceMoney(source.totalIn)}</span></td>
                      <td data-label="Chi" className="num"><span className="data-token">{sourceMoney(source.totalOut)}</span></td>
                      <td data-label="Số dư cuối" className="num"><strong><span className="data-token">{sourceMoney(source.bookBalance)}</span></strong></td>
                    </tr>
                  ))}
                  <tr className="treasury-table__recon-row">
                    <td data-label="Đối soát"><strong>Đối soát (Tiền mặt − Ngân hàng)</strong></td>
                    <td data-label="Đầu kỳ" className="num">—</td>
                    <td data-label="Thu" className="num"><span className="data-token">{formatCurrency(data.fundBreakdown.inDelta)}</span></td>
                    <td data-label="Chi" className="num"><span className="data-token">{formatCurrency(data.fundBreakdown.outDelta)}</span></td>
                    <td data-label="Số dư cuối" className="num"><strong><span className="data-token">{formatCurrency(data.fundBreakdown.balanceDelta)}</span></strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="treasury-table__recon-note">
              Chênh lệch thu/chi giữa hai quỹ, dấu dương nghi về quỹ tiền mặt. Sổ kho quỹ không ghi
              chuyển tiền giữa hai quỹ — mỗi dòng kho quỹ gắn đúng một nguồn tiền ngoài (phiếu thu
              hoặc chứng từ chi) — nên đây là toàn bộ đối soát giữa hai quỹ.
            </p>
          </section>
          {/* K6.51 (KB §6.5 "Sổ quỹ") — bảng sổ quỹ: Số phiếu · ngày · đối tượng
              · mô tả · tài khoản · thu/chi · số dư; nhãn tổng số dư phía trên;
              dòng trạng thái "số dư ghi sổ, cập nhật đến …" là Alert ngay trên
              cùng trang. */}
          <section aria-label="Bảng sổ quỹ" className="mb-5">
            <h2 className="treasury-recon__title">Sổ quỹ</h2>
            <p className="treasury-table__recon-note">
              <strong>Tổng số dư: {formatCurrency(totals.bookBalance)}</strong> — số dư ghi sổ chạy
              cộng dồn theo từng dòng, từ tổng số dư đầu kỳ của toàn sổ.
            </p>
            <div className="record-table-wrap">
              <table className="record-table ops-table treasury-table">
                <thead>
                  <tr>
                    <th scope="col">Số phiếu</th>
                    <th scope="col">Ngày</th>
                    <th scope="col">Đối tượng</th>
                    <th scope="col">Mô tả</th>
                    <th scope="col">Tài khoản</th>
                    <th scope="col" className="num">Thu</th>
                    <th scope="col" className="num">Chi</th>
                    <th scope="col" className="num">Số dư</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Số phiếu">{row.code ?? '—'}</td>
                      <td data-label="Ngày">{formatDate(row.valueDate)}</td>
                      <td data-label="Đối tượng">{row.counterpartyName ?? '—'}</td>
                      <td data-label="Mô tả">{row.description ?? '—'}</td>
                      <td data-label="Tài khoản">{row.accountName}</td>
                      <td data-label="Thu" className="num">{row.direction === 'IN' ? formatCurrency(row.amount) : '—'}</td>
                      <td data-label="Chi" className="num">{row.direction === 'OUT' ? formatCurrency(row.amount) : '—'}</td>
                      <td data-label="Số dư" className="num"><strong><span className="data-token">{formatCurrency(row.balance)}</span></strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!ledgerRows.length && (
              <p className="treasury-table__recon-note">Chưa có dòng sổ quỹ nào.</p>
            )}
          </section>
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
                        {/* Card 20261002_291: the business identity is bank
                           name + account number; the technical `code` is
                           never a display label. Until the position read
                           exposes the bank columns the caption carries the
                           type and fund alone. */}
                        <span>
                          {[
                            account.bankName,
                            account.bankAccountNumber,
                            account.type === 'CASH' ? 'Tiền mặt' : 'Ngân hàng',
                            // Card 2026-10-05_381: label comes from the shared
                            // fund constant. The check stays explicit rather than a
                            // bare truthiness test, so an unexpected code degrades to
                            // the same "Chưa phân nguồn quỹ" prompt as a null one
                            // instead of silently dropping the fund segment.
                            account.fundCode === 'COMPANY' || account.fundCode === 'TM'
                              ? treasuryFundLabel(account.fundCode)
                              : 'Chưa phân nguồn quỹ',
                          ].filter(Boolean).join(' · ')}
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
                        {/* Card 071026212020: the no-cutover fallback was a
                           migration-state phrase leaking into the accountant's
                           tile. The account's conversion state lives in the
                           Trạng thái pill (Đầy đủ/Một phần/Chưa khả dụng);
                           the caption carries the cutover timestamp only when
                           one actually exists. */}
                        {account.cutoverAt && <small>{`Chuyển đổi: ${formatDateTimeVN(account.cutoverAt)}`}</small>}
                      </div>
                    </td>
                    <td data-label="Đầu kỳ" className="num"><span className="data-token">{formatCurrency(account.openingBalance)}</span></td>
                    <td data-label="Thu" className="num"><span className="data-token">{formatCurrency(account.totalIn)}</span></td>
                    <td data-label="Chi" className="num"><span className="data-token">{formatCurrency(account.totalOut)}</span></td>
                    <td data-label="Số dư ghi sổ" className="num treasury-table__balance">
                      <strong><span className="data-token">{formatCurrency(account.bookBalance)}</span></strong>
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
        </>
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
