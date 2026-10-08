import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { expenseDateSchema, treasuryFundLabel, type TreasuryFundCode } from '@tingting/shared';
import { api } from '../../lib/api';
import { qk } from '../../api/keys';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, FilterBar, UuiSelectField } from '../../design-system';
import { businessDateISO } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';

/** Card 20260928_168 (PM ruling 2026-09-29, câu 1 + câu 2) — the accountant's
 *  Sổ quỹ: one fund source read over a from/to period, with the opening
 *  balance carried lũy kế đến 'from', plus the Tài khoản OPS entry whose
 *  closing IS the "Còn phải hoàn ứng" the 169 reimbursement report shows —
 *  both read the same canonical formula (min(đã ứng, đã cấp) − đã tiêu, cash
 *  returned included), so the two tables are one number by construction. The
 *  phiếu itself is issued from the report page, which offers only the
 *  direction each đợt supports; the row action below lands there with the
 *  SAME period pre-applied. */

interface FundBookMovement { id: number; direction: 'IN' | 'OUT'; amount: string; valueDate: string; status: string; postedAt: string; ledgerEntryId: number | null }
interface FundBookAccount { accountId: number; code: string; name: string; currency: string; openingBalance: number; openingBalanceDate: string | null; cutoverAt: string | null; totalIn: number; totalOut: number; bookBalance: number; movements: FundBookMovement[] }
interface FundBook {
  source: TreasuryFundCode;
  period: { from: string | null; to: string | null };
  accounts: FundBookAccount[];
  totals: { openingBalance: number; totalIn: number; totalOut: number; bookBalance: number };
  unassignedAccounts: number;
  opsAdvance: { totalOutstanding: number; items: Array<{ staffId: number; staffName: string | null; outstanding: number }> };
}

function fetchFundBook(params: { source: TreasuryFundCode; from?: string; to?: string }): Promise<FundBook> {
  const query = new URLSearchParams({ source: params.source });
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  return api.get(`/expense-accounting/fund-book?${query.toString()}`);
}

