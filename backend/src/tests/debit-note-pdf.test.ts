/**
 * Wave 2 — debit-note PDF export tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getDebitNoteData, exportDebitNoteHtml } from '../services/debit-note-pdf.service';

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

describe('Debit-note PDF — getDebitNoteData', () => {
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

describe('Debit-note PDF — exportDebitNoteHtml', () => {
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
