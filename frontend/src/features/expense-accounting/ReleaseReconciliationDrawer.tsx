import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExpenseReconciliation } from '@tingting/shared';
import { Drawer } from '../../components/UI';
import { TextField } from '../../design-system';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';

export function ReleaseReconciliationDrawer({ item, onClose }: { item: ExpenseReconciliation; onClose: () => void }) {
  const id = useId(), cache = useQueryClient();
  const [reason, setReason] = useState('');
  const lock = useRef(false), request = useRef<{ reason: string; key: string } | null>(null);
  const mutation = useMutation({ mutationFn: ({ reason, key }: { reason: string; key: string }) => expenseAccountingClient.releaseReconciliation(item.id, reason, key), onSuccess: () => cache.invalidateQueries({ queryKey: qk.expenseAccounting.all }) });
  const close = () => { if (!lock.current) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !reason.trim()) return;
    if (request.current?.reason !== reason.trim()) request.current = { reason: reason.trim(), key: crypto.randomUUID() };
    lock.current = true;
    try { await mutation.mutateAsync(request.current); onClose(); }
    catch { /* Keep the draft and idempotency key for a deliberate retry. */ }
    finally { lock.current = false; }
  }
  return <Drawer isOpen title={`Hoàn tác ${item.code}`} onClose={close} className="expense-accounting-drawer" footer={<><button type="button" className="btn btn--secondary" disabled={mutation.isPending} onClick={close}>Hủy</button><button type="submit" form={id} className="btn btn--primary" disabled={mutation.isPending || !reason.trim()}>{mutation.isPending ? 'Đang lưu…' : 'Hoàn tác đối chiếu'}</button></>}>
    <form id={id} className="expense-accounting-form" onSubmit={event => void save(event)}>
      <p>Giữ đợt này trong lịch sử và trả các khoản nguồn về trạng thái chưa đối chiếu để điều chỉnh. Cần đảo các phiếu tiền liên quan trước; thao tác này không chuyển tiền.</p>
      <TextField controlSize="sm" label="Lý do hoàn tác" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} required disabled={mutation.isPending} />
      {mutation.isError && <p role="alert" className="expense-accounting-error">{mutation.error instanceof Error ? mutation.error.message : 'Không hoàn tác được đối chiếu.'}</p>}
    </form>
  </Drawer>;
}
