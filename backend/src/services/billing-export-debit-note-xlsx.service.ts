// Template-driven DEBIT_NOTE worksheet renderer: the Long Minh printable-row
// layout plus the fixed VTA-style vertical GBN sheet. Extracted from
// billing-export.service.ts verbatim (pure code movement); the templated
// renderer dispatches DEBIT_NOTE documents here.
import type { BillingDocument, BillingDocumentLine, DebitNoteTemplateSnapshot, DebitNoteTemplateColumn } from '@tingting/shared';
import { loadLogoBytes } from './lib/export-company';
import { DEFAULT_DEBIT_NOTE_COLUMNS, effectiveAmount, normalizeTemplateColumns } from './billing-document.service';
import {
  renderColumnValue,
  enrichLinesForDebitNoteRender,
  exportDescription,
  formatVietnameseDate,
  amountToVietnameseWords,
} from './billing-export-shared.service';
import { resolveBillingDocumentIdentity, customerCode } from './billing-export-identity.service';

/** Convert a #RRGGBB (or RRGGBB) accent to an ExcelJS ARGB color string. */
function hexToArgb(hex: string): string {
  const h = (hex || '').replace('#', '').padStart(6, '0').slice(-6);
  return ('FF' + h).toUpperCase();
}
type DebitNoteLineGroup = {
  key: string;
  label: string;
  first: BillingDocumentLine;
  lines: BillingDocumentLine[];
};

function debitNoteGroupKey(line: BillingDocumentLine): string {
  const data = line.renderData ?? {};
  return [
    data.tripCode ?? '',
    data.departureDate ?? '',
    line.routeName ?? '',
    (line.containerNumbers ?? []).join('|'),
  ].join('\u001f');
}

function debitNoteGroupLabel(line: BillingDocumentLine): string {
  const qty = Number(line.renderData?.containerCount ?? line.containerNumbers?.length ?? 1) || 1;
  const containerText = (line.containerNumbers ?? []).join(';');
  const unit = line.unit || 'cont';
  return `${String(qty).padStart(2, '0')}x${unit}${containerText ? ` ${containerText}` : ''}`;
}

