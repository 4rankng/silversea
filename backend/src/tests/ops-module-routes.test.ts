import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { authMiddleware, assetAuthMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { initEnforcer } from '../casbin/enforcer';
import { globalErrorHandler } from '../middleware/errorHandler';
import opsRoutes from '../routes/ops';
import { photosRouter } from '../routes/upload';

/**
 * Ops module route tests (docs/prd/OpsVanHanh.md §9 P0): RBAC matrix, pins,
 * expense lifecycle incl. photo gate + resend, wallet formula, settlement
 * freeze/approve/reject, fleet assignment + read model.
 */
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUserIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdExpenseTypeCodes: string[] = [];
const createdShipmentIds: number[] = [];
const createdContainerIds: number[] = [];
const createdTruckIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTripIds: number[] = [];
const createdDriverIds: number[] = [];
const createdAdvanceIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdSettlementIds: number[] = [];
let server: http.Server;
let baseUrl: string;
let opsToken: string;
let opsUser: { id: number; username: string | null; role: string };
let ops2Token: string;
let adminToken: string;
let accountantToken: string;
let driverToken: string;
let cusToken: string;

const today = new Date();
const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

function sign(user: { id: number; username: string | null; role: Role | string }) {
  return jwt.sign(
    { userId: user.id, username: user.username ?? `user-${user.id}`, role: user.role as Role },
    config.jwtSecret,
  );
}

async function mkUser(username: string, role: Role) {
  const [user] = await db.insert(s.users).values({
    username,
    passwordHash: await bcrypt.hash('admin123', 10),
    role,
    fullName: username,
  }).returning();
  createdUserIds.push(user.id);
  return user;
}

async function api(
  path: string,
  init: { method?: string; token?: string; body?: unknown; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const method = init.method ?? 'GET';
  // Material ops endpoints run runIdempotent and require the key; the test
  // client sends a fresh one per call (replay behavior is not under test
  // here — the idempotency service has its own suite).
  if (method !== 'GET') headers['Idempotency-Key'] = init.idempotencyKey ?? `test-${Math.random()}`;
  const response = await fetch(`${baseUrl}/api/ops${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body } as { status: number; body: any };
}

before(async () => {
  // casbinAuthz('photos') evaluates DB-backed policies; the mini-app must
  // initialize the enforcer just like the production server does.
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use('/api/ops', authMiddleware, opsRoutes);
  // Mount the photo-serving chain exactly as the production server does so
  // the allowlist assertion below exercises THIS tree's code — the test used
  // to lean on whatever dev server answered on :3001 (wrong-tree answers).
  app.use('/api/photos', assetAuthMiddleware, casbinAuthz('photos'), photosRouter);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  opsUser = await mkUser(`ops-portal-a-${suffix}`, Role.OPS);
  opsToken = sign(opsUser);
  ops2Token = sign(await mkUser(`ops-portal-b-${suffix}`, Role.OPS));
  adminToken = sign(await mkUser(`ops-portal-admin-${suffix}`, Role.ADMIN));
  accountantToken = sign(await mkUser(`ops-portal-ketoan-${suffix}`, Role.ACCOUNTANT));
  driverToken = sign(await mkUser(`ops-portal-laixe-${suffix}`, Role.DRIVER));
  cusToken = sign(await mkUser(`ops-portal-cus-${suffix}`, Role.CUS));
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    try {
      await db.delete(s.userShipmentPins).where(inArray(s.userShipmentPins.userId, createdUserIds.length ? createdUserIds : [-1]));
      if (createdExpenseIds.length) {
        await db.delete(s.auditLogs).where(and(
          eq(s.auditLogs.entityType, 'ops-expense-entries'),
          inArray(s.auditLogs.entityId, createdExpenseIds),
        ));
      }
      await db.delete(s.opsExpensePhotos)
        .where(createdExpenseIds.length ? inArray(s.opsExpensePhotos.opsExpenseId, createdExpenseIds) : eq(s.opsExpensePhotos.opsExpenseId, -1));
      await db.delete(s.opsExpenseEntries)
        .where(createdExpenseIds.length ? inArray(s.opsExpenseEntries.id, createdExpenseIds) : eq(s.opsExpenseEntries.id, -1));
      await db.delete(s.opsSettlements)
        .where(createdSettlementIds.length ? inArray(s.opsSettlements.id, createdSettlementIds) : eq(s.opsSettlements.id, -1));
      await db.delete(s.advanceRequests)
        .where(createdAdvanceIds.length ? inArray(s.advanceRequests.id, createdAdvanceIds) : eq(s.advanceRequests.id, -1));
      await db.delete(s.truckOpsAssignments).where(inArray(s.truckOpsAssignments.opsUserId, createdUserIds.length ? createdUserIds : [-1]));
      if (createdTripIds.length) {
        await db.delete(s.driverProgressEvents).where(inArray(s.driverProgressEvents.tripId, createdTripIds));
        await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
      }
      if (createdDriverIds.length) await db.delete(s.drivers).where(inArray(s.drivers.id, createdDriverIds));
      if (createdContainerIds.length) await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdContainerIds));
      if (createdShipmentIds.length) await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
      if (createdTruckIds.length) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
      if (createdRouteIds.length) await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
      if (createdExpenseTypeCodes.length) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.code, createdExpenseTypeCodes));
      if (createdCustomerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
      await db.delete(s.users).where(inArray(s.users.id, createdUserIds.length ? createdUserIds : [-1]));
    } finally {
      await client.end();
    }
  }
});

describe('ops module RBAC (PRD §2)', () => {
  test('portal routes are OPS-only; other roles get 403', async () => {
    const forDriver = await api('/orders', { token: driverToken });
    assert.equal(forDriver.status, 403);
    const forCus = await api('/orders', { token: cusToken });
    assert.equal(forCus.status, 403);
    const forAccountant = await api('/orders', { token: accountantToken });
    assert.equal(forAccountant.status, 403);
    const forOps = await api('/orders', { token: opsToken });
    assert.equal(forOps.status, 200);
  });

  test('expense approvals require ADMIN/MANAGER/ACCOUNTANT; OPS cannot', async () => {
    const res = await api('/admin/expenses', { token: opsToken });
    assert.equal(res.status, 403);
    const ok = await api('/admin/expenses', { token: accountantToken });
    assert.equal(ok.status, 200);
  });
});

describe('ops orders + pins (PRD §3)', () => {
  let shipmentId: number;

  before(async () => {
    const [customer] = await db.insert(s.customers).values({
      name: `OPS Test KH ${suffix}`,
      code: `OPSKH-${suffix.slice(0, 12)}`,
    }).returning();
    createdCustomerIds.push(customer.id);

    const [shipment] = await db.insert(s.shipments).values({
      shipmentCode: `OPS-${suffix}-1`,
      customerId: customer.id,
      expectedDeliveryDate: isoDate,
      status: 'READY_FOR_DISPATCH',
      tradeDirection: 'IMPORT',
      blNumber: `BL-${suffix}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    shipmentId = shipment.id;

    const [canceled] = await db.insert(s.shipments).values({
      shipmentCode: `OPS-${suffix}-2`,
      customerId: customer.id,
      expectedDeliveryDate: isoDate,
      status: 'CANCELED',
    }).returning();
    createdShipmentIds.push(canceled.id);

    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id,
      containerNumber: `TSTU${suffix.replace(/[^0-9]/g, '').slice(0, 7) || '1234567'}`,
    }).returning();
    createdContainerIds.push(container.id);
  });

  test('lists today company-wide lots, skips canceled, exposes containers', async () => {
    const res = await api(`/orders?date=${isoDate}`, { token: opsToken });
    assert.equal(res.status, 200);
    const codes = res.body.items.map((item: any) => item.shipmentCode);
    assert.ok(codes.includes(`OPS-${suffix}-1`));
    assert.ok(!codes.includes(`OPS-${suffix}-2`));
    const mine = res.body.items.find((item: any) => item.shipmentCode === `OPS-${suffix}-1`);
    assert.equal(mine.containerCount, 1);
    assert.equal(mine.customerName, `OPS Test KH ${suffix}`);
  });

  test('search matches container numbers', async () => {
    const mine = (await api(`/orders?date=${isoDate}`, { token: opsToken })).body.items
      .find((item: any) => item.shipmentCode === `OPS-${suffix}-1`);
    const res = await api(`/orders?date=${isoDate}&q=${mine.containerNumbers[0]}`, { token: opsToken });
    const codes = res.body.items.map((item: any) => item.shipmentCode);
    assert.ok(codes.includes(`OPS-${suffix}-1`));
  });

  test('pins are per-user PUT-set state and float the row to the top', async () => {
    const on = await api(`/orders/shipment-pins/${createdShipmentIds[0]}`, { method: 'PUT', token: opsToken, body: { pinned: true } });
    assert.equal(on.status, 200);
    assert.equal(on.body.pinned, true);

    // Replay converges (PUT semantics), it does not flip back.
    const replay = await api(`/orders/shipment-pins/${createdShipmentIds[0]}`, { method: 'PUT', token: opsToken, body: { pinned: true } });
    assert.equal(replay.body.pinned, true);

    const list = (await api(`/orders?date=${isoDate}`, { token: opsToken })).body.items;
    assert.equal(list[0].shipmentCode, `OPS-${suffix}-1`);
    assert.equal(list[0].pinned, true);

    // Other ops account does not see the pin.
    const other = (await api(`/orders?date=${isoDate}`, { token: ops2Token })).body.items;
    const otherRow = other.find((item: any) => item.shipmentCode === `OPS-${suffix}-1`);
    assert.equal(otherRow.pinned, false);

    const off = await api(`/orders/shipment-pins/${createdShipmentIds[0]}`, { method: 'PUT', token: opsToken, body: { pinned: false } });
    assert.equal(off.body.pinned, false);
  });
});

