/**
 * Excel export for an Ops settlement batch (đề nghị thanh toán — OpsVanHanh
 * §5.4): ONE flat 6-column bảng kê (SIL-845) carrying at most the two invoice
 * baskets (A: Có hóa đơn / B: Không hóa đơn) and closed by the three total
 * rows — để Ops in đính kèm hồ sơ chứng từ gốc gửi kế toán.
 */
import ExcelJS from 'exceljs';
import { settlementRowDeclarationCell } from '@tingting/shared';
import { getOpsSettlementDetail, type OpsSettlementDetail } from './ops-settlements.service';
import { companyHeaderHtml, loadLogoDataUrl } from './lib/export-company';
import { getCompanyInfo } from './company-info.service';
import { escapeHtml, formatVND } from '../lib/format';

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

// ── SIL-845 — the printable HTML twin of the flat 6-column phiếu ──
// /my-settlements' [In] renders THIS (same grouping, same A/B markers, same
// three closing totals as the xlsx above and the /ops/wallet dialog), so the
// three surfaces can never disagree about the phiếu's format. The company
// letterhead comes from the same /config/company-info source the advance
// phiếu print uses, so the printed pack keeps one identity.

const SHEET_PRINT_CSS = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; max-width: 900px; margin: 24px auto; padding: 0 16px; font-size: 13px; }
  h1 { font-size: 18px; text-align: center; margin: 0 0 4px; letter-spacing: 0.05em; }
  .meta { color: #374151; font-size: 13px; margin: 8px 0 12px; border-bottom: 2px solid #1f2937; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.section td { font-weight: 700; background: #f9fafb; }
  tr.grand td { border-top: 2px solid #1f2937; font-weight: 700; font-size: 13.5px; }
  .excluded, .excluded td { color: #555555; font-style: italic; }
  .signatures { display: flex; justify-content: space-between; margin-top: 56px; font-weight: 700; }
  .sig-note { font-weight: 400; color: #6b7280; font-size: 12px; }
  @media print { body { margin: 0; } }
`;

export async function renderOpsSettlementSheetHtml(
  settlement: OpsSettlementDetail['settlement'],
  grouping: OpsSettlementDetail['grouping'],
): Promise<string> {
  const company = await getCompanyInfo();
  const logoDataUrl = await loadLogoDataUrl(company.logoStorageKey);
  const header = companyHeaderHtml(company, logoDataUrl);

  const sectionRows = SHEET_SECTIONS.map(({ basketKey, label }) => {
    const items = grouping.groups.flatMap((group) => group[basketKey].items);
    if (items.length === 0) return '';
    const section = `<tr class="section"><td colspan="6">${escapeHtml(label)}</td></tr>`;
    const rows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.customerName?.trim() || '—')}</td>
      <td>${escapeHtml(item.billRef?.trim() || 'Chưa có số Bill/Booking')}</td>
      <td>${escapeHtml(settlementRowDeclarationCell(item))}</td>
      <td>${escapeHtml(item.containerLabel)}</td>
      <td>${escapeHtml(item.expenseTypeName ?? '')}</td>
      <td class="num">${formatVND(Number(item.amount))}</td>
    </tr>`).join('');
    return section + rows;
  }).join('');

  const excludedBlock = Number(grouping.totals.excludedNegative ?? 0) !== 0
    ? `
    <tr class="excluded"><td colspan="5">Dòng âm đã loại trừ (không cộng vào tổng)</td><td class="num">${formatVND(Number(grouping.totals.excludedNegative))}</td></tr>
    <tr class="excluded"><td colspan="5">Tổng nếu cộng cả dòng âm</td><td class="num">${formatVND(Number(grouping.totals.rawGrand))}</td></tr>`
    : '';

  return `<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8">
<title>PHIẾU QUYẾT TOÁN ${escapeHtml(settlement.code)}</title>
<style>${SHEET_PRINT_CSS}</style>
</head><body>
${header}
<h1>PHIẾU QUYẾT TOÁN ${escapeHtml(settlement.code)}</h1>
<div class="meta">
  <span>Người lập: <strong>${escapeHtml(settlement.opsUserName ?? '—')}</strong></span>
  <span>Ngày: <strong>${new Date(settlement.createdAt).toLocaleDateString('vi-VN')}</strong></span>
</div>
${settlement.note ? `<div class="meta">Ghi chú: ${escapeHtml(settlement.note)}</div>` : ''}
<table>
  <thead><tr>
    <th>Tên công ty</th><th>Số Bill/Book</th><th>Số tờ khai</th><th>Số cont</th><th>Tên chi phí</th><th class="num">Số tiền</th>
  </tr></thead>
  <tbody>
    ${sectionRows}
    <tr><td colspan="5">Tổng có hóa đơn</td><td class="num">${formatVND(Number(grouping.totals.withInvoice))}</td></tr>
    <tr><td colspan="5">Tổng không hóa đơn</td><td class="num">${formatVND(Number(grouping.totals.withoutInvoice))}</td></tr>
    <tr class="grand"><td colspan="5">TỔNG CỘNG QUYẾT TOÁN</td><td class="num">${formatVND(Number(grouping.totals.grand))}</td></tr>
    ${excludedBlock}
  </tbody>
</table>
<div class="signatures">
  <div>Người lập (Ops)<div class="sig-note">(Ký, ghi rõ họ tên)</div></div>
  <div>Kế toán<div class="sig-note">(Ký, ghi rõ họ tên)</div></div>
</div>
</body></html>`;
}
