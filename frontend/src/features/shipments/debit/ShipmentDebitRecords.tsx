import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';
import { LedgerRecordList } from '../../../components/shared/LedgerRecordList';
import { formatMoney } from '../../../lib/format';
import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';

const money = (value: ShipmentDebitLotRow['payableTotal']) => value == null ? 'Chưa xác định' : formatMoney(value);

export function ShipmentDebitRecords({ rows, canManage, selectedIds, expandedId, onSelect, onToggle, onSaved }: {
  rows: ShipmentDebitLotRow[]; canManage: boolean; selectedIds: Set<number>; expandedId: number | null;
  onSelect: (id: number, selected: boolean) => void; onToggle: (id: number) => void; onSaved: () => void;
}) {
  return <LedgerRecordList rows={rows.map((row) => {
    const title = row.billOrBookNumber || row.customsNumber || 'Chưa có Bill / Booking';
    const expanded = canManage && expandedId === row.shipmentId;
    return {
      key: row.shipmentId, title, subtitle: row.customerName?.toUpperCase(),
      selected: selectedIds.has(row.shipmentId), selectable: canManage && row.lockStatus === 'LOCKED',
      onSelect: (next: boolean) => onSelect(row.shipmentId, next),
      facts: [
        { key: 'receivable', label: 'Tổng phải thu khách', value: money(row.receivableTotal), primary: true },
        { key: 'payable', label: 'Tổng phải trả', value: money(row.payableTotal), primary: true },
        { key: 'profit', label: 'Lợi nhuận', value: money(row.profit), primary: true },
        { key: 'state', label: 'Trạng thái', value: row.lockStatus === 'LOCKED' ? 'Đã khóa' : 'Đang mở', primary: true },
        { key: 'bill', label: 'Số Bill', value: row.billOrBookNumber ?? 'Chưa có' },
        { key: 'customs', label: 'Số tờ khai', value: row.customsNumber ?? 'Chưa có' },
        { key: 'factory', label: 'Nhà máy', value: row.factoryName ?? '—' },
        { key: 'address', label: 'Địa chỉ nhà máy', value: row.factoryAddress ?? '—' },
        { key: 'freight', label: 'Cước vận tải (Auto)', value: money(row.freightAuto) },
        { key: 'chiho', label: 'Tổng chi hộ', value: money(row.chiHoTotal) },
        ...(canManage ? [{ key: 'open', label: 'Quyết toán lô', primary: true, layout: expanded ? 'full-width' as const : undefined, value: <>
          <button type="button" className="btn btn--secondary btn--sm" aria-expanded={expanded}
            aria-label={`${expanded ? 'Đóng' : 'Mở'} chi tiết lô ${title}`} onClick={() => onToggle(row.shipmentId)}>
            {expanded ? 'Đóng chi tiết lô' : 'Mở chi tiết lô'}
          </button>
          {expanded && <ShipmentDebitWorkspace shipmentId={row.shipmentId} customerId={row.customerId} locked={row.lockStatus === 'LOCKED'} onSaved={onSaved} />}
        </> }] : []),
      ],
    };
  })} />;
}
