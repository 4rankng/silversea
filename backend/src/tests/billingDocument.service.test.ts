import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVatSnapshot,
  effectiveAmount, docTotal, documentLedgerAdjustment, splitContainers, joinContainers,
} from '../services/billing-document.service';
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

test('documentLedgerAdjustment — trip and recoverable rows contribute only their already-posted source delta', () => {
  const lines = [
    line({ sourceType: 'TRIP', baseAmount: 6_000_000, amountOverride: 6_200_000 }),
    line({ sourceType: 'EXPENSE', lineType: 'SERVICE_FEE', baseAmount: 1_000_000, amountOverride: 1_080_000 }),
  ];
  assert.equal(documentLedgerAdjustment(lines), 280_000);
});

test('documentLedgerAdjustment — ad-hoc rows add fully and excluded legacy sources reverse their posted amount', () => {
  const lines = [
    line({ sourceType: 'EXPENSE', lineType: 'SERVICE_FEE', baseAmount: 1_000_000, excluded: true }),
    line({ sourceType: 'ADHOC', sourceId: null, lineType: 'ADHOC', baseAmount: 0, amountOverride: 400_000 }),
  ];
  assert.equal(documentLedgerAdjustment(lines), -600_000);
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

test('calculateVatSnapshot — rounds VND half-up and reconciles net + tax = gross', () => {
  assert.deepEqual(calculateVatSnapshot(101, 0.05), {
    vatTreatment: 'STANDARD',
    vatRate: 0.05,
    vatTreatmentVersion: 'VAT-V1',
    netAmount: 96,
    taxAmount: 5,
    grossAmount: 101,
  });
  assert.deepEqual(calculateVatSnapshot(108, 0.08), {
    vatTreatment: 'STANDARD',
    vatRate: 0.08,
    vatTreatmentVersion: 'VAT-V1',
    netAmount: 100,
    taxAmount: 8,
    grossAmount: 108,
  });
});

test('calculateVatSnapshot — keeps zero-rated distinct and rejects unsupported rates', () => {
  assert.equal(calculateVatSnapshot(500, 0).vatTreatment, 'ZERO_RATED');
  assert.equal(calculateVatSnapshot(500, 0, 'EXEMPT').vatTreatment, 'EXEMPT');
  assert.throws(() => calculateVatSnapshot(500, 0.07), /không thuộc chính sách/);
  assert.throws(() => calculateVatSnapshot(500, 0, 'STANDARD'), /không khớp/);
});

test('calculateVatSnapshot — splits VAT-inclusive freight without increasing AR', () => {
  const snapshot = calculateVatSnapshot(10_800_000, 0.08);
  assert.deepEqual(snapshot, {
    vatTreatment: 'STANDARD',
    vatRate: 0.08,
    vatTreatmentVersion: 'VAT-V1',
    netAmount: 10_000_000,
    taxAmount: 800_000,
    grossAmount: 10_800_000,
  });
  assert.equal(documentLedgerAdjustment([{
    sourceType: 'TRIP',
    sourceId: 1,
    lineType: 'FREIGHT',
    typeLabel: 'Doanh thu',
    unit: 'chuyến',
    description: 'Cước vận chuyển',
    baseAmount: 10_800_000,
    grossAmount: snapshot.grossAmount,
    sortOrder: 0,
  }]), 0);
});
