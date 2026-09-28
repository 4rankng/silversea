/**
 * Card 20260928_181 — signed expense rows and the PM's "as if absent" rule.
 *
 * A row may now carry a NEGATIVE `trip_expenses.buy_amount`. The rule: a
 * negative row must make every TOTAL behave exactly as if that row did not
 * exist — dropped from the sum, never netted against the positive rows, so
 * `sum([100, -50])` is 100.
 *
 * Every case below states the PM's own measurement: read the total, INSERT a
 * negative row, read the total again, and assert the two are STRICTLY EQUAL.
 * No total is ever compared against a money literal, so a later change to the
 * fixture amounts cannot turn an assertion green for the wrong reason.
 *
 * The file covers the T slice — one case per already-fixed aggregate site —
 * plus the intake contract that lets a negative row exist at all.
 *
 *   1  advance-settlement.service.ts        create total :85, update :615, assertSettlementBalanced :398
 *   2  no-invoice-disbursement.service.ts   totals.sumBuyAmount :232 (per-row threshold bucket UNCHANGED)
 *   3  shipment-debit-detail.service.ts     chiHoTotal :422, thuKhachTotal :423, unattached feeTotal :413
 *   4  shipment-debit-summary.service.ts    Tổng chi hộ :117, shadow total :261, recharge :188
 *   5  fuel-ap-recon.service.ts             legacy invoiced fuel sum :179
 *   6  settlement-export.service.ts         HTML Tổng chi phí :176, XLSX :262
 *   7  ops-wallet.service.ts                wallet expense side :60-62, fund-book entries :217
 *   8  expense-accounting-reconciliation.service.ts  batch amount :52, advance allocation :97
 *   9  expense-accounting-reads.service.ts  list totals.amount :81, OUT report buckets :340
 *  10  expense-accounting-work.service.ts   payable roll-ups :76, :102
 *
 * Fixture discipline: no row escapes. Sites 1, 8 and 10 run inside
 * `isolated(tx)`, a transaction that always ROLLS BACK. Sites 2, 3, 4, 5 and 7
 * need data a service reads outside the transaction (site 7's `getOpsFundBook`
 * takes no executor at all), so they commit rows and `after()` deletes them
 * children-first in reverse insertion order.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { Writable } from 'node:stream';

import ExcelJS from 'exceljs';
import { and, eq } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  Role,
  TxnType,
  tripExpensePatchSchema,
  tripExpenseSchema,
  type ExpenseAccountingEntry,
} from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { insertTripComposite } from '../services/trip-composite.service';
import type { Tx } from '../services/trip-shared';
import { createAdvanceSettlement, getAdvanceSettlement } from '../services/advance-settlement.service';
import {
  createExpenseReconciliation,
  recordFundedOpsAdvance,
} from '../services/expense-accounting-reconciliation.service';
import { upsertExpenseAccountingSource } from '../services/expense-accounting-source.service';
import { expenseAccountingReportRows, expenseEntryPage } from '../services/expense-accounting-reads.service';
import { listExpenseAccountingWork } from '../services/expense-accounting-work.service';
import { getNoInvoiceDisbursementReport, PER_ITEM_THRESHOLD } from '../services/no-invoice-disbursement.service';
import { getShipmentDebitDetail } from '../services/shipment-debit-detail.service';
import { getShipmentDebitSummary } from '../services/shipment-debit-summary.service';
import { getFuelApReconciliation } from '../services/fuel-ap-recon.service';
import { getOpsFundBook, getOpsWalletSummary } from '../services/ops-wallet.service';
import {
  renderSettlementHtml,
  renderSettlementXlsx,
  type LinkedExpense,
  type SettlementExportData,
} from '../services/settlement-export.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ── Committed-fixture bookkeeping (sites 2, 3, 4, 5, 7) ─────────────────────
interface CleanupEntry {
  /** Children that must go before the row itself (RESTRICT FKs, sidecars). */
  before?: () => Promise<void>;
  remove: () => Promise<void>;
}
const cleanup: CleanupEntry[] = [];

/** Register a committed row for deletion, children-first, in reverse order. */
async function track<TRow extends { id: number }>(
  table: PgTable,
  idColumn: Column,
  row: TRow,
  before?: () => Promise<void>,
): Promise<TRow> {
  cleanup.unshift({
    before,
    remove: async () => { await db.delete(table).where(eq(idColumn, row.id)); },
  });
  return row;
}

async function deleteShipmentChildren(shipmentId: number): Promise<void> {
  await db.delete(s.shipmentCostLocks).where(eq(s.shipmentCostLocks.shipmentId, shipmentId));
  await db.delete(s.debitNoteLots).where(eq(s.debitNoteLots.shipmentId, shipmentId));
  await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.shipmentId, shipmentId));
}

async function deleteTripSidecars(tripId: number): Promise<void> {
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId));
  await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, tripId));
}

after(async () => {
  try {
    // Pass one: the pre-delete hooks. A lot delete is refused while a cost
    // lock or debit-note claim still points at it, and a trip row carries
    // sidecars that live outside the composite view.
    for (const entry of cleanup) {
      if (entry.before) await entry.before();
    }
    // Pass two: the rows themselves, children-first.
    for (const entry of cleanup) {
      await entry.remove();
    }
  } catch (error) {
    console.warn('[card181] cleanup:', (error as Error).message);
  }
  await disconnectRedis();
  await client.end();
});

// ── Committed-fixture builders (shape copied from shipment-debit-summary.test.ts) ──
async function mkCustomer(name: string) {
  const [row] = await db.insert(s.customers).values({ name }).returning();
  return track(s.customers, s.customers.id, row);
}
async function mkRoute(name: string) {
  const [row] = await db.insert(s.routes).values({ name }).returning();
  return track(s.routes, s.routes.id, row);
}
async function mkCargo(name: string) {
  const [row] = await db.insert(s.cargoTypes).values({ name }).returning();
  return track(s.cargoTypes, s.cargoTypes.id, row);
}
async function mkLot(customerId: number, edd: string | null, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(s.shipments).values({
    customerId, expectedDeliveryDate: edd, cargoMode: 'FCL', status: 'PENDING_DATE', ...extra,
  }).returning();
  return track(s.shipments, s.shipments.id, row, () => deleteShipmentChildren(row.id));
}
async function mkFulfillment(shipmentId: number, version: number, opts?: { type?: 'LCL_SHIPMENT' | 'FCL_CONTAINER' }) {
  const [row] = await db.insert(s.shipmentFulfillments).values({
    shipmentId,
    fulfillmentType: opts?.type ?? 'LCL_SHIPMENT',
    cargoMode: opts?.type ? 'FCL' : 'LCL',
    dispatchClassification: opts?.type ? 'SINGLE' : 'LCL',
    sourceShipmentVersion: version,
    siteSnapshot: {},
  }).returning();
  return track(s.shipmentFulfillments, s.shipmentFulfillments.id, row);
}
/**
 * Production trips carry a fulfillment link (Lớp 1's chi-hộ join needs it). A
 * lot allows ONE active LCL fulfillment and ONE live trip per fulfillment, so
 * later trips ride an FCL-type fulfillment. `null` inserts the
 * fulfillment-NULL trip — the shadow-total fixture.
 */
