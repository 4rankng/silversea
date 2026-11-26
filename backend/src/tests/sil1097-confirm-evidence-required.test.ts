// SIL-1097 (KB §3.5.4 K3.71 — "không hóa đơn ≠ không cần biên lai"): khoản chi
// không có số hóa đơn phải mang biên lai (ảnh/tài liệu) trước khi kế toán đối
// chiếu; thiếu cả hai thì không xác nhận được. Guard nằm trong
// confirmAccountingExpenses — cổng xác nhận duy nhất nên mọi bề mặt (đối soát
// tập trung, bảng đăng ký, bảng Ops, duyệt sau khi tạo) đều đi qua nó.
// Fixture shape mirrors ops-receipt-photo-required.test.ts (real dev DB,
// tracked cleanup, unique suffix so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PAID_AT = '2026-11-25';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
const cleanupSourceIds: number[] = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

const FEE_NAME = `Hải quan luồng xanh SIL1097 ${suffix}`;

async function mkFixture(opts: { invoiceNumber?: string; photo?: string; attachment?: string }) {
  const [admin] = await db.insert(s.users).values({
    username: `sil1097-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  const [customer] = await db.insert(s.customers).values({ name: `SIL1097 customer ${suffix}-${cleanup.length}` })
    .returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `SIL1097 route ${suffix}-${cleanup.length}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: PAID_AT,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: shipment.id, expenseTypeCode: 'SIL1097_PROBE', amount: '50000',
    paidById: null, paidAt: PAID_AT, approvalStatus: 'RECORDED',
    // payerKind COMPANY → khoản công ty trả trực tiếp, không dính machinery
    // hoàn ứng/ledger của người chi — test này nói về luật bằng chứng.
    payerKind: 'COMPANY', costGroup: 'OPS_REGULAR', feeName: FEE_NAME,
    customerChargeAmount: '50000', invoiceNumber: opts.invoiceNumber ?? null,
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [link] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: shipment.id, recordedById: admin.id,
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, link.id);
  cleanupSourceIds.push(link.id);
  if (opts.photo) {
    const [photo] = await db.insert(s.opsExpensePhotos).values({
      opsExpenseId: entry.id, storageKey: opts.photo, uploadedById: admin.id,
    }).returning({ id: s.opsExpensePhotos.id });
    track(s.opsExpensePhotos, photo.id);
  }
  if (opts.attachment) {
    const [attachment] = await db.insert(s.expenseAccountingEvidence).values({
      expenseAccountingSourceId: link.id, storageKey: opts.attachment, uploadedById: admin.id,
    }).returning({ id: s.expenseAccountingEvidence.id });
    track(s.expenseAccountingEvidence, attachment.id);
  }
  return { adminId: admin.id, sourceId: link.id, nativeId: entry.id };
}

function confirmRow(fx: { adminId: number; sourceId: number; nativeId: number }) {
  return db.transaction((tx) => confirmAccountingExpenses(tx, { userId: fx.adminId, role: Role.ADMIN },
    [{ sourceKind: 'OPS', sourceId: fx.nativeId, expectedVersion: 1 }]));
}

async function confirmedAt(sourceId: number) {
  const [row] = await db.select({ confirmedAt: s.expenseAccountingSources.confirmedAt })
    .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, sourceId));
  return row?.confirmedAt ?? null;
}

after(async () => {
  for (const id of cleanupSourceIds) {
    await db.delete(s.auditLogs).where(eq(s.auditLogs.entityId, id));
  }
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('SIL-1097 — không hóa đơn vẫn cần biên lai mới được đối chiếu (BE)', () => {
  test('thiếu cả hóa đơn lẫn biên lai: xác nhận bị từ chối, thông báo nêu tên khoản', async () => {
    const fx = await mkFixture({});
    await assert.rejects(
      () => confirmRow(fx),
      (error: Error) => {
        assert.match(error.message, /chưa có hóa đơn cũng chưa có biên lai/);
        assert.ok(error.message.includes(FEE_NAME), `thông báo phải nêu tên khoản: ${error.message}`);
        return true;
      },
    );
    assert.equal(await confirmedAt(fx.sourceId), null, 'khoản trần trụi không được ghi nhận xác nhận');
  });

  test('có ảnh biên lai thì không cần hóa đơn — đối chiếu được', async () => {
    const fx = await mkFixture({ photo: `ops-expense-photos/${1}/${'a'.padEnd(32, '0')}.jpg` });
    await confirmRow(fx);
    assert.ok(await confirmedAt(fx.sourceId), 'khoản có biên lai ảnh phải đối chiếu được');
  });

  test('có số hóa đơn thì không cần ảnh — đối chiếu được', async () => {
    const fx = await mkFixture({ invoiceNumber: `HD-SIL1097-${suffix}` });
    await confirmRow(fx);
    assert.ok(await confirmedAt(fx.sourceId), 'khoản có hóa đơn phải đối chiếu được');
  });

  test('tài liệu đính kèm (expense_accounting_evidence) cũng là biên lai', async () => {
    const fx = await mkFixture({ attachment: `sil1097-doc-${suffix}.pdf` });
    await confirmRow(fx);
    assert.ok(await confirmedAt(fx.sourceId), 'khoản có tài liệu đính kèm phải đối chiếu được');
  });
});
