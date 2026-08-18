// Debit-note / payment-statement XLSX rendering — extracted from
// billing-document.service.ts (document CRUD/claim/domain logic stays there).
// Dependency direction: billing-export -> billing-document, one-way.
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq, inArray, or } from 'drizzle-orm';
import { canonicalFreightDescription } from '@tingting/shared';
import type {
  BillingDocument,
  BillingDocumentLine,
  BillingDocumentOfficialIdentitySnapshot,
  DebitNoteTemplate,
  DebitNoteTemplateColumn,
  DebitNoteTemplateSnapshot,
} from '@tingting/shared';
import { getCompanyInfo } from './company-info.service';
import { loadLogoBytes } from './lib/export-company';
import type { DbLike, OfficialBillingIdentitySnapshot } from './billing-document.service';
import {
  DEFAULT_DEBIT_NOTE_COLUMNS,
  loadCompanyInfoFromExecutor,
  loadContainersByTrip,
  loadLegRenderDataByTrip,
  DEFAULT_PAYMENT_STATEMENT_COLUMNS,
  buildTripRenderData,
  cloneTemplateSnapshot,
  containerNumbers,
  defaultSnapshotForType,
  effectiveAmount,
  expenseDocumentCode,
  extractOfficialIdentitySnapshot,
  normalizeTemplateColumns,
  splitRouteName,
  stripHonorifics,
  templateToSnapshot,
  trimIdentityValue,
} from './billing-document.service';

// Counterparty display info assembled for headers/footers of rendered exports.
type BillingPartyInfo = {
  name: string;
  address: string;
  taxCode: string;
  representative: string;
  representativeTitle: string;
  phone: string;
};

// Frozen template + optional persisted official identity (issued docs freeze
// issuer/counterparty so later company-data edits don't rewrite history).
type FrozenDebitNoteTemplateSnapshot = DebitNoteTemplateSnapshot & {
  officialIdentity?: OfficialBillingIdentitySnapshot | null;
};

// Fixed Vietsun statement table geometry (column id -> width/column def).
// Built lazily: billing-document ↔ billing-export sit on a pre-existing
// transitive import cycle (via statement/credit-limit/governance chain), and
// eager module-init read of DEFAULT_PAYMENT_STATEMENT_COLUMNS hits its TDZ
// when billing-document is still mid-initialization.
let vietsunColumnById: Map<string, DebitNoteTemplateColumn> | null = null;
let vietsunWidthById: Map<string, number> | null = null;
const VIETSUN_TABLE_COLUMN_BY_ID = () => (vietsunColumnById ??= new Map(DEFAULT_PAYMENT_STATEMENT_COLUMNS.map((col) => [col.id, col])));
const VIETSUN_TABLE_WIDTH_BY_ID = () => (vietsunWidthById ??= new Map(DEFAULT_PAYMENT_STATEMENT_COLUMNS.map((col) => [col.id, col.width])));
const SERVICE_FEE_EXPORT_LABELS: Record<string, string> = {
  LIFTING: 'Phí nâng container',
  LOWERING: 'Phí hạ container',
  CUSTOMS: 'Phí hải quan',
  INFRASTRUCTURE: 'Phí hạ tầng',
  WEIGHING: 'Phí cân hàng',
  INSPECTION: 'Phí kiểm hóa',
  INSPECTION_SVC: 'Phí dịch vụ kiểm hóa',
  OTHER: 'Phí chi hộ khác',
};

function exportDescription(line: BillingDocumentLine): string {
  const raw = line.description?.trim() ?? '';
  if (line.lineType !== 'SERVICE_FEE') return raw;
  return SERVICE_FEE_EXPORT_LABELS[raw.toUpperCase()] ?? raw;
}

function formatVietnameseDate(raw: string): string {
  const [year, month, day] = raw.split('-');
  if (!year || !month || !day) return raw;
  return `${day}/${month}/${year}`;
}

function formatMonthYear(raw: string): string {
  const [year, month] = raw.split('-');
  if (!year || !month) return raw;
  return `${month}.${year}`;
}

const VIETNAMESE_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const VIETNAMESE_TRIPLE_UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];

