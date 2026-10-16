import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { globalErrorHandler } from '../middleware/errorHandler';
import opsRoutes from '../routes/ops';

// Card 141026230720 — the entry path itself must warn on a duplicate cost:
// the SAME expense type on the SAME scope (one container, or lot-wide when
// both rows are container-less) entered twice. The unconfirmed save bounces
// with 409 OPS_EXPENSE_DUPLICATE naming the earlier rows; an explicit
// duplicateConfirmed resend saves (split payments stay legitimate). Voided
// rows never count, and a cont-scoped row never collides with a lot-wide row.

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<() => Promise<unknown>> = [];
function track(run: () => Promise<unknown>) {
  cleanup.unshift(run);
}
let server: http.Server;
const createdEntryIds: number[] = [];

async function post(userId: number, body: unknown, key: string) {
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ops/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-User-Id': String(userId), 'Idempotency-Key': key },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  const json = parsed as { id?: number };
  if (response.status === 201 && typeof json.id === 'number') createdEntryIds.push(json.id);
  return { status: response.status, body: parsed };
}

function expenseBody(shipmentId: number, containerId: number | null, typeCode: string, extra: Record<string, unknown> = {}) {
  return {
    shipmentId,
    shipmentContainerId: containerId,
    expenseTypeCode: typeCode,
    amount: '15000',
    paidAt: '2026-10-16',
    note: `QA duplicate-warning regression ${suffix}`,
    ...extra,
  };
}

async function mkOpsUser(name: string) {
  const [user] = await db.insert(s.users).values({
    username: `dupw-${suffix}-${cleanup.length}`, passwordHash: 't', fullName: name, role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(() => db.delete(s.users).where(eq(s.users.id, user.id)));
  return user.id;
}

async function mkType(code: string, name: string) {
  const [type] = await db.insert(s.forwarderExpenseTypes).values({ code, name })
    .returning({ id: s.forwarderExpenseTypes.id });
  track(() => db.delete(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.id, type.id)));
  return code;
}

async function mkLot() {
  const [customer] = await db.insert(s.customers).values({ name: `Dupw customer ${suffix}-${cleanup.length}` }).returning({ id: s.customers.id });
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
    if (createdEntryIds.length) {
      await db.delete(s.expenseAccountingSources).where(and(
        eq(s.expenseAccountingSources.sourceKind, 'OPS'),
        inArray(s.expenseAccountingSources.sourceId, createdEntryIds),
      ));
      await db.delete(s.opsExpenseEntries).where(inArray(s.opsExpenseEntries.id, createdEntryIds));
    }
    for (const remove of cleanup) {
      await remove();
    }
  } catch {
    // cleanup tolerance
  }
  await disconnectRedis();
});

