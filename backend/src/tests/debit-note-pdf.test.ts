/**
 * Wave 2 + Wave 3 M5.8 — debit-note PDF export tests.
 *
 * Wave 2 covers the legacy template-less renderer (getDebitNoteData,
 * 2-arg exportDebitNoteHtml).
 * Wave 3 M5.8 covers the template-aware renderer (getDebitNoteForRender,
 * 3-arg exportDebitNoteHtml with snapshot, safeAccentColor, screen ↔ export
 * structural parity).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  getDebitNoteData,
  exportDebitNoteHtml,
  getDebitNoteForRender,
  safeAccentColor,
} from '../services/debit-note-pdf.service';
import type { DebitNoteTemplateSnapshot } from '@tingting/shared';
import { Role, defaultDebitNoteColumns } from '@tingting/shared';
import { exportDebitNotePdf } from '../services/pdf-export.service';
import { getDocument } from '../services/billing-document.service';
import { enrichLinesForDebitNoteRender } from '../services/billing-export-shared.service';
import { globalErrorHandler } from '../middleware/errorHandler';
import billingDocumentsRoutes from '../routes/financial/billing-documents.routes';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdDocIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdLineIds: number[] = [];
// Card 171026004331 fixtures (endpoint-level HTML export).
const createdRouteIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdClassIds: number[] = [];

async function mkDoc() {
  const [customer] = await db.insert(s.customers).values({ name: `PDF customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [doc] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
    entityName: `PDF Customer ${suffix}`,
    rangeFrom: '2026-07-01', rangeTo: '2026-07-31', totalInclVat: '5000000',
    debitNoteStatus: 'DRAFT',
  }).returning();
  createdDocIds.push(doc.id);
  return { customer, doc };
}

after(async () => {
  try {
    if (renderServer) await new Promise<void>((resolve) => renderServer!.close(() => resolve()));
    if (createdLineIds.length > 0) await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.id, createdLineIds));
    if (createdDocIds.length > 0) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdDocIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdShipmentIds.length > 0) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdClassIds.length > 0) await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, createdClassIds));
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch (err) { console.warn('[debit-note-pdf.test] cleanup partial:', (err as Error).message); }
  await client.end();
});

describe('Debit-note PDF — getDebitNoteData (legacy)', () => {
  test('fetches document + non-excluded lines', async () => {
    const { doc } = await mkDoc();
    const [line1] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'TRIP', lineType: 'FREIGHT',
      typeLabel: 'Cước vận chuyển', description: 'Chuyến TRP-001', baseAmount: '3000000',
    }).returning();
    createdLineIds.push(line1.id);

    const data = await getDebitNoteData(doc.id);
    assert.equal(data.documentId, doc.id);
    assert.equal(data.lines.length, 1);
    assert.equal(data.lines[0].typeLabel, 'Cước vận chuyển');
  });

  test('excluded lines are NOT included', async () => {
    const { doc } = await mkDoc();
    const [line1] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'TRIP', lineType: 'FREIGHT',
      typeLabel: 'Included', description: 'test', baseAmount: '1000000',
    }).returning();
    const [line2] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'EXPENSE', lineType: 'SERVICE_FEE',
      typeLabel: 'Excluded', description: 'test', baseAmount: '500000',
      excluded: true,
    }).returning();
    createdLineIds.push(line1.id, line2.id);

    const data = await getDebitNoteData(doc.id);
    assert.equal(data.lines.length, 1, 'only non-excluded line');
    assert.equal(data.lines[0].typeLabel, 'Included');
  });

  test('throws 404 on missing document', async () => {
    await assert.rejects(
      () => getDebitNoteData(99_999_999),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404,
    );
  });
});

describe('Debit-note PDF — binary export', () => {
  test('returns a real PDF containing Vietnamese-font output', async () => {
    const { doc } = await mkDoc();
    const [line] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id,
      sourceType: 'ADHOC',
      sourceId: null,
      lineType: 'ADHOC',
      typeLabel: 'Cước vận chuyển',
      unit: 'lần',
      description: 'Tuyến Hải Phòng – Hà Nội',
      baseAmount: '5000000',
    }).returning();
    createdLineIds.push(line.id);

    const pdf = await exportDebitNotePdf(await getDocument(doc.id));
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(pdf.length > 1_000);
  });
});

describe('Debit-note PDF — exportDebitNoteHtml (legacy 2-arg)', () => {
  test('generates valid HTML with the document data', () => {
    const html = exportDebitNoteHtml({
      documentId: 42,
      entityName: 'Công ty Test',
      rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
      totalInclVat: '5000000',
      status: 'DRAFT',
      lines: [
        { lineType: 'FREIGHT', typeLabel: 'Cước vận chuyển', description: 'Chuyến TRP-001', baseAmount: '3000000', routeName: null },
        { lineType: 'SERVICE_FEE', typeLabel: 'Chi hộ', description: 'Phí nâng hạ', baseAmount: '2000000', routeName: null },
      ],
    }, '26/07/2026');

    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('Giấy báo nợ'));
    assert.ok(html.includes('Công ty Test'));
    assert.ok(html.includes('5.000.000 ₫'));
    assert.ok(html.includes('Cước vận chuyển'));
    assert.ok(html.includes('Chi hộ'));
    assert.ok(html.includes('@media print'));
  });

  test('escapes HTML in descriptions', () => {
    const html = exportDebitNoteHtml({
      documentId: 1, entityName: '<script>alert(1)</script>',
      rangeFrom: '2026-01-01', rangeTo: '2026-01-31',
      totalInclVat: '0', status: null,
      lines: [{ lineType: 'ADHOC', typeLabel: 'Test', description: '<b>bold</b>', baseAmount: '0', routeName: null }],
    }, '2026-01-01');
    assert.ok(!html.includes('<script>'), 'script tag escaped');
    assert.ok(html.includes('&lt;script&gt;'), 'escaped correctly');
  });

  test('empty lines produces a valid table with just the total row', () => {
    const html = exportDebitNoteHtml({
      documentId: 1, entityName: 'Test',
      rangeFrom: '2026-01-01', rangeTo: '2026-01-31',
      totalInclVat: '0', status: null,
      lines: [],
    }, '2026-01-01');
    assert.ok(html.includes('Tổng cộng'));
  });
});

// ─── Wave 3 M5.8 — template-aware renderer ──────────────────────────────────

describe('M5.8 — safeAccentColor', () => {
  test('accepts #rrggbb and lowercases', () => {
    assert.equal(safeAccentColor('#1F4E79'), '#1f4e79');
  });
  test('expands #rgb to #rrggbb', () => {
    assert.equal(safeAccentColor('#f00'), '#ff0000');
  });
  test('rejects malformed input and falls back to default', () => {
    assert.equal(safeAccentColor('red'), '#1F4E79');
    assert.equal(safeAccentColor('#ff0000x'), '#1F4E79');
    assert.equal(safeAccentColor(null), '#1F4E79');
    assert.equal(safeAccentColor(''), '#1F4E79');
  });
  test('blocks CSS injection attempts', () => {
    // A naive interpolation of `red; } body { background: url(...)` into
    // a CSS value would be dangerous. safeAccentColor returns the
    // fallback for anything that isn't a clean hex.
    const malicious = 'red; } body { background: url(javascript:alert(1))';
    assert.equal(safeAccentColor(malicious), '#1F4E79');
  });
});

const BASE_DATA = {
  documentId: 99,
  entityName: 'Khách hàng ABC',
  rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
  totalInclVat: '5000000',
  status: 'SENT',
  lines: [
    { lineType: 'FREIGHT', typeLabel: 'Cước vận chuyển', description: 'Chuyến TRP-001 → Sài Gòn', baseAmount: '4000000', routeName: 'Hà Nội - Sài Gòn' },
    { lineType: 'SERVICE_FEE', typeLabel: 'Chi hộ', description: 'Phí nâng hạ', baseAmount: '1000000', routeName: null },
  ],
};

const SNAPSHOT: DebitNoteTemplateSnapshot = {
  id: null,
  name: 'Default',
  titleText: 'GIẤY BÁO NỢ',
  issuerName: 'TingTing Logistics',
  issuerAddress: '123 Lê Lợi, Q1, TP.HCM',
  issuerTaxCode: '0123456789',
  issuerRepresentative: 'Nguyễn Văn A',
  accentColor: '#1F4E79',
  showContainerColumn: true,
  showUnitColumn: true,
  groupingMode: 'ROUTE',
  columns: [
    { id: 'stt',    label: 'STT',        variable: 'rowIndex',      width: 5,  align: 'center', format: 'number',   total: false },
    { id: 'ngay',   label: 'Ngày',       variable: 'description',   width: 20, align: 'left',   format: 'text',     total: false },
    { id: 'tuyen',  label: 'Tuyến',      variable: 'routeName',     width: 15, align: 'left',   format: 'text',     total: false },
    { id: 'loai',   label: 'Loại',       variable: 'lineTypeLabel', width: 12, align: 'left',   format: 'text',     total: false },
    { id: 'tien',   label: 'Số tiền',    variable: 'amount',        width: 15, align: 'right',  format: 'currency', total: true },
  ],
  orientation: 'landscape',
  termsText: 'Cùng thống nhất đối chiếu sản lượng và doanh thu.',
  signatureLeftLabel: 'Khách hàng',
  signatureLeftName: 'Trần Khách Hàng',
  signatureRightLabel: 'Kế toán trưởng',
  signatureRightName: 'Lê Kế Toán',
};

describe('M5.8 — exportDebitNoteHtml with template snapshot (3-arg)', () => {
  const html = exportDebitNoteHtml(BASE_DATA, SNAPSHOT, '26/07/2026');

  test('renders the snapshot title (not the legacy default)', () => {
    assert.ok(html.includes('>GIẤY BÁO NỢ<'), 'snapshot.titleText used');
  });

  test('renders Party A (customer) name', () => {
    assert.ok(html.includes('BÊN A'));
    assert.ok(html.includes('Khách hàng ABC'));
  });

  test('renders Party B (issuer) fields from snapshot', () => {
    assert.ok(html.includes('BÊN B'));
    assert.ok(html.includes('TingTing Logistics'));
    assert.ok(html.includes('123 Lê Lợi'));
    assert.ok(html.includes('0123456789'));
    assert.ok(html.includes('Nguyễn Văn A'));
  });

  test('renders the dynamic column headers', () => {
    for (const label of ['STT', 'Ngày', 'Tuyến', 'Loại', 'Số tiền']) {
      assert.ok(html.includes(`<th`), `th tag present`);
      assert.ok(html.includes(label), `column header "${label}" present`);
    }
  });

  test('renders dynamic cell values via renderColumnValue', () => {
    // rowIndex column → "1" and "2"
    assert.ok(html.includes('>1<'), 'first row index');
    assert.ok(html.includes('>2<'), 'second row index');
    // routeName → "Hà Nội - Sài Gòn"
    assert.ok(html.includes('Hà Nội - Sài Gòn'));
    // typeLabel → "Cước vận chuyển"
    assert.ok(html.includes('Cước vận chuyển'));
    // amount currency-formatted → "4.000.000 ₫"
    assert.ok(html.includes('4.000.000 ₫'));
  });

  test('renders the totals row when a column has total:true', () => {
    assert.ok(html.includes('TỔNG CỘNG'));
    assert.ok(html.includes('5.000.000 ₫'));
  });

  test('renders the signature blocks from snapshot', () => {
    assert.ok(html.includes('Khách hàng'));
    assert.ok(html.includes('Trần Khách Hàng'));
    assert.ok(html.includes('Kế toán trưởng'));
    assert.ok(html.includes('Lê Kế Toán'));
  });

  test('renders the terms text', () => {
    assert.ok(html.includes('Cùng thống nhất đối chiếu'));
  });

  test('applies the safe accent color', () => {
    assert.ok(html.includes('#1f4e79'), 'accent lowercased + applied');
  });

  test('escapes HTML in user-supplied fields', () => {
    const evilSnapshot: DebitNoteTemplateSnapshot = {
      ...SNAPSHOT,
      issuerName: '<script>alert("xss")</script>',
      termsText: '<img src=x onerror=alert(1)>',
    };
    const evilHtml = exportDebitNoteHtml(BASE_DATA, evilSnapshot, '26/07/2026');
    // The angle brackets must be escaped so the browser cannot parse the
    // payload as an actual tag. The text "onerror=" may still appear in
    // the rendered (text-only) output — that's fine because it's no
    // longer a parseable attribute.
    assert.ok(!evilHtml.includes('<script>'), 'script tag angle brackets escaped');
    assert.ok(evilHtml.includes('&lt;script&gt;'), 'issuerName escaped');
    assert.ok(!evilHtml.includes('<img'), 'img tag angle brackets escaped');
    assert.ok(evilHtml.includes('&lt;img'), 'img escaped to text');
  });
});

describe('M5.8 — exportDebitNoteHtml backward compat', () => {
  test('2-arg call (no snapshot) still renders the legacy layout', () => {
    const html = exportDebitNoteHtml(BASE_DATA, '26/07/2026');
    // Legacy layout has the fixed 3-column header (Loại / Mô tả / Số tiền)
    // and does NOT render BÊN A / BÊN B blocks.
    assert.ok(html.includes('Loại'));
    assert.ok(html.includes('Mô tả'));
    assert.ok(!html.includes('BÊN A'));
    assert.ok(!html.includes('BÊN B'));
  });

  test('null snapshot also falls through to legacy', () => {
    const html = exportDebitNoteHtml(BASE_DATA, null, '26/07/2026');
    assert.ok(html.includes('Loại'));
    assert.ok(!html.includes('BÊN A'));
  });
});

describe('M5.8 — getDebitNoteForRender (DB integration)', () => {
  test('returns hydrated doc + resolved snapshot + customer tax code', async () => {
    const { customer, doc } = await mkDoc();
    // Set a short tax code on the customer (column is varchar(20)).
    const shortTax = `T${suffix.slice(-12)}`;
    await db.update(s.customers).set({ taxCode: shortTax }).where(eq(s.customers.id, customer.id));
    const [line] = await db.insert(s.billingDocumentLines).values({
      documentId: doc.id, sourceType: 'TRIP', lineType: 'FREIGHT',
      typeLabel: 'Cước', description: 'Test chuyến', baseAmount: '2000000',
    }).returning();
    createdLineIds.push(line.id);

    const { doc: fetched, snapshot, customerTaxCode } = await getDebitNoteForRender(doc.id);
    assert.equal(fetched.id, doc.id);
    assert.equal(fetched.lines.length, 1);
    assert.ok(snapshot, 'snapshot resolved (system default)');
    assert.ok(snapshot.titleText, 'snapshot has a title');
    assert.ok(snapshot.columns.length > 0, 'snapshot has columns');
    assert.equal(customerTaxCode, shortTax);
  });

  test('templateIdOverride re-renders with a different template when provided', async () => {
    // Insert a custom template, then call with templateIdOverride pointing at it.
    const [tpl] = await db.insert(s.debitNoteTemplates).values({
      name: `M58 template ${suffix}`,
      documentType: 'DEBIT_NOTE',
      titleText: `M58 CUSTOM TITLE ${suffix}`,
      isDefault: false,
    }).returning();
    const createdTplIds: number[] = [tpl.id];
    try {
      const { doc } = await mkDoc();
      const { snapshot } = await getDebitNoteForRender(doc.id, { templateIdOverride: tpl.id });
      assert.equal(snapshot.titleText, `M58 CUSTOM TITLE ${suffix}`);
    } finally {
      await db.delete(s.debitNoteTemplates).where(inArray(s.debitNoteTemplates.id, createdTplIds));
    }
  });

  test('throws 404 on missing document', async () => {
    await assert.rejects(
      () => getDebitNoteForRender(99_999_999),
      (err: unknown) => err instanceof Error && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404,
    );
  });
});

// ─── Card 171026004331 — the HTML/PDF export must carry renderData ──────────
//
// GET /api/finance/billing-documents/:id/export?format=pdf|html re-projected
// `doc.lines` into the legacy DebitNotePdfData shape and rebuilt the rich lines
// from it with `renderData: null`, so the two columns the shipped default
// template appends for spec §II.4 — `bien_so`/truckPlate (BKS báo khách) and
// `loai_xe`/vehicleType (loại xe tính cước THU) — printed EMPTY on that
// endpoint while the XLSX path (which calls enrichLinesForDebitNoteRender)
// printed them.
//
// These tests read the rendered HTML table, not the code.

/** The template the Excel fix landed: the shared default debit-note columns. */
const RENDER_TEMPLATE: DebitNoteTemplateSnapshot = {
  id: null,
  name: 'Mặc định giấy báo nợ',
  titleText: 'GIẤY BÁO NỢ',
  issuerName: 'TingTing Logistics',
  issuerAddress: '123 Lê Lợi, Q1, TP.HCM',
  issuerTaxCode: '0123456789',
  issuerRepresentative: 'Nguyễn Văn A',
  accentColor: '#1F4E79',
  showContainerColumn: true,
  showUnitColumn: true,
  groupingMode: 'NONE',
  columns: defaultDebitNoteColumns.map(col => ({ ...col })),
  orientation: 'landscape',
  termsText: '',
  signatureLeftLabel: 'Khách hàng',
  signatureLeftName: null,
  signatureRightLabel: 'Người lập',
  signatureRightName: null,
};

