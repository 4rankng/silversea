/**
 * Excel export for an Ops settlement batch (đề nghị thanh toán — OpsVanHanh
 * §5.4): bảng kê theo lô, 2 rổ Có/Không hóa đơn, dòng tổng — để Ops in đính
 * kèm hồ sơ chứng từ gốc gửi kế toán.
 */
import ExcelJS from 'exceljs';
import { getOpsSettlementDetail } from './ops-settlements.service';
import { formatVND } from '../lib/format';

const MONEY_FORMAT = '#,##0';
const EXPENSE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Nháp',
  RECORDED: 'Đã ghi nhận',
  VOIDED: 'Đã hủy',
  APPROVED: 'Đã ghi nhận',
  PENDING: 'Chưa ghi nhận (dữ liệu cũ)',
  REJECTED: 'Đã từ chối (dữ liệu cũ)',
};

export async function exportOpsSettlementXlsx(
  settlementId: number,
  preloaded?: Awaited<ReturnType<typeof getOpsSettlementDetail>>,
): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const { settlement, grouping } = preloaded ?? await getOpsSettlementDetail(settlementId);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`ĐNTT ${settlement.code}`);

  sheet.columns = [
    { width: 22 }, { width: 26 }, { width: 18 }, { width: 16 }, { width: 14 },
  ];

  const title = sheet.addRow([`ĐỀ NGHỊ THANH TOÁN ${settlement.code}`]);
  title.font = { bold: true, size: 13 };
  sheet.addRow([`Người lập: ${settlement.opsUserName ?? '—'}`]);
  sheet.addRow([`Ngày lập: ${new Date(settlement.createdAt).toLocaleDateString('vi-VN')}`]);
  if (settlement.note) sheet.addRow([`Ghi chú: ${settlement.note}`]);
  sheet.addRow([]);

  for (const group of grouping.groups) {
    // SIL-811 — the per-lot identity title (KH viết tắt · Bill/Booking + tờ
    // khai · Số cont), identical to the on-screen sheet.
    const header = sheet.addRow([group.identityTitle]);
    header.font = { bold: true };

    for (const [label, basket] of [
      ['Có hóa đơn', group.withInvoice],
      ['Không hóa đơn', group.withoutInvoice],
    ] as const) {
      if (basket.items.length === 0) continue;
      const basketHeader = sheet.addRow([`— ${label} —`]);
      basketHeader.font = { bold: true, color: { argb: 'FF555555' } };
      for (const item of basket.items) {
        const row = sheet.addRow([
          item.containerLabel,
          item.expenseTypeName ?? '',
          Number(item.amount),
          EXPENSE_STATUS_LABELS[item.approvalStatus] ?? item.approvalStatus,
        ]);
        row.getCell(3).numFmt = MONEY_FORMAT;
      }
      const subtotal = sheet.addRow(['', `Tổng ${label}`, Number(basket.total), '']);
      subtotal.font = { bold: true };
      subtotal.getCell(3).numFmt = MONEY_FORMAT;
    }

    const groupTotal = sheet.addRow(['', `Tổng lô ${group.billRef?.trim() || 'Chưa có số Bill/Booking'}`, Number(group.total), '']);
    groupTotal.font = { bold: true };
    groupTotal.getCell(3).numFmt = MONEY_FORMAT;
    sheet.addRow([]);
  }

  const grand = sheet.addRow([
    '',
    'TỔNG CỘNG',
    Number(grouping.totals.grand),
    `(Có HĐ: ${formatVND(Number(grouping.totals.withInvoice))} · Không HĐ: ${formatVND(Number(grouping.totals.withoutInvoice))})`,
  ]);
  grand.font = { bold: true, size: 12 };
  grand.getCell(3).numFmt = MONEY_FORMAT;

  // SIL-751 — when the phiếu carries a negative row, the printed lines no
  // longer add up to TỔNG CỘNG (the card 20260928_197 rule excludes it), so
  // say so on the paper instead of leaving a silent 270.000 vs 320.000 gap.
  if (Number(grouping.totals.excludedNegative ?? 0) !== 0) {
    const excluded = sheet.addRow([
      '',
      'Dòng âm đã loại trừ (không cộng vào tổng)',
      Number(grouping.totals.excludedNegative),
      `Tổng nếu cộng cả dòng âm: ${formatVND(Number(grouping.totals.rawGrand))}`,
    ]);
    excluded.font = { italic: true, color: { argb: 'FF555555' } };
    excluded.getCell(3).numFmt = MONEY_FORMAT;
  }

  sheet.addRow([]);
  sheet.addRow([]);
  const signatures = sheet.addRow([
    'Người lập (Ops)', '', '', '', 'Kế toán',
  ]);
  signatures.font = { bold: true };
  sheet.addRow(['(Ký, ghi rõ họ tên)', '', '', '', '(Ký, ghi rõ họ tên)']);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, filename: `${settlement.code}.xlsx` };
}
