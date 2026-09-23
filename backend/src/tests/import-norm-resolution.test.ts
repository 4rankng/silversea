/**
 * Card _57 follow-up — the import commit's norm resolution (normForBase).
 * QA staging transcript: "không có định mức dầu cho 1.25T" while a norm row
 * existed — the lookups now (a) keep digit-leading codes whole (the split-
 * on-dot rule previously turned '1.25T' into '1'), (b) resolve the whole
 * class family, and (c) fall back to class-NAME matching for prod-mirror
 * databases whose classes carry display names instead of canonical codes.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { normForBase } from '../services/quotation-import.service';

const suffix = `qnf-${Date.now().toString(36)}`;
const created = {
  classIds: [] as number[],
  normIds: [] as number[],
};

async function mkClass(code: string, name: string): Promise<number> {
  const [row] = await db.insert(s.vehicleSizeClasses)
    .values({ code, name, isContainer: code.startsWith('CONT') })
    .returning();
  created.classIds.push(row.id);
  return row.id;
}

async function mkNorm(classId: number, litersPerKm: string, effectiveDate: string): Promise<void> {
  const [row] = await db.insert(s.fuelConsumptionNorms)
    .values({ vehicleSizeClassId: classId, litersPerKm, effectiveDate })
    .returning();
  created.normIds.push(row.id);
}

before(async () => {
  void mkClass;
  void mkNorm;
});

after(async () => {
  if (created.normIds.length) await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, created.normIds));
  if (created.classIds.length) await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, created.classIds));
  await client.end();
});

describe('import norm resolution (card _57 staging follow-up)', () => {
  test('canonical code + norm resolves', async () => {
    const id = await mkClass('1.25T', 'Xe 1.25 tấn');
    await mkNorm(id, '0.1000', '2026-09-09');
    assert.equal(await normForBase('1.25T'), 0.1);
  });

  test('digit-leading codes stay whole (no split-on-dot truncation)', async () => {
    // '1.25T'.split('.')[0] === '1' — the OLD pre-hardening rule would have
    // looked up the class code '1' and returned null. Pin the fix.
    const id = await mkClass('2.5T', 'Xe 2.5 tấn');
    await mkNorm(id, '0.1300', '2026-09-09');
    assert.equal(await normForBase('2.5T'), 0.13);
  });

  test('mirror-named class resolves via the name fallback', async () => {
    // Distinct numeric core so the name fallback cannot hit the canonical
    // 1.25T class from the first probe.
    const id = await mkClass('XE35', 'Xe 3.5 tấn (mirror)');
    await mkNorm(id, '0.1050', '2026-09-01');
    assert.equal(await normForBase('3.5T'), 0.105);
  });

  test('no class and no norm → null (the caller throws the VN 400)', async () => {
    assert.equal(await normForBase('99T'), null);
  });
});
