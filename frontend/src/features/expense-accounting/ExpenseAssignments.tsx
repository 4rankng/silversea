import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TruckAccountantAssignment } from '@tingting/shared';
import { expenseAccountingClient, type ExpenseAccountingCatalog } from '../../api/expenseAccountingClient';
import { qk } from '../../api/keys';
import { TextField, UuiSelectField } from '../../design-system';

function AssignmentRow({ row, accountants, onSave, busy }: { row: TruckAccountantAssignment; accountants: ExpenseAccountingCatalog['accountants']; busy: boolean; onSave: (accountantId: number | null) => void }) {
  const [choice, setChoice] = useState(String(row.accountantId ?? ''));
  return <tr><td data-label="Xe" className="expense-register-context"><strong>{row.truckPlate}</strong></td><td data-label="Kế toán phụ trách"><UuiSelectField label={`Kế toán · ${row.truckPlate}`} value={choice} disabled={busy} onChange={event => setChoice(event.target.value)} options={[{ value: '', label: 'Chưa phân công' }, ...accountants.map(item => ({ value: String(item.id), label: item.name }))]} /></td><td data-label=""><button type="button" className="btn btn--secondary btn--sm" disabled={busy || choice === String(row.accountantId ?? '')} onClick={() => onSave(choice ? Number(choice) : null)}>Lưu phân công</button></td></tr>;
}
export function ExpenseAssignments({ catalog }: { catalog: ExpenseAccountingCatalog }) {
  const cache = useQueryClient();
  const [search, setSearch] = useState('');
  const assignments = useQuery({ queryKey: qk.expenseAccounting.assignments, queryFn: expenseAccountingClient.assignments });
  const mutation = useMutation({ mutationFn: expenseAccountingClient.assign, onSuccess: () => cache.invalidateQueries({ queryKey: qk.expenseAccounting.all }) });
  const rows = (assignments.data?.items ?? []).filter(row => `${row.truckPlate} ${row.accountantName ?? ''}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')));
  return <section className="expense-accounting" aria-label="Phân công xe cho kế toán">
    <p className="expense-accounting-notice">Phân công dùng để chia công việc và lọc mặc định. Kế toán vẫn xem được các xe khác và xe chưa phân công trong quyền hiện có.</p>
    <TextField controlSize="sm" label="Tìm xe / kế toán" value={search} onChange={event => setSearch(event.target.value)} />
    {mutation.isError && <p role="alert" className="expense-accounting-error">{mutation.error instanceof Error ? mutation.error.message : 'Không lưu được phân công.'}</p>}
    {assignments.isPending ? <p role="status">Đang tải xe…</p> : assignments.isError ? <p role="alert">Không tải được phân công. <button type="button" className="btn btn--secondary" onClick={() => void assignments.refetch()}>Thử lại</button></p> : <div className="expense-register-table-wrap"><table className="expense-register-table"><thead><tr><th scope="col">Xe</th><th scope="col">Kế toán phụ trách</th><th scope="col">Thao tác</th></tr></thead><tbody>{rows.map(row => <AssignmentRow key={`${row.truckId}:${row.version}`} row={row} accountants={catalog.accountants} busy={mutation.isPending} onSave={accountantId => mutation.mutate({ truckId: row.truckId, accountantId, expectedVersion: row.version })} />)}</tbody></table>{!rows.length && <p className="expense-accounting-empty">Không có xe phù hợp.</p>}</div>}
  </section>;
}
