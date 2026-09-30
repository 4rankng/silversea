/**
 * Pre-demo audit — an OPS can withdraw their own just-created advance request.
 *
 * The OPS create path (`createAdvanceRequest`) writes RECORDED, but
 * `resolveAdvanceDraft` refused every status except DRAFT and the wallet UI
 * rendered no action, so an operator could create a request they could never
 * cancel. The OWNER may now void a RECORDED request that has no funding and no
 * settlement; every other status stays refused with the same 409, and the
 * office side keeps its DRAFT-only recovery.
 *
 * Every case runs inside a transaction that ALWAYS rolls back, so no fixture
 * row escapes into the demo DB.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { resolveAdvanceDraft } from '../services/advance-draft.service';
import type { Tx } from '../services/trip-shared';
import { ApiError } from '../errors';
import { disconnectRedis } from '../lib/redis';

const key = `ownervoid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nonce = { value: 0 };
const nextName = (label: string) => `${key}-${label}-${++nonce.value}`;

/** Open a transaction and ALWAYS roll it back — no row escapes. */
async function rolledBack(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error('rollback owner-void fixture');
  try {
    await db.transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function expectApiError(promise: Promise<unknown>, status: number, messagePart: string) {
  await promise.then(
    () => { throw new Error(`expected ApiError ${status} (${messagePart}), got success`); },
    (err: unknown) => {
      assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}: ${(err as Error).message}`);
      assert.equal(err.statusCode, status);
      assert.match(err.message, new RegExp(messagePart));
    },
  );
}

async function mkOps(tx: Tx, label: string) {
  const [user] = await tx.insert(s.users).values({
    username: nextName(label), passwordHash: 'x', role: Role.OPS, status: 'ACTIVE',
  }).returning();
  return user;
}

async function mkRequest(tx: Tx, requesterId: number, status: 'DRAFT' | 'RECORDED') {
  const [row] = await tx.insert(s.advanceRequests).values({
    requesterId, amount: '250000', reason: `Tạm ứng ${key}`, status,
  }).returning();
  return row;
}

const voidInput = (request: { id: number; version: number }, actorId: number, actorRole: Role) => ({
  id: request.id, action: 'void' as const, expectedVersion: request.version, actorId, actorRole,
  resolutionReason: 'Tạo nhầm, chưa nhận tiền',
});

test('an OPS owner voids their own RECORDED request while nothing was funded', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'owner');
  const request = await mkRequest(tx, owner.id, 'RECORDED');

  const voided = await resolveAdvanceDraft(tx, voidInput(request, owner.id, Role.OPS));

  assert.equal(voided.status, 'VOIDED');
  assert.equal(voided.version, request.version + 1, 'the freeze/version guard still advances the row');
  const [logged] = await tx.select().from(s.auditLogs).where(and(
    eq(s.auditLogs.entityType, 'advance-request-draft'), eq(s.auditLogs.entityId, request.id),
  ));
  assert.ok(logged, 'the withdrawal is written to the audit log');
  assert.equal(logged.message, 'Đã hủy tạm ứng chưa giao tiền',
    'the log names the real state — the request WAS recorded, only the money was never handed over');
  assert.equal(logged.payload?.resolutionReason, 'Tạo nhầm, chưa nhận tiền');
}));

test('funding posted against the request still closes the owner withdrawal', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'funded');
  const request = await mkRequest(tx, owner.id, 'RECORDED');
  await tx.insert(s.ledger).values({
    txnType: TxnType.OPS_ADVANCE, txnId: request.id, entityType: 'FORWARDER', entityId: owner.id, balance: '0',
  });

  await expectApiError(resolveAdvanceDraft(tx, voidInput(request, owner.id, Role.OPS)), 409, 'đã có bút toán lịch sử');
  const [survivor] = await tx.select().from(s.advanceRequests).where(eq(s.advanceRequests.id, request.id));
  assert.equal(survivor.status, 'RECORDED', 'a refused withdrawal leaves the request untouched');
}));

test('a settlement already claiming the request still closes the owner withdrawal', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'claimed');
  const request = await mkRequest(tx, owner.id, 'RECORDED');
  const [settlement] = await tx.insert(s.advanceSettlements).values({
    code: (`OV${key}`).slice(0, 20), forwarderId: owner.id,
    totalExpenseAmount: '0', refundAmount: '0', status: 'RECORDED',
  }).returning();
  await tx.insert(s.advanceSettlementRequests).values({
    settlementId: settlement.id, advanceRequestId: request.id, allocatedAmount: '0',
  });

  await expectApiError(resolveAdvanceDraft(tx, voidInput(request, owner.id, Role.OPS)), 409, 'gắn với phiếu hoàn ứng');
}));

test('the owner cannot RECORD their own RECORDED request', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'record');
  const request = await mkRequest(tx, owner.id, 'RECORDED');

  await expectApiError(resolveAdvanceDraft(tx, {
    ...voidInput(request, owner.id, Role.OPS), action: 'record', amount: 250000, reason: 'Ghi lại',
  }), 409, 'Chỉ tạm ứng chưa ghi sổ được xử lý');
}));

test('another OPS cannot withdraw a request that is not theirs', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'owner2');
  const stranger = await mkOps(tx, 'stranger');
  const request = await mkRequest(tx, owner.id, 'RECORDED');

  await expectApiError(resolveAdvanceDraft(tx, voidInput(request, stranger.id, Role.OPS)), 404, 'Không tìm thấy tạm ứng của bạn');
}));

test('the office keeps its DRAFT-only rule — a RECORDED request is never theirs', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'office');
  const request = await mkRequest(tx, owner.id, 'RECORDED');

  await expectApiError(resolveAdvanceDraft(tx, voidInput(request, 1, Role.ACCOUNTANT)), 409, 'Chỉ tạm ứng chưa ghi sổ được xử lý');
}));

test('a stale version is refused before anything is written', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'stale');
  const request = await mkRequest(tx, owner.id, 'RECORDED');

  await expectApiError(resolveAdvanceDraft(tx, {
    ...voidInput(request, owner.id, Role.OPS), expectedVersion: request.version + 3,
  }), 409, 'Tạm ứng đã thay đổi');
}));

test('the DRAFT withdrawal still works and keeps its own wording', () => rolledBack(async (tx) => {
  const owner = await mkOps(tx, 'draft');
  const request = await mkRequest(tx, owner.id, 'DRAFT');

  const voided = await resolveAdvanceDraft(tx, voidInput(request, owner.id, Role.OPS));

  assert.equal(voided.status, 'VOIDED');
  const [logged] = await tx.select().from(s.auditLogs).where(and(
    eq(s.auditLogs.entityType, 'advance-request-draft'), eq(s.auditLogs.entityId, request.id),
  ));
  assert.equal(logged?.message, 'Đã hủy tạm ứng chưa ghi sổ');
}));

after(async () => {
  try { await disconnectRedis(); } catch { /* already-closed is fine */ }
  try { await client.end({ timeout: 1 }); } catch { /* ignore */ }
});
