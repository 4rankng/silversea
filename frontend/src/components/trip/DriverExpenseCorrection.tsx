import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { expenseAccountingUpdateSchema, type ExpenseAccountingEntry } from '@tingting/shared';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { DateField, NumberField, TextField } from '../../design-system';

/** Drivers correct their own unconfirmed source through the audited versioned command. */
export function DriverExpenseCorrection({ expenseId, onSaved }: { expenseId: number; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const source = useQuery({ queryKey: qk.expenseAccounting.entry('DRIVER', expenseId), enabled: open, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: () => expenseAccountingClient.get({ sourceKind: 'DRIVER', sourceId: expenseId }) });
  const client = useQueryClient();
  async function saved() {
    await client.invalidateQueries({ queryKey: qk.expenseAccounting.entry('DRIVER', expenseId) });
    await onSaved();
    setOpen(false);
  }
  return <div>{!open ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>Sửa khoản chi</button> : <>
    {source.isPending && <p role="status">Đang tải khoản chi…</p>}
    {source.isError ? <div role="alert">Không tải được khoản chi. <button type="button" className="btn btn--secondary btn--sm" onClick={() => void source.refetch()}>Thử tải lại khoản chi</button><button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Đóng sửa khoản chi</button></div>
      : source.data && <DriverExpenseCorrectionForm key={`${source.data.id}:${source.data.version}`} entry={source.data} onSaved={saved} onClose={() => setOpen(false)} onReload={() => source.refetch()} />}
  </>}</div>;
}

export function DriverExpenseCorrectionForm({ entry, onSaved, onClose, onReload }: {
  entry: ExpenseAccountingEntry; onSaved: () => Promise<void>; onClose: () => void; onReload: () => Promise<unknown>;
}) {
  const [amount, setAmount] = useState<number | ''>(entry.amount);
  const [name, setName] = useState(entry.feeName);
  const [date, setDate] = useState(entry.expenseDate);
  const [invoice, setInvoice] = useState(entry.invoiceNumber ?? '');
  const [invoiceDate, setInvoiceDate] = useState(entry.invoiceDate ?? '');
  const [note, setNote] = useState(entry.note ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const blocked = entry.locked || Boolean(entry.confirmedAt) || Boolean(entry.reconciliationId) || entry.status !== 'RECORDED';
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (blocked || lock.current) return;
    const parsed = expenseAccountingUpdateSchema.safeParse({ expectedVersion: entry.version, amount, feeName: name, expenseDate: date,
      invoiceNumber: invoice.trim() || null, invoiceDate: invoiceDate || null, note: note.trim() || null, reason });
    if (!parsed.success) { setError('Kiểm tra số tiền nguyên dương, tên khoản chi, ngày hợp lệ và lý do điều chỉnh.'); return; }
    lock.current = true; setBusy(true); setError(null);
    try {
      await expenseAccountingClient.update({ sourceKind: 'DRIVER', sourceId: entry.sourceId, expectedVersion: entry.version }, parsed.data);
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chưa lưu được điều chỉnh. Nội dung vẫn được giữ.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form className="shipment-cost-entry__form" aria-label={`Sửa khoản chi ${entry.feeName}`} onSubmit={event => void save(event)}>
    {blocked ? <p role="status">Khoản chi đã đối chiếu, lập phiếu hoặc khóa. Liên hệ kế toán để điều chỉnh và giữ lịch sử.</p> : <>
      {error && <div role="alert" className="shipment-cost-entry__banner--error">{error}<button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void onReload()}>Tải lại khoản chi</button></div>}
      <div className="shipment-cost-entry__fields">
        <TextField controlSize="sm" label="Tên khoản chi" value={name} required maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} />
        <NumberField controlSize="sm" label="Thực chi (VND)" value={amount} min={1} max={999_999_999_999_999} step={1} required disabled={busy} onChange={setAmount} />
        <DateField controlSize="sm" label="Ngày chi" value={date} required disabled={busy} onChange={setDate} />
        {entry.costGroup !== 'DRIVER_ROAD' && <><TextField controlSize="sm" label="Số hóa đơn" value={invoice} maxLength={100} disabled={busy} onChange={event => setInvoice(event.target.value)} /><DateField controlSize="sm" label="Ngày hóa đơn" value={invoiceDate} disabled={busy} onChange={setInvoiceDate} /></>}
      </div>
      <TextField controlSize="sm" label="Ghi chú khoản chi" value={note} maxLength={2000} disabled={busy} onChange={event => setNote(event.target.value)} />
      <TextField controlSize="sm" label="Lý do điều chỉnh" value={reason} required maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} />
    </>}
    <div className="shipment-cost-entry__form-actions"><button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { if (!lock.current) onClose(); }}>Đóng sửa khoản chi</button>
      {!blocked && <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Đang lưu điều chỉnh…' : 'Lưu điều chỉnh'}</button>}
    </div>
  </form>;
}
