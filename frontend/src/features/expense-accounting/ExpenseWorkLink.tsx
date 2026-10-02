import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { TextField, UuiSelectField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { formatDate } from '../../lib/format';
import { useExpenseMutations } from './useExpenseAccounting';

/** Link provenance to real work, independently of monetary correction or confirmation. */
export function ExpenseWorkLink({ entry, onLinked }: { entry: ExpenseAccountingEntry; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [tripId, setTripId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const { update } = useExpenseMutations();
  const filters = { shipmentId: entry.shipmentId, page: 1, limit: 100 };
  const work = useQuery({ queryKey: qk.expenseAccounting.work(filters), queryFn: () => expenseAccountingClient.work(filters), enabled: open });
  const realWork = work.data?.items.filter(item => item.tripId !== null) ?? [];
  async function save() {
    if (lock.current) return;
    if (!tripId || !reason.trim()) { setError('Chọn công việc và nhập lý do liên kết.'); return; }
    lock.current = true; setError('');
    try { await update.mutateAsync({ entry, body: { expectedVersion: entry.version, tripId: Number(tripId), reason: reason.trim() } }); onLinked(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa lưu được liên kết. Nội dung vẫn được giữ.'); }
    finally { lock.current = false; }
  }
  return <section className="expense-accounting-form" aria-label="Liên kết nguồn chi phí">
    <p className="expense-accounting-hint">Khoản ghi trước điều xe chưa gắn với công việc cụ thể.</p>
    {!open ? <div><button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>Liên kết công việc</button></div> : <>
      {work.isPending && <p role="status">Đang tải công việc trong lô…</p>}
      {work.isError && <p role="alert">Không tải được công việc. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void work.refetch()}>Thử lại</button></p>}
      {work.data && (realWork.length ? <><UuiSelectField label="Công việc thực tế" value={tripId} disabled={update.isPending} onChange={event => setTripId(event.target.value)} options={[{ value: '', label: 'Chọn công việc' }, ...realWork.map(item => ({ value: String(item.tripId), label: [item.containerNumber || item.shipmentCode || item.customerName, item.scheduledAt ? formatDate(item.scheduledAt) : '', item.vehiclePlate, item.driverName].filter(Boolean).join(' · ') }))]} />
        <TextField controlSize="sm" label="Lý do liên kết" value={reason} maxLength={1000} disabled={update.isPending} onChange={event => setReason(event.target.value)} />
        <div><button type="button" className="btn btn--secondary btn--sm" disabled={update.isPending} onClick={() => void save()}>{update.isPending ? 'Đang lưu…' : 'Lưu liên kết'}</button></div></> : <p>Chưa có công việc thực tế trong lô. Chi phí vẫn được giữ ở lô hàng.</p>)}
      {error && <p role="alert" className="expense-accounting-error">{error}</p>}
    </>}
  </section>;
}
