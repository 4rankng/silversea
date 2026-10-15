import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, client } from '../db';
import * as s from '../db/schema';
import { assertOpsExpenseAssignment } from '../services/expense-owner-scope.service';
import { createOpsExpense } from '../services/ops-expenses.service';

after(async () => { await client.end(); });

// 2026-10-14, the accountant document "Fix lại các chi phí của từng phân hệ"
// (Ops section): "không chia cá nhân nào nhận bao nhiêu xe, tất cả các Ops đều
// được điền chi phí". The former grant chain — manual user↔shipment link,
// active truck-ops assignment whose truck hauled the lot, or the ops's own
// saved expense — no longer gates cost entry. The seam
// (`assertOpsExpenseAssignment`) stays as the single chokepoint, so this file
// pins the OPEN verdict itself plus the save path that used to refuse with
// "Lô này không thuộc xe bạn phụ trách".
test('ops expense scope: any OPS declares costs on any lot, no grant chain required', async () => {
  const rollback = Symbol('rollback');
  try {
  const key = crypto.randomUUID().slice(0, 8);
  await db.transaction(async tx => {
    const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
    const [opsA, opsB] = await tx.insert(s.users).values([
      { username: `qa54a${key}`, passwordHash: 'x', role: 'OPS', fullName: 'QA54 Ops A' },
      { username: `qa54b${key}`, passwordHash: 'x', role: 'OPS', fullName: 'QA54 Ops B' },
    ]).returning();
    // Lots deliberately carry NO user-shipment link, NO truck-ops assignment
    // and NO prior expense — every shape of "unlinked" the old gate refused.
    const [lotUntouched, lotOthers] = await tx.insert(s.shipments).values([
      { customerId: customer.id, shipmentCode: `${key}-NONE` },
      { customerId: customer.id, shipmentCode: `${key}-OTHERS` },
    ]).returning();

    // The seam itself: nothing links these ops users to these lots, and both
    // still pass.
    await assertOpsExpenseAssignment(tx, opsA.id, lotUntouched.id);
    await assertOpsExpenseAssignment(tx, opsB.id, lotOthers.id);

    // The save path that used to answer 403 "Lô này không thuộc xe bạn phụ
    // trách" now records the row. The note satisfies the separate uncharged-
    // row rule (card 20260928_162) — this test is about the scope, not that.
    const created = await createOpsExpense(opsB.id, {
      shipmentId: lotUntouched.id,
      expenseTypeCode: 'OTHER',
      amount: '250000',
      paidAt: '2026-10-14',
      note: 'QA: xác nhận mở quyền khai chi phí cho mọi Ops',
    }, tx);
    assert.equal(created.shipmentId, lotUntouched.id);
    assert.equal(String(created.paidById), String(opsB.id));

    throw rollback;
  });
  } catch (error) { if (error !== rollback) throw error; }
});
