// Statement XLSX/HTML renderer shared by the customer and supplier statement
// leaves: one export-config shape drives both the Segoe-UI-styled workbook and
// the printable HTML letterhead. Extracted from statement.service.ts verbatim
// (pure code movement).
import { escapeHtml } from '../lib/format';
import { getCompanyInfo } from './company-info.service';
import { stampCompanyHeaderXlsx, companyHeaderHtml, loadLogoDataUrl } from './lib/export-company';
import type { EnrichedLedgerRow, CustomerStatementData } from './statement-shared.service';

interface StatementExportConfig {
  heading: string;
  sheetName?: string;
  entityLabel: string;
  entityName: string;
  contactLines: string[];
  txnLabels: Record<string, string>;
  ledgerRows: EnrichedLedgerRow[];
  totalOutstanding: number;
  agingBuckets: Array<{ range: string; amount: number }>;
  unpaidTrips?: CustomerStatementData['unpaidTrips'];
}
const SHARED_CSS = `body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; max-width: 900px; margin: 24px auto; padding: 0 16px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 16px; }
  .total { font-size: 16px; font-weight: 700; color: #111827; margin: 12px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .aging { width: auto; margin-top: 8px; }
  .aging td { padding: 4px 12px 4px 0; }
  @media print { body { margin: 0; } }`;
