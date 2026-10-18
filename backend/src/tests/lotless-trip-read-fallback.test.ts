/**
 * Card 191026100030 — "Chi phí lô hàng (bill hàng lẻ)" QA blocker class:
 * every board/read/mutation that resolved a trip's lot from `trips.shipment_id`
 * alone stranded wave-model (hàng-lẻ) trips, whose lot link lives ONLY on
 * `trips.fulfillment_id` (see `resolveTripShipmentId`). The write paths were
 * fixed on card 20261018; this suite pins the READ/LIST/MUTATION consumers of
 * the same rule: the accounting works list ("Thêm khoản chi" entry point), the
 * phơi phiếu board rows, the chi-hộ dialog, the row void guard, the voucher
 * trip validation, and the accounting-lock trip guard (which used to FAIL OPEN
 * for these trips). A genuinely lotless trip keeps every designed exclusion.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { client, db } from '../db';
import { disconnectRedis } from '../lib/redis';
import * as s from '../db/schema';
import { Role, expenseListQuerySchema } from '@tingting/shared';
import { listExpenseAccountingWork } from '../services/expense-accounting-work.service';
import { listPhoiPhieuRows, getPhoiPhieuChiHo, getPhoiPhieuReport, voidPhoiPhieuRow, createPhoiPhieuVoucher } from '../services/phoi-phieu-control.service';
import { assertTripShipmentAccountingUnlocked } from '../services/shipment-accounting-lock.service';
import { SHIPMENT_ACCOUNTING_LOCKED_MESSAGE } from '../services/shipment-accounting-lock-shared.service';

/** House real-rows cleanup (phoi-phieu-control.test.ts): every fixture row is
 *  tracked by its id-keyed table and deleted after the run. Per-row tolerance:
 *  one blocked delete (engine-created children holding an FK) must not abandon
 *  the rest — residue is what made earlier suites flake across runs. */
type IdTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: IdTable; id: number }> = [];
function track(table: IdTable, id: number) { cleanup.unshift({ table, id }); }
/** House tag shape: time + entropy — `Date.now()` alone repeats across runs. */
function uniqueTag(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

let accountantId = 0;

interface Ctx {
  user: { id: number }; customer: { id: number }; shipment: { id: number };
  trip: { id: number; tripCode: string | null }; fulfillmentId: number;
}

/** The chiphispec fixture: a wave-model trip whose lot link is fulfillment-only. */
async function mkWaveTrip(tag: string): Promise<Ctx> {
  const [user] = await db.insert(s.users).values({
    username: `lcl-${tag}-kt`, passwordHash: 't', role: Role.ACCOUNTANT, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, user.id);
  if (accountantId === 0) accountantId = user.id;
  const [customer] = await db.insert(s.customers).values({ name: `LCL customer ${tag}` }).returning({ id: s.customers.id });
  track(s.customers, customer.id);
  const [route] = await db.insert(s.routes).values({ name: `LCL route ${tag}` }).returning({ id: s.routes.id });
  track(s.routes, route.id);
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'DISPATCHED',
    shipmentCode: `LCL-BILL-${tag}`, blNumber: `LCL-BL-${tag}`, expectedDeliveryDate: '2026-10-18',
    customerNotes: `Ghi chú CUS ${tag}`,
  }).returning({ id: s.shipments.id });
  track(s.shipments, shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id, containerNumber: `LCLC${tag.slice(0, 5)}`,
  }).returning({ id: s.shipmentContainers.id });
  track(s.shipmentContainers, container.id);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning({ id: s.shipmentFulfillments.id });
  track(s.shipmentFulfillments, fulfillment.id);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, customerId: customer.id, routeId: route.id,
    tripCode: `TRP-LCL-${tag}`, departureDate: '2026-10-18', status: 'IN_TRANSIT',
  }).returning({ id: s.trips.id, tripCode: s.trips.tripCode });
  track(s.trips, trip.id);
  return { user, customer, shipment, trip, fulfillmentId: fulfillment.id };
}

/** An OPS cost row against the wave trip's lot (the phơi-phiếu row's source). */
async function mkOpsSource(ctx: Ctx, tag: string, opts: { confirmed: boolean; charge: string }) {
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: ctx.shipment.id, expenseTypeCode: 'OTHER',
    feeName: `Phí lô lẻ ${tag}`,
    amount: '250000', customerChargeAmount: opts.charge,
    costGroup: 'OPS_INCIDENTAL', payerKind: 'USER', paidById: ctx.user.id, paidAt: '2026-10-18',
  }).returning({ id: s.opsExpenseEntries.id });
  track(s.opsExpenseEntries, entry.id);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: ctx.shipment.id, tripId: ctx.trip.id,
    version: 1, ...(opts.confirmed ? { confirmedAt: new Date() } : {}),
  }).returning({ id: s.expenseAccountingSources.id });
  track(s.expenseAccountingSources, source.id);
  return { entry, source };
}