describe('141026230720 — duplicate cost-entry warning on the write path', () => {
  test('same type + same cont twice: 409 with the earlier row, then a confirmed resend saves', async () => {
    const opsA = await mkOpsUser('Ops Nguyễn');
    const opsB = await mkOpsUser('Ops Trần');
    const typeCode = await mkType(`DUPW_A_${suffix}`, 'Phí soi chiếu (dupw)');
    const shipmentId = await mkLot();
    const contA = await mkContainer(shipmentId, 'DUPW1111111');

    const first = await post(opsA, expenseBody(shipmentId, contA, typeCode), `dupw-1a-${suffix}`);
    assert.equal(first.status, 201, JSON.stringify(first.body).slice(0, 300));

    const dup = await post(opsB, expenseBody(shipmentId, contA, typeCode), `dupw-1b-${suffix}`);
    assert.equal(dup.status, 409, JSON.stringify(dup.body).slice(0, 300));
    const body = dup.body as { code?: string; error?: string; duplicates?: Array<{ paidByName?: string; amount?: string; paidAt?: string; containerNumber?: string }> };
    assert.equal(body.code, 'OPS_EXPENSE_DUPLICATE');
    assert.ok(body.error?.includes('Ops Nguyễn'), `message names the earlier claimant: ${body.error}`);
    assert.equal(body.duplicates?.length, 1);
    assert.equal(body.duplicates?.[0]?.paidByName, 'Ops Nguyễn');
    assert.equal(body.duplicates?.[0]?.containerNumber, 'DUPW1111111');
    assert.equal(body.duplicates?.[0]?.amount, '15000');
    assert.equal(body.duplicates?.[0]?.paidAt, '2026-10-16');

    const confirmed = await post(opsB, expenseBody(shipmentId, contA, typeCode, { duplicateConfirmed: true }), `dupw-1c-${suffix}`);
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body).slice(0, 300));
  });

  test('a different type on the same cont, or the same type on another cont, saves without the warning', async () => {
    const opsA = await mkOpsUser('Ops Lê');
    const typeX = await mkType(`DUPW_X_${suffix}`, 'Phí kiểm hóa (dupw)');
    const typeY = await mkType(`DUPW_Y_${suffix}`, 'Phí vệ sinh (dupw)');
    const shipmentId = await mkLot();
    const contA = await mkContainer(shipmentId, 'DUPW2222222');
    const contB = await mkContainer(shipmentId, 'DUPW3333333');

    assert.equal((await post(opsA, expenseBody(shipmentId, contA, typeX), `dupw-2a-${suffix}`)).status, 201);
    const otherType = await post(opsA, expenseBody(shipmentId, contA, typeY), `dupw-2b-${suffix}`);
    assert.equal(otherType.status, 201, JSON.stringify(otherType.body).slice(0, 300));
    const otherCont = await post(opsA, expenseBody(shipmentId, contB, typeX), `dupw-2c-${suffix}`);
    assert.equal(otherCont.status, 201, JSON.stringify(otherCont.body).slice(0, 300));
  });

  test('lot-wide scope: a second lot-wide row of the same type warns, a cont row of that type does not', async () => {
    const opsA = await mkOpsUser('Ops Phạm');
    const typeCode = await mkType(`DUPW_L_${suffix}`, 'Phí chung (dupw)');
    const shipmentId = await mkLot();
    const contA = await mkContainer(shipmentId, 'DUPW4444444');

    assert.equal((await post(opsA, expenseBody(shipmentId, null, typeCode), `dupw-3a-${suffix}`)).status, 201);
    const dupLot = await post(opsA, expenseBody(shipmentId, null, typeCode), `dupw-3b-${suffix}`);
    assert.equal(dupLot.status, 409, JSON.stringify(dupLot.body).slice(0, 300));
    assert.equal((dupLot.body as { code?: string }).code, 'OPS_EXPENSE_DUPLICATE');
    assert.ok((dupLot.body as { error?: string }).error?.includes('phí chung lô'));
    const contScoped = await post(opsA, expenseBody(shipmentId, contA, typeCode), `dupw-3c-${suffix}`);
    assert.equal(contScoped.status, 201, JSON.stringify(contScoped.body).slice(0, 300));
  });

  test('a VOIDED earlier row never warns — the tombstone is not a cost', async () => {
    const opsA = await mkOpsUser('Ops Hồ');
    const typeCode = await mkType(`DUPW_V_${suffix}`, 'Phí đã hủy (dupw)');
    const shipmentId = await mkLot();
    const contA = await mkContainer(shipmentId, 'DUPW5555555');

    const [voided] = await db.insert(s.opsExpenseEntries).values({
      shipmentId, shipmentContainerId: contA, expenseTypeCode: typeCode,
      amount: '1000', paidById: opsA, paidAt: '2026-10-14', approvalStatus: 'VOIDED',
    }).returning({ id: s.opsExpenseEntries.id });
    track(() => db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, voided.id)));

    const fresh = await post(opsA, expenseBody(shipmentId, contA, typeCode), `dupw-4a-${suffix}`);
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body).slice(0, 300));
  });
});