export async function buildStatementXlsx(config: StatementExportConfig, dateStr: string, writable: import('stream').Writable): Promise<void> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(config.sheetName);

  // Enable grid lines
  sheet.views = [{ showGridLines: true }];

  // Border style
  const borderStyle = {
    top: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    left: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } },
    right: { style: 'thin' as const, color: { argb: 'FFD1D5DB' } }
  };

  // Company letterhead (configured on /config/company-info) — rows 1..4.
  const company = await getCompanyInfo();
  const afterHeader = await stampCompanyHeaderXlsx(workbook, sheet, company, { lastCol: 8 });

  // Header/Title Row
  const titleRow = afterHeader + 1;
  sheet.mergeCells(titleRow, 1, titleRow, 8);
  const titleCell = sheet.getCell(titleRow, 1);
  titleCell.value = config.heading.toUpperCase();
  titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(titleRow).height = 36;

  // Partner Info
  const partnerRow = titleRow + 2;
  sheet.getCell(partnerRow, 1).value = `${config.entityLabel}:`;
  sheet.getCell(partnerRow, 1).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF374151' } };
  sheet.getCell(partnerRow, 2).value = config.entityName;
  sheet.getCell(partnerRow, 2).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF111827' } };
  sheet.mergeCells(partnerRow, 2, partnerRow, 8);
  sheet.getRow(partnerRow).height = 20;

  // Contact Info
  let currentOffset = partnerRow + 1;
  config.contactLines.forEach((line) => {
    sheet.getCell(`A${currentOffset}`).value = line;
    sheet.getCell(`A${currentOffset}`).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } };
    sheet.mergeCells(`A${currentOffset}:H${currentOffset}`);
    sheet.getRow(currentOffset).height = 18;
    currentOffset++;
  });

  // Export date
  sheet.getCell(`A${currentOffset}`).value = `Ngày xuất: ${dateStr}`;
  sheet.getCell(`A${currentOffset}`).font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(`A${currentOffset}:H${currentOffset}`);
  sheet.getRow(currentOffset).height = 18;
  currentOffset++;

  // Total Outstanding Row
  const outstandingRow = currentOffset;
  sheet.getCell(`A${outstandingRow}`).value = 'TỔNG CỘNG NỢ HIỆN TẠI:';
  sheet.getCell(`A${outstandingRow}`).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFDC2626' } };
  sheet.mergeCells(`A${outstandingRow}:D${outstandingRow}`);

  sheet.getCell(`E${outstandingRow}`).value = config.totalOutstanding;
  sheet.getCell(`E${outstandingRow}`).font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFDC2626' } };
  sheet.getCell(`E${outstandingRow}`).numFmt = '#,##0" đ"';
  sheet.mergeCells(`E${outstandingRow}:H${outstandingRow}`);
  sheet.getRow(outstandingRow).height = 22;
  currentOffset++;

  // Space
  currentOffset++;

  // Aging header row
  const agingHeaderRow = currentOffset;
  sheet.mergeCells(`A${agingHeaderRow}:H${agingHeaderRow}`);
  const agingHeaderCell = sheet.getCell(`A${agingHeaderRow}`);
  agingHeaderCell.value = 'PHÂN TÍCH TUỔI NỢ';
  agingHeaderCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF00702F' } };
  agingHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
  agingHeaderCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(agingHeaderRow).height = 24;
  currentOffset++;

  // Aging columns: horizontal grid
  const agingLabelRow = currentOffset;
  const agingValueRow = agingLabelRow + 1;

  config.agingBuckets.forEach((b, i) => {
    const colIdx = i + 1; // A, B, C, D
    const labelCell = sheet.getCell(agingLabelRow, colIdx);
    labelCell.value = b.range;
    labelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'center' };
    labelCell.border = borderStyle;

    const valCell = sheet.getCell(agingValueRow, colIdx);
    valCell.value = b.amount;
    valCell.font = { name: 'Segoe UI', size: 10, color: b.amount > 0 ? { argb: 'FFDC2626' } : { argb: 'FF9CA3AF' } };
    valCell.numFmt = '#,##0';
    valCell.alignment = { vertical: 'middle', horizontal: 'center' };
    valCell.border = borderStyle;
  });

  // Aging Total Column (Columns 5 to 8 merged)
  const totalLabelCell = sheet.getCell(agingLabelRow, 5);
  totalLabelCell.value = 'Tổng cộng';
  totalLabelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  totalLabelCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.mergeCells(agingLabelRow, 5, agingLabelRow, 8);
  for (let c = 5; c <= 8; c++) {
    sheet.getCell(agingLabelRow, c).border = borderStyle;
  }

  const totalValueCell = sheet.getCell(agingValueRow, 5);
  totalValueCell.value = config.totalOutstanding;
  totalValueCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF00702F' } };
  totalValueCell.numFmt = '#,##0';
  totalValueCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.mergeCells(agingValueRow, 5, agingValueRow, 8);
  for (let c = 5; c <= 8; c++) {
    sheet.getCell(agingValueRow, c).border = borderStyle;
  }

  sheet.getRow(agingLabelRow).height = 20;
  sheet.getRow(agingValueRow).height = 20;
  currentOffset += 2;

  // Space
  currentOffset++;

  if (config.unpaidTrips && config.unpaidTrips.length > 0) {
    sheet.mergeCells(currentOffset, 1, currentOffset, 8);
    const dueHeader = sheet.getCell(currentOffset, 1);
    dueHeader.value = 'HẠN THANH TOÁN CÁC KHOẢN CHƯA THU';
    dueHeader.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF00702F' } };
    dueHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4EA' } };
    currentOffset++;

    const dueHeaders = ['Chuyến', 'Ngày phát sinh', 'Hạn hợp đồng', 'Ngày xử lý', 'Còn phải thu'];
    dueHeaders.forEach((label, index) => {
      const cell = sheet.getCell(currentOffset, index + 1);
      cell.value = label;
      cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = borderStyle;
    });
    currentOffset++;

    for (const item of config.unpaidTrips) {
      const values = [
        item.tripCode ?? 'Chuyến chưa có mã',
        item.date,
        item.originalDueDate ?? 'Chưa có dữ liệu lịch sử',
        item.processingDueDate ?? 'Chưa có dữ liệu lịch sử',
        item.outstanding,
      ];
      values.forEach((value, index) => {
        const cell = sheet.getCell(currentOffset, index + 1);
        cell.value = value;
        cell.border = borderStyle;
        if (index === 4) cell.numFmt = '#,##0';
      });
      currentOffset++;
    }
    currentOffset++;
  }

  // Transaction Detail Header (Row 13+)
  const transHeaderRow = currentOffset;
  sheet.mergeCells(`A${transHeaderRow}:H${transHeaderRow}`);
  const transHeaderCell = sheet.getCell(`A${transHeaderRow}`);
  transHeaderCell.value = 'CHI TIẾT CÁC GIAO DỊCH';
  transHeaderCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  transHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00702F' } };
  transHeaderCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(transHeaderRow).height = 24;
  currentOffset++;

  // Table header row
  const tableHeaderRow = currentOffset;
  const headers = ['Ngày', 'Tuyến đường', 'Số Container', 'Loại giao dịch', 'Nợ (VND)', 'Có (VND)', 'Số dư (VND)', 'Ghi chú'];
  headers.forEach((h, i) => {
    const cell = sheet.getCell(tableHeaderRow, i + 1);
    cell.value = h;
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF374151' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: i === 0 ? 'center' : (i >= 4 && i <= 6 ? 'right' : 'left'),
    };
    cell.border = borderStyle;
  });
  sheet.getRow(tableHeaderRow).height = 22;
  currentOffset++;

  // Populate data rows
  config.ledgerRows.forEach((row, i: number) => {
    const r = tableHeaderRow + 1 + i;
    const debit = parseFloat(row.debit || '0');
    const credit = parseFloat(row.credit || '0');
    const balance = parseFloat(row.balance || '0');

    const dateCell = sheet.getCell(r, 1);
    dateCell.value = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 10) : '';
    dateCell.alignment = { vertical: 'middle', horizontal: 'center' };

    const routeCell = sheet.getCell(r, 2);
    routeCell.value = row.routeName || '—';
    routeCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const contCell = sheet.getCell(r, 3);
    contCell.value = row.containerNumbers && row.containerNumbers.length > 0
      ? row.containerNumbers.join(', ')
      : '—';
    contCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const typeCell = sheet.getCell(r, 4);
    typeCell.value = config.txnLabels[row.txnType] || 'Khác';
    typeCell.alignment = { vertical: 'middle', horizontal: 'left' };

    const debitCell = sheet.getCell(r, 5);
    debitCell.value = debit || '';
    debitCell.numFmt = '#,##0';
    debitCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const creditCell = sheet.getCell(r, 6);
    creditCell.value = credit || '';
    creditCell.numFmt = '#,##0';
    creditCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const balCell = sheet.getCell(r, 7);
    balCell.value = balance;
    balCell.numFmt = '#,##0';
    balCell.alignment = { vertical: 'middle', horizontal: 'right' };
    balCell.font = { name: 'Segoe UI', size: 10, bold: true, color: balance > 0 ? { argb: 'FFDC2626' } : { argb: 'FF10B981' } };

    const noteCell = sheet.getCell(r, 8);
    noteCell.value = row.note || '';
    noteCell.alignment = { vertical: 'middle', horizontal: 'left' };

    // Zebra striping and standard styling
    const zebraColor = i % 2 === 0 ? 'FFFFFFFF' : 'FFF9FBF9';
    for (let c = 1; c <= 8; c++) {
      const cell = sheet.getCell(r, c);
      if (c !== 7) {
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: 'FF1F2937' } };
      }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraColor } };
      cell.border = borderStyle;
    }

    sheet.getRow(r).height = 20;
  });

  // Set column widths
  sheet.getColumn(1).width = 14; // Ngày (a bit wider — header label "Ngày" + ISO dates need breathing room)
  sheet.getColumn(2).width = 28; // Tuyến đường
  sheet.getColumn(3).width = 22; // Số Container
  sheet.getColumn(4).width = 22; // Loại giao dịch
  sheet.getColumn(5).width = 16; // Nợ
  sheet.getColumn(6).width = 16; // Có
  sheet.getColumn(7).width = 18; // Số dư
  sheet.getColumn(8).width = 35; // Ghi chú

  await workbook.xlsx.write(writable);
}

