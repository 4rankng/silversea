/**
 * Card 20261005 — ô chốt "đã hoàn ứng xong" + số âm của báo cáo hoàn ứng.
 * Service-level suite; fixtures `refund-settle-*`, local DB.
 *
 * Coverage:
 *   - remainingDifference = 0 → settle-refund ghi refund_settled_at/by; đọc
 *     lại trả đủ 2 trường mới (refundSettledAt/refundSettledByName).
 *   - remainingDifference ≠ 0 → 409 đúng thông điệp nghiệp vụ.
 *   - settled: false gỡ chốt (sửa nhầm).
 *   - Số âm báo cáo: remainingSigned = ĐNTT − ĐÃ ỨNG có dấu; âm + còn tiền đã
 *     cấp → needsCollection, direction CTY_YEU_CAU_THU_TIEN_UNG, note
 *     "Đề nghị thu tiền ứng".
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { settleExpenseReconciliationRefund } from '../services/expense-reconciliation-settle.service';
import { createAdvanceRequest } from '../services/advance-request.service';
import { recordFundedOpsAdvance } from '../services/expense-accounting-reconciliation.service';
import { getExpenseReconciliation } from '../services/expense-accounting-reads.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

after(async () => {
  for (const fn of cleanup) {
    try { await fn(); } catch (err) { console.warn('[reconciliation-refund-settle] cleanup:', (err as Error).message); }
  }
  await client.end();
});

async function mkUser(role: 'ACCOUNTANT' | 'OPS') {
  const [user] = await db.insert(s.users).values({
    username: `refund-settle-${suffix}-${role.toLowerCase()}-${cleanup.length}`, passwordHash: 'x', role,
    fullName: `refund settle ${role} ${suffix}`,
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, user.id)); });
  return user;
}

async function mkFundAccount() {
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `REFUND-SETTLE-${suffix}-${cleanup.length}`, name: `refund settle fund ${suffix}`, type: 'CASH',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: 1, updatedBy: 1,
  }).returning();
  track(async () => { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); });
  return account;
}

async function mkLot(ops: { id: number }, accountant: { id: number }, amount: number, advanceAmount: number) {
  const [batch] = await db.insert(s.expenseReconciliations).values({
    code: `REFUND-SETTLE-${suffix}-${cleanup.length}`, opsUserId: ops.id,
    from: '2026-09-01', to: '2026-09-30', amount: String(amount), advanceAmount: String(advanceAmount),
    createdById: accountant.id,
  }).returning();
  track(async () => { await db.delete(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, batch.id)); });
  return batch;
}

describe('card 20261005 — chốt hoàn ứng', () => {
  test('số còn phải hoàn bằng 0: ghi nhận hoàn ứng xong, đọc lại đủ 2 trường mới', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    // amount == advanceAmount → initialDifference 0 → remainingDifference 0.
    const batch = await mkLot(ops, accountant, 500000, 500000);

    await db.transaction(tx => settleExpenseReconciliationRefund(tx, actor, batch.id, { expectedVersion: 1, settled: true }));

    const [after] = await db.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, batch.id));
    assert.ok(after.refundSettledAt, 'refund_settled_at được ghi');
    assert.equal(after.refundSettledBy, accountant.id);
    const view = await getExpenseReconciliation(actor, batch.id);
    assert.ok(view.refundSettledAt, 'API trả refundSettledAt');
    assert.equal(view.refundSettledByName, accountant.fullName, 'tên người chốt được đọc kèm');
  });

  test('số còn phải hoàn khác 0: từ chối với đúng thông điệp nghiệp vụ', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    const batch = await mkLot(ops, accountant, 500000, 100000); // còn phải hoàn 400.000

    await assert.rejects(
      () => db.transaction(tx => settleExpenseReconciliationRefund(tx, actor, batch.id, { expectedVersion: 1, settled: true })),
      (error: unknown) => error instanceof Error && /Chỉ chốt hoàn ứng khi số tiền còn phải hoàn đã bằng 0\./.test(error.message),
    );
    const [after] = await db.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, batch.id));
    assert.equal(after.refundSettledAt, null);
  });

  test('settled false gỡ chốt để sửa nhầm', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    const batch = await mkLot(ops, accountant, 500000, 500000);
    await db.transaction(tx => settleExpenseReconciliationRefund(tx, actor, batch.id, { expectedVersion: 1, settled: true }));
    await db.transaction(tx => settleExpenseReconciliationRefund(tx, actor, batch.id, { expectedVersion: 2, settled: false }));
    const [after] = await db.select().from(s.expenseReconciliations).where(eq(s.expenseReconciliations.id, batch.id));
    assert.equal(after.refundSettledAt, null);
    assert.equal(after.refundSettledBy, null);
  });

  test('số âm báo cáo: remainingSigned âm + còn tiền đã cấp → đề nghị thu tiền ứng', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    const account = await mkFundAccount();
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    // Được cấp 500k (có tiền thật), chưa tiêu đồng nào: ĐNTT 0 − ĐÃ ỨNG 500k.
    await db.transaction(tx => recordFundedOpsAdvance(tx, actor, {
      opsUserId: ops.id, amount: 500000, reason: `refund-settle cấp ${suffix}`,
      treasuryAccountId: account.id, valueDate: new Date().toISOString().slice(0, 10),
      physicalReference: `refund-settle-${suffix}`,
    }));
    track(async () => { await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, `refund-settle-${suffix}`)); });
    track(async () => { await db.delete(s.ledger).where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.entityId, ops.id))); });
    track(async () => { await db.delete(s.advanceRequests).where(and(eq(s.advanceRequests.requesterId, ops.id), eq(s.advanceRequests.reason, `refund-settle cấp ${suffix}`))); });

    const row = (await listMonthlyReconciliationReport(actor, {})).rows.find(item => item.staffId === ops.id);
    assert.ok(row, 'có dòng báo cáo cho nhân viên');
    assert.equal(row.remainingSigned, -500000, 'ĐNTT − ĐÃ ỨNG có dấu');
    assert.equal(row.needsCollection, true);
    assert.equal(row.direction, 'CTY_YEU_CAU_THU_TIEN_UNG');
    assert.equal(row.note, 'Đề nghị thu tiền ứng');
    assert.equal(row.remaining, 500000, 'cột sổ quỹ giữ nguyên — tổng và ví không đổi');
  });

  test('141026230770(c): yêu cầu đã ghi nhận không bị báo cáo về 0 — ĐÃ ỨNG hiện số, chênh lệch có dấu', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    // Triệu chứng ticket (c): "Báo cáo hoàn ứng — all zeros" với yêu cầu tạm
    // ứng đã ghi nhận sitting trong kỳ. ĐÃ ỨNG lấy từ yêu cầu ĐÃ GHI NHẬN
    // (không nhìn funding) — dòng không bao giờ bị ép về 0 khi có hoạt động.
    const reason = `refund-settle đã ghi nhận ${suffix}`;
    await createAdvanceRequest(ops.id, { amount: 270000, reason });
    track(async () => { await db.delete(s.advanceRequests).where(and(eq(s.advanceRequests.requesterId, ops.id), eq(s.advanceRequests.reason, reason))); });

    const row = (await listMonthlyReconciliationReport(actor, {})).rows.find(item => item.staffId === ops.id);
    assert.ok(row, 'có dòng báo cáo cho nhân viên');
    assert.equal(row.dntt, 0);
    assert.equal(row.advanced, 270000, 'ĐÃ ỨNG phản ánh yêu cầu đã ghi nhận — không all-zero');
    assert.equal(row.remainingSigned, -270000, 'ĐNTT − ĐÃ ỨNG có dấu');
    assert.equal(row.needsCollection, false, 'chưa cấp tiền thật thì không đòi thu — "request without money is not an advance" (card11)');
    assert.equal(row.note, 'Không còn chênh lệch');
  });
});
