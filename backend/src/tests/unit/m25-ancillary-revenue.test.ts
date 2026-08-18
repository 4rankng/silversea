/**
 * Wave 1 M2.5 — ancillary revenue refund validation tests.
 *
 * The refund validation (negative amount requires note) is enforced at the
 * CRUD route layer (beforeCreate/beforeUpdate hooks in config.ts), not at
 * the Zod schema level. These tests verify the schema accepts negative
 * amounts (the CRUD hook is what rejects them) and verify the schema's
 * basic shape validation.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ancillaryRevenueSchema } from '@tingting/shared';

describe('M2.5 — ancillary revenue schema shape', () => {
  const validBase = {
    customerId: 1,
    type: 'LCL' as const,
    date: '2026-07-01',
  };

  test('positive amount → valid', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: 500_000,
    });
    assert.ok(result.success);
  });

  test('negative amount → accepted by schema (CRUD hook enforces note)', () => {
    // The schema does NOT reject negative amounts — the CRUD route's
    // beforeCreate hook does. This test verifies the schema allows it
    // so the hook can apply the business rule.
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: -200_000, note: 'refund reason',
    });
    assert.ok(result.success);
  });

  test('zero amount → valid', () => {
    const result = ancillaryRevenueSchema.safeParse({
      ...validBase, amount: 0,
    });
    assert.ok(result.success);
  });

  test('all 4 type values accepted', () => {
    for (const type of ['LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER'] as const) {
      const result = ancillaryRevenueSchema.safeParse({
        ...validBase, type, amount: 100_000,
      });
      assert.ok(result.success, `${type} accepted`);
    }
  });

  test('missing customerId → invalid', () => {
    const result = ancillaryRevenueSchema.safeParse({
      type: 'LCL', amount: 100_000, date: '2026-07-01',
    });
    assert.ok(!result.success);
  });
});