export async function buildStatementHtml(config: StatementExportConfig, dateStr: string): Promise<string> {
  const company = await getCompanyInfo();
  const logoDataUrl = await loadLogoDataUrl(company.logoStorageKey);
  const header = companyHeaderHtml(company, logoDataUrl);
  const rows = config.ledgerRows.map((row) => {
    const debit = parseFloat(row.debit || '0');
    const credit = parseFloat(row.credit || '0');
    const balance = parseFloat(row.balance || '0');
    const date = row.timestamp ? new Date(row.timestamp).toISOString().slice(0, 10) : '';
    const routeName = row.routeName || '—';
    const containerNumbers = row.containerNumbers && row.containerNumbers.length > 0
      ? row.containerNumbers.join(', ')
      : '—';
    return `<tr>
      <td>${date}</td>
      <td>${escapeHtml(routeName)}</td>
      <td>${escapeHtml(containerNumbers)}</td>
      <td>${escapeHtml(config.txnLabels[row.txnType] || 'Khác')}</td>
      <td class="num">${debit ? debit.toLocaleString('vi-VN') : ''}</td>
      <td class="num">${credit ? credit.toLocaleString('vi-VN') : ''}</td>
      <td class="num">${balance.toLocaleString('vi-VN')}</td>
      <td>${escapeHtml(row.note || '')}</td>
    </tr>`;
  }).join('');

  const agingRows = config.agingBuckets.map(b =>
    `<tr><td>${b.range}</td><td class="num">${b.amount.toLocaleString('vi-VN')} ₫</td></tr>`
  ).join('');

  const contactHtml = config.contactLines.map(l => escapeHtml(l)).join('<br>\n  ');
  const dueDateRows = (config.unpaidTrips ?? []).map(item => `<tr>
    <td>${escapeHtml(item.tripCode ?? 'Chuyến chưa có mã')}</td>
    <td>${escapeHtml(item.date)}</td>
    <td>${escapeHtml(item.originalDueDate ?? 'Chưa có dữ liệu lịch sử')}</td>
    <td>${escapeHtml(item.processingDueDate ?? 'Chưa có dữ liệu lịch sử')}</td>
    <td class="num">${item.outstanding.toLocaleString('vi-VN')} ₫</td>
  </tr>`).join('');
  const dueDateTable = dueDateRows
    ? `<h2>Hạn thanh toán các khoản chưa thu</h2>
<table>
  <thead><tr><th>Chuyến</th><th>Ngày phát sinh</th><th>Hạn hợp đồng</th><th>Ngày xử lý</th><th class="num">Còn phải thu</th></tr></thead>
  <tbody>${dueDateRows}</tbody>
</table>`
    : '';

  return `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8">
<title>${escapeHtml(config.heading)} — ${escapeHtml(config.entityName)}</title>
<style>
  ${SHARED_CSS}
</style>
</head><body>
${header}
<h1>${escapeHtml(config.heading)}</h1>
<div class="meta">
  ${config.entityLabel}: <strong>${escapeHtml(config.entityName)}</strong><br>
  ${contactHtml}<br>
  Ngày xuất: ${dateStr}
</div>
<div class="total">Tổng nợ: ${config.totalOutstanding.toLocaleString('vi-VN')} ₫</div>
<table class="aging">${agingRows}</table>
${dueDateTable}
<table>
  <thead><tr><th>Ngày</th><th>Tuyến</th><th>Số Cont</th><th>Loại GD</th><th class="num">Nợ</th><th class="num">Có</th><th class="num">Số dư</th><th>Ghi chú</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}
