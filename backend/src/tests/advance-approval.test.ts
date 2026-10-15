/**
 * KP-148 — tạm ứng trở lại bước kế toán phê duyệt.
 * Service-level suite; fixtures `adv-approve-*`, local DB.
 *
 * Coverage:
 *   - Ops tự tạo yêu cầu → PENDING, CHƯA có bút toán/tiền: ví Ops và báo cáo
 *     hoàn ứng không đổi.
 *   - Kế toán approve → RECORDED + approvedBy/approvedAt, có bút toán
 *     OPS_ADVANCE và dòng treasury_movements OUT trong cùng lệnh duyệt; ví Ops
 *     tăng theo tiền đã cấp.
 *   - Duyệt lần hai / sai expectedVersion → 409 (không ghi tiền hai lần).
 *   - Reject → VOIDED kèm lý do trong audit log; yêu cầu đã từ chối không thể
 *     duyệt lại.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { createAdvanceRequest } from '../services/advance-request.service';
import { approveAdvanceRequest, rejectAdvanceRequest } from '../services/advance-funding.service';
import { getOpsWalletSummary } from '../services/ops-wallet.service';
import { listMonthlyReconciliationReport } from '../services/ops-reconciliation-report.service';
import { getExpenseAccountingCatalog } from '../services/expense-accounting-reads.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

after(async () => {
  for (const fn of cleanup) {
    try { await fn(); } catch (err) { console.warn('[advance-approval] cleanup:', (err as Error).message); }
  }
  await client.end();
});

async function mkUser(role: 'ACCOUNTANT' | 'OPS') {
  const [user] = await db.insert(s.users).values({
    username: `adv-approve-${suffix}-${role.toLowerCase()}-${cleanup.length}`, passwordHash: 'x', role,
    fullName: `adv approve ${role} ${suffix}`,
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, user.id)); });
  return user;
}

/** Quỹ công ty để lệnh duyệt có tài khoản giải ngân (cùng seed SEED-FUND). */
async function mkFundAccount() {
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `ADV-APPROVE-${suffix}-${cleanup.length}`, name: `adv approve fund ${suffix}`, type: 'CASH',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: 1, updatedBy: 1,
  }).returning();
  track(async () => { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); });
  return account;
}

async function mkPendingRequest(ops: { id: number }, amount: number) {
  const reason = `adv-approve tạm ứng ${suffix} ${amount}`;
  const request = await createAdvanceRequest(ops.id, { amount, reason }, undefined, { pending: true });
  // Một gỡ duy nhất, đúng thứ tự phụ thuộc: treasury_movements trước (tham
  // chiếu ledgerEntryId), rồi ledger, audit, cuối cùng là yêu cầu.
  track(async () => {
    const ledgers = await db.select({ id: s.ledger.id }).from(s.ledger)
      .where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, request.id)));
    if (ledgers.length) {
      await db.delete(s.treasuryMovements).where(inArray(s.treasuryMovements.ledgerEntryId, ledgers.map(row => row.id)));
    }
    await db.delete(s.ledger).where(eq(s.ledger.txnId, request.id));
    await db.delete(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'advance_request'), eq(s.auditLogs.entityId, request.id)));
    await db.delete(s.advanceRequests).where(eq(s.advanceRequests.id, request.id));
  });
  return request;
}

