import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { globalErrorHandler } from '../middleware/errorHandler';
import opsRoutes from '../routes/ops';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
function track(table: any, id: number) {
  cleanup.unshift({ table, id });
}
let server: http.Server;
let opsUserId = 0;

async function api(method: string, path: string, body?: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `c5-${suffix}-${Math.random()}`,
      'X-Test-User-Id': String(opsUserId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function mkLinkedOpsUser() {
  const [user] = await db.insert(s.users).values({
    username: `c5-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  if (opsUserId === 0) opsUserId = user.id;
  return user.id;
}

async function mkLotForUser(userId: number) {
  const [customer] = await db.insert(s.customers).values({ name: `C5 customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `C5 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [link] = await db.insert(s.userShipmentLinks).values({ userId, shipmentId: shipment.id }).returning({ id: s.userShipmentLinks.id });
  track(s.userShipmentLinks, link.id);
  return shipment.id;
}

before(async () => {
  await initEnforcer();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.header('X-Test-User-Id');
    if (header) (req as express.Request & { user?: unknown }).user = {
      userId: Number(header),
      username: 'test', email: 'test@x', fullName: 'test', role: Role.OPS,
    };
    next();
  });
  app.use('/api/ops', opsRoutes);
  app.use(globalErrorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    for (const { table, id } of cleanup) {
      await db.delete(table).where(eq(table.id, id));
    }
  } catch {
    // red-phase tolerance
  }
  await disconnectRedis();
});

describe('card 20260921_5 — no-invoice charge pair', () => {
  test('create with charge override stores both sides distinctly', async () => {
    await mkLinkedOpsUser();
    const shipmentId = await mkLotForUser(opsUserId);
    const created = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 50000,
      paidAt: '2026-09-22',
      costGroup: 'OPS_INCIDENTAL',
      feeName: 'Ship lạch huyện QA',
      customerChargeAmount: 30000,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
    const [entry] = await db.select().from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.id, Number(created.body.id)));
    assert.ok(entry, 'the expense entry exists');
    assert.equal(String(entry.amount), '50000');
    assert.equal(String(entry.customerChargeAmount), '30000');
  });

  test('invoice rows keep charge = amount even when an override is sent', async () => {
    await mkLinkedOpsUser();
    const shipmentId = await mkLotForUser(opsUserId);
    const created = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'LIFTING',
      amount: 100000,
      paidAt: '2026-09-22',
      customerChargeAmount: 777,
    });
    assert.equal(created.status, 201);
    const [entry] = await db.select().from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.id, Number(created.body.id)));
    assert.ok(entry, 'the expense entry exists');
    assert.equal(String(entry.customerChargeAmount), '100000');
  });
  // Card 20260928_162 criterion 2. The PM was explicit that this must be
  // enforced by the SYSTEM, not by a disabled button: "hệ thống chặn lưu khi
  // thiếu (kiểm bằng test, không chỉ bằng UI disable)". Nothing enforced it —
  // `note` was optional on the route and the service stored null.
  test('an UNCHARGED no-invoice row is refused server-side when the note is blank', async () => {
    await mkLinkedOpsUser();
    const shipmentId = await mkLotForUser(opsUserId);
    const before = await db.select({ id: s.opsExpenseEntries.id })
      .from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.shipmentId, shipmentId));

    // customerChargeAmount omitted ⇒ charges the customer nothing.
    const rejected = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 50000,
      paidAt: '2026-09-22',
    });
    assert.equal(rejected.status, 400, 'the save must be refused, not silently accepted');
    assert.match(String(rejected.body?.error ?? ''), /bắt buộc nhập ghi chú/);

    // A blank/whitespace note is the same as no note — trimming first means a
    // row of spaces cannot buy its way past the rule.
    const blank = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 50000,
      paidAt: '2026-09-22',
      note: '   ',
    });
    assert.equal(blank.status, 400, 'a whitespace-only note is not a reason');

    // And nothing was written: the insert happens before the guard computes the
    // charge, so this also pins that the throw rolls the row back.
    const after = await db.select({ id: s.opsExpenseEntries.id })
      .from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.shipmentId, shipmentId));
    assert.equal(after.length, before.length, 'a refused row must not leave an orphan behind');
  });

  test('the same uncharged row saves once a reason is given', async () => {
    await mkLinkedOpsUser();
    const shipmentId = await mkLotForUser(opsUserId);
    const ok = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 50000,
      paidAt: '2026-09-22',
      note: 'Sửa tờ khai, khách tự chi, không thu lại',
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 200));
  });

  test('a CHARGED no-invoice row needs no note — the rule must not over-reach', async () => {
    // Without this, "require a note" could silently start rejecting the ordinary
    // case where Ops is recovering the cost from the customer.
    await mkLinkedOpsUser();
    const shipmentId = await mkLotForUser(opsUserId);
    const created = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 50000,
      paidAt: '2026-09-22',
      customerChargeAmount: 50000,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
  });
});

describe('card 20260921_5 — dispatch plan note path', () => {
  test('charged no-invoice fees surface by fee name; uncharged stay silent', async () => {
    const { loadDispatchExpenseNotes } = await import('../services/dispatch-expense-notes.service');
    await mkLinkedOpsUser();
    const shipmentId = await mkLotForUser(opsUserId);

    const charged = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 40000,
      paidAt: '2026-09-22',
      costGroup: 'OPS_INCIDENTAL',
      feeName: 'Phí xe nâng QA',
      customerChargeAmount: 60000,
    });
    assert.equal(charged.status, 201);
    // Card 20260928_162 made the note mandatory on uncharged rows, so this row
    // now carries one. The assertion below is unchanged and still the point of
    // the test: being uncharged keeps the amount off the dispatch plan.
    const silent = await api('POST', '/api/ops/expenses', {
      shipmentId,
      expenseTypeCode: 'OTHER',
      amount: 20000,
      paidAt: '2026-09-22',
      costGroup: 'OPS_REGULAR',
      customerChargeAmount: 0,
      note: 'Chi nội bộ, không thu khách',
    });
    assert.equal(silent.status, 201, JSON.stringify(silent.body).slice(0, 200));

    const notes = await loadDispatchExpenseNotes([shipmentId]);
    const list = notes.get(shipmentId) ?? [];
    assert.ok(list.some((note) => note.includes('Thu khách: Phí xe nâng QA')), JSON.stringify(list));
    assert.ok(!list.some((note) => note.includes('20000')), 'the uncharged amount never enters the plan');
  });
});
