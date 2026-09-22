import type { ExpenseAccountingEntry } from '@tingting/shared';
import { EXPENSE_COST_GROUP_LABELS } from '@tingting/shared';
import { formatDate } from '../../lib/format';
import { businessKey } from './business-key';
import { expenseKey, expenseMoney } from './expense-accounting-model';

export function ExpenseRegisterRows({ rows, selected, selectable, onSelect, onSelectAll, onOpen, canViewPayments }: {
  rows: ExpenseAccountingEntry[];
  selected: Set<string>;
  selectable: boolean;
  canViewPayments: boolean;
  onSelect: (entry: ExpenseAccountingEntry, checked: boolean) => void;
  /**
   * Header "Chọn tất cả" (card 20260922_7): toggle every selectable row
   * currently displayed. Absent = the host keeps the plain "Chọn" header
   * (opt-in so the work drawer and the shipment panel stay as they were).
   */
  onSelectAll?: (checked: boolean) => void;
  onOpen: (entry: ExpenseAccountingEntry) => void;
}) {
  // "All" means the selectable rows only — the same predicate the per-row
  // checkbox uses for `disabled` and the ops board uses for "Chọn trang này".
  const selectableRows = rows.filter(entry => entry.status === 'RECORDED');
  const selectedSelectable = selectableRows.filter(entry => selected.has(expenseKey(entry))).length;
  const allSelected = selectableRows.length > 0 && selectedSelectable === selectableRows.length;
  const someSelected = selectedSelectable > 0 && !allSelected;
  return <div className="expense-register-table-wrap"><table className="expense-register-table">
    <thead><tr>{selectable && <th scope="col">{onSelectAll ? <>
      <input
        type="checkbox"
        aria-label="Chọn tất cả"
        title="Chọn tất cả"
        checked={allSelected}
        ref={(node) => { if (node) node.indeterminate = someSelected; }}
        onChange={(event) => onSelectAll(event.target.checked)}
      />{' '}Chọn
    </> : 'Chọn'}</th>}<th scope="col">Lô / công việc</th><th scope="col">Xe / người chi</th><th scope="col">Khoản chi</th><th scope="col">Thực chi</th><th scope="col">Thực thu</th>
      {canViewPayments && <><th scope="col">Còn phải thu</th><th scope="col">Còn phải trả</th></>}<th scope="col">Đối chiếu</th></tr></thead>
    <tbody>{rows.map(entry => <tr key={expenseKey(entry)}>
      {selectable && <td className="expense-register-select"><input type="checkbox" aria-label={`Chọn ${entry.feeName} · ${businessKey(entry.shipmentCode) ?? entry.customerName}`} checked={selected.has(expenseKey(entry))} disabled={entry.status !== 'RECORDED'} onChange={(event) => onSelect(entry, event.target.checked)} /></td>}
      <td data-label="Lô / công việc" className="expense-register-context"><button type="button" className="expense-register-open" onClick={() => onOpen(entry)}>{businessKey(entry.shipmentCode) ?? `${entry.customerName} · ${formatDate(entry.expenseDate)}`}</button><span>{entry.customerName}</span><small>{entry.containerNumber ?? 'Phí chung lô'}</small>{entry.routeName && <small>{entry.routeName}</small>}</td>
      <td data-label="Xe / người chi"><strong>{entry.truckPlate ?? 'Chưa có xe'}</strong>{entry.driverName && <span>{entry.driverName}</span>}<small>{entry.carrierName ?? entry.carrierCode ?? ''}</small><span>{entry.payerName ?? (entry.payerKind === 'COMPANY' ? 'Công ty trả trực tiếp' : 'Chưa xác định người chi')}</span></td>
      <td data-label="Khoản chi"><button type="button" className="expense-register-open" onClick={() => onOpen(entry)}>{entry.feeName}</button><small>{entry.costGroup ? EXPENSE_COST_GROUP_LABELS[entry.costGroup] : 'Chưa phân loại'} · {formatDate(entry.expenseDate)}</small><span>{entry.invoiceNumber ? `HĐ ${entry.invoiceNumber}` : entry.evidenceMissing ? 'Cần bổ sung chứng từ' : 'Không có hóa đơn'}</span></td>
      <td data-label="Thực chi" className="num"><button type="button" className="expense-register-money" onClick={() => onOpen(entry)}>{expenseMoney(entry.amount)}</button></td>
      <td data-label="Thực thu" className="num">{expenseMoney(entry.customerChargeAmount)}</td>
      {canViewPayments && <><td data-label="Còn phải thu" className="num">{expenseMoney(entry.outstandingReceivable)}</td><td data-label="Còn phải trả" className="num">{expenseMoney(entry.outstandingPayable)}</td></>}
      <td data-label="Đối chiếu"><span>{entry.status === 'VOIDED' ? 'Đã hủy' : entry.confirmedAt ? 'Đã đối chiếu' : 'Chưa đối chiếu'}</span>{entry.confirmedAt && <small>{formatDate(entry.confirmedAt)}</small>}{entry.locked && <small>Đã khóa chỉnh sửa</small>}</td>
    </tr>)}</tbody>
  </table></div>;
}
