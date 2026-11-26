import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { LedgerRecordList } from '../../components/shared/LedgerRecordList';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import { formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import { debitBoardSubRowCount, type CellContext, type DebitColumn } from './AccountingDebitClosePage.columns';

// 161026204709: `cucPhaiThu` is primary — the F-2 lane price (per-lot cước
// thu per boss 21/10) must render on the card face (the lot's reason rides
// the `thongSo` fact since SIL-944 moved it out of `hangHoaCont`), never
// inside the 'Chi tiết' collapse. SIL-772 — the facts carry the Rev2 group
// keys; `lo` collapses into title/subtitle.
const PRIMARY_FACTS: Record<string, true> = {
  hangHoaCont: true, thongSo: true, cucPhaiThu: true, tongThu: true, tongTraChiPhiNgoai: true, loiNhuan: true, ghiChuDoiSoat: true,
};

/** A phone reads the same source columns as the accounting matrix. */
export function AccountingDebitRecords({ rows, columns, context, selection }: {
  rows: AccountingDebitBoardRow[];
  columns: readonly DebitColumn[];
  context: CellContext;
  selection: RowSelection<number>;
}) {
  // Ticket 18/11 Task 2.2 — a multi-container FCL lot fans out into one card
  // per container, mirroring the desktop board's sub-row law: the head card
  // keeps the full fact set, continuation cards carry ONLY the spansSubrows
  // columns (their own container + vehicle facts), so money never reads as
  // duplicated across cards. LCL and single-container lots stay one card.
  return <LedgerRecordList rows={rows.flatMap((row) => {
    const subRowCount = debitBoardSubRowCount(row);
    return Array.from({ length: subRowCount }, (_, containerIndex) => {
      const isHead = containerIndex === 0;
      const billRef = billBookingReference(row.billOrBooking);
      const factColumns = isHead
        ? columns.filter(column => column.key !== 'lo')
        : columns.filter(column => column.spansSubrows === true);
      return {
        key: isHead ? row.shipmentId : `${row.shipmentId}#${containerIndex}`,
        title: isHead ? billRef : `${billRef} · cont ${containerIndex + 1}`,
        subtitle: row.customerName ?? undefined,
        facts: [
          ...(isHead ? [{
            key: 'ngay',
            label: 'Ngày',
            value: row.ngay == null ? '—' : formatDate(row.ngay),
            primary: true,
          }] : []),
          ...factColumns.map(column => ({
            key: column.key,
            label: column.label,
            value: column.cell(row, isHead ? context : { ...context, containerIndex }),
            primary: PRIMARY_FACTS[column.key] === true,
            layout: (column.key === 'cucPhaiThu' || column.key === 'cucPhaiTra' || column.key === 'tongTraChiPhiNgoai'
              || (column.key === 'ghiChuDoiSoat' && row.adjustment.status === 'PENDING'))
              ? 'full-width' as const
              : undefined,
          })),
        ],
        selected: selection.isSelected(row.shipmentId),
        selectable: row.adjustment.status === 'NONE' || row.adjustment.status === 'CONFIRMED',
        onSelect: selected => {
          if (selected !== selection.isSelected(row.shipmentId)) selection.toggle(row.shipmentId);
        },
      };
    });
  })} />;
}
