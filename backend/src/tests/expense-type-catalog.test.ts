import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { runInTx } from '../lib/tx';
import { assertActiveExpenseTypeCode } from '../services/forwarder-expense-commands.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTypeIds: number[] = [];

before(async () => {
  const [active] = await db.insert(s.forwarderExpenseTypes).values({
    code: `QA059-${suffix}`.slice(0, 50),
    name: `QA059 configured ${suffix}`,
    status: 'ACTIVE',
  }).returning();
  const [inactive] = await db.insert(s.forwarderExpenseTypes).values({
    code: `QA059-OFF-${suffix}`.slice(0, 50),
    name: `QA059 disabled ${suffix}`,
    status: 'INACTIVE',
  }).returning();
  createdTypeIds.push(active.id, inactive.id);
});

after(async () => {
  if (createdTypeIds.length) {
    await db.delete(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, createdTypeIds[0]!));
    await db.update(s.forwarderExpenseTypes).set({ deletedAt: null }).where(eq(s.forwarderExpenseTypes.id, createdTypeIds[1]!));
    await db.delete(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, createdTypeIds[1]!));
  }
  await client.end();
});

// Catalog-backed expenseType gate (QA-059): configured codes save; legacy
// seeded codes save; inactive/garbage codes fail with the Vietnamese
// field-level message — never a raw enum error.
describe('assertActiveExpenseTypeCode', () => {
  test('accepts a configured ACTIVE code', async () => {
    await runInTx(undefined, (tx) => assertActiveExpenseTypeCode(tx, `QA059-${suffix}`.slice(0, 50)));
  });

  test('accepts a seeded legacy code', async () => {
    await runInTx(undefined, (tx) => assertActiveExpenseTypeCode(tx, 'LIFTING'));
  });

  test('rejects an INACTIVE code with the Vietnamese message', async () => {
    await assert.rejects(
      () => runInTx(undefined, (tx) => assertActiveExpenseTypeCode(tx, `QA059-OFF-${suffix}`.slice(0, 50))),
      /không tồn tại hoặc đã ngừng hiệu lực/,
    );
  });

  test('rejects a garbage code without substituting', async () => {
    await assert.rejects(
      () => runInTx(undefined, (tx) => assertActiveExpenseTypeCode(tx, 'NO-SUCH-CODE')),
      /không tồn tại hoặc đã ngừng hiệu lực/,
    );
  });

  test('exact match only — lowercase variant of a valid code is rejected', async () => {
    await assert.rejects(
      () => runInTx(undefined, (tx) => assertActiveExpenseTypeCode(tx, 'lifting')),
      /không tồn tại hoặc đã ngừng hiệu lực/,
    );
  });
});
