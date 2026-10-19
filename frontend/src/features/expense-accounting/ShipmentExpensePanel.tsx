import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Role, type ExpenseAccountingEntry } from '@tingting/shared';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { Pagination } from '../../design-system';
import { useAuth } from '../../hooks/useAuth';
import { ExpenseCreateDrawer } from './ExpenseCreateDrawer';
import { ExpenseEntryDrawer } from './ExpenseEntryDrawer';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';
import './ExpenseAccounting.css';

export function ShipmentExpensePanel({ shipmentId, shipmentCode = null, readOnly = false, chargeOnly = true, carrier }: { shipmentId: number; shipmentCode?: string | null; readOnly?: boolean; chargeOnly?: boolean; carrier?: { supplierId: number | null; name: string | null } }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [entry, setEntry] = useState<ExpenseAccountingEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const filters = { shipmentId, page, limit: 25 };
  const query = useQuery({ queryKey: qk.expenseAccounting.entries(filters), queryFn: () => expenseAccountingClient.list(filters) });
  // Card 20261005 — kế toán khai chi phí ngay trên lô, không cần chuyến. Nút
  // chỉ hiện cho vai trò được ghi chi phí và khi lô chưa khoá tài chính.
  // chiphispec §1 — ANY Ops fills ALL lot costs: OPS joins the create set, and
  // the drawer scopes its payer list to fellow Ops (entryScope='OPS').
  const canCreate = !readOnly && (user?.role === Role.ADMIN || user?.role === Role.MANAGER || user?.role === Role.ACCOUNTANT || user?.role === Role.OPS);
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog, enabled: creating });
  return <section className="expense-accounting" aria-label="Chi phí và thực thu của lô hàng">
    <header className="expense-accounting-header"><div><h3>Chi phí / thực thu</h3><p>Số tính cho khách theo thỏa thuận, có thể thấp hơn thực chi hoặc bằng 0. Không phải số khách đã thanh toán.</p></div>
      {canCreate && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setCreating(true)}>+ Thêm khoản chi</button>}</header>
    {query.isError ? <p role="alert">Không tải được chi phí. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void query.refetch()}>Thử lại</button></p> : query.isPending ? <p role="status">Đang tải chi phí…</p> : <>
      {query.data.items.length ? <ExpenseRegisterRows rows={query.data.items} selected={new Set()} selectable={false} canViewPayments={query.data.canViewPayments} onSelect={() => {}} onOpen={setEntry} /> : <p className="expense-accounting-hint">Chưa có khoản chi cho lô này.</p>}
      <Pagination page={page} totalPages={Math.ceil(query.data.total / filters.limit)} totalItems={query.data.total} pageSize={filters.limit} onChange={setPage} disabled={query.isFetching} />
    </>}
    {creating && !catalog.data && <p role="status">Đang tải danh mục khoản chi…</p>}
    {creating && catalog.data && <ExpenseCreateDrawer work={{ tripId: null, shipmentId, shipmentCode, containerNumber: null }} entryScope={user?.role === Role.OPS ? 'OPS' : undefined} catalog={catalog.data} carrier={carrier} onClose={() => setCreating(false)} onSaved={() => void query.refetch()} />}
    {entry && <ExpenseEntryDrawer entry={readOnly ? { ...entry, locked: true } : entry} staff={[]} chargeOnly={chargeOnly} onClose={() => setEntry(null)} />}
  </section>;
}
