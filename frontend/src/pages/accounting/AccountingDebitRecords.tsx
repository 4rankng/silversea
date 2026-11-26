import type { AccountingDebitBoardRow } from '../../api/accountingDebitClient';
import { LedgerRecordList } from '../../components/shared/LedgerRecordList';
import type { RowSelection } from '../../hooks/useTableRowSelection';
import { formatDate } from '../../lib/format';
import { billBookingReference } from '../../lib/business-reference';
import type { CellContext, DebitColumn } from './AccountingDebitClosePage.columns';
import { DebitReadinessPopover } from './DebitReadinessPopover';

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
  // KB Ch.10 §10.6.1 (SIL-1075 ruling, Frank 26/11 — "follow KB") — one card
  // per LOT, mirroring the desktop board's one-row-per-lot law: every fact of
  // the lot (its money face included) appears ONCE, on the lot's own card.
  return <LedgerRecordList rows={rows.map((row) => {
    const billRef = billBookingReference(row.billOrBooking);
    const factColumns = columns.filter(column => column.key !== 'lo');
    return {
      key: row.shipmentId,
      title: billRef,
      subtitle: row.customerName ?? undefined,
      facts: [
        {
          key: 'ngay',
          label: 'Ngày',
          value: row.ngay == null ? '—' : formatDate(row.ngay),
          primary: true,
        },
        // SIL-1096 — the "còn thiếu gì" answer follows the lot onto the phone
        // face (the SAME one popover; the Lô column the trigger rides on the
        // board collapses into this card's title/subtitle).
        {
          key: 'dieuKienBangKe',
          label: 'Điều kiện bảng kê',
          value: <DebitReadinessPopover row={row} />,
          primary: false,
        },
        ...factColumns.map(column => ({
          key: column.key,
          label: column.label,
          value: column.cell(row, context),
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
  })} />;
}
