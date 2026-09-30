import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Role, type ExpenseAccountingEntry, type ExpenseListQuery, type ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { FilterDropdown } from '../../components/FilterDropdown';
import { DateRangeFields, FilterBar, Tabs, UuiSelectField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { businessDateISO } from '../../lib/format';
import { useAuth } from '../../hooks/useAuth';
import { ShipmentFinancePanel } from '../shipment-finance/ShipmentFinancePanel';
import { ExpenseBoard } from './ExpenseBoard';
import { ExpenseEntryDrawer } from './ExpenseEntryDrawer';
import { ExpenseVoucherDrawer } from './ExpenseVoucherDrawer';
import { ExpenseReconciliationDrawer } from './ExpenseReconciliationDrawer';
import { ExpenseCreateDrawer } from './ExpenseCreateDrawer';
import { ExpenseWorkDrawer } from './ExpenseWorkDrawer';
import { ExpenseReport } from './ExpenseReport';
import { ExpenseAssignments } from './ExpenseAssignments';
import { ExpenseCashDrawer } from './ExpenseCashDrawer';
import { ExpenseHistory } from './ExpenseHistory';
import { FundBookSection } from './FundBookSection';
import { groupVoucherEntries } from './expense-accounting-model';
import type { WorkFeeGroup } from './ExpenseWorkRows';
import './ExpenseAccounting.css';

const views = [
  { id: 'ops', label: 'Chi phí OPS / hoàn ứng' }, { id: 'work', label: 'Phơi phiếu / tiền đường' },
  { id: 'fund-book', label: 'Sổ quỹ' },
  { id: 'reports', label: 'Báo cáo' }, { id: 'history', label: 'Lịch sử thu chi' },
  { id: 'records', label: 'Hóa đơn / cược' }, { id: 'assignments', label: 'Phân công xe' },
];
type VoucherSelection = { entries: ExpenseAccountingEntry[]; direction: 'IN' | 'OUT' };

export function ExpenseAccountingWorkspace() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = businessDateISO();
  const view = views.some(item => item.id === params.get('view')) ? params.get('view')! : 'ops';
  const search = params.get('search') ?? '';
  const [draftSearch, setDraftSearch] = useState(search);
  useEffect(() => { setDraftSearch(search); }, [search]);
  const [editing, setEditing] = useState<ExpenseAccountingEntry | null>(null);
  const [work, setWork] = useState<{ row: ExpenseWorkRow; group: WorkFeeGroup } | null>(null);
  const [creating, setCreating] = useState<{ row: ExpenseWorkRow; group: WorkFeeGroup } | null>(null);
  const [voucher, setVoucher] = useState<VoucherSelection | null>(null);
  const [groups, setGroups] = useState<VoucherSelection | null>(null);
  const [reconciliation, setReconciliation] = useState<ExpenseAccountingEntry[] | null>(null);
  const [advance, setAdvance] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const catalog = useQuery({ queryKey: qk.expenseAccounting.catalog, queryFn: expenseAccountingClient.catalog });
  const update = (values: Record<string, string>) => setParams(current => {
    const next = new URLSearchParams(current); next.delete('page');
    Object.entries(values).forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key); });
    return next;
  });
  const assigned = params.get('accountantId') ?? (view === 'work' && user?.role === Role.ACCOUNTANT ? String(user.userId) : 'all');
  const filters: ExpenseListQuery = {
    from: params.get('from') ?? `${today.slice(0, 7)}-01`, to: params.get('to') ?? today,
    search: params.get('search') || undefined, sourceKind: view === 'ops' ? 'OPS' : undefined,
    accountantId: assigned === 'all' ? undefined : Number(assigned),
    payerId: Number(params.get('payerId')) || undefined,
    confirmed: params.get('confirmed') === 'true' ? 'true' : params.get('confirmed') === 'false' ? 'false' : undefined,
    groupByVehicle: 'true', page: Math.max(1, Number(params.get('page')) || 1), limit: 25,
  };
  const validRange = !filters.from || !filters.to || filters.from <= filters.to;
  // Card 20260927_152: the criteria behind `Bộ lọc` — the count badges the
  // trigger, `Đặt lại` clears exactly those and nothing else. `from`/`to` stay
  // primary (they are the bar's date pair) and keep their month-to-date default.
  const secondaryCount = (params.get('payerId') ? 1 : 0) + (params.get('accountantId') ? 1 : 0) + (filters.confirmed ? 1 : 0);
  const clearSecondary = () => update({ payerId: '', accountantId: '', confirmed: '' });
  const hasFilters = Boolean(search || params.get('from') || params.get('to') || secondaryCount);
  const clearFilters = () => { setDraftSearch(''); update({ search: '', from: '', to: '', payerId: '', accountantId: '', confirmed: '' }); };
  const openVoucher = (entries: ExpenseAccountingEntry[], direction: 'IN' | 'OUT') => {
    setWork(null);
    if (groupVoucherEntries(entries, direction).length > 1) setGroups({ entries, direction });
    else setVoucher({ entries, direction });
  };
  return <div className="expense-accounting">
    <Tabs ariaLabel="Nghiệp vụ chi phí" variant="bordered" className="expense-accounting-tabs" value={view} tabs={views} onChange={next => update({ view: next, payerId: '', accountantId: '', confirmed: '' })} />
    {view === 'ops' && catalog.data && <div className="expense-accounting-toolbar-actions"><button type="button" className="btn btn--secondary btn--sm" onClick={() => setAdvance(true)}>Chi tạm ứng OPS</button></div>}
    {catalog.isError && <p role="alert" className="expense-accounting-error">Không tải được danh mục thao tác. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void catalog.refetch()}>Thử lại</button></p>}
    {['ops', 'work', 'reports'].includes(view) && <form onSubmit={event => { event.preventDefault(); update({ search: draftSearch.trim() }); }}>
      <FilterBar
        search={{ value: draftSearch, onChange: setDraftSearch, placeholder: 'Lô, khách, số cont, xe, tên phí', ariaLabel: 'Tìm công việc', inputProps: { maxLength: 200 } }}
        actions={<><button type="submit" className="btn btn--secondary btn--sm">Tìm</button>{hasFilters && <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>Xóa lọc</button>}</>}
      >
        <DateRangeFields
          size="sm"
          ariaLabel="Khoảng ngày chi"
          fromLabel={view === 'work' ? 'Lịch từ ngày' : 'Ngày chi từ'}
          toLabel="Đến ngày"
          from={filters.from ?? ''}
          to={filters.to ?? ''}
          onChange={({ from, to }) => update({ from, to })}
        />
        <FilterDropdown count={secondaryCount} ariaLabel="Bộ lọc" dialogLabel="Bộ lọc chi phí" onReset={clearSecondary}>
          {view === 'ops' ? <UuiSelectField label="Người thực chi" value={String(filters.payerId ?? '')} onChange={event => update({ payerId: event.target.value })} options={[{ value: '', label: 'Tất cả OPS' }, ...(catalog.data?.opsUsers ?? []).map(item => ({ value: String(item.id), label: item.name }))]} /> : <UuiSelectField label="Kế toán phụ trách xe" value={assigned} onChange={event => update({ accountantId: event.target.value })} options={[{ value: 'all', label: 'Tất cả xe' }, { value: '0', label: 'Chưa phân công' }, ...(catalog.data?.accountants ?? []).map(item => ({ value: String(item.id), label: item.name }))]} />}
          <UuiSelectField label="Đối chiếu chi phí" value={filters.confirmed ?? ''} onChange={event => update({ confirmed: event.target.value })} options={[{ value: '', label: 'Tất cả' }, { value: 'false', label: 'Chưa đối chiếu' }, { value: 'true', label: 'Đã đối chiếu' }]} />
        </FilterDropdown>
      </FilterBar>
    </form>}
    {!validRange && <p role="alert" className="expense-accounting-error">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>}
    {validRange && (view === 'ops' || view === 'work') && <ExpenseBoard key={`${view}:${JSON.stringify(filters)}:${refresh}`} view={view} filters={filters} catalog={catalog.data} setPage={page => update({ page: String(page) })} onEdit={setEditing} onWork={(row, group) => setWork({ row, group })} onVoucher={openVoucher} onReconcile={setReconciliation} />}
    {view === 'fund-book' && <FundBookSection />}
    {validRange && view === 'reports' && <ExpenseReport filters={filters} />}
    {view === 'history' && catalog.data && <ExpenseHistory catalog={catalog.data} onVoucher={openVoucher} />}
    {view === 'records' && <ShipmentFinancePanel />}
    {view === 'assignments' && catalog.data && <ExpenseAssignments catalog={catalog.data} />}
    {work && !editing && <ExpenseWorkDrawer work={work.row} group={work.group} onClose={() => setWork(null)} onEdit={setEditing} onCreate={(row, group) => { setWork(null); setCreating({ row, group }); }} onVoucher={openVoucher} />}
    {editing && <ExpenseEntryDrawer entry={editing} staff={catalog.data?.staff ?? []} onClose={() => { setEditing(null); setWork(null); }} />}
    {creating && catalog.data && <ExpenseCreateDrawer work={creating.row} initialGroup={creating.group === 'road' ? 'DRIVER_ROAD' : 'INVOICED_OTHER'} catalog={catalog.data} onClose={() => setCreating(null)} />}
    {voucher && catalog.data && <ExpenseVoucherDrawer {...voucher} accounts={catalog.data.accounts} onClose={() => setVoucher(null)} onSaved={() => { setVoucher(null); setRefresh(value => value + 1); }} />}
    {reconciliation && catalog.data && <ExpenseReconciliationDrawer entries={reconciliation} catalog={catalog.data} onClose={() => setReconciliation(null)} onSaved={() => { setReconciliation(null); setRefresh(value => value + 1); }} />}
    {advance && catalog.data && <ExpenseCashDrawer catalog={catalog.data} onClose={() => setAdvance(false)} />}
    {groups && <Drawer isOpen title="Tách phiếu theo đối tượng" onClose={() => setGroups(null)} className="expense-accounting-drawer"><p>Mỗi phiếu dùng một đối tượng và một tài khoản. Chọn nhóm để kiểm tra số tiền trước khi ghi.</p><div className="expense-accounting-group-list">{groupVoucherEntries(groups.entries, groups.direction).map(group => <button type="button" key={group.key} onClick={() => { setVoucher({ entries: group.entries, direction: groups.direction }); setGroups(null); }}><span>{group.label}<small>{group.entries.length} khoản</small></span><span>Mở phiếu →</span></button>)}</div></Drawer>}
  </div>;
}
