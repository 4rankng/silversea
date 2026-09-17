import { useRef, useState } from 'react';
import type { ExpenseAccountingEntry, ExpenseWorkRow } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';
import { WORK_FEE_LABELS, type WorkFeeGroup } from './ExpenseWorkRows';
import { expenseKey } from './expense-accounting-model';
import { useExpenseMutations } from './useExpenseAccounting';

export function ExpenseWorkDrawer({ work, group, onClose, onEdit, onCreate, onVoucher }: {
  work: ExpenseWorkRow; group: WorkFeeGroup; onClose: () => void; onEdit: (entry: ExpenseAccountingEntry) => void;
  onCreate: (row: ExpenseWorkRow, group: WorkFeeGroup) => void; onVoucher: (entries: ExpenseAccountingEntry[], direction: 'IN' | 'OUT') => void;
}) {
  const [selected, setSelected] = useState(new Set<string>());
  const [error, setError] = useState('');
  const lock = useRef(false);
  const { confirm } = useExpenseMutations();
  const close = () => { if (!lock.current) onClose(); };
  const rows = work.entries.filter(entry => group === 'road' ? entry.costGroup === 'DRIVER_ROAD' : entry.costGroup !== 'DRIVER_ROAD');
  const selection = rows.filter(entry => selected.has(expenseKey(entry)));
  async function confirmSelection() {
    if (lock.current || !selection.length) return;
    lock.current = true; setError('');
    try { await confirm.mutateAsync(selection); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa đối chiếu được chi phí.'); }
    finally { lock.current = false; }
  }
  return <Drawer isOpen onClose={close} title={WORK_FEE_LABELS[group]} subtitle={`${work.shipmentCode} · ${work.containerNumber ?? 'Chung lô'} · ${work.vehiclePlate ?? 'Chưa phân xe'}`} className="expense-accounting-drawer"
    footer={<><button type="button" className="btn btn--secondary" onClick={close} disabled={confirm.isPending}>Đóng</button><button type="button" className="btn btn--secondary" disabled={!work.tripId || confirm.isPending} onClick={() => onCreate(work, group)}>Thêm khoản chi</button><button type="button" className="btn btn--primary" disabled={!selection.length || confirm.isPending} onClick={() => onVoucher(selection, group === 'receivable' ? 'IN' : 'OUT')}>{group === 'receivable' ? 'Lập phiếu thu' : 'Lập phiếu chi'}</button></>}>
    <div className="expense-accounting">
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
      {selection.length > 0 && <div className="expense-accounting-toolbar-actions"><span>{selection.length} khoản đã chọn</span><button type="button" className="btn btn--secondary btn--sm" disabled={confirm.isPending || selection.some(entry => entry.locked)} onClick={() => void confirmSelection()}>{confirm.isPending ? 'Đang đối chiếu…' : 'Đối chiếu chi phí'}</button></div>}
      {!work.tripId && <p className="expense-accounting-notice">Công việc chưa có chuyến vận chuyển. Các khoản OPS đã khai vẫn được theo dõi; chưa tạo chi phí chuyến giả.</p>}
      {rows.length ? <ExpenseRegisterRows rows={rows} selected={selected} selectable canViewPayments onOpen={onEdit} onSelect={(entry, checked) => setSelected(current => { const next = new Set(current); if (checked) next.add(expenseKey(entry)); else next.delete(expenseKey(entry)); return next; })} /> : <p className="expense-accounting-empty">Chưa có khoản chi trong nhóm này.</p>}
    </div>
  </Drawer>;
}
