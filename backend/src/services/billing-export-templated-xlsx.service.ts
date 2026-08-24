// Template-driven PAYMENT_STATEMENT renderer (dynamic horizontal columns,
// Vietsun reference geometry, template-token interpolation) and the shared
// column-format/width machinery. Extracted from billing-export.service.ts
// verbatim (pure code movement). The lazy VIETSUN map initialization is
// load-bearing: billing-document and the export leaves sit on a pre-existing
// transitive import cycle (via statement/credit-limit/governance), and eager
// module-init reads of DEFAULT_PAYMENT_STATEMENT_COLUMNS would hit its TDZ.
import type { BillingDocument, BillingDocumentLine, DebitNoteTemplateSnapshot, DebitNoteTemplateColumn } from '@tingting/shared';
import { loadLogoBytes } from './lib/export-company';
import { DEFAULT_PAYMENT_STATEMENT_COLUMNS, effectiveAmount, normalizeTemplateColumns } from './billing-document.service';
import {
  renderColumnValue,
  enrichLinesForDebitNoteRender,
  formatVietnameseDate,
  formatMonthYear,
  amountToVietnameseWords,
} from './billing-export-shared.service';
import { resolveBillingDocumentIdentity } from './billing-export-identity.service';
import { renderDebitNoteXlsx } from './billing-export-debit-note-xlsx.service';

// Fixed Vietsun statement table geometry (column id -> width/column def).
// Built lazily: billing-document ↔ billing-export sit on a pre-existing
// transitive import cycle (via statement/credit-limit/governance chain), and
// eager module-init read of DEFAULT_PAYMENT_STATEMENT_COLUMNS hits its TDZ
// when billing-document is still mid-initialization.
let vietsunColumnById: Map<string, DebitNoteTemplateColumn> | null = null;
let vietsunWidthById: Map<string, number> | null = null;
const VIETSUN_TABLE_COLUMN_BY_ID = () => (vietsunColumnById ??= new Map(DEFAULT_PAYMENT_STATEMENT_COLUMNS.map((col) => [col.id, col])));
const VIETSUN_TABLE_WIDTH_BY_ID = () => (vietsunWidthById ??= new Map(DEFAULT_PAYMENT_STATEMENT_COLUMNS.map((col) => [col.id, col.width])));
function hasTemplateToken(value: string): boolean {
  return /\{\{?\s*[\w.]+\s*\}?\}/.test(value);
}

function renderTemplateText(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}|\{\s*([\w.]+)\s*\}/g, (match, doubleKey, singleKey) => {
    const key = doubleKey ?? singleKey;
    const value = variables[key];
    return value == null ? match : String(value);
  });
}
/** 1-based column index → Excel letter (1→A, 2→B, …, 27→AA). */
function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
function applyInferredColumnFormat(cell: { numFmt?: string; alignment?: unknown }, value: unknown): void {
  if (value instanceof Date) {
    cell.numFmt = 'm/d/yyyy';
  } else if (typeof value === 'number') {
    cell.numFmt = '#,##0';
  }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function renderedValueLength(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Date) return 10;
  if (typeof value === 'number') return value.toLocaleString('en-US').length;
  if (typeof value === 'object' && 'formula' in value) {
    const result = (value as { result?: unknown }).result;
    return renderedValueLength(result);
  }
  return String(value)
    .split('\n')
    .reduce((max, part) => Math.max(max, part.trim().length), 0);
}

function autoColumnWidth(header: string, values: unknown[]): number {
  const lengths = [header, ...values].map(renderedValueLength).filter((len) => len > 0);
  if (lengths.length === 0) return 8;
  const avg = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;
  const headerMin = renderedValueLength(header) + 2;
  return Math.max(4, Math.min(42, Math.ceil(Math.max(avg * 1.35 + 2, headerMin))));
}