function readVietnameseTriple(value: number, forceHundreds: boolean): string {
  const hundred = Math.floor(value / 100);
  const ten = Math.floor((value % 100) / 10);
  const unit = value % 10;
  const parts: string[] = [];

  if (hundred > 0 || forceHundreds) {
    parts.push(`${VIETNAMESE_DIGITS[hundred]} trăm`);
  }

  if (ten > 1) {
    parts.push(`${VIETNAMESE_DIGITS[ten]} mươi`);
    if (unit === 1) parts.push('mốt');
    else if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(VIETNAMESE_DIGITS[unit]);
  } else if (ten === 1) {
    parts.push('mười');
    if (unit === 5) parts.push('lăm');
    else if (unit > 0) parts.push(VIETNAMESE_DIGITS[unit]);
  } else if (unit > 0) {
    if (hundred > 0 || forceHundreds) parts.push('lẻ');
    parts.push(VIETNAMESE_DIGITS[unit]);
  }

  return parts.join(' ');
}

function sentenceCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function amountToVietnameseWords(amount: number): string {
  const rounded = Math.round(amount);
  if (!Number.isFinite(rounded)) return '';
  if (rounded === 0) return 'Không đồng';

  const sign = rounded < 0 ? 'Âm ' : '';
  let remaining = Math.abs(rounded);
  const triples: number[] = [];
  while (remaining > 0) {
    triples.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const words: string[] = [];
  for (let idx = triples.length - 1; idx >= 0; idx--) {
    const triple = triples[idx];
    if (triple === 0) continue;
    const hasHigherGroup = words.length > 0;
    const text = readVietnameseTriple(triple, hasHigherGroup && triple < 100);
    const unit = VIETNAMESE_TRIPLE_UNITS[idx] ?? '';
    words.push(unit ? `${text} ${unit}` : text);
  }

  return `${sign}${sentenceCase(words.join(' '))} đồng`;
}

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

async function loadCounterpartyInfo(
  doc: BillingDocument,
  executor: DbLike = db,
  lockRows = false,
): Promise<BillingPartyInfo> {
  if (doc.entityType === 'CUSTOMER') {
    const query = executor.select({
      name: s.customers.name,
      taxCode: s.customers.taxCode,
      contactPerson: s.customers.contactPerson,
      contactInfo: s.customers.contactInfo,
      phone: s.customers.phone,
    }).from(s.customers).where(eq(s.customers.id, doc.entityId)).limit(1);
    const [customer] = await (lockRows ? query.for('share') : query);
    return {
      name: customer?.name ?? doc.entityName ?? '',
      address: customer?.contactInfo ?? '',
      taxCode: customer?.taxCode ?? '',
      representative: customer?.contactPerson ?? '',
      representativeTitle: 'Giám Đốc',
      phone: customer?.phone ?? '',
    };
  }

  const query = executor.select({
    name: s.suppliers.name,
    taxCode: s.suppliers.taxCode,
    contactPerson: s.suppliers.contactPerson,
    phone: s.suppliers.phone,
    note: s.suppliers.note,
  }).from(s.suppliers).where(eq(s.suppliers.id, doc.entityId)).limit(1);
  const [supplier] = await (lockRows ? query.for('share') : query);
  return {
    name: supplier?.name ?? doc.entityName ?? '',
    address: supplier?.note ?? '',
    taxCode: supplier?.taxCode ?? '',
    representative: supplier?.contactPerson ?? '',
    representativeTitle: 'Giám Đốc',
    phone: supplier?.phone ?? '',
  };
}

function applyOfficialIdentityToSnapshot(
  snapshot: DebitNoteTemplateSnapshot,
  officialIdentity: OfficialBillingIdentitySnapshot,
): FrozenDebitNoteTemplateSnapshot {
  return {
    ...cloneTemplateSnapshot(snapshot),
    officialIdentity: {
      issuer: { ...officialIdentity.issuer },
      counterparty: { ...officialIdentity.counterparty },
      signatures: { ...officialIdentity.signatures },
      captureMetadata: { ...officialIdentity.captureMetadata },
    },
  };
}

async function buildLiveRenderIdentity(
  doc: BillingDocument,
  snapshot: DebitNoteTemplateSnapshot,
  executor: DbLike = db,
  lockSourceRows = false,
): Promise<OfficialBillingIdentitySnapshot> {
  const [company, counterparty] = await Promise.all([
    loadCompanyInfoFromExecutor(executor, lockSourceRows),
    loadCounterpartyInfo(doc, executor, lockSourceRows),
  ]);
  const fallbackCompanyRepresentative = trimIdentityValue(company.representative);
  const snapshotRightName = trimIdentityValue(snapshot.signatureRightName);
  return {
    issuer: {
      name: trimIdentityValue(snapshot.issuerName) || trimIdentityValue(company.name),
      address: trimIdentityValue(snapshot.issuerAddress) || trimIdentityValue(company.address),
      taxCode: trimIdentityValue(snapshot.issuerTaxCode) || trimIdentityValue(company.taxCode),
      representative: trimIdentityValue(snapshot.issuerRepresentative) || fallbackCompanyRepresentative,
      representativeTitle: trimIdentityValue(company.representativeTitle),
      phone: trimIdentityValue(company.phone),
      bankAccount: trimIdentityValue(company.bankAccount),
      bankName: trimIdentityValue(company.bankName),
      email: trimIdentityValue(company.email),
      logoStorageKey: company.logoStorageKey ?? null,
    },
    counterparty: {
      entityType: doc.entityType,
      name: trimIdentityValue(counterparty.name) || trimIdentityValue(doc.entityName),
      address: trimIdentityValue(counterparty.address),
      taxCode: trimIdentityValue(counterparty.taxCode),
      representative: trimIdentityValue(counterparty.representative),
      representativeTitle: trimIdentityValue(counterparty.representativeTitle),
      phone: trimIdentityValue(counterparty.phone),
      contactInfo: trimIdentityValue(counterparty.address),
    },
    signatures: {
      leftLabel: trimIdentityValue(snapshot.signatureLeftLabel) || 'Khách hàng',
      leftName: trimIdentityValue(snapshot.signatureLeftName),
      rightLabel: trimIdentityValue(snapshot.signatureRightLabel) || 'Người lập',
      rightName: snapshotRightName || stripHonorifics(fallbackCompanyRepresentative),
    },
    captureMetadata: {
      mode: 'ISSUED_AT_TRANSITION',
      capturedAt: new Date().toISOString(),
    },
  };
}

export async function captureIssuedOfficialIdentitySnapshot(
  doc: BillingDocument,
  executor: DbLike = db,
): Promise<FrozenDebitNoteTemplateSnapshot> {
  const baseSnapshot = cloneTemplateSnapshot(
    doc.debitNoteTemplateSnapshot ?? defaultSnapshotForType(doc.type),
  );
  const officialIdentity = await buildLiveRenderIdentity(doc, baseSnapshot, executor, true);
  return applyOfficialIdentityToSnapshot(baseSnapshot, officialIdentity);
}

export async function resolveBillingDocumentIdentity(
  doc: BillingDocument,
  snapshot: DebitNoteTemplateSnapshot | null | undefined,
  executor: DbLike = db,
): Promise<OfficialBillingIdentitySnapshot | null> {
  if (doc.officialIdentitySnapshot) {
    return {
      issuer: { ...doc.officialIdentitySnapshot.issuer },
      counterparty: { ...doc.officialIdentitySnapshot.counterparty },
      signatures: { ...doc.officialIdentitySnapshot.signatures },
      captureMetadata: { ...doc.officialIdentitySnapshot.captureMetadata },
    };
  }
  const effectiveSnapshot = snapshot ?? doc.debitNoteTemplateSnapshot ?? defaultSnapshotForType(doc.type);
  const captured = extractOfficialIdentitySnapshot(effectiveSnapshot);
  if (captured) return captured;
  return buildLiveRenderIdentity(doc, effectiveSnapshot, executor);
}

function customerCode(name: string, fallback: number): string {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
  const words = normalized
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['CONG', 'TY', 'TNHH', 'MTV', 'CP', 'CO', 'LTD'].includes(word.toUpperCase()));
  const code = words.slice(0, 3).map((word) => word[0]?.toUpperCase()).join('');
  return code || String(fallback);
}

