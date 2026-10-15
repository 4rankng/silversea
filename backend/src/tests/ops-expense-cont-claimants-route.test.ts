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

// Plan step 5 (Ops scope) — the declaration dialog warns about a cont that
// already carries someone else's entry. The endpoint must name the claimant
// and the cont, stay warning-only (no verdict, no block), and never leak
// voided rows or lot-wide (container-less) rows as container claims.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}
let server: http.Server;

async function api(path: string, userId: number) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method: 'GET',
    headers: { 'X-Test-User-Id': String(userId) },
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function mkOpsUser(name: string) {
  const [user] = await db.insert(s.users).values({
    username: `cclaim-${suffix}-${cleanup.length}`, passwordHash: 't', fullName: name, role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(() => db.delete(s.users).where(eq(s.users.id, user.id)));
  return user.id;
}

async function mkLot() {
  const [customer] = await db.insert(s.customers).values({ name: `Cclaim customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
  track(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning({ id: s.shipments.id });
  track(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  return shipment.id;
}

async function mkContainer(shipmentId: number, containerNumber: string) {
  const [container] = await db.insert(s.shipmentContainers).values({ shipmentId, containerNumber })
    .returning({ id: s.shipmentContainers.id });
  track(() => db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.id, container.id)));
  return container.id;
}

async function mkClaim(shipmentId: number, containerId: number | null, paidById: number, approvalStatus: 'RECORDED' | 'VOIDED') {
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId, shipmentContainerId: containerId, expenseTypeCode: 'OTHER',
    amount: '1000', paidById, paidAt: '2026-10-14', approvalStatus,
  }).returning({ id: s.opsExpenseEntries.id });
  track(() => db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, entry.id)));
  return entry.id;
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
    for (const remove of cleanup) {
      await remove();
    }
  } catch {
    // cleanup tolerance
  }
  await disconnectRedis();
});

describe('plan step 5 — ops expense cont-claimants (duplicate-cont warning source)', () => {
  test('a live container claim lists the cont number and the claimant name', async () => {
    const caller = await mkOpsUser('Ops gọi');
    const claimant = await mkOpsUser('Ops Trần');
    const shipmentId = await mkLot();
    const containerId = await mkContainer(shipmentId, 'TGHU1234567');
    await mkClaim(shipmentId, containerId, claimant, 'RECORDED');

    const verdict = await api(`/api/ops/expenses/cont-claimants?shipmentId=${shipmentId}`, caller);
    assert.equal(verdict.status, 200, JSON.stringify(verdict.body).slice(0, 200));
    assert.deepEqual(verdict.body, [
      { containerId, containerNumber: 'TGHU1234567', paidByName: 'Ops Trần' },
    ]);
  });

  test('voided rows and lot-wide rows never count as a container claim', async () => {
    const caller = await mkOpsUser('Ops gọi 2');
    const claimant = await mkOpsUser('Ops Lê');
    const shipmentId = await mkLot();
    const claimed = await mkContainer(shipmentId, 'TGHU7654321');
    const voided = await mkContainer(shipmentId, 'TGHU0000000');
    await mkClaim(shipmentId, claimed, claimant, 'RECORDED');
    await mkClaim(shipmentId, voided, claimant, 'VOIDED');
    await mkClaim(shipmentId, null, claimant, 'RECORDED');

    const verdict = await api(`/api/ops/expenses/cont-claimants?shipmentId=${shipmentId}`, caller);
    assert.equal(verdict.status, 200);
    assert.deepEqual(verdict.body, [
      { containerId: claimed, containerNumber: 'TGHU7654321', paidByName: 'Ops Lê' },
    ]);
  });

  test('a malformed shipmentId is a 4xx, never a fake claimant list', async () => {
    const caller = await mkOpsUser('Ops gọi 3');
    const verdict = await api('/api/ops/expenses/cont-claimants?shipmentId=abc', caller);
    assert.ok(verdict.status >= 400 && verdict.status < 500, `status ${verdict.status}`);
  });
});
