import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { count, eq } from 'drizzle-orm';

import { Role, TripStatus } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { globalErrorHandler } from '../middleware/errorHandler';
import opsRoutes from '../routes/ops';
import { insertTripComposite } from '../services/trip-composite.service';
import { upsertExpenseAccountingSource } from '../services/expense-accounting-source.service';
import { listOpsExpenses } from '../services/ops-expenses.service';
import { loadOpsExpenseStatusCounts } from '../services/ops-expense-status-census.service';

/**
 * Card 20261008_2 — the "Lịch sử chi phí" (/ops/wallet) status tabs must show
 * FULL-set counts over BOTH sources the list merges: native `opsExpenseEntries`
 * rows and legacy trip-sourced rows (via `expenseAccountingSources` /
 * `listLegacyOpsExpenseHistory`). The list is paginated/capped, so a page count
 * sizes nothing — each tab's numeral has to be a cross-source census that
 * equals exactly what clicking that tab reveals.
 *
 * Pins:
 *   1. per-tab count === the merged full-set list length (API + service, both
 *      sources), incl. the legacy loader's asymmetry (it only serves the
 *      unfiltered / RECORDED / APPROVED views and its rows display RECORDED);
 *   2. counts are full-set — a limit=1 page never shrinks them;
 *   3. empty buckets are present as explicit 0;
 *   4. the settlement-scoped read mirrors the list's legacy gate.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** Child rows are pushed last and deleted first — FK-safe teardown. */
const cleanup: Array<() => unknown> = [];
function trackDelete(task: () => unknown): void {
  cleanup.unshift(task);
}

let opsUserId = 0;
let legacyOnlyOpsId = 0;
let shipmentId = 0;
let fixtureCustomerId = 0;
let tripId = 0;
let server: http.Server;
let baseUrl = '';

/** A wallet-native expense row in a chosen approval status (the enum domain
 *  is what the census counts; the write path's own statuses are not under
 *  test here). */
async function insertNativeExpense(approvalStatus: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<void> {
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId,
    expenseTypeCode: 'OTHER',
    amount: '10000',
    paidById: opsUserId,
    paidAt: '2026-10-07',
    approvalStatus,
    note: `census native ${approvalStatus}`,
  }).returning();
  trackDelete(() => db.delete(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.id, entry.id)));
}

/** A "khai chi hộ" trip row behind expenseAccountingSources — the legacy
 *  source of the wallet history (mirrors the seeded shape of
 *  ops-expense-display-names.test.ts). */
async function insertLegacyExpense(userId: number, withSource: boolean): Promise<void> {
  const [entry] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId: userId,
    expenseType: 'OTHER',
    buyAmount: '20000',
    sellAmount: '0',
    expenseDate: '2026-10-07',
    settlementMethod: 'OPS_ADVANCE',
    approvalStatus: 'RECORDED',
    note: 'Vé cầu đường',
  }).returning();
  trackDelete(() => db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, entry.id)));
  if (withSource) {
    const source = await upsertExpenseAccountingSource(db, {
      sourceKind: 'TRIP', sourceId: entry.id,
      shipmentId, tripId, customerId: fixtureCustomerId,
      expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR',
      feeName: '', amount: 20000, customerChargeAmount: 0,
      expenseDate: '2026-10-07', payerKind: 'USER', payerUserId: userId,
      recordedById: userId, note: entry.note, linkedTripExpenseId: entry.id,
    });
    trackDelete(() => db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)));
  }
}

