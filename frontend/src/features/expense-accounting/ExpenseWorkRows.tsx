import type { ExpenseWorkRow } from '@tingting/shared';
import { Link } from 'react-router-dom';
import { formatDateTimeShort } from '../../lib/format';
import { expenseMoney } from './expense-accounting-model';

export type WorkFeeGroup = 'receivable' | 'payable' | 'road';
export const WORK_FEE_LABELS = { receivable: 'Chi hộ phải thu', payable: 'Chi hộ phải trả', road: 'Tiền đường' };

export function ExpenseWorkRows({ rows, onOpen }: { rows: ExpenseWorkRow[]; onOpen: (row: ExpenseWorkRow, group: WorkFeeGroup) => void }) {
  return <div className="expense-register-table-wrap expense-work-table-wrap"><table className="expense-register-table expense-work-table">
    <thead><tr><th scope="col">Lịch / lô hàng</th><th scope="col">Khách / nhà máy / tuyến</th><th scope="col">Container / cảng</th><th scope="col">Điều phối</th><th scope="col">Ghi chú</th><th scope="col">Chi hộ phải thu</th><th scope="col">Chi hộ phải trả</th><th scope="col">Tiền đường</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.id} data-vehicle-start={index > 0 && row.vehiclePlate !== rows[index - 1].vehiclePlate}>
      <td data-label="Lịch / lô hàng" className="expense-work-identity"><Link to={`/shipments/${row.shipmentId}`}>{row.shipmentCode}</Link><span>{row.scheduledAt ? formatDateTimeShort(row.scheduledAt) : 'Chưa chốt lịch'}</span></td>
      <td data-label="Khách / nhà máy / tuyến"><strong>{row.customerName}</strong><span>Nhà máy: {row.factoryName ?? 'Chưa xác định'}</span><span>{row.routeName ?? 'Chưa có tuyến'}</span></td>
      <td data-label="Container / cảng"><strong>{row.containerNumber ?? 'Chưa có số cont'}</strong><span>{row.containerType ?? 'Chưa có loại cont'} · {row.classification ?? 'Chưa phân loại'}</span><small>Nâng: {row.liftLocation ?? '—'}</small><small>Hạ: {row.dropLocation ?? '—'}</small></td>
      <td data-label="Điều phối"><strong>{row.vehiclePlate ?? 'Chưa phân xe'}</strong><span>{row.driverName ?? 'Chưa phân lái xe'}</span><small>{row.carrierName ?? 'Chưa có nhà vận tải'}</small></td>
      <td data-label="Ghi chú" className="expense-work-notes"><small>Điều vận</small><span>{row.operationalNotes || '—'}</span><small>Lái xe</small><span>{row.driverNotes || '—'}</span></td>
      {(Object.keys(WORK_FEE_LABELS) as WorkFeeGroup[]).map(group => <td data-label={WORK_FEE_LABELS[group]} key={group} className="num"><button type="button" className="expense-register-money" onClick={() => onOpen(row, group)} aria-label={`${WORK_FEE_LABELS[group]} · ${row.shipmentCode} · ${row.containerNumber ?? 'phí chung'}`}>{expenseMoney(row[group])}</button></td>)}
    </tr>)}</tbody>
  </table></div>;
}
