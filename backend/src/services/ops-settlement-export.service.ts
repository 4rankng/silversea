/**
 * Excel export for an Ops settlement batch (đề nghị thanh toán — OpsVanHanh
 * §5.4): ONE flat 6-column bảng kê (SIL-845) carrying at most the two invoice
 * baskets (A: Có hóa đơn / B: Không hóa đơn) and closed by the three total
 * rows — để Ops in đính kèm hồ sơ chứng từ gốc gửi kế toán.
 */
import ExcelJS from 'exceljs';
import { settlementRowDeclarationCell } from '@tingting/shared';
import { getOpsSettlementDetail, type OpsSettlementDetail } from './ops-settlements.service';

const MONEY_FORMAT = '#,##0';

/** SIL-845 — the two section markers INSIDE the one flat table; a section
 *  with no rows is skipped ("tối đa 2 mục"). */
const SHEET_SECTIONS = [
  { basketKey: 'withInvoice', label: 'A — Chi phí có hóa đơn' },
  { basketKey: 'withoutInvoice', label: 'B — Chi phí không hóa đơn' },
] as const;

export async function exportOpsSettlementXlsx(
  settlementId: number,
  preloaded?: OpsSettlementDetail,
): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const { settlement, grouping } = preloaded ?? await getOpsSettlementDetail(settlementId);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`ĐNTT ${settlement.code}`);

  sheet.columns = [
    { width: 24 }, { width: 22 }, { width: 20 }, { width: 22 }, { width: 26 }, { width: 14 },
  ];

  const title = sheet.addRow([`ĐỀ NGHỊ THANH TOÁN ${settlement.code}`]);
  title.font = { bold: true, size: 13 };
  sheet.addRow([`Người lập: ${settlement.opsUserName ?? '—'}`]);
  sheet.addRow([`Ngày lập: ${new Date(settlement.createdAt).toLocaleDateString('vi-VN')}`]);
  if (settlement.note) sheet.addRow([`Ghi chú: ${settlement.note}`]);
  sheet.addRow([]);

  const header = sheet.addRow(['Tên công ty', 'Số Bill/Book', 'Số tờ khai', 'Số cont', 'Tên chi phí', 'Số tiền']);
  header.font = { bold: true };

  // SIL-845 — bảng phẳng 6 cột LIỀN MẠCH, không tách khung theo khách/lô: the
  // lot groups stay in the data model, but the paper flattens every expense
  // row of the phiếu into the one table and only the A/B markers segment it.
  // Display-key contract unchanged: an internal id (shipmentCode, DB id)
  // never renders; a missing business key names itself.
  for (const { basketKey, label } of SHEET_SECTIONS) {
    const rows = grouping.groups.flatMap((group) => group[basketKey].items.map((item) => ({ item })));
    if (rows.length === 0) continue;
    const section = sheet.addRow([label]);
    section.font = { bold: true };
    for (const { item } of rows) {
      const row = sheet.addRow([
        item.customerName?.trim() || '—',
        item.billRef?.trim() || 'Chưa có số Bill/Booking',
        settlementRowDeclarationCell(item),
        item.containerLabel,
        item.expenseTypeName ?? '',
        Number(item.amount),
      ]);
      row.getCell(6).numFmt = MONEY_FORMAT;
    }
  }

  // SIL-845 — the three closing total rows of the phiếu.
  for (const [label, total] of [
    ['Tổng có hóa đơn', grouping.totals.withInvoice],
    ['Tổng không hóa đơn', grouping.totals.withoutInvoice],
    ['TỔNG CỘNG QUYẾT TOÁN', grouping.totals.grand],
  ] as const) {
    const row = sheet.addRow(['', '', '', '', label, Number(total)]);
    row.font = label === 'TỔNG CỘNG QUYẾT TOÁN' ? { bold: true, size: 12 } : { bold: true };
    row.getCell(6).numFmt = MONEY_FORMAT;
  }

  // SIL-751 — when the phiếu carries a negative row, the printed lines no
  // longer add up to TỔNG CỘNG QUYẾT TOÁN (the card 20260928_197 rule
  // excludes it), so say so on the paper instead of leaving a silent
  // 270.000 vs 320.000 gap.
  if (Number(grouping.totals.excludedNegative ?? 0) !== 0) {
    const excluded = sheet.addRow([
      '', '', '', '', 'Dòng âm đã loại trừ (không cộng vào tổng)', Number(grouping.totals.excludedNegative),
    ]);
    excluded.font = { italic: true, color: { argb: 'FF555555' } };
    excluded.getCell(6).numFmt = MONEY_FORMAT;
    const raw = sheet.addRow([
      '', '', '', '', 'Tổng nếu cộng cả dòng âm', Number(grouping.totals.rawGrand),
    ]);
    raw.font = { italic: true, color: { argb: 'FF555555' } };
    raw.getCell(6).numFmt = MONEY_FORMAT;
  }

  sheet.addRow([]);
  sheet.addRow([]);
  const signatures = sheet.addRow([
    'Người lập (Ops)', '', '', '', '', 'Kế toán',
  ]);
  signatures.font = { bold: true };
  sheet.addRow(['(Ký, ghi rõ họ tên)', '', '', '', '', '(Ký, ghi rõ họ tên)']);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, filename: `${settlement.code}.xlsx` };
}
