// SIL-966 — KB §8.1.3 (K8.32): ảnh chứng từ is REQUIRED for the nâng / hạ /
// Lưu-cont fee kinds on the Ops cash-expense write path. The QA repro
// (staging df7b2a73) declared "Phí nâng/hạ theo vùng" with no photo and the
// row saved; create and update now refuse with 400 while every other fee
// kind keeps its optional-photo path. QA FAIL round 2 (04:05 25/11, build
// 9a96af4a): the first cut keyed ONLY on the catalog category, but the live
// ZONE_SURCHARGE row carries PHAT_SINH — the ladder classifies it as a
// settlement bucket (card 20260919_3) and the fill-only seed never rewrites
// an existing category — so the gate must also read the structural code. The
// rule itself (code or category → required) lives in shared constants so the
// FE form and this write path can never disagree; these tests pin the write
// side end-to-end against the PRODUCTION row shape.
// Fixture shape mirrors ops-no-invoice-container-required.test.ts (real dev
// DB, tracked cleanup, unique suffix so no other suite can bleed in).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { OPS_RECEIPT_PHOTO_REQUIRED_MESSAGE, opsExpenseRequiresReceiptPhoto, Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
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
    username: `s966-${suffix}-${cleanup.length}`, passwordHash: 't', role: Role.OPS, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  const [customer] = await db.insert(s.customers).values({
    name: `S966 customer ${suffix}-${cleanup.length}`,
  }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: 'S966 route' }).returning({ id: s.routes.id });
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
      code: `S966_${opts.category ?? 'NOCAT'}_${suffix}_${cleanup.length}`,
      name: `S966 loại phí ${cleanup.length}`, status: 'ACTIVE', requiresInvoice: false,
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

describe('SIL-966 — phí nâng/hạ/Lưu cont bắt buộc ảnh chứng từ (BE hard gate)', () => {
  test('the shared law fires on either axis — structural code or category — and stays quiet on a plain fee', () => {
    // The QA FAIL 04:05 25/11 shape: live category PHAT_SINH, structural code ZONE_SURCHARGE.
    assert.equal(opsExpenseRequiresReceiptPhoto('PHAT_SINH', 'ZONE_SURCHARGE'), true);
    // A live row predating the category backfill carries NULL — the code alone must hold.
    assert.equal(opsExpenseRequiresReceiptPhoto(null, 'ZONE_SURCHARGE'), true);
    // The category axis still works alone (admin-classified row, custom code).
    assert.equal(opsExpenseRequiresReceiptPhoto('ZONE_SURCHARGE', 'ZONE_HN'), true);
    assert.equal(opsExpenseRequiresReceiptPhoto('DROP', 'S966_ANY'), true);
    assert.equal(opsExpenseRequiresReceiptPhoto('LIFT', null), true);
    // Plain fees stay optional.
    assert.equal(opsExpenseRequiresReceiptPhoto('PHAT_SINH', 'FEE_CLEANING'), false);
    assert.equal(opsExpenseRequiresReceiptPhoto(null, 'CUSTOM_FEE'), false);
    assert.equal(opsExpenseRequiresReceiptPhoto(null, null), false);
  });

  test('create: the QA repro fee (Phí nâng/hạ theo vùng, no photo) refuses with the KB message and writes nothing', async () => {
    // Production truth: the live row's category is PHAT_SINH (settlement
    // bucket), so THIS case exercises the structural-code axis end-to-end —
    // the axis the first cut missed.
    const fx = await mkFixture({ code: 'ZONE_SURCHARGE', category: 'PHAT_SINH' });
    await assert.rejects(
      createOpsExpense(fx.user, {
        shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '20000', paidAt: PAID_AT,
        shipmentContainerIds: [fx.containerId],
      }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, OPS_RECEIPT_PHOTO_REQUIRED_MESSAGE);
        return true;
      },
    );
    // Scoped to this fixture's lot: the reused production code legitimately
    // carries other lots' rows in a seeded dev DB.
    const left = await db.select({ id: s.opsExpenseEntries.id }).from(s.opsExpenseEntries)
      .where(and(eq(s.opsExpenseEntries.expenseTypeCode, fx.typeCode), eq(s.opsExpenseEntries.shipmentId, fx.shipmentId)));
    assert.deepEqual(left, []);
  });

  test('create: the same fee WITH a receipt photo still saves (the legal case stays open)', async () => {
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
    for (const photo of photos) track(s.opsExpensePhotos, photo.id);
    assert.equal(photos.length, 1);
  });

  test('create: DROP and LIFT kinds refuse photo-less too; PHAT_SINH (phí khác) keeps its optional-photo path', async () => {
    for (const category of ['DROP', 'LIFT']) {
      const fx = await mkFixture({ category });
      await assert.rejects(
        createOpsExpense(fx.user, {
          shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
          shipmentContainerIds: [fx.containerId],
        }),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.message, OPS_RECEIPT_PHOTO_REQUIRED_MESSAGE);
          return true;
        },
      );
    }
    const other = await mkFixture({ category: 'PHAT_SINH' });
    const created = await createOpsExpense(other.user, {
      shipmentId: other.shipmentId, expenseTypeCode: other.typeCode, amount: '50000', paidAt: PAID_AT,
      shipmentContainerIds: [other.containerId],
    });
    trackCreatedSource(created.id);
    track(s.opsExpenseEntries, created.id);
    assert.equal(created.expenseTypeCode, other.typeCode);
  });

  test('update: a photo-less row of a required kind cannot be re-saved; attaching the evidence reopens the edit', async () => {
    // The production code shape rides the edit path too — the update gate
    // reads the effective (patch or stored) code beside the category.
    const fx = await mkFixture({ code: 'ZONE_SURCHARGE', category: 'PHAT_SINH' });
    // The row enters the world WITH its photo (the create gate insists); the
    // test then strips it to reproduce legacy photo-less data directly.
    const created = await createOpsExpense(fx.user, {
      shipmentId: fx.shipmentId, expenseTypeCode: fx.typeCode, amount: '50000', paidAt: PAID_AT,
      shipmentContainerIds: [fx.containerId],
      photoStorageKeys: [ownPhotoKey(fx.user, 'b')],
    });
    trackCreatedSource(created.id);
    track(s.opsExpenseEntries, created.id);
    await db.delete(s.opsExpensePhotos).where(eq(s.opsExpensePhotos.opsExpenseId, created.id));

    await assert.rejects(
      updateOpsExpense(fx.user, created.id, { note: 'SIL-966 edit', expectedVersion: created.version, reason: 'SIL-966 test' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, OPS_RECEIPT_PHOTO_REQUIRED_MESSAGE);
        return true;
      },
    );
    // The attach endpoint stays open (evidence supplement, even on a locked
    // row), so the author can always cure the refusal and edit after.
    const photo = await attachOpsExpensePhoto(fx.user, created.id, ownPhotoKey(fx.user, 'c'));
    assert.ok(photo);
    track(s.opsExpensePhotos, photo.id);
    const edited = await updateOpsExpense(fx.user, created.id, { note: 'SIL-966 edit', expectedVersion: created.version, reason: 'SIL-966 test' });
    assert.equal(edited.note, 'SIL-966 edit');
  });
});
