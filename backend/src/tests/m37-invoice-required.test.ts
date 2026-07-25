/**
 * Wave 2 M3.7 — invoice-required validator tests.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  checkTripExpenseInvoice,
  checkExpenseInvoice,
  assertInvoiceRequired,
} from '../services/invoice-required.service';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdFetIds: number[] = [];
const createdCatIds: number[] = [];

after(async () => {
  try {
    if (createdFetIds.length > 0) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdFetIds));
    if (createdCatIds.length > 0) await db.delete(s.expenseCategories).where(inArray(s.expenseCategories.id, createdCatIds));
  } catch (err) {
    console.warn('[m37-invoice-required.test] cleanup partial:', (err as Error).message);
  }
  await client.end();
});

async function mkFet(requiresInvoice: boolean) {
  const [fet] = await db.insert(s.forwarderExpenseTypes).values({
    code: `M37-${suffix}-${createdFetIds.length}`,
    name: `M37 type ${suffix}`,
    requiresInvoice,
  }).returning();
  createdFetIds.push(fet.id);
  return fet;
}

async function mkCat(requiresInvoice: boolean) {
  const [cat] = await db.insert(s.expenseCategories).values({
    name: `M37 cat ${suffix}-${createdCatIds.length}`,
    requiresInvoice,
  }).returning();
  createdCatIds.push(cat.id);
  return cat;
}

describe('M3.7 — checkTripExpenseInvoice', () => {
  test('requiresInvoice=false → hasInvoice=true regardless of fields', async () => {
    const fet = await mkFet(false);
    const result = await checkTripExpenseInvoice(fet.id, null, null);
    assert.equal(result.requiresInvoice, false);
    assert.equal(result.hasInvoice, true);
    assert.equal(result.missingFields.length, 0);
  });

  test('requiresInvoice=true with both fields → hasInvoice=true', async () => {
    const fet = await mkFet(true);
    const result = await checkTripExpenseInvoice(fet.id, 'INV-001', '2026-07-01');
    assert.equal(result.requiresInvoice, true);
    assert.equal(result.hasInvoice, true);
  });

  test('requiresInvoice=true without invoiceNumber → missing', async () => {
    const fet = await mkFet(true);
    const result = await checkTripExpenseInvoice(fet.id, null, '2026-07-01');
    assert.equal(result.hasInvoice, false);
    assert.ok(result.missingFields.includes('invoiceNumber'));
  });

  test('requiresInvoice=true without invoiceDate → missing', async () => {
    const fet = await mkFet(true);
    const result = await checkTripExpenseInvoice(fet.id, 'INV-002', null);
    assert.equal(result.hasInvoice, false);
    assert.ok(result.missingFields.includes('invoiceDate'));
  });

  test('requiresInvoice=true with empty string invoiceNumber → missing', async () => {
    const fet = await mkFet(true);
    const result = await checkTripExpenseInvoice(fet.id, '  ', '2026-07-01');
    assert.equal(result.hasInvoice, false);
    assert.ok(result.missingFields.includes('invoiceNumber'));
  });
});

describe('M3.7 — checkExpenseInvoice', () => {
  test('requiresInvoice=false → OK without invoice', async () => {
    const cat = await mkCat(false);
    const result = await checkExpenseInvoice(cat.id, null, null);
    assert.equal(result.requiresInvoice, false);
    assert.equal(result.hasInvoice, true);
  });

  test('requiresInvoice=true with invoice → OK', async () => {
    const cat = await mkCat(true);
    const result = await checkExpenseInvoice(cat.id, 'INV-003', '2026-07-01');
    assert.equal(result.requiresInvoice, true);
    assert.equal(result.hasInvoice, true);
  });
});

describe('M3.7 — assertInvoiceRequired', () => {
  test('does not throw when invoice present', () => {
    assert.doesNotThrow(() =>
      assertInvoiceRequired({ requiresInvoice: true, hasInvoice: true, missingFields: [] }, 'Phí nâng'),
    );
  });

  test('does not throw when requiresInvoice is false', () => {
    assert.doesNotThrow(() =>
      assertInvoiceRequired({ requiresInvoice: false, hasInvoice: false, missingFields: ['invoiceNumber'] }, 'Phí hạ'),
    );
  });

  test('throws 400 when required and missing', () => {
    assert.throws(
      () => assertInvoiceRequired(
        { requiresInvoice: true, hasInvoice: false, missingFields: ['invoiceNumber', 'invoiceDate'] },
        'Phí lưu kho',
      ),
      (err: unknown) => err instanceof ApiError && err.statusCode === 400,
    );
  });
});
