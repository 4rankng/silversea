// Card 20260921_3 — declaration DELETE gates, and card 20260928_162 — the
// uncharged-Ops reason reaching kế toán / CUS. (The card 20260919_5 customs
// channel contract that used to live here was removed wholesale by card
// 20261002_262: the channel was scope added beyond the requirement — the
// feature is only multiple tờ khai per lot.)
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { disconnectRedis } from '../lib/redis';
import shipmentRoutes from '../routes/shipments';

const suffix = `${Date.now()}-chan-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const shipmentIds: number[] = [];
const routeIds: number[] = [];
const userIds: number[] = [];
const lockIds: number[] = [];
const documentIds: number[] = [];
let cusId = 0;
let cusToken = '';
let server: http.Server;
let baseUrl = '';

async function mkCustomerShipment(tag: string): Promise<number> {
  const [customer] = await db.insert(s.customers).values({ name: `Chan ${suffix} ${tag}` }).returning();
  customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Chan route ${suffix} ${tag}` }).returning();
  routeIds.push(route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    routeId: null,
    cargoMode: 'FCL',
    shipmentCode: `CHAN-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-CHAN-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
    createdBy: cusId,
  }).returning();
  shipmentIds.push(shipment.id);
  return shipment.id;
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `chan-${role.toLowerCase()}-${suffix.slice(-6)}-${userIds.length}`,
    passwordHash: await bcrypt.hash('test-only', 10),
    role, status: 'ACTIVE',
  }).returning();
  userIds.push(user.id);
  return user;
}

async function api(method: string, path: string, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/shipments${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cusToken}`, 'Idempotency-Key': `chan-${suffix}-${Math.random()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data: data as Record<string, unknown> };
}

before(async () => {
  await initEnforcer();
  const cus = await mkUser(Role.CUS);
  cusId = cus.id;
  cusToken = jwt.sign({
    userId: cus.id, username: cus.username ?? `user-${cus.id}`, email: null, fullName: null,
    role: Role.CUS, customerId: null, customerIds: [],
  }, config.jwtSecret);
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.shipmentAccountingLocks).where(inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds));
    if (documentIds.length > 0) await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('card 20260921_3 — declaration DELETE gates', () => {
  test('DELETE removes one row of the lot; a foreign or repeated id reads 404', async () => {
    const shipmentId = await mkCustomerShipment('delete');
    const first = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-DEL-1' });
    const second = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-DEL-2' });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const firstId = (first.data as { id: number }).id;
    const secondId = (second.data as { id: number }).id;

    const removed = await api('DELETE', `/${shipmentId}/declarations/${firstId}`);
    assert.equal(removed.status, 200, `delete must succeed — got ${removed.status}`);
    const rows = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.deepEqual(rows.map((row) => row.id), [secondId], 'only the untouched sibling remains');

    const foreign = await api('DELETE', `/${shipmentId}/declarations/${firstId}`);
    assert.equal(foreign.status, 404, 're-deleting the same id must 404');
    const otherShipment = await mkCustomerShipment('delete-other');
    const wrong = await api('DELETE', `/${otherShipment}/declarations/${secondId}`);
    assert.equal(wrong.status, 404, 'a declaration of another lot must not delete');
  });

  test('DELETE is blocked while the accounting lock holds', async () => {
    const shipmentId = await mkCustomerShipment('delete-locked');
    const created = await api('POST', `/${shipmentId}/declarations`, { declarationNumber: 'TMX-LOCK-1' });
    const declarationId = (created.data as { id: number }).id;
    const [document] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE',
      entityType: 'CUSTOMER',
      entityId: customerIds[customerIds.length - 1],
      entityName: `Chan ${suffix}`,
      rangeFrom: '2026-09-01',
      rangeTo: '2026-09-30',
      totalInclVat: '1000000',
      debitNoteStatus: 'SENT',
      issuedAt: new Date(),
    }).returning();
    documentIds.push(document.id);
    const [lock] = await db.insert(s.shipmentAccountingLocks).values({
      shipmentId,
      billingDocumentId: document.id,
      billingDocumentVersion: 1,
      billingPeriodSnapshot: { rangeFrom: '2026-09-01', rangeTo: '2026-09-30', issuedAt: new Date().toISOString() },
      shipmentVersionAtLock: 1,
      reason: 'delete-gate test',
      activatedBy: cusId,
    }).returning();
    lockIds.push(lock.id);
    const blocked = await api('DELETE', `/${shipmentId}/declarations/${declarationId}`);
    assert.equal(blocked.status, 409, `accounting lock must block delete — got ${blocked.status}`);
    const rows = await db.select().from(s.shipmentDeclarations)
      .where(eq(s.shipmentDeclarations.shipmentId, shipmentId));
    assert.equal(rows.length, 1, 'the locked row must survive');
  });
});

// Card 20260928_162 criterion 3 — the read path for the two roles the card
// names. The projection was written for "cus/accounting" (card 20260921_5), but
// the gate handed it to ADMIN/DISPATCHER only, so BOTH named readers received an
// empty array on the board the card names. This asserts on the endpoint each
// role can actually read that the mandatory reason arrives.
//
// Rung note: this is the CUS read path (CUS has no page that renders the note —
// App.tsx:187-191 dispatchOnly keeps it out of both dispatch boards, and
// /accounting/debit-board is 403 for CUS). ACCOUNTANT's page-reachable path is
// pinned in accounting-debit-close.test.ts.
describe('card 20260928_162 — the uncharged Ops reason reaches kế toán / CUS', () => {
  type NoteRow = { id: number; opsRecoveryNotes?: string[] };
  const isNoteRow = (value: unknown): value is NoteRow =>
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number';

  async function listAs(token: string, query: string) {
    const response = await fetch(`${baseUrl}/api/shipments${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload: unknown = await response.json().catch(() => null);
    const items = payload && typeof payload === 'object' && 'items' in payload && Array.isArray(payload.items)
      ? payload.items.filter(isNoteRow)
      : [];
    return { status: response.status, items };
  }

  test('ACCOUNTANT and CUS both receive opsRecoveryNotes on the lot list', async () => {
    const shipmentId = await mkCustomerShipment('162notes');
    const [lot] = await db.select({ code: s.shipments.shipmentCode }).from(s.shipments)
      .where(eq(s.shipments.id, shipmentId));
    const reason = 'Chi nội bộ, không thu khách';
    const [ops] = await db.insert(s.opsExpenseEntries).values({
      shipmentId, expenseTypeCode: 'OTHER', amount: '20000',
      customerChargeAmount: '0', paidById: cusId, paidAt: '2026-09-19', note: reason,
    }).returning();

    try {
      const accountant = await mkUser(Role.ACCOUNTANT);
      const accountantToken = jwt.sign({
        userId: accountant.id, username: accountant.username ?? `user-${accountant.id}`,
        email: null, fullName: null, role: Role.ACCOUNTANT, customerId: null, customerIds: [],
      }, config.jwtSecret);

      for (const [label, token] of [['CUS', cusToken], ['ACCOUNTANT', accountantToken]] as const) {
        const res = await listAs(token, `?q=${encodeURIComponent(lot!.code ?? '')}`);
        assert.equal(res.status, 200, `${label} must be able to read the lot list — got ${res.status}`);
        const row = res.items.find((item) => item.id === shipmentId);
        assert.ok(row, `${label}: the lot must be on the list`);
        assert.ok(
          row!.opsRecoveryNotes?.includes(reason),
          `${label} must receive the mandatory reason on this endpoint; got ${JSON.stringify(row!.opsRecoveryNotes)}`,
        );
        // Standing ruling of the shared projection: the amount never rides along.
        assert.ok(!JSON.stringify(row!.opsRecoveryNotes).includes('20000'), `${label}: no amount in the notes`);
      }
    } finally {
      await db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, ops.id));
    }
  });
});
