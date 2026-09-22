import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ExpenseAccountingEntry, ExpenseListQuery, ExpenseWorkRow } from '@tingting/shared';
import { expenseAccountingClient, type ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { Pagination } from '../../design-system';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';
import { ExpenseWorkRows, type WorkFeeGroup } from './ExpenseWorkRows';
import { expenseKey, expenseMoney } from './expense-accounting-model';
import { useExpenseMutations } from './useExpenseAccounting';

export function ExpenseBoard({ view, filters, catalog, setPage, onEdit, onWork, onVoucher, onReconcile }: {
  view: 'ops' | 'work'; filters: ExpenseListQuery; catalog?: ExpenseAccountingCatalog; setPage: (page: number) => void;
  onEdit: (entry: ExpenseAccountingEntry) => void; onWork: (row: ExpenseWorkRow, group: WorkFeeGroup) => void;
  onVoucher: (entries: ExpenseAccountingEntry[], direction: 'IN' | 'OUT') => void; onReconcile: (entries: ExpenseAccountingEntry[]) => void;
}) {
  const entries = useQuery({ queryKey: qk.expenseAccounting.entries(filters), queryFn: () => expenseAccountingClient.list(filters), enabled: view === 'ops', placeholderData: keepPreviousData });
  const work = useQuery({ queryKey: qk.expenseAccounting.work(filters), queryFn: () => expenseAccountingClient.work(filters), enabled: view === 'work', placeholderData: keepPreviousData });
  const query = view === 'ops' ? entries : work;
  const [selection, setSelection] = useState(new Map<string, ExpenseAccountingEntry>());
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const { confirm } = useExpenseMutations();
  const selected = [...selection.values()];
  const rows = entries.data?.items ?? [];
  const busy = query.isFetching || selecting || confirm.isPending;
  function select(entry: ExpenseAccountingEntry, checked: boolean) {
    setSelection(current => { const next = new Map(current); if (checked) next.set(expenseKey(entry), entry); else next.delete(expenseKey(entry)); return next; });
  }
  /** Header "Chọn tất cả" (card 20260922_7). Check adds every selectable row
   *  displayed on this page (a cross-page pick from "Chọn tất cả N kết quả"
   *  survives); uncheck clears the selection wholesale — the same end state as
   *  "Bỏ chọn (N)" and AC2 "Tất cả các dòng được bỏ chọn". */
  function selectPageAll(checked: boolean) {
    setSelection(current => {
      if (!checked) return new Map();
      const next = new Map(current);
      for (const entry of rows) if (entry.status === 'RECORDED') next.set(expenseKey(entry), entry);
      return next;
    });
  }
  async function selectAll() {
    setSelecting(true); setError('');
    try {
      const first = await expenseAccountingClient.list({ ...filters, page: 1, limit: 100 });
      if (first.total > 200) { setError('Một lượt đối chiếu tối đa 200 khoản. Thu hẹp bộ lọc trước khi chọn tất cả.'); return; }
      const other = first.total > 100 ? await expenseAccountingClient.list({ ...filters, page: 2, limit: 100 }) : null;
      const all = [...first.items, ...(other?.items ?? [])].filter(entry => entry.status === 'RECORDED');
      setSelection(new Map(all.map(entry => [expenseKey(entry), entry])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa chọn được toàn bộ kết quả.'); }
    finally { setSelecting(false); }
  }
  async function reconcileCosts() {
    if (busy || !selected.length) return;
    setError('');
    try { await confirm.mutateAsync(selected); setSelection(new Map()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa đối chiếu được. Làm mới để kiểm tra phiên bản từng khoản.'); }
  }
  return <section className="expense-accounting" aria-label={view === 'ops' ? 'Chi phí OPS và hoàn ứng' : 'Phơi phiếu và tiền đường'}>
    {view === 'ops' && <>
      {entries.data && <div className="expense-accounting-summary">
        <div><span>Thực chi</span><strong>{expenseMoney(entries.data.totals.amount)}</strong></div><div><span>Thực thu · thu khách</span><strong>{expenseMoney(entries.data.totals.customerChargeAmount)}</strong></div><div><span>Đã thu</span><strong>{expenseMoney(entries.data.totals.receivedAmount)}</strong></div><div><span>Còn phải thu</span><strong>{expenseMoney(entries.data.totals.outstandingReceivable)}</strong></div><div><span>Còn phải trả</span><strong>{expenseMoney(entries.data.totals.outstandingPayable)}</strong></div>
      </div>}
      <div className="expense-accounting-toolbar"><div className="expense-accounting-toolbar-actions">
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy || !rows.length} onClick={() => setSelection(new Map(rows.filter(entry => entry.status === 'RECORDED').map(entry => [expenseKey(entry), entry])))}>Chọn trang này</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy || !entries.data?.total} onClick={() => void selectAll()}>Chọn tất cả {entries.data?.total ?? 0} kết quả</button>
        {selected.length > 0 && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelection(new Map())}>Bỏ chọn ({selected.length})</button>}
      </div><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setSelection(new Map()); void query.refetch(); }}>Làm mới</button></div>
      {selected.length > 0 && <div className="expense-accounting-toolbar-actions" aria-label="Thao tác các khoản đã chọn">
        <span>{selected.length} khoản đã chọn</span>
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy || selected.some(entry => entry.locked)} onClick={() => void reconcileCosts()}>{confirm.isPending ? 'Đang đối chiếu…' : 'Đối chiếu chi phí'}</button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy || !catalog} onClick={() => onReconcile(selected)}>Đối chiếu hoàn ứng</button>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || !catalog} onClick={() => onVoucher(selected, 'IN')}>Lập phiếu thu</button>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || !catalog} onClick={() => onVoucher(selected, 'OUT')}>Lập phiếu chi</button>
      </div>}
      {Boolean(entries.data?.unknownReceivableCount || entries.data?.unknownPayableCount) && <p className="expense-accounting-notice">Một số khoản chưa xác định hoặc chưa phân bổ thanh toán lịch sử. Không coi các giá trị này là 0đ.</p>}
    </>}
    {view === 'work' && work.data && <div className="expense-accounting-summary">{(['receivable', 'payable', 'road'] as const).map((key, index) => <div key={key}><span>{['Chi hộ phải thu', 'Chi hộ phải trả', 'Tiền đường'][index]}</span><strong>{expenseMoney(work.data.totals[key])}</strong></div>)}</div>}
    {error && <p role="alert" className="expense-accounting-error">{error}</p>}
    {query.isError ? <p role="alert">Không tải được dữ liệu. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void query.refetch()}>Thử lại</button></p>
      : query.isPending ? <p role="status">Đang tải…</p> : !query.data?.total ? <p className="expense-accounting-empty">Không có kết quả phù hợp. Thử đổi khoảng ngày hoặc bộ lọc.</p>
        : <div aria-busy={query.isFetching}>{view === 'ops' ? <ExpenseRegisterRows rows={rows} selected={new Set(selection.keys())} selectable canViewPayments onOpen={onEdit} onSelect={select} onSelectAll={selectPageAll} /> : <ExpenseWorkRows rows={work.data?.items ?? []} onOpen={onWork} />}</div>}
    <Pagination page={filters.page} totalPages={Math.ceil((query.data?.total ?? 0) / filters.limit)} totalItems={query.data?.total} pageSize={filters.limit} disabled={busy} onChange={page => { setSelection(new Map()); setPage(page); }} />
  </section>;
}
