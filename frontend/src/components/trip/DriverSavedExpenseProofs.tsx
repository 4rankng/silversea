import { useState } from 'react';
import { qk } from '../../api/keys';
import { useQuery } from '@tanstack/react-query';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { ExpenseProofs } from '../../features/expense-accounting/ExpenseProofs';

/** Evidence belongs to the saved source: opening this never creates a cost. */
export function DriverSavedExpenseProofs({ expenseId }: { expenseId: number }) {
  const [open, setOpen] = useState(false);
  const source = useQuery({ queryKey: qk.expenseAccounting.entry('DRIVER', expenseId), enabled: open,
    queryFn: () => expenseAccountingClient.get({ sourceKind: 'DRIVER', sourceId: expenseId }) });
  return <div><button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
    {open ? 'Ẩn chứng từ' : 'Xem / bổ sung chứng từ'}
  </button>{open && <>{source.isPending && <p role="status">Đang tải chứng từ…</p>}{source.error && <p role="alert">{source.error.message}</p>}
    {source.data && <ExpenseProofs entry={source.data} canUpload={source.data.status === 'RECORDED'} />}</>}</div>;
}