function renderDebitNoteColumnLabel(col: DebitNoteTemplateColumn): string {
  const reference = VIETSUN_TABLE_COLUMN_BY_ID().get(col.id);
  if (!reference) return col.label;
  const compact = (value: string) => value.replace(/\s+/g, '');
  return compact(col.label) === compact(reference.label) ? reference.label : col.label;
}

function aggregateDebitNoteExportLines(lines: BillingDocumentLine[]): BillingDocumentLine[] {
  const groups = new Map<string, BillingDocumentLine>();
  const passthrough: BillingDocumentLine[] = [];

  for (const line of lines) {
    if (line.excluded) continue;
    const data = line.renderData ?? {};
    const keyParts = [
      data.departureDate ?? '',
      data.truckPlate ?? '',
      data.actionType ?? '',
      data.origin ?? '',
      data.destination ?? line.routeName ?? '',
      data.deliveryAddress ?? '',
      (line.containerNumbers ?? []).join('|'),
      data.container20Count ?? '',
      data.container40Count ?? '',
    ];
    const canGroup = line.sourceType === 'TRIP' || line.sourceType === 'EXPENSE';
    if (!canGroup) {
      passthrough.push(line);
      continue;
    }

    const key = keyParts.join('\u001f');
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...line, lineType: 'FREIGHT', baseAmount: effectiveAmount(line), amountOverride: null });
      continue;
    }
    groups.set(key, {
      ...existing,
      baseAmount: effectiveAmount(existing) + effectiveAmount(line),
      amountOverride: null,
    });
  }

  return [...groups.values(), ...passthrough].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
/**
 * Render a debit note from a frozen snapshot (the doc's
 * debit_note_template_snapshot). Debit notes use the fixed VTA-style vertical
 * worksheet; payment statements below keep the dynamic horizontal columns.
 * Reads the logo bytes from storage (graceful skip if the file is missing).
 */
