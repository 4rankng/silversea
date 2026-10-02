// The forwarder expense-type catalog is admin-owned master data: the seed
// FILLS, it never overwrites. Missing codes insert with full defaults
// (including the ruled settlement categories); an existing row with a NULL
// category gets exactly that column backfilled; a row already carrying a
// category — or any admin-edited field — is never touched; soft-deleted
// rows stay deleted. Characterization harness follows the full-seed
// pattern of seed-bootstrap-idempotency.test.ts (real seed(), restore in
// after()).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { OPS_EXPENSE_TYPE_DEFAULTS } from '@tingting/shared';
import { expenseTypeSeedPolicy } from '../expense-type-seed-policy';
import { seed } from '../seed';
import { disconnectRedis } from '../lib/redis';

const CODES = Object.keys(OPS_EXPENSE_TYPE_DEFAULTS);

async function fetchRowByCode(code: string) {
  const [row] = await db.select().from(s.forwarderExpenseTypes)
    .where(inArray(s.forwarderExpenseTypes.code, [code]))
    .limit(1);
  return row;
}

after(async () => {
  // Restore a pristine seed state for whichever tests run next.
  try {
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.code, CODES));
    await seed();
  } catch { /* best-effort restore */ }
  await client.end();
  await disconnectRedis();
});

describe('seed fills the expense-type catalog without overwriting admin data', () => {
  test('empty catalog for the default codes: seed inserts all 8 with the ruled categories and ruled invoice policy', async () => {
    await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.code, CODES));
    const before = await db.select({ id: s.forwarderExpenseTypes.id }).from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, CODES));
    assert.equal(before.length, 0, 'fixture setup: default codes removed');

    await seed();

    const rows = await db.select().from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, CODES));
    assert.equal(rows.length, CODES.length, 'every default code is (re)inserted');
    const byCode = new Map(rows.map((row) => [row.code, row]));
    for (const [code, meta] of Object.entries(OPS_EXPENSE_TYPE_DEFAULTS)) {
      const row = byCode.get(code);
      assert.ok(row, `missing default code ${code}`);
      assert.equal(row.category, meta.category ?? null, `${code} carries its ruled category`);
      // Invoice policy follows the ruled seed policy (20260919_42) — the
      // invoice-required class stamps requiresInvoice, everything else does not.
      const ruled = expenseTypeSeedPolicy(code);
      assert.equal(row.requiresInvoice, ruled.requiresInvoice, `${code} carries the ruled invoice flag`);
      assert.equal(row.substituteEvidenceAllowed, ruled.substituteEvidenceAllowed, `${code} carries the ruled substitute-evidence flag`);
    }
    assert.equal(byCode.get('WEIGHING')?.category, 'PHAT_SINH', 'WEIGHING carries the ruled default');
    assert.equal(byCode.get('WEIGHING')?.requiresInvoice, true, 'WEIGHING is in the ruled invoice-required class');
  });

  test('admin-edited row survives a re-seed untouched — deep-equal down to updatedAt', async () => {
    await seed();
    const weighing = await fetchRowByCode('WEIGHING');
    assert.ok(weighing, 'WEIGHING present');

    // Admin classifies the row and tunes its policy fields.
    await db.update(s.forwarderExpenseTypes).set({
      category: 'KHAC', defaultMarkup: true, billingLabel: 'Admin label', vatRate: '0.100',
    }).where(inArray(s.forwarderExpenseTypes.code, ['WEIGHING']));

    // The comparison target is the row AS THE ADMIN LEFT IT — the seed is
    // pinned against admin intent, not against seed defaults.
    const edited = await fetchRowByCode('WEIGHING');
    assert.ok(edited, 'edited row refetch');

    await seed();

    const afterSeed = await fetchRowByCode('WEIGHING');
    assert.deepEqual(afterSeed, edited, 're-seed must not change a single column');
    assert.equal(afterSeed?.category, 'KHAC', 'admin classification survives');
    assert.equal(afterSeed?.defaultMarkup, true, 'admin markup survives');
    assert.equal(afterSeed?.billingLabel, 'Admin label', 'admin label survives');
  });

  test('NULL-category row: seed backfills exactly the category column, admin fields preserved', async () => {
    await seed();
    const lifting = await fetchRowByCode('LIFTING');
    assert.ok(lifting, 'LIFTING present');

    // Legacy unclassified row that an admin also renamed/repriced.
    await db.update(s.forwarderExpenseTypes).set({
      category: null, name: 'Admin Custom Name', defaultMarkup: false, vatRate: '0.100',
    }).where(inArray(s.forwarderExpenseTypes.code, ['LIFTING']));

    await seed();

    const afterSeed = await fetchRowByCode('LIFTING');
    assert.equal(afterSeed?.category, OPS_EXPENSE_TYPE_DEFAULTS.LIFTING.category, 'category backfilled from the default');
    assert.equal(afterSeed?.name, 'Admin Custom Name', 'admin name never overwritten');
    assert.equal(afterSeed?.defaultMarkup, false, 'admin markup never overwritten');
    assert.equal(afterSeed?.vatRate, '0.100', 'admin VAT never overwritten');
    assert.equal(afterSeed?.id, lifting.id, 'same row updated in place');
  });

  test('soft-deleted default row stays deleted — never resurrected, never duplicated', async () => {
    await seed();
    const other = await fetchRowByCode('OTHER');
    assert.ok(other, 'OTHER present');
    const softDeletedAt = new Date('2026-09-01T00:00:00.000Z');
    await db.update(s.forwarderExpenseTypes).set({ deletedAt: softDeletedAt })
      .where(inArray(s.forwarderExpenseTypes.code, ['OTHER']));

    await seed();

    const rows = await db.select().from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, ['OTHER']));
    assert.equal(rows.length, 1, 'no duplicate row inserted');
    assert.ok(rows[0]?.deletedAt, 'the soft-deleted row stays deleted');
  });
});
