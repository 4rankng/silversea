import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import debitRoutes from '../routes/accounting-debit';
import expenseRoutes from '../routes/expense-accounting';
import { createRateAdjustmentRequests, confirmRateAdjustmentRequests, withdrawRateAdjustmentRequests } from '../services/accounting-debit-close.service';
import { createPhoiPhieuVoucher, updatePhoiPhieuMeta, voidPhoiPhieuRow } from '../services/phoi-phieu-control.service';
import { assignTruckAccountant } from '../services/expense-accounting-write.service';

import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';
import type { Tx } from '../services/trip-shared';

const prefix = `accounting-command-${Date.now()}`;
let actor: any; let server: http.Server; let base: string;
const lots: number[] = []; const trips: number[] = []; const sources: number[] = []; const ops: number[] = [];
let customerId: number; let routeId: number; let truckId: number; let accountId: number;
before(async () => {
  const [user] = await db.insert(s.users).values({ username: prefix, passwordHash: 'test', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
  actor = { userId: user.id, role: Role.ACCOUNTANT, username: prefix, fullName: prefix, email: '' };
  const [customer] = await db.insert(s.customers).values({ name: prefix }).returning(); customerId = customer.id;
  const [route] = await db.insert(s.routes).values({ name: prefix }).returning(); routeId = route.id;
  const [truck] = await db.insert(s.trucks).values({ licensePlate: `QA${Date.now()}`, status: 'ACTIVE' }).returning(); truckId = truck.id;
  const [account] = await db.insert(s.treasuryAccounts).values({ code: prefix, name: prefix, type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE', createdBy: user.id, updatedBy: user.id }).returning(); accountId = account.id;
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = actor; next(); });
  app.use('/api/accounting', debitRoutes); app.use('/api/expense-accounting', expenseRoutes); app.use(globalErrorHandler);
  server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
async function fixture(confirmed = false) {
  const [lot] = await db.insert(s.shipments).values({ customerId, routeId }).returning(); lots.push(lot.id);
  const [trip] = await db.insert(s.trips).values({ shipmentId: lot.id, customerId, routeId, departureDate: '2026-09-22', status: 'CREATED' }).returning(); trips.push(trip.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({ shipmentId: lot.id, expenseTypeCode: 'OTHER', costGroup: 'OPS_INCIDENTAL', amount: '1000', customerChargeAmount: '100000', payerKind: 'USER', paidById: actor.userId, paidAt: '2026-09-22' }).returning(); ops.push(entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({ sourceKind: 'OPS', sourceId: entry.id, shipmentId: lot.id, tripId: trip.id, confirmedAt: confirmed ? new Date() : null, version: 1 }).returning(); sources.push(source.id);
  return { lot, trip, entry, source };
}
async function request(method: string, path: string, body: unknown, key?: string) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function replay(method: string, path: string, body: unknown, drift: unknown, key: string, status = 200) {
  assert.equal((await request(method, path, body)).status, 400, 'missing command key rejected');
  const first = await request(method, path, body, key); assert.equal(first.status, status, JSON.stringify(first.body));
  assert.deepEqual(await request(method, path, body, key), first, 'retry returns original stored result');
  assert.equal((await request(method, path, drift, key)).status, 409, 'same-key payload drift rejected');
  return first.body;
}
test('rate request, confirm, and withdraw have durable result replay', async () => {
  const f = await fixture(); const root = '/api/accounting/debit-board/rate-adjustments';
  await replay('POST', root, { shipmentIds: [f.lot.id] }, { shipmentIds: [f.lot.id], ghiChu: 'changed' }, `${prefix}-request`, 201);
  const [row] = await db.select().from(s.shipmentRateAdjustmentRequests).where(eq(s.shipmentRateAdjustmentRequests.shipmentId, f.lot.id));
  await replay('POST', `${root}/confirm`, { requestIds: [row.id] }, { requestIds: [row.id + 1] }, `${prefix}-confirm`);
  const g = await fixture(); await request('POST', root, { shipmentIds: [g.lot.id] }, `${prefix}-request2`);
  const [second] = await db.select().from(s.shipmentRateAdjustmentRequests).where(eq(s.shipmentRateAdjustmentRequests.shipmentId, g.lot.id));
  await replay('POST', `${root}/withdraw`, { requestIds: [second.id] }, { requestIds: [second.id + 1] }, `${prefix}-withdraw`);
});
test('competing keys create one pending request and report existing requests accurately', async () => {
  const f = await fixture(); const root = '/api/accounting/debit-board/rate-adjustments';
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) => request('POST', root, { shipmentIds: [f.lot.id, f.lot.id] }, `${prefix}-race-${i}`)));
  assert(outcomes.every(r => r.status === 201));
  assert.equal(outcomes.reduce((n, r) => n + r.body.requested.length, 0), 1);
  assert.equal(outcomes.reduce((n, r) => n + r.body.alreadyPending.length, 0), 5);
  const rows = await db.select().from(s.shipmentRateAdjustmentRequests).where(and(eq(s.shipmentRateAdjustmentRequests.shipmentId, f.lot.id), eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'), isNull(s.shipmentRateAdjustmentRequests.withdrawnAt)));
  assert.equal(rows.length, 1);
});
test('metadata, source void, assignment, and voucher share their command transaction', async () => {
  const f = await fixture(); const root = '/api/expense-accounting/phoi-phieu';
  await replay('PUT', `${root}/${f.trip.id}/phoi-meta`, { ngayLayPhoi: '2026-09-22' }, { ngayLayPhoi: '2026-09-23' }, `${prefix}-meta`);
  await replay('DELETE', `${root}/${f.trip.id}/rows/${f.source.id}`, { reason: 'owned test' }, { reason: 'changed' }, `${prefix}-void`);
  const audits = await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, f.source.id), eq(s.auditLogs.message, 'VOID phoi-phieu fee row'))); assert.equal(audits.length, 1);
  await replay('PUT', `${root}/trucks/${truckId}/accountant`, { accountantId: actor.userId, expectedVersion: 0 }, { accountantId: null, expectedVersion: 0 }, `${prefix}-assignment`);
  const g = await fixture(true);
  const body = { tripIds: [g.trip.id], direction: 'IN', treasuryAccountId: accountId };
  const issued = await replay('POST', `${root}/vouchers`, body, { ...body, physicalReference: 'changed' }, `${prefix}-voucher`, 201);
  assert.equal(issued.total, 100000);
  const movements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId)); assert.equal(movements.length, 1); assert.equal(movements[0].amount, '100000');
});
test('outer transaction failure rolls back all optional transaction service effects', async () => {
  const f = await fixture(); const g = await fixture(true);
  const beforeMovements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId));
  await assert.rejects(db.transaction(async tx => {
    await createRateAdjustmentRequests({ shipmentIds: [f.lot.id], userId: actor.userId }, tx);
    await updatePhoiPhieuMeta(f.trip.id, { ngayLayPhoi: '2026-09-22' }, tx);
    await voidPhoiPhieuRow(f.trip.id, f.source.id, actor, 'rollback proof', tx);
    await assignTruckAccountant(tx, actor, truckId, null, 1);
    await createPhoiPhieuVoucher({ tripIds: [g.trip.id], direction: 'IN', treasuryAccountId: accountId, actor }, tx);
    throw new Error('forced outer rollback');
  }), /forced outer rollback/);
  assert.equal((await db.select().from(s.shipmentRateAdjustmentRequests).where(eq(s.shipmentRateAdjustmentRequests.shipmentId, f.lot.id))).length, 0);
  assert.equal((await db.select().from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, f.trip.id))).length, 0);
  assert.equal((await db.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, f.source.id)))[0].status, 'RECORDED');
  assert.equal((await db.select().from(s.truckAccountantAssignments).where(and(eq(s.truckAccountantAssignments.truckId, truckId), isNull(s.truckAccountantAssignments.endedAt))))[0].version, 1);
  assert.deepEqual(await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId)), beforeMovements);
});
test('replays the deployed endpoint, actor payload and plain result format for all seven commands', async () => {
  async function deployed<T>(endpoint: string, method: string, path: string, body: Record<string, unknown>,
    payload: Record<string, unknown>, create: (tx: Tx) => Promise<T>, statusCode = 200) {
    const idempotencyKey = `${prefix}-deployed-${endpoint}`;
    const original = await runIdempotent({ endpoint, idempotencyKey, payload: { ...payload, userId: actor.userId },
      createdBy: actor.userId, responseStatusCode: statusCode, create });
    const stored = (await db.select().from(s.idempotencyKeys).where(and(eq(s.idempotencyKeys.endpoint, endpoint),
      eq(s.idempotencyKeys.idempotencyKey, idempotencyKey))))[0];
    assert.deepEqual(stored.responseSnapshot, JSON.parse(JSON.stringify(original.result)), 'plain deployed result is durable');
    const replayed = await request(method, path, body, idempotencyKey);
    assert.deepEqual(replayed, { status: statusCode, body: JSON.parse(JSON.stringify(original.result)) });
    assert.equal((await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.id, stored.id)))[0].createdAt.getTime(), stored.createdAt.getTime());
  }
  const f = await fixture(); const g = await fixture(true);
  const adjustments = '/api/accounting/debit-board/rate-adjustments';
  const requestBody = { shipmentIds: [f.lot.id] };
  await deployed(IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_RATE_ADJUSTMENT_REQUEST, 'POST', adjustments, requestBody, requestBody,
    tx => createRateAdjustmentRequests({ ...requestBody, userId: actor.userId }, tx), 201);
  const [pending] = await db.select().from(s.shipmentRateAdjustmentRequests).where(eq(s.shipmentRateAdjustmentRequests.shipmentId, f.lot.id));
  const confirmBody = { requestIds: [pending.id] };
  await deployed(IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_RATE_ADJUSTMENT_CONFIRM, 'POST', `${adjustments}/confirm`, confirmBody, confirmBody,
    tx => confirmRateAdjustmentRequests({ ...confirmBody, userId: actor.userId }, tx));
  await createRateAdjustmentRequests({ shipmentIds: [g.lot.id], userId: actor.userId });
  const [withdrawal] = await db.select().from(s.shipmentRateAdjustmentRequests).where(eq(s.shipmentRateAdjustmentRequests.shipmentId, g.lot.id));
  const withdrawBody = { requestIds: [withdrawal.id] };
  await deployed(IDEMPOTENCY_ENDPOINTS.DEBIT_BOARD_RATE_ADJUSTMENT_WITHDRAW, 'POST', `${adjustments}/withdraw`, withdrawBody, withdrawBody,
    tx => withdrawRateAdjustmentRequests({ ...withdrawBody, userId: actor.userId }, tx));
  const phoi = '/api/expense-accounting/phoi-phieu'; const meta = { trangThaiLay: 'compatibility' };
  await deployed(IDEMPOTENCY_ENDPOINTS.PHOI_PHIEU_PHOI_META, 'PUT', `${phoi}/${f.trip.id}/phoi-meta`, meta, { tripId: f.trip.id, ...meta },
    tx => updatePhoiPhieuMeta(f.trip.id, meta, tx));
  const reason = 'compatibility void';
  await deployed(IDEMPOTENCY_ENDPOINTS.PHOI_PHIEU_ROW_VOID, 'DELETE', `${phoi}/${f.trip.id}/rows/${f.source.id}`, { reason },
    { tripId: f.trip.id, sourceId: f.source.id, reason }, tx => voidPhoiPhieuRow(f.trip.id, f.source.id, actor, reason, tx));
  assert.equal((await db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, f.source.id), eq(s.auditLogs.message, 'VOID phoi-phieu fee row')))).length, 1);
  const assignment = { accountantId: actor.userId, expectedVersion: 1 };
  await deployed(IDEMPOTENCY_ENDPOINTS.PHOI_PHIEU_TRUCK_ASSIGN, 'PUT', `${phoi}/trucks/${truckId}/accountant`, assignment,
    { truckId, ...assignment }, tx => assignTruckAccountant(tx, actor, truckId, assignment.accountantId, assignment.expectedVersion));
  const voucher = { tripIds: [g.trip.id], direction: 'IN' as const, treasuryAccountId: accountId };
  const before = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId));
  await deployed(IDEMPOTENCY_ENDPOINTS.PHOI_PHIEU_VOUCHER, 'POST', `${phoi}/vouchers`, voucher, voucher,
    tx => createPhoiPhieuVoucher({ ...voucher, actor }, tx), 201);
  assert.equal((await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId))).length, before.length + 1);
});
after(async () => {
  try {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (!actor) return;
  // Owned rows only; deleting documents/allocations before their sources respects FKs.
  const vouchers = await db.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.createdById, actor.userId));
  if (vouchers.length) { await db.delete(s.expenseCashAllocations).where(inArray(s.expenseCashAllocations.voucherId, vouchers.map(r => r.id))); await db.delete(s.expenseCashVouchers).where(inArray(s.expenseCashVouchers.id, vouchers.map(r => r.id))); }
  const movements = await db.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId));
  await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.treasuryAccountId, accountId));
  const receipts = await db.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.createdBy, actor.userId));
  if (receipts.length) {
    const receiptIds = receipts.map(row => row.id);
    await db.delete(s.paymentAllocations).where(inArray(s.paymentAllocations.paymentReceiptId, receiptIds));
    await db.delete(s.paymentReceipts).where(inArray(s.paymentReceipts.id, receiptIds));
  }
  const ledgerIds = movements.flatMap(r => r.ledgerEntryId ? [r.ledgerEntryId] : []); if (ledgerIds.length) await db.delete(s.ledger).where(inArray(s.ledger.id, ledgerIds));
  await db.delete(s.auditLogs).where(eq(s.auditLogs.userId, actor.userId));
  await db.delete(s.idempotencyKeys).where(eq(s.idempotencyKeys.createdBy, actor.userId));
  await db.delete(s.truckAccountantAssignments).where(eq(s.truckAccountantAssignments.truckId, truckId));
  await db.delete(s.expenseAccountingSources).where(inArray(s.expenseAccountingSources.id, sources));
  await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.id, ops));
  await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, trips));
  await db.delete(s.shipmentRateAdjustmentRequests).where(inArray(s.shipmentRateAdjustmentRequests.shipmentId, lots));
  await db.delete(s.trips).where(inArray(s.trips.id, trips)); await db.delete(s.shipments).where(inArray(s.shipments.id, lots));
  await db.delete(s.routes).where(eq(s.routes.id, routeId)); await db.delete(s.customers).where(eq(s.customers.id, customerId));
  await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, accountId)); await db.delete(s.trucks).where(eq(s.trucks.id, truckId));
  await db.delete(s.users).where(eq(s.users.id, actor.userId));
  } finally { await disconnectRedis(); await client.end(); }
});