function groupDebitNoteLines(lines: BillingDocumentLine[]): DebitNoteLineGroup[] {
  const groups: DebitNoteLineGroup[] = [];
  const byKey = new Map<string, DebitNoteLineGroup>();
  for (const line of lines) {
    const key = debitNoteGroupKey(line);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: debitNoteGroupLabel(line), first: line, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups;
}

const LONG_MINH_CONTINUATION_VARIABLES = new Set<DebitNoteTemplateColumn['variable']>([
  'rowIndex',
  'factoryName',
  'tradeDirectionLabel',
  'billNumber',
  'declarationNumber',
  'quantityLabel',
  'vehicleType',
  'truckPlate',
  'cargoVolumeCbm',
  'deliveryDate',
  'routeName',
  'deliveryFeeAmount',
  'freightAmount',
  'portFeeAmount',
  'otherServiceFeeAmount',
  'fuelSurchargeAmount',
]);

type LongMinhDebitGroup = {
  representativeLine: BillingDocumentLine;
  tripLine: BillingDocumentLine | null;
  serviceLines: BillingDocumentLine[];
  recoverableLines: BillingDocumentLine[];
};

type LongMinhPrintableRow = {
  displayIndex: number | null;
  representativeLine: BillingDocumentLine;
  recoverableLine: BillingDocumentLine | null;
  serviceAmounts: {
    deliveryFeeAmount: number;
    freightAmount: number;
    portFeeAmount: number;
    otherServiceFeeAmount: number;
    fuelSurchargeAmount: number;
  };
  continuation: boolean;
};

function isLongMinhDebitTemplate(cols: readonly DebitNoteTemplateColumn[]): boolean {
  const variables = new Set(cols.map((col) => col.variable));
  return cols.some((col) => col.headerGroup != null)
    && variables.has('deliveryDate')
    && variables.has('quantityLabel')
    && variables.has('recoverableAmount');
}

function longMinhGroupKey(line: BillingDocumentLine): string {
  const data = line.renderData ?? {};
  const stableTripIdentity = data.tripCode?.trim()
    ? `trip-code:${data.tripCode.trim()}`
    : line.sourceType === 'TRIP' && line.sourceId != null
      ? `trip:${line.sourceId}`
      : `route:${line.routeName ?? ''}`;
  if (!stableTripIdentity.startsWith('route:')) return stableTripIdentity;
  return [
    stableTripIdentity,
    data.departureDate ?? '',
    (line.containerNumbers ?? []).join('|'),
  ].join('\u001f');
}

function sumLongMinhServiceAmounts(lines: readonly BillingDocumentLine[]) {
  const amounts = {
    deliveryFeeAmount: 0,
    freightAmount: 0,
    portFeeAmount: 0,
    otherServiceFeeAmount: 0,
    fuelSurchargeAmount: 0,
  };
  for (const line of lines) {
    const data = line.renderData ?? {};
    amounts.deliveryFeeAmount += Number(data.deliveryFeeAmount ?? 0);
    amounts.freightAmount += Number(data.freightAmount ?? (line.lineType === 'FREIGHT' ? effectiveAmount(line) : 0));
    amounts.portFeeAmount += Number(data.portFeeAmount ?? 0);
    amounts.otherServiceFeeAmount += Number(data.otherServiceFeeAmount ?? 0);
    amounts.fuelSurchargeAmount += Number(data.fuelSurchargeAmount ?? 0);
    if (
      line.lineType !== 'FREIGHT'
      && line.sourceType !== 'EXPENSE'
      && Number(data.deliveryFeeAmount ?? 0) === 0
      && Number(data.portFeeAmount ?? 0) === 0
      && Number(data.otherServiceFeeAmount ?? 0) === 0
      && Number(data.fuelSurchargeAmount ?? 0) === 0
      && Number(data.freightAmount ?? 0) === 0
    ) {
      amounts.otherServiceFeeAmount += effectiveAmount(line);
    }
  }
  return amounts;
}

function buildLongMinhPrintableRows(lines: readonly BillingDocumentLine[]): LongMinhPrintableRow[] {
  const groups: LongMinhDebitGroup[] = [];
  const byKey = new Map<string, LongMinhDebitGroup>();
  for (const line of lines) {
    const key = longMinhGroupKey(line);
    let group = byKey.get(key);
    if (!group) {
      group = {
        representativeLine: line,
        tripLine: null,
        serviceLines: [],
        recoverableLines: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    if (!group.tripLine && line.sourceType === 'TRIP') {
      group.tripLine = line;
      group.representativeLine = line;
    }
    if (line.sourceType === 'EXPENSE' || Number(line.renderData?.recoverableAmount ?? 0) > 0) {
      group.recoverableLines.push(line);
    } else {
      group.serviceLines.push(line);
    }
  }

  return groups.flatMap<LongMinhPrintableRow>((group, index) => {
    const representativeLine = group.tripLine ?? group.representativeLine;
    const serviceAmounts = sumLongMinhServiceAmounts(group.serviceLines.length > 0 ? group.serviceLines : [representativeLine]);
    if (group.recoverableLines.length === 0) {
      return [{
        displayIndex: index + 1,
        representativeLine,
        recoverableLine: null,
        serviceAmounts,
        continuation: false,
      }];
    }
    return group.recoverableLines.map((recoverableLine, recoverableIndex) => ({
      displayIndex: recoverableIndex === 0 ? index + 1 : null,
      representativeLine,
      recoverableLine,
      serviceAmounts,
      continuation: recoverableIndex > 0,
    }));
  });
}

async function renderLongMinhDebitXlsx(
  doc: BillingDocument,
  snap: DebitNoteTemplateSnapshot,
): Promise<Buffer> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  const officialIdentity = await resolveBillingDocumentIdentity(doc, snap);
  const issuer = officialIdentity?.issuer ?? null;
  const partner = officialIdentity?.counterparty ?? null;
  wb.creator = issuer?.name || '';
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet('Long Minh Debit');
  const columns = normalizeTemplateColumns(snap.columns, 'DEBIT_NOTE').filter((col) => col.width > 0);
  const printableRows = buildLongMinhPrintableRows((await enrichLinesForDebitNoteRender(doc.lines)).filter((line) => !line.excluded));
  const headerTopRow = 15;
  const headerBottomRow = 16;
  const firstDataRow = 17;
  const lastColumn = columns.length;
  const moneyFmt = '#,##0';

  ws.properties.defaultRowHeight = 18;
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  columns.forEach((column, index) => {
    ws.getColumn(index + 1).width = Math.max(4, Math.min(36, column.width));
  });

  ws.mergeCells(7, 1, 7, lastColumn);
  ws.getCell(7, 1).value = snap.titleText || 'BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH';
  ws.getCell(7, 1).font = { name: 'Tahoma', size: 12, bold: true };
  ws.getCell(7, 1).alignment = { horizontal: 'center', vertical: 'middle' };

  ws.getCell(9, 1).value = 'Đơn vị phát hành';
  ws.getCell(9, 2).value = issuer?.name || '';
  ws.getCell(10, 1).value = 'Địa chỉ';
  ws.getCell(10, 2).value = issuer?.address || '';
  ws.getCell(11, 1).value = 'Khách hàng';
  ws.getCell(11, 2).value = partner?.name || doc.entityName || '';
  ws.getCell(12, 1).value = 'Kỳ đối soát';
  ws.getCell(12, 2).value = `${formatVietnameseDate(doc.rangeFrom)} - ${formatVietnameseDate(doc.rangeTo)}`;
  ws.getCell(13, 1).value = 'Điều khoản';
  ws.getCell(13, 2).value = snap.termsText || 'Theo mẫu Long Minh đã cấu hình';
  for (let row = 9; row <= 13; row++) {
    ws.getCell(row, 1).font = { name: 'Tahoma', size: 10, bold: true };
    ws.getCell(row, 2).font = { name: 'Tahoma', size: 10 };
    ws.getCell(row, 2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  }

  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]!;
    const cellTop = ws.getCell(headerTopRow, index + 1);
    const cellBottom = ws.getCell(headerBottomRow, index + 1);
    if (column.headerGroup) {
      cellBottom.value = column.label;
    } else {
      cellTop.value = column.label;
      ws.mergeCells(headerTopRow, index + 1, headerBottomRow, index + 1);
    }
  }
  let index = 0;
  while (index < columns.length) {
    const headerGroup = columns[index]!.headerGroup;
    if (!headerGroup) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < columns.length && columns[end + 1]!.headerGroup === headerGroup) end += 1;
    ws.mergeCells(headerTopRow, index + 1, headerTopRow, end + 1);
    ws.getCell(headerTopRow, index + 1).value = headerGroup;
    index = end + 1;
  }
  for (let row = headerTopRow; row <= headerBottomRow; row++) {
    for (let col = 1; col <= lastColumn; col++) {
      const cell = ws.getCell(row, col);
      cell.font = { name: 'Tahoma', size: 10, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
    }
  }

  printableRows.forEach((row, rowIndex) => {
    const excelRow = firstDataRow + rowIndex;
    columns.forEach((column, columnIndex) => {
      const cell = ws.getCell(excelRow, columnIndex + 1);
      let value: string | number | Date | null;
      if (row.continuation && LONG_MINH_CONTINUATION_VARIABLES.has(column.variable)) {
        value = null;
      } else if (column.variable === 'rowIndex') {
        value = row.displayIndex;
      } else if (column.variable === 'deliveryFeeAmount') {
        value = row.continuation ? null : row.serviceAmounts.deliveryFeeAmount || null;
      } else if (column.variable === 'freightAmount') {
        value = row.continuation ? null : row.serviceAmounts.freightAmount || null;
      } else if (column.variable === 'portFeeAmount') {
        value = row.continuation ? null : row.serviceAmounts.portFeeAmount || null;
      } else if (column.variable === 'otherServiceFeeAmount') {
        value = row.continuation ? null : row.serviceAmounts.otherServiceFeeAmount || null;
      } else if (column.variable === 'fuelSurchargeAmount') {
        value = row.continuation ? null : row.serviceAmounts.fuelSurchargeAmount || null;
      } else if (column.variable === 'recoverableSupplierName') {
        value = renderColumnValue(row.recoverableLine ?? row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      } else if (column.variable === 'recoverableFeeType') {
        value = renderColumnValue(row.recoverableLine ?? row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      } else if (column.variable === 'recoverableDocumentCode') {
        value = renderColumnValue(row.recoverableLine ?? row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      } else if (column.variable === 'recoverableAmount') {
        value = row.recoverableLine ? effectiveAmount(row.recoverableLine) : null;
      } else {
        value = renderColumnValue(row.representativeLine, column, row.displayIndex ?? rowIndex + 1);
      }
      cell.value = value;
      cell.font = { name: 'Tahoma', size: 10 };
      cell.alignment = {
        horizontal: column.align === 'right' ? 'right' : column.align === 'left' ? 'left' : 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
      };
      if (column.format === 'currency' || column.format === 'number') {
        cell.numFmt = moneyFmt;
      } else if (value instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy';
      }
    });
  });

  const serviceSubtotal = doc.lines
    .filter((line) => !line.excluded && line.sourceType !== 'EXPENSE')
    .reduce((sum, line) => sum + effectiveAmount(line), 0);
  const recoverableSubtotal = doc.lines
    .filter((line) => !line.excluded && line.sourceType === 'EXPENSE')
    .reduce((sum, line) => sum + effectiveAmount(line), 0);
  const grandTotal = Number(doc.totalGross ?? doc.totalInclVat ?? 0);
  const vatAmount = Number(doc.totalTax ?? 0);
  const documentAdjustment = Math.max(0, Number(doc.totalNet ?? 0) - serviceSubtotal - recoverableSubtotal);
  const summaryStartRow = firstDataRow + printableRows.length + 1;
  const labelColumn = Math.max(1, lastColumn - 4);
  const valueColumn = lastColumn;
  const summaryRows: Array<[string, number]> = [
    ['Tổng phí dịch vụ', serviceSubtotal],
    ['Tổng phí chi hộ', recoverableSubtotal],
    ['VAT đã bao gồm trong các dòng', vatAmount],
    ['Điều chỉnh khác theo chứng từ', documentAdjustment],
    ['Tổng thanh toán', grandTotal],
  ];
  summaryRows.forEach(([label, amount], offset) => {
    const row = summaryStartRow + offset;
    ws.mergeCells(row, labelColumn, row, valueColumn - 1);
    ws.getCell(row, labelColumn).value = label;
    ws.getCell(row, labelColumn).font = { name: 'Tahoma', size: 10, bold: true };
    ws.getCell(row, labelColumn).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getCell(row, valueColumn).value = amount;
    ws.getCell(row, valueColumn).font = { name: 'Tahoma', size: 10, bold: true };
    ws.getCell(row, valueColumn).alignment = { horizontal: 'right', vertical: 'middle' };
    ws.getCell(row, valueColumn).numFmt = moneyFmt;
  });

  const wordsRow = summaryStartRow + summaryRows.length + 1;
  ws.mergeCells(wordsRow, 1, wordsRow, lastColumn);
  ws.getCell(wordsRow, 1).value = `Bằng chữ: ${amountToVietnameseWords(grandTotal)}`;
  ws.getCell(wordsRow, 1).font = { name: 'Tahoma', size: 10, italic: true };

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
export async function renderDebitNoteXlsx(
  doc: BillingDocument,
  snap: DebitNoteTemplateSnapshot,
): Promise<Buffer> {
  if (isLongMinhDebitTemplate(snap.columns)) {
    return renderLongMinhDebitXlsx(doc, snap);
  }
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  const officialIdentity = await resolveBillingDocumentIdentity(doc, snap);
  const issuer = officialIdentity?.issuer ?? null;
  const partner = officialIdentity?.counterparty ?? null;
  const signatures = officialIdentity?.signatures ?? null;
  wb.creator = issuer?.name || '';
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet('GBN');
  const lines = await enrichLinesForDebitNoteRender(doc.lines);
  const dataLines = lines.filter((line) => !line.excluded);
  const lineGroups = groupDebitNoteLines(dataLines);
  const totalAmount = dataLines.reduce((sum, line) => sum + effectiveAmount(line), 0);
  const moneyFmt = '#,##0';
  const baseFont = { name: 'Tahoma', size: 10, color: { argb: 'FF000000' } };
  const boldFont = { ...baseFont, bold: true };
  const templateGrayFont = { ...baseFont, color: { argb: 'FF969696' } };
  const labelFont = { ...templateGrayFont, bold: true };
  const grayFont = { ...baseFont, color: { argb: 'FF808080' } };
  const thinGray = { style: 'thin' as const, color: { argb: 'FFD8DCE3' } };
  const thinBlack = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const tableBorder = { top: thinBlack, left: thinBlack, right: thinBlack, bottom: thinBlack };
  const accent = hexToArgb(snap.accentColor || '#00A651');
  const dataStartRow = 16;
  const minTotalRow = 61;
  const renderedDataRowCount = lineGroups.reduce((sum, group) => sum + 1 + group.lines.length, 0);
  const totalRow = Math.max(minTotalRow, dataStartRow + renderedDataRowCount);
  const wordsRow = totalRow + 1;
  const exchangeRow = totalRow + 3;
  const bankTop = totalRow + 4;
  const sheetRows = Math.max(70, bankTop + 5);

  const parseDateOnly = (raw: string | null | undefined): Date | string | null => {
    if (!raw) return null;
    const [year, month, day] = String(raw).split('-').map(Number);
    if (!year || !month || !day) return raw;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(parsed.getTime()) ? raw : parsed;
  };
  const splitAddress = (raw: string | null | undefined): [string, string] => {
    const value = (raw || '').replace(/^Số\s+/i, '').replace(/,\s*Việt Nam$/i, '').trim();
    if (!value) return ['', ''];
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) return [value, ''];
    const midpoint = Math.ceil(parts.length / 2);
    return [parts.slice(0, midpoint).join(', '), parts.slice(midpoint).join(', ')];
  };
  const splitCompanyAddress = (raw: string | null | undefined): [string, string] => {
    const value = (raw || '').replace(/^Số\s+/i, '').replace(/,\s*Việt Nam$/i, '').trim();
    if (!value) return ['', ''];
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    const city = (parts.pop() ?? '').replace(/^Thành phố/i, 'Thành Phố');
    const ward = parts.pop() ?? '';
    const street = parts.join(', ');
    const district = value.toLowerCase().includes('quận ngô quyền') ? '' : 'quận Ngô Quyền';
    return [
      [street, ward].filter(Boolean).join(', ') || value,
      [district, city].filter(Boolean).join(', '),
    ];
  };

  ws.properties.defaultRowHeight = 15;
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: false,
    margins: { left: 0, right: 0, top: 0.5, bottom: 0.25, header: 0.3, footer: 0.3 },
  };

  const columnWidths = [2, 10.5, 14.33, 36.5, 7.5, 8.66, 10.16, 12.5];
  columnWidths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
  for (let r = 1; r <= sheetRows; r++) {
    if (r === 15) ws.getRow(r).height = 28;
    for (let c = 1; c <= 8; c++) {
      ws.getCell(r, c).font = baseFont;
    }
  }
  ws.getRow(1).height = 15;
  ws.getRow(6).height = 10.5;
  ws.getRow(7).height = 18;
  ws.getRow(8).height = 9;
  ws.getRow(10).height = 15;

  ws.mergeCells('B1:C5');
  ws.mergeCells('D1:H1');
  ws.mergeCells('D2:H2');
  ws.mergeCells('E3:H3');
  ws.mergeCells('E4:H4');
  ws.mergeCells('E5:H5');
  const logoCell = ws.getCell('B1');
  const logoBytes = await loadLogoBytes(issuer?.logoStorageKey ?? null);
  if (logoBytes) {
    const imageId = wb.addImage({ base64: logoBytes.toString('base64'), extension: 'png' });
    ws.addImage(imageId, { tl: { col: 1.01, row: 0 }, ext: { width: 383, height: 126 } });
  } else {
    logoCell.value = issuer?.name || '';
    logoCell.font = { name: 'Arial', size: 24, bold: true, color: { argb: accent } };
    logoCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  }

  const [companyAddress1, companyAddress2] = splitCompanyAddress(issuer?.address);
  ws.getCell('D1').value = issuer?.name || '';
  ws.getCell('D1').font = { ...boldFont, size: 12 };
  ws.getCell('D2').value = companyAddress1 || issuer?.address || '';
  ws.getCell('E3').value = companyAddress2;
  ws.getCell('E4').value = issuer?.phone ? `ĐT: ${issuer.phone}` : '';
  ws.getCell('E5').value = issuer?.email ? `E-mail: ${issuer.email}` : '';
  for (const addressCell of ['D1', 'D2', 'E3', 'E4', 'E5']) {
    ws.getCell(addressCell).font = addressCell === 'D1'
      ? { ...boldFont, size: 12 }
      : addressCell === 'E4' || addressCell === 'E5'
        ? { ...templateGrayFont, bold: true }
        : boldFont;
    ws.getCell(addressCell).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
  }

  ws.mergeCells('B7:D7');
  ws.getCell(7, 2).value = 'GIẤY BÁO NỢ';
  ws.getCell(7, 2).font = { name: 'Tahoma', size: 14, bold: true, color: { argb: 'FF7A7F87' } };
  ws.getCell(7, 2).alignment = { horizontal: 'left', vertical: 'middle' };

  const noticeNo = doc.note?.trim() || `${customerCode(partner?.name || '', doc.entityId)}${doc.rangeTo.replaceAll('-', '').slice(2)}`;
  ws.mergeCells('C9:D9');
  ws.mergeCells('C10:D10');
  ws.mergeCells('C11:D11');
  ws.mergeCells('C12:D12');
  ws.mergeCells('C13:D13');
  ws.mergeCells('F9:H9');
  ws.mergeCells('E10:H10');
  ws.mergeCells('E11:H11');
  ws.mergeCells('E12:H12');
  ws.mergeCells('E13:H13');
  const leftMeta = [
    ['Số :', noticeNo],
    ['Ngày tháng:', parseDateOnly(doc.rangeTo)],
    ['Mã khách:', customerCode(partner?.name || '', doc.entityId)],
    ['Hạn hợp đồng:', doc.originalDueDate ? parseDateOnly(doc.originalDueDate) : 'Chưa có dữ liệu lịch sử'],
    ['Ngày xử lý:', doc.processingDueDate ? parseDateOnly(doc.processingDueDate) : 'Chưa có dữ liệu lịch sử'],
  ];
  leftMeta.forEach(([label, value], index) => {
    const row = 9 + index;
    ws.getCell(row, 2).value = label;
    ws.getCell(row, 2).font = labelFont;
    ws.getCell(row, 3).value = value;
    ws.getCell(row, 3).font = row === 9 ? boldFont : baseFont;
    ws.getCell(row, 3).alignment = { horizontal: 'left', vertical: 'middle' };
    if (value instanceof Date) ws.getCell(row, 3).numFmt = 'd/m/yy';
  });

  const [partnerAddress1, partnerAddress2] = splitAddress(partner?.address);
  ws.getCell('E9').value = 'Gửi tới:';
  ws.getCell('E9').font = labelFont;
  ws.getCell('F9').value = [partner?.representative || 'Phòng kế toán', partner?.phone ? `(${partner.phone})` : ''].filter(Boolean).join(' ');
  ws.getCell(10, 5).value = partner?.name || '';
  ws.getCell(10, 5).font = boldFont;
  ws.getCell(11, 5).value = partnerAddress1;
  ws.getCell(12, 5).value = partnerAddress2;
  ws.getCell(13, 5).value = partner?.taxCode ? `MST : ${partner.taxCode}` : 'MST :';

  const tableHeaderRow = 15;
  const fixedHeaders = ['Ngày tháng', 'Số \nchứng từ', 'Diễn giải', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền'];
  fixedHeaders.forEach((header, index) => {
    const cell = ws.getCell(tableHeaderRow, index + 2);
    cell.value = header;
    cell.font = boldFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = tableBorder;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  });

  for (let r = dataStartRow; r < totalRow; r++) {
    for (let c = 2; c <= 8; c++) {
      const cell = ws.getCell(r, c);
      cell.border = tableBorder;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
  }

  let row = dataStartRow;
  const dataRows: number[] = [];
  for (const group of lineGroups) {
    const groupRow = row++;
    const departureDate = renderColumnValue(group.first, DEFAULT_DEBIT_NOTE_COLUMNS[0], dataRows.length + 1);
    ws.getCell(groupRow, 2).value = departureDate;
    ws.getCell(groupRow, 2).font = baseFont;
    ws.getCell(groupRow, 2).alignment = { horizontal: 'center', vertical: 'middle' };
    if (departureDate instanceof Date) ws.getCell(groupRow, 2).numFmt = 'd/m/yy';
    ws.getCell(groupRow, 4).value = group.label;
    ws.getCell(groupRow, 4).font = boldFont;
    ws.getCell(groupRow, 4).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

    for (const line of group.lines) {
      const r = row++;
      dataRows.push(r);
      const amount = effectiveAmount(line);
      const quantity = Number(line.renderData?.containerCount ?? line.containerNumbers?.length ?? 1) || 1;
      const unitPrice = quantity > 1 ? Math.round(amount / quantity) : amount;
      ws.getCell(r, 3).value = line.renderData?.documentCode ?? null;
      ws.getCell(r, 4).value = exportDescription(line);
      ws.getCell(r, 5).value = line.unit || 'cont';
      ws.getCell(r, 6).value = quantity;
      ws.getCell(r, 7).value = unitPrice;
      ws.getCell(r, 8).value = { formula: `G${r}*F${r}`, result: amount };
      ws.getCell(r, 3).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(r, 4).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
      ws.getCell(r, 5).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(r, 6).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getCell(r, 7).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      ws.getCell(r, 8).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
      ws.getCell(r, 7).numFmt = moneyFmt;
      ws.getCell(r, 8).numFmt = moneyFmt;
    }
  }

  ws.mergeCells(totalRow, 2, totalRow, 5);
  ws.mergeCells(totalRow, 6, totalRow, 7);
  ws.getCell(totalRow, 2).value = `Lưu ý: ${snap.termsText || 'Vui lòng ghi số tham chiếu giấy báo nợ này trong chứng từ thanh toán'}`;
  ws.getCell(totalRow, 2).font = grayFont;
  ws.getCell(totalRow, 6).value = 'Tổng cộng';
  ws.getCell(totalRow, 6).font = boldFont;
  ws.getCell(totalRow, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell(totalRow, 8).value = { formula: `SUM(H${dataStartRow}:H${totalRow - 1})`, result: totalAmount };
  ws.getCell(totalRow, 8).numFmt = moneyFmt;
  ws.getCell(totalRow, 8).font = boldFont;
  ws.getCell(totalRow, 8).alignment = { horizontal: 'right', vertical: 'middle' };
  for (let c = 2; c <= 8; c++) {
    ws.getCell(totalRow, c).border = tableBorder;
  }

  ws.getCell(wordsRow, 2).value = 'Bằng chữ:';
  ws.getCell(wordsRow, 2).font = { ...boldFont, color: { argb: 'FF808080' } };
  ws.mergeCells(wordsRow, 3, wordsRow, 8);
  ws.getCell(wordsRow, 3).value = amountToVietnameseWords(totalAmount);
  ws.getCell(wordsRow, 3).font = { ...boldFont, italic: true };

  ws.getCell(exchangeRow, 2).value = 'Tỷ giá USD/VN : ';
  ws.getCell(exchangeRow, 2).font = grayFont;

  ws.mergeCells(bankTop, 2, bankTop, 5);
  ws.mergeCells(bankTop, 7, bankTop, 8);
  const bankHeader = ws.getCell(bankTop, 2);
  bankHeader.value = 'THÔNG TIN CHUYỂN KHOẢN';
  bankHeader.font = boldFont;
  bankHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
  bankHeader.border = tableBorder;
  ws.getCell(bankTop, 7).value = snap.signatureRightLabel || 'Người lập';
  ws.getCell(bankTop, 7).font = boldFont;
  ws.getCell(bankTop, 7).alignment = { horizontal: 'center', vertical: 'middle' };

  const bankRows = [
    ['Tên tài khoản:', issuer?.name || ''],
    ['Số tài khoản:', issuer?.bankAccount || ''],
    ['Ngân hàng:', issuer?.bankName || ''],
  ];
  bankRows.forEach(([label, value], index) => {
    const r = bankTop + index + 1;
    ws.mergeCells(r, 4, r, 8);
    ws.getCell(r, 2).value = label;
    ws.getCell(r, 2).font = { ...boldFont, color: { argb: 'FF808080' } };
    ws.getCell(r, 4).value = value;
    ws.getCell(r, 4).font = boldFont;
  });

  const signatureNameRow = bankTop + 4;
  if (signatureNameRow <= sheetRows) {
    ws.mergeCells(signatureNameRow, 7, signatureNameRow, 8);
    ws.getCell(signatureNameRow, 7).value = signatures?.rightName || '';
    ws.getCell(signatureNameRow, 7).font = boldFont;
    ws.getCell(signatureNameRow, 7).alignment = { horizontal: 'center', vertical: 'middle' };
  }

  for (let r = bankTop; r <= bankTop + 3; r++) {
    for (let c = 2; c <= 5; c++) {
      ws.getCell(r, c).border = { top: thinGray, left: thinBlack, right: thinBlack, bottom: thinGray };
    }
  }

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
