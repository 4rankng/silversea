import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveAmount, docTotal, documentLedgerAdjustment, splitContainers, joinContainers,
} from '../services/billingDocument.service';
import type { BillingDocumentLine } from '@tingting/shared';

const line = (over: Partial<BillingDocumentLine>): BillingDocumentLine => ({
  sourceType: 'TRIP', sourceId: 1, lineType: 'FREIGHT', typeLabel: 'Khác', unit: 'lần', description: 'x',
  baseAmount: 1000, amountOverride: null, excluded: false, sortOrder: 0, ...over,
});

test('effectiveAmount — base used when no override', () => {
  assert.equal(effectiveAmount(line({ baseAmount: 1500 })), 1500);
});

test('effectiveAmount — override wins over base', () => {
  assert.equal(effectiveAmount(line({ baseAmount: 1000, amountOverride: 800 })), 800);
});

test('effectiveAmount — excluded always 0 (even with override)', () => {
  assert.equal(effectiveAmount(line({ baseAmount: 1000, amountOverride: 800, excluded: true })), 0);
});

test('effectiveAmount — null override falls back to base', () => {
  assert.equal(effectiveAmount(line({ baseAmount: 1000, amountOverride: null })), 1000);
});

test('docTotal — sums non-excluded effective amounts, honors overrides + exclusions', () => {
  const lines = [
    line({ baseAmount: 1000 }),                              // 1000
    line({ baseAmount: 2000, amountOverride: 1500 }),         // 1500
    line({ baseAmount: 500, excluded: true }),                // 0 (excluded)
    line({ sourceType: 'ADHOC', baseAmount: 0, amountOverride: 300 }), // 300 adhoc
  ];
  assert.equal(docTotal(lines), 2800);
});

test('documentLedgerAdjustment — trip rows contribute delta and recoverable expense rows contribute their full billed amount', () => {
  const lines = [
    line({ sourceType: 'TRIP', baseAmount: 6_000_000, amountOverride: 6_200_000 }),
    line({ sourceType: 'EXPENSE', lineType: 'SERVICE_FEE', baseAmount: 1_000_000, amountOverride: 1_080_000 }),
  ];
  assert.equal(documentLedgerAdjustment(lines), 1_280_000);
});

test('documentLedgerAdjustment — ad-hoc rows add fully and excluded recoverable expense rows stop contributing', () => {
  const lines = [
    line({ sourceType: 'EXPENSE', lineType: 'SERVICE_FEE', baseAmount: 1_000_000, excluded: true }),
    line({ sourceType: 'ADHOC', sourceId: null, lineType: 'ADHOC', baseAmount: 0, amountOverride: 400_000 }),
  ];
  assert.equal(documentLedgerAdjustment(lines), 400_000);
});

test('splitContainers — null/empty → null', () => {
  assert.equal(splitContainers(null), null);
  assert.equal(splitContainers(''), null);
  assert.equal(splitContainers('   '), null);
});

test('splitContainers — comma-joined text → trimmed array', () => {
  assert.deepEqual(splitContainers('ABCD1234567, EFGH8910111 '), ['ABCD1234567', 'EFGH8910111']);
});

test('joinContainers ← splitContainers roundtrip', () => {
  const list = ['ABCD1234567', 'EFGH8910111'];
  assert.equal(joinContainers(list), 'ABCD1234567, EFGH8910111');
  assert.deepEqual(splitContainers(joinContainers(list)), list);
  // null + empty lists collapse to null (DB-storable without placeholder)
  assert.equal(joinContainers(null), null);
  assert.equal(joinContainers([]), null);
});
