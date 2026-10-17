import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { LedgerRecordList } from '../../components/shared/LedgerRecordList';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import { billBookingReference } from '../../lib/business-reference';
import type { CellContext, DebitColumn } from './AccountingDebitClosePage.columns';

// 161026204709: `cuocThu` is primary — the F-2 100%/0₫ lane price must render
// on the card face (the member's reason rides the `container` fact), never
// inside the 'Chi tiết' collapse.
const PRIMARY_FACTS: Record<string, true> = {
  ngay: true, container: true, cuocThu: true, tongThu: true, tong1: true, loiNhuan: true, doiSoat: true,
};

/** A phone reads the same source columns as the accounting matrix. */
export function AccountingDebitRecords({ rows, columns, context, selection }: {
  rows: AccountingDebitBoardRow[];
  columns: DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
}) {
  return <LedgerRecordList rows={rows.map(row => ({
    key: row.shipmentId,
    title: billBookingReference(row.billOrBooking),
    subtitle: row.customerName ?? undefined,
    facts: columns.filter(column => column.key !== 'lo').map(column => ({
      key: column.key,
      label: column.label,
      value: column.cell(row, context),
      primary: PRIMARY_FACTS[column.key] === true,
      layout: column.key === 'doiSoat' && row.adjustment.status === 'PENDING' ? 'full-width' as const : undefined,
    })),
    selected: selection.isSelected(row.shipmentId),
    selectable: row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED',
    onSelect: selected => {
      if (selected !== selection.isSelected(row.shipmentId)) selection.toggle(row.shipmentId);
    },
  }))} />;
}