async function api(path: string, token: string) {
  const response = await fetch(`${baseUrl}/api/ops${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as { items: Array<{ id: number }>; statusCounts: Record<string, number> };
  return { status: response.status, body };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ops', authMiddleware, opsRoutes);
  app.use(globalErrorHandler);
  await new Promise<void>((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });

  const [ops] = await db.insert(s.users).values({
    username: `census-ops-${suffix}`.slice(0, 50),
    passwordHash: 'x',
    fullName: `Ops census ${suffix}`,
    role: Role.OPS,
    status: 'ACTIVE',
  }).returning();
  trackDelete(() => db.delete(s.users).where(eq(s.users.id, ops.id)));
  opsUserId = ops.id;
  const [legacyOnly] = await db.insert(s.users).values({
    username: `census-ops2-${suffix}`.slice(0, 50),
    passwordHash: 'x',
    fullName: `Ops census legacy-only ${suffix}`,
    role: Role.OPS,
    status: 'ACTIVE',
  }).returning();
  trackDelete(() => db.delete(s.users).where(eq(s.users.id, legacyOnly.id)));
  legacyOnlyOpsId = legacyOnly.id;

  const [customer] = await db.insert(s.customers)
    .values({ name: `Census customer ${suffix}` }).returning();
  trackDelete(() => db.delete(s.customers).where(eq(s.customers.id, customer.id)));
  fixtureCustomerId = customer.id;
  const [route] = await db.insert(s.routes)
    .values({ name: `Census route ${suffix}` }).returning();
  trackDelete(() => db.delete(s.routes).where(eq(s.routes.id, route.id)));
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Census cargo ${suffix}` }).returning();
  trackDelete(() => db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)));

  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `CEN-SHP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT',
    cargoMode: 'LCL',
  }).returning();
  trackDelete(() => db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)));
  shipmentId = shipment.id;

  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: shipment.id,
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    dispatchClassification: 'LCL',
    sourceShipmentVersion: shipment.version,
    siteSnapshot: {},
  }).returning();
  trackDelete(() => db.delete(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, fulfillment.id)));

  const trip = await insertTripComposite(db, {
    tripCode: `CEN-TRIP-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    shipmentId: shipment.id,
    fulfillmentId: fulfillment.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-10-07',
    revenue: '0',
    carrierType: 'OWN',
  });
  trackDelete(() => db.delete(s.trips).where(eq(s.trips.id, trip.id)));
  tripId = trip.id;

  // 7 native rows across the enum domain + 3 legacy chi-hô rows (both legacy
  // read paths: canonical source row and pure trip fallback).
  for (const status of ['RECORDED', 'RECORDED', 'DRAFT', 'VOIDED', 'PENDING', 'APPROVED', 'REJECTED'] as const) {
    await insertNativeExpense(status);
  }
  await insertLegacyExpense(opsUserId, true);
  await insertLegacyExpense(opsUserId, true);
  await insertLegacyExpense(opsUserId, false);
  // A second account with ONLY legacy rows — pins the asymmetry (the legacy
  // source never enters the DRAFT/VOIDED/PENDING/REJECTED buckets).
  await insertLegacyExpense(legacyOnlyOpsId, false);
  await insertLegacyExpense(legacyOnlyOpsId, false);
});

after(async () => {
  try {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    for (const task of cleanup) await task();
  }
});

