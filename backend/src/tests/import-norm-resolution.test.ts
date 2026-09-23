/**
 * Card _57 follow-up — the import commit's norm resolution (normForBase).
 * QA staging transcript: "không có định mức dầu cho 1.25T" while a norm row
 * existed — normForBase now (a) keeps digit-leading codes whole (the old
 * split-on-dot rule turned '1.25T' into '1'), and (b) resolves the whole
 * class family (base + LIGHT/HEAVY). Deliberately NO name matching (lead
 * ruling 2026-09-23): a wrong-class silent match is worse than a clear 400.
 * Fixtures use insert-if-absent so the suite runs on BOTH a bare template
 * and a seeded database (isolated runner).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { normForBase } from '../services/quotation-import.service';

const suffix = `qnf-${Date.now().toString(36)}`;
const created = {
  classIds: [] as number[],
  normIds: [] as number[],
};

const CODES = ['1.25T', '2.5T', '3.5T'];

async function ensureClass(code: string, name: string): Promise<number> {
  const [inserted] = await db.insert(s.vehicleSizeClasses)
    .values({ code, name, isContainer: code.startsWith('CONT') })
    .onConflictDoNothing()
    .returning();
  if (inserted) created.classIds.push(inserted.id);
  const [row] = await db.select({ id: s.vehicleSizeClasses.id })
    .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.code, code));
  return row.id;
}

async function mkNorm(classId: number, litersPerKm: string, effectiveDate: string): Promise<void> {
  // Seeded templates already carry the canonical norms at the same (class,
  // date) — converge instead of colliding with fuel_consumption_norms_class_date_uniq.
  const [existing] = await db.select({ id: s.fuelConsumptionNorms.id })
    .from(s.fuelConsumptionNorms)
    .where(and(
      eq(s.fuelConsumptionNorms.vehicleSizeClassId, classId),
      eq(s.fuelConsumptionNorms.effectiveDate, effectiveDate),
    ))
    .limit(1);
  if (existing) return;
  const [row] = await db.insert(s.fuelConsumptionNorms)
    .values({ vehicleSizeClassId: classId, litersPerKm, effectiveDate })
    .returning();
  created.normIds.push(row.id);
}

before(async () => {
  const id125 = await ensureClass('1.25T', 'Xe 1.25 tấn');
  await mkNorm(id125, '0.1000', '2026-09-09');
  const id25 = await ensureClass('2.5T', 'Xe 2.5 tấn');
  await mkNorm(id25, '0.1300', '2026-09-09');
});

after(async () => {
  if (created.normIds.length) await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, created.normIds));
  if (created.classIds.length) await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, created.classIds));
  await client.end();
});

describe('import norm resolution (card _57 staging follow-up)', () => {
  test('canonical code + norm resolves (digit-leading code kept whole)', async () => {
    assert.equal(await normForBase('1.25T'), 0.1);
  });

  test('2.5T resolves its OWN norm on a seeded template (no name matching)', async () => {
    assert.equal(await normForBase('2.5T'), 0.13);
  });

  test('missing class + family → null (the route names the missing code)', async () => {
    assert.equal(await normForBase('99T'), null);
  });
});