describe('ops expenses + wallet (PRD §3.3, §5)', () => {
  let shipmentId: number;
  let containerId: number;
  const withInvoiceCode = `OPS-T1-${suffix.slice(0, 10)}`;
  const noInvoiceCode = `OPS-T2-${suffix.slice(0, 10)}`;

  before(async () => {
    const [customer] = await db.insert(s.customers).values({
      name: `OPS Chi KH ${suffix}`,
      code: `OPSCHI-${suffix.slice(0, 12)}`,
    }).returning();
    createdCustomerIds.push(customer.id);

    const [shipment] = await db.insert(s.shipments).values({
      shipmentCode: `OPS-CHI-${suffix}`,
      customerId: customer.id,
      expectedDeliveryDate: isoDate,
      tradeDirection: 'EXPORT',
      bookingRef: `BK-${suffix}`,
    }).returning();
    createdShipmentIds.push(shipment.id);
    shipmentId = shipment.id;

    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId,
      containerNumber: `TSTU${(Date.now() % 10000000).toString().padStart(7, '0')}`,
    }).returning();
    createdContainerIds.push(container.id);
    containerId = container.id;

    for (const [code, requiresInvoice] of [[withInvoiceCode, true], [noInvoiceCode, false]] as const) {
      await db.insert(s.forwarderExpenseTypes).values({
        code,
        name: `Test phí ${code}`,
        requiresInvoice,
      });
      createdExpenseTypeCodes.push(code);
    }
  });

  test('create validates amount, type, container-shipment link', async () => {
    const badAmount = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, expenseTypeCode: noInvoiceCode, amount: '12.5', paidAt: isoDate },
    });
    assert.equal(badAmount.status, 400);

    const badType = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, expenseTypeCode: 'NOPE', amount: '1000', paidAt: isoDate },
    });
    assert.equal(badType.status, 400);

    const badContainer = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, shipmentContainerId: 999999, expenseTypeCode: noInvoiceCode, amount: '1000', paidAt: isoDate },
    });
    // Unknown container id → 404 (resource semantics); a container from
    // another shipment would be the 400 case.
    assert.equal(badContainer.status, 404);
  });

  test('lifecycle: create → approve blocked without photo → attach → approve', async () => {
    const created = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, shipmentContainerId: containerId, expenseTypeCode: withInvoiceCode, amount: '350000', paidAt: isoDate },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.approvalStatus, 'PENDING');
    assert.equal(created.body.paidById, opsUser.id);
    createdExpenseIds.push(created.body.id);

    const noPhoto = await api(`/admin/expenses/${created.body.id}/approve`, { method: 'POST', token: accountantToken });
    assert.equal(noPhoto.status, 400);

    // Attach validates the key shape and owner segment.
    const foreignKey = await api(`/expenses/${created.body.id}/photos`, {
      method: 'POST', token: opsToken,
      body: { storageKey: `ops-expense-photos/${opsUser.id + 1}/${'a'.repeat(32)}.jpg` },
    });
    assert.equal(foreignKey.status, 400);
    const garbageKey = await api(`/expenses/${created.body.id}/photos`, {
      method: 'POST', token: opsToken,
      body: { storageKey: 'expense-photos/99/whatever.jpg' },
    });
    assert.equal(garbageKey.status, 400);

    const attached = await api(`/expenses/${created.body.id}/photos`, {
      method: 'POST', token: opsToken,
      body: { storageKey: `ops-expense-photos/${opsUser.id}/${'a'.repeat(32)}.jpg` },
    });
    assert.equal(attached.status, 201);

    // Receipt review: the approver can list the photos; another Ops cannot.
    const photosForAccountant = await api(`/expenses/${created.body.id}/photos`, { token: accountantToken });
    assert.equal(photosForAccountant.status, 200);
    assert.equal(photosForAccountant.body.items.length, 1);
    // storage_key is encodeURIComponent'd into the URL (slashes → %2F); the
    // serving router decodes it back.
    assert.ok(decodeURIComponent(photosForAccountant.body.items[0].url)
      .startsWith('/api/photos/ops-expense-photos/'));
    const photosForStranger = await api(`/expenses/${created.body.id}/photos`, { token: ops2Token });
    assert.equal(photosForStranger.status, 404);

    // The served URL passes the photos allowlist (404 = recognized shape but
    // no object on disk in tests; 400 would mean the prefix is still missing
    // from isProtectedPhotoStorageKey).
    const served = await fetch(`${baseUrl}${photosForAccountant.body.items[0].url}`, {
      headers: { Authorization: `Bearer ${accountantToken}` },
    });
    assert.notEqual(served.status, 400);
    assert.equal(served.status, 404);

    const approved = await api(`/admin/expenses/${created.body.id}/approve`, { method: 'POST', token: accountantToken });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.approvalStatus, 'APPROVED');

    // APPROVED is locked: author edit refused.
    const edit = await api(`/expenses/${created.body.id}`, {
      method: 'PATCH', token: opsToken, body: { amount: '1' },
    });
    assert.equal(edit.status, 400);
  });

  test('reject requires reason; author must re-attach a photo before resend', async () => {
    const created = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, expenseTypeCode: noInvoiceCode, amount: '80000', paidAt: isoDate, note: 'Cân xe' },
    });
    assert.equal(created.status, 201);
    createdExpenseIds.push(created.body.id);

    const noReason = await api(`/admin/expenses/${created.body.id}/reject`, { method: 'POST', token: adminToken, body: {} });
    assert.equal(noReason.status, 400);

    const rejected = await api(`/admin/expenses/${created.body.id}/reject`, {
      method: 'POST', token: adminToken, body: { reason: 'Ảnh mờ' },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.approvalStatus, 'REJECTED');

    const edited = await api(`/expenses/${created.body.id}`, {
      method: 'PATCH', token: opsToken, body: { amount: '90000' },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.amount, '90000');

    // Resend without any receipt photo is refused (PRD §5.3).
    const noPhotoResend = await api(`/expenses/${created.body.id}/resend`, { method: 'POST', token: opsToken });
    assert.equal(noPhotoResend.status, 400);

    await api(`/expenses/${created.body.id}/photos`, {
      method: 'POST', token: opsToken,
      body: { storageKey: `ops-expense-photos/${opsUser.id}/${'b'.repeat(32)}.png` },
    });
    const resent = await api(`/expenses/${created.body.id}/resend`, { method: 'POST', token: opsToken });
    assert.equal(resent.status, 200);
    assert.equal(resent.body.approvalStatus, 'PENDING');
  });

  test('receipt-less approve needs the in-person paper-check flag + note (two-path rule)', async () => {
    // ops2 creates the receipt-less entry so opsUser's settlement-freeze
    // totals asserted later in this describe stay untouched.
    const created = await api('/expenses', {
      method: 'POST', token: ops2Token,
      body: { shipmentId, expenseTypeCode: noInvoiceCode, amount: '60000', paidAt: isoDate },
    });
    assert.equal(created.status, 201);
    createdExpenseIds.push(created.body.id);

    const blind = await api(`/admin/expenses/${created.body.id}/approve`, { method: 'POST', token: accountantToken });
    assert.equal(blind.status, 400);

    const noNote = await api(`/admin/expenses/${created.body.id}/approve`, {
      method: 'POST', token: accountantToken,
      body: { inPersonCheck: true },
    });
    assert.equal(noNote.status, 400);

    const inPerson = await api(`/admin/expenses/${created.body.id}/approve`, {
      method: 'POST', token: accountantToken,
      body: { inPersonCheck: true, note: 'Đã đối chiếu hóa đơn giấy tại quầy' },
    });
    assert.equal(inPerson.status, 200);
    assert.equal(inPerson.body.approvalStatus, 'APPROVED');

    const [auditRow] = await db.select().from(s.auditLogs)
      .where(and(
        eq(s.auditLogs.entityType, 'ops-expense-entries'),
        eq(s.auditLogs.entityId, created.body.id),
      ))
      .limit(1);
    assert.ok(auditRow, 'in-person check note is persisted for audit');
    assert.equal((auditRow.payload as any)?.event, 'OPS_EXPENSE_APPROVE_IN_PERSON');
    assert.equal((auditRow.payload as any)?.note, 'Đã đối chiếu hóa đơn giấy tại quầy');
  });

  test('wallet summary matches the PRD formula', async () => {
    // 2,000,000 approved advance − (350,000 approved + 90,000 pending) = 1,560,000
    const [advance] = await db.insert(s.advanceRequests).values({
      requesterId: opsUser.id,
      amount: '2000000',
      reason: `test ${suffix}`,
      status: 'APPROVED',
    }).returning();
    createdAdvanceIds.push(advance.id);

    const summary = await api('/wallet/summary', { token: opsToken });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.totalAdvance, '2000000');
    assert.equal(summary.body.approved, '350000');
    assert.equal(summary.body.pending, '90000');
    assert.equal(summary.body.balance, '1560000');
  });

  test('expense history flags missing photos (nợ chứng từ)', async () => {
    const res = await api('/wallet/expenses', { token: opsToken });
    const withPhoto = res.body.items.find((item: any) => item.amount === '350000');
    assert.equal(withPhoto.hasPhoto, true);
    const resentWithPhoto = res.body.items.find((item: any) => item.amount === '90000');
    assert.equal(resentWithPhoto.hasPhoto, true, 'resend flow re-attached a receipt');
  });

  test('advance request creation lands PENDING in the shared table', async () => {
    const created = await api('/wallet/advance-requests', {
      method: 'POST', token: opsToken,
      body: { amount: 500000, reason: `xin ứng ${suffix}` },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'PENDING');
    createdAdvanceIds.push(created.body.id);
  });

  test('accountant list clusters same-lot expenses under one mã lô regardless of payer', async () => {
    // A second Ops spends on the SAME lot — the accountant surface must group
    // both payers' rows under one shipment code (PRD §5.3 micro-ledger).
    const [ops2] = await db.select({ id: s.users.id }).from(s.users)
      .where(eq(s.users.username, `ops-portal-b-${suffix}`)).limit(1);
    const shared = await api('/expenses', {
      method: 'POST', token: ops2Token,
      body: { shipmentId, expenseTypeCode: noInvoiceCode, amount: '70000', paidAt: isoDate },
    });
    assert.equal(shared.status, 201);
    createdExpenseIds.push(shared.body.id);

    const res = await api('/admin/expenses', { token: accountantToken });
    assert.equal(res.status, 200);
    const lotRows = res.body.items.filter((item: any) => item.shipmentCode === `OPS-CHI-${suffix}`);
    const lotCodes = new Set(lotRows.map((item: any) => item.shipmentCode));
    assert.equal(lotCodes.size, 1, 'all same-lot rows share exactly one mã lô');

    const indices = res.body.items
      .map((item: any, index: number) => (item.shipmentCode === `OPS-CHI-${suffix}` ? index : -1))
      .filter((index: number) => index >= 0);
    assert.equal(indices[indices.length - 1] - indices[0] + 1, indices.length,
      'same-lot rows are contiguous — clustered, not split by payer');
    const payers = new Set(lotRows.map((item: any) => item.paidById));
    assert.ok(payers.has(ops2.id), 'second Ops row kept its own paidById');
    assert.equal(payers.size, 2, 'both payers present under the one mã lô');
  });

  test('settlement freeze → approve path; later entries stay open', async () => {
    const created = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, expenseTypeCode: noInvoiceCode, amount: '150000', paidAt: isoDate },
    });
    createdExpenseIds.push(created.body.id);

    // Freshly created without any receipt → "Nợ chứng từ" until a photo lands.
    const history = await api('/wallet/expenses', { token: opsToken });
    const debtEntry = history.body.items.find((item: any) => item.amount === '150000');
    assert.equal(debtEntry.hasPhoto, false);

    const settlement = await api('/settlements', { method: 'POST', token: opsToken, body: { note: 'cuối ngày' } });
    assert.equal(settlement.status, 201);
    createdSettlementIds.push(settlement.body.id);
    assert.equal(settlement.body.totalAmount, '590000'); // 350k + 90k + 150k

    // Frozen entries are locked for the author.
    const edit = await api(`/expenses/${created.body.id}`, { method: 'PATCH', token: opsToken, body: { amount: '1' } });
    assert.equal(edit.status, 400);

    // Batch approval blocked while the 90k + 150k entries are still PENDING.
    const blocked = await api(`/admin/settlements/${settlement.body.id}/approve`, { method: 'POST', token: accountantToken });
    assert.equal(blocked.status, 400);

    const detail = await api(`/settlements/${settlement.body.id}`, { token: opsToken });
    assert.equal(detail.status, 200);
    const group = detail.body.grouping.groups.find((g: any) => g.shipmentCode === `OPS-CHI-${suffix}`);
    assert.ok(group, 'settlement groups by lô');
    assert.equal(group.withInvoice.total, '350000');
    assert.equal(group.withoutInvoice.total, '240000');
    assert.equal(detail.body.grouping.totals.grand, '590000');

    const after = await api('/expenses', {
      method: 'POST', token: opsToken,
      body: { shipmentId, expenseTypeCode: noInvoiceCode, amount: '10000', paidAt: isoDate },
    });
    createdExpenseIds.push(after.body.id);
    assert.equal(after.body.opsSettlementId, null);

    // Excel export downloads for the owner (accountant variant covered by
    // role matrix above).
    const exported = await fetch(`${baseUrl}/api/ops/settlements/${settlement.body.id}/export`, {
      headers: { Authorization: `Bearer ${opsToken}` },
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') ?? '', /spreadsheetml/);
    const bytes = await exported.arrayBuffer();
    assert.ok(bytes.byteLength > 1000, 'xlsx workbook is non-trivial');

    // Batch reject: the frozen 10k entry returns to the open pool.
    const second = await api('/settlements', { method: 'POST', token: opsToken });
    assert.equal(second.status, 201);
    createdSettlementIds.push(second.body.id);
    assert.equal(second.body.totalAmount, '10000');

    const rejectNoReason = await api(`/admin/settlements/${second.body.id}/reject`, {
      method: 'POST', token: accountantToken, body: {},
    });
    assert.equal(rejectNoReason.status, 400);

    const rejectedBatch = await api(`/admin/settlements/${second.body.id}/reject`, {
      method: 'POST', token: accountantToken, body: { reason: 'Thiếu chứng từ gốc' },
    });
    assert.equal(rejectedBatch.status, 200);
    assert.equal(rejectedBatch.body.status, 'REJECTED');

    const reopened = await api('/wallet/expenses', { token: opsToken });
    const reopenedEntry = reopened.body.items.find((item: any) => item.amount === '10000');
    assert.equal(reopenedEntry.opsSettlementId, null);

    // A new batch can pick the reopened entry up again.
    const third = await api('/settlements', { method: 'POST', token: opsToken });
    assert.equal(third.status, 201);
    createdSettlementIds.push(third.body.id);
    assert.equal(third.body.totalAmount, '10000');
  });
});

