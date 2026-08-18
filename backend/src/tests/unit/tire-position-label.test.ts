import { describe, test } from 'node:test';
import assert from 'node:assert';
import { tireSchema } from '@tingting/shared';

describe('tireSchema — custom position labels', () => {
  test('accepts and trims a typed tire position', () => {
    const parsed = tireSchema.parse({
      serial: 'TIRE-CUSTOM-POSITION',
      position: '  Trục nâng trái  ',
    });

    assert.strictEqual(parsed.position, 'Trục nâng trái');
  });
});
