/**
 * Wave 2 M3.5 — billing document re-issue guard tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { checkBillingDocumentOverlap } from '../services/billing-overlap-guard.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdDocIds: number[] = [];
const createdCustomerIds: number[] = [];

async function mkCustomer() {
  const [c] = await db.insert(s.customers)
    .values({ name: `M35 customer ${suffix}-${createdCustomerIds.length}` })
    .returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkBillingDoc(customerId: number, rangeFrom: string, rangeTo: string) {
  const [doc] = await db.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    entityName: `M35 customer ${suffix}`,
    rangeFrom, rangeTo,
    totalInclVat: '1000000',
  }).returning();
  createdDocIds.push(doc.id);
  return doc;
}

after(async () => {
  try {
    if (createdDocIds.length > 0) {
      await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, createdDocIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } catch (err) {
    console.warn('[m35-reissue-guard.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

describe('M3.5 — checkBillingDocumentOverlap', () => {
  test('no overlap when no existing docs', async () => {
    const customer = await mkCustomer();
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
    });
    assert.equal(result.hasOverlap, false);
    assert.equal(result.overlappingDocs.length, 0);
  });

  test('exact same range → overlap detected', async () => {
    const customer = await mkCustomer();
    await mkBillingDoc(customer.id, '2026-07-01', '2026-07-31');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
    });
    assert.equal(result.hasOverlap, true);
    assert.equal(result.overlappingDocs.length, 1);
  });

  test('partially overlapping range → overlap detected', async () => {
    const customer = await mkCustomer();
    await mkBillingDoc(customer.id, '2026-07-01', '2026-07-15');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-07-10', rangeTo: '2026-07-31',
    });
    assert.equal(result.hasOverlap, true);
  });

  test('adjacent but non-overlapping ranges → no overlap', async () => {
    const customer = await mkCustomer();
    await mkBillingDoc(customer.id, '2026-07-01', '2026-07-15');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-07-16', rangeTo: '2026-07-31',
    });
    assert.equal(result.hasOverlap, false);
  });

  test('completely separate ranges → no overlap', async () => {
    const customer = await mkCustomer();
    await mkBillingDoc(customer.id, '2026-06-01', '2026-06-30');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-08-01', rangeTo: '2026-08-31',
    });
    assert.equal(result.hasOverlap, false);
  });

  test('excludeId excludes the document being edited', async () => {
    const customer = await mkCustomer();
    const doc = await mkBillingDoc(customer.id, '2026-07-01', '2026-07-31');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
      excludeId: doc.id,
    });
    assert.equal(result.hasOverlap, false);
  });

  test('different customers do not interfere', async () => {
    const c1 = await mkCustomer();
    const c2 = await mkCustomer();
    await mkBillingDoc(c1.id, '2026-07-01', '2026-07-31');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: c2.id,
      rangeFrom: '2026-07-01', rangeTo: '2026-07-31',
    });
    assert.equal(result.hasOverlap, false, 'c2 has no overlap with c1');
  });

  test('full containment → overlap detected', async () => {
    const customer = await mkCustomer();
    await mkBillingDoc(customer.id, '2026-07-01', '2026-07-31');
    const result = await checkBillingDocumentOverlap({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: customer.id,
      rangeFrom: '2026-07-05', rangeTo: '2026-07-10',
    });
    assert.equal(result.hasOverlap, true);
  });
});