describe('ops fleet tracking (PRD §4)', () => {
  test('admin assigns truck; reassign keeps one active row; fleet lists trip state', async () => {
    const [truck] = await db.insert(s.trucks).values({
      licensePlate: `29A-${(Date.now() % 100000).toString().padStart(5, '0')}`,
    }).returning();
    createdTruckIds.push(truck.id);

    const [customer] = await db.insert(s.customers).values({
      name: `OPS Fleet KH ${suffix}`,
      code: `OPSFL-${suffix.slice(0, 12)}`,
    }).returning();
    createdCustomerIds.push(customer.id);

    const [route] = await db.insert(s.routes).values({
      name: `Tuyến test ${suffix}`,
      isMountain: false,
    }).returning();
    createdRouteIds.push(route.id);

    const [driver] = await db.insert(s.drivers).values({
      name: `Lái test ${suffix}`,
    }).returning();
    createdDriverIds.push(driver.id);

    const [shipment] = await db.insert(s.shipments).values({
      shipmentCode: `OPS-FL-${suffix}`,
      customerId: customer.id,
      expectedDeliveryDate: isoDate,
    }).returning();
    createdShipmentIds.push(shipment.id);

    const [trip] = await db.insert(s.trips).values({
      customerId: customer.id,
      routeId: route.id,
      truckId: truck.id,
      driverId: driver.id,
      departureDate: isoDate,
      status: 'IN_TRANSIT',
      shipmentId: shipment.id,
    }).returning();
    createdTripIds.push(trip.id);

    const forbidden = await api(`/trucks/${truck.id}/ops-assignment`, {
      method: 'PUT', token: accountantToken, body: { opsUserId: opsUser.id },
    });
    assert.equal(forbidden.status, 403);

    const assigned = await api(`/trucks/${truck.id}/ops-assignment`, {
      method: 'PUT', token: adminToken, body: { opsUserId: opsUser.id },
    });
    assert.equal(assigned.status, 200);

    const [opsB] = await db.select({ id: s.users.id }).from(s.users)
      .where(eq(s.users.username, `ops-portal-b-${suffix}`)).limit(1);
    await api(`/trucks/${truck.id}/ops-assignment`, {
      method: 'PUT', token: adminToken, body: { opsUserId: opsB.id },
    });
    const activeRows = await db.select().from(s.truckOpsAssignments)
      .where(eq(s.truckOpsAssignments.truckId, truck.id));
    assert.equal(activeRows.filter((row) => row.isActive).length, 1);

    // opsB now owns the truck; opsUser sees nothing.
    const fleetB = await api('/fleet', { token: ops2Token });
    assert.equal(fleetB.status, 200);
    const rowB = fleetB.body.items.find((item: any) => item.truckId === truck.id);
    assert.ok(rowB);
    assert.equal(rowB.status, 'IN_TRANSIT');
    assert.equal(rowB.shipmentCode, `OPS-FL-${suffix}`);

    const fleetA = await api('/fleet', { token: opsToken });
    assert.equal(fleetA.body.items.find((item: any) => item.truckId === truck.id), undefined);

    // Driver-app action sync: the row's milestone comes from the driver's
    // latest progress event (PRD §4 — trạng thái đồng bộ từ thao tác lái xe).
    await db.insert(s.driverProgressEvents).values({
      tripId: trip.id,
      driverId: driver.id,
      eventType: 'PICKED_UP',
      occurredAt: new Date(),
    });

    const fleetB2 = await api('/fleet', { token: ops2Token });
    assert.equal(fleetB2.status, 200);
    const rowB2 = fleetB2.body.items.find((item: any) => item.truckId === truck.id);
    assert.ok(rowB2);
    assert.equal(rowB2.lastEventType, 'PICKED_UP');
  });
});

test('unauthenticated requests are rejected', async () => {
  const res = await api('/orders');
  assert.equal(res.status, 401);
});