describe('ops wallet status census (card 20261008_2)', () => {
  test('every tab count equals the merged full set of BOTH sources (AC1)', async () => {
    const counts = await loadOpsExpenseStatusCounts({ paidById: opsUserId });
    assert.deepEqual(counts, {
      all: 10, DRAFT: 1, RECORDED: 5, VOIDED: 1, PENDING: 1, APPROVED: 4, REJECTED: 1,
    });

    // The tab lens at a time: what clicking that tab reveals as a full set.
    for (const status of [undefined, 'DRAFT', 'RECORDED', 'VOIDED', 'PENDING', 'APPROVED', 'REJECTED'] as const) {
      const listed = await listOpsExpenses({ paidById: opsUserId, status, limit: 500 });
      assert.equal(listed.length, counts[status ?? 'all'],
        `tab ${status ?? 'Tất cả'}: count must equal the list it opens`);
    }

    // DB ground truth per source: native rows counted straight from the table,
    // legacy rows counted off the merged list's TRIP-sourced slice.
    const [native] = await db.select({ rows: count() }).from(s.opsExpenseEntries)
      .where(eq(s.opsExpenseEntries.paidById, opsUserId));
    const merged = await listOpsExpenses({ paidById: opsUserId, limit: 500 });
    const legacy = merged.filter((row) => row.sourceKind === 'TRIP').length;
    assert.equal(legacy, 3);
    assert.equal(counts.all, Number(native.rows) + legacy);
  });

  test('the legacy asymmetry stays honest per tab (watch item)', async () => {
    // Legacy-only account: the rows show under Tất cả / RECORDED / APPROVED
    // (the views listLegacyOpsExpenseHistory serves) and never under DRAFT /
    // VOIDED / PENDING / REJECTED — and the count says exactly that.
    const counts = await loadOpsExpenseStatusCounts({ paidById: legacyOnlyOpsId });
    assert.deepEqual(counts, {
      all: 2, DRAFT: 0, RECORDED: 2, VOIDED: 0, PENDING: 0, APPROVED: 2, REJECTED: 0,
    });
    for (const status of ['DRAFT', 'VOIDED', 'PENDING', 'REJECTED'] as const) {
      const listed = await listOpsExpenses({ paidById: legacyOnlyOpsId, status, limit: 500 });
      assert.equal(listed.length, 0, `legacy rows must not enter the ${status} tab`);
      assert.equal(counts[status], 0);
    }
  });

  test('counts are full-set, never page-derived (AC2)', async () => {
    const page = await listOpsExpenses({ paidById: opsUserId, limit: 1 });
    assert.equal(page.length, 1, 'the list stays capped at the requested limit');
    const counts = await loadOpsExpenseStatusCounts({ paidById: opsUserId });
    assert.equal(counts.all, 10, 'a one-row page never shrinks the census');
  });

  test('empty buckets are present as explicit 0 (AC3)', async () => {
    const counts = await loadOpsExpenseStatusCounts({ paidById: legacyOnlyOpsId });
    for (const key of ['all', 'DRAFT', 'RECORDED', 'VOIDED', 'PENDING', 'APPROVED', 'REJECTED'] as const) {
      assert.ok(Object.hasOwn(counts, key), `bucket ${key} must be present`);
      assert.equal(typeof counts[key], 'number');
    }
    const untouched = await loadOpsExpenseStatusCounts({ paidById: 2_000_000_000 });
    assert.deepEqual(untouched, {
      all: 0, DRAFT: 0, RECORDED: 0, VOIDED: 0, PENDING: 0, APPROVED: 0, REJECTED: 0,
    });
  });

  test('a settlement-scoped read mirrors the list gate: no legacy source', async () => {
    const counts = await loadOpsExpenseStatusCounts({ paidById: opsUserId, settlementId: 2_000_000_000 });
    const listed = await listOpsExpenses({ paidById: opsUserId, settlementId: 2_000_000_000, limit: 500 });
    assert.equal(listed.length, 0);
    assert.deepEqual(counts, {
      all: 0, DRAFT: 0, RECORDED: 0, VOIDED: 0, PENDING: 0, APPROVED: 0, REJECTED: 0,
    });
  });

  test('the /ops/wallet/expenses envelope sizes each tab over the full set (AC1, against API)', async () => {
    const token = jwt.sign({ userId: opsUserId, username: `census-ops-${suffix}`, role: Role.OPS }, config.jwtSecret);
    const all = await api('/wallet/expenses?limit=200', token);
    assert.equal(all.status, 200);
    const expected = {
      all: 10, DRAFT: 1, RECORDED: 5, VOIDED: 1, PENDING: 1, APPROVED: 4, REJECTED: 1,
    };
    assert.deepEqual(all.body.statusCounts, expected);
    assert.equal(all.body.items.length, 10);

    // The envelope is never status-filtered and never page-derived: every tab
    // request returns the same census, and the rows a tab opens equal its
    // bucket.
    for (const status of ['DRAFT', 'RECORDED', 'VOIDED'] as const) {
      const tab = await api(`/wallet/expenses?status=${status}&limit=1`, token);
      assert.equal(tab.status, 200);
      assert.deepEqual(tab.body.statusCounts, expected, 'the census ignores the status lens');
      assert.equal(tab.body.items.length, Math.min(1, expected[status]), 'the page stays capped');
      const full = await api(`/wallet/expenses?status=${status}&limit=200`, token);
      assert.equal(full.body.items.length, expected[status], `tab ${status} opens exactly its count`);
    }

    // Page-walk (AC2): the loaded pages sum to the census, nothing more.
    const walked: number[] = [];
    for (let offset = 0; ; offset += 2) {
      const page = await api(`/wallet/expenses?limit=2&offset=${offset}`, token);
      walked.push(...page.body.items.map((row) => row.id));
      if (page.body.items.length < 2) break;
    }
    assert.equal(walked.length, all.body.statusCounts.all);
    assert.equal(new Set(walked).size, walked.length, 'pages never duplicate rows');
  });
});
