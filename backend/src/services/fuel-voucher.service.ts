import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import { getCompanyInfo } from './company-info.service';
import { stampCompanyHeaderXlsx, companyHeaderHtml, loadLogoDataUrl } from './lib/export-company';

// ── Helpers ──
import { escapeHtml, formatVND, formatDateVi } from '../lib/format';

// ── Data contract ──

export interface FuelVoucherData {
  tripCode: string | null;
  departureDate: string;
  routeName: string | null;
  truckPlate: string | null;
  driverName: string | null;
  fuelLiters: number;
  fuelActualUnitPrice: number;
  totalFuelCost: number;
  fuelPriceApplied: number;
  // Price actually applied to this trip: the per-trip pump price when one was
  // recorded, else the config snapshot. Both voucher price cells render this.
  effectiveFuelPrice: number;
  supplierName: string | null;
  supplierNote: string | null;
}

// ── Data loading ──

export async function buildFuelVoucherData(tripId: number): Promise<FuelVoucherData> {
  const [row] = await db.select({
    tripCode: s.tripsComposite.tripCode,
    departureDate: s.tripsComposite.departureDate,
    routeName: s.routes.name,
    truckPlate: s.trucks.licensePlate,
    driverName: s.drivers.name,
    fuelLiters: s.tripsComposite.fuelLiters,
    fuelActualUnitPrice: s.tripsComposite.fuelActualUnitPrice,
    totalFuelCost: s.tripsComposite.totalFuelCost,
    fuelPriceApplied: s.tripsComposite.fuelPriceApplied,
    fuelSupplierId: s.tripsComposite.fuelSupplierId,
    supplierName: s.suppliers.name,
    supplierNote: s.suppliers.note,
  })
    .from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .leftJoin(s.drivers, eq(s.tripsComposite.driverId, s.drivers.id))
    .leftJoin(s.suppliers, eq(s.tripsComposite.fuelSupplierId, s.suppliers.id))
    .where(eq(s.tripsComposite.id, tripId))
    .limit(1);

  if (!row) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  if (!row.fuelSupplierId) throw new ApiError(400, 'Chuyến đi chưa gán nhà cung cấp nhiên liệu');

  return {
    tripCode: row.tripCode,
    departureDate: row.departureDate,
    routeName: row.routeName,
    truckPlate: row.truckPlate,
    driverName: row.driverName,
    fuelLiters: Number(row.fuelLiters ?? 0),
    fuelActualUnitPrice: Number(row.fuelActualUnitPrice ?? 0),
    totalFuelCost: Number(row.totalFuelCost ?? 0),
    fuelPriceApplied: Number(row.fuelPriceApplied ?? 0),
    effectiveFuelPrice: Number(row.fuelActualUnitPrice) > 0
      ? Number(row.fuelActualUnitPrice)
      : Number(row.fuelPriceApplied ?? 0),
    supplierName: row.supplierName,
    supplierNote: row.supplierNote,
  };
}

