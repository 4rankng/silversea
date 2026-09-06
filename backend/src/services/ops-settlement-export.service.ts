/**
 * Excel export for an Ops settlement batch (đề nghị thanh toán — OpsVanHanh
 * §5.4): bảng kê theo lô, 2 rổ Có/Không hóa đơn, dòng tổng — để Ops in đính
 * kèm hồ sơ chứng từ gốc gửi kế toán.
 */
import ExcelJS from 'exceljs';
import { getOpsSettlementDetail } from './ops-settlements.service';
import { formatVND } from '../lib/format';

const MONEY_FORMAT = '#,##0';

export async function exportOpsSettlementXlsx(settlementId: number): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const { settlement, grouping } = await getOpsSettlementDetail(settlementId);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`ĐNTT ${settlement.code}`);

  sheet.columns = [
    { width: 22 }, { width: 26 }, { width: 18 }, { width: 16 }, { width: 14 },
  ];

  const title = sheet.addRow([`ĐỀ NGHỊ THANH TOÁN ${settlement.code}`]);
  title.font = { bold: true, size: 13 };
  sheet.addRow([`Người lập: ${settlement.opsUserName ?? settlement.opsUserId}`]);
  sheet.addRow([`Ngày lập: ${new Date(settlement.createdAt).toLocaleDateString('vi-VN')}`]);
  if (settlement.note) sheet.addRow([`Ghi chú: ${settlement.note}`]);
  sheet.addRow([]);

  for (const group of grouping.groups) {
    const header = sheet.addRow([
      `Lô ${group.shipmentCode ?? group.shipmentId}`,
      group.customerName ?? '',
      `Bill/Booking: ${group.billRef ?? '—'}`,
    ]);
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
          item.containerNumber ?? 'Phí chung lô',
          item.expenseTypeName ?? '',
          Number(item.amount),
          item.approvalStatus === 'APPROVED' ? 'Đã duyệt' : 'Chờ duyệt',
        ]);
        row.getCell(3).numFmt = MONEY_FORMAT;
      }
      const subtotal = sheet.addRow(['', `Tổng ${label}`, Number(basket.total), '']);
      subtotal.font = { bold: true };
      subtotal.getCell(3).numFmt = MONEY_FORMAT;
    }

    const groupTotal = sheet.addRow(['', `Tổng lô ${group.shipmentCode ?? ''}`, Number(group.total), '']);
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

  sheet.addRow([]);
  sheet.addRow([]);
  const signatures = sheet.addRow([
    'Người lập (Ops)', '', '', '', 'Kế toán duyệt',
  ]);
  signatures.font = { bold: true };
  sheet.addRow(['(Ký, ghi rõ họ tên)', '', '', '', '(Ký, ghi rõ họ tên)']);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, filename: `${settlement.code}.xlsx` };
}
