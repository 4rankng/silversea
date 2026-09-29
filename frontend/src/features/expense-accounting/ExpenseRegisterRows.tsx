import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ExpenseAccountingEntry } from '@tingting/shared';
import { EXPENSE_COST_GROUP_LABELS } from '@tingting/shared';
import { useTableRowSelection } from '../../hooks/useTableRowSelection';
import { formatDate } from '../../lib/format';
import { businessKey } from './business-key';
import { expenseKey, expenseMoney, isConfirmableEntry } from './expense-accounting-model';

/** The hook holds its own set; the host holds the batch it will actually act
 *  on. They are equal by construction except for the one round trip between a
 *  click and the host re-rendering, so "did these two sets differ" is the only
 *  question this table ever has to ask about selection. */
function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

export function ExpenseRegisterRows({ rows, selected, selectable, onSelect, onOpen, canViewPayments, onConfirm }: {
  rows: ExpenseAccountingEntry[];
  selected: Set<string>;
  selectable: boolean;
  canViewPayments: boolean;
  onSelect: (entry: ExpenseAccountingEntry, checked: boolean) => void;
  onOpen: (entry: ExpenseAccountingEntry) => void;
  /** Card 20260928_168 (PM ruling 2026-09-29 câu 3): when a host offers duyệt,
   *  the approve action lives IN the 'Ngày duyệt' column — a per-row button
   *  for exactly the rows isConfirmableEntry admits. Hosts that do not pass
   *  it (the lot panel, the work drawer) keep the read-only cell. */
  onConfirm?: (entry: ExpenseAccountingEntry) => void;
}) {
  // "All" means the confirmable rows only — the same helper that decides
  // whether a row can be picked here and the one the ops board uses for its
  // three selection entry points (card 20260928_168 AC2: an already-approved
  // row keeps status RECORDED, so a status-only predicate re-selects it and
  // the batch is refused wholesale).
  //
  // Card 20260929_207: the selection column is gone, so a row IS the control —
  // click it, or focus it and press Space. The batch stays with the host (on
  // the ops board it spans pages, which no table-local state can hold), so
  // `rowProps` — the guard that stops a press on a row's own control from also
  // picking the row — is reconciled with the host below rather than the two
  // sets being allowed to drift.
  const selection = useTableRowSelection<string>(selected);
  const byKey = useMemo(() => new Map(rows.map(entry => [expenseKey(entry), entry])), [rows]);
  // The last pair the two sides agreed on. Which side moved is what the record
  // is for: a changed `selected` came from the host (Chọn trang này, a
  // cross-page pick, a page change), a changed `selection.selected` came from a
  // row click.
  const settled = useRef<{ host: ReadonlySet<string>; rows: ReadonlySet<string> }>({ host: new Set(selected), rows: new Set(selected) });

  useLayoutEffect(() => {
    const previous = settled.current;
    const host = new Set(selected);
    const picked = selection.selected;
    if (!sameKeys(previous.host, host)) {
      settled.current = { host, rows: host };
      if (!sameKeys(picked, host)) selection.selectAll([...host]);
      return;
    }
    if (sameKeys(previous.rows, picked)) return;
    settled.current = { host, rows: picked };
    for (const key of picked) {
      if (previous.rows.has(key)) continue;
      const entry = byKey.get(key);
      if (entry) onSelect(entry, true);
    }
    for (const key of previous.rows) {
      if (picked.has(key)) continue;
      const entry = byKey.get(key);
      if (entry) onSelect(entry, false);
    }
  });

  return <div className="expense-register-table-wrap">
    {selectable && <p className="expense-accounting-hint">Bấm vào một dòng để chọn hoặc bỏ chọn · dòng đã đối chiếu hoặc đã hủy không chọn được.</p>}
    <table className="expense-register-table">
    <thead><tr><th scope="col">Lô / công việc</th><th scope="col">Xe / người chi</th><th scope="col">Khoản chi</th><th scope="col">Thực chi</th><th scope="col">Thực thu</th>
      {canViewPayments && <><th scope="col">Còn phải thu</th><th scope="col">Còn phải trả</th></>}<th scope="col">Ngày duyệt</th></tr></thead>
    <tbody>{rows.map(entry => {
      const key = expenseKey(entry);
      const pickable = selectable && isConfirmableEntry(entry);
      const isSelected = selected.has(key);
      return <tr
        key={key}
        data-selected={isSelected || undefined}
        aria-selected={pickable ? isSelected : undefined}
        className={!selectable ? undefined : pickable ? 'expense-register-row--pickable' : 'expense-register-row--locked'}
        tabIndex={pickable ? 0 : undefined}
        {...selection.rowProps(key, { selectable: pickable })}
      >
      <td data-label="Lô / công việc" className="expense-register-context"><button type="button" className="expense-register-open" onClick={() => onOpen(entry)}>{businessKey(entry.shipmentCode) ?? `${entry.customerName} · ${formatDate(entry.expenseDate)}`}</button><span>{entry.customerName}</span><small>{entry.containerNumber ?? 'Phí chung lô'}</small>{entry.routeName && <small>{entry.routeName}</small>}</td>
      <td data-label="Xe / người chi"><strong>{entry.truckPlate ?? 'Chưa có xe'}</strong>{entry.driverName && <span>{entry.driverName}</span>}<small>{entry.carrierName ?? entry.carrierCode ?? ''}</small><span>{entry.payerName ?? (entry.payerKind === 'COMPANY' ? 'Công ty trả trực tiếp' : 'Chưa xác định người chi')}</span></td>
      <td data-label="Khoản chi"><button type="button" className="expense-register-open" onClick={() => onOpen(entry)}>{entry.feeName}</button><small>{entry.costGroup ? EXPENSE_COST_GROUP_LABELS[entry.costGroup] : 'Chưa phân loại'} · {formatDate(entry.expenseDate)}</small><span>{entry.invoiceNumber ? `HĐ ${entry.invoiceNumber}` : entry.evidenceMissing ? 'Cần bổ sung chứng từ' : 'Không có hóa đơn'}</span></td>
      <td data-label="Thực chi" className="num"><button type="button" className="expense-register-money" onClick={() => onOpen(entry)}>{expenseMoney(entry.amount)}</button></td>
      <td data-label="Thực thu" className="num">{expenseMoney(entry.customerChargeAmount)}</td>
      {canViewPayments && <><td data-label="Còn phải thu" className="num">{expenseMoney(entry.outstandingReceivable)}</td><td data-label="Còn phải trả" className="num">{expenseMoney(entry.outstandingPayable)}</td></>}
      <td data-label="Ngày duyệt">
        {onConfirm && isConfirmableEntry(entry) && !entry.locked
          ? <button type="button" className="btn btn--secondary btn--sm" onClick={() => onConfirm(entry)}>Duyệt</button>
          : <><span>{entry.status === 'VOIDED' ? 'Đã hủy' : entry.confirmedAt ? 'Đã đối chiếu' : 'Chưa đối chiếu'}</span>{entry.confirmedAt && <small>{formatDate(entry.confirmedAt)}</small>}{entry.confirmedAt && <small>{`Người duyệt: ${entry.confirmedByName ?? (entry.confirmedById != null ? `#${entry.confirmedById}` : '—')}`}</small>}{entry.locked && !entry.confirmedAt && <small>Đã khóa chỉnh sửa</small>}</>}
      </td>
    </tr>;
    })}</tbody>
  </table></div>;
}
