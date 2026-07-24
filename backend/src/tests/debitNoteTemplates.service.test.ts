import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../db';
import {
  buildBillingXlsx,
  renderTemplatedXlsx,
  templateToSnapshot,
} from '../services/billingDocument.service';
import { defaultDebitNoteColumns, defaultPaymentStatementColumns } from '@tingting/shared';
import type {
  BillingDocument,
  BillingDocumentLine,
  DebitNoteTemplate,
  DebitNoteTemplateColumn,
  DebitNoteTemplateSnapshot,
} from '@tingting/shared';

const line = (over: Partial<BillingDocumentLine>): BillingDocumentLine => ({
  sourceType: 'TRIP', sourceId: 1, lineType: 'FREIGHT', typeLabel: 'Doanh thu', unit: 'lần',
  description: 'Cước vận chuyển — HCM - Bình Dương', routeName: 'HCM - Bình Dương',
  containerNumbers: ['ABCD1234567'], baseAmount: 5_000_000, amountOverride: null,
  excluded: false, sortOrder: 0, ...over,
});

const baseDoc: BillingDocument = {
  id: 1, type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: 10, entityName: 'Công ty ABC',
  rangeFrom: '2026-06-01', rangeTo: '2026-06-30', note: null, totalInclVat: 5_000_000,
  createdBy: null, createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z',
  debitNoteTemplateId: null, debitNoteTemplateSnapshot: null, lines: [line({})],
};
const debitDoc = baseDoc;
const paymentDoc: BillingDocument = { ...baseDoc, type: 'PAYMENT_STATEMENT', entityType: 'VENDOR', entityName: 'NCC X' };

after(async () => {
  await client.end();
});

const columns: DebitNoteTemplateColumn[] = [
  { id: 'desc', label: 'Diễn giải', variable: 'description', width: 40, align: 'left', format: 'text', total: false },
  { id: 'cont', label: 'Số cont', variable: 'containerNumbers', width: 18, align: 'left', format: 'text', total: false },
  { id: 'unit', label: 'ĐVT', variable: 'unit', width: 10, align: 'center', format: 'text', total: false },
  { id: 'amount', label: 'Số tiền', variable: 'amount', width: 16, align: 'right', format: 'currency', total: true },
];

const defaultSnapshot: DebitNoteTemplateSnapshot = {
  id: 1, name: 'Mặc định', titleText: 'GIẤY BÁO NỢ',
  issuerName: null, issuerAddress: null, issuerTaxCode: null,
  accentColor: '#1F4E79', showContainerColumn: true, showUnitColumn: true, groupingMode: 'ROUTE',
  columns,
  orientation: 'landscape', termsText: null,
  signatureLeftLabel: 'Khách hàng', signatureLeftName: null,
  signatureRightLabel: 'Kế toán trưởng', signatureRightName: null,
};

const paymentSnapshot: DebitNoteTemplateSnapshot = {
  ...defaultSnapshot,
  titleText: 'BẢNG KÊ CƯỚC VẬN CHUYỂN',
};

// XLSX is a ZIP archive → starts with the PK\x03\x04 magic.
function isXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

async function loadWorkbook(buf: Buffer) {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  await (wb.xlsx.load as (data: unknown) => Promise<unknown>)(buf);
  return wb;
}

test('buildBillingXlsx(null template) → valid xlsx for DEBIT_NOTE (legacy path)', async () => {
  const buf = await buildBillingXlsx(debitDoc, null);
  assert.ok(isXlsx(buf), 'should produce a zip/xlsx buffer');
});

test('buildBillingXlsx(null template) → valid xlsx for PAYMENT_STATEMENT legacy fallback', async () => {
  const buf = await buildBillingXlsx(paymentDoc, null);
  assert.ok(isXlsx(buf), 'payment statement fallback should produce a valid xlsx');
});

test('renderTemplatedXlsx with default snapshot → valid xlsx', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, defaultSnapshot);
  assert.ok(isXlsx(buf), 'templated render should produce a valid xlsx');
});

test('renderTemplatedXlsx DEBIT_NOTE writes the debt-note header, not the statement intro', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, defaultSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.name, 'GBN');
  assert.equal(ws.pageSetup.orientation, 'portrait');
  assert.equal(ws.getCell(7, 2).value, 'GIẤY BÁO NỢ');
  assert.equal(ws.getCell(9, 5).value, 'Gửi tới:');
  assert.equal(ws.getCell(1, 4).font.name, 'Tahoma');
  assert.equal(ws.getCell(1, 4).font.size, 12);
  assert.equal(ws.getCell(1, 4).alignment.horizontal, 'right');
  assert.equal(ws.getCell(9, 2).font.color?.argb, 'FF969696');
  assert.equal(ws.getRow(6).height, 10.5);
  assert.equal(ws.getRow(8).height, 9);
  assert.equal(ws.getRow(15).height, 28);
  const colAValues = ws.getColumn(1).values.filter((value) => typeof value === 'string') as string[];
  assert.equal(colAValues.some((value) => value.includes('BÊN A')), false);
});

