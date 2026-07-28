import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { Role, TxnType } from '@tingting/shared';
import sharp from 'sharp';
import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import expenseRoutes from '../routes/expense';
import governanceActionsRoutes from '../routes/financial/governance-actions.routes';
import paymentsRoutes from '../routes/financial/payments.routes';
import {
  DURABLE_EFFECT_KIND,
  DURABLE_EFFECT_STATUS,
  processDueDurableEffectJobs,
  STORAGE_DELETE_MODE,
} from '../services/durable-effect.service';
import { storageService } from '../services/storage.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const idempotencyKeys: string[] = [];
const expenseIds: number[] = [];
const governanceActionIds: number[] = [];
let actorId = 0;
let managerId = 0;
let accountantId = 0;
let supplierId = 0;
let secondarySupplierId = 0;
let categoryId = 0;
let server: http.Server;
let baseUrl = '';
const uploadedStorageKeys: string[] = [];
const deletedStorageKeys: string[] = [];
const originalStorageUpload = storageService.upload.bind(storageService);
const originalStorageDelete = storageService.delete.bind(storageService);

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  expectedUpdatedAt?: string,
  userId = actorId,
) {
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(expectedUpdatedAt ? { 'If-Unmodified-Since': expectedUpdatedAt } : {}),
      ...(userId ? { 'x-user-id': String(userId) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function createPayload(amount = 100_000) {
  return {
    expenseDate: '2026-07-28',
    supplierId,
    categoryId,
    amount,
    paymentStatus: 'UNPAID',
    note: `Q23 expense ${suffix}`,
  };
}

async function governExpenseCreate(
  payload: Record<string, unknown>,
  key: string,
  makerId = managerId,
) {
  const requested = await api(
    'POST',
    '/api/expenses',
    { ...payload, reason: 'Đề nghị ghi nhận chi phí công ty' },
    key,
    undefined,
    makerId,
  );
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  governanceActionIds.push(Number(requested.body.id));
  const checked = await api(
    'POST',
    `/api/governance-actions/${requested.body.id}/check`,
    { expectedVersion: requested.body.version },
    `${key}-check`,
    undefined,
    accountantId,
  );
  assert.equal(checked.status, 200, JSON.stringify(checked.body));
  const approved = await api(
    'POST',
    `/api/governance-actions/${requested.body.id}/approve`,
    { expectedVersion: checked.body.version },
    `${key}-approve`,
    undefined,
    actorId,
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const applicationResult = approved.body.applicationResult as Record<string, unknown>;
  const expenseId = Number(applicationResult.subjectId);
  const [expense] = await db.select().from(s.expenses).where(eq(s.expenses.id, expenseId));
  assert.ok(expense);
  expenseIds.push(expenseId);
  return { requested, checked, approved, expense };
}

async function uploadPhoto(
  expenseId: number,
  idempotencyKey: string,
  buffer: Buffer,
  userId = actorId,
) {
  idempotencyKeys.push(idempotencyKey);
  const form = new FormData();
  const bytes = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'receipt.png');
  const response = await fetch(`${baseUrl}/api/expenses/${expenseId}/photos`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      ...(userId ? { 'x-user-id': String(userId) } : {}),
    },
    body: form,
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

before(async () => {
  storageService.upload = async (_buffer: Buffer, key: string) => {
    uploadedStorageKeys.push(key);
    return key;
  };
  storageService.delete = async (key: string) => {
    deletedStorageKeys.push(key);
  };

  const [actor] = await db.insert(s.users).values({
    username: `q23-expense-${suffix}`,
    passwordHash: 'x',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  actorId = actor.id;
  const [manager] = await db.insert(s.users).values({
    username: `q23-expense-manager-${suffix}`,
    passwordHash: 'x',
    role: Role.MANAGER,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  managerId = manager.id;
  const [accountant] = await db.insert(s.users).values({
    username: `q23-expense-accountant-${suffix}`,
    passwordHash: 'x',
    role: Role.ACCOUNTANT,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  accountantId = accountant.id;

  const [supplier] = await db.insert(s.suppliers).values({
    name: `Q23 supplier ${suffix}`,
    status: 'ACTIVE',
  }).returning({ id: s.suppliers.id });
  supplierId = supplier.id;

  const [category] = await db.insert(s.expenseCategories).values({
    name: `Q23 category ${suffix}`,
    status: 'ACTIVE',
  }).returning({ id: s.expenseCategories.id });
  categoryId = category.id;
  const [secondarySupplier] = await db.insert(s.suppliers).values({
    name: `Q23 secondary supplier ${suffix}`,
    status: 'ACTIVE',
  }).returning({ id: s.suppliers.id });
  secondarySupplierId = secondarySupplier.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const requestedUserId = Number(req.header('x-user-id'));
    const role = requestedUserId === managerId
      ? Role.MANAGER
      : requestedUserId === accountantId
        ? Role.ACCOUNTANT
        : Role.ADMIN;
    const userId = requestedUserId || actorId;
    req.user = {
      userId,
      username: `q23-expense-${suffix}`,
      email: null,
      fullName: null,
      role,
    };
    next();
  });
  app.use('/api/expenses', expenseRoutes);
  app.use('/api', paymentsRoutes);
  app.use('/api', governanceActionsRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  if (idempotencyKeys.length > 0) {
    await db.delete(s.idempotencyKeys)
      .where(inArray(s.idempotencyKeys.idempotencyKey, [...new Set(idempotencyKeys)]));
  }
  if (supplierId > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      eq(s.ledger.entityId, supplierId),
    ));
  }
  if (secondarySupplierId > 0) {
    await db.delete(s.ledger).where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      eq(s.ledger.entityId, secondarySupplierId),
    ));
  }
  if (expenseIds.length > 0) {
    await db.delete(s.expensePhotos)
      .where(inArray(s.expensePhotos.expenseId, expenseIds));
    await db.delete(s.expenses).where(inArray(s.expenses.id, expenseIds));
  }
  const scopedDurableJobs = (await db.select({
    id: s.durableEffectJobs.id,
    payload: s.durableEffectJobs.payload,
  }).from(s.durableEffectJobs)).filter((row) => {
    const payload = row.payload as Record<string, unknown>;
    const storageKey = typeof payload.storageKey === 'string' ? payload.storageKey : null;
    const entityId = typeof payload.entityId === 'number' ? payload.entityId : null;
    return (
      (storageKey !== null && uploadedStorageKeys.includes(storageKey))
      || (entityId !== null && expenseIds.includes(entityId))
    );
  });
  if (scopedDurableJobs.length > 0) {
    await db.delete(s.durableEffectJobs)
      .where(inArray(s.durableEffectJobs.id, scopedDurableJobs.map((row) => row.id)));
  }
  if (governanceActionIds.length > 0) {
    await db.delete(s.governanceActions)
      .where(inArray(s.governanceActions.id, governanceActionIds));
  }
  if (categoryId > 0) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId));
  }
  if (supplierId > 0) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  }
  if (secondarySupplierId > 0) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, secondarySupplierId));
  }
  if (actorId > 0 || managerId > 0 || accountantId > 0) {
    await db.delete(s.users)
      .where(inArray(s.users.id, [actorId, managerId, accountantId].filter(Boolean)));
  }
  storageService.upload = originalStorageUpload;
  storageService.delete = originalStorageDelete;
  await disconnectRedis();
  await client.end();
});