async function mkTrip(shipmentId: number, customerId: number, routeId: number, fulfillmentId?: number | null) {
  let resolved = fulfillmentId;
  if (resolved === undefined) {
    const existing = await db.select({ id: s.shipmentFulfillments.id })
      .from(s.shipmentFulfillments)
      .where(eq(s.shipmentFulfillments.shipmentId, shipmentId));
    resolved = (await mkFulfillment(shipmentId, 1, existing.length > 0 ? { type: 'FCL_CONTAINER' } : undefined)).id;
  }
  const [row] = await db.insert(s.trips).values({
    shipmentId, customerId, routeId, status: 'CREATED', departureDate: '2026-09-20', fulfillmentId: resolved,
  }).returning();
  return track(s.trips, s.trips.id, row, () => deleteTripSidecars(row.id));
}
async function mkComposedTrip(customerId: number, routeId: number, cargoId: number, shipmentId: number, tag: string) {
  const trip = await insertTripComposite(db, {
    tripCode: `C181-${tag}-${suffix}`.slice(0, 50), customerId, routeId, cargoTypeId: cargoId,
    shipmentId, departureDate: '2026-09-20', status: 'IN_TRANSIT', carrierType: 'OWN',
  });
  return track(s.trips, s.trips.id, trip, () => deleteTripSidecars(trip.id));
}
async function mkExpense(tripId: number, buy: string, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId, expenseType: 'PHI_CHI_HO', buyAmount: buy, sellAmount: '0', ...extra,
  }).returning();
  return track(s.tripExpenses, s.tripExpenses.id, row);
}

