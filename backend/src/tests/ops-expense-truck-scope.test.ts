import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { assertOpsLotCostPolicy, opsExpenseWriteScope } from '../services/expense-owner-scope.service';
import { ApiError } from '../errors';

after(async () => { await client.end(); });

// The OPS role's lot-cost policy (accountant P0 CPB-01, "các lô hàng nhập lên
// hoàn toàn không khai chi phí được"): any OPS user may declare costs on any
// LIVE lot — no per-person grant (link/truck/own-expense) is required anymore,
// because a newly entered lot satisfied none of those branches and the role was
// blocked outright. A missing or soft-deleted lot refuses with 404. The
// per-person/per-container scoping lane belongs to Wave C, not this gate.
test('ops lot-cost policy: any OPS may declare on any live lot; deleted lot 404s', async () => {
  const rollback = Symbol('rollback');
  try {
    await db.transaction(async tx => {
      const key = crypto.randomUUID().slice(0, 8);
      const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
      await tx.insert(s.users).values([
        { username: `qa54a${key}`, passwordHash: 'x', role: 'OPS', fullName: 'QA54 Ops A' },
        { username: `qa54b${key}`, passwordHash: 'x', role: 'OPS', fullName: 'QA54 Ops B' },
      ]).returning();
      const lots = await tx.insert(s.shipments).values([
        { customerId: customer.id, shipmentCode: `${key}-LIVE` },
        { customerId: customer.id, shipmentCode: `${key}-GONE` },
      ]).returning();
      const [lotLive, lotGone] = lots;
      // Soft-delete the second lot — the one refusal the policy still owns.
      await tx.update(s.shipments).set({ deletedAt: new Date() })
        .where(eq(s.shipments.id, lotGone.id));

      // No link, no truck assignment, no prior expense — the ROLE is enough.
      await assertOpsLotCostPolicy(tx, lotLive.id);
      // A missing or soft-deleted lot → 404 with the lot-scoped message.
      const expectLot404 = (error: unknown) => {
        assert.ok(error instanceof ApiError, `expected ApiError, got ${error}`);
        assert.equal(error.statusCode, 404);
        assert.match(error.message, /Không tìm thấy lô hàng/);
        return true;
      };
      await assert.rejects(() => assertOpsLotCostPolicy(tx, lotGone.id), expectLot404);
      await assert.rejects(() => assertOpsLotCostPolicy(tx, 999_999_999), expectLot404);
      // The dialog probe mirrors the policy: writable on the live lot; the
      // 404 reason surfaces instead of masquerading as a permission denial.
      assert.deepEqual(await opsExpenseWriteScope(lotLive.id, tx), { writable: true, reason: null });
      const goneScope = await opsExpenseWriteScope(lotGone.id, tx);
      assert.equal(goneScope.writable, false);
      assert.match(goneScope.reason ?? '', /Không tìm thấy lô hàng/);

      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
