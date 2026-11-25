// Card 20260922_57 — báo giá xlsx export: round-trips the customer's
// template layout for one quotation.
//
// SIL-1041 (K5.47) — MỌI đường xuất chạy qua CÙNG một renderer trên
// QuotationView:
//   • nút 'Xuất xlsx' đầu trang = view SỐNG từ buildGrid (trước đây đọc
//     danh sách ô thưa quotation_cells — khung chưa sửa hệ số chỉ ra file
//     2 dòng, sai mẫu);
//   • nút theo phiên bản = payload đóng băng của chính phiên bản đó.
// File luôn khớp mẫu: row1 'Khách hàng | <tên> | MST | <mã>', row2 tham
// số, mỗi tuyến một khối lưới. Cột 'Tổng lít dầu/chuyến' là SỐ NGUYÊN
// (không thập phân — 31.2/57.6/76.8 là lỗi cũ). Ô Giá cos hạng nặng kế
// thừa để TRỐNG đúng mẫu khách (blank = kế thừa); ô có giá riêng ghi số.
import ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { getQuotation } from './quotation.service';
import { ApiError } from '../errors';
import type { QuotationView } from '@tingting/shared';
type QuotationViewShape = QuotationView;

function classLabel(code: string): string {
  if (code === 'CONT20.LIGHT') return 'Cont 20 - Trọng tải < 20 tấn';
  if (code === 'CONT20.HEAVY') return 'Cont 20 - Trọng tải > 20 tấn';
  if (code === 'CONT40.LIGHT') return 'Cont 40 nhẹ - Trọng tải < 20 tấn';
  if (code === 'CONT40.HEAVY') return 'Cont 40 nặng - Trọng tải > 20 tấn';
  if (code === 'CONT20') return 'Cont 20';
  if (code === 'CONT40') return 'Cont 40';
  return `Xe ${code}`;
}

/** Pure workbook render — exported for the contract test (SIL-1041). */
export async function renderQuotationWorkbook(
  view: QuotationViewShape,
  customerTaxCode: string | null,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('BÁO GIÁ');
  sheet.getCell('A1').value = 'Khách hàng';
  sheet.getCell('B1').value = view.customerName ?? '';
  sheet.getCell('C1').value = 'MST';
  sheet.getCell('D1').value = customerTaxCode ?? '';
  sheet.getCell('A2').value = 'Giá dầu tham chiếu';
  sheet.getCell('B2').value = view.cells[0]?.baseFuelPrice ?? null;
  sheet.getCell('C2').value = 'Lag Day n';
  sheet.getCell('D2').value = view.cells[0]?.fuelLagDays ?? 0;
  sheet.getCell('E2').value = 'Phụ phí làm tròn';
  sheet.getCell('F2').value = view.surchargeRoundingMode === 'TEN_THOUSAND' ? '-4'
    : view.surchargeRoundingMode === 'THOUSAND' ? '-3' : 'NONE';
  let cursor = 4;
  const routesInOrder = [...new Set(view.cells.map((cell) => cell.routeName))];
  for (const routeName of routesInOrder) {
    const routeCells = view.cells.filter((cell) => cell.routeName === routeName);
    sheet.getCell(`A${cursor}`).value = 'Nhà máy';
    sheet.getCell(`B${cursor}`).value = routeName;
    cursor += 1;
    sheet.getCell(`A${cursor}`).value = 'Nội dung';
    routeCells.forEach((cell, index) => {
      sheet.getCell(cursor, index + 2).value = classLabel(cell.vehicleSizeClassCode);
    });
    cursor += 1;
    const gridRows: Array<[string, (cell: QuotationViewShape['cells'][number]) => number | string | null]> = [
      ['Hệ số', (cell) => Number(cell.heSo)],
      // SIL-1041 (K5.47) — cột lít không thập phân: số nguyên, làm tròn
      // half-up (Math.round) chỉ cho HIỂN THỊ file; tiền vẫn tính trên lít
      // thật (KB §5.7.3: làm tròn hiển thị không đổi kết quả tiền).
      ['Tổng lít dầu/chuyến', (cell) => (cell.liters == null ? null : Math.round(cell.liters))],
      // K5.18 — ô Giá cos hạng nặng kế thừa từ hạng nhẹ để TRỐNG đúng mẫu
      // khách ("blank = kế thừa"); giá riêng của ô vẫn ghi số.
      ['Giá cos', (cell) => (cell.giaCosInherited ? null : cell.giaCos)],
      ['Phụ phí', (cell) => cell.surcharge],
    ];
    for (const [label, render] of gridRows) {
      sheet.getCell(`A${cursor}`).value = label;
      routeCells.forEach((cell, index) => {
        sheet.getCell(cursor, index + 2).value = render(cell);
      });
      cursor += 1;
    }
    cursor += 1;
  }
  // SAFETY: exceljs types writeBuffer() as StreamingXLSX.Buffer, but it
  // resolves a Node Buffer once the whole workbook is serialised. Both call
  // sites await this and pass the Buffer to the XLSX response, so the
  // runtime shape is what is asserted, not merely assumed.
  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

export async function buildQuotationExport(quotationId: number, version?: number): Promise<Buffer> {
  // MST là định danh khách của mẫu (import nhận diện theo tên + MST) —
  // tra nhanh một dòng, không phải truy vấn giá.
  const loadTaxCode = async (customerId: number): Promise<string | null> => {
    const [customer] = await db.select({ taxCode: s.customers.taxCode })
      .from(s.customers)
      .where(eq(s.customers.id, customerId))
      .limit(1);
    return customer?.taxCode ?? null;
  };
  if (version != null) {
    const [snap] = await db.select({ payload: s.quotationVersionSnapshots.payload })
      .from(s.quotationVersionSnapshots)
      .where(and(
        eq(s.quotationVersionSnapshots.quotationId, quotationId),
        eq(s.quotationVersionSnapshots.version, version),
      )).limit(1);
    if (!snap) throw new ApiError(404, 'Không tìm thấy phiên bản báo giá');
    const view = snap.payload as QuotationViewShape;
    return renderQuotationWorkbook(view, await loadTaxCode(view.customerId));
  }
  const view = await getQuotation(quotationId);
  return renderQuotationWorkbook(view, await loadTaxCode(view.customerId));
}
