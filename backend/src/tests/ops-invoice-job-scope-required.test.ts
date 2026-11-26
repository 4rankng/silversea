// SIL-1090 — K2.68: phí trả nhà cung cấp để lấy hóa đơn là chi phí hóa đơn
// riêng của lô; một công việc duy nhất → gắn vào công việc đó; nhiều công việc
// → người nhập PHẢI chọn công việc chịu phí. Trước đây chỉ phí không hóa đơn
// bị chặn khi thiếu số container (SIL-910) — phí có hóa đơn trên lô 2 container
// (1221) vẫn lọt chung lô với shipmentContainerId null (bản ghi id 192,
// QA 26/11). Same fixture shape as ops-no-invoice-container-required.test.ts
// (real dev DB, tracked cleanup, unique suffix).
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
const PAID_AT = '2026-11-26';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

/** One lot with `containerCount` job rows and an INVOICE-class fee type. */
async function mkFixture(containerCount: number) {
  const [user] = await db.insert(s.users).values({
    username: `s1090-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `S1090 customer ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `S1090 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: PAID_AT,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const containerIds: number[] = [];
  for (let index = 0; index < containerCount; index++) {
    const [container] = await db.insert(s.shipmentContainers).values({
      shipmentId: shipment.id, containerNumber: `S19U${String(index).padStart(2, '0')}${cleanup.length % 100}`.slice(0, 11),
    }).returning({ id: s.shipmentContainers.id });
    track(s.shipmentContainers, container.id);
    containerIds.push(container.id);
  }
  const [type] = await db.insert(s.forwarderExpenseTypes).values({
    code: `S1090_INV_${suffix}_${cleanup.length}`,
    name: `S1090 loại phí ${cleanup.length}`, status: 'ACTIVE', requiresInvoice: true,
  }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code });
  track(s.forwarderExpenseTypes, type.id);
  return { user: user.id, shipmentId: shipment.id, containerIds, typeCode: type.code };
}

/** Track the written expense + its accounting-source twin for teardown. */
async function trackWritten(expenseId: number) {
  track(s.opsExpenseEntries, expenseId);
  const source = await db.select({ id: s.expenseAccountingSources.id })
    .from(s.expenseAccountingSources)
    .where(eq(s.expenseAccountingSources.sourceId, expenseId));
  if (source.at(0)) track(s.expenseAccountingSources, source.at(0)!.id);
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-1090 — phí có hóa đơn bắt buộc chọn công việc chịu phí (K2.68)', () => {
  test('create: invoice fee with empty scope on a MULTI-job lot refuses 400 and writes nothing', async () => {
    const fx = await mkFixture(2);
    await assert.rejects(
      createOpsExpense(fx.user, {
        shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '100000', paidAt: PAID_AT,
        invoiceNumber: `S1090-MULTI-${suffix}`,
      }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Phí có hóa đơn trên lô nhiều công việc bắt buộc chọn công việc chịu phí/);
        return true;
      },
    );
    const left = await db.select({ id: s.opsExpenseEntries.id }).from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.expenseTypeCode, fx.typeCode));
    assert.deepEqual(left, []);
  });

  test('create: invoice fee with empty scope on a SINGLE-job lot attaches to that job (một công việc duy nhất → gắn vào công việc đó)', async () => {
    const fx = await mkFixture(1);
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '100000', paidAt: PAID_AT,
      invoiceNumber: `S1090-SINGLE-${suffix}`,
    });
    await trackWritten(created.id);
    assert.equal(created.shipmentContainerId, fx.containerIds[0]);
    assert.deepEqual(created.shipmentContainerIds, [fx.containerIds[0]]);
  });

  test('create: invoice fee on a job-less lot keeps the chung-lô scope (both columns null)', async () => {
    const fx = await mkFixture(0);
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '100000', paidAt: PAID_AT,
      invoiceNumber: `S1090-LOT-${suffix}`,
    });
    await trackWritten(created.id);
    assert.equal(created.shipmentContainerId, null);
    assert.equal(created.shipmentContainerIds, null);
  });

  test('create: invoice fee with an explicit job scope on a MULTI-job lot saves unchanged', async () => {
    const fx = await mkFixture(2);
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '100000', paidAt: PAID_AT,
      invoiceNumber: `S1090-PICKED-${suffix}`,
      shipmentContainerIds: [fx.containerIds[1]],
    });
    await trackWritten(created.id);
    assert.equal(created.shipmentContainerId, fx.containerIds[1]);
    assert.deepEqual(created.shipmentContainerIds, [fx.containerIds[1]]);
  });

  test('update: clearing the scope of an invoice row on a MULTI-job lot refuses 400', async () => {
    const fx = await mkFixture(2);
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '100000', paidAt: PAID_AT,
      invoiceNumber: `S1090-UPD-${suffix}`,
      shipmentContainerIds: [fx.containerIds[0]],
    });
    await trackWritten(created.id);
    await assert.rejects(
      updateOpsExpense(fx.user, created.id, {
        shipmentContainerIds: [], expectedVersion: created.version, reason: 'SIL-1090 test',
      }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Phí có hóa đơn trên lô nhiều công việc bắt buộc chọn công việc chịu phí/);
        return true;
      },
    );
  });

  test('update: clearing the scope of an invoice row on a SINGLE-job lot re-attaches to that job', async () => {
    const fx = await mkFixture(1);
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '100000', paidAt: PAID_AT,
      invoiceNumber: `S1090-UPD1-${suffix}`,
    });
    await trackWritten(created.id);
    const edited = await updateOpsExpense(fx.user, created.id, {
      shipmentContainerIds: [], expectedVersion: created.version, reason: 'SIL-1090 test',
    });
    assert.equal(edited.shipmentContainerId, fx.containerIds[0]);
    assert.deepEqual(edited.shipmentContainerIds, [fx.containerIds[0]]);
  });
});