// Verbatim legacy renderer (pre-template). Kept move-only so the regression
// oracle holds: buildBillingXlsx(doc, null) delegates here and is byte-identical
// to pre-template output for BOTH DEBIT_NOTE and PAYMENT_STATEMENT docs.
export async function buildLegacyXlsx(doc: BillingDocument): Promise<Buffer> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  const company = await getCompanyInfo();
  wb.creator = company.name;
  wb.created = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet(doc.type === 'DEBIT_NOTE' ? 'Giấy báo nợ' : 'Bảng kê');
  const isDebitNote = doc.type === 'DEBIT_NOTE';
  const title = isDebitNote ? 'GIẤY BÁO NỢ' : 'BẢNG KÊ THANH TOÁN';
  const entityLabel = isDebitNote ? 'Khách hàng' : 'Đối tác';
  const tableStart = isDebitNote ? (doc.note ? 7 : 6) : (doc.note ? 6 : 5);
  const dataStart = tableStart + 1;

  ws.properties.defaultRowHeight = 22;
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2,
    },
  };
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 18, color: { argb: 'FF111827' } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 32;

  ws.mergeCells('A2:D2');
  ws.getCell('A2').value = `${entityLabel}: ${doc.entityName ?? ''}`;
  ws.getCell('A2').font = { name: 'Arial', bold: true, size: 12, color: { argb: 'FF111827' } };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells('A3:D3');
  ws.getCell('A3').value = `Kỳ: ${formatVietnameseDate(doc.rangeFrom)} - ${formatVietnameseDate(doc.rangeTo)}`;
  ws.getCell('A3').font = { name: 'Arial', size: 11, color: { argb: 'FF374151' } };
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };

  if (isDebitNote) {
    ws.mergeCells('A4:D4');
    ws.getCell('A4').value = doc.originalDueDate
      ? `Hạn hợp đồng: ${formatVietnameseDate(doc.originalDueDate)} · Ngày xử lý: ${formatVietnameseDate(doc.processingDueDate ?? doc.originalDueDate)}`
      : 'Hạn thanh toán: Chưa có dữ liệu lịch sử';
    ws.getCell('A4').font = { name: 'Arial', size: 10, color: { argb: 'FF374151' } };
    ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
  }

  if (doc.note) {
    const noteRow = isDebitNote ? 5 : 4;
    ws.mergeCells(noteRow, 1, noteRow, 4);
    ws.getCell(noteRow, 1).value = `Ghi chú: ${doc.note}`;
    ws.getCell(noteRow, 1).font = { name: 'Arial', italic: true, size: 10, color: { argb: 'FF4B5563' } };
    ws.getCell(noteRow, 1).alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    ws.getRow(noteRow).height = 30;
  }

  for (let r = 1; r <= 5; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  }

  const headerRow = ws.getRow(tableStart);
  headerRow.values = ['Diễn giải', 'Số cont', 'ĐVT', 'Số tiền (VNĐ)'];
  headerRow.height = 26;
  headerRow.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF1F2937' } },
      left: { style: 'thin', color: { argb: 'FF1F2937' } },
      bottom: { style: 'thin', color: { argb: 'FF1F2937' } },
      right: { style: 'thin', color: { argb: 'FF1F2937' } },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  });

  let rowIdx = dataStart;
  const amountRows: number[] = [];
  let lineIdx = 0;
  while (lineIdx < doc.lines.length) {
    const routeName = doc.lines[lineIdx]?.routeName ?? '';
    let groupEnd = lineIdx + 1;
    while (groupEnd < doc.lines.length && (doc.lines[groupEnd]?.routeName ?? '') === routeName) groupEnd += 1;
    const groupLines = doc.lines.slice(lineIdx, groupEnd).filter((line) => !line.excluded);
    lineIdx = groupEnd;
    if (groupLines.length === 0) continue;

    const subtotal = groupLines.reduce((sum, line) => sum + effectiveAmount(line), 0);
    const routeRow = ws.getRow(rowIdx++);
    routeRow.values = [
      `Tuyến: ${routeName || 'Chưa có tuyến'} (${groupLines.length} dòng)`,
      '',
      '',
      subtotal,
    ];
    ws.mergeCells(routeRow.number, 1, routeRow.number, 3);
    routeRow.height = 28;
    routeRow.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF123B2A' } };
    routeRow.alignment = { vertical: 'middle', wrapText: false };
    routeRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = {
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF5EF' } };
      if (colNumber === 4) {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });

    for (const line of groupLines) {
      const amt = effectiveAmount(line);
      const row = ws.getRow(rowIdx++);
      amountRows.push(row.number);
      row.values = [
        exportDescription(line),
        (line.containerNumbers ?? []).join(', '),
        line.unit,
        amt || 0,
      ];
      row.height = 24;
      row.font = { name: 'Arial', size: 10, color: { argb: 'FF111827' } };
      row.alignment = { vertical: 'middle', wrapText: false };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = {
          left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
          right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        };
        if (colNumber === 4) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      });
      if (line.lineType !== 'FREIGHT') {
        row.getCell(1).font = { name: 'Arial', italic: true, color: { argb: 'FF4B5563' } };
        row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } };
      }
      if (line.amountOverride != null && line.amountOverride !== line.baseAmount) {
        row.getCell(4).font = { name: 'Arial', bold: true, color: { argb: 'FF111827' } };
      }
    }
  }

  const formula = amountRows.length > 0 ? `SUM(${amountRows.map((row) => `D${row}`).join(',')})` : '0';
  const totalRow = ws.getRow(rowIdx + 1);
  totalRow.values = ['TỔNG CỘNG', '', '', {
    formula,
    result: doc.totalInclVat,
  }];
  ws.mergeCells(totalRow.number, 1, totalRow.number, 3);
  totalRow.height = 28;
  totalRow.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FF111827' } };
  totalRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.getCell(4).numFmt = '#,##0';
  totalRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF111827' } },
      bottom: { style: 'double', color: { argb: 'FF111827' } },
    };
  });

  ws.columns = [
    { width: 72 }, { width: 28 }, { width: 10 }, { width: 18 },
  ];
  ws.getColumn(1).alignment = { wrapText: false, vertical: 'middle' };
  ws.getColumn(2).alignment = { wrapText: false, vertical: 'middle' };
  ws.getColumn(3).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getColumn(4).numFmt = '#,##0';

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

