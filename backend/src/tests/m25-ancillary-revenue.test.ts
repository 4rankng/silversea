/**
 * Wave 1 M2.5 — ancillary revenue refund validation tests.
 *
 * Verifies:
 *   - Positive amount without note → valid (normal revenue).
 *   - Negative amount WITH note → valid (refund).
 *   - Negative amount WITHOUT note → invalid (refund reason required).
 *   - Zero amount → valid (no refund rule triggers).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ancillaryRevenueSchema } from '@tingting/shared';

describe('M2.5 — ancillary revenue refund validation', () => {
  const validBase = {
    customerId: 1,
    type: 'LCL' as const,
    date: '2026-07-01',
  };

  test('positive amount without note → valid', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: 500_000,
    });
    assert.ok(result.success, 'positive amount without note is valid');
  });

  test('negative amount WITH note → valid (refund)', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: -200_000, note: 'Hoàn tiền do hủy dịch vụ',
    });
    assert.ok(result.success, 'negative amount with note is valid');
  });

  test('negative amount WITHOUT note → invalid (refund reason required)', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: -200_000,
    });
    assert.ok(!result.success, 'negative amount without note is rejected');
    const issue = result.error!.issues.find(i => i.path.includes('note'));
    assert.ok(issue, 'error is on the note field');
    assert.match(issue!.message, /Lý do hoàn tiền/);
  });

  test('negative amount with empty/whitespace note → invalid', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: -100_000, note: '   ',
    });
    assert.ok(!result.success, 'whitespace-only note is rejected for refunds');
  });

  test('zero amount → valid (no refund rule)', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: 0,
    });
    assert.ok(result.success, 'zero amount is valid');
  });

  test('positive amount WITH note → valid (note recommended but not required)', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: 1_000_000, note: 'Phí đóng gói LCL',
    });
    assert.ok(result.success);
  });
});
