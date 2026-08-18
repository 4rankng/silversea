/**
 * transferTireSchema — move-to-vehicle payload contract.
 *
 * The transferTire() service is DB-coupled (runs in a transaction), so — like
 * trip-status-machine — we test the business rules at the schema boundary rather
 * than against a live database. These pin the "exactly one vehicle target" rule
 * the backend transferTire() relies on, and document that position is optional.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert';
import { transferTireSchema } from '@tingting/shared';

describe('transferTireSchema — move a mounted tire to another vehicle', () => {
  test('accepts a truck target with a position', () => {
    const parsed = transferTireSchema.parse({ truckId: 7, position: 'Trước trái' });
    assert.strictEqual(parsed.truckId, 7);
    assert.strictEqual(parsed.position, 'Trước trái');
  });

  test('accepts a trailer target with no position', () => {
    const parsed = transferTireSchema.parse({ trailerId: 3 });
    assert.strictEqual(parsed.trailerId, 3);
    // Absent position is undefined (optional); explicit null is also valid.
    assert.ok(parsed.position == null, 'position should be absent or null');
  });

  test('rejects when no vehicle target is chosen', () => {
    const result = transferTireSchema.safeParse({ position: 'Trước trái' });
    assert.strictEqual(result.success, false);
  });

  test('coerces numeric ids sent as form strings', () => {
    const parsed = transferTireSchema.parse({ truckId: '12' });
    assert.strictEqual(parsed.truckId, 12);
  });
});