// ─── Template-driven export ──────────────────────────────────────────────────

/** Convert a #RRGGBB (or RRGGBB) accent to an ExcelJS ARGB color string. */
function hexToArgb(hex: string): string {
  const h = (hex || '').replace('#', '').padStart(6, '0').slice(-6);
  return ('FF' + h).toUpperCase();
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

export function renderColumnValue(line: BillingDocumentLine, col: DebitNoteTemplateColumn, rowIndex: number): string | number | Date | null {
  const data = line.renderData ?? {};
  const routeParts = splitRouteName(line.routeName ?? '');
  const parseDateValue = (raw: string | null | undefined): string | Date | null => {
    if (!raw) return null;
    const [year, month, day] = String(raw).split('-').map(Number);
    const date = year && month && day
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(`${raw}T00:00:00`);
    return Number.isNaN(date.getTime()) ? String(raw) : date;
  };
  switch (col.variable) {
    case 'rowIndex': return rowIndex;
    case 'departureDate': return parseDateValue(data.departureDate);
    case 'deliveryDate': return parseDateValue(data.deliveryDate);
    case 'truckPlate': return data.truckPlate ?? null;
    case 'vehicleType': return data.vehicleType ?? null;
    case 'actionType': return data.actionType ?? null;
    case 'origin': return data.origin ?? routeParts?.origin ?? null;
    case 'destination': return data.destination ?? routeParts?.destination ?? line.routeName ?? null;
    case 'deliveryAddress': return data.deliveryAddress ?? null;
    case 'factoryName': return data.factoryName ?? null;
    case 'tradeDirectionLabel': return data.tradeDirectionLabel ?? null;
    case 'billNumber': return data.billNumber ?? null;
    case 'declarationNumber': return data.declarationNumber ?? null;
    case 'quantityLabel': return data.quantityLabel ?? null;
    case 'container20Count': return data.container20Count ?? null;
    case 'container40Count': return data.container40Count ?? null;
    case 'containerCount': return data.containerCount ?? (line.containerNumbers?.length || null);
    case 'containerNumbers': return (line.containerNumbers ?? []).join(', ') || null;
    case 'cargoVolumeCbm': return data.cargoVolumeCbm ?? null;
    case 'routeName': return line.routeName ?? null;
    case 'description': return exportDescription(line);
    case 'lineTypeLabel': return line.typeLabel;
    case 'unit': return line.unit;
    case 'amount': {
      const amount = effectiveAmount(line) || 0;
      if (col.id === 'don_gia') {
        const qty = Number(data.containerCount ?? line.containerNumbers?.length ?? 1);
        return qty > 1 ? Math.round(amount / qty) : amount;
      }
      return amount;
    }
    case 'deliveryFeeAmount': return data.deliveryFeeAmount ?? null;
    case 'freightAmount': return data.freightAmount ?? null;
    case 'portFeeAmount': return data.portFeeAmount ?? null;
    case 'otherServiceFeeAmount': return data.otherServiceFeeAmount ?? null;
    case 'fuelSurchargeAmount': return data.fuelSurchargeAmount ?? null;
    case 'serviceFeeAmount': return data.serviceFeeAmount ?? null;
    case 'totalAmount': return data.totalAmount ?? (effectiveAmount(line) || 0);
    case 'serviceFeeDescription': return data.serviceFeeDescription ?? null;
    case 'recoverableSupplierName': return data.recoverableSupplierName ?? null;
    case 'recoverableFeeType': return data.recoverableFeeType ?? null;
    case 'recoverableDocumentCode': return data.recoverableDocumentCode ?? null;
    case 'recoverableAmount': return data.recoverableAmount ?? null;
    case 'note': return data.note ?? null;
    case 'documentCode': return data.documentCode ?? null;
    case 'tripCode':
      return col.id === 'chung_tu'
        ? data.documentCode ?? null
        : data.tripCode ?? (line.sourceType === 'TRIP' ? String(line.sourceId ?? '') : null);
    default: return null;
  }
}

async function enrichLinesForDebitNoteRender(lines: BillingDocumentLine[]): Promise<BillingDocumentLine[]> {
  const normalizedLines = lines.map((line) => ({
    ...line,
    description: canonicalFreightDescription(line),
  }));
  const directTripIds = normalizedLines
    .filter((line) => line.sourceType === 'TRIP' && line.sourceId && !line.renderData)
    .map((line) => Number(line.sourceId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const expenseIds = Array.from(new Set(normalizedLines
    .filter((line) => line.sourceType === 'EXPENSE' && line.sourceId)
    .map((line) => Number(line.sourceId))
    .filter((id) => Number.isFinite(id) && id > 0)));

  const expenseTripRows = expenseIds.length > 0
    ? await db.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      declarationNumber: s.tripExpenses.declarationNumber,
    })
      .from(s.tripExpenses)
      .where(inArray(s.tripExpenses.id, expenseIds))
    : [];
  const expenseById = new Map(expenseTripRows.map((row) => [row.id, row]));
  const tripIds = Array.from(new Set([
    ...directTripIds,
    ...expenseTripRows.map((row) => row.tripId),
  ]));
  if (tripIds.length === 0 && expenseById.size === 0) return normalizedLines;

  const trips = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    fuelSurchargeAmount: s.trips.fuelSurchargeAmount,
    routeName: s.routes.name,
    notes: s.trips.notes,
    truckPlate: s.trucks.licensePlate,
    externalPlateNumber: s.trips.externalPlateNumber,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .where(inArray(s.trips.id, tripIds));
  const tripsById = new Map(trips.map((trip) => [trip.id, trip]));
  const containersByTrip = await loadContainersByTrip(tripIds);
  const legsByTrip = await loadLegRenderDataByTrip(tripIds);

  return normalizedLines.map((line) => {
    const expenseInfo = line.sourceType === 'EXPENSE' && line.sourceId
      ? expenseById.get(Number(line.sourceId))
      : undefined;
    const documentCode = expenseInfo ? expenseDocumentCode(expenseInfo) : null;
    if (line.renderData) {
      return {
        ...line,
        renderData: {
          ...line.renderData,
          documentCode: line.renderData.documentCode ?? documentCode,
        },
      };
    }
    if (!line.sourceId) return line;
    const tripId = line.sourceType === 'TRIP'
      ? Number(line.sourceId)
      : line.sourceType === 'EXPENSE'
        ? expenseInfo?.tripId
        : null;
    if (!tripId) return line;
    const trip = tripsById.get(tripId);
    if (!trip) return line;
    const containers = containersByTrip.get(trip.id) ?? [];
    const enrichedLine = {
      ...line,
      routeName: line.routeName ?? trip.routeName ?? null,
      containerNumbers: line.containerNumbers ?? containerNumbers(containers),
      renderData: buildTripRenderData({
        tripId: trip.id,
        trip,
        containers,
        legs: legsByTrip.get(trip.id),
        note: trip.notes ?? null,
      }),
    };
    return {
      ...enrichedLine,
      renderData: {
        ...enrichedLine.renderData,
        documentCode,
      },
    };
  });
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

/**
 * Public entry point. `null`/`undefined` template or a mismatched document type
 * delegates to the verbatim legacy renderer. A live template is snapshotted,
 * then rendered by renderTemplatedXlsx.
 */
export async function buildBillingXlsx(
  doc: BillingDocument,
  template?: DebitNoteTemplate | null,
): Promise<Buffer> {
  if (!template) return buildLegacyXlsx(doc);
  if (template.documentType !== doc.type) return buildLegacyXlsx(doc);
  return renderTemplatedXlsx(doc, templateToSnapshot(template));
}

async function renderDebitNoteXlsx(
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