export function FundBookSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = businessDateISO();
  const sourceParam = searchParams.get('fundSource');
  const source: TreasuryFundCode = sourceParam === 'TM' ? 'TM' : 'COMPANY';
  const parseDate = (value: string | null) => (value && expenseDateSchema.safeParse(value).success ? value : undefined);
  const from = parseDate(searchParams.get('fundFrom')) ?? `${today.slice(0, 7)}-01`;
  const to = parseDate(searchParams.get('fundTo')) ?? today;
  const setFilter = (key: string, value: string) => setSearchParams(current => { const next = new URLSearchParams(current); next.set(key, value); return next; });
  const validRange = from <= to;

  const book = useQuery({
    queryKey: qk.expenseAccounting.fundBook({ source, from, to }),
    queryFn: () => fetchFundBook({ source, from: validRange ? from : undefined, to: validRange ? to : undefined }),
    enabled: validRange,
  });

  return <section className="expense-accounting" aria-label="Sổ quỹ">
    <FilterBar>
      <DateRangeFields
        size="sm"
        ariaLabel="Kỳ sổ quỹ"
        fromLabel="Từ ngày"
        toLabel="Đến ngày"
        from={from}
        to={to}
        onChange={({ from: nextFrom, to: nextTo }) => { setFilter('fundFrom', nextFrom); setFilter('fundTo', nextTo); }}
      />
      <FilterDropdown
        count={source === 'TM' ? 1 : 0}
        ariaLabel="Nguồn quỹ"
        dialogLabel="Chọn nguồn quỹ"
        onReset={() => setFilter('fundSource', 'COMPANY')}
      >
        <UuiSelectField
          label="Nguồn quỹ"
          value={source}
          onChange={event => setFilter('fundSource', event.target.value)}
          options={([{ value: 'COMPANY', label: treasuryFundLabel('COMPANY') }, { value: 'TM', label: treasuryFundLabel('TM') }] as const)}
        />
      </FilterDropdown>
    </FilterBar>
    <p className="expense-accounting-hint">Đầu kỳ là số dư lũy kế đến ngày bắt đầu; thu, chi và dòng sổ chỉ nằm trong kỳ. Tài khoản OPS ghi số tạm ứng OPS còn giữ — cùng một công thức với số "Còn phải hoàn ứng" của báo cáo hoàn ứng.</p>
    {!validRange && <p role="alert" className="expense-accounting-error">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
    {book.isError && <p role="alert">Không tải được sổ quỹ. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void book.refetch()}>Thử lại</button></p>}
    {validRange && (book.isPending ? <p role="status">Đang tải sổ quỹ…</p> : book.data && <>
      {book.data.unassignedAccounts > 0 && <p className="expense-accounting-notice">{book.data.unassignedAccounts} tài khoản đang dùng chưa phân nguồn quỹ nên không nằm trong sổ này.</p>}
      <div className="expense-accounting-summary">
        <div><span>Đầu kỳ</span><strong>{expenseMoney(book.data.totals.openingBalance)}</strong></div>
        <div><span>Thu trong kỳ</span><strong>{expenseMoney(book.data.totals.totalIn)}</strong></div>
        <div><span>Chi trong kỳ</span><strong>{expenseMoney(book.data.totals.totalOut)}</strong></div>
        <div><span>Tồn cuối kỳ</span><strong>{expenseMoney(book.data.totals.bookBalance)}</strong></div>
        <div><span>Tài khoản OPS · còn phải hoàn ứng</span><strong>{expenseMoney(book.data.opsAdvance.totalOutstanding)}</strong></div>
      </div>
      <div className="expense-register-table-wrap"><table className="expense-register-table">
        <thead><tr><th scope="col">Tài khoản</th><th scope="col">Đầu kỳ</th><th scope="col">Thu</th><th scope="col">Chi</th><th scope="col">Tồn cuối kỳ</th></tr></thead>
        <tbody>
          {book.data.accounts.map(account => <tr key={account.accountId}>
            <td data-label="Tài khoản" className="expense-register-context"><strong>{account.name}</strong><span>{account.code}</span></td>
            <td data-label="Đầu kỳ" className="num">{expenseMoney(account.openingBalance)}</td>
            <td data-label="Thu" className="num">{expenseMoney(account.totalIn)}</td>
            <td data-label="Chi" className="num">{expenseMoney(account.totalOut)}</td>
            <td data-label="Tồn cuối kỳ" className="num">{expenseMoney(account.bookBalance)}</td>
          </tr>)}
        </tbody>
      </table></div>
      {!book.data.accounts.length && <p className="expense-accounting-empty">Quỹ này chưa có tài khoản đang dùng.</p>}
      <h3 className="expense-accounting-subtitle">Tài khoản OPS</h3>
      <div className="expense-register-table-wrap"><table className="expense-register-table">
        <thead><tr><th scope="col">Nhân viên</th><th scope="col">Tạm ứng còn giữ</th><th aria-label="Thao tác" /></tr></thead>
        <tbody>
          {book.data.opsAdvance.items.map(item => <tr key={item.staffId}>
            <td data-label="Nhân viên">{item.staffName ?? 'Chưa có tên'}</td>
            <td data-label="Tạm ứng còn giữ" className="num">{expenseMoney(item.outstanding)}</td>
            <td data-label="Thao tác">
              <Link className="btn btn--secondary btn--sm" to={`/accounting/hoan-ung?opsUserId=${item.staffId}&from=${from}&to=${to}`}>Lập phiếu</Link>
            </td>
          </tr>)}
        </tbody>
      </table></div>
      {!book.data.opsAdvance.items.length && <p className="expense-accounting-empty">Không còn tạm ứng chưa hoàn của nhân viên OPS.</p>}
    </>)}
  </section>;
}
