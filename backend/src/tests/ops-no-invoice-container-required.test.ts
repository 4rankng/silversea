// SIL-910 — KB §5.4.2 (V17): the Phí không hóa đơn group REQUIRES a selected
// container. The audit (2026-11-24 mục 5.7) showed the server accepting a
// no-invoice fee with an empty container list (201); the write now refuses
// with 400 on create and on any edit that clears the container scope, while
// the invoice group keeps its legal chung-lô (no-container) path.
// Fixture shape mirrors phoi-phieu-party-lots.test.ts (real dev DB, tracked
// cleanup, unique suffix so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
import { createOpsExpense, updateOpsExpense } from '../services/ops-expenses.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PAID_AT = '2026-11-24';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

async function mkFixture(opts: { requiresInvoice: boolean }) {
  const [user] = await db.insert(s.users).values({
    username: `s910-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `S910 customer ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: 'S910 route' }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: PAID_AT,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `S91U30543${cleanup.length % 10}`.slice(0, 11),
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  const [type] = await db.insert(s.forwarderExpenseTypes).values({
    code: `S910_${opts.requiresInvoice ? 'INV' : 'NOINV'}_${suffix}_${cleanup.length}`,
    name: `S910 loại phí ${cleanup.length}`, status: 'ACTIVE', requiresInvoice: opts.requiresInvoice,
  }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code });
  track(s.forwarderExpenseTypes, type.id);
  return { user: user.id, shipmentId: shipment.id, containerId: container.id, typeCode: type.code };
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-910 — phí không hóa đơn bắt buộc chọn container (BE hard gate)', () => {
  test('create: no-invoice fee with an empty container list refuses with 400 and writes nothing', async () => {
    const fx = await mkFixture({ requiresInvoice: false });
    await assert.rejects(
      createOpsExpense(fx.user, {
        shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
        shipmentContainerIds: [],
      }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Phí không hóa đơn bắt buộc chọn số container/);
        return true;
      },
    );
    const left = await db.select({ id: s.opsExpenseEntries.id }).from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.expenseTypeCode, fx.typeCode));
    assert.deepEqual(left, []);
  });

  test('create: no-invoice fee with a container set still saves and scopes the row', async () => {
    const fx = await mkFixture({ requiresInvoice: false });
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
      shipmentContainerIds: [fx.containerId],
    });
    track(s.opsExpenseEntries, created.id);
    track(s.expenseAccountingSources, (await db.select({ id: s.expenseAccountingSources.id })
      .from(s.expenseAccountingSources)
      .where(eq(s.expenseAccountingSources.sourceId, created.id))).at(0)!.id);
    assert.deepEqual(created.shipmentContainerIds, [fx.containerId]);
  });

  test('create: invoice-class fee keeps its legal chung-lô (no container) path', async () => {
    const fx = await mkFixture({ requiresInvoice: true });
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
      invoiceNumber: `S910-INV-${suffix}`,
    });
    track(s.opsExpenseEntries, created.id);
    track(s.expenseAccountingSources, (await db.select({ id: s.expenseAccountingSources.id })
      .from(s.expenseAccountingSources)
      .where(eq(s.expenseAccountingSources.sourceId, created.id))).at(0)!.id);
    assert.equal(created.shipmentContainerId, null);
    assert.equal(created.shipmentContainerIds, null);
  });

  test('update: clearing the container scope of a no-invoice row refuses; a note-only edit passes', async () => {
    const fx = await mkFixture({ requiresInvoice: false });
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
      shipmentContainerIds: [fx.containerId],
    });
    track(s.opsExpenseEntries, created.id);
    track(s.expenseAccountingSources, (await db.select({ id: s.expenseAccountingSources.id })
      .from(s.expenseAccountingSources)
      .where(eq(s.expenseAccountingSources.sourceId, created.id))).at(0)!.id);
    await assert.rejects(
      updateOpsExpense(fx.user, created.id, { shipmentContainerIds: [], expectedVersion: created.version, reason: 'SIL-910 test' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Phí không hóa đơn bắt buộc chọn số container/);
        return true;
      },
    );
    const edited = await updateOpsExpense(fx.user, created.id, {
      note: 'SIL-910 note-only edit', expectedVersion: created.version, reason: 'SIL-910 test',
    });
    assert.equal(edited.note, 'SIL-910 note-only edit');
    assert.deepEqual(edited.shipmentContainerIds, [fx.containerId]);
  });
});