// ── Rolled-back fixture (sites 1, 8, 10) ────────────────────────────────────
/** Open a transaction and ALWAYS roll it back — no row escapes. */
async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error('rollback card181 fixture');
  try {
    await db.transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

/**
 * Minimum money fixture: an accountant actor, an ACTIVE Ops payer, a
 * shipment-linked trip with its completion scope and the Ops assignment, and a
 * funded cash account to move advances through. Only ids leave this fixture.
 */
interface MoneyFixture {
  actor: { userId: number; role: Role };
  accountant: { id: number };
  opsUser: { id: number };
  customer: { id: number };
  route: { id: number };
  cargo: { id: number };
  shipment: { id: number };
  trip: { id: number };
  account: { id: number };
}

async function moneyFixture(tx: Tx): Promise<MoneyFixture> {
  const key = `${suffix}-${Math.random().toString(36).slice(2, 8)}`;
  const [accountant] = await tx.insert(s.users)
    .values({ username: `c181-kt-${key}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
  const [opsUser] = await tx.insert(s.users)
    .values({ username: `c181-ops-${key}`, passwordHash: 'x', role: Role.OPS, status: 'ACTIVE' }).returning();
  const [customer] = await tx.insert(s.customers).values({ name: `C181 ${key}` }).returning();
  const [route] = await tx.insert(s.routes).values({ name: `C181 route ${key}` }).returning();
  const [cargo] = await tx.insert(s.cargoTypes).values({ name: `C181 cargo ${key}` }).returning();
  const [shipment] = await tx.insert(s.shipments).values({
    shipmentCode: `C181-${key}`.slice(0, 50), customerId: customer.id, status: 'DISPATCHED',
    createdBy: accountant.id, updatedBy: accountant.id,
  }).returning();
  const trip = await insertTripComposite(tx, {
    tripCode: `C181-${key}`.slice(0, 50), customerId: customer.id, routeId: route.id, cargoTypeId: cargo.id,
    shipmentId: shipment.id, departureDate: '2026-09-20', status: 'IN_TRANSIT', carrierType: 'OWN',
  });
  await tx.insert(s.userShipmentLinks).values({ userId: opsUser.id, shipmentId: shipment.id });
  await tx.insert(s.tripExpenseCompletionScopes).values({
    tripId: trip.id, tripContainerId: null, status: 'COMPLETED', completedBy: accountant.id, completedAt: new Date(),
  });
  const [account] = await tx.insert(s.treasuryAccounts).values({
    code: `C181-${key}`.slice(0, 20), name: `C181 cash ${key}`, type: 'CASH', fundCode: 'COMPANY',
    status: 'ACTIVE', createdBy: accountant.id, updatedBy: accountant.id,
  }).returning();
  return {
    actor: { userId: accountant.id, role: Role.ACCOUNTANT },
    accountant, opsUser, customer, route, cargo, shipment, trip, account,
  };
}

async function fundedAdvance(tx: Tx, fixture: MoneyFixture, amount: number, tag: string) {
  return recordFundedOpsAdvance(tx, fixture.actor, {
    opsUserId: fixture.opsUser.id, amount, reason: `C181 ${tag}`,
    treasuryAccountId: fixture.account.id, valueDate: '2026-09-10',
    physicalReference: `C181-${tag}-${suffix}`.slice(0, 160),
  });
}

/** A settlement-eligible chi-hộ row, exactly the shape the lifecycle tests use. */
async function tripExpense(tx: Tx, fixture: MoneyFixture, buyAmount: number, tag: string) {
  const [row] = await tx.insert(s.tripExpenses).values({
    tripId: fixture.trip.id, forwarderId: fixture.opsUser.id, createdBy: fixture.opsUser.id,
    expenseType: 'OTHER', buyAmount: String(buyAmount), sellAmount: '0',
    invoiceNumber: `C181-${tag}-${suffix}`.slice(0, 50), approvalStatus: 'RECORDED',
    settlementMethod: 'OPS_ADVANCE', expenseDate: '2026-09-20',
  }).returning();
  return row;
}

// ════════════════════════════════════════════════════════════════════════════
describe('card 20260928_181 — a negative expense row behaves as if absent', () => {

  // ── Site 1 ────────────────────────────────────────────────────────────────
  test('advance-settlement :85/:398/:615 — a negative buy row leaves the stored totalExpenseAmount identical', () => isolated(async (tx) => {
    const fixture = await moneyFixture(tx);
    const readTotal = async (settlementId: number) => {
      const [stored] = await tx.select({ total: s.advanceSettlements.totalExpenseAmount })
        .from(s.advanceSettlements).where(eq(s.advanceSettlements.id, settlementId));
      return stored.total;
    };

    // Baseline: ONE positive expense on its own settlement.
    const positiveOnly = await tripExpense(tx, fixture, 1_000, 'single');
    const advanceSingle = await fundedAdvance(tx, fixture, 1_000, 'single');
    const single = await createAdvanceSettlement(fixture.opsUser.id, {
      advanceRequestIds: [advanceSingle.id], tripExpenseIds: [positiveOnly.id], refundAmount: 0,
    }, tx);
    const totalWithOnePositive = await readTotal(single.id);
    assert.ok(Number(totalWithOnePositive) > 0, 'fixture sanity: the single positive row is the whole total');

    // Measure the same money PLUS one negative row. The balance gate
    // (assertSettlementBalanced :398) only passes while the advance still
    // matches the expense total, so creation itself proves the drop: netting
    // would leave a 500 gap and throw 'Phiếu chưa cân đối'.
    const positivePlus = await tripExpense(tx, fixture, 1_000, 'pair');
    const negative = await tripExpense(tx, fixture, -500, 'negative');
    const advancePair = await fundedAdvance(tx, fixture, 1_000, 'pair');
    const pair = await createAdvanceSettlement(fixture.opsUser.id, {
      advanceRequestIds: [advancePair.id], tripExpenseIds: [positivePlus.id, negative.id], refundAmount: 0,
    }, tx);
    assert.equal(await readTotal(pair.id), totalWithOnePositive,
      'adding a negative row must not change the stored phiếu total');

    // The negative row is dropped from the MONEY, never from the phiếu.
    const detail = await getAdvanceSettlement(pair.id, tx);
    assert.ok(detail, 'the settlement reads back');
    assert.equal(detail.linkedExpenses.length, 2, 'both expenses stay linked to the phiếu');
    const linkedNegative = detail.linkedExpenses.find((row) => row.id === negative.id);
    assert.ok(linkedNegative, 'the negative expense is still visible on the phiếu');
    assert.ok(Number(linkedNegative.buyAmount) < 0, 'and it keeps its sign');
    const singleDetail = await getAdvanceSettlement(single.id, tx);
    assert.ok(singleDetail);
    assert.equal(singleDetail.linkedExpenses.length, 1, 'the baseline phiếu is untouched by the second one');

    // Boundary: a phiếu holding ONLY negative rows must store exactly what an
    // EMPTY phiếu stores — two measured totals, never a negative sum.
    const negativeOnly = await tripExpense(tx, fixture, -500, 'negative-only');
    const advanceZero = await fundedAdvance(tx, fixture, 500, 'zero');
    const zero = await createAdvanceSettlement(fixture.opsUser.id, {
      advanceRequestIds: [advanceZero.id], tripExpenseIds: [negativeOnly.id], refundAmount: 500,
    }, tx);
    const advanceEmpty = await fundedAdvance(tx, fixture, 500, 'empty');
    const empty = await createAdvanceSettlement(fixture.opsUser.id, {
      advanceRequestIds: [advanceEmpty.id], tripExpenseIds: [], refundAmount: 500,
    }, tx);
    assert.equal(await readTotal(zero.id), await readTotal(empty.id),
      'an all-negative phiếu totals what an empty phiếu totals — never a negative sum');
  }));

  // ── Site 2 ────────────────────────────────────────────────────────────────
  test('no-invoice disbursement :232 — a negative row leaves sumBuyAmount, overThresholdCount and overThresholdSum identical', async () => {
    const customer = await mkCustomer(`C181 no-invoice ${suffix}`);
    const route = await mkRoute(`C181 no-invoice route ${suffix}`);
    const lot = await mkLot(customer.id, null);
    const trip = await mkTrip(lot.id, customer.id, route.id);
    // A private category code keeps the window free of every other row.
    const [category] = await db.insert(s.forwarderExpenseTypes).values({
      code: `C181-${suffix}`.slice(0, 50), name: `C181 no-invoice ${suffix}`,
      requiresInvoice: false, substituteEvidenceAllowed: true,
      noInvoiceEvidenceTypes: ['RECEIPT'], noInvoicePerItemLimit: String(PER_ITEM_THRESHOLD),
      noInvoicePerDayLimit: String(PER_ITEM_THRESHOLD * 10),
    }).returning();
    await track(s.forwarderExpenseTypes, s.forwarderExpenseTypes.id, category);

    // The report windows on DATE(created_at), so the fixture pins createdAt to
    // a fixed instant and brackets it with a wide window: a session-timezone
    // shift of hours cannot slide the row out of scope, and the private
    // category code keeps every other row out.
    const reportedAt = new Date('2031-07-19T03:00:00.000Z');
    const window = { from: '2031-07-14', to: '2031-07-25', categoryCode: category.code } as const;

    await mkExpense(trip.id, '300000', {
      expenseType: category.code, approvalStatus: 'RECORDED', createdAt: reportedAt,
    });
    // A per-row over-limit row so the untouched threshold bucket is not vacuous.
    await mkExpense(trip.id, String(PER_ITEM_THRESHOLD + 1_000_000), {
      expenseType: category.code, approvalStatus: 'RECORDED', createdAt: reportedAt,
    });

    const before = await getNoInvoiceDisbursementReport(window);
    assert.equal(before.items.length, 2, 'fixture sanity: exactly the two positive rows are in scope');
    assert.ok(before.totals.sumBuyAmount > 0, 'fixture sanity: the sum is real money');
    assert.equal(before.totals.overThresholdCount, 1, 'fixture sanity: one row is over the per-item limit');

    const negative = await mkExpense(trip.id, '-50000', {
      expenseType: category.code, approvalStatus: 'RECORDED', createdAt: reportedAt,
    });
    const after = await getNoInvoiceDisbursementReport(window);

    assert.equal(after.totals.sumBuyAmount, before.totals.sumBuyAmount,
      'a negative no-invoice row must not change the disbursement sum');
    assert.equal(after.totals.overThresholdCount, before.totals.overThresholdCount,
      'the threshold bucket is a PER-ROW test — a negative row can never enter it');
    assert.equal(after.totals.overThresholdSum, before.totals.overThresholdSum,
      'so its sum is untouched too');
    assert.ok(after.items.some((item) => item.expenseId === negative.id),
      'the negative row still appears in the report items');
  });

  // ── Site 3 ────────────────────────────────────────────────────────────────
  test('shipment-debit-detail :413/:422/:423 — a negative row leaves chiHoTotal, thuKhachTotal and feeTotal identical', async () => {
    const customer = await mkCustomer(`C181 debit detail ${suffix}`);
    const route = await mkRoute(`C181 debit detail route ${suffix}`);
    const lot = await mkLot(customer.id, null);
    const linkedTrip = await mkTrip(lot.id, customer.id, route.id);
    const unattachedTrip = await mkTrip(lot.id, customer.id, route.id, null);

    await mkExpense(linkedTrip.id, '300000', { expenseType: 'PHI_CHI_HO' });
    await mkExpense(unattachedTrip.id, '250000', { expenseType: 'PHI_CHI_HO' });

    const before = await getShipmentDebitDetail(lot.id);
    assert.ok(Number(before.payables.chiHoTotal) > 0, 'fixture sanity: chi-hộ money is visible');
    assert.ok(Number(before.thuKhachTotal) > 0, 'fixture sanity: the recharge total is visible');
    const unattachedBefore = before.unattachedTrips.find((section) => section.tripId === unattachedTrip.id);
    assert.ok(unattachedBefore, 'fixture sanity: the fulfillment-NULL trip renders its own section');
    assert.ok(unattachedBefore.feeTotal != null && unattachedBefore.feeTotal > 0, 'fixture sanity: the unattached fee total is not vacuous');

    const negativeLinked = await mkExpense(linkedTrip.id, '-100000', { expenseType: 'PHI_CHI_HO' });
    const negativeUnattached = await mkExpense(unattachedTrip.id, '-90000', { expenseType: 'PHI_CHI_HO' });

    const after = await getShipmentDebitDetail(lot.id);
    assert.equal(after.payables.chiHoTotal, before.payables.chiHoTotal,
      'a negative chi-hộ row must not change payables.chiHoTotal (:422)');
    assert.equal(after.thuKhachTotal, before.thuKhachTotal,
      'nor the recharge total derived from it (:423)');
    const unattachedAfter = after.unattachedTrips.find((section) => section.tripId === unattachedTrip.id);
    assert.ok(unattachedAfter, 'the unattached section survives');
    assert.equal(unattachedAfter.feeTotal, unattachedBefore.feeTotal,
      'nor the unattached section fee total (:413)');

    const linkedItems = after.chiHoRows.flatMap((row) => row.items);
    assert.ok(linkedItems.some((item) => item.id === negativeLinked.id),
      'the negative chi-hộ row still renders in items');
    assert.ok(unattachedAfter.items.some((item) => item.id === negativeUnattached.id),
      'the negative unattached row still renders in items');
  });

  // ── Site 4 ────────────────────────────────────────────────────────────────
  test('debit-summary :117/:188/:261 — a negative row leaves Tổng chi hộ, the shadow total and the pass-through recharge identical', async () => {
    const customer = await mkCustomer(`C181 summary ${suffix}`);
    const route = await mkRoute(`C181 summary route ${suffix}`);
    const linkedLot = await mkLot(customer.id, '2026-09-25');
    const linkedTrip = await mkTrip(linkedLot.id, customer.id, route.id);
    // No freight snapshot and no PS thực tế: TỔNG PHẢI THU KHÁCH is then
    // exactly the pass-through recharge the negative row must not touch.
    await mkExpense(linkedTrip.id, '300000', { expenseType: 'PHI_CHI_HO' });

    const shadowLot = await mkLot(customer.id, '2026-09-25');
    const shadowTrip = await mkTrip(shadowLot.id, customer.id, route.id, null);
    await mkExpense(shadowTrip.id, '123000', { expenseType: 'PHI_CHI_HO' });

    const query = { customerId: customer.id, lockStatus: 'ALL' } as const;
    const before = await getShipmentDebitSummary(query);
    const beforeLinked = before.items.find((row) => row.shipmentId === linkedLot.id);
    const beforeShadow = before.items.find((row) => row.shipmentId === shadowLot.id);
    assert.ok(beforeLinked, 'fixture sanity: the fulfillment-linked lot rolls up');
    assert.ok(beforeShadow, 'fixture sanity: the shadow lot rolls up');
    assert.ok(Number(beforeLinked.receivableTotal) > 0, 'fixture sanity: the recharge is a real receivable');
    assert.ok(Number(before.excludedSum) > 0, 'fixture sanity: the shadow line carries real money');
    assert.equal(before.excludedCount, 1, 'fixture sanity: one shadow trip is excluded');

    await mkExpense(linkedTrip.id, '-100000', { expenseType: 'PHI_CHI_HO' });
    await mkExpense(shadowTrip.id, '-500', { expenseType: 'PHI_CHI_HO' });

    const after = await getShipmentDebitSummary(query);
    const afterLinked = after.items.find((row) => row.shipmentId === linkedLot.id);
    const afterShadow = after.items.find((row) => row.shipmentId === shadowLot.id);
    assert.ok(afterLinked, 'the linked lot still rolls up');
    assert.ok(afterShadow, 'the shadow lot still rolls up');

    assert.equal(afterLinked.chiHoTotal, beforeLinked.chiHoTotal, 'Tổng chi hộ is unchanged (:117)');
    assert.equal(afterLinked.receivableTotal, beforeLinked.receivableTotal,
      'the pass-through recharge (buy >= 0 only) is unchanged (:188)');
    assert.equal(afterShadow.chiHoTotal, beforeShadow.chiHoTotal);
    assert.equal(after.excludedSum, before.excludedSum, 'the shadow total is unchanged (:261)');
    assert.equal(after.excludedCount, before.excludedCount, 'the shadow count counts TRIPS, so it never moves');
  });

  // ── Site 5 ────────────────────────────────────────────────────────────────
  test('fuel-ap-recon :179 — a negative fuel row leaves the supplier invoiced total identical', async () => {
    const customer = await mkCustomer(`C181 fuel ${suffix}`);
    const route = await mkRoute(`C181 fuel route ${suffix}`);
    const cargo = await mkCargo(`C181 fuel cargo ${suffix}`);
    const lot = await mkLot(customer.id, null);
    const [supplier] = await db.insert(s.suppliers).values({ name: `C181 fuel supplier ${suffix}` }).returning();
    await track(s.suppliers, s.suppliers.id, supplier);
    const trip = await mkComposedTrip(customer.id, route.id, cargo.id, lot.id, 'FUEL');

    // A private window keeps every pre-existing fuel row out of the report.
    const fuelDate = '2031-07-19';
    const window = { from: fuelDate, to: fuelDate } as const;
    await mkExpense(trip.id, '300000', {
      expenseType: 'FUEL', supplierId: supplier.id, invoiceDate: fuelDate, invoiceNumber: null,
      approvalStatus: 'RECORDED', expenseDate: fuelDate,
    });

    const before = await getFuelApReconciliation(window);
    const beforeSupplier = before.suppliers.find((row) => row.supplierId === supplier.id);
    assert.ok(beforeSupplier, 'fixture sanity: the supplier appears in the reconciliation');
    assert.ok(beforeSupplier.invoicedFuelCost > 0, 'fixture sanity: the fuel row is the invoiced side');

    await mkExpense(trip.id, '-100000', {
      expenseType: 'FUEL', supplierId: supplier.id, invoiceDate: fuelDate, invoiceNumber: null,
      approvalStatus: 'RECORDED', expenseDate: fuelDate,
    });

    const after = await getFuelApReconciliation(window);
    const afterSupplier = after.suppliers.find((row) => row.supplierId === supplier.id);
    assert.ok(afterSupplier, 'the supplier still has fuel activity in range');
    assert.equal(afterSupplier.invoicedFuelCost, beforeSupplier.invoicedFuelCost,
      'a negative fuel row must not change the invoiced total');
    assert.equal(afterSupplier.expectedFuelCost, beforeSupplier.expectedFuelCost,
      'and it never lands on the expected side either');
    assert.equal(afterSupplier.variance, beforeSupplier.variance);
    assert.equal(afterSupplier.variancePct, beforeSupplier.variancePct);
  });

  // ── Site 6 ────────────────────────────────────────────────────────────────
  test('settlement-export :176/:262 — a negative LinkedExpense leaves Tổng chi phí identical in HTML and XLSX', async () => {
    const linked = (amount: string, id: number): LinkedExpense => ({
      id, tripId: 1, expenseType: 'LIFTING', amount,
      containerNumber: `C181-CONT-${id}`, invoiceNumber: `C181-INV-${id}`, note: null,
      createdAt: '2026-09-20', departureDate: '2026-09-20', customerName: `C181 khách ${suffix}`,
    });
    const data = (expenses: LinkedExpense[]): SettlementExportData => ({
      id: 1, code: `C181-EXP-${suffix}`.slice(0, 50), createdAt: '2026-09-20T01:00:00.000Z',
      forwarderName: `C181 OPS ${suffix}`, refundAmount: '0', note: null,
      linkedRequests: [{ amount: '1000000', reason: 'C181 ứng', createdAt: '2026-09-19' }],
      linkedExpenses: expenses,
    });

    const baseline = data([linked('600000', 1)]);
    const withNegative = data([linked('600000', 1), linked('-250000', 2)]);

    const htmlBefore = await renderSettlementHtml(baseline);
    const htmlAfter = await renderSettlementHtml(withNegative);
    const htmlSummaryBefore = htmlSummaryTotal(htmlBefore);
    assert.equal(htmlSummaryBefore, htmlSummaryGrandTotal(htmlBefore),
      'fixture sanity: summary and table total agree on one figure');
    assert.equal(htmlSummaryTotal(htmlAfter), htmlSummaryBefore,
      'HTML Tổng chi phí is identical with a negative LinkedExpense present');
    assert.equal(htmlSummaryGrandTotal(htmlAfter), htmlSummaryGrandTotal(htmlBefore),
      'and so is the TỔNG CỘNG table row');
    // Dropped from the MONEY, not from the phiếu: the negative line still renders.
    assert.equal(htmlBefore.includes('C181-CONT-2'), false, 'fixture sanity: the negative line is not in the baseline');
    assert.ok(htmlAfter.includes('C181-CONT-2'), 'the negative line still renders as a row');

    const xlsxBefore = await renderXlsxTotals(baseline);
    const xlsxAfter = await renderXlsxTotals(withNegative);
    assert.equal(xlsxBefore.summary, xlsxBefore.grand, 'fixture sanity: XLSX summary and grand total agree');
    assert.equal(xlsxAfter.summary, xlsxBefore.summary,
      'XLSX Tổng chi phí phát sinh is identical with a negative LinkedExpense present');
    assert.equal(xlsxAfter.grand, xlsxBefore.grand, 'and so is the TỔNG CỘNG CHI PHÍ row');
  });

  // ── Site 7 ────────────────────────────────────────────────────────────────
  test('ops-wallet :60-62/:217 — a negative OPS_ADVANCE row leaves the wallet balance and fund-book closing identical', async () => {
    const customer = await mkCustomer(`C181 wallet ${suffix}`);
    const route = await mkRoute(`C181 wallet route ${suffix}`);
    const cargo = await mkCargo(`C181 wallet cargo ${suffix}`);
    const lot = await mkLot(customer.id, null);
    const [accountant] = await db.insert(s.users)
      .values({ username: `c181-wallet-kt-${suffix}`, passwordHash: 'x', role: Role.ACCOUNTANT, status: 'ACTIVE' }).returning();
    await track(s.users, s.users.id, accountant);
    const [opsUser] = await db.insert(s.users)
      .values({ username: `c181-wallet-ops-${suffix}`, passwordHash: 'x', role: Role.OPS, status: 'ACTIVE' }).returning();
    await track(s.users, s.users.id, opsUser);
    const [account] = await db.insert(s.treasuryAccounts).values({
      code: `C181W-${suffix}`.slice(0, 20), name: `C181 wallet cash ${suffix}`, type: 'CASH', fundCode: 'COMPANY',
      status: 'ACTIVE', createdBy: accountant.id, updatedBy: accountant.id,
    }).returning();
    await track(s.treasuryAccounts, s.treasuryAccounts.id, account);

    const trip = await mkComposedTrip(customer.id, route.id, cargo.id, lot.id, 'WALLET');

    // `recordFundedOpsAdvance` takes a Tx, but the wallet/fund-book reads need
    // the cash rows COMMITTED — getOpsFundBook takes no executor at all. The
    // `as never` widening is this repo's established form for that call (see
    // phoi-phieu-control.test.ts / expense-accounting-source.test.ts).
    const actor = { userId: accountant.id, role: Role.ACCOUNTANT };
    const advance = await recordFundedOpsAdvance(db as never, actor, {
      opsUserId: opsUser.id, amount: 1_000_000, reason: `C181 wallet ${suffix}`,
      treasuryAccountId: account.id, valueDate: '2026-09-10',
      physicalReference: `C181-WALLET-${suffix}`.slice(0, 160),
    });
    await track(s.advanceRequests, s.advanceRequests.id, advance);
    const [advanceLedger] = await db.select({ id: s.ledger.id }).from(s.ledger)
      .where(and(eq(s.ledger.txnType, TxnType.OPS_ADVANCE), eq(s.ledger.txnId, advance.id)));
    if (advanceLedger) {
      await track(s.ledger, s.ledger.id, advanceLedger);
      const movements = await db.select({ id: s.treasuryMovements.id }).from(s.treasuryMovements)
        .where(eq(s.treasuryMovements.ledgerEntryId, advanceLedger.id));
      for (const movement of movements) await track(s.treasuryMovements, s.treasuryMovements.id, movement);
    }

    const positive = await mkExpense(trip.id, '300000', {
      forwarderId: opsUser.id, createdBy: opsUser.id, settlementMethod: 'OPS_ADVANCE',
      approvalStatus: 'RECORDED', expenseDate: '2026-09-20', expenseType: 'PHI_CHI_HO',
    });

    const walletBefore = await getOpsWalletSummary(opsUser.id);
    const bookBefore = await getOpsFundBook(opsUser.id);
    assert.notEqual(Number(walletBefore.balance), 0, 'fixture sanity: the wallet carries real money');
    assert.ok(bookBefore.items.some((item) => item.key === `trip-expense-${positive.id}`),
      'fixture sanity: the positive OPS expense is a fund-book EXPENSE entry');

    const negative = await mkExpense(trip.id, '-125000', {
      forwarderId: opsUser.id, createdBy: opsUser.id, settlementMethod: 'OPS_ADVANCE',
      approvalStatus: 'RECORDED', expenseDate: '2026-09-20', expenseType: 'PHI_CHI_HO',
    });

    const walletAfter = await getOpsWalletSummary(opsUser.id);
    const bookAfter = await getOpsFundBook(opsUser.id);

    assert.equal(walletAfter.balance, walletBefore.balance,
      'a negative OPS_ADVANCE row must not change the wallet balance (:60-62)');
    assert.equal(walletAfter.approved, walletBefore.approved,
      'nor the approved expense side of the wallet formula');
    assert.equal(bookAfter.closing, bookBefore.closing, 'the fund-book closing balance is unchanged (:217)');
    assert.equal(bookAfter.items.length, bookBefore.items.length,
      'and the book gained no entry for the new row');
    assert.equal(bookAfter.items.some((item) => item.key === `trip-expense-${negative.id}`), false,
      'a negative row must NOT emit a sign-flipped EXPENSE entry');
    assert.equal(bookAfter.walletBalance, bookBefore.walletBalance, 'the book still reconciles to the wallet');
  });

  // ── Site 8 ────────────────────────────────────────────────────────────────
  test('expense-accounting reconciliation :52 — a negative source leaves the batch amount identical and consumes no advance', () => isolated(async (tx) => {
    const fixture = await moneyFixture(tx);
    const from = '2026-09-01';
    const to = '2026-09-30';

    /** An Ops expense source payable to the Ops payer — the reconciliation input shape. */
    const opsSource = async (buyAmount: number, tag: string) => {
      const [native] = await tx.insert(s.opsExpenseEntries).values({
        shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: String(buyAmount),
        paidById: fixture.opsUser.id, paidAt: '2026-09-20', approvalStatus: 'RECORDED',
      }).returning();
      const source = await upsertExpenseAccountingSource(tx, {
        sourceKind: 'OPS', sourceId: native.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
        customerId: fixture.customer.id, expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR',
        feeName: `C181 ${tag}`, amount: buyAmount, customerChargeAmount: 0, expenseDate: '2026-09-20',
        payerKind: 'USER', payerUserId: fixture.opsUser.id,
        payableEntityType: 'FORWARDER', payableEntityId: fixture.opsUser.id, recordedById: fixture.actor.userId,
      });
      return { native, source };
    };
    /**
     * `confirmedAt` is stamped directly: `confirmAccountingExpenses` also posts
     * vendor ledger entries and syncs billing documents, a different (and, for
     * a negative amount, ledger-sign-sensitive) path. The gate this case tests
     * — `createExpenseReconciliation` — reads `confirmedAt` and nothing more.
     */
    const confirm = async (sourceId: number) => {
      await tx.update(s.expenseAccountingSources)
        .set({ confirmedAt: new Date(), confirmedById: fixture.actor.userId })
        .where(eq(s.expenseAccountingSources.id, sourceId));
    };
    const allocationOf = async (sourceId: number) => {
      const [row] = await tx.select({ allocated: s.expenseAccountingSources.allocatedAdvanceAmount })
        .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, sourceId));
      return row.allocated;
    };

    const first = await opsSource(500_000, 'first');
    await confirm(first.source.id);
    const advanceOne = await fundedAdvance(tx, fixture, 200_000, 'recon-1');

    // Baseline batch: one positive source against a strict part of its advance.
    const batchOne = await createExpenseReconciliation(tx, fixture.actor, {
      opsUserId: fixture.opsUser.id, from, to,
      entries: [{ sourceKind: 'OPS', sourceId: first.native.id, expectedVersion: first.source.version }],
      advances: [{ advanceRequestId: advanceOne.id, amount: 200_000 }],
    });
    const positiveOnlyAmount = batchOne.amount;
    const positiveOnlyAllocation = await allocationOf(first.source.id);
    assert.ok(Number(positiveOnlyAllocation) > 0, 'fixture sanity: the advance really is allocated');

    // Same money PLUS a negative source. The negative rides the TRIP mirror —
    // the one signed path the accounting-source layer supports.
    const second = await opsSource(500_000, 'second');
    await confirm(second.source.id);
    const [negativeExpense] = await tx.insert(s.tripExpenses).values({
      tripId: fixture.trip.id, forwarderId: fixture.opsUser.id, createdBy: fixture.opsUser.id,
      expenseType: 'OTHER', buyAmount: '-200000', sellAmount: '0', approvalStatus: 'RECORDED',
      settlementMethod: 'OPS_ADVANCE', expenseDate: '2026-09-20',
      invoiceNumber: `C181-RECON-${suffix}`.slice(0, 50),
    }).returning();
    const negativeSource = await upsertExpenseAccountingSource(tx, {
      sourceKind: 'TRIP', sourceId: negativeExpense.id, shipmentId: fixture.shipment.id,
      tripId: fixture.trip.id, customerId: fixture.customer.id, expenseTypeCode: 'OTHER',
      costGroup: 'OPS_REGULAR', feeName: 'C181 negative', amount: -200_000, customerChargeAmount: 0,
      expenseDate: '2026-09-20', payerKind: 'USER', payerUserId: fixture.opsUser.id,
      payableEntityType: 'FORWARDER', payableEntityId: fixture.opsUser.id,
      recordedById: fixture.actor.userId, linkedTripExpenseId: negativeExpense.id,
    });
    await confirm(negativeSource.id);
    const advanceTwo = await fundedAdvance(tx, fixture, 200_000, 'recon-2');

    const batchTwo = await createExpenseReconciliation(tx, fixture.actor, {
      opsUserId: fixture.opsUser.id, from, to,
      entries: [
        { sourceKind: 'OPS', sourceId: second.native.id, expectedVersion: second.source.version },
        { sourceKind: 'TRIP', sourceId: negativeExpense.id, expectedVersion: negativeSource.version },
      ],
      advances: [{ advanceRequestId: advanceTwo.id, amount: 200_000 }],
    });

    assert.equal(batchTwo.amount, positiveOnlyAmount,
      'adding a negative source must not change the đợt amount (:52)');
    assert.equal(Number(await allocationOf(negativeSource.id)), 0,
      'a negative source consumes no advance (:97)');
    assert.equal(await allocationOf(second.source.id), positiveOnlyAllocation,
      "and the positive source's allocation is unchanged by the row beside it");
  }));

  // ── Site 9 ────────────────────────────────────────────────────────────────
  test('expense-accounting reads :81/:340 — a negative row leaves the list total and the OUT report total identical', () => {
    const actor = { userId: 900_181, role: Role.ACCOUNTANT };
    const query = { page: 1, limit: 25 };

    const positive = accountingEntry({ sourceId: 1, amount: 400_000 });
    const negative = accountingEntry({ sourceId: 2, amount: -150_000 });

    const pageBefore = expenseEntryPage([positive], actor, query);
    const pageAfter = expenseEntryPage([positive, negative], actor, query);
    assert.ok(pageBefore.totals.amount > 0, 'fixture sanity: the list total is real money');
    assert.equal(pageAfter.totals.amount, pageBefore.totals.amount,
      'list totals.amount :81 drops the negative row');
    assert.equal(pageAfter.total, pageBefore.total + 1, 'the row itself is never hidden from the list');

    const reportBefore = expenseAccountingReportRows([positive], 'OUT');
    const reportAfter = expenseAccountingReportRows([positive, negative], 'OUT');
    assert.ok(reportBefore.totals.total > 0, 'fixture sanity: the OUT report bucket is real money');
    assert.equal(reportAfter.totals.total, reportBefore.totals.total,
      'OUT report totals.total :340 drops the negative row');
    assert.equal(reportAfter.items.length, reportBefore.items.length,
      'both rows land in the same payable group');
    const grouped = reportAfter.items.flatMap((row) => row.entries);
    assert.ok(grouped.some((entry) => entry.sourceId === negative.sourceId),
      'the negative row still shows in group.entries (visibility is never suppressed)');
  });

  // ── Site 10 ───────────────────────────────────────────────────────────────
  test('expense-accounting work :76/:102 — a negative expense leaves the trip payable identical', () => isolated(async (tx) => {
    const fixture = await moneyFixture(tx);
    const actor = { userId: fixture.accountant.id, role: Role.ACCOUNTANT };
    const query = { shipmentId: fixture.shipment.id, page: 1, limit: 100 };

    const [positiveNative] = await tx.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: '500000',
      paidById: fixture.opsUser.id, paidAt: '2026-09-20', approvalStatus: 'RECORDED',
    }).returning();
    await upsertExpenseAccountingSource(tx, {
      sourceKind: 'OPS', sourceId: positiveNative.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
      customerId: fixture.customer.id, expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR',
      feeName: 'C181 work positive', amount: 500_000, customerChargeAmount: 0, expenseDate: '2026-09-20',
      payerKind: 'USER', payerUserId: fixture.opsUser.id,
      payableEntityType: 'FORWARDER', payableEntityId: fixture.opsUser.id, recordedById: fixture.accountant.id,
    });

    const before = await listExpenseAccountingWork(actor, query, tx);
    const beforeRow = before.items.find((row) => row.tripId === fixture.trip.id);
    assert.ok(beforeRow, 'fixture sanity: the trip is a work row');
    assert.equal(beforeRow.entries.length, 1, 'fixture sanity: exactly one expense rides the trip');
    assert.ok(Number(beforeRow.payable) > 0, 'fixture sanity: the payable roll-up is real money');

    const [negativeNative] = await tx.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.shipment.id, expenseTypeCode: 'OTHER', amount: '-180000',
      paidById: fixture.opsUser.id, paidAt: '2026-09-20', approvalStatus: 'RECORDED',
    }).returning();
    await upsertExpenseAccountingSource(tx, {
      sourceKind: 'OPS', sourceId: negativeNative.id, shipmentId: fixture.shipment.id, tripId: fixture.trip.id,
      customerId: fixture.customer.id, expenseTypeCode: 'OTHER', costGroup: 'OPS_REGULAR',
      feeName: 'C181 work negative', amount: -180_000, customerChargeAmount: 0, expenseDate: '2026-09-20',
      payerKind: 'USER', payerUserId: fixture.opsUser.id,
      payableEntityType: 'FORWARDER', payableEntityId: fixture.opsUser.id, recordedById: fixture.accountant.id,
    });

    const after = await listExpenseAccountingWork(actor, query, tx);
    const afterRow = after.items.find((row) => row.tripId === fixture.trip.id);
    assert.ok(afterRow, 'the trip is still a work row');
    assert.equal(afterRow.payable, beforeRow.payable,
      'a negative expense must not change the work row payable (:76)');
    assert.equal(after.totals.payable, before.totals.payable, 'nor the list payable total');
    assert.ok(afterRow.entries.some((entry) => entry.sourceId === negativeNative.id && entry.amount < 0),
      'while the negative row still rides entries (:102)');
    assert.ok(afterRow.entries.length > beforeRow.entries.length,
      'and the row count grew by the row that was added');
  }));

  // ── Intake contract ───────────────────────────────────────────────────────
  test('tripExpenseSchema — accepts a signed amount and keeps the money bounds', () => {
    // Settled, invoice-less shape: the schema demands the substitute-evidence
    // fields whenever no invoice number is present.
    const base = {
      tripId: 1, expenseType: 'OTHER', forwarderId: 7,
      expenseDate: '2026-09-20', payeeName: 'Nguyễn Văn A', note: 'Chi hộ',
      noInvoiceEvidenceTypes: ['RECEIPT'],
    };

    const accepted = tripExpenseSchema.safeParse({ ...base, buyAmount: -500_000 });
    assert.equal(accepted.success, true, 'a NEGATIVE buy amount is a valid expense line');
    assert.equal(accepted.success && accepted.data.buyAmount, -500_000, 'and it keeps its sign through parsing');

    assert.equal(tripExpenseSchema.safeParse({ ...base, buyAmount: 500_000 }).success, true,
      'positive amounts still pass');
    assert.equal(tripExpenseSchema.safeParse({ ...base, buyAmount: 0 }).success, false,
      '0 is an empty row, not a signed row');
    assert.equal(tripExpenseSchema.safeParse({ ...base, buyAmount: 1_000_000_000_000_000 }).success, false,
      'above the money ceiling is rejected');
    assert.equal(tripExpenseSchema.safeParse({ ...base, buyAmount: -1_000_000_000_000_000 }).success, false,
      'below the negative ceiling is rejected');
    assert.equal(tripExpenseSchema.safeParse({ ...base, buyAmount: -500_000.5 }).success, false,
      'VND is whole — a non-integer is rejected');
    assert.equal(tripExpenseSchema.safeParse({ ...base, buyAmount: Number.NaN }).success, false,
      'a non-finite amount is rejected');

    // The patch schema is the partial form; a negative correction must parse.
    const patch = tripExpensePatchSchema.safeParse({ buyAmount: -500_000 });
    assert.equal(patch.success, true, 'tripExpensePatchSchema accepts a negative buyAmount');
    assert.equal(patch.success && patch.data.buyAmount, -500_000);
    assert.equal(tripExpensePatchSchema.safeParse({ buyAmount: 0 }).success, false,
      'and it keeps the same bounds');
  });
});

// ── Local helpers ───────────────────────────────────────────────────────────

/** Pull the Tổng chi phí summary figure out of the rendered phiếu HTML. */
function htmlSummaryTotal(html: string): string {
  const match = /Tổng chi phí:<\/span><strong>([^<]*)<\/strong>/.exec(html);
  assert.ok(match, 'the rendered HTML carries the Tổng chi phí summary row');
  return match[1];
}

/** Pull the TỔNG CỘNG table row figure out of the rendered phiếu HTML. */
function htmlSummaryGrandTotal(html: string): string {
  const match = /TỔNG CỘNG<\/strong><\/td>\s*<td class="num"><strong>([^<]*)<\/strong>/.exec(html);
  assert.ok(match, 'the rendered HTML carries the TỔNG CỘNG table row');
  return match[1];
}

/** Render into a collecting Writable and read back the two money totals. */
async function renderXlsxTotals(data: SettlementExportData): Promise<{ summary: number; grand: number }> {
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  assert.equal(await renderSettlementXlsx(data, output), true, 'the XLSX renderer resolves true');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(Buffer.concat(chunks)).buffer);
  let summary: number | undefined;
  let grand: number | undefined;
  workbook.worksheets[0].eachRow((row) => {
    const label = String(row.getCell(1).value ?? '');
    if (label === 'Tổng chi phí phát sinh') summary = Number(row.getCell(5).value);
    if (label === 'TỔNG CỘNG CHI PHÍ') grand = Number(row.getCell(5).value);
  });
  assert.ok(summary != null && Number.isFinite(summary), 'the XLSX carries the Tổng chi phí phát sinh row');
  assert.ok(grand != null && Number.isFinite(grand), 'the XLSX carries the TỔNG CỘNG CHI PHÍ row');
  const totals = { summary: summary as number, grand: grand as number };
  return totals;
}

/** The read model's entry shape, filled with the minimum an OUT report needs. */
function accountingEntry(over: Partial<ExpenseAccountingEntry> & { sourceId: number }): ExpenseAccountingEntry {
  return {
    id: over.sourceId, sourceKind: 'OPS', version: 1,
    shipmentId: 1, shipmentContainerId: null, tripId: 1, truckId: null,
    customerId: 1, shipmentCode: 'C181-LOT', tripCode: 'C181-TRIP', truckPlate: null,
    customerName: 'C181 khách', containerNumber: null, costGroup: 'OPS_REGULAR',
    expenseTypeCode: 'OTHER', feeName: 'Chi làm hàng', amount: 100_000, customerChargeAmount: 0,
    invoiceNumber: null, invoiceDate: null, expenseDate: '2026-09-20', payerKind: 'USER',
    payerUserId: 900_181, payerName: 'C181 Ops', recordedById: 900_181, confirmedById: null,
    confirmedAt: null, confirmedByName: null, note: null, recoveryNote: null, photoStorageKeys: [],
    receivedAmount: 0, paidAmount: 0, outstandingReceivable: 0, outstandingPayable: 0,
    payableEntityType: 'FORWARDER', payableEntityId: 900_181, linkedTripExpenseId: null,
    accountantId: null, status: 'RECORDED', evidenceMissing: false, locked: false,
    reconciliationId: null, driverName: null, routeName: null, carrierName: null,
    carrierCode: null, operationalNotes: null, customerNotes: null, driverNotes: null,
    allocatedAdvanceAmount: 0, financialMetadataComplete: true, canViewPayments: true,
    isLegacy: false,
    ...over,
  };
}
