import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { Pagination } from '../../design-system';
import { ExpenseEntryDrawer } from './ExpenseEntryDrawer';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';
import './ExpenseAccounting.css';

export function ShipmentExpensePanel({ shipmentId, readOnly = false, chargeOnly = true }: { shipmentId: number; readOnly?: boolean; chargeOnly?: boolean }) {
  const [page, setPage] = useState(1);
  const [entry, setEntry] = useState<ExpenseAccountingEntry | null>(null);
  const filters = { shipmentId, page, limit: 25 };
  const query = useQuery({ queryKey: qk.expenseAccounting.entries(filters), queryFn: () => expenseAccountingClient.list(filters) });
  return <section className="expense-accounting" aria-label="Chi phí và thực thu của lô hàng">
    <header className="expense-accounting-header"><div><h3>Chi phí / thực thu</h3><p>Số tính cho khách theo thỏa thuận, có thể thấp hơn thực chi hoặc bằng 0. Không phải số khách đã thanh toán.</p></div></header>
    {query.isError ? <p role="alert">Không tải được chi phí. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void query.refetch()}>Thử lại</button></p> : query.isPending ? <p role="status">Đang tải chi phí…</p> : <>
      {query.data.items.length ? <ExpenseRegisterRows rows={query.data.items} selected={new Set()} selectable={false} canViewPayments={query.data.canViewPayments} onSelect={() => {}} onOpen={setEntry} /> : <p className="expense-accounting-hint">Chưa có khoản chi cho lô này.</p>}
      <Pagination page={page} totalPages={Math.ceil(query.data.total / filters.limit)} totalItems={query.data.total} pageSize={filters.limit} onChange={setPage} disabled={query.isFetching} />
    </>}
    {entry && <ExpenseEntryDrawer entry={readOnly ? { ...entry, locked: true } : entry} staff={[]} chargeOnly={chargeOnly} onClose={() => setEntry(null)} />}
  </section>;
}
