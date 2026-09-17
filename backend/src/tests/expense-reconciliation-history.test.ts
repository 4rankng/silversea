import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { getExpenseReconciliation } from '../services/expense-accounting-reads.service';

after(async () => { await client.end(); });
test('FIX-WS-ADVANCE-HISTORY: preserves each assigned advance after release and scopes OPS reads', async () => {
  const rollback = Symbol('rollback');
  try {
    await db.transaction(async tx => {
      const key = crypto.randomUUID();
      const [ops] = await tx.insert(s.users).values({ username: key, passwordHash: 'fixture', role: Role.OPS, status: 'ACTIVE' }).returning();
      const requests = await tx.insert(s.advanceRequests).values([
        { requesterId: ops.id, amount: '100000', reason: 'Ứng đợt một', status: 'RECORDED' },
        { requesterId: ops.id, amount: '250000', reason: 'Ứng đợt hai', status: 'RECORDED' },
      ]).returning();
      const [batch] = await tx.insert(s.expenseReconciliations).values({ code: key, opsUserId: ops.id, from: '2026-09-01', to: '2026-09-17', amount: '400000', advanceAmount: '300000', createdById: ops.id }).returning();
      await tx.insert(s.expenseReconciliationAdvances).values([
        { reconciliationId: batch.id, advanceRequestId: requests[0].id, amount: '100000' },
        { reconciliationId: batch.id, advanceRequestId: requests[1].id, amount: '200000' },
      ]);
      const actor = { userId: ops.id, role: Role.OPS };
      const expected = [{ advanceRequestId: requests[0].id, amount: 100000, reason: 'Ứng đợt một' }, { advanceRequestId: requests[1].id, amount: 200000, reason: 'Ứng đợt hai' }];
      assert.deepEqual((await getExpenseReconciliation(actor, batch.id, tx)).advances, expected);
      await tx.update(s.expenseReconciliations).set({ voidedAt: new Date() }).where(eq(s.expenseReconciliations.id, batch.id));
      const released = await getExpenseReconciliation(actor, batch.id, tx);
      assert.deepEqual(released.advances, expected);
      assert.equal(released.remainingDifference, 0);
      await assert.rejects(getExpenseReconciliation({ ...actor, userId: ops.id + 1 }, batch.id, tx), /Không tìm thấy/);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
