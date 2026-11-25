// CR-011 (25/11 UAT-4) supersedes SIL-966 — receipt photos are OPTIONAL on the
// Ops cash-expense write path for every fee kind: the nâng / hạ / Lưu-cont
// kinds included (SIL-966's hard gate is removed from create and update, and
// the shared OPS_RECEIPT_* law was deleted from @tingting/shared). The DRIVER
// side keeps its own mandatory-photo law (DRIVER_RECEIPT_REQUIRED_EXPENSE_
// TYPE_CODES + driverLotCostRequiresReceipt + ShipmentCostEntryForm) — that
// is a different surface and is untouched here.
// Fixture shape mirrors ops-no-invoice-container-required.test.ts (real dev
// DB, tracked cleanup, unique suffix so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { attachOpsExpensePhoto, createOpsExpense, updateOpsExpense } from '../services/ops-expenses.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PAID_AT = '2026-11-24';
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

/** A storage key the write path accepts as this user's own Ops receipt
 *  (ops-expense-photos/<uid>/<sha256hex>.jpg — assertOwnStorageKey's shape). */
function ownPhotoKey(userId: number, tag: string): string {
  return `ops-expense-photos/${userId}/${tag.padEnd(32, '0').slice(0, 32)}.jpg`;
}

async function trackCreatedSource(expenseId: number) {
  const [source] = await db.select({ id: s.expenseAccountingSources.id })
    .from(s.expenseAccountingSources)
    .where(eq(s.expenseAccountingSources.sourceId, expenseId));
  if (source) track(s.expenseAccountingSources, source.id);
}

async function mkFixture(opts: { category: string | null; code?: string }) {
  const [user] = await db.insert(s.users).values({
    username: `cr011-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `CR011 customer ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: 'CR011 route' }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED', expectedDeliveryDate: PAID_AT,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `S96U30543${cleanup.length % 10}`.slice(0, 11),
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  let type: { id: number; code: string | null };
  if (opts.code != null) {
    // The production-truth row: the fill-only seed owns this code, so reuse
    // the live row when present (shared catalog data — never tracked for
    // deletion) and only a fresh insert (empty dev DB) is cleanup-tracked.
    const [existing] = await db.select({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code })
      .from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.code, opts.code)).limit(1);
    if (existing) {
      type = existing;
    } else {
      [type] = await db.insert(s.forwarderExpenseTypes).values({
        code: opts.code, name: 'Phí nâng/hạ theo vùng', status: 'ACTIVE', requiresInvoice: false,
        category: opts.category,
      }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code });
      track(s.forwarderExpenseTypes, type.id);
    }
  } else {
    [type] = await db.insert(s.forwarderExpenseTypes).values({
      code: `CR011_${opts.category ?? 'NOCAT'}_${suffix}_${cleanup.length}`,
      name: `CR011 loại phí ${cleanup.length}`, status: 'ACTIVE', requiresInvoice: false,
      category: opts.category,
    }).returning({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code });
    track(s.forwarderExpenseTypes, type.id);
  }
  return { user: user.id, shipmentId: shipment.id, containerId: container.id, typeCode: type.code! };
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

describe('CR-011 — ảnh chứng từ không bắt buộc với mọi loại phí khai báo Ops (BE)', () => {
  test('create: photo-less Phí nâng/hạ theo vùng (structural code axis) saves and writes the row', async () => {
    const fx = await mkFixture({ code: 'ZONE_SURCHARGE', category: 'PHAT_SINH' });
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '20000', paidAt: PAID_AT,
      shipmentContainerIds: [fx.containerId],
    });
    trackCreatedSource(created.id);
    track(s.opsExpenseEntries, created.id);
    assert.equal(created.expenseTypeCode, fx.typeCode);
    const photos = await db.select({ id: s.opsExpensePhotos.id })
      .from(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.opsExpenseId, created.id));
    assert.deepEqual(photos, []);
  });

  test('create: photo-less DROP and LIFT kinds (category axis) save too; the optional-photo path is unchanged', async () => {
    for (const category of ['DROP', 'LIFT']) {
      const fx = await mkFixture({ category });
      const created = await createOpsExpense(fx.user, {
        shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
        shipmentContainerIds: [fx.containerId],
      });
      trackCreatedSource(created.id);
      track(s.opsExpenseEntries, created.id);
      assert.equal(created.expenseTypeCode, fx.typeCode);
    }
    // Attaching evidence on create stays open for every kind.
    const fx = await mkFixture({ code: 'ZONE_SURCHARGE', category: 'PHAT_SINH' });
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '20000', paidAt: PAID_AT,
      shipmentContainerIds: [fx.containerId],
      photoStorageKeys: [ownPhotoKey(fx.user, 'a')],
    });
    trackCreatedSource(created.id);
    track(s.opsExpenseEntries, created.id);
    const photos = await db.select({ id: s.opsExpensePhotos.id })
      .from(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.opsExpenseId, created.id));
    assert.equal(photos.length, 1);
    for (const photo of photos) track(s.opsExpensePhotos, photo.id);
  });

  test('update: a photo-less row re-saves freely; attaching evidence stays open', async () => {
    const fx = await mkFixture({ code: 'ZONE_SURCHARGE', category: 'PHAT_SINH' });
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
      shipmentContainerIds: [fx.containerId],
    });
    trackCreatedSource(created.id);
    track(s.opsExpenseEntries, created.id);
    const edited = await updateOpsExpense(fx.user, created.id, { note: 'CR-011 edit', expectedVersion: created.version, reason: 'CR-011 test' });
    assert.equal(edited.note, 'CR-011 edit');
    // The attach endpoint stays open (evidence supplement on any row).
    const photo = await attachOpsExpensePhoto(fx.user, created.id, ownPhotoKey(fx.user, 'c'));
    assert.ok(photo);
    track(s.opsExpensePhotos, photo.id);
  });
});