export async function renderTemplatedXlsx(
  doc: BillingDocument,
  snap: DebitNoteTemplateSnapshot,
): Promise<Buffer> {
  if (doc.type === 'DEBIT_NOTE') return renderDebitNoteXlsx(doc, snap);

  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet(`Tháng ${Number(doc.rangeTo.slice(5, 7)) || Number(doc.rangeFrom.slice(5, 7)) || 1}`);

  const cols = normalizeTemplateColumns(snap.columns, 'PAYMENT_STATEMENT').filter((col) => col.width > 0);
  const nCols = cols.length;
  const widthSamples: unknown[][] = cols.map(() => []);
  const amountIdx = cols.findIndex((col) => col.variable === 'amount') + 1;
  const totalColumns = cols
    .map((col, idx) => ({ col, idx: idx + 1 }))
    .filter(({ col }) => col.total);
  const lines = await enrichLinesForDebitNoteRender(doc.lines);
  const dataLines = aggregateDebitNoteExportLines(lines);
  const officialIdentity = await resolveBillingDocumentIdentity(doc, snap);
  const issuer = officialIdentity?.issuer ?? null;
  const partner = officialIdentity?.counterparty ?? null;
  wb.creator = issuer?.name || '';
  const bangKeLogoBytes = await loadLogoBytes(issuer?.logoStorageKey ?? null);
  if (bangKeLogoBytes) {
    const imageId = wb.addImage({ base64: bangKeLogoBytes.toString('base64'), extension: 'png' });
    ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 150, height: 40 } });
  }
  const amountSubtotal = dataLines.reduce((sum, line) => sum + effectiveAmount(line), 0);
  const vatAmount = Math.round(amountSubtotal * 0.08);
  const grandTotal = amountSubtotal + vatAmount;
  const customerName = partner?.name || doc.entityName || '';
  const issuerName = issuer?.name || '';
  const templateVariables: Record<string, string | number> = {
    rangeFrom: formatVietnameseDate(doc.rangeFrom),
    rangeTo: formatVietnameseDate(doc.rangeTo),
    rangeMonth: formatMonthYear(doc.rangeTo),
    invoiceNo: doc.note?.trim() || '........',
    invoiceDate: formatVietnameseDate(doc.rangeTo),
    customerName,
    customerAddress: partner?.address || '',
    customerTaxCode: partner?.taxCode || '',
    customerRepresentative: partner?.representative || '',
    customerPosition: partner?.representativeTitle || '',
    issuerName,
    issuerAddress: issuer?.address || '',
    issuerTaxCode: issuer?.taxCode || '',
    issuerRepresentative: issuer?.representative || '',
    issuerPosition: issuer?.representativeTitle || '',
    subtotal: amountSubtotal.toLocaleString('en-US'),
    vatAmount: vatAmount.toLocaleString('en-US'),
    grandTotal: grandTotal.toLocaleString('en-US'),
    amountInWords: amountToVietnameseWords(grandTotal),
  };

  const thinBlack = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const hairBlack = { style: 'hair' as const, color: { argb: 'FF000000' } };
  const baseFont = { name: 'Times New Roman', size: 11, color: { argb: 'FF000000' } };
  const boldFont = { ...baseFont, bold: true };
  const moneyFmt = '_(* #,##0_);_(* \\(#,##0\\);_(* \\-??_);_(@_)';
  const nColsForIntro = Math.max(nCols, 12);

  ws.properties.defaultRowHeight = 22;
  ws.pageSetup = {
    paperSize: 9,
    orientation: snap.orientation === 'portrait' ? 'portrait' : 'landscape',
    fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    margins: { left: 0.5, right: 0.2, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  const introRowHeights = new Map<number, number>([
    [1, 13.5],
    [2, 26.25],
    [3, 19.5],
    [16, 20.1],
  ]);
  for (let r = 1; r <= 16; r++) ws.getRow(r).height = introRowHeights.get(r) ?? 18;
  ws.getRow(17).height = 15;
  if (nCols > 1) ws.mergeCells(17, 1, 17, nCols);

  const rawTitle = snap.titleText || 'BẢNG KÊ CƯỚC VẬN CHUYỂN';
  const titleTemplate = hasTemplateToken(rawTitle) || /\bTHÁNG\b/i.test(rawTitle)
    ? rawTitle
    : `${rawTitle} THÁNG {rangeMonth}`;
  ws.mergeCells(2, 1, 2, nColsForIntro);
  ws.getCell(2, 1).value = renderTemplateText(titleTemplate, templateVariables);
  ws.getCell(2, 1).font = { name: 'Times New Roman', size: 16, bold: true };
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(3, 1, 3, nColsForIntro);
  ws.getCell(3, 1).value = renderTemplateText('(Kèm hoá đơn GTGT số: {invoiceNo}   ngày {invoiceDate})', templateVariables);
  ws.getCell(3, 1).font = { name: 'Times New Roman', size: 12, bold: true };
  ws.getCell(3, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  const termsLines = renderTemplateText(
    snap.termsText ?? `- Số TK ${issuer?.bankAccount || ''}\n- Tại ngân hàng ${issuer?.bankName || ''}`,
    templateVariables,
  ).split('\n');
  const introRows: Array<{ row: number; value: string; bold?: boolean }> = [
    { row: 4, value: 'BÊN A (BÊN THUÊ DỊCH VỤ): {customerName}', bold: true },
    { row: 5, value: 'Địa chỉ: {customerAddress}' },
    { row: 6, value: 'Mã số thuế: {customerTaxCode}' },
    { row: 7, value: 'Đại diện bởi : {customerRepresentative}' },
    { row: 8, value: 'Chức vụ: {customerPosition}' },
    { row: 9, value: 'BÊN B (BÊN CUNG CẤP DỊCH VỤ): {issuerName}', bold: true },
    { row: 10, value: 'Địa chỉ: {issuerAddress}' },
    { row: 11, value: 'Mã số thuế: {issuerTaxCode}' },
    { row: 12, value: 'Đại diện bởi : {issuerRepresentative}' },
    { row: 13, value: 'Chức vụ: {issuerPosition}' },
    { row: 14, value: termsLines[0] ?? '- Số TK ' },
    { row: 15, value: termsLines[1] ?? '- Tại ngân hàng ' },
    { row: 16, value: 'Cùng thống nhất tiến hành đối chiếu sản lượng và doanh thu dịch vụ Bên B đã hoàn thành cung cấp/thực hiện cho Bên A như sau:' },
  ];
  for (const item of introRows) {
    const cell = ws.getCell(item.row, 1);
    cell.value = renderTemplateText(item.value, templateVariables);
    cell.font = item.bold ? boldFont : baseFont;
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };
  }

  const headerTop = 18;
  const headerBottom = 19;
  const quantityIndexes = cols
    .map((col, idx) => ({ col, idx: idx + 1 }))
    .filter(({ col }) => col.variable === 'container20Count' || col.variable === 'container40Count');
  const quantityStart = quantityIndexes.length > 0 ? Math.min(...quantityIndexes.map((x) => x.idx)) : 0;
  const quantityEnd = quantityIndexes.length > 0 ? Math.max(...quantityIndexes.map((x) => x.idx)) : 0;

  for (let c = 1; c <= nCols; c++) {
    const col = cols[c - 1];
    const label = renderDebitNoteColumnLabel(col);
    const isQuantityChild = col.variable === 'container20Count' || col.variable === 'container40Count';
    const topCell = ws.getCell(headerTop, c);
    const bottomCell = ws.getCell(headerBottom, c);
    if (isQuantityChild) {
      bottomCell.value = label;
    } else {
      topCell.value = label;
      ws.mergeCells(headerTop, c, headerBottom, c);
    }
  }
  if (quantityStart > 0 && quantityEnd >= quantityStart) {
    ws.mergeCells(headerTop, quantityStart, headerTop, quantityEnd);
    ws.getCell(headerTop, quantityStart).value = 'Số lượng';
  }

  for (let r = headerTop; r <= headerBottom; r++) {
    ws.getRow(r).height = 14.25;
    for (let c = 1; c <= nCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = boldFont;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: thinBlack };
    }
  }

  const firstDataRow = 20;
  let row = firstDataRow;
  const dataRows: number[] = [];
  for (const line of dataLines) {
    const r = row++;
    dataRows.push(r);
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const cell = ws.getCell(r, c + 1);
      const value = renderColumnValue(line, col, dataRows.length);
      widthSamples[c].push(value);
      cell.value = value;
      applyInferredColumnFormat(cell, value);
      cell.font = baseFont;
      cell.border = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: hairBlack };
      if (col.variable === 'amount') cell.numFmt = moneyFmt;
      if (col.variable === 'rowIndex' && r > firstDataRow) {
        cell.value = { formula: `A${r - 1}+1`, result: dataRows.length };
        cell.numFmt = '#,##0';
      }
    }
    ws.getRow(r).height = 27;
  }

  const subtotalRow = row++;
  const vatRow = row++;
  const grandRow = row++;
  const wordsRow = row++;

  if (nCols >= 6) {
    ws.mergeCells(subtotalRow, 1, subtotalRow, Math.min(6, nCols));
    ws.mergeCells(vatRow, 1, vatRow, Math.min(6, nCols));
    ws.mergeCells(grandRow, 1, grandRow, Math.min(6, nCols));
  }
  ws.getCell(subtotalRow, 1).value = 'CỘNG';
  ws.getCell(vatRow, 1).value = 'THUẾ GTGT 8%';
  ws.getCell(grandRow, 1).value = 'TỔNG THANH TOÁN';
  for (const { col, idx } of totalColumns) {
    const totalCell = ws.getCell(subtotalRow, idx);
    const result = dataLines.reduce((sum, line, dataIdx) => {
      const v = renderColumnValue(line, col, dataIdx + 1);
      return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
    totalCell.value = dataRows.length > 0
      ? { formula: `SUM(${colLetter(idx)}${dataRows[0]}:${colLetter(idx)}${dataRows[dataRows.length - 1]})`, result }
      : result;
    widthSamples[idx - 1]?.push(result);
    applyInferredColumnFormat(totalCell, result);
    if (col.variable === 'amount') totalCell.numFmt = moneyFmt;
  }
  if (amountIdx > 0) {
    ws.getCell(vatRow, amountIdx).value = { formula: `${colLetter(amountIdx)}${subtotalRow}*0.08` };
    ws.getCell(grandRow, amountIdx).value = { formula: `${colLetter(amountIdx)}${subtotalRow}+${colLetter(amountIdx)}${vatRow}` };
    ws.getCell(vatRow, amountIdx).numFmt = moneyFmt;
    ws.getCell(grandRow, amountIdx).numFmt = moneyFmt;
    widthSamples[amountIdx - 1]?.push(vatAmount, grandTotal);
  }

  ws.getCell(wordsRow, 1).value = renderTemplateText('Bằng chữ: {amountInWords}', templateVariables);
  if (nCols > 1) ws.mergeCells(wordsRow, 1, wordsRow, nCols);

  for (let r = subtotalRow; r <= wordsRow; r++) {
    ws.getRow(r).height = r === wordsRow ? 24.95 : 27;
    for (let c = 1; c <= nCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { ...boldFont, bold: r !== wordsRow ? true : false };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: r === wordsRow ? undefined : hairBlack };
    }
  }

  const signatureLabelRow = row++;
  const signatureHintRow = row++;
  const signatureNameRow = row + 3;
  row = signatureNameRow + 1;
  const leftEnd = nCols >= 11 ? 5 : Math.max(1, Math.floor(nCols / 2));
  const rightStart = nCols >= 11 ? 9 : Math.min(nCols, leftEnd + 1);
  const rightEnd = nCols >= 11 ? 11 : nCols;
  for (const r of [signatureLabelRow, signatureHintRow, signatureNameRow]) {
    if (leftEnd > 1) ws.mergeCells(r, 1, r, leftEnd);
    if (rightStart < rightEnd) ws.mergeCells(r, rightStart, r, rightEnd);
  }
  ws.getCell(signatureLabelRow, 1).value = officialIdentity?.signatures.leftLabel || snap.signatureLeftLabel?.trim() || '';
  ws.getCell(signatureLabelRow, rightStart).value = officialIdentity?.signatures.rightLabel || snap.signatureRightLabel?.trim() || '';
  ws.getCell(signatureHintRow, 1).value = '(Ký, họ tên)';
  ws.getCell(signatureHintRow, rightStart).value = '(Ký, họ tên, đóng dấu)';
  ws.getCell(signatureNameRow, 1).value = officialIdentity?.signatures.leftName || snap.signatureLeftName?.trim() || '';
  ws.getCell(signatureNameRow, rightStart).value = officialIdentity?.signatures.rightName || snap.signatureRightName?.trim() || '';
  for (const cell of [ws.getCell(signatureLabelRow, 1), ws.getCell(signatureLabelRow, rightStart)]) {
    cell.font = boldFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: thinBlack };
  }
  for (const cell of [ws.getCell(signatureHintRow, 1), ws.getCell(signatureHintRow, rightStart)]) {
    cell.font = { ...baseFont, italic: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  for (const cell of [ws.getCell(signatureNameRow, 1), ws.getCell(signatureNameRow, rightStart)]) {
    cell.font = boldFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getRow(signatureLabelRow).height = 24.95;
  ws.getRow(signatureHintRow).height = 18;
  ws.getRow(signatureNameRow).height = 24.95;

  for (let c = 0; c < cols.length; c++) {
    ws.getColumn(c + 1).width =
      VIETSUN_TABLE_WIDTH_BY_ID().get(cols[c].id) ??
      autoColumnWidth(renderDebitNoteColumnLabel(cols[c]), widthSamples[c] ?? []);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
