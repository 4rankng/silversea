import { getAdvanceSettlement } from './advance.service';
import { validateSettlementInputs } from './settlement-validation';
import { getCompanyInfo } from './company-info.service';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, inArray, sql } from 'drizzle-orm';

const EXPENSE_TYPE_LABELS: Record<string, string> = {
  LIFTING: 'Phí nâng container',
  LOWERING: 'Phí hạ container',
  CUSTOMS: 'Phí hải quan',
  WEIGHING: 'Phí cân hàng',
  INFRASTRUCTURE: 'Phí kết cầu hạ tầng',
  PORT_STORAGE: 'Phí lưu bãi',
  CLEANING: 'Phí vệ sinh container',
  OTHER: 'Khác',
};

import { escapeHtml, formatVND, formatDateShort } from '../lib/format';

// ── Linked-data contracts (fields consumed by the print/export renderers) ──

/** Shape of a linked advance request used in settlement print rendering. */
export interface LinkedRequest {
  amount: string | number;
  reason: string | null;
  createdAt: Date | string;
}

/** Shape of a linked trip expense (joined with trip/customer) used in print rendering. */
export interface LinkedExpense {
  id: number;
  tripId: number;
  expenseType: string;
  amount: string | number;
  containerNumber: string | null;
  invoiceNumber: string | null;
  note: string | null;
  createdAt: Date | string;
  departureDate?: string | null;
  customerName?: string | null;
}

interface PrintRow {
  date: string;
  container: string;
  customer: string;
  expenseType: string;
  amount: number;
  invoice: string;
}

function buildPrintRows(expenses: LinkedExpense[]): PrintRow[] {
  const grouped = new Map<string, Map<string, LinkedExpense[]>>();
  for (const exp of expenses) {
    const dateKey = exp.departureDate || 'unknown';
    const containerKey = exp.containerNumber || '-';
    if (!grouped.has(dateKey)) grouped.set(dateKey, new Map());
    const containerMap = grouped.get(dateKey)!;
    if (!containerMap.has(containerKey)) containerMap.set(containerKey, []);
    containerMap.get(containerKey)!.push(exp);
  }

  const rows: PrintRow[] = [];
  // Date keys (ISO 'YYYY-MM-DD') sort chronologically as strings; push the
  // 'unknown' bucket last so rows are ordered by transport date ascending (B6).
  const sortedDateKeys = [...grouped.keys()].sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const dateKey of sortedDateKeys) {
    const containerMap = grouped.get(dateKey)!;
    for (const [containerKey, exps] of containerMap) {
      const sorted = [...exps].sort((a, b) => a.expenseType.localeCompare(b.expenseType));
      for (const exp of sorted) {
        rows.push({
          date: dateKey !== 'unknown' ? formatDateShort(dateKey) : '—',
          container: containerKey !== '-' ? containerKey : '—',
          customer: exp.customerName || '—',
          expenseType: EXPENSE_TYPE_LABELS[exp.expenseType] || exp.expenseType,
          amount: Number(exp.amount),
          invoice: exp.invoiceNumber || '',
        });
      }
    }
  }
  return rows;
}

// ── Export data contract ──

export interface SettlementExportData {
  id: number | string;
  code: string | null;
  createdAt: string;
  forwarderName: string | null;
  refundAmount: string | number;
  note: string | null;
  linkedRequests: LinkedRequest[];
  linkedExpenses: LinkedExpense[];
}

// ── Data loading ──

export async function buildSettlementExportData(id: number): Promise<SettlementExportData | null> {
  const settlement = await getAdvanceSettlement(id);
  if (!settlement) return null;
  return settlement as unknown as SettlementExportData;
}

// ── HTML rendering ──

