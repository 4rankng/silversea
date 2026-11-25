/**
 * SIL-1041 (K5.47) — hợp đồng file xlsx báo giá:
 *   • cột 'Tổng lít dầu/chuyến' là SỐ NGUYÊN (31.2 → 31, 57.6 → 58 —
 *     không thập phân);
 *   • file KHỚP MẪU: row1 'Khách hàng | <tên> | MST | <mã>' (import nhận
 *     diện khách theo tên + MST từ chính dòng này);
 *   • ô Giá cos hạng nặng kế thừa để trống đúng mẫu khách ("blank =
 *     kế thừa"), ô có giá riêng vẫn ghi số (K5.18);
 *   • renderQuotationWorkbook là renderer DUY NHẤT cho cả nút đầu trang
 *     lẫn nút theo phiên bản — không còn đường xuất 2 dòng.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { renderQuotationWorkbook } from '../../services/quotation-export.service';
import type { QuotationView } from '@tingting/shared';

const view: QuotationView = {
  id: 4,
  customerId: 1,
  customerName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  templateName: 'QA4B-TEST',
  effectiveDate: '2026-11-26',
  surchargeRoundingMode: 'TEN_THOUSAND',
  fuelPriceLagDays: 1,
  note: null,
  fees: [],
  cells: [
    {
      routeId: 3, routeName: 'KCN Vân Trung', vehicleSizeClassCode: '1.25T', heSo: 1,
      giaCos: 1326000, missingPrice: false, liters: 31.2, surcharge: 241948,
      surchargeRaw: 241948, total: 1567948, baseFuelPrice: 17842.5926, fuelLagDays: 1,
      formula: 'f',
    },
    {
      routeId: 3, routeName: 'KCN Vân Trung', vehicleSizeClassCode: '10T', heSo: 1,
      giaCos: 3162000, missingPrice: false, liters: 57.6, surcharge: 580676,
      surchargeRaw: 580676, total: 3742676, baseFuelPrice: 17842.5926, fuelLagDays: 1,
      formula: 'f',
    },
    {
      routeId: 3, routeName: 'KCN Vân Trung', vehicleSizeClassCode: 'CONT20.LIGHT', heSo: 1,
      giaCos: 3952000, missingPrice: false, liters: 64, surcharge: 774234,
      surchargeRaw: 774234, total: 4726234, baseFuelPrice: 17842.5926, fuelLagDays: 1,
      formula: 'f',
    },
    {
      // K5.18 — hạng nặng kế thừa: file để TRỐNG ô Giá cos (blank = kế thừa).
      routeId: 3, routeName: 'KCN Vân Trung', vehicleSizeClassCode: 'CONT20.HEAVY', heSo: 1,
      giaCos: 3952000, giaCosInherited: true, missingPrice: false, liters: 64,
      surcharge: 774234, surchargeRaw: 774234, total: 4726234,
      baseFuelPrice: 17842.5926, fuelLagDays: 1, formula: 'f',
    },
    {
      // Giá riêng của ô — ghi số như mọi ô có giá.
      routeId: 3, routeName: 'KCN Vân Trung', vehicleSizeClassCode: 'CONT40.HEAVY', heSo: 2,
      giaCos: 4200000, missingPrice: false, liters: 70,
      surcharge: 1100000, surchargeRaw: 1108438, total: 5300000,
      baseFuelPrice: 17842.5926, fuelLagDays: 1, formula: 'f',
    },
    {
      // 15T thiếu giá gốc — để trống, không bịa số.
      routeId: 3, routeName: 'KCN Vân Trung', vehicleSizeClassCode: '15T', heSo: 1,
      giaCos: null, missingPrice: true, liters: 60, surcharge: null,
      surchargeRaw: null, total: null, baseFuelPrice: 17842.5926, fuelLagDays: 1,
      formula: null,
    },
  ],
};

test('SIL-1041: cột Tổng lít dầu/chuyến là số nguyên — 31.2 → 31, 57.6 → 58', async () => {
  const buffer = await renderQuotationWorkbook(view, '0123456789');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet('BÁO GIÁ')!;

  // Layout: row4 'Nhà máy', row5 'Nội dung', rows 6-9 = Hệ số / Tổng lít /
  // Giá cos / Phụ phí; cột B.. = 6 ô của tuyến.
  assert.equal(sheet.getCell('A7').value, 'Tổng lít dầu/chuyến');
  const liters = [sheet.getCell('B7'), sheet.getCell('C7'), sheet.getCell('D7'), sheet.getCell('E7'), sheet.getCell('F7'), sheet.getCell('G7')]
    .map((cell) => cell.value);
  assert.deepEqual(liters, [31, 58, 64, 64, 70, 60]);
  for (const value of liters) {
    assert.equal(typeof value, 'number');
    assert.ok(Number.isInteger(value as number), `lít phải là số nguyên, nhận ${value}`);
  }
});

test('SIL-1041: file khớp mẫu — row1 Khách hàng | tên | MST | mã (import nhận diện theo dòng này)', async () => {
  const buffer = await renderQuotationWorkbook(view, '0123456789');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet('BÁO GIÁ')!;
  assert.equal(sheet.getCell('A1').value, 'Khách hàng');
  assert.equal(sheet.getCell('B1').value, 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH');
  assert.equal(sheet.getCell('C1').value, 'MST');
  assert.equal(sheet.getCell('D1').value, '0123456789');
  assert.equal(sheet.getCell('F2').value, '-4');
});

test('SIL-1041: nút Xuất xlsx đầu trang dùng CÙNG renderer với bản phiên bản (không còn file 2 dòng)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/services/quotation-export.service.ts', 'utf8');
  // Live path render view sống từ buildGrid — không đọc danh sách ô thưa.
  assert.match(source, /const view = await getQuotation\(quotationId\)/);
  assert.match(source, /return renderQuotationWorkbook\(view,/);
  assert.doesNotMatch(source, /from\(s\.quotationCells\)/);
});

test('SIL-1041/K5.18: ô Giá cos hạng nặng kế thừa để trống đúng mẫu; giá riêng + ô thiếu vẫn đúng', async () => {
  const buffer = await renderQuotationWorkbook(view, null);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = wb.getWorksheet('BÁO GIÁ')!;
  // Dòng Giá cos (row 8) theo thứ tự cột: 1.25T, 10T, CONT20.LIGHT,
  // CONT20.HEAVY (kế thừa → trống), CONT40.HEAVY (giá riêng), 15T (thiếu).
  assert.equal(sheet.getCell('A8').value, 'Giá cos');
  assert.equal(sheet.getCell('B8').value, 1326000);
  assert.equal(sheet.getCell('E8').value, null); // kế thừa = blank theo mẫu
  assert.equal(sheet.getCell('F8').value, 4200000);
  assert.equal(sheet.getCell('G8').value, null); // thiếu giá — không bịa số
  // Hệ số của ô nặng (heSo 2) vẫn ghi đúng.
  assert.equal(sheet.getCell('F6').value, 2);
});
