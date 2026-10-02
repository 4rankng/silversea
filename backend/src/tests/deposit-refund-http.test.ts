import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import depositRoutes from '../routes/accounting-deposit';
import { disconnectRedis } from '../lib/redis';
import { hashPayload, IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';

const prefix = `deposit-http-${Date.now()}`;
let server: Server; let base: string; let token: string; let userId: number; let accountId: number;
const trackerIds: number[] = []; const movementIds: number[] = []; const ledgerIds: number[] = [];
before(async () => {
  const [user] = await db.insert(s.users).values({ username: prefix, passwordHash: 'test', role: 'ACCOUNTANT', status: 'ACTIVE' }).returning();
  userId = user.id; token = jwt.sign({ userId, role: 'ACCOUNTANT' }, config.jwtSecret, { expiresIn: '1h' });
  const [account] = await db.insert(s.treasuryAccounts).values({ code: prefix, name: prefix, type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: userId, updatedBy: userId }).returning(); accountId = account.id;
  const app = express(); app.use(express.json()); app.use('/api/accounting/deposits', authMiddleware, depositRoutes); app.use(globalErrorHandler);
  server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting/deposits`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (trackerIds.length) await db.delete(s.depositRefundTrackers).where(inArray(s.depositRefundTrackers.id, trackerIds));
  if (movementIds.length) await db.delete(s.treasuryMovements).where(inArray(s.treasuryMovements.id, movementIds));
  if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, accountId));
  await db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, userId));
  await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, userId));
  await db.delete(s.users).where(eq(s.users.id, userId)); await disconnectRedis(); await client.end();
});
async function request(path: string, method: string, body: unknown, key?: string) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
describe('deposit HTTP command contract', () => {
  test('stale displayed amount posts nothing; a fresh confirmation succeeds and replays once', async () => {
    const created = await request('', 'POST', { billNumber: `${prefix}-stale`, customerName: 'Local QA', carrierName: 'Local QA', depositAmount: 4000000 }, `${prefix}-stale-create`);
    assert.equal(created.status, 201); const id = created.body.id; trackerIds.push(id);
    assert.equal((await request(`/${id}/dates`, 'PATCH', { depositAmount: 5000000 }, `${prefix}-concurrent-edit`)).status, 200);
    const key = `${prefix}-stale-refund`;
    const stale = await request(`/${id}/refund`, 'POST', { expectedDepositAmount: 4000000 }, key);
    // Capture any erroneous posting for exact cleanup even when the regression fails.
    if (stale.body.refundPostedMovementId) {
      movementIds.push(stale.body.refundPostedMovementId);
      const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.id, stale.body.refundPostedMovementId));
      if (movement.ledgerEntryId) ledgerIds.push(movement.ledgerEntryId);
    }
    assert.equal(stale.status, 409);
    const [saved] = await db.select().from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, id));
    assert.equal(saved.depositAmount, '5000000'); assert.equal(saved.status, 'CHUA_HOAN_CUOC'); assert.equal(saved.refundPostedMovementId, null);
    assert.equal((await db.select().from(s.ledger).where(eq(s.ledger.receiptId, `DEPOSIT_TRACKER:${id}`))).length, 0);
    assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, `HOAN-CUOC-${id}-${prefix}-stale`))).length, 0);
    assert.equal((await db.select().from(s.idempotencyKeys).where(and(eq(s.idempotencyKeys.endpoint, IDEMPOTENCY_ENDPOINTS.DEPOSIT_TRACKER_REFUND), eq(s.idempotencyKeys.idempotencyKey, key)))).length, 0);
    for (const invalid of [0, -1, 1.5, 1_000_000_000_000_000]) {
      assert.equal((await request(`/${id}/refund`, 'POST', { expectedDepositAmount: invalid }, `${key}-${invalid}`)).status, 400);
    }
    const body = { expectedDepositAmount: 5000000 };
    const refunded = await request(`/${id}/refund`, 'POST', body, key);
    assert.equal(refunded.status, 200); movementIds.push(refunded.body.refundPostedMovementId);
    assert.deepEqual(await request(`/${id}/refund`, 'POST', body, key), refunded);
    assert.equal((await request(`/${id}/refund`, 'POST', { expectedDepositAmount: 4000000 }, key)).status, 409);
    const movements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.physicalReference, `HOAN-CUOC-${id}-${prefix}-stale`));
    assert.equal(movements.length, 1); assert.equal(movements[0].amount, '5000000');
    if (movements[0].ledgerEntryId) ledgerIds.push(movements[0].ledgerEntryId);
    const ledger = await db.select().from(s.ledger).where(eq(s.ledger.receiptId, `DEPOSIT_TRACKER:${id}`));
    assert.equal(ledger.length, 1); assert.equal(ledger[0].credit, '5000000');
  });

  test('optional CV, keyed replay, payload conflict and refund preserve exactly one cash posting', async () => {
    const input = { billNumber: prefix, customerName: 'Local QA', carrierName: 'Local QA', depositAmount: 4000000, cvSubmittedDate: null };
    assert.equal((await request('', 'POST', input)).status, 400);
    const created = await request('', 'POST', input, `${prefix}-create`); assert.equal(created.status, 201); trackerIds.push(created.body.id);
    assert.equal(created.body.cvSubmittedDate, null);
    const [createCommand] = await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.idempotencyKey, `${prefix}-create`));
    assert.equal(createCommand.endpoint, IDEMPOTENCY_ENDPOINTS.DEPOSIT_TRACKER_CREATE);
    assert.equal(createCommand.payloadHash, hashPayload({ ...input, userId }));
    assert.deepEqual(createCommand.responseSnapshot, created.body, 'retain upstream raw response replay format');
    assert.deepEqual(await request('', 'POST', input, `${prefix}-create`), created);
    assert.equal((await request('', 'POST', { ...input, depositAmount: 5 }, `${prefix}-create`)).status, 409);
    const edit = { depositAmount: 4500000, cvSubmittedDate: '22/09/26', expectedRefundDate: null };
    const updated = await request(`/${created.body.id}/dates`, 'PATCH', edit, `${prefix}-edit`); assert.equal(updated.status, 200); assert.equal(updated.body.expectedRefundDate, '2026-10-06');
    assert.deepEqual(await request(`/${created.body.id}/dates`, 'PATCH', edit, `${prefix}-edit`), updated);
    const outcomes = await Promise.all([request(`/${created.body.id}/refund`, 'POST', {}, `${prefix}-refund`), request(`/${created.body.id}/refund`, 'POST', {}, `${prefix}-refund`)]);
    assert.equal(outcomes[0].status, 200); assert.deepEqual(outcomes[0], outcomes[1]);
    const [refundCommand] = await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.idempotencyKey, `${prefix}-refund`));
    assert.equal(refundCommand.endpoint, IDEMPOTENCY_ENDPOINTS.DEPOSIT_TRACKER_REFUND);
    assert.equal(refundCommand.payloadHash, hashPayload({ trackerId: created.body.id, userId }));
    assert.deepEqual(refundCommand.responseSnapshot, outcomes[0].body);
    const movementId = outcomes[0].body.refundPostedMovementId; movementIds.push(movementId);
    const [movement] = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.id, movementId)); if (movement.ledgerEntryId) ledgerIds.push(movement.ledgerEntryId);
    assert.equal(movement.amount, '4500000'); assert.equal(movement.direction, 'IN');
    assert.equal((await request(`/${created.body.id}/dates`, 'PATCH', { depositAmount: 1 }, `${prefix}-late-edit`)).status, 409);
    assert.equal((await request(`/${created.body.id}/refund`, 'POST', {}, `${prefix}-different-refund`)).status, 409);
    assert.equal((await request(`/${created.body.id}oops/dates`, 'PATCH', edit, `${prefix}-bad-id`)).status, 400);
  });
});