const PRINT_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; max-width: 900px; margin: 24px auto; padding: 0 16px; font-size: 13px; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta { display: flex; justify-content: space-between; color: #374151; font-size: 13px; margin: 8px 0 16px; border-bottom: 2px solid #1f2937; padding-bottom: 8px; }
  .section-title { font-size: 14px; font-weight: 700; margin: 16px 0 8px; color: #374151; }
  .advance-list { margin: 0 0 8px; }
  .advance-item { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .advance-total { display: flex; justify-content: space-between; font-weight: 700; border-top: 1px solid #d1d5db; padding-top: 6px; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .table-total td { border-top: 2px solid #1f2937; font-weight: 700; }
  .table-balance td { background: #fef2f2; font-weight: 700; color: #dc2626; }
  .summary { margin: 16px 0; padding: 12px; background: #f9fafb; border-radius: 6px; }
  .summary-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .summary-row--balance { border-top: 2px solid #1f2937; margin-top: 8px; padding-top: 8px; font-weight: 700; font-size: 16px; }
  .signatures { display: flex; justify-content: space-around; margin-top: 80px; }
  .sig-block { text-align: center; }
  .sig-label { font-weight: 700; font-size: 13px; }
  .sig-line { margin-top: 48px; font-size: 12px; color: #6b7280; }
  .note { margin: 12px 0; font-size: 13px; color: #374151; }
  @media print { body { margin: 0; } }
`;

export function renderSettlementHtml(data: SettlementExportData): string {
  const expenses: LinkedExpense[] = data.linkedExpenses || [];
  const requests: LinkedRequest[] = data.linkedRequests || [];
  const totalAdvance = requests.reduce((sum: number, r) => sum + Number(r.amount), 0);
  const totalExpense = expenses.reduce((sum: number, e) => sum + Number(e.amount), 0);
  const refund = Number(data.refundAmount || 0);
  const balance = totalAdvance - totalExpense - refund;
  const rows = buildPrintRows(expenses);
  const docCode = data.code || `PT-${String(data.id).padStart(4, '0')}`;

  const advanceRows = requests.map((r) => `
    <div class="advance-item">
      <span>${formatVND(Number(r.amount))} — ${escapeHtml(r.reason || '')}</span>
      <span>${new Date(r.createdAt).toLocaleDateString('vi-VN')}</span>
    </div>`).join('');

  const expenseTableRows = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${escapeHtml(r.expenseType)}</td>
      <td>${escapeHtml(r.customer)}</td>
      <td style="font-family: monospace; font-size: 12px">${escapeHtml(r.container)}</td>
      <td class="num">${formatVND(r.amount)}</td>
      <td>${escapeHtml(r.invoice)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8">
<title>Phiếu thanh toán ${docCode}</title>
<style>${PRINT_CSS}</style>
</head><body>
<h1>Phiếu thanh toán</h1>
<div class="meta">
  <span>Số: <strong>${docCode}</strong></span>
  <span>Ngày: <strong>${new Date(data.createdAt).toLocaleDateString('vi-VN')}</strong></span>
  <span>Nhân viên: <strong>${escapeHtml(data.forwarderName || '')}</strong></span>
</div>

${requests.length > 0 ? `
<div class="section-title">Tạm ứng đã nhận</div>
<div class="advance-list">
  ${advanceRows}
  <div class="advance-total">
    <span>Tổng tạm ứng:</span>
    <span>${formatVND(totalAdvance, true)}</span>
  </div>
</div>` : ''}

<div class="section-title">Chi tiết chi phí</div>
<table>
  <thead><tr><th>Ngày</th><th>Nội dung</th><th>Khách hàng</th><th>Số cont</th><th class="num">Tiền tệ</th><th>Hóa đơn</th></tr></thead>
  <tbody>
    ${expenseTableRows}
    <tr class="table-total">
      <td colspan="4"><strong>TỔNG CỘNG</strong></td>
      <td class="num"><strong>${formatVND(totalExpense, true)}</strong></td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="summary">
  <div class="summary-row"><span>Tổng tạm ứng:</span><strong>${formatVND(totalAdvance, true)}</strong></div>
  <div class="summary-row"><span>Tổng chi phí:</span><strong>${formatVND(totalExpense, true)}</strong></div>
  ${refund > 0 ? `<div class="summary-row"><span>Tiền hoàn lại:</span><strong>${formatVND(refund, true)}</strong></div>` : ''}
  <div class="summary-row summary-row--balance">
    <span>${balance >= 0 ? 'Còn dư (phải hoàn):' : 'Thiếu (phải bổ sung):'}</span>
    <strong style="color: ${balance >= 0 ? '#16a34a' : '#dc2626'}">${formatVND(Math.abs(balance), true)}</strong>
  </div>
</div>

${data.note ? `<div class="note"><strong>Ghi chú:</strong> ${escapeHtml(data.note)}</div>` : ''}

<div class="signatures">
  <div class="sig-block"><div class="sig-label">Người lập</div><div class="sig-line">(Ký, họ tên)</div></div>
  <div class="sig-block"><div class="sig-label">Kế toán</div><div class="sig-line">(Ký, họ tên)</div></div>
  <div class="sig-block"><div class="sig-label">Quản lý</div><div class="sig-line">(Ký, họ tên)</div></div>
</div>
</body></html>`;
}

// ── XLSX rendering ──

export function renderSettlementXlsx(data: SettlementExportData, writable: import('stream').Writable): Promise<boolean> {
  const expenses: LinkedExpense[] = data.linkedExpenses || [];
  const requests: LinkedRequest[] = data.linkedRequests || [];
  const totalAdvance = requests.reduce((sum: number, r) => sum + Number(r.amount), 0);
  const totalExpense = expenses.reduce((sum: number, e) => sum + Number(e.amount), 0);
  const refund = Number(data.refundAmount || 0);
  const balance = totalAdvance - totalExpense - refund;
  const rows = buildPrintRows(expenses);
  const code = data.code || `PT-${String(data.id).padStart(4, '0')}`;

  return (async () => {
    const ExcelJSMod = await import('exceljs');
    const ExcelJS = (ExcelJSMod as unknown as { default?: typeof ExcelJSMod }).default ?? ExcelJSMod;
    const workbook = new ExcelJS.Workbook();
    const company = await getCompanyInfo();
    workbook.creator = company.name;
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Phiếu thanh toán', {
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0, footer: 0.3 },
      },
      properties: {},
    });

    // ── Constants ──
    const F = 'Calibri';
    const LAST_COL = 6;
    const CLR = {
      dark:    'FF1E293B',
      ink:     'FF475569',
      accent:  'FF0F172A',
      hdrBg:   'FF1E293B',
      hdrFg:   'FFFFFFFF',
      stripe:  'FFF8FAFC',
      border:  'FFCBD5E1',
      green:   'FF059669',
      red:     'FFDC2626',
      totalBg: 'FFF1F5F9',
    };

    const thinB = {
      top:    { style: 'thin' as const, color: { argb: CLR.border } },
      bottom: { style: 'thin' as const, color: { argb: CLR.border } },
      left:   { style: 'thin' as const, color: { argb: CLR.border } },
      right:  { style: 'thin' as const, color: { argb: CLR.border } },
    };

    // ── Helpers (always scoped to columns 1–LAST_COL) ──
    function fillRow(r: number, argb: string) {
      const f = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
      for (let c = 1; c <= LAST_COL; c++) sheet.getRow(r).getCell(c).fill = f;
    }
    function setBorders(r: number, b: Partial<import('exceljs').Borders>) {
      for (let c = 1; c <= LAST_COL; c++) sheet.getRow(r).getCell(c).border = b;
    }

    // ── Column widths ──
    const widths = [12, 22, 26, 16, 18, 20];
    for (let c = 0; c < widths.length; c++) {
      sheet.getColumn(c + 1).width = widths[c];
    }

    let row = 1;

    // ── 1. Document title ──
    sheet.mergeCells('A1:F1');
    const c1 = sheet.getCell('A1');
    c1.value = 'PHIẾU THANH TOÁN TẠM ỨNG';
    c1.font = { name: F, size: 16, bold: true, color: { argb: CLR.accent } };
    c1.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 30;

    // ── 2. Metadata ──
    sheet.mergeCells('A2:C2');
    sheet.getCell('A2').value = `Số phiếu: ${code}`;
    sheet.getCell('A2').font = { name: F, size: 10, color: { argb: CLR.ink } };

    sheet.mergeCells('D2:F2');
    sheet.getCell('D2').value = `Ngày lập: ${new Date(data.createdAt).toLocaleDateString('vi-VN')}`;
    sheet.getCell('D2').font = { name: F, size: 10, color: { argb: CLR.ink } };
    sheet.getCell('D2').alignment = { horizontal: 'right' };
    sheet.getRow(2).height = 18;

    sheet.mergeCells('A3:F3');
    sheet.getCell('A3').value = `Nhân viên giao nhận: ${data.forwarderName || '—'}`;
    sheet.getCell('A3').font = { name: F, size: 10, color: { argb: CLR.ink } };
    sheet.getRow(3).height = 18;
    row = 5;

    // ── 4. Advances section ──
    if (requests.length > 0) {
      sheet.mergeCells(`A${row}:F${row}`);
      sheet.getCell(`A${row}`).value = 'I. TẠM ỨNG ĐÃ NHẬN';
      sheet.getCell(`A${row}`).font = { name: F, size: 11, bold: true, color: { argb: CLR.accent } };
      sheet.getRow(row).height = 22;
      row++;

      // Header
      sheet.mergeCells(`B${row}:D${row}`);
      const hdrVals = ['STT', 'Lý do tạm ứng', '', '', 'Số tiền (VNĐ)', 'Ngày'];
      for (let c = 1; c <= LAST_COL; c++) {
        const cell = sheet.getRow(row).getCell(c);
        if (hdrVals[c - 1]) cell.value = hdrVals[c - 1];
        cell.font = { name: F, size: 10, bold: true, color: { argb: CLR.hdrFg } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = thinB;
      }
      fillRow(row, CLR.hdrBg);
      sheet.getRow(row).height = 20;
      row++;

      // Data rows
      for (let i = 0; i < requests.length; i++) {
        const r = requests[i];
        sheet.mergeCells(`B${row}:D${row}`);
        sheet.getCell(`A${row}`).value = i + 1;
        sheet.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getCell(`B${row}`).value = r.reason || '';
        sheet.getCell(`B${row}`).alignment = { wrapText: true, vertical: 'middle' };
        sheet.getCell(`E${row}`).value = Number(r.amount);
        sheet.getCell(`E${row}`).numFmt = '#,##0';
        sheet.getCell(`E${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
        sheet.getCell(`F${row}`).value = new Date(r.createdAt).toLocaleDateString('vi-VN');
        sheet.getCell(`F${row}`).alignment = { horizontal: 'center', vertical: 'middle' };

        for (let c = 1; c <= LAST_COL; c++) {
          sheet.getRow(row).getCell(c).font = { name: F, size: 10, color: { argb: CLR.dark } };
          sheet.getRow(row).getCell(c).border = thinB;
        }
        if (i % 2 === 1) fillRow(row, CLR.stripe);
        row++;
      }

      // Subtotal
      sheet.mergeCells(`A${row}:D${row}`);
      sheet.getCell(`A${row}`).value = 'Tổng tạm ứng';
      sheet.getCell(`A${row}`).font = { name: F, size: 10, bold: true, color: { argb: CLR.accent } };
      sheet.getCell(`A${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
      sheet.getCell(`E${row}`).value = totalAdvance;
      sheet.getCell(`E${row}`).numFmt = '#,##0';
      sheet.getCell(`E${row}`).font = { name: F, size: 10, bold: true, color: { argb: CLR.accent } };
      sheet.getCell(`E${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
      fillRow(row, CLR.totalBg);
      setBorders(row, { ...thinB, top: { style: 'medium', color: { argb: CLR.accent } } });
      sheet.getRow(row).height = 20;
      row += 2;
    }

    // ── 5. Expense detail section ──
    const sectionNum = requests.length > 0 ? 'II' : 'I';
    sheet.mergeCells(`A${row}:F${row}`);
    sheet.getCell(`A${row}`).value = `${sectionNum}. CHI TIẾT CHI PHÍ`;
    sheet.getCell(`A${row}`).font = { name: F, size: 11, bold: true, color: { argb: CLR.accent } };
    sheet.getRow(row).height = 22;
    row++;

    // Header
    const expHdr = ['Ngày', 'Nội dung chi phí', 'Khách hàng', 'Số cont', 'Thành tiền (VNĐ)', 'Số hóa đơn'];
    for (let c = 1; c <= LAST_COL; c++) {
      const cell = sheet.getRow(row).getCell(c);
      cell.value = expHdr[c - 1];
      cell.font = { name: F, size: 10, bold: true, color: { argb: CLR.hdrFg } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = thinB;
    }
    fillRow(row, CLR.hdrBg);
    sheet.getRow(row).height = 22;
    row++;

    // Data rows
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vals: Array<{ v: string | number; align?: 'left' | 'center' | 'right'; fmt?: string }> = [
        { v: r.date, align: 'center' },
        { v: r.expenseType },
        { v: r.customer },
        { v: r.container, align: 'center' },
        { v: r.amount, align: 'right', fmt: '#,##0' },
        { v: r.invoice },
      ];
      for (let c = 0; c < vals.length; c++) {
        const col = vals[c];
        const cell = sheet.getRow(row).getCell(c + 1);
        cell.value = col.v;
        cell.font = { name: F, size: 10, color: { argb: CLR.dark } };
        cell.border = thinB;
        cell.alignment = {
          horizontal: (col.align || 'left'),
          vertical: 'middle',
          wrapText: true,
        };
        if (col.fmt) cell.numFmt = col.fmt;
      }
      if (i % 2 === 1) fillRow(row, CLR.stripe);
      row++;
    }

    // Total
    sheet.mergeCells(`A${row}:D${row}`);
    sheet.getCell(`A${row}`).value = 'TỔNG CỘNG CHI PHÍ';
    sheet.getCell(`A${row}`).font = { name: F, size: 10, bold: true, color: { argb: CLR.accent } };
    sheet.getCell(`A${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
    sheet.getCell(`E${row}`).value = totalExpense;
    sheet.getCell(`E${row}`).numFmt = '#,##0';
    sheet.getCell(`E${row}`).font = { name: F, size: 11, bold: true, color: { argb: CLR.accent } };
    sheet.getCell(`E${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
    fillRow(row, CLR.totalBg);
    setBorders(row, {
      ...thinB,
      top: { style: 'double', color: { argb: CLR.accent } },
      bottom: { style: 'medium', color: { argb: CLR.accent } },
    });
    sheet.getRow(row).height = 22;
    row += 2;

    // ── 6. Summary box ──
    sheet.mergeCells(`A${row}:F${row}`);
    sheet.getCell(`A${row}`).value = 'TÓM TẮT THANH TOÁN';
    sheet.getCell(`A${row}`).font = { name: F, size: 11, bold: true, color: { argb: CLR.accent } };
    sheet.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
    setBorders(row, {
      top: { style: 'medium', color: { argb: CLR.accent } },
      left: { style: 'thin', color: { argb: CLR.border } },
      right: { style: 'thin', color: { argb: CLR.border } },
    });
    sheet.getRow(row).height = 22;
    row++;

    const summaryItems: Array<[string, number]> = [
      ['Tổng tạm ứng đã nhận', totalAdvance],
      ['Tổng chi phí phát sinh', totalExpense],
    ];
    if (refund > 0) summaryItems.push(['Tiền hoàn lại', refund]);

    for (const [label, value] of summaryItems) {
      sheet.mergeCells(`A${row}:D${row}`);
      sheet.getCell(`A${row}`).value = label;
      sheet.getCell(`A${row}`).font = { name: F, size: 10, color: { argb: CLR.ink } };
      sheet.getCell(`A${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
      sheet.mergeCells(`E${row}:F${row}`);
      sheet.getCell(`E${row}`).value = value;
      sheet.getCell(`E${row}`).numFmt = '#,##0';
      sheet.getCell(`E${row}`).font = { name: F, size: 10, color: { argb: CLR.dark } };
      sheet.getCell(`E${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
      setBorders(row, {
        left: { style: 'thin', color: { argb: CLR.border } },
        right: { style: 'thin', color: { argb: CLR.border } },
      });
      sheet.getRow(row).height = 18;
      row++;
    }

    // Balance row
    const balLabel = balance >= 0 ? 'Còn dư (phải hoàn lại)' : 'Thiếu (phải bổ sung)';
    const balClr = balance >= 0 ? CLR.green : CLR.red;

    sheet.mergeCells(`A${row}:D${row}`);
    sheet.getCell(`A${row}`).value = balLabel;
    sheet.getCell(`A${row}`).font = { name: F, size: 11, bold: true, color: { argb: balClr } };
    sheet.getCell(`A${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
    sheet.mergeCells(`E${row}:F${row}`);
    sheet.getCell(`E${row}`).value = Math.abs(balance);
    sheet.getCell(`E${row}`).numFmt = '#,##0';
    sheet.getCell(`E${row}`).font = { name: F, size: 12, bold: true, color: { argb: balClr } };
    sheet.getCell(`E${row}`).alignment = { horizontal: 'right', vertical: 'middle' };
    setBorders(row, {
      top: { style: 'medium', color: { argb: balClr } },
      bottom: { style: 'medium', color: { argb: CLR.accent } },
      left: { style: 'thin', color: { argb: CLR.border } },
      right: { style: 'thin', color: { argb: CLR.border } },
    });
    sheet.getRow(row).height = 24;
    row++;

    // ── 7. Note ──
    if (data.note) {
      row++;
      sheet.mergeCells(`A${row}:F${row}`);
      sheet.getCell(`A${row}`).value = `Ghi chú: ${data.note}`;
      sheet.getCell(`A${row}`).font = { name: F, size: 9, italic: true, color: { argb: CLR.ink } };
      sheet.getCell(`A${row}`).alignment = { wrapText: true, vertical: 'middle' };
      sheet.getRow(row).height = 30;
      row += 2;
    }

    // ── 8. Signatures ──
    row++;
    row += 2;
    const sigRow1 = row;
    const sigTitles = ['Người lập phiếu', 'Kế toán kiểm tra', 'Quản lý duyệt'];
    const sigCols = [['A', 'B'], ['C', 'D'], ['E', 'F']];

    for (let i = 0; i < sigTitles.length; i++) {
      const [st, se] = sigCols[i];
      sheet.mergeCells(`${st}${sigRow1}:${se}${sigRow1}`);
      const cell = sheet.getCell(`${st}${sigRow1}`);
      cell.value = sigTitles[i];
      cell.font = { name: F, size: 10, bold: true, color: { argb: CLR.accent } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    sheet.getRow(sigRow1).height = 20;

    const sigRow2 = sigRow1 + 4;
    for (const [st, se] of sigCols) {
      sheet.mergeCells(`${st}${sigRow2}:${se}${sigRow2}`);
      const cell = sheet.getCell(`${st}${sigRow2}`);
      cell.value = '(Ký, ghi rõ họ tên)';
      cell.font = { name: F, size: 9, italic: true, color: { argb: CLR.ink } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }

    // ── 9. Footer ──
    const footerRow = sigRow2 + 2;
    sheet.mergeCells(`A${footerRow}:F${footerRow}`);
    sheet.getCell(`A${footerRow}`).value = `In ngày ${new Date().toLocaleDateString('vi-VN')} — ${company.name}`;
    sheet.getCell(`A${footerRow}`).font = { name: F, size: 8, italic: true, color: { argb: 'FF94A3B8' } };
    sheet.getCell(`A${footerRow}`).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.pageSetup.printTitlesRow = '1:2';

    await workbook.xlsx.write(writable);
    return true;
  })();
}

// ── Backward-compatible wrappers (existing routes use these) ──

export async function exportSettlementHtml(id: number): Promise<string | null> {
  const data = await buildSettlementExportData(id);
  if (!data) return null;
  return renderSettlementHtml(data);
}

export async function exportSettlementXlsx(id: number, writable: import('stream').Writable): Promise<boolean> {
  const data = await buildSettlementExportData(id);
  if (!data) return false;
  return renderSettlementXlsx(data, writable);
}

// ── Preview: build synthetic settlement from form input without persisting ──

async function buildPreviewSettlementData(input: {
  forwarderId: number;
  advanceRequestIds: number[];
  tripExpenseIds?: number[];
  refundAmount?: number;
  note?: string;
}): Promise<SettlementExportData> {
  const { forwarderId, advanceRequestIds, tripExpenseIds, refundAmount, note } = input;

  // Shared validation: existence, ownership, and status checks.
  // Note: tripExpenses from validation is intentionally unused here — the
  // print renderer enriches expenses independently via its own join below.
  const { advanceRequests: requests } =
    await validateSettlementInputs({
      dbOrTx: db,
      forwarderId,
      advanceRequestIds,
      tripExpenseIds,
      checkAlreadyLinked: false,
    });

  // Enrich expenses with trip/customer join for print display
  let linkedExpenses: LinkedExpense[] = [];
  if (tripExpenseIds && tripExpenseIds.length > 0) {
    // F1-2b: resolve the container label via the authoritative FK
    // (tripExpenses.tripContainerId → tripContainers.containerNumber), falling
    // back to the loose denormalised containerNumber string ONLY for legacy rows
    // where the FK is null. `tripContainers.containerNumber` is NOT NULL, so when
    // the join matches it is always the canonical value; COALESCE covers the
    // leftJoin-no-match (null FK) case by returning the stored string, and
    // finally '-' if both are absent. Grouping in buildPrintRows then operates
    // on this resolved key.
    linkedExpenses = await db.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      expenseType: s.tripExpenses.expenseType,
      amount: s.tripExpenses.buyAmount,
      containerNumber: sql<string | null>`COALESCE(${s.tripContainers.containerNumber}, ${s.tripExpenses.containerNumber})`.as('resolved_container_number'),
      invoiceNumber: s.tripExpenses.invoiceNumber,
      note: s.tripExpenses.note,
      createdAt: s.tripExpenses.createdAt,
      departureDate: s.trips.departureDate,
      customerName: s.customers.name,
    }).from(s.tripExpenses)
      .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
      .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
      .leftJoin(s.tripContainers, eq(s.tripExpenses.tripContainerId, s.tripContainers.id))
      .where(inArray(s.tripExpenses.id, tripExpenseIds));
  }

  // 3. Get forwarder name
  const [user] = await db.select({ fullName: s.users.fullName })
    .from(s.users).where(eq(s.users.id, forwarderId));
  const forwarderName = user?.fullName || null;

  // 4. Build synthetic settlement object
  return {
    id: 'PREVIEW',
    code: 'XEM-TRƯỚC',
    createdAt: new Date().toISOString(),
    forwarderName,
    refundAmount: String(refundAmount ?? 0),
    note: note ?? null,
    linkedRequests: requests,
    linkedExpenses,
  };
}

export async function previewSettlementHtml(input: {
  forwarderId: number;
  advanceRequestIds: number[];
  tripExpenseIds?: number[];
  refundAmount?: number;
  note?: string;
}): Promise<string> {
  const data = await buildPreviewSettlementData(input);
  return renderSettlementHtml(data);
}

export async function previewSettlementXlsx(
  input: {
    forwarderId: number;
    advanceRequestIds: number[];
    tripExpenseIds?: number[];
    refundAmount?: number;
    note?: string;
  },
  writable: import('stream').Writable,
): Promise<boolean> {
  const data = await buildPreviewSettlementData(input);
  return renderSettlementXlsx(data, writable);
}