test('renderTemplatedXlsx DEBIT_NOTE normalizes horizontal statement snapshots to vertical columns', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, {
    ...defaultSnapshot,
    columns: defaultPaymentStatementColumns as DebitNoteTemplateColumn[],
    orientation: 'landscape',
  });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(15, 2).value, 'Ngày tháng');
  assert.equal(ws.getCell(15, 3).value, 'Số \nchứng từ');
  assert.equal(ws.getCell(15, 4).value, 'Diễn giải');
  assert.equal(ws.getCell(15, 8).value, 'Thành tiền');
});

test('renderTemplatedXlsx DEBIT_NOTE embeds no image when company has no logo', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, defaultSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0] as unknown as { getImages?: () => unknown[] };
  assert.equal((ws.getImages?.() ?? []).length, 0, 'no image should embed when no company logo is configured');
});

test('renderTemplatedXlsx DEBIT_NOTE adds a shipment header row before charge rows', async () => {
  const doc: BillingDocument = {
    ...debitDoc,
    lines: [line({
      unit: "20'",
      renderData: { departureDate: '2026-06-01', containerCount: 1, tripCode: 'TRIP-1' },
    })],
  };
  const buf = await renderTemplatedXlsx(doc, defaultSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(16, 4).value, "01x20' ABCD1234567");
  assert.equal(ws.getCell(17, 4).value, 'Cước vận chuyển — HCM - Bình Dương');
  assert.deepEqual(ws.getCell(61, 8).value, { formula: 'SUM(H16:H60)', result: 5_000_000 });
});

test('renderTemplatedXlsx DEBIT_NOTE renders expense documentCode in Số chứng từ', async () => {
  const doc: BillingDocument = {
    ...debitDoc,
    lines: [line({
      sourceType: 'EXPENSE',
      sourceId: 99,
      lineType: 'SERVICE_FEE',
      typeLabel: 'Phí chi hộ',
      unit: "20'",
      description: 'Phí hạ hàng',
      renderData: { departureDate: '2026-06-01', containerCount: 1, tripCode: 'TRIP-1', documentCode: 'HD-001' },
    })],
  };
  const buf = await renderTemplatedXlsx(doc, { ...defaultSnapshot, columns: defaultDebitNoteColumns as DebitNoteTemplateColumn[] });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(17, 3).value, 'HD-001');
});

test('renderTemplatedXlsx DEBIT_NOTE maps legacy chung_tu tripCode columns to documentCode', async () => {
  const legacyColumns: DebitNoteTemplateColumn[] = [
    { id: 'dien_giai', label: 'Diễn giải', variable: 'description', width: 40, align: 'left', format: 'text', total: false },
    { id: 'chung_tu', label: 'Số\nchứng từ', variable: 'tripCode', width: 12, align: 'center', format: 'text', total: false },
    { id: 'amount', label: 'Số tiền', variable: 'amount', width: 16, align: 'right', format: 'currency', total: true },
  ];
  const doc: BillingDocument = {
    ...debitDoc,
    lines: [line({
      sourceType: 'EXPENSE',
      sourceId: 99,
      lineType: 'SERVICE_FEE',
      description: 'Phí hạ hàng',
      renderData: { departureDate: '2026-06-01', tripCode: 'TRIP-1', documentCode: 'TK-123' },
    })],
  };
  const buf = await renderTemplatedXlsx(doc, { ...defaultSnapshot, columns: legacyColumns });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(17, 3).value, 'TK-123');
});

test('renderTemplatedXlsx PAYMENT_STATEMENT resolves template variables in intro text', async () => {
  const buf = await renderTemplatedXlsx({ ...paymentDoc, entityId: 999_999 }, {
    ...paymentSnapshot,
    titleText: 'BẢNG {rangeMonth} - {customerName}',
    termsText: '- Số TK {invoiceNo}\n- Tổng tiền {amountInWords}',
  });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(2, 1).value, 'BẢNG 06.2026 - NCC X');
  assert.match(String(ws.getCell(4, 1).value), /^BÊN A/);
  assert.match(String(ws.getCell(9, 1).value), /^BÊN B/);
  assert.equal(ws.getCell(14, 1).value, '- Số TK ........');
  assert.equal(ws.getCell(15, 1).value, '- Tổng tiền Năm triệu bốn trăm nghìn đồng');
});

