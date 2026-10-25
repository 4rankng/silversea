import { useState, type ReactNode } from 'react';
import type { ShipmentDebitLotRow } from '../../../api/shipmentClient';
import {
  LedgerGroupedList,
  LEDGER_GROUP_META_SEPARATOR,
  type LedgerGroupRow,
} from '../../../components/shared/LedgerGroupedList';
import { formatISODate, formatMoney } from '../../../lib/format';
import { ZERO_TOOLTIP, lotLabelOf, moneyState, titleCaseName } from './debitMoney';
import { ShipmentDebitWorkspace } from './ShipmentDebitWorkspace';

/** Owner redesign 23/10 (spec v2 (c)), amended 24/10: the phone board's money
 *  states — number | '0' (đã tính, = 0) | blank (pending reads as an empty
 *  cell; the amber pill drowned 170-lot boards). The banned string
 *  'Chưa xác định' stays gone from money facts. */
function money(value: ShipmentDebitLotRow['payableTotal'] | string | null | undefined): ReactNode {
  const state = moneyState(value);
  if (state.kind === 'pending') return null;
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

/** One label/value pair line of the expanded region's fact grid. */
function FactList({ facts }: { facts: Array<{ key: string; label: string; value: ReactNode; align?: 'end' }> }) {
  return (
    <dl className="ledger-glist__facts">
      {facts.map((fact) => (
        <div key={fact.key} className="ledger-glist__fact">
          <dt>{fact.label}</dt>
          <dd data-align={fact.align}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** SIL-478 (2026-10-25) — the phone board IS the verdict's grouped list:
 *  line 1 the customer (the row's identity, '—' when the LEFT JOIN misses —
 *  never an empty left), line 2 the meta segments Bill/Booking · ngày giao ·
 *  n cont, right side the Doanh thu money + the lock status chip on one
 *  baseline. No per-row action button: the row tap expands the detail
 *  (manager: the quyết toán workspace; reader: the remaining facts). */
export function ShipmentDebitRecords({ rows, canManage, selectedIds, expandedId, onSelect, onToggle, onSaved }: {
  rows: ShipmentDebitLotRow[]; canManage: boolean;
  /** Owner redesign 23/10: the ticks are always on the board — no on-demand
   *  merge mode to flip; they serve both jobs (gộp xe thu khách + xuất Debit
   *  Note) on any lot. */
  selectedIds: Set<number>; expandedId: number | null;
  onSelect: (id: number, selected: boolean) => void; onToggle: (id: number) => void; onSaved: () => void;
}) {
  // Reader (chỉ xem tổng hợp) expand state: the page's expandedId lane is a
  // manager concern (sessionStorage-backed); a reader still needs the row's
  // remaining facts one tap away.
  const [readerOpen, setReaderOpen] = useState<ReadonlySet<number>>(new Set());
  const toggleReader = (id: number) => {
    setReaderOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const groupedRows: LedgerGroupRow[] = rows.map((row) => {
    const label = lotLabelOf(row);
    // P0 (SIL-478): the payload CAN carry a null customer (the customers LEFT
    // JOIN misses) — the identity line renders '—', it never goes blank.
    const customer = titleCaseName(row.customerName) || '—';
    // Meta segments drop what the wire lacks (optional/skew-safe fields) —
    // the segments never fabricate a 0 cont or an empty '· ·'.
    const metaSegments = [
      label,
      row.deliveryDate ? formatISODate(row.deliveryDate) : null,
      row.containerCount != null && row.containerCount > 0 ? `${row.containerCount} cont` : null,
    ].filter((segment): segment is string => segment != null && segment !== '');
    const expanded = canManage ? expandedId === row.shipmentId : readerOpen.has(row.shipmentId);
    const detail = (
      <>
        <FactList facts={[
          { key: 'payable', label: 'Tổng chi', value: money(row.payableTotal) },
          { key: 'profit', label: 'Lợi nhuận', value: money(row.profit) },
          // 161026204709: the F-2 lane value (per-lot cước thu per boss 21/10)
          // and its reason note render on the expanded face, never nested in
          // a collapsed disclosure.
          { key: 'freight', label: 'Cước vận tải (Auto)', value: freightFact(row) },
          { key: 'customs', label: 'Số tờ khai', value: row.customsNumber ?? '—' },
          { key: 'factory', label: 'Nhà máy', value: row.factoryName ?? '—' },
          { key: 'address', label: 'Địa chỉ nhà máy', value: row.factoryAddress ?? '—' },
        ]} />
        {canManage && (
          <ShipmentDebitWorkspace shipmentId={row.shipmentId} customerId={row.customerId} locked={row.lockStatus === 'LOCKED'} onSaved={onSaved} />
        )}
      </>
    );
    return {
      key: row.shipmentId,
      name: label,
      title: customer,
      meta: metaSegments.length > 0
        ? metaSegments.join(LEDGER_GROUP_META_SEPARATOR)
        : null,
      amount: money(row.receivableTotal),
      chip: row.lockStatus === 'LOCKED'
        ? { label: 'Đã khóa', tone: 'neutral' as const }
        : { label: 'Đang mở', tone: 'open' as const },
      selected: selectedIds.has(row.shipmentId),
      selectable: canManage,
      onSelect: (next: boolean) => onSelect(row.shipmentId, next),
      expanded,
      onToggle: () => (canManage ? onToggle(row.shipmentId) : toggleReader(row.shipmentId)),
      detail,
    };
  });

  return <LedgerGroupedList rows={groupedRows} />;
}
