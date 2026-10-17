/**
 * Ticket 141026230710 (P1) — chỉ thị 2026-10-17, spec T3: MỌI Ops được khai
 * chi phí MỌI lô (không chia theo cá nhân/xe). Một test đi qua cả 2 chặn của
 * luồng khai chi phí bằng nguồn thật:
 *
 *   1. `/shipments` mở cho Ops — `GET /api/shipments` dưới mount
 *      `casbinAuthz('shipments')` thật (như index.ts) trả 200 cho actor OPS
 *      và trả về đúng lô của test; `GET /api/shipments/:id` trả 200; id vắng
 *      trả 404 — gate đã mở, không phải 403. Pin cho casbin rule
 *      `p, OPS, shipments, read` (policy.csv).
 *   2. Khai chi phí lô bất kỳ — `createOpsExpense` thành công trên một lô
 *      không có user-link / gán xe / chi phí cũ, kể cả khi trip của lô đang
 *      gán một lái xe KHÁC — đúng ca mà grant cũ ("Lô này không thuộc xe bạn
 *      phụ trách.") từng từ chối. Trip predicate
 *      `assertExpenseOwnerWriteScope` không filter Ops theo trip.driverId;
 *      control phía DRIVER trong cùng test xác nhận predicate CHỈ scope DRIVER
 *      (không bị xóa). Pin tạo-chi phí-lô-fresh phía rolled-back còn ở
 *      FIX17-S01 (expense-source-remediation.test.ts).
 *
 * Rows are committed (the HTTP gate reads through its own connection) and
 * registered with `withTestCleanup` — reverse-order delete in `after`.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import { withTestCleanup } from './helpers/db-isolation';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import { createOpsExpense } from '../services/ops-expenses.service';
import { assertExpenseOwnerWriteScope } from '../services/expense-owner-scope.service';
import { hydrateExpenseAccountingSource } from '../services/expense-accounting-source.service';
import shipmentRoutes from '../routes/shipments';

const cleanup = withTestCleanup();
const key = `T710${crypto.randomUUID().replace(/[^A-Za-z0-9]/g, '').slice(0, 10)}`;

/** List payload boundary — validate the network JSON before reading it. */
const ShipmentListProbe = z.object({
  items: z.array(z.object({ shipmentCode: z.string().nullable() })),
  total: z.number(),
});

after(async () => {
  await cleanup.flush();
  await client.end();
});

/** Mount the REAL shipments router behind the REAL casbin gate (the production
 *  chain at index.ts:233 minus `authMiddleware`, which only resolves the token
 *  to a user — here injected as a plain Ops actor). */
async function bootShipmentsGateAsOps(): Promise<{ port: number; close: () => Promise<void> }> {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Express Request carries `user` via the global augmentation in
    // middleware/auth.ts — set the actor directly, no cast.
    req.user = {
      userId: 0, username: 'ops-141026230710', email: null, fullName: 'Ops 141026230710', role: Role.OPS,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use(globalErrorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr !== 'object') throw new Error('server must listen on a TCP port');
  return {
    port: addr.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test('141026230710 — Ops đi qua cả 2 chặn: mở /shipments và khai chi phí lô bất kỳ', async () => {
  // ── Fixture (committed): Ops không có user-link / gán xe / chi phí cũ trên
  //    lô fresh; trip của lô gán một lái xe KHÁC (ca bị grant cũ từ chối). ──
  const [opsUser] = await db.insert(s.users).values({ username: key, passwordHash: 'fixture', role: Role.OPS }).returning();
  cleanup.track(s.users, opsUser.id);
  const [otherUser] = await db.insert(s.users).values({ username: `${key}-lx`, passwordHash: 'fixture', role: Role.DRIVER }).returning();
  cleanup.track(s.users, otherUser.id);
  const [customer] = await db.insert(s.customers).values({ name: key }).returning();
  cleanup.track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: key }).returning();
  cleanup.track(s.routes, route.id);
  const [fresh] = await db.insert(s.shipments).values({ shipmentCode: key, customerId: customer.id, createdBy: opsUser.id }).returning();
  cleanup.track(s.shipments, fresh.id);
  const [foreignDriver] = await db.insert(s.drivers).values({ name: `${key} lái xe`, userId: otherUser.id, status: 'ACTIVE' }).returning();
  cleanup.track(s.drivers, foreignDriver.id);
  const [foreignTrip] = await db.insert(s.trips).values({
    shipmentId: fresh.id,
    customerId: customer.id,
    routeId: route.id,
    status: 'CREATED',
    departureDate: '2026-10-17',
    fulfillmentId: null,
    driverId: foreignDriver.id,
  }).returning();
  cleanup.track(s.trips, foreignTrip.id);
  const [type] = await db.insert(s.forwarderExpenseTypes).values({
    code: `${key}T`, name: `${key} phí`, status: 'ACTIVE', requiresInvoice: true, category: 'LIFT',
  }).returning();
  cleanup.track(s.forwarderExpenseTypes, type.id);

  // ── Chặn 1 — mở /shipments cho Ops (p, OPS, shipments, read) ──
  const { port, close } = await bootShipmentsGateAsOps();
  try {
    const listRes = await fetch(`http://127.0.0.1:${port}/api/shipments?q=${key}&limit=5`);
    assert.equal(listRes.status, 200, 'GET /api/shipments phải 200 cho Ops (không phải 403)');
    const listBody = ShipmentListProbe.parse(await listRes.json());
    assert.equal(listBody.total, 1, 'Ops thấy đúng lô của mình trong list');
    assert.ok(listBody.items.some((item) => item.shipmentCode === key), 'list trả về lô vừa tạo');
    const detailRes = await fetch(`http://127.0.0.1:${port}/api/shipments/${fresh.id}`);
    assert.equal(detailRes.status, 200, 'Ops mở được chi tiết lô');
    const missingRes = await fetch(`http://127.0.0.1:${port}/api/shipments/2147483646`);
    assert.equal(missingRes.status, 404, 'gate mở rồi: id vắng trả 404 chứ không phải 403');
  } finally {
    await close();
  }

  // ── Chặn 2 — khai chi phí lô bất kỳ, không filter theo trip.driverId ──
  const created = await createOpsExpense(opsUser.id, {
    shipmentId: fresh.id,
    expenseTypeCode: type.code,
    amount: 500,
    paidAt: '2026-10-17',
  });
  cleanup.track(s.opsExpenseEntries, created.id);
  assert.equal(created.shipmentId, fresh.id, 'khoản chi rơi đúng lô bất kỳ');
  const [link] = await db.select().from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.sourceId, created.id)));
  assert.ok(link, 'registry nguồn chi phí phải tồn tại');
  cleanup.track(s.expenseAccountingSources, link.id);
  const source = await hydrateExpenseAccountingSource(db, link);

  // Trip của lô đang gán một lái xe KHÁC — Ops vẫn không bị filter…
  await assertExpenseOwnerWriteScope(db, { userId: opsUser.id, role: Role.OPS }, { ...source, tripId: foreignTrip.id });
  // …chỉ DRIVER mới bị predicate scope (control: không phải xóa predicate).
  await assert.rejects(
    assertExpenseOwnerWriteScope(db, { userId: opsUser.id, role: Role.DRIVER }, { ...source, tripId: foreignTrip.id }),
    /phân công/,
  );
});
