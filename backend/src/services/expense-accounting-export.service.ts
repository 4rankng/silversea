import ExcelJS from 'exceljs';
import type { ExpenseListQuery } from '@tingting/shared';
import type { ExpenseActor } from './expense-accounting-write.service';
import { getExpenseAccountingReport } from './expense-accounting-reads.service';

export async function exportExpenseAccountingReport(actor: ExpenseActor, query: ExpenseListQuery & { direction: 'IN' | 'OUT'; asOfDate?: string }) {
  const report = await getExpenseAccountingReport(actor, query);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(query.direction === 'IN' ? 'Phải thu' : 'Phải trả');
  sheet.addRow(['Ngày chi phí từ', report.from, 'đến', report.to, 'Thanh toán đến', report.asOfDate]);
  sheet.addRow(['Đối tượng', 'Nâng', 'Hạ', 'Khác', 'Tổng', 'Đã thu/chi', 'Còn lại']);
  for (const row of report.items) sheet.addRow([row.entityName, row.lift, row.drop, row.other, row.total, row.settled ?? 'Chưa phân bổ chi tiết', row.outstanding ?? 'Chưa phân bổ chi tiết']);
  sheet.addRow(['Tổng', report.totals.lift, report.totals.drop, report.totals.other, report.totals.total, report.totals.settled ?? 'Chưa phân bổ chi tiết', report.totals.outstanding ?? 'Chưa phân bổ chi tiết']);
  sheet.getColumn(1).width = 36;
  for (let column = 2; column <= 7; column++) { sheet.getColumn(column).width = 22; sheet.getColumn(column).numFmt = '#,##0'; }
  sheet.getRow(2).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}