let renderServer: http.Server | null = null;
let renderBaseUrl = '';
let renderFixtureSeq = 0;

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function parseTable(html: string): { headers: string[]; rows: string[][] } {
  const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]));
  // Data rows are emitted as a bare `<tr>`; the totals row carries a class and
  // the header row holds `<th>` cells only.
  const rows = [...html.matchAll(/<tr>\s*([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1])))
    .filter((cells) => cells.length > 0);
  return { headers, rows };
}

function cellOf(html: string, needle: string, columnLabel: string): string {
  const table = parseTable(html);
  const column = table.headers.indexOf(columnLabel);
  assert.ok(column >= 0, `column "${columnLabel}" is rendered — headers: ${JSON.stringify(table.headers)}`);
  const row = table.rows.find((cells) => cells.some((cell) => cell.includes(needle)));
  assert.ok(row, `a rendered row contains "${needle}"`);
  return row[column] ?? '';
}

function totalRowText(html: string): string {
  const match = /<tr class="total-row"[^>]*>([\s\S]*?)<\/tr>/.exec(html);
  assert.ok(match, 'the totals row is rendered');
  return stripTags(match[1]).replace(/\s+/g, ' ');
}

interface RenderFixture {
  tag: string;
  docId: number;
  tripId: number;
  revClassName: string;
  costClassName: string;
  plates: { billing: string; actual: string; tripTruck: string };
}

