import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { supplierSchema } from './index';

describe('supplierSchema', () => {
  test('normalizes canonical supplier categories case-insensitively', () => {
    const parsed = supplierSchema.parse({
      name: 'Nhà cung cấp',
      types: ['fuel', ' PORT '],
      primaryType: 'fuel',
    });

    assert.deepEqual(parsed.types, ['FUEL', 'PORT']);
    assert.equal(parsed.primaryType, 'FUEL');
  });

  test('rejects unknown and non-string supplier categories', () => {
    assert.equal(supplierSchema.safeParse({
      name: 'Nhà cung cấp',
      types: ['FUEL', 'GAS'],
      primaryType: 'FUEL',
    }).success, false);
    assert.equal(supplierSchema.safeParse({
      name: 'Nhà cung cấp',
      types: ['FUEL', 42],
      primaryType: 'FUEL',
    }).success, false);
  });
});