const actor = () => ({ userId: accountantId, role: Role.ACCOUNTANT, username: 'k', email: 'k@x', fullName: 'k' } as never);

after(async () => {
  for (const { table, id } of cleanup) {
    try { await db.delete(table).where(eq(table.id, id)); } catch { /* tolerance: engine-created children may hold the row */ }
  }
  await disconnectRedis();
  await client.end({ timeout: 5 });
});

describe('card 191026100030 — lotless-link (hàng lẻ) trip reads resolve through the fulfillment', () => {
  test('the accounting works list carries the wave trip — its "Thêm khoản chi" row is reachable', async () => {
    const tag = uniqueTag('wl');
    const ctx = await mkWaveTrip(tag);
    // Deterministic reads only: the UNFILTERED work list hydrates every
    // expense source in the shared dev DB (`loadExpenseAccountingEntries`),
    // and node:test runs files in parallel — a sibling suite mid-teardown
    // leaves transient stale sources that trip hydrateExpenseAccountingSource's
    // 409. The lot-scoped probes below go through the same join but hydrate
    // only this fixture's rows.
    const scoped = await listExpenseAccountingWork(actor() as never, expenseListQuerySchema.parse({ shipmentId: String(ctx.shipment.id) }));
    const row = scoped.items.find(item => item.tripId === ctx.trip.id);
    assert.ok(row, 'the wave-model trip is listed on /accounting/expenses');
    assert.equal(row!.shipmentId, ctx.shipment.id, 'the row resolves its lot through the fulfillment');
    // The work row's display key is the house bill/booking preference
    // (`bookingRef ?? blNumber`); this fixture carries only the Bill.
    assert.equal(row!.shipmentCode, `LCL-BL-${tag}`);
    const other = await listExpenseAccountingWork(actor() as never, expenseListQuerySchema.parse({ shipmentId: String(ctx.shipment.id + 1_000_000) }));
    assert.ok(!other.items.some(item => item.tripId === ctx.trip.id), 'another lot does not leak the trip');
  });

  test('the phơi phiếu board shows the wave trip row under its lot', async () => {
    const tag = uniqueTag('bd');
    const ctx = await mkWaveTrip(tag);
    const rows = await listPhoiPhieuRows({ search: `TRP-LCL-${tag}` });
    assert.equal(rows.length, 1, 'the hàng-lẻ trip is no longer hidden from the board');
    assert.equal(rows[0]!.tripId, ctx.trip.id);
    assert.equal(rows[0]!.shipmentId, ctx.shipment.id);
  });

  test('the chi-hộ dialog resolves the wave trip; a genuinely lotless trip keeps its 404', async () => {
    const tag = uniqueTag('ch');
    const ctx = await mkWaveTrip(tag);
    const detail = await getPhoiPhieuChiHo(ctx.trip.id);
    assert.equal(detail.tripId, ctx.trip.id);
    assert.equal(detail.shipmentId, ctx.shipment.id, 'the dialog no longer answers "Không tìm thấy chuyến."');

    const [customerlessTrip] = await db.insert(s.trips).values({
      customerId: ctx.customer.id, routeId: (await db.select({ id: s.routes.id }).from(s.routes).where(eq(s.routes.name, `LCL route ${tag}`)))[0]!.id,
      tripCode: `TRP-LCL-NORPHAN-${tag}`, departureDate: '2026-10-18', status: 'IN_TRANSIT',
    }).returning({ id: s.trips.id });
    track(s.trips, customerlessTrip.id);
    await assert.rejects(() => getPhoiPhieuChiHo(customerlessTrip.id), /Không tìm thấy chuyến\./);
  });

  test('voiding a fee row accepts the wave trip it belongs to', async () => {
    const tag = uniqueTag('vd');
    const ctx = await mkWaveTrip(tag);
    const { source } = await mkOpsSource(ctx, tag, { confirmed: false, charge: '100000' });
    const result = await voidPhoiPhieuRow(ctx.trip.id, source.id, actor() as never, 'Từ chối — lô hàng lẻ');
    assert.deepEqual(result, { ok: true });
    const [after] = await db.select({ status: s.expenseAccountingSources.status }).from(s.expenseAccountingSources)
      .where(eq(s.expenseAccountingSources.id, source.id));
    assert.equal(after!.status, 'VOIDED');
  });

  test('the accounting lock is enforced on wave trips (the fail-open is gone) and still skips lotless ones', async () => {
    const tag = uniqueTag('lk');
    const ctx = await mkWaveTrip(tag);
    // Real billing document — the accounting-lock FK to billing_documents is
    // live, sentinel ids violate it (house precedent: cus-shipment-workspace).
    const [lockDoc] = await db.insert(s.billingDocuments).values({
      type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: ctx.customer.id,
      entityName: `LCL lock doc ${tag}`, rangeFrom: '2026-09-01', rangeTo: '2026-09-30', totalInclVat: '0',
    }).returning();
    track(s.billingDocuments, lockDoc.id);
    const [lock] = await db.insert(s.shipmentAccountingLocks).values({
      shipmentId: ctx.shipment.id, billingDocumentId: lockDoc.id, billingDocumentVersion: 1,
      billingPeriodSnapshot: { rangeFrom: '2026-09-01', rangeTo: '2026-09-30', issuedAt: '2026-10-01T00:00:00.000Z' },
      shipmentVersionAtLock: 1, reason: 'Khóa lô hàng lẻ', activatedBy: ctx.user.id,
    }).returning({ id: s.shipmentAccountingLocks.id });
    track(s.shipmentAccountingLocks, lock.id);

    await assert.rejects(
      () => assertTripShipmentAccountingUnlocked(db, ctx.trip.id),
      (error: Error) => error.message === SHIPMENT_ACCOUNTING_LOCKED_MESSAGE,
      'the fulfillment-linked trip hits the lot lock instead of sailing past it',
    );

    const [lotless] = await db.insert(s.trips).values({
      customerId: ctx.customer.id,
      routeId: (await db.select({ id: s.routes.id }).from(s.routes).where(eq(s.routes.name, `LCL route ${tag}`)))[0]!.id,
      tripCode: `TRP-LCL-NOLOT-${tag}`, departureDate: '2026-10-18', status: 'IN_TRANSIT',
    }).returning({ id: s.trips.id });
    track(s.trips, lotless.id);
    await assert.doesNotReject(() => assertTripShipmentAccountingUnlocked(db, lotless.id),
      'a genuinely lotless trip has no lot to lock — unchanged designed behavior');
  });

  test('the THU report attribution carries the wave trip\'s customer note (ghiChu)', async () => {
    const tag = uniqueTag('rp');
    const ctx = await mkWaveTrip(tag);
    await mkOpsSource(ctx, tag, { confirmed: true, charge: '100000' });
    const report = await getPhoiPhieuReport({ kind: 'THU' });
    const row = report.rows.find(item => item.party === `LCL customer ${tag}`);
    assert.ok(row, 'the wave trip groups under its customer party');
    assert.equal(row!.ghiChu, `Ghi chú CUS ${tag}`,
      'customerNotes resolves through the fulfillment lot, not just trips.shipment_id');
  });

  test('the consolidated phiếu flow accepts wave trips past its trip validation', async () => {
    const tag = uniqueTag('vc');
    const ctx = await mkWaveTrip(tag);
    await mkOpsSource(ctx, tag, { confirmed: true, charge: '100000' });
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `LCL-STK-${tag}`, name: `STK lô lẻ ${tag}`, type: 'CASH', fundCode: 'COMPANY', status: 'ACTIVE',
      createdBy: accountantId, updatedBy: accountantId,
    }).returning({ id: s.treasuryAccounts.id });
    track(s.treasuryAccounts, account.id);

    // OUT without a hoàn-ung reconciliation is refused AFTER trip validation
    // (existing gate) — so the wave trip answers that refusal, never the old
    // "Có chuyến không còn hợp lệ." 404. Zero money moves.
    await assert.rejects(
      () => createPhoiPhieuVoucher({ tripIds: [ctx.trip.id], direction: 'OUT', treasuryAccountId: account.id, actor: actor() as never }),
      /hoàn ứng/,
      'the wave trip passes trip validation and reaches the existing OUT gate',
    );
    await assert.rejects(
      () => createPhoiPhieuVoucher({ tripIds: [ctx.trip.id + 1_000_000], direction: 'OUT', treasuryAccountId: account.id, actor: actor() as never }),
      /hợp lệ/,
      'an unknown trip still answers the designed 404',
    );
  });
});
