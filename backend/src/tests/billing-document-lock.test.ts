import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import type { SaveBillingDocumentInput } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { deleteDocument, updateDocument } from '../services/billingDocument.service';
import { transitionDebitNoteStatus } from '../services/debit-note-lifecycle.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const documentIds: number[] = [];

const lockedError = (error: unknown) =>
  error instanceof Error
  && 'statusCode' in error
  && (error as { statusCode: number }).statusCode === 409;

async function createConfirmedDocument() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Locked document customer ${suffix}-${customerIds.length}` })
    .returning();
  customerIds.push(customer.id);
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: customer.name,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    totalInclVat: '1000000',
    debitNoteStatus: 'CONFIRMED',
  }).returning();
  documentIds.push(document.id);
  await db.insert(s.billingDocumentLines).values({
    documentId: document.id,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: 'Phí dịch vụ',
    unit: 'lần',
    description: 'Khoản đã được khách hàng xác nhận',
    baseAmount: '1000000',
    sortOrder: 0,
  });
  return { customer, document };
}

async function createPendingDocument() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Pending document customer ${suffix}-${customerIds.length}` })
    .returning();
  customerIds.push(customer.id);
  const [document] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    entityName: customer.name,
    rangeFrom: '2026-08-01',
    rangeTo: '2026-08-31',
    totalInclVat: '1000000',
    ledgerAdjustmentAmount: '0',
    debitNoteStatus: 'PENDING_CONFIRM',
  }).returning();
  documentIds.push(document.id);
  await db.insert(s.billingDocumentLines).values({
    documentId: document.id,
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: 'Phí dịch vụ',
    unit: 'lần',
    description: 'Khoản đang chờ xác nhận',
    baseAmount: '1000000',
    sortOrder: 0,
  });
  return { customer, document };
}

function editedInput(customerId: number, customerName: string): SaveBillingDocumentInput {
  return {
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    entityName: customerName,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-07-31',
    lines: [{
      sourceType: 'ADHOC',
      sourceId: null,
      lineType: 'ADHOC',
      typeLabel: 'Phí dịch vụ',
      unit: 'lần',
      description: 'Nội dung sửa sau xác nhận',
      baseAmount: 2000000,
      amountOverride: null,
      excluded: false,
      sortOrder: 0,
    }],
  };
}

after(async () => {
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  await client.end();
});

describe('confirmed debit-note persistence lock', () => {
  test('canonical update rejects a confirmed debit note', async () => {
    const { customer, document } = await createConfirmedDocument();
    await assert.rejects(
      () => updateDocument(document.id, editedInput(customer.id, customer.name)),
      lockedError,
    );
    const [afterRow] = await db.select().from(s.billingDocuments)
      .where(inArray(s.billingDocuments.id, [document.id]));
    assert.equal(afterRow.totalInclVat, '1000000');
  });

  test('canonical delete rejects a confirmed debit note without reversing it', async () => {
    const { document } = await createConfirmedDocument();
    await assert.rejects(() => deleteDocument(document.id), lockedError);
    const [afterRow] = await db.select().from(s.billingDocuments)
      .where(inArray(s.billingDocuments.id, [document.id]));
    assert.equal(afterRow.deletedAt, null);
    assert.equal(afterRow.debitNoteStatus, 'CONFIRMED');
  });

  test('confirmation racing an update always leaves a confirmed, subsequently immutable document', async () => {
    const { customer, document } = await createPendingDocument();
    const [updated, confirmed] = await Promise.allSettled([
      updateDocument(document.id, editedInput(customer.id, customer.name)),
      transitionDebitNoteStatus({
        documentId: document.id,
        targetStatus: 'CONFIRMED',
        actorUserId: 1,
        confirmedBy: 'Khách hàng kiểm thử',
      }),
    ]);
    assert.equal(confirmed.status, 'fulfilled');
    assert.ok(updated.status === 'fulfilled' || lockedError(updated.reason));
    const [afterRace] = await db.select().from(s.billingDocuments)
      .where(inArray(s.billingDocuments.id, [document.id]));
    assert.equal(afterRace.debitNoteStatus, 'CONFIRMED');
    await assert.rejects(
      () => updateDocument(document.id, editedInput(customer.id, customer.name)),
      lockedError,
    );
  });

  test('confirmation racing delete cannot produce a confirmed deleted document', async () => {
    const { document } = await createPendingDocument();
    const [deleted, confirmed] = await Promise.allSettled([
      deleteDocument(document.id),
      transitionDebitNoteStatus({
        documentId: document.id,
        targetStatus: 'CONFIRMED',
        actorUserId: 1,
        confirmedBy: 'Khách hàng kiểm thử',
      }),
    ]);
    const [afterRace] = await db.select().from(s.billingDocuments)
      .where(inArray(s.billingDocuments.id, [document.id]));
    if (afterRace.debitNoteStatus === 'CONFIRMED') {
      assert.equal(afterRace.deletedAt, null);
      assert.equal(deleted.status, 'rejected');
      assert.equal(confirmed.status, 'fulfilled');
    } else {
      assert.ok(afterRace.deletedAt);
      assert.equal(deleted.status, 'fulfilled');
      assert.equal(confirmed.status, 'rejected');
    }
  });
});
