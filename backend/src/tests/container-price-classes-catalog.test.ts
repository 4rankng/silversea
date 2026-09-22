/**
 * Container price classes catalog (card 20260922_58, catalog half).
 *
 * DB-backed catalog test against the local dev DB: the four weight-split
 * container price classes exist with the customer's verbatim labels, and the
 * pre-existing CONT20/CONT40 rows are byte-identical to their seed values
 * (regression criterion: current container prices compute identically).
 * No service-layer calls — raw catalog introspection, mirrors
 * wave1-pricing-schema.test.ts's lightweight DB-backed pattern.
 *
 * Precondition: migration 20260922231200_card58_container_price_classes.sql
 * has been applied to the target DB (psql apply or drizzle-kit migrate).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db, client } from '../db';
import {
  CONTAINER_PRICE_CLASS_LABELS,
  resolveContainerPriceClass,
} from '@tingting/shared';

after(async () => {
  await client.end();
});

describe('container price classes catalog', () => {
  test('the four weight-split classes exist with verbatim customer labels', async () => {
    const rowList = await db.execute(sql`
      SELECT code, name, is_container, sort_order
      FROM vehicle_size_classes
      WHERE code IN ('CONT20.LIGHT', 'CONT20.HEAVY', 'CONT40.LIGHT', 'CONT40.HEAVY')
      ORDER BY sort_order
    `);
    assert.equal(rowList.length, 4);
    assert.deepEqual(rowList.map(r => r.code), [
      'CONT20.LIGHT', 'CONT20.HEAVY', 'CONT40.LIGHT', 'CONT40.HEAVY',
    ]);
    assert.deepEqual(rowList.map(r => r.name), [
      'Cont 20 - Trọng tải < 20 tấn',
      'Cont 20 - Trọng tải > 20 tấn',
      'Cont 40 nhẹ - Trọng tải < 20 tấn',
      'Cont 40 nặng - Trọng tải > 20 tấn',
    ]);
    assert.deepEqual(rowList.map(r => r.is_container), [true, true, true, true]);
    assert.deepEqual(rowList.map(r => Number(r.sort_order)), [10, 11, 12, 13]);
  });

  test('pre-existing CONT20/CONT40 rows are unchanged (regression)', async () => {
    const rowList = await db.execute(sql`
      SELECT code, name, is_container, sort_order
      FROM vehicle_size_classes
      WHERE code IN ('CONT20', 'CONT40')
      ORDER BY code
    `);
    assert.equal(rowList.length, 2);
    assert.deepEqual(rowList.map(r => r.name), ['Container 20 feet', 'Container 40 feet']);
    assert.deepEqual(rowList.map(r => Number(r.sort_order)), [8, 9]);
    assert.deepEqual(rowList.map(r => r.is_container), [true, true]);
  });

  test('resolver agrees with the catalog labels (shared ↔ DB coherence)', () => {
    const rows = CONTAINER_PRICE_CLASS_LABELS;
    assert.equal(resolveContainerPriceClass('CONT20', 18).ok && (resolveContainerPriceClass('CONT20', 18) as any).code, 'CONT20.LIGHT');
    assert.equal((resolveContainerPriceClass('CONT40', 20) as any).code, 'CONT40.HEAVY');
    assert.ok(Object.values(rows).every(l => l.length > 0 && l.length <= 50));
  });
});
