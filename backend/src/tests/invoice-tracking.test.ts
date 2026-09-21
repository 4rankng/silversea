// Card 20260921_18 — invoice-tracking route + service contract.
// Worked example to the đồng: invoice 12.000.000 / trả 8.000.000 → difference
// 4.000.000; totals recompute over the filtered set. Mutations are
// office-only (CUS write → 403) while CUS reads the list (200).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { config } from '../config';
import { initEnforcer } from '../casbin/enforcer';
import { authMiddleware } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { disconnectRedis } from '../lib/redis';
import { globalErrorHandler } from '../middleware/errorHandler';
import accountingRoutes from '../routes/accounting';

const suffix = `inv-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const routeIds: number[] = [];
const shipmentIds: number[] = [];
const tripIds: number[] = [];
const userIds: number[] = [];
const trackIds: number[] = [];
const expenseIds: number[] = [];
let accountantToken = '';
let cusToken = '';
let server: http.Server;
let baseUrl = '';

function mkUser(role: Role, tag: string) {
  return db.insert(s.users).values({
    username: `${tag}-${suffix.slice(0, 10)}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
}

function tokenFor(role: Role, id: number, username: string | null): string {
  return jwt.sign({
    userId: id, username: username ?? `u-${id}`, email: null, fullName: 'QA Test',
    role, customerId: null, customerIds: [],
  }, config.jwtSecret);
}

async function mkLot(tag: string): Promise<{ shipmentId: number; tripId: number }> {
  const [customer] = await db.insert(s.customers).values({ name: `InvTrk ${suffix} ${tag}` }).returning();
  customerIds.push(customer.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id,
    cargoMode: 'FCL',
    shipmentCode: `INV-${suffix}-${shipmentIds.length}`,
    bookingRef: `BOOK-${suffix}-${shipmentIds.length}`,
    status: 'READY_FOR_DISPATCH',
    tradeDirection: 'EXPORT',
  }).returning();
  shipmentIds.push(shipment.id);
  const [route] = await db.insert(s.routes).values({ name: `InvTrk route ${suffix} ${tag}` }).returning();
  routeIds.push(route.id);
  const [trip] = await db.insert(s.trips).values({
    shipmentId: shipment.id,
    customerId: customer.id,
    routeId: route.id,
    departureDate: '2026-09-01',
    status: 'COMPLETED',
  }).returning();
  tripIds.push(trip.id);
  return { shipmentId: shipment.id, tripId: trip.id };
}

