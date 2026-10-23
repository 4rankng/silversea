import type { ReactNode } from 'react';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';
import { LedgerRecordList } from '../../../components/shared/LedgerRecordList';
import { formatMoney } from '../../../lib/format';
import { PENDING_TOOLTIP, ZERO_TOOLTIP, moneyState, titleCaseName } from './debitMoney';
import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';

/** Owner redesign 23/10 (spec v2 (c)): the phone cards share the desktop
 *  board's three money states — number | '0' (đã tính, = 0) | 'Chờ số liệu'
 *  pill. The banned string 'Chưa xác định' is gone from money facts. */
function money(value: ShipmentDebitLotRow['payableTotal'] | string | null | undefined): ReactNode {
  const state = moneyState(value);
  if (state.kind === 'pending') return <span className="shipment-debit-money__pending" title={PENDING_TOOLTIP}>Chờ số liệu</span>;
  if (state.kind === 'zero') return <span className="shipment-debit-money__zero" title={ZERO_TOOLTIP}>0</span>;
  return formatMoney(state.value);
}

/** F-2 (card 161026113900, spec §3.2): the money value plus its override
 *  reason beneath — a grouped lot reads its own per-lot cước (per boss 21/10)
 *  with the "Ghép cước cùng Bill X" note. */
function freightFact(row: ShipmentDebitLotRow): ReactNode {
  const value = money(row.freightAuto);
  if (!row.freightOverrideReason) return value;
  return (
    <span className="record-cell-stack">
      <span>{value}</span>
      <small className="shipment-debit-row__freight-note" title={row.freightOverrideReason ?? undefined}>{row.freightOverrideReason}</small>
    </span>
  );
}

export function ShipmentDebitRecords({ rows, canManage, selectedIds, expandedId, onSelect, onToggle, onSaved }: {
  rows: ShipmentDebitLotRow[]; canManage: boolean;
  /** Owner redesign 23/10: the ticks are always on the board — no on-demand
   *  merge mode to flip; they serve both jobs (gộp xe thu khách + xuất Debit
   *  Note) on any lot. */
  selectedIds: Set<number>; expandedId: number | null;
  onSelect: (id: number, selected: boolean) => void; onToggle: (id: number) => void; onSaved: () => void;
}) {
  return <LedgerRecordList rows={rows.map((row) => {
    const title = row.billOrBookNumber || row.customsNumber || 'Chưa có Bill / Booking';
    const expanded = canManage && expandedId === row.shipmentId;
    return {
      key: row.shipmentId, title, subtitle: titleCaseName(row.customerName),
      selected: selectedIds.has(row.shipmentId),
      selectable: canManage,
      onSelect: (next: boolean) => onSelect(row.shipmentId, next),
      facts: [
        { key: 'receivable', label: 'Doanh thu', value: money(row.receivableTotal), primary: true },
        { key: 'payable', label: 'Tổng chi', value: money(row.payableTotal), primary: true },
        { key: 'profit', label: 'Lợi nhuận', value: money(row.profit), primary: true },
        { key: 'state', label: 'Trạng thái', value: row.lockStatus === 'LOCKED' ? 'Đã khóa' : 'Đang mở', primary: true },
        { key: 'bill', label: 'Số Bill', value: row.billOrBookNumber ?? 'Chưa có' },
        { key: 'customs', label: 'Số tờ khai', value: row.customsNumber ?? '—' },
        { key: 'factory', label: 'Nhà máy', value: row.factoryName ?? '—' },
        { key: 'address', label: 'Địa chỉ nhà máy', value: row.factoryAddress ?? '—' },
        // 161026204709: the F-2 lane value (per-lot cước thu per boss 21/10)
        // and its reason note render on the card face, never inside the
        // 'Chi tiết' collapse.
        { key: 'freight', label: 'Cước vận tải (Auto)', value: freightFact(row), primary: true },
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