describe('KP-148 tạm ứng — bước kế toán phê duyệt', () => {
  test('Ops tạo yêu cầu ở trạng thái chờ: ví Ops và báo cáo hoàn ứng không đổi', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    await mkFundAccount();
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    const walletBefore = await getOpsWalletSummary(ops.id);
    const reportBefore = await listMonthlyReconciliationReport(actor, {});

    const request = await mkPendingRequest(ops, 200000);
    assert.equal(request.status, 'PENDING');
    assert.equal(request.approvedBy, null, 'chưa có người duyệt');
    assert.equal(request.approvedAt, null);

    assert.deepEqual(await getOpsWalletSummary(ops.id), walletBefore, 'PENDING chưa phải tiền của ví');
    const reportAfter = await listMonthlyReconciliationReport(actor, {});
    assert.equal(reportAfter.rows.filter(row => row.staffId === ops.id).length,
      reportBefore.rows.filter(row => row.staffId === ops.id).length, 'báo cáo hoàn ứng không nhận khoản chưa duyệt');
    // Yêu cầu chờ duyệt vẫn đến được màn hình phê duyệt của kế toán.
    const catalog = await getExpenseAccountingCatalog(actor);
    assert.ok(catalog.pendingAdvances?.some(row => row.id === request.id && row.status === 'PENDING' && row.version === request.version));
  });

  test('kế toán phê duyệt: bút toán + treasury OUT cùng lệnh, duyệt lần hai 409', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    await mkFundAccount();
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    const request = await mkPendingRequest(ops, 200000);

    await assert.rejects(() => approveAdvanceRequest(request.id, { expectedVersion: request.version + 5 }, actor), /đã thay đổi/);
    const result = await approveAdvanceRequest(request.id, { expectedVersion: request.version }, actor);
    assert.equal(result.status, 'RECORDED');
    assert.equal(result.approvedBy, accountant.id);
    assert.ok(result.approvedAt, 'thời điểm duyệt được ghi');

    const [ledgerRow] = await db.select().from(s.ledger).where(and(
      eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, request.id),
      eq(s.ledger.entityType, 'FORWARDER'), eq(s.ledger.entityId, ops.id)));
    assert.ok(ledgerRow, 'bút toán OPS_ADVANCE được ghi cùng lệnh duyệt');
    assert.equal(Number(ledgerRow.credit), 200000);
    const [movement] = await db.select().from(s.treasuryMovements).where(and(
      eq(s.treasuryMovements.ledgerEntryId, ledgerRow.id),
      eq(s.treasuryMovements.direction, 'OUT'), eq(s.treasuryMovements.status, 'POSTED')));
    assert.ok(movement, 'treasury_movements OUT được ghi cùng lệnh duyệt');
    assert.equal(Number(movement.amount), 200000);

    assert.equal((await getOpsWalletSummary(ops.id)).totalAdvance, '200000', 'ví Ops tăng theo tiền đã cấp');
    const row = (await listMonthlyReconciliationReport(actor, {})).rows.find(item => item.staffId === ops.id);
    assert.equal(row?.advanced, 200000);

    await assert.rejects(() => approveAdvanceRequest(request.id, { expectedVersion: result.version }, actor), /không còn chờ phê duyệt/);
  });

  test('từ chối: PENDING → VOIDED kèm lý do; không duyệt lại được', async () => {
    const accountant = await mkUser('ACCOUNTANT');
    const ops = await mkUser('OPS');
    await mkFundAccount();
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    const request = await mkPendingRequest(ops, 300000);

    await rejectAdvanceRequest(request.id, { expectedVersion: request.version, reason: 'Không đủ chứng từ' }, actor);
    const [after] = await db.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, request.id));
    assert.equal(after.status, 'VOIDED');
    const [log] = await db.select().from(s.auditLogs).where(and(
      eq(s.auditLogs.entityType, 'advance_request'), eq(s.auditLogs.entityId, request.id),
      eq(s.auditLogs.message, 'ADVANCE_REQUEST_REJECTED')));
    // Payload is jsonb — narrowed to the shape this test itself just wrote.
    const payload = log?.payload as { reason?: string } | undefined;
    assert.equal(payload?.reason, 'Không đủ chứng từ', 'lý do từ chối được lưu');
    assert.equal((await getOpsWalletSummary(ops.id)).totalAdvance, '0', 'từ chối không sinh tiền');
    await assert.rejects(() => approveAdvanceRequest(request.id, { expectedVersion: after.version }, actor), /không còn chờ phê duyệt/);
  });
});