// ── HTML rendering ──

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', 'Times', 'Noto Serif', serif;
    color: #000;
    background: #e5e7eb;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; justify-content: space-between; align-items: center;
    background: #0f172a; color: #fff;
    padding: 10px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 1px 0 rgba(0,0,0,.1);
  }
  .toolbar .label { font-size: 13px; opacity: .85; }
  .toolbar .actions { display: flex; gap: 8px; }
  .toolbar button {
    background: #10b981; color: #fff; border: 0; cursor: pointer;
    padding: 7px 14px; border-radius: 4px; font-size: 13px; font-weight: 600;
  }
  .toolbar button.secondary { background: #475569; }
  .toolbar button:hover { filter: brightness(1.08); }
  .sheet {
    background: #fff;
    width: 210mm;
    min-height: 297mm;
    margin: 16px auto;
    padding: 18mm 16mm;
    box-shadow: 0 2px 8px rgba(0,0,0,.12);
  }
  .voucher-no { text-align: right; font-size: 12px; color: #4b5563; margin-bottom: 8px; }
  h1 {
    font-size: 22px; text-align: center; margin: 0 0 18px;
    letter-spacing: 0.08em; font-weight: 700;
  }
  .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  .meta-table td { padding: 3px 0; font-size: 13.5px; vertical-align: top; }
  .meta-table td.k { width: 130px; color: #374151; }
  .meta-table td.v { color: #111827; font-weight: 600; }
  table.items { width: 100%; border-collapse: collapse; margin: 14px 0; }
  table.items th, table.items td { border: 1px solid #111827; padding: 8px 10px; font-size: 13px; }
  table.items th { background: #f1f5f9; font-weight: 700; text-align: center; }
  table.items td.center { text-align: center; }
  table.items td.right { text-align: right; }
  table.items tr.total td { font-weight: 700; background: #f8fafc; }
  .vendor { margin: 14px 0; padding: 8px 12px; border: 1px solid #111827; }
  .vendor .vrow { display: flex; justify-content: space-between; padding: 2px 0; font-size: 13.5px; }
  .vendor .vrow .k { color: #374151; }
  .signatures {
    display: flex; justify-content: space-between;
    margin-top: 36px; page-break-inside: avoid;
  }
  .sig-block { text-align: center; width: 30%; font-size: 13.5px; }
  .sig-block .title { font-weight: 700; margin-bottom: 4px; }
  .sig-block .hint { font-style: italic; color: #6b7280; font-size: 11.5px; margin-bottom: 60px; }
  .sig-block .line { border-top: 1px solid #111827; margin: 0 6px; padding-top: 4px; font-size: 12px; color: #6b7280; }
  .footer { margin-top: 18px; text-align: center; font-size: 11px; color: #6b7280; font-style: italic; }
  @media screen and (max-width: 720px) {
    body {
      background: #f3f4f6;
      font-size: 14px;
    }
    .toolbar {
      position: sticky;
      top: 0;
      gap: 8px;
      padding: max(10px, env(safe-area-inset-top)) 10px 10px;
    }
    .toolbar .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
    }
    .toolbar .actions {
      flex-shrink: 0;
    }
    .toolbar button {
      min-height: 34px;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
    }
    .sheet {
      width: min(100% - 20px, 520px);
      min-height: auto;
      margin: 10px auto 24px;
      padding: 18px 14px 24px;
      border-radius: 4px;
      overflow-x: auto;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
    }
    .voucher-no {
      text-align: left;
      font-size: 10.5px;
      margin-bottom: 10px;
    }
    h1 {
      font-size: 18px;
      letter-spacing: 0.04em;
      margin-bottom: 14px;
    }
    .meta-table,
    .meta-table tbody,
    .meta-table tr,
    .meta-table td {
      display: block;
      width: 100% !important;
    }
    .meta-table tr {
      display: grid;
      grid-template-columns: 88px minmax(0, 1fr);
      gap: 2px 8px;
      padding: 5px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .meta-table td {
      padding: 0;
      font-size: 12px;
    }
    .meta-table td.k {
      color: #6b7280;
    }
    .meta-table td.v {
      font-size: 12.5px;
    }
    table.items {
      min-width: 560px;
      margin: 12px 0;
    }
    table.items th,
    table.items td {
      padding: 7px 8px;
      font-size: 12px;
    }
    .vendor {
      padding: 8px 10px;
    }
    .vendor .vrow {
      gap: 10px;
      font-size: 12px;
    }
    .signatures {
      gap: 10px;
      margin-top: 26px;
    }
    .sig-block {
      width: 33.33%;
      font-size: 11px;
    }
    .sig-block .hint {
      font-size: 9.5px;
      margin-bottom: 42px;
    }
    .sig-block .line {
      margin: 0;
    }
  }
  @media print {
    body { background: #fff; }
    .toolbar, .sheet { box-shadow: none; margin: 0; padding: 0; width: 100%; }
    .sheet { padding: 0; }
    .no-print { display: none !important; }
    .signatures { margin-top: 28px; }
  }
`;

export async function renderFuelVoucherHtml(data: FuelVoucherData): Promise<string> {
  const dateStr = formatDateVi(data.departureDate);
  const voucherNo = `PCNL-${data.tripCode ?? ''}`;
  const today = new Date().toLocaleDateString('vi-VN');
  const company = await getCompanyInfo();
  const logoDataUrl = await loadLogoDataUrl(company.logoStorageKey);
  const header = companyHeaderHtml(company, logoDataUrl);

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Phiếu cấp nhiên liệu - ${escapeHtml(data.tripCode ?? '')}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="toolbar no-print">
    <span class="label">Xem trước bản in &middot; Phiếu cấp nhiên liệu ${escapeHtml(data.tripCode ?? '')}</span>
    <div class="actions">
      <button class="secondary" onclick="window.close()">Đóng</button>
      <button onclick="window.print()">In phiếu</button>
    </div>
  </div>

  <div class="sheet">
    ${header}
    <div class="voucher-no">Số phiếu: ${escapeHtml(voucherNo)} &nbsp;&middot;&nbsp; Ngày in: ${today}</div>
    <h1>PHIẾU CẤP NHIÊN LIỆU</h1>

    <table class="meta-table">
      <tr>
        <td class="k">Mã chuyến:</td>
        <td class="v">${escapeHtml(data.tripCode ?? '—')}</td>
        <td class="k" style="width: 140px;">Ngày xuất phát:</td>
        <td class="v">${dateStr}</td>
      </tr>
      <tr>
        <td class="k">Tuyến:</td>
        <td class="v">${escapeHtml(data.routeName ?? '—')}</td>
        <td class="k">Biển số xe:</td>
        <td class="v">${escapeHtml(data.truckPlate ?? '—')}</td>
      </tr>
      <tr>
        <td class="k">Lái xe:</td>
        <td class="v" colspan="3">${escapeHtml(data.driverName ?? '—')}</td>
      </tr>
    </table>

    <table class="items">
      <thead>
        <tr>
          <th style="width: 50px;">STT</th>
          <th>Hạng mục</th>
          <th style="width: 110px;">Số lượng (Lít)</th>
          <th style="width: 120px;">Đơn giá (đ/Lít)</th>
          <th style="width: 140px;">Thành tiền (đ)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">1</td>
          <td>Nhiên liệu (Diesel)</td>
          <td class="right">${formatVND(data.fuelLiters)}</td>
          <td class="right">${formatVND(data.effectiveFuelPrice)}</td>
          <td class="right">${formatVND(data.totalFuelCost)}</td>
        </tr>
        <tr class="total">
          <td colspan="4" class="right">Tổng cộng</td>
          <td class="right">${formatVND(data.totalFuelCost)}</td>
        </tr>
      </tbody>
    </table>

    <div class="vendor">
      <div class="vrow"><span class="k">Nhà cung cấp:</span><span><strong>${escapeHtml(data.supplierName ?? '—')}</strong></span></div>
      ${data.supplierNote ? `<div class="vrow"><span class="k">Ghi chú:</span><span>${escapeHtml(data.supplierNote)}</span></div>` : ''}
      <div class="vrow"><span class="k">Giá áp dụng:</span><span>${formatVND(data.effectiveFuelPrice)} đ/Lít</span></div>
    </div>

    <div class="signatures">
      <div class="sig-block">
        <div class="title">Người lập phiếu</div>
        <div class="hint">(Ký, ghi rõ họ tên)</div>
        <div class="line">&nbsp;</div>
      </div>
      <div class="sig-block">
        <div class="title">Kế toán trưởng</div>
        <div class="hint">(Ký, ghi rõ họ tên)</div>
        <div class="line">&nbsp;</div>
      </div>
      <div class="sig-block">
        <div class="title">Người nhận</div>
        <div class="hint">(Ký, ghi rõ họ tên)</div>
        <div class="line">&nbsp;</div>
      </div>
    </div>

    <div class="footer">${company.name ? `In bởi ${escapeHtml(company.name)} &middot; ` : ''}Ngày in: ${today}</div>
  </div>
</body>
</html>`;
}

// ── XLSX rendering ──

export async function renderFuelVoucherXlsx(data: FuelVoucherData, writable: import('stream').Writable): Promise<boolean> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const F = 'Calibri';
  const CLR = {
    dark: 'FF1E293B',
    header: 'FFE2E8F0',
    white: 'FFFFFFFF',
  };
  const thinB = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
  const borderAll = { top: thinB, bottom: thinB, left: thinB, right: thinB };

  const wb = new ExcelJS.Workbook();
  const company = await getCompanyInfo();
  wb.creator = company.name;
  const ws = wb.addWorksheet('Phieu cap nhien lieu', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToWidth: 1, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.3, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [
    { width: 6 },   // A: STT
    { width: 26 },  // B: Hạng mục
    { width: 16 },  // C: Số lượng
    { width: 16 },  // D: Đơn giá
    { width: 20 },  // E: Thành tiền
  ];

  // Company letterhead (configured on /config/company-info) — rows 1..4.
  let row = await stampCompanyHeaderXlsx(wb, ws, company, { lastCol: 5 });
  row++; // spacer

  // Số phiếu / ngày in (top right)
  const noRow = ws.getRow(row);
  noRow.height = 16;
  ws.mergeCells(`A${row}:E${row}`);
  const voucherNo = `PCNL-${data.tripCode ?? ''}`;
  const today = new Date().toLocaleDateString('vi-VN');
  noRow.getCell(1).value = `Số phiếu: ${voucherNo}    Ngày in: ${today}`;
  noRow.getCell(1).font = { name: F, size: 9, italic: true, color: { argb: 'FF4B5563' } };
  noRow.getCell(1).alignment = { horizontal: 'right' };
  row++;

  // Title
  const titleRow = ws.getRow(row);
  titleRow.height = 28;
  ws.mergeCells(`A${row}:E${row}`);
  const titleCell = titleRow.getCell(1);
  titleCell.value = 'PHIẾU CẤP NHIÊN LIỆU';
  titleCell.font = { name: F, size: 14, bold: true, color: { argb: CLR.dark } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  row++;

  // Blank spacer
  row++;

  // Metadata row 1
  const meta1 = ws.getRow(row);
  meta1.height = 18;
  ws.mergeCells(`A${row}:C${row}`);
  ws.mergeCells(`D${row}:E${row}`);
  meta1.getCell(1).value = `Mã chuyến: ${data.tripCode ?? '—'}`;
  meta1.getCell(1).font = { name: F, size: 10, color: { argb: CLR.dark } };
  meta1.getCell(4).value = `Ngày xuất phát: ${formatDateVi(data.departureDate)}`;
  meta1.getCell(4).font = { name: F, size: 10, color: { argb: CLR.dark } };
  row++;

  // Metadata row 2
  const meta2 = ws.getRow(row);
  meta2.height = 18;
  ws.mergeCells(`A${row}:C${row}`);
  ws.mergeCells(`D${row}:E${row}`);
  meta2.getCell(1).value = `Tuyến: ${data.routeName ?? '—'}`;
  meta2.getCell(1).font = { name: F, size: 10, color: { argb: CLR.dark } };
  meta2.getCell(4).value = `Biển số xe: ${data.truckPlate ?? '—'}`;
  meta2.getCell(4).font = { name: F, size: 10, color: { argb: CLR.dark } };
  row++;

  // Metadata row 3
  const meta3 = ws.getRow(row);
  meta3.height = 18;
  ws.mergeCells(`A${row}:E${row}`);
  meta3.getCell(1).value = `Lái xe: ${data.driverName ?? '—'}`;
  meta3.getCell(1).font = { name: F, size: 10, color: { argb: CLR.dark } };
  row++;

  // Blank spacer
  row++;

  // Table header
  const hdrRow = ws.getRow(row);
  hdrRow.height = 22;
  const headers = ['STT', 'Hạng mục', 'Số lượng (Lít)', 'Đơn giá (đ/Lít)', 'Thành tiền (đ)'];
  for (let i = 0; i < headers.length; i++) {
    const c = hdrRow.getCell(i + 1);
    c.value = headers[i];
    c.font = { name: F, size: 10, bold: true, color: { argb: CLR.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    c.border = borderAll;
    c.alignment = { horizontal: i >= 2 ? 'right' : 'center', vertical: 'middle' };
  }
  row++;

  // Data row
  const dataRow = ws.getRow(row);
  dataRow.height = 20;
  const values: (string | number)[] = [1, 'Nhiên liệu (Diesel)', data.fuelLiters, data.effectiveFuelPrice, data.totalFuelCost];
  for (let i = 0; i < values.length; i++) {
    const c = dataRow.getCell(i + 1);
    c.value = values[i];
    c.font = { name: F, size: 10, color: { argb: CLR.dark } };
    c.border = borderAll;
    if (i >= 2) {
      c.alignment = { horizontal: 'right' };
      if (typeof values[i] === 'number') {
        c.numFmt = '#,##0';
      }
    }
  }
  row++;

  // Total row
  const totalRow = ws.getRow(row);
  totalRow.height = 22;
  ws.mergeCells(`A${row}:D${row}`);
  totalRow.getCell(1).value = 'Tổng cộng';
  totalRow.getCell(1).font = { name: F, size: 10, bold: true, color: { argb: CLR.dark } };
  totalRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.getCell(1).border = borderAll;
  // Apply borders to merged cells
  for (let col = 2; col <= 4; col++) {
    totalRow.getCell(col).border = borderAll;
  }
  const totalCell = totalRow.getCell(5);
  totalCell.value = data.totalFuelCost;
  totalCell.font = { name: F, size: 10, bold: true, color: { argb: CLR.dark } };
  totalCell.numFmt = '#,##0';
  totalCell.alignment = { horizontal: 'right' };
  totalCell.border = { ...borderAll, top: { style: 'medium' as const, color: { argb: CLR.dark } } };
  row++;

  // Blank spacer
  row++;

  // Vendor info
  const vendorRow = ws.getRow(row);
  vendorRow.height = 18;
  ws.mergeCells(`A${row}:E${row}`);
  vendorRow.getCell(1).value = `Nhà cung cấp: ${data.supplierName ?? '—'}`;
  vendorRow.getCell(1).font = { name: F, size: 10, bold: true, color: { argb: CLR.dark } };
  row++;

  if (data.supplierNote) {
    const noteRow = ws.getRow(row);
    noteRow.height = 16;
    ws.mergeCells(`A${row}:E${row}`);
    noteRow.getCell(1).value = `Ghi chú: ${data.supplierNote}`;
    noteRow.getCell(1).font = { name: F, size: 9, italic: true, color: { argb: 'FF6B7280' } };
    row++;
  }

  const priceRow = ws.getRow(row);
  priceRow.height = 16;
  ws.mergeCells(`A${row}:E${row}`);
  priceRow.getCell(1).value = `Giá áp dụng: ${formatVND(data.effectiveFuelPrice)} đ/Lít`;
  priceRow.getCell(1).font = { name: F, size: 10, color: { argb: 'FF374151' } };
  row++;

  // Blank spacer rows before signatures
  row++;
  row++;

  // Signatures: 3 blocks spread across columns A:B, C, D:E
  const sigTitleRow = ws.getRow(row);
  sigTitleRow.height = 18;
  ws.mergeCells(`A${row}:B${row}`);
  ws.mergeCells(`C${row}:C${row}`);
  ws.mergeCells(`D${row}:E${row}`);
  const sigLabels = ['Người lập phiếu', 'Kế toán trưởng', 'Người nhận'];
  sigTitleRow.getCell(1).value = sigLabels[0];
  sigTitleRow.getCell(1).font = { name: F, size: 10, bold: true, color: { argb: CLR.dark } };
  sigTitleRow.getCell(1).alignment = { horizontal: 'center' };
  sigTitleRow.getCell(3).value = sigLabels[1];
  sigTitleRow.getCell(3).font = { name: F, size: 10, bold: true, color: { argb: CLR.dark } };
  sigTitleRow.getCell(3).alignment = { horizontal: 'center' };
  sigTitleRow.getCell(4).value = sigLabels[2];
  sigTitleRow.getCell(4).font = { name: F, size: 10, bold: true, color: { argb: CLR.dark } };
  sigTitleRow.getCell(4).alignment = { horizontal: 'center' };
  row += 4;

  // Signature lines
  const sigLineRow = ws.getRow(row);
  sigLineRow.height = 16;
  ws.mergeCells(`A${row}:B${row}`);
  ws.mergeCells(`C${row}:C${row}`);
  ws.mergeCells(`D${row}:E${row}`);
  const lineStyle = { bottom: { style: 'thin' as const, color: { argb: 'FF9CA3AF' } } };
  sigLineRow.getCell(1).border = lineStyle;
  sigLineRow.getCell(2).border = lineStyle;
  sigLineRow.getCell(3).border = lineStyle;
  sigLineRow.getCell(4).border = lineStyle;
  sigLineRow.getCell(5).border = lineStyle;
  row += 2;

  // Footer
  const footerRow = ws.getRow(row);
  footerRow.height = 14;
  ws.mergeCells(`A${row}:E${row}`);
  const printDate = new Date().toLocaleDateString('vi-VN');
  footerRow.getCell(1).value = company.name ? `In bởi ${company.name} — ${printDate}` : `Ngày in: ${printDate}`;
  footerRow.getCell(1).font = { name: F, size: 8, italic: true, color: { argb: 'FF9CA3AF' } };
  footerRow.getCell(1).alignment = { horizontal: 'center' };

  await wb.xlsx.write(writable);
  return true;
}

// ── Convenience wrappers ──

export async function getFuelVoucherHtml(tripId: number): Promise<string> {
  const data = await buildFuelVoucherData(tripId);
  return renderFuelVoucherHtml(data);
}

export async function getFuelVoucherXlsx(tripId: number, writable: import('stream').Writable): Promise<boolean> {
  const data = await buildFuelVoucherData(tripId);
  return renderFuelVoucherXlsx(data, writable);
}