async function api(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${baseUrl}/api/accounting${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `inv-${suffix}-${Math.random()}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data: data as Record<string, unknown> };
}

before(async () => {
  await initEnforcer();
  const acc = await mkUser(Role.ACCOUNTANT, 'acc');
  accountantToken = tokenFor(Role.ACCOUNTANT, acc[0].id, acc[0].username);
  const cus = await mkUser(Role.CUS, 'cus');
  cusToken = tokenFor(Role.CUS, cus[0].id, cus[0].username);
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/accounting', casbinAuthz('accounting'), accountingRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Sandbox: the totals asserts own an exclusive date window — clear any
  // leftovers from previous failed runs so the math is deterministic.
  await db.delete(s.invoiceTracking).where(and(
    gte(s.invoiceTracking.expenseDate, '2026-08-01'),
    lte(s.invoiceTracking.expenseDate, '2026-08-31'),
  ));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, tripIds));
    await db.delete(s.invoiceTracking).where(inArray(s.invoiceTracking.id, trackIds));
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    if (userIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, userIds));
  } catch { /* best-effort cleanup */ }
  await disconnectRedis();
});

describe('invoice tracking (card 20260921_18)', () => {
  test('create mirrors an expense; difference and totals compute to the đồng', async () => {
    const lotA = await mkLot('A');
    const lotB = await mkLot('B');
    const mkRow = async (lot: { shipmentId: number; tripId: number }, invoice: number, paid: number, date: string) => {
      const res = await api(accountantToken, 'POST', '/invoice-tracking', {
        shipmentId: lot.shipmentId, tripId: lot.tripId,
        invoiceNumber: `HD-${invoice}`, invoiceAmount: invoice, supplierPayment: paid,
        progress: 'CHUA_GUI', expenseDate: date,
      });
      const body = res.data as { id?: number };
      if (body.id != null) trackIds.push(body.id);
      return res;
    };
    const a = await mkRow(lotA, 12_000_000, 8_000_000, '2026-08-01');
    assert.equal(a.status, 201, `create A ${a.status}`);
    const b = await mkRow(lotB, 5_500_000, 6_000_000, '2026-08-02');
    assert.equal(b.status, 201);
    const list = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-08-01&to=2026-08-31');
    assert.equal(list.status, 200);
    const { rows, totals } = list.data as { rows: Array<{ id: number; difference: string; invoiceNumber: string; expenseId: number | null }>; totals: { invoice: number; paid: number; difference: number } };
    const byInvoice = new Map(rows.map((r) => [r.invoiceNumber, r]));
    const rowA = byInvoice.get('HD-12000000')!;
    const rowB = byInvoice.get('HD-5500000')!;
    assert.equal(rowA.difference, '4000000');
    assert.equal(rowB.difference, '-500000');
    assert.deepEqual(totals, { invoice: 17500000, paid: 14000000, difference: 3500000 });
    const filtered = await api(accountantToken, 'GET', '/invoice-tracking?from=2026-08-01&to=2026-08-01');
    const ft = (filtered.data as { totals: { invoice: number } }).totals;
    assert.deepEqual(ft, { invoice: 12000000, paid: 8000000, difference: 4000000 });
  });

  test('expense mirror stays in sync and CUS cannot write but can read', async () => {
    const lot = await mkLot('C');
    const create = await api(accountantToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber: 'HD-SYNC-1', invoiceAmount: 9_000_000, supplierPayment: 2_000_000,
      progress: 'CO_HD', expenseDate: '2026-09-30',
    });
    assert.equal(create.status, 201);
    const created = create.data as { id: number; expenseId: number | null };
    trackIds.push(created.id);
    assert.ok(created.expenseId != null, 'the mirrored expense id rides the wire');
    expenseIds.push(created.expenseId!);

    let [expense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, created.expenseId!));
    assert.equal(expense.expenseType, 'OTHER');
    assert.equal(expense.feeName, 'Chi phí hóa đơn');
    assert.equal(Number(expense.buyAmount), 2_000_000);

    const patch = await api(accountantToken, 'PATCH', `/invoice-tracking/${created.id}`, { supplierPayment: 2_500_000 });
    assert.equal(patch.status, 200);
    [expense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, created.expenseId!));
    assert.equal(Number(expense.buyAmount), 2_500_000, 'the mirrored expense follows the payment edit');

    const cusWrite = await api(cusToken, 'POST', '/invoice-tracking', {
      shipmentId: lot.shipmentId, tripId: lot.tripId,
      invoiceNumber: 'HD-CUS-1', invoiceAmount: 1, supplierPayment: 1,
    });
    assert.equal(cusWrite.status, 403, 'CUS write must be role-gated 403');

    const cusRead = await api(cusToken, 'GET', '/invoice-tracking?from=2026-08-01&to=2026-08-31');
    assert.equal(cusRead.status, 200, 'CUS read rides the route-scoped bridge');
    const rows = (cusRead.data as { rows: unknown[] }).rows;
    assert.ok(Array.isArray(rows));

    const del = await api(accountantToken, 'DELETE', `/invoice-tracking/${created.id}`);
    assert.equal(del.status, 200);
    [expense] = await db.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, created.expenseId!));
    assert.equal(expense, undefined, 'the mirrored expense deletes with the row');
  });
});
