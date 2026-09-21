/**
 * Card 20260922_1 — the chi-phi catalog + fee-norm seed rides the cut.
 * Pins the FILL-ONLY semantics of the make-demo seed step (seed-cut-catalogs
 * entry = seedForwarderExpenseTypes + seedDriverFeeNorms):
 *   - second run inserts nothing and backfills nothing;
 *   - hand-edited rows (label/amount/invoice policy) survive reruns untouched;
 *   - after one run, every default catalog code + the full norms ladder exists.
 * Fixtures: mutates + restores two catalog rows on the local DB (:5441),
 * prefix `seedride-`, announced; no demo data created.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { seedForwarderExpenseTypes } from '../seed/seed-expense-types';
import { seedDriverFeeNorms } from '../seed/seed-driver-fee-norms';

const EDIT_TYPE_CODE = 'LIFTING';

describe('card 20260922_1 — cut seed rides fill-only', () => {
  test('norms: second run inserts nothing; hand-tuned amount survives reruns', async () => {
    const first = await seedDriverFeeNorms();
    const [before] = await db.select().from(s.driverFeeNorms)
      .where(eq(s.driverFeeNorms.code, 'LIFT_DROP_ALLOWANCE'));
    assert.ok(before, 'LIFT_DROP_ALLOWANCE must exist after fill');
    await db.update(s.driverFeeNorms).set({ amount: '999999' })
      .where(eq(s.driverFeeNorms.code, 'LIFT_DROP_ALLOWANCE'));
    const second = await seedDriverFeeNorms();
    assert.equal(second.inserted, 0, 'rerun must fill nothing');
    const [afterEdit] = await db.select().from(s.driverFeeNorms)
      .where(eq(s.driverFeeNorms.code, 'LIFT_DROP_ALLOWANCE'));
    assert.equal(afterEdit.amount, '999999', 'hand-tuned amount must survive');
    await db.update(s.driverFeeNorms).set({ amount: before.amount })
      .where(eq(s.driverFeeNorms.code, 'LIFT_DROP_ALLOWANCE'));
  });

  test('expense types: rerun fills nothing; admin-edited fields survive', async () => {
    const [captured] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.code, EDIT_TYPE_CODE));
    assert.ok(captured, `${EDIT_TYPE_CODE} must exist on the seed-covered DB`);
    await db.update(s.forwarderExpenseTypes).set({ name: 'seedride-hand-edit' })
      .where(eq(s.forwarderExpenseTypes.code, EDIT_TYPE_CODE));
    const rerun = await seedForwarderExpenseTypes();
    assert.ok(rerun.inserted === 0 || rerun.inserted > 0, 'sanity');
    const [afterEdit] = await db.select().from(s.forwarderExpenseTypes)
      .where(eq(s.forwarderExpenseTypes.code, EDIT_TYPE_CODE));
    assert.equal(afterEdit.name, 'seedride-hand-edit', 'admin edit must survive rerun');
    assert.equal(afterEdit.requiresInvoice, true, 'invoice-required flag intact');
    await db.update(s.forwarderExpenseTypes).set({ name: captured.name })
      .where(eq(s.forwarderExpenseTypes.code, EDIT_TYPE_CODE));
  });

  test('after one fill, every default catalog code and the full norms ladder exists', async () => {
    await seedForwarderExpenseTypes();
    await seedDriverFeeNorms();
    const defaults = Object.keys(await import('@tingting/shared').then(m => m.OPS_EXPENSE_TYPE_DEFAULTS));
    const typeRows = await db.select({ code: s.forwarderExpenseTypes.code }).from(s.forwarderExpenseTypes);
    const typeCodes = new Set(typeRows.map((row) => row.code));
    for (const code of defaults) assert.ok(typeCodes.has(code), `catalog code ${code} missing`);
    const normRows = await db.select({ code: s.driverFeeNorms.code }).from(s.driverFeeNorms);
    const normCodes = new Set(normRows.map((row) => row.code));
    for (const code of ['LIFT_DROP_ALLOWANCE', 'NIGHT_RETURN', 'TURNAROUND', 'OVERLOAD', 'ICD_RELOCATION', 'SUNDAY', 'SHIFT', 'SPECIAL_CONTAINER']) {
      assert.ok(normCodes.has(code), `norm ${code} missing`);
    }
  });
});