async function fetchExport(docId: number, format: string) {
  const response = await fetch(`${renderBaseUrl}/api/finance/billing-documents/${docId}/export?format=${format}`);
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', body: await response.text() };
}

/**
 * A document whose line sources carry BOTH plates and BOTH classes, so a wrong
 * pick is visible: the lot's billing BKS + THU class (AR) are what the customer
 * may see; the truck that actually ran + the TRẢ cost class are the carrier
 * statement's facts.
 */
async function mkRenderFixture(opts: { type: 'DEBIT_NOTE' | 'PAYMENT_STATEMENT'; isCarrier: boolean }): Promise<RenderFixture> {
  const tag = `${renderFixtureSeq++}${String(Date.now() % 100000).padStart(5, '0')}`;
  const plates = { billing: `BKS-KHACH-${tag}`, actual: `BKS-THUC-${tag}`, tripTruck: `XE-CHAY-${tag}` };
  const [customer] = await db.insert(s.customers).values({
    name: `Export render cust ${suffix}-${tag}`, isCarrier: opts.isCarrier,
  }).returning({ id: s.customers.id });
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Export render route ${suffix}-${tag}` })
    .returning({ id: s.routes.id });
  createdRouteIds.push(route.id);
  const [revClass] = await db.insert(s.vehicleSizeClasses).values({
    code: `RTHU${tag}`, name: `Xe 3.5T ${tag}`,
  }).returning({ id: s.vehicleSizeClasses.id, name: s.vehicleSizeClasses.name });
  const [costClass] = await db.insert(s.vehicleSizeClasses).values({
    code: `RTRA${tag}`, name: `Xe 10T ${tag}`,
  }).returning({ id: s.vehicleSizeClasses.id, name: s.vehicleSizeClasses.name });
  createdClassIds.push(revClass.id, costClass.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: route.id,
    shipmentCode: `EXPR-${suffix}-${tag}`,
    billingTruckNo: plates.billing,
    actualTruckNo: plates.actual,
    revVehicleClassId: revClass.id,
    costVehicleClassId: costClass.id,
  }).returning({ id: s.shipments.id });
  createdShipmentIds.push(shipment.id);
  const [truck] = await db.insert(s.trucks).values({ licensePlate: plates.tripTruck })
    .returning({ id: s.trucks.id });
  createdTruckIds.push(truck.id);
  const [trip] = await db.insert(s.trips).values({
    customerId: customer.id,
    routeId: route.id,
    truckId: truck.id,
    shipmentId: shipment.id,
    tripCode: `TRPX-${suffix}-${tag}`,
    departureDate: '2026-07-15',
  }).returning({ id: s.trips.id });
  createdTripIds.push(trip.id);
  const [doc] = await db.insert(s.billingDocuments).values({
    type: opts.type,
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: `Export render ${tag}`,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    totalInclVat: '4000000',
    totalNet: '4000000',
    totalTax: '0',
    totalGross: '4000000',
    debitNoteStatus: 'DRAFT',
    debitNoteTemplateSnapshot: RENDER_TEMPLATE,
  }).returning({ id: s.billingDocuments.id });
  createdDocIds.push(doc.id);
  return { tag, docId: doc.id, tripId: trip.id, revClassName: revClass.name, costClassName: costClass.name, plates };
}

async function mkRenderLine(docId: number, values: Partial<typeof s.billingDocumentLines.$inferInsert> & { description?: string }) {
  const [line] = await db.insert(s.billingDocumentLines).values({
    documentId: docId,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: 'Cước vận chuyển',
    unit: 'lần',
    baseAmount: '4000000',
    description: '',
    ...values,
  } as typeof s.billingDocumentLines.$inferInsert).returning({ id: s.billingDocumentLines.id });
  createdLineIds.push(line.id);
  return line.id;
}

describe('Card 171026004331 — export?format=pdf|html carries renderData (BKS / Loại xe)', () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    // requireRoles only reads req.user — no casbin policy needed for the read.
    app.use((req, _res, next) => {
      req.user = {
        userId: 1, username: 'export-render-test', email: 'test@x', fullName: 'Test', role: Role.ADMIN,
      };
      next();
    });
    app.use('/api', billingDocumentsRoutes);
    app.use(globalErrorHandler);
    renderServer = http.createServer(app);
    await new Promise<void>((resolve) => renderServer!.listen(0, resolve));
    renderBaseUrl = `http://127.0.0.1:${(renderServer.address() as AddressInfo).port}`;
  });

  test('AC1 — customer Debit Note HTML prints the billing BKS + the THU class', async () => {
    const f = await mkRenderFixture({ type: 'DEBIT_NOTE', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: f.tripId,
      lineType: 'FREIGHT',
      description: `Chuyến ${f.tag}`,
      renderData: { truckPlate: f.plates.billing, vehicleType: f.revClassName },
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200);
    assert.match(res.contentType, /text\/html/);
    assert.equal(cellOf(res.body, `Chuyến ${f.tag}`, 'Biển số xe'), f.plates.billing,
      'BKS báo khách (billing_truck_no) must print in the Biển số xe cell');
    assert.equal(cellOf(res.body, `Chuyến ${f.tag}`, 'Loại xe'), f.revClassName,
      'the THU class must print in the Loại xe cell');
    assert.ok(!res.body.includes(f.plates.actual), 'the actual plate must appear nowhere');
    assert.ok(!res.body.includes(f.plates.tripTruck), 'the truck plate must appear nowhere');
  });

  test('AC2 — format=pdf returns the same printable page with both values', async () => {
    const f = await mkRenderFixture({ type: 'DEBIT_NOTE', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: f.tripId,
      lineType: 'FREIGHT',
      description: `Chuyến PDF ${f.tag}`,
      renderData: { truckPlate: f.plates.billing, vehicleType: f.revClassName },
    });

    const res = await fetchExport(f.docId, 'pdf');
    assert.equal(res.status, 200);
    assert.match(res.contentType, /text\/html/);
    assert.equal(cellOf(res.body, `Chuyến PDF ${f.tag}`, 'Biển số xe'), f.plates.billing);
    assert.equal(cellOf(res.body, `Chuyến PDF ${f.tag}`, 'Loại xe'), f.revClassName);
    assert.ok(!res.body.includes(f.plates.actual), 'the actual plate must appear nowhere');
  });

  test('AC1b — a stored line WITHOUT renderData is repaired AR-first, exactly like the Excel path', async () => {
    const f = await mkRenderFixture({ type: 'DEBIT_NOTE', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: f.tripId,
      lineType: 'FREIGHT',
      description: `Chuyến cũ ${f.tag}`,
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200);
    assert.equal(cellOf(res.body, `Chuyến cũ ${f.tag}`, 'Biển số xe'), f.plates.billing,
      'a legacy line resolves the billing BKS through the document lot claim');
    assert.equal(cellOf(res.body, `Chuyến cũ ${f.tag}`, 'Loại xe'), f.revClassName);
    assert.ok(!res.body.includes(f.plates.actual), 'the actual plate must appear nowhere');
    assert.ok(!res.body.includes(f.plates.tripTruck), 'the truck plate must appear nowhere');
  });

  test('AC3 — a carrier statement prints the ACTUAL plate + the TRẢ class', async () => {
    const f = await mkRenderFixture({ type: 'PAYMENT_STATEMENT', isCarrier: true });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: f.tripId,
      lineType: 'FREIGHT',
      description: `Chuyến nhà xe ${f.tag}`,
      renderData: { truckPlate: f.plates.actual, vehicleType: f.costClassName },
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200);
    assert.equal(cellOf(res.body, `Chuyến nhà xe ${f.tag}`, 'Biển số xe'), f.plates.actual);
    assert.equal(cellOf(res.body, `Chuyến nhà xe ${f.tag}`, 'Loại xe'), f.costClassName);
    assert.ok(!res.body.includes(f.plates.billing), 'the customer-facing BKS must not leak to the carrier');
  });

  test('AC3b — the payable perspective rule holds on the endpoint repair path too (no stored renderData)', async () => {
    const f = await mkRenderFixture({ type: 'PAYMENT_STATEMENT', isCarrier: true });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: f.tripId,
      lineType: 'FREIGHT',
      description: `Chuyến nhà xe cũ ${f.tag}`,
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200);
    assert.equal(cellOf(res.body, `Chuyến nhà xe cũ ${f.tag}`, 'Biển số xe'), f.plates.actual,
      'AP repair prints the truck that actually ran');
    assert.equal(cellOf(res.body, `Chuyến nhà xe cũ ${f.tag}`, 'Loại xe'), f.costClassName,
      'AP repair prints the TRẢ cost class');
    assert.ok(!res.body.includes(f.plates.billing), 'the customer-facing BKS must not leak to the carrier');
  });

  test('AC3c — a customer statement that is not a carrier stays AR (billing BKS + THU class)', async () => {
    const f = await mkRenderFixture({ type: 'PAYMENT_STATEMENT', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: f.tripId,
      lineType: 'FREIGHT',
      description: `Bảng kê khách ${f.tag}`,
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200);
    assert.equal(cellOf(res.body, `Bảng kê khách ${f.tag}`, 'Biển số xe'), f.plates.billing);
    assert.equal(cellOf(res.body, `Bảng kê khách ${f.tag}`, 'Loại xe'), f.revClassName);
  });

  test('AC4 — no renderData and nothing resolvable renders as today: empty cells, no invented plate', async () => {
    const f = await mkRenderFixture({ type: 'DEBIT_NOTE', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'ADHOC',
      sourceId: null,
      lineType: 'SERVICE_FEE',
      typeLabel: 'Phí nâng hạ',
      description: `Phí nâng hạ ${f.tag}`,
      baseAmount: '1500000',
    });
    // A TRIP line whose source no longer exists: nothing may be invented.
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP',
      sourceId: 999999999,
      lineType: 'FREIGHT',
      description: `Chuyến treo ${f.tag}`,
      baseAmount: '2500000',
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200, 'no empty-cell crash');
    assert.equal(cellOf(res.body, `Phí nâng hạ ${f.tag}`, 'Biển số xe'), '');
    assert.equal(cellOf(res.body, `Phí nâng hạ ${f.tag}`, 'Loại xe'), '');
    assert.equal(cellOf(res.body, `Chuyến treo ${f.tag}`, 'Biển số xe'), '');
    assert.equal(cellOf(res.body, `Chuyến treo ${f.tag}`, 'Loại xe'), '');
    for (const plate of [f.plates.billing, f.plates.actual, f.plates.tripTruck]) {
      assert.ok(!res.body.includes(plate), `no invented plate (${plate})`);
    }
  });

  test('AC5 — money cells, totals, row/column layout are unchanged', async () => {
    const f = await mkRenderFixture({ type: 'DEBIT_NOTE', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'ADHOC',
      sourceId: null,
      lineType: 'SERVICE_FEE',
      typeLabel: 'Phí nâng hạ',
      description: `Tiền ${f.tag}`,
      baseAmount: '3000000',
      amountOverride: '2750000',
    });

    const res = await fetchExport(f.docId, 'html');
    assert.equal(res.status, 200);

    const table = parseTable(res.body);
    assert.equal(table.headers.length, RENDER_TEMPLATE.columns.length, 'every visible column is rendered once');
    assert.equal(table.rows.length, 1, 'one row per non-excluded line');
    assert.equal(table.rows[0].length, RENDER_TEMPLATE.columns.length, 'no cell added or dropped');
    // amountOverride still wins over baseAmount, exactly as the legacy
    // projection did (`String(l.amountOverride ?? l.baseAmount)`).
    assert.equal(cellOf(res.body, `Tiền ${f.tag}`, 'Thành tiền'), '2.750.000 ₫');
    assert.equal(
      totalRowText(res.body),
      'TỔNG CỘNG · TRƯỚC VAT: 4.000.000 ₫ · VAT: 0 ₫ · TỔNG THANH TOÁN: 4.000.000 ₫',
    );
  });

  test('AC5b — enrichment cannot move money: amounts survive it unchanged', async () => {
    const f = await mkRenderFixture({ type: 'DEBIT_NOTE', isCarrier: false });
    await mkRenderLine(f.docId, {
      sourceType: 'TRIP', sourceId: f.tripId, lineType: 'FREIGHT',
      description: `Đối chiếu tiền ${f.tag}`, baseAmount: '3000000', amountOverride: '2500000',
    });
    const doc = await getDocument(f.docId);
    const enriched = await enrichLinesForDebitNoteRender(doc.lines, 'AR');
    assert.equal(enriched.length, doc.lines.length);
    for (const [index, line] of enriched.entries()) {
      assert.equal(line.baseAmount, doc.lines[index].baseAmount, 'baseAmount untouched');
      assert.equal(line.amountOverride, doc.lines[index].amountOverride, 'amountOverride untouched');
      assert.equal(line.netAmount, doc.lines[index].netAmount);
      assert.equal(line.taxAmount, doc.lines[index].taxAmount);
      assert.equal(line.grossAmount, doc.lines[index].grossAmount);
      assert.equal(line.excluded, doc.lines[index].excluded);
    }
  });
});