test('renderTemplatedXlsx PAYMENT_STATEMENT renders horizontal freight and service-fee variables', async () => {
  const horizontalDoc: BillingDocument = {
    ...paymentDoc,
    lines: [line({
      baseAmount: 5_550_000,
      renderData: {
        freightAmount: 5_000_000,
        serviceFeeAmount: 550_000,
        totalAmount: 5_550_000,
        serviceFeeDescription: 'Nâng hạ',
      },
    })],
  };
  const buf = await renderTemplatedXlsx(horizontalDoc, {
    ...paymentSnapshot,
    columns: [
      { id: 'freight', label: 'Cước vận chuyển', variable: 'freightAmount', width: 16, align: 'right', format: 'currency', total: true },
      { id: 'fee', label: 'Phí chi hộ', variable: 'serviceFeeAmount', width: 16, align: 'right', format: 'currency', total: true },
      { id: 'total', label: 'Tổng tiền', variable: 'totalAmount', width: 16, align: 'right', format: 'currency', total: true },
      { id: 'fee_desc', label: 'Diễn giải phí', variable: 'serviceFeeDescription', width: 24, align: 'left', format: 'text', total: false },
    ],
  });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(20, 1).value, 5_000_000);
  assert.equal(ws.getCell(20, 2).value, 550_000);
  assert.equal(ws.getCell(20, 3).value, 5_550_000);
  assert.equal(ws.getCell(20, 4).value, 'Nâng hạ');
});

test('renderTemplatedXlsx with letterhead + terms → valid xlsx', async () => {
  const withChrome: DebitNoteTemplateSnapshot = {
    ...defaultSnapshot,
    issuerName: 'TingTing', issuerAddress: 'TP. HCM', issuerTaxCode: '0123456789',
    termsText: 'Thanh toán trong vòng 30 ngày kể từ ngày nhận giấy báo nợ.',
  };
  const buf = await renderTemplatedXlsx(debitDoc, withChrome);
  assert.ok(isXlsx(buf), 'should still produce a valid xlsx with letterhead/terms');
});

test('renderTemplatedXlsx with toggled-off columns + flat grouping → valid xlsx', async () => {
  const minimal: DebitNoteTemplateSnapshot = {
    ...defaultSnapshot, showContainerColumn: false, showUnitColumn: false, groupingMode: 'NONE',
  };
  const buf = await renderTemplatedXlsx(debitDoc, minimal);
  assert.ok(isXlsx(buf), 'should render 2 columns (desc + amount) with no grouping bands');
});

test('buildBillingXlsx ignores a template whose documentType does not match the doc', async () => {
  const wrongTypeTemplate: DebitNoteTemplate = {
    id: 10, name: 'Wrong', isDefault: false, documentType: 'DEBIT_NOTE',
    titleText: 'GIẤY BÁO NỢ', issuerName: null, issuerAddress: null, issuerTaxCode: null,
    accentColor: '#123456', showContainerColumn: false, showUnitColumn: true,
    groupingMode: 'NONE', columns, amountInWords: false, orientation: 'portrait',
    termsText: null, signatureLeftLabel: 'L', signatureLeftName: null,
    signatureRightLabel: 'R', signatureRightName: null, createdBy: null,
    createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z', deletedAt: null,
  };
  const buf = await buildBillingXlsx(paymentDoc, wrongTypeTemplate);
  assert.ok(isXlsx(buf), 'mismatched template should fall back to legacy xlsx instead of cross-rendering');
});

test('templateToSnapshot — copies render fields', () => {
  const tpl: DebitNoteTemplate = {
    id: 9, name: 'A', isDefault: false, documentType: 'DEBIT_NOTE',
    titleText: 'GN', issuerName: 'Co', issuerAddress: 'Addr', issuerTaxCode: 'MST',
    accentColor: '#123456', showContainerColumn: false, showUnitColumn: true,
    groupingMode: 'NONE', columns, amountInWords: false, orientation: 'portrait',
    termsText: 't', signatureLeftLabel: 'L', signatureLeftName: 'LN',
    signatureRightLabel: 'R', signatureRightName: 'RN', createdBy: null,
    createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z', deletedAt: null,
  };
  const snap = templateToSnapshot(tpl);
  assert.equal(snap.id, 9);
  assert.equal(snap.titleText, 'GN');
  assert.equal(snap.showContainerColumn, false);
  assert.equal(snap.accentColor, '#123456');
});
