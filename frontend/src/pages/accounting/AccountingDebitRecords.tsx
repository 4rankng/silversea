import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { LedgerRecordList } from '../../components/shared/LedgerRecordList';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import { formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import type { CellContext, DebitColumn } from './AccountingDebitClosePage.columns';

// 161026204709: `cucPhaiThu` is primary — the F-2 lane price (per-lot cước
// thu per boss 21/10) must render on the card face (the lot's reason rides the
// `hangHoaCont` fact), never inside the 'Chi tiết' collapse. SIL-772 — the
// facts carry the NINE Rev2 group keys; `lo` collapses into title/subtitle.
const PRIMARY_FACTS: Record<string, true> = {
  hangHoaCont: true, cucPhaiThu: true, tongThu: true, tongTraChiPhiNgoai: true, loiNhuan: true, ghiChuDoiSoat: true,
};

/** A phone reads the same source columns as the accounting matrix. */
export function AccountingDebitRecords({ rows, columns, context, selection }: {
  rows: AccountingDebitBoardRow[];
  columns: readonly DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
}) {
  return <LedgerRecordList rows={rows.map(row => ({
    key: row.shipmentId,
    title: billBookingReference(row.billOrBooking),
    subtitle: row.customerName ?? undefined,
    // SIL-772 review (Major 2): the date used to be its own column on the
    // card face; the nine-group model folds it into 'lo' which the card
    // collapses into title/subtitle — so the card emits the Ngày fact
    // directly or the row date disappears from the phone surface.
    facts: [
      {
        key: 'ngay',
        label: 'Ngày',
        value: row.ngay == null ? '—' : formatDate(row.ngay),
        primary: true,
      },
      ...columns.filter(column => column.key !== 'lo').map(column => ({
        key: column.key,
        label: column.label,
        value: column.cell(row, context),
        primary: PRIMARY_FACTS[column.key] === true,
        layout: column.key === 'ghiChuDoiSoat' && row.adjustment.status === 'PENDING' ? 'full-width' as const : undefined,
      })),
    ],
    selected: selection.isSelected(row.shipmentId),
    selectable: row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED',
    onSelect: selected => {
      if (selected !== selection.isSelected(row.shipmentId)) selection.toggle(row.shipmentId);
    },
  }))} />;
}
