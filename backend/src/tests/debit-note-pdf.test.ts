/**
 * Wave 2 + Wave 3 M5.8 — debit-note PDF export tests.
 *
 * Wave 2 covers the legacy template-less renderer (getDebitNoteData,
 * 2-arg exportDebitNoteHtml).
 * Wave 3 M5.8 covers the template-aware renderer (getDebitNoteForRender,
 * 3-arg exportDebitNoteHtml with snapshot, safeAccentColor, screen ↔ export
 * structural parity).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
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

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdDocIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdLineIds: number[] = [];

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
    if (createdLineIds.length > 0) await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.id, createdLineIds));
    if (createdDocIds.length > 0) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdDocIds));
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