describe('Q23 company expense replay and concurrency', () => {
  it('requires a transaction key before creating an expense', async () => {
    const response = await api('POST', '/api/expenses', createPayload());
    assert.equal(response.status, 400);
    assert.match(String(response.body.error ?? ''), /Idempotency-Key/);
  });

  it('keeps create and payable effects pending, replays exactly, and governs paid deletion', async () => {
    const createKey = `q23-expense-create-${suffix}`;
    const createBody = { ...createPayload(), reason: 'Đề nghị ghi nhận chi phí công ty' };
    const countBefore = await db.select().from(s.expenses);
    const requested = await api('POST', '/api/expenses', createBody, createKey, undefined, managerId);
    const createReplay = await api('POST', '/api/expenses', createBody, createKey, undefined, managerId);
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    assert.equal(createReplay.status, 200);
    assert.equal(createReplay.body.replayed, true);
    assert.equal(createReplay.body.id, requested.body.id);
    governanceActionIds.push(Number(requested.body.id));
    const pendingRows = await db.select().from(s.expenses);
    assert.equal(pendingRows.length, countBefore.length);
    const pendingLedger = await db.select().from(s.ledger).where(and(
      eq(s.ledger.entityType, 'VENDOR'),
      eq(s.ledger.entityId, supplierId),
      eq(s.ledger.txnType, TxnType.VENDOR_EXPENSE),
    ));
    assert.equal(pendingLedger.length, 0);
    const checkedCreate = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/check`,
      { expectedVersion: requested.body.version },
      `${createKey}-check`,
      undefined,
      accountantId,
    );
    const approvedCreate = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/approve`,
      { expectedVersion: checkedCreate.body.version },
      `${createKey}-approve`,
      undefined,
      actorId,
    );
    assert.equal(approvedCreate.status, 200, JSON.stringify(approvedCreate.body));
    const expenseId = Number((approvedCreate.body.applicationResult as Record<string, unknown>).subjectId);
    expenseIds.push(expenseId);
    const [createdExpense] = await db.select().from(s.expenses).where(eq(s.expenses.id, expenseId));
    assert.ok(createdExpense);
    const originalVersion = createdExpense.updatedAt.toISOString();
    const missingVersion = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { amount: 110_000 },
      `q23-expense-missing-version-${suffix}`,
    );
    assert.equal(missingVersion.status, 428);

    const [left, right] = await Promise.all([
      api(
        'PUT',
        `/api/expenses/${expenseId}`,
        { note: 'ghi chu cap nhat trai' },
        `q23-expense-update-left-${suffix}`,
        originalVersion,
      ),
      api(
        'PUT',
        `/api/expenses/${expenseId}`,
        { note: 'ghi chu cap nhat phai' },
        `q23-expense-update-right-${suffix}`,
        originalVersion,
      ),
    ]);
    assert.deepEqual(
      [left.status, right.status].sort(),
      [200, 409],
      JSON.stringify({ left, right }),
    );
    const winner = left.status === 200 ? left : right;
    const winnerKey = left.status === 200
      ? `q23-expense-update-left-${suffix}`
      : `q23-expense-update-right-${suffix}`;
    const winnerNote = String(winner.body.note);
    const updateReplay = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { note: winnerNote },
      winnerKey,
      originalVersion,
    );
    assert.deepEqual(updateReplay, winner);

    const ledgerAfterUpdate = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        eq(s.ledger.entityId, supplierId),
        inArray(s.ledger.txnType, [TxnType.VENDOR_EXPENSE, TxnType.ADJUSTMENT]),
      ));
    assert.equal(ledgerAfterUpdate.length, 1);

    const paidCreated = await governExpenseCreate(
      { ...createPayload(160_000), paymentStatus: 'PAID', note: `Q23 paid ${suffix}` },
      `q23-expense-paid-${suffix}`,
    );
    const paidExpenseId = paidCreated.expense.id;
    const paidVersion = paidCreated.expense.updatedAt.toISOString();

    const staleDelete = await api(
      'DELETE',
      `/api/expenses/${paidExpenseId}`,
      { reason: 'Hoàn tác khoản chi đã thanh toán' },
      `q23-expense-stale-delete-${suffix}`,
      originalVersion,
      managerId,
    );
    assert.equal(staleDelete.status, 409);

    const deleteKey = `q23-expense-delete-${suffix}`;
    const deleted = await api(
      'DELETE',
      `/api/expenses/${paidExpenseId}`,
      { reason: 'Hoàn tác khoản chi đã thanh toán' },
      deleteKey,
      paidVersion,
      managerId,
    );
    const deleteReplay = await api(
      'DELETE',
      `/api/expenses/${paidExpenseId}`,
      { reason: 'Hoàn tác khoản chi đã thanh toán' },
      deleteKey,
      paidVersion,
      managerId,
    );
    assert.equal(deleted.status, 201);
    assert.equal(deleteReplay.status, 200);
    assert.equal(deleteReplay.body.replayed, true);
    governanceActionIds.push(Number(deleted.body.id));
    const stillPresent = await db.select().from(s.expenses).where(eq(s.expenses.id, paidExpenseId));
    assert.equal(stillPresent[0]?.deletedAt, null);
    const checkedDelete = await api(
      'POST',
      `/api/governance-actions/${deleted.body.id}/check`,
      { expectedVersion: deleted.body.version },
      `${deleteKey}-check`,
      undefined,
      accountantId,
    );
    const approvedDelete = await api(
      'POST',
      `/api/governance-actions/${deleted.body.id}/approve`,
      { expectedVersion: checkedDelete.body.version },
      `${deleteKey}-approve`,
      undefined,
      actorId,
    );
    assert.equal(approvedDelete.status, 200);
    const [softDeletedPaid] = await db.select().from(s.expenses).where(eq(s.expenses.id, paidExpenseId));
    assert.ok(softDeletedPaid.deletedAt);

    const ledgerAfterDelete = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        eq(s.ledger.entityId, supplierId),
        inArray(s.ledger.txnType, [TxnType.VENDOR_EXPENSE, TxnType.ADJUSTMENT]),
      ));
    assert.equal(ledgerAfterDelete.length, 1);
  });

  it('routes material unpaid changes through governance with replay and one approval winner', async () => {
    const created = await governExpenseCreate(
      createPayload(180_000),
      `q23-expense-governed-parent-${suffix}`,
    );
    const expenseId = created.expense.id;
    const originalVersion = created.expense.updatedAt.toISOString();

    const requested = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { amount: 210_000, reason: 'Điều chỉnh chi phí công ty' },
      `q23-expense-governed-update-${suffix}`,
      originalVersion,
      managerId,
    );
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    assert.equal(requested.body.actionKind, 'COMPANY_EXPENSE');
    governanceActionIds.push(Number(requested.body.id));

    const requestReplay = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { amount: 210_000, reason: 'Điều chỉnh chi phí công ty' },
      `q23-expense-governed-update-${suffix}`,
      originalVersion,
      managerId,
    );
    assert.equal(requestReplay.status, 200);
    assert.equal(requestReplay.body.replayed, true);

    const requestConflict = await api(
      'PUT',
      `/api/expenses/${expenseId}`,
      { amount: 215_000, reason: 'Đổi số tiền' },
      `q23-expense-governed-update-${suffix}`,
      originalVersion,
      managerId,
    );
    assert.equal(requestConflict.status, 409);

    const checked = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/check`,
      { expectedVersion: requested.body.version },
      `q23-expense-governed-check-${suffix}`,
      undefined,
      accountantId,
    );
    assert.equal(checked.status, 200, JSON.stringify(checked.body));

    const [approvedLeft, approvedRight] = await Promise.all([
      api(
        'POST',
        `/api/governance-actions/${requested.body.id}/approve`,
        { expectedVersion: checked.body.version },
        `q23-expense-governed-approve-left-${suffix}`,
        undefined,
        actorId,
      ),
      api(
        'POST',
        `/api/governance-actions/${requested.body.id}/approve`,
        { expectedVersion: checked.body.version },
        `q23-expense-governed-approve-right-${suffix}`,
        undefined,
        actorId,
      ),
    ]);
    assert.deepEqual([approvedLeft.status, approvedRight.status].sort(), [200, 409]);

    const [updatedExpense] = await db.select()
      .from(s.expenses)
      .where(eq(s.expenses.id, expenseId));
    assert.equal(updatedExpense.amount, '210000');

    const adjustmentRows = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        eq(s.ledger.entityId, supplierId),
        eq(s.ledger.txnId, expenseId),
        inArray(s.ledger.txnType, [TxnType.VENDOR_EXPENSE, TxnType.ADJUSTMENT]),
      ));
    assert.equal(adjustmentRows.length, 3);

    const deleteRequested = await api(
      'DELETE',
      `/api/expenses/${expenseId}`,
      { reason: 'Hoàn tác khoản chi' },
      `q23-expense-governed-delete-${suffix}`,
      String(updatedExpense.updatedAt.toISOString()),
      managerId,
    );
    assert.equal(deleteRequested.status, 201, JSON.stringify(deleteRequested.body));
    governanceActionIds.push(Number(deleteRequested.body.id));

    const deleteChecked = await api(
      'POST',
      `/api/governance-actions/${deleteRequested.body.id}/check`,
      { expectedVersion: deleteRequested.body.version },
      `q23-expense-governed-delete-check-${suffix}`,
      undefined,
      accountantId,
    );
    assert.equal(deleteChecked.status, 200, JSON.stringify(deleteChecked.body));

    const deleted = await api(
      'POST',
      `/api/governance-actions/${deleteRequested.body.id}/approve`,
      { expectedVersion: deleteChecked.body.version },
      `q23-expense-governed-delete-approve-${suffix}`,
      undefined,
      actorId,
    );
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const [deletedExpense] = await db.select()
      .from(s.expenses)
      .where(eq(s.expenses.id, expenseId));
    assert.ok(deletedExpense.deletedAt);

    const finalLedgerRows = await db.select()
      .from(s.ledger)
      .where(and(
        eq(s.ledger.entityType, 'VENDOR'),
        eq(s.ledger.entityId, supplierId),
        eq(s.ledger.txnId, expenseId),
        inArray(s.ledger.txnType, [TxnType.VENDOR_EXPENSE, TxnType.ADJUSTMENT]),
      ));
    assert.equal(finalLedgerRows.length, 4);
  });

  it('replaces a finalized expense append-only after governance and preserves rejected or returned sources', async () => {
    const created = await governExpenseCreate(
      { ...createPayload(320_000), paymentStatus: 'PAID', note: `Q15 finalized ${suffix}` },
      `q15-finalized-source-${suffix}`,
    );
    const original = created.expense;
    await db.insert(s.expensePhotos).values({
      expenseId: original.id,
      storageKey: `q15-finalized/${suffix}/receipt.jpg`,
      uploadedBy: managerId,
    });
    const ledgerBefore = await db.select({ id: s.ledger.id }).from(s.ledger);
    const updateKey = `q15-finalized-update-${suffix}`;
    const requested = await api(
      'PUT',
      `/api/expenses/${original.id}`,
      {
        amount: 355_000,
        supplierId: secondarySupplierId,
        reason: 'Điều chỉnh phiếu đã quyết toán theo đối chiếu cuối kỳ',
      },
      updateKey,
      original.updatedAt.toISOString(),
      managerId,
    );
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    assert.equal(
      (requested.body.deltaSnapshot as Record<string, unknown>).applicationMode,
      'FINALIZED_REPLACEMENT',
    );
    governanceActionIds.push(Number(requested.body.id));
    const replay = await api(
      'PUT',
      `/api/expenses/${original.id}`,
      {
        amount: 355_000,
        supplierId: secondarySupplierId,
        reason: 'Điều chỉnh phiếu đã quyết toán theo đối chiếu cuối kỳ',
      },
      updateKey,
      original.updatedAt.toISOString(),
      managerId,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, requested.body.id);
    assert.equal(replay.body.replayed, true);
    const drift = await api(
      'PUT',
      `/api/expenses/${original.id}`,
      {
        amount: 360_000,
        supplierId: secondarySupplierId,
        reason: 'Thay đổi nội dung cùng khóa',
      },
      updateKey,
      original.updatedAt.toISOString(),
      managerId,
    );
    assert.equal(drift.status, 409);
    const [pendingOriginal] = await db.select().from(s.expenses)
      .where(eq(s.expenses.id, original.id));
    assert.equal(pendingOriginal.amount, '320000');
    assert.equal(pendingOriginal.supplierId, supplierId);
    assert.equal(pendingOriginal.deletedAt, null);
    assert.equal((await db.select({ id: s.ledger.id }).from(s.ledger)).length, ledgerBefore.length);

    const checked = await api(
      'POST',
      `/api/governance-actions/${requested.body.id}/check`,
      { expectedVersion: requested.body.version },
      `${updateKey}-check`,
      undefined,
      accountantId,
    );
    const [approvedLeft, approvedRight] = await Promise.all([
      api(
        'POST',
        `/api/governance-actions/${requested.body.id}/approve`,
        { expectedVersion: checked.body.version },
        `${updateKey}-approve-left`,
        undefined,
        actorId,
      ),
      api(
        'POST',
        `/api/governance-actions/${requested.body.id}/approve`,
        { expectedVersion: checked.body.version },
        `${updateKey}-approve-right`,
        undefined,
        actorId,
      ),
    ]);
    assert.deepEqual([approvedLeft.status, approvedRight.status].sort(), [200, 409]);
    const approved = approvedLeft.status === 200 ? approvedLeft : approvedRight;
    const applicationResult = approved.body.applicationResult as Record<string, unknown>;
    const replacementId = Number(applicationResult.replacementSubjectId);
    expenseIds.push(replacementId);
    assert.equal(applicationResult.originalPreserved, true);
    const [preservedOriginal] = await db.select().from(s.expenses)
      .where(eq(s.expenses.id, original.id));
    const [replacement] = await db.select().from(s.expenses)
      .where(eq(s.expenses.id, replacementId));
    assert.ok(preservedOriginal.deletedAt);
    assert.equal(preservedOriginal.amount, '320000');
    assert.equal(preservedOriginal.supplierId, supplierId);
    assert.equal(replacement.deletedAt, null);
    assert.equal(replacement.amount, '355000');
    assert.equal(replacement.supplierId, secondarySupplierId);
    assert.equal(replacement.paymentStatus, 'PAID');
    const originalPhotos = await db.select().from(s.expensePhotos)
      .where(eq(s.expensePhotos.expenseId, original.id));
    const replacementPhotos = await db.select().from(s.expensePhotos)
      .where(eq(s.expensePhotos.expenseId, replacementId));
    assert.equal(originalPhotos.length, 1);
    assert.equal(replacementPhotos.length, 0);
    assert.equal((await db.select({ id: s.ledger.id }).from(s.ledger)).length, ledgerBefore.length);

    const staleSource = await governExpenseCreate(
      { ...createPayload(390_000), paymentStatus: 'PAID', note: `Q15 stale correction ${suffix}` },
      `q15-finalized-stale-source-${suffix}`,
    );
    const noteUpdate = await api(
      'PUT',
      `/api/expenses/${staleSource.expense.id}`,
      { note: 'Bổ sung ghi chú không tài chính' },
      `q15-finalized-note-update-${suffix}`,
      staleSource.expense.updatedAt.toISOString(),
      managerId,
    );
    assert.equal(noteUpdate.status, 200);
    const staleRequest = await api(
      'PUT',
      `/api/expenses/${staleSource.expense.id}`,
      { amount: 395_000, reason: 'Phiên bản điều chỉnh đã cũ' },
      `q15-finalized-stale-request-${suffix}`,
      staleSource.expense.updatedAt.toISOString(),
      managerId,
    );
    assert.equal(staleRequest.status, 409);

    const rejectedSource = await governExpenseCreate(
      { ...createPayload(410_000), paymentStatus: 'PAID', note: `Q15 rejected correction ${suffix}` },
      `q15-finalized-rejected-source-${suffix}`,
    );
    const rejectedRequest = await api(
      'PUT',
      `/api/expenses/${rejectedSource.expense.id}`,
      { amount: 420_000, reason: 'Đề nghị điều chỉnh bị từ chối' },
      `q15-finalized-rejected-request-${suffix}`,
      rejectedSource.expense.updatedAt.toISOString(),
      managerId,
    );
    governanceActionIds.push(Number(rejectedRequest.body.id));
    const rejectedAction = await api(
      'POST',
      `/api/governance-actions/${rejectedRequest.body.id}/reject`,
      { expectedVersion: rejectedRequest.body.version, reason: 'Không đủ căn cứ điều chỉnh' },
      `q15-finalized-rejected-action-${suffix}`,
      undefined,
      actorId,
    );
    assert.equal(rejectedAction.status, 200);
    const [unchangedAfterReject] = await db.select().from(s.expenses)
      .where(eq(s.expenses.id, rejectedSource.expense.id));
    assert.equal(unchangedAfterReject.amount, '410000');
    assert.equal(unchangedAfterReject.deletedAt, null);

    const returnedRequest = await api(
      'PUT',
      `/api/expenses/${rejectedSource.expense.id}`,
      { amount: 425_000, reason: 'Đề nghị bổ sung chứng từ điều chỉnh' },
      `q15-finalized-returned-request-${suffix}`,
      rejectedSource.expense.updatedAt.toISOString(),
      managerId,
    );
    governanceActionIds.push(Number(returnedRequest.body.id));
    const returnedAction = await api(
      'POST',
      `/api/governance-actions/${returnedRequest.body.id}/return-for-evidence`,
      { expectedVersion: returnedRequest.body.version, reason: 'Bổ sung biên bản đối chiếu' },
      `q15-finalized-returned-action-${suffix}`,
      undefined,
      accountantId,
    );
    assert.equal(returnedAction.status, 200);
    const [unchangedAfterReturn] = await db.select().from(s.expenses)
      .where(eq(s.expenses.id, rejectedSource.expense.id));
    assert.equal(unchangedAfterReturn.amount, '410000');
    assert.equal(unchangedAfterReturn.deletedAt, null);
  });

  it('applies no create or paid-delete effect when governance is rejected', async () => {
    const expenseCountBefore = (await db.select({ id: s.expenses.id }).from(s.expenses)).length;
    const payableCountBefore = (await db.select({ id: s.ledger.id })
      .from(s.ledger)
      .where(eq(s.ledger.txnType, TxnType.VENDOR_EXPENSE))).length;
    const createKey = `q23-expense-rejected-create-${suffix}`;
    const requestedCreate = await api(
      'POST',
      '/api/expenses',
      { ...createPayload(175_000), reason: 'Chi phí chờ đối chiếu chứng từ' },
      createKey,
      undefined,
      managerId,
    );
    governanceActionIds.push(Number(requestedCreate.body.id));
    const rejectedCreate = await api(
      'POST',
      `/api/governance-actions/${requestedCreate.body.id}/reject`,
      { expectedVersion: requestedCreate.body.version, reason: 'Chứng từ không đủ căn cứ' },
      `${createKey}-reject`,
      undefined,
      actorId,
    );
    assert.equal(rejectedCreate.status, 200);
    assert.equal(rejectedCreate.body.status, 'REJECTED');
    assert.equal((await db.select({ id: s.expenses.id }).from(s.expenses)).length, expenseCountBefore);
    assert.equal(
      (await db.select({ id: s.ledger.id })
        .from(s.ledger)
        .where(eq(s.ledger.txnType, TxnType.VENDOR_EXPENSE))).length,
      payableCountBefore,
    );

    const paidCreated = await governExpenseCreate(
      { ...createPayload(185_000), paymentStatus: 'PAID', note: `Q23 rejected delete ${suffix}` },
      `q23-expense-rejected-delete-source-${suffix}`,
    );
    const deleteKey = `q23-expense-rejected-delete-${suffix}`;
    const requestedDelete = await api(
      'DELETE',
      `/api/expenses/${paidCreated.expense.id}`,
      { reason: 'Đề nghị hủy khoản chi đã thanh toán' },
      deleteKey,
      paidCreated.expense.updatedAt.toISOString(),
      managerId,
    );
    governanceActionIds.push(Number(requestedDelete.body.id));
    const rejectedDelete = await api(
      'POST',
      `/api/governance-actions/${requestedDelete.body.id}/reject`,
      { expectedVersion: requestedDelete.body.version, reason: 'Không chấp thuận hủy khoản chi' },
      `${deleteKey}-reject`,
      undefined,
      actorId,
    );
    assert.equal(rejectedDelete.status, 200);
    assert.equal(rejectedDelete.body.status, 'REJECTED');
    const [unchangedPaid] = await db.select()
      .from(s.expenses)
      .where(eq(s.expenses.id, paidCreated.expense.id));
    assert.equal(unchangedPaid.deletedAt, null);
  });

  it('uses a deterministic photo object key and replays upload/delete without duplicate effects', async () => {
    const created = await governExpenseCreate(
      createPayload(140_000),
      `q23-expense-photo-parent-${suffix}`,
    );
    const expenseId = created.expense.id;

    const redPng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    }).png().toBuffer();
    const bluePng = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    }).png().toBuffer();

    const uploadKey = `q23-expense-photo-upload-${suffix}`;
    const uploaded = await uploadPhoto(expenseId, uploadKey, redPng);
    const uploadReplay = await uploadPhoto(expenseId, uploadKey, redPng);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    assert.deepEqual(uploadReplay, uploaded);
    assert.equal(uploadedStorageKeys.length, 1);

    const conflictingUpload = await uploadPhoto(expenseId, uploadKey, bluePng);
    assert.equal(conflictingUpload.status, 409);
    assert.equal(uploadedStorageKeys.length, 1);

    const photoId = Number(uploaded.body.id);
    const photoRows = await db.select()
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.id, photoId));
    assert.equal(photoRows.length, 1);
    assert.equal(photoRows[0].storageKey, uploadedStorageKeys[0]);

    const deleteKey = `q23-expense-photo-delete-${suffix}`;
    const deleted = await api(
      'DELETE',
      `/api/expenses/${expenseId}/photos/${photoId}`,
      undefined,
      deleteKey,
    );
    const deleteReplay = await api(
      'DELETE',
      `/api/expenses/${expenseId}/photos/${photoId}`,
      undefined,
      deleteKey,
    );
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleteReplay, deleted);
    assert.deepEqual(deletedStorageKeys, []);

    const remaining = await db.select()
      .from(s.expensePhotos)
      .where(eq(s.expensePhotos.id, photoId));
    assert.equal(remaining.length, 0);

    const [deleteJob] = (await db.select()
      .from(s.durableEffectJobs)
      .where(eq(s.durableEffectJobs.kind, DURABLE_EFFECT_KIND.STORAGE_DELETE)))
      .filter((row) => {
        const payload = row.payload as Record<string, unknown>;
        return payload.storageKey === uploadedStorageKeys[0]
          && payload.mode === STORAGE_DELETE_MODE.FINAL_DELETE;
      });
    assert.ok(deleteJob);
    assert.equal(deleteJob.status, DURABLE_EFFECT_STATUS.PENDING);
    await db.update(s.durableEffectJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(s.durableEffectJobs.id, deleteJob.id));

    const processed = await processDueDurableEffectJobs(10, {
      now: () => new Date(Date.now() + 60_000),
    });
    const processedDeleteJob = processed.find((job) => job.id === deleteJob.id);
    assert.equal(processedDeleteJob?.status, DURABLE_EFFECT_STATUS.SUCCEEDED);
    assert.deepEqual([...new Set(deletedStorageKeys)], uploadedStorageKeys);
  });
});
