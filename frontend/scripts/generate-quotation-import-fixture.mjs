// Card 20260922_57 — synthetic stand-in for the customer's sample workbook
// "22.9 - BÁO GIÁ MẪU 1.xlsx" (NOT in repo; TC-BG-12 still needs the real
// file from PM). Layout = the quotation-import.service contract verbatim:
//   row1: Khách hàng | <name> | MST | <taxCode>
//   row2: Giá dầu tham chiếu | <num> | Lag Day n | <num> | Phụ phí làm tròn | <3|4>
//   per-factory block: [Nhà máy | <route name>] ; [Nội dung | class labels]
//   ; Hệ số ; Tổng lít dầu/chuyến ; Giá cos ; Phụ phí
// Figures on sheet BÁO GIÁ 1 = the card's transcribed ASKEY grid, to the đồng.
// Sheet LOG COM mirrors the structure with the TC-BG-13 identity (2300975219).
// Run from frontend/: node scripts/generate-quotation-import-fixture.mjs
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../testplan/fixtures/2026-09-23_bao-gia-mau-synthetic.xlsx',
);

const CLASS_LABELS = [
  'Xe 1.25T', 'Xe 2.5T', 'Xe 3.5T', 'Xe 5T', 'Xe 8T', 'Xe 10T',
  'Cont20 <20t', 'Cont20 >20t', 'Cont40 nhẹ <20t', 'Cont40 nặng >20t',
];

// Card table: Hệ số 1 · lít/chuyến · Giá cos (heavy cells blank = kế thừa)
// · Phụ phí — all ten columns, values exactly as transcribed by the PM.
const GRID = {
  'Hệ số':               [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  'Tổng lít dầu/chuyến': [20, 26, 26, 30, 40, 48, 64, 64, 70, 70],
  'Giá cos':              [1248000, 1664000, 1768000, 2392000, 2912000, 3120000, 3952000, null, 4160000, null],
  'Phụ phí':              [241948, 314533, 314533, 362922, 483896, 580676, 774234, 774234, 846818, 846818],
};

function writeSheet(sheet, { customerName, taxCode, routeName }) {
  sheet.getCell('A1').value = 'Khách hàng';
  sheet.getCell('B1').value = customerName;
  sheet.getCell('C1').value = 'MST';
  sheet.getCell('D1').value = taxCode;
  sheet.getCell('A2').value = 'Giá dầu tham chiếu';
  sheet.getCell('B2').value = 17842.593;
  sheet.getCell('C2').value = 'Lag Day n';
  sheet.getCell('D2').value = 2;
  sheet.getCell('E2').value = 'Phụ phí làm tròn';
  sheet.getCell('F2').value = -3;
  sheet.getCell('A3').value = 'Nhà máy';
  sheet.getCell('B3').value = routeName;
  sheet.getCell('A4').value = 'Nội dung';
  CLASS_LABELS.forEach((label, i) => { sheet.getCell(4, i + 2).value = label; });
  Object.entries(GRID).forEach(([label, values], offset) => {
    const row = 5 + offset;
    sheet.getCell(row, 1).value = label;
    values.forEach((value, i) => { sheet.getCell(row, i + 2).value = value; });
  });
}

const workbook = new ExcelJS.Workbook();
workbook.creator = 'card 20260922_57 synthetic fixture';
// Route names are the seeded catalog values the importer matches against
// (enrichPreview: route-name contains factory string) — ASKEY / Hải Phòng-NEWEB.
writeSheet(workbook.addWorksheet('BÁO GIÁ 1'), {
  customerName: 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH',
  taxCode: '2300540419',
  routeName: 'ASKEY',
});
writeSheet(workbook.addWorksheet('LOG COM'), {
  customerName: 'CÔNG TY TNHH LOGCOM VIỆT NAM',
  taxCode: '2300975219',
  routeName: 'Hải Phòng-NEWEB',
});

mkdirSync(dirname(OUT), { recursive: true });
await workbook.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
