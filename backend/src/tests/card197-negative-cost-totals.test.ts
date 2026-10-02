/**
 * Card 20260928_197 — a negative cost entry must not corrupt ANY total.
 *
 * Card 20260928_181 made `trip_expenses.buy_amount` signed and left the two
 * sibling tables — `ops_expense_entries.amount` (O) and
 * `driver_incidental_costs.amount` (D) — positive-only on purpose, because ~27
 * aggregates still added those columns outright. This card is that wave: the
 * aggregates move to the ONE shared rule (`sumExcludingNegative`) FIRST, then
 * the three validators flip to signed. Order matters — flipping the validators
 * first would publish a silently wrong number.
 *
 * The PM's rule, and the way every case below measures it: read a total,
 * INSERT a negative row, read it again, assert the two are STRICTLY EQUAL. No
 * case compares a total against a money literal, so a later fixture-amount
 * change cannot turn an assertion green for the wrong reason.
 *
 * Sites covered (all from the card's 27-site list):
 *   O/D  ops-expenses.service.ts:626/627 basket+group total
 *       ops-expenses.service.ts:632/633 rollup withInvoice/withoutInvoice
 *       ops-expenses.service.ts:639 grand total (inherits, asserted anyway)
 *   O    ops-settlements.service.ts:58/:209 ops_settlements.totalAmount
 *   D    expense-trip-cost.service.ts:16/:19 toll + extra snapshot
 *   D    phoi-phieu-control.service.ts:166 confirmed road fee per trip
 *   O    phoi-phieu-control.service.ts:212 chiHoTra (chi-ho per lot)
 *   O    phoi-phieu-control.service.ts:453 Tổng trả (detail dialog)
 *   D    phoi-phieu-control.service.ts:575/:576 road-fee totals
 *   O    phoi-phieu-control.service.ts:711-713 tienNang/tienHa/psKhac
 *       phoi-phieu-control.service.ts:731 TỔNG CỘNG (inherits, asserted)
 *
 * The pure helpers (grouping, trip cost, validators) need no database; the
 * phoi-phieu reads and the settlement freeze do, so they commit fixtures and
 * `after()` removes them children-first in reverse insertion order.
 */
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  Role,
  driverIncidentalCostSchema,
  expenseAccountingCreateSchema,
  expenseAccountingUpdateSchema,
} from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import {
  createOpsExpense,
  groupOpsExpensesForSettlement,
  parseOpsMoney,
  recomputeOpsSettlementTotal,
  type SettlementExpenseInput,
} from '../services/ops-expenses.service';
import { createOpsSettlement, finalizeOpsSettlement } from '../services/ops-settlements.service';
import { reconciledDriverCosts } from '../services/expense-trip-cost.service';
import {
  getPhoiPhieuChiHo,
  getPhoiPhieuReport,
  getPhoiPhieuTienDuong,
  listPhoiPhieuRows,
} from '../services/phoi-phieu-control.service';

const suffix = `${Date.now()}-c197-${Math.random().toString(36).slice(2, 8)}`;
/** `ops_settlements.code` is varchar(20) and globally unique.
 *
 *  The code used to be `C197D1`, `C197N2`, … from a module counter — a
 *  deterministic value, so a run that died before `after()` (or whose cleanup
 *  hit a RESTRICT FK and gave up) left `C197D1` behind and every later run
 *  failed on a unique violation that looked like a product failure. Nothing
 *  in the assertion had changed. The per-run tag below makes residue from a
 *  crashed run harmless: at worst it accumulates as a row nobody reads. */
const runTag = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const settlementCode = (n: number) => `C197${runTag}${n}`.slice(0, 20);
let settlementSeq = 1;

// ── Committed-fixture bookkeeping ───────────────────────────────────────────
interface CleanupEntry {
  /** Children that must go before the row itself (RESTRICT FKs, sidecars). */
  before?: () => Promise<void>;
  remove: () => Promise<void>;
}
const cleanup: CleanupEntry[] = [];

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
  await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.shipmentId, shipmentId));
}
async function deleteTripSidecars(tripId: number): Promise<void> {
  await db.delete(s.tripExpenseCompletionScopes).where(eq(s.tripExpenseCompletionScopes.tripId, tripId));
  await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId));
  await db.delete(s.tripCarrierInfo).where(eq(s.tripCarrierInfo.tripId, tripId));
}

after(async () => {
  try {
    for (const entry of cleanup) if (entry.before) await entry.before();
    for (const entry of cleanup) await entry.remove();
  } catch (error) {
    console.warn('[card197] cleanup:', (error as Error).message);
  }
  await disconnectRedis();
  await client.end();
});

// ── Fixture builders ───────────────────────────────────────────────────────
interface Fixture {
  customer: { id: number };
  /** The customer name as the phoi-phieu report spells it (its party label). */
  partyName: string;
  route: { id: number };
  lot: { id: number };
  trip: { id: number };
  payer: { id: number };
  driver: { id: number };
  container: { id: number };
  day: string;
}

/** One lot + one trip + an Ops payer + a driver, all on a private day so no
 *  other suite's rows land in the same report window. */
async function mkFixture(tag: string): Promise<Fixture> {
  const key = `${tag}-${suffix}`;
  // The monthly report and the board have no `search` filter — the DATE window
  // is what keeps every other row out, so each fixture gets its own day.
  const day = `2031-0${1 + (cleanup.length % 3)}-1${cleanup.length % 9}`;
  const [payer] = await db.insert(s.users).values({
    username: `c197-${key}`.slice(0, 50), passwordHash: 'x', role: Role.OPS, status: 'ACTIVE',
  }).returning();
  await track(s.users, s.users.id, payer);
  const [customer] = await db.insert(s.customers).values({ name: `C197 ${key}` }).returning();
  await track(s.customers, s.customers.id, customer);
  const [route] = await db.insert(s.routes).values({ name: `C197 route ${key}` }).returning();
  await track(s.routes, s.routes.id, route);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `C197 cargo ${key}` }).returning();
  await track(s.cargoTypes, s.cargoTypes.id, cargo);
  const [lot] = await db.insert(s.shipments).values({
    customerId: customer.id, expectedDeliveryDate: day, cargoMode: 'FCL', status: 'DISPATCHED',
  }).returning();
  await track(s.shipments, s.shipments.id, lot, () => deleteShipmentChildren(lot.id));
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: lot.id, containerNumber: `C197${(cleanup.length % 1000).toString().padStart(7, '0')}`,
  }).returning();
  await track(s.shipmentContainers, s.shipmentContainers.id, container);
  const [fulfillment] = await db.insert(s.shipmentFulfillments).values({
    shipmentId: lot.id, shipmentContainerId: container.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1,
  }).returning();
  await track(s.shipmentFulfillments, s.shipmentFulfillments.id, fulfillment);
  const [trip] = await db.insert(s.trips).values({
    fulfillmentId: fulfillment.id, shipmentId: lot.id, customerId: customer.id, routeId: route.id,
    cargoTypeId: cargo.id, tripCode: `C197-${key}`.slice(0, 50),
    departureDate: day, status: 'IN_TRANSIT',
  }).returning();
  await track(s.trips, s.trips.id, trip, () => deleteTripSidecars(trip.id));
  const [driverUser] = await db.insert(s.users).values({
    username: `c197-drv-${key}`.slice(0, 50), passwordHash: 'x', role: Role.DRIVER, status: 'ACTIVE',
  }).returning();
  await track(s.users, s.users.id, driverUser);
  const [driver] = await db.insert(s.drivers).values({ name: `C197 driver ${key}`, userId: driverUser.id, status: 'ACTIVE' }).returning();
  await track(s.drivers, s.drivers.id, driver);
  return { customer, partyName: `C197 ${key}`, route, lot, trip, payer, driver, container, day };
}

/** A confirmed (RECORDED + confirmedAt) Ops cost row — the shape every phoi-phieu
 *  read here filters on. */
async function mkOpsCost(fixture: Fixture, amount: string, charge: string) {
  const [entry] = await db.insert(s.opsExpenseEntries).values({
    shipmentId: fixture.lot.id, shipmentContainerId: fixture.container.id, expenseTypeCode: 'OTHER',
    amount, customerChargeAmount: charge, costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
    paidById: fixture.payer.id, paidAt: fixture.day, approvalStatus: 'RECORDED',
  }).returning();
  await track(s.opsExpenseEntries, s.opsExpenseEntries.id, entry);
  const [source] = await db.insert(s.expenseAccountingSources).values({
    sourceKind: 'OPS', sourceId: entry.id, shipmentId: fixture.lot.id, tripId: fixture.trip.id,
    confirmedAt: new Date(), version: 1,
  }).returning();
  await track(s.expenseAccountingSources, s.expenseAccountingSources.id, source);
  return { entry, source };
}

/** A confirmed driver cost row (D). */
async function mkDriverCost(fixture: Fixture, amount: string, costType: 'TOLL' | 'OTHER' = 'TOLL', confirmed = true) {
  const [cost] = await db.insert(s.driverIncidentalCosts).values({
    tripId: fixture.trip.id, driverId: fixture.driver.id, costType,
    costGroup: 'DRIVER_ROAD', payerKind: 'USER', feeName: 'C197 cost',
    amount, customerChargeAmount: '0', occurredAt: fixture.day,
  }).returning();
  await track(s.driverIncidentalCosts, s.driverIncidentalCosts.id, cost);
  if (confirmed) {
    const [source] = await db.insert(s.expenseAccountingSources).values({
      sourceKind: 'DRIVER', sourceId: cost.id, shipmentId: fixture.lot.id, tripId: fixture.trip.id,
      confirmedAt: new Date(), version: 1,
    }).returning();
    await track(s.expenseAccountingSources, s.expenseAccountingSources.id, source);
  }
  return cost;
}

const opsEntry = (fixture: Fixture, amount: string, charge: string, requiresInvoice: boolean): SettlementExpenseInput => ({
  shipmentId: fixture.lot.id, shipmentCode: `C197-${fixture.lot.id}`, customerName: 'C197',
  billRef: null, containerNumber: null, expenseTypeName: 'C197', requiresInvoice, amount,
  approvalStatus: 'RECORDED',
});

// ════════════════════════════════════════════════════════════════════════════
describe('card 20260928_197 — a negative cost row leaves every total as if absent', () => {

  // ── Step 1: the three validators now accept a signed amount ───────────────
  test('the three validators accept a negative amount and still reject 0 / junk', () => {
    // 1) driver screen (POST /api/driver/trips/:tripId/incidental-costs)
    const driverParsed = driverIncidentalCostSchema.safeParse({
      costType: 'TOLL', amount: -50_000, occurredAt: '2026-09-22',
    });
    assert.ok(driverParsed.success, `driver incidental cost must accept -50000: ${driverParsed.error?.message}`);

    // 2)+(3) expense accounting create/update
    const createBase = {
      tripId: 1, expenseTypeCode: 'OTHER', customerChargeAmount: 0,
      expenseDate: '2026-09-22', costGroup: 'OPS_INCIDENTAL' as const, feeName: 'fee',
      payerKind: 'COMPANY' as const,
    };
    assert.ok(expenseAccountingCreateSchema.safeParse({ ...createBase, amount: -50_000 }).success,
      'expense accounting create must accept -50000');
    assert.ok(expenseAccountingUpdateSchema.safeParse({ expectedVersion: 1, reason: 'r', amount: -50_000 }).success,
      'expense accounting update must accept -50000');

    // 0 stays rejected everywhere — a zero row is empty, not signed.
    assert.equal(driverIncidentalCostSchema.safeParse({ costType: 'TOLL', amount: 0, occurredAt: '2026-09-22' }).success, false);
    assert.equal(expenseAccountingCreateSchema.safeParse({ ...createBase, amount: 0 }).success, false);
    assert.equal(expenseAccountingUpdateSchema.safeParse({ expectedVersion: 1, reason: 'r', amount: 0 }).success, false);
    // The ceiling stays symmetric on both signs.
    assert.equal(driverIncidentalCostSchema.safeParse({ costType: 'TOLL', amount: -1_000_000_000_000_000, occurredAt: '2026-09-22' }).success, false);

    // 4) parseOpsMoney — the BigInt mirror behind POST /api/ops/expenses.
    assert.equal(parseOpsMoney('-50000'), -50_000n, 'ops POST accepts a negative string amount');
    assert.equal(parseOpsMoney(-50_000), -50_000n, 'and a negative number amount');
    assert.throws(() => parseOpsMoney('0'), /không được bằng 0/);
    assert.throws(() => parseOpsMoney('-1000000000000000'), /vượt quá giới hạn/);
    assert.throws(() => parseOpsMoney('1.5'), /số nguyên/);
  });

  // ── O: ops-expenses.service.ts:626/627/632/633/639 — settlement grouping ──
  test('ops-expenses :626/627/632/633/639 — a negative entry leaves every settlement total identical', async () => {
    const fixture = await mkFixture('settle');
    const positive = await mkOpsCost(fixture, '350000', '120000');
    assert.ok(positive.entry.id > 0, 'fixture sanity: the positive entry exists');

    const before = groupOpsExpensesForSettlement([opsEntry(fixture, '350000', '120000', true)]);
    assert.equal(before.groups.length, 1, 'fixture sanity: one lô group');
    assert.ok(Number(before.totals.grand) > 0, 'fixture sanity: the grouping holds real money');

    const negative = await mkOpsCost(fixture, '-90000', '-30000');
    const after = groupOpsExpensesForSettlement([
      opsEntry(fixture, '350000', '120000', true),
      opsEntry(fixture, '-90000', '-30000', true),
    ]);

    const group = after.groups[0]!;
    assert.equal(group.withInvoice.total, before.groups[0]!.withInvoice.total,
      'basket.total (:627) must ignore the negative row');
    assert.equal(group.total, before.groups[0]!.total,
      'group.total (:638) must ignore the negative row');
    assert.equal(after.totals.withInvoice, before.totals.withInvoice,
      'the withInvoice rollup (:632) must ignore the negative row');
    assert.equal(after.totals.withoutInvoice, before.totals.withoutInvoice,
      'the withoutInvoice rollup (:633) is unchanged too');
    assert.equal(after.totals.grand, before.totals.grand,
      'the grand total (:639) inherits the same exclusion');
    assert.equal(group.withInvoice.items.length, 2,
      'the negative entry is still VISIBLE in the phiếu — dropped from money, never from the row');
    assert.ok(negative.entry.id > 0);

    // Boundary: a lô holding ONLY a negative entry totals what an empty lô totals.
    const negativeOnly = groupOpsExpensesForSettlement([opsEntry(fixture, '-90000', '-30000', true)]);
    const empty = groupOpsExpensesForSettlement([opsEntry(fixture, '0', '0', true)]);
    assert.equal(negativeOnly.totals.grand, empty.totals.grand,
      'an all-negative batch totals what an empty batch totals — never a negative sum');
  });

  // ── O: ops-settlements.service.ts:58/:209 + ops-expenses :426 (SQL) ───────
  test('ops-settlements :58/:209 — freezing and finalising a batch ignore a negative entry', async () => {
    const fixture = await mkFixture('freeze');
    await mkOpsCost(fixture, '350000', '0');
    await mkOpsCost(fixture, '90000', '0');

    // Site :58 — `createOpsSettlement` freezes the payer's open entries. The
    // negative one below is created AFTER the freeze, so it is still open and
    // never entered this batch.
    const baseline = await createOpsSettlement(fixture.payer.id, 'c197 baseline');
    await track(s.opsSettlements, s.opsSettlements.id, baseline);
    const baselineTotal = baseline.totalAmount;
    assert.ok(Number(baselineTotal) > 0, 'fixture sanity: the frozen batch holds real money');

    // A DRAFT batch carrying positive + negative, recorded through the finalize
    // path (site :209) rather than a hand-written total. `ops_settlements.code`
    // is varchar(20), so the fixture code is short.
    const [draft] = await db.insert(s.opsSettlements).values({
      code: settlementCode(settlementSeq++), opsUserId: fixture.payer.id, status: 'DRAFT', totalAmount: '0',
    }).returning();
    await track(s.opsSettlements, s.opsSettlements.id, draft);

    const [positiveForDraft] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.lot.id, shipmentContainerId: fixture.container.id, expenseTypeCode: 'OTHER',
      amount: '350000', customerChargeAmount: '0', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
      paidById: fixture.payer.id, paidAt: fixture.day, approvalStatus: 'RECORDED', opsSettlementId: draft.id,
    }).returning();
    await track(s.opsExpenseEntries, s.opsExpenseEntries.id, positiveForDraft);

    // Measure the SQL aggregate (:426) BEFORE the negative row exists, so the
    // comparison is the PM's own: same batch, one extra negative row.
    await db.transaction((tx) => recomputeOpsSettlementTotal(tx, draft.id));
    const [beforeNegative] = await db.select({ total: s.opsSettlements.totalAmount })
      .from(s.opsSettlements).where(eq(s.opsSettlements.id, draft.id));
    assert.ok(Number(beforeNegative.total) > 0, 'fixture sanity: the batch holds real money');

    const negative = await mkOpsCost(fixture, '-90000', '0');
    await db.update(s.opsExpenseEntries).set({ opsSettlementId: draft.id })
      .where(eq(s.opsExpenseEntries.id, negative.entry.id));

    await db.transaction((tx) => recomputeOpsSettlementTotal(tx, draft.id));
    const [afterNegative] = await db.select({ total: s.opsSettlements.totalAmount })
      .from(s.opsSettlements).where(eq(s.opsSettlements.id, draft.id));
    assert.equal(afterNegative.total, beforeNegative.total,
      'recomputeOpsSettlementTotal (:426) must ignore the negative row — the query-level form of the same rule');

    // Site :209 — finalising the SAME batch re-derives the total in BigInt and
    // must land on the identical figure the SQL path just stored.
    const recorded = await finalizeOpsSettlement(fixture.payer.id, draft.id);
    assert.equal(recorded.totalAmount, beforeNegative.total,
      'finalize (:209) agrees with the BigInt freeze rule — the negative row never nets against the positives');
    assert.ok(Number(recorded.totalAmount) > 0, 'the recorded total is still real money');

    // A settlement holding ONLY a negative entry totals exactly 0, never -90000.
    const [negativeOnly] = await db.insert(s.opsSettlements).values({
      code: settlementCode(settlementSeq++), opsUserId: fixture.payer.id, status: 'DRAFT', totalAmount: '0',
    }).returning();
    await track(s.opsSettlements, s.opsSettlements.id, negativeOnly);
    await db.update(s.opsExpenseEntries).set({ opsSettlementId: negativeOnly.id })
      .where(eq(s.opsExpenseEntries.id, negative.entry.id));
    await db.transaction((tx) => recomputeOpsSettlementTotal(tx, negativeOnly.id));
    const [emptyTotal] = await db.select({ total: s.opsSettlements.totalAmount })
      .from(s.opsSettlements).where(eq(s.opsSettlements.id, negativeOnly.id));
    assert.equal(emptyTotal.total, '0',
      'a batch of only-negative entries totals exactly what an empty batch totals');
    assert.ok(Number(baselineTotal) > 0, 'the baseline batch is untouched by the second one');

    // Site :58 measured the PM's way: a SECOND freeze of the same positives,
    // this time with the negative row already open for the payer. Both batches
    // hold the identical positive money, so their totals must be identical.
    const negative2 = await mkOpsCost(fixture, '-90000', '0');
    const [positive2] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.lot.id, shipmentContainerId: fixture.container.id, expenseTypeCode: 'OTHER',
      amount: '350000', customerChargeAmount: '0', costGroup: 'OPS_INCIDENTAL', payerKind: 'USER',
      paidById: fixture.payer.id, paidAt: fixture.day, approvalStatus: 'RECORDED',
    }).returning();
    await track(s.opsExpenseEntries, s.opsExpenseEntries.id, positive2);
    await db.update(s.opsExpenseEntries).set({ opsSettlementId: null })
      .where(eq(s.opsExpenseEntries.id, negative2.entry.id));
    const second = await createOpsSettlement(fixture.payer.id, 'c197 with negative');
    await track(s.opsSettlements, s.opsSettlements.id, second);
    assert.equal(second.totalAmount, '350000',
      'createOpsSettlement (:58) freezes the positive row only — the negative one never nets against it');
    assert.ok(Number(baselineTotal) > 0, 'the baseline batch is untouched by the second one');
  });

  // ── D: expense-trip-cost.service.ts:16/:19 — trip financial snapshot ─────
  test('expense-trip-cost :16/:19 — a negative driver cost leaves toll and extra identical', () => {
    const positive = [
      { costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: '80000', customerChargeAmount: '0' },
      { costType: 'OTHER', costGroup: 'DRIVER_SHIPMENT', amount: '30000', customerChargeAmount: '0' },
    ];
    const before = reconciledDriverCosts(positive);
    assert.ok((before.toll ?? 0) > 0, 'fixture sanity: the toll is real money');

    const after = reconciledDriverCosts([
      ...positive,
      { costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: '-25000', customerChargeAmount: '0' },
      { costType: 'OTHER', costGroup: 'DRIVER_SHIPMENT', amount: '-10000', customerChargeAmount: '0' },
    ]);
    assert.equal(after.toll, before.toll, 'toll (:16) must ignore the negative row');
    assert.equal(after.extra, before.extra, 'extra (:19) must ignore the negative row');

    // Boundary: a TOLL set holding only a negative row reads as NO toll row at
    // all (`null` = unknown), never as a negative toll.
    assert.equal(
      reconciledDriverCosts([{ costType: 'TOLL', costGroup: 'DRIVER_ROAD', amount: '-25000', customerChargeAmount: '0' }]).toll,
      null,
      'an all-negative toll set is the unknown case, so the caller falls back to the station math',
    );
  });

  // ── D: phoi-phieu-control.service.ts:166 — confirmed road fee per trip ───
  // ── D: phoi-phieu-control.service.ts:575/:576 — road-fee totals ──────────
  test('phoi-phieu :166/:575/:576 — a negative driver cost leaves every road-fee total identical', async () => {
    const fixture = await mkFixture('road');
    await mkDriverCost(fixture, '80000');
    await mkDriverCost(fixture, '30000');

    const [beforeRow] = (await listPhoiPhieuRows({ search: suffix })).filter((row) => row.tripId === fixture.trip.id);
    const beforeDetail = await getPhoiPhieuTienDuong(fixture.trip.id);
    assert.ok(beforeRow, 'fixture sanity: the board row exists');
    assert.ok(beforeDetail.totals.total > 0, 'fixture sanity: the road-fee total holds real money');
    assert.ok(beforeDetail.totals.confirmed > 0, 'fixture sanity: the confirmed road fee holds real money');

    const negative = await mkDriverCost(fixture, '-25000');
    const [afterRow] = (await listPhoiPhieuRows({ search: suffix })).filter((row) => row.tripId === fixture.trip.id);
    const afterDetail = await getPhoiPhieuTienDuong(fixture.trip.id);

    assert.equal(afterRow!.tienDuong, beforeRow!.tienDuong,
      'the board Tien-duong cell (:166, confirmedRoadByTrip) must ignore the negative row');
    assert.equal(afterDetail.totals.total, beforeDetail.totals.total,
      'the road-fee total (:575) must ignore the negative row');
    assert.equal(afterDetail.totals.confirmed, beforeDetail.totals.confirmed,
      'the confirmed road-fee total (:576) must ignore the negative row');
    assert.ok(afterDetail.rows.some((row) => row.sourceId === negative.id),
      'the negative cost row is still listed — dropped from the total, not from the screen');
    assert.ok(afterDetail.rows.find((row) => row.sourceId === negative.id)!.amount < 0,
      'and it keeps its sign on screen');
  });

  // ── O: phoi-phieu-control.service.ts:212 (chiHoTra) + :453 (Tổng trả) ───
  test('phoi-phieu :212/:453 — a negative Ops cost leaves chi-hộ and Tổng trả identical', async () => {
    const fixture = await mkFixture('chiho');
    await mkOpsCost(fixture, '250000', '100000');
    await mkOpsCost(fixture, '40000', '15000');

    const [beforeRow] = (await listPhoiPhieuRows({ search: suffix })).filter((row) => row.tripId === fixture.trip.id);
    const beforeDetail = await getPhoiPhieuChiHo(fixture.trip.id);
    assert.ok(beforeRow, 'fixture sanity: the board row exists');
    assert.ok((beforeRow!.chiHoTra ?? 0) > 0, 'fixture sanity: chi hộ holds real money');
    assert.ok(beforeDetail.totals.tra > 0, 'fixture sanity: Tổng trả holds real money');

    // The negative row carries NO customer charge: the cost side is signed, the
    // receivable side is not, so this also pins that a signed cost row cannot
    // move Tổng thu.
    const negative = await mkOpsCost(fixture, '-90000', '0');
    const [afterRow] = (await listPhoiPhieuRows({ search: suffix })).filter((row) => row.tripId === fixture.trip.id);
    const afterDetail = await getPhoiPhieuChiHo(fixture.trip.id);

    assert.equal(afterRow!.chiHoTra, beforeRow!.chiHoTra,
      'the board chi-hộ cell (:212) must ignore the negative row');
    assert.equal(afterDetail.totals.tra, beforeDetail.totals.tra,
      'Tổng trả (:453) must ignore the negative row');
    assert.equal(afterDetail.totals.thu, beforeDetail.totals.thu,
      'and the receivable side is untouched by a signed COST row');
    assert.ok(afterDetail.rows.some((row) => row.entryId === negative.entry.id),
      'the negative cost row still appears under the dialog');
    assert.ok(afterDetail.rows.find((row) => row.entryId === negative.entry.id)!.amountTra < 0,
      'and it keeps its sign');
  });

  // ── O: phoi-phieu-control.service.ts:711-713 (by subject) + :731 (TỔNG) ───
  test('phoi-phieu :711-713/:731 — a negative Ops cost leaves every report column identical', async () => {
    const fixture = await mkFixture('report');
    await mkOpsCost(fixture, '250000', '100000');
    await mkOpsCost(fixture, '40000', '15000');

    // `THU` attributes the row to the customer, so the lot gets its OWN party
    // row; `TRA` would group it under the carrier and mix it with other suites.
    const window = { kind: 'THU' as const, from: fixture.day, to: fixture.day };
    const before = await getPhoiPhieuReport(window);
    const beforeRow = before.rows.find((row) => row.party === fixture.partyName);
    assert.ok(beforeRow, `fixture sanity: the lot has its own party row in the report (party=${fixture.partyName}, got ${before.rows.map((r) => r.party).join(' | ')})`);
    assert.ok(beforeRow!.tongPhaiThuTra > 0, 'fixture sanity: the party column holds real money');

    await mkOpsCost(fixture, '-90000', '0');
    const after = await getPhoiPhieuReport(window);
    const afterRow = after.rows.find((row) => row.party === fixture.partyName);
    assert.ok(afterRow, 'the party row survives the negative row');
    assert.equal(afterRow!.tienNang, beforeRow!.tienNang, 'tienNang must ignore the negative row');
    assert.equal(afterRow!.tienHa, beforeRow!.tienHa, 'tienHa must ignore the negative row');
    assert.equal(afterRow!.psKhac, beforeRow!.psKhac, 'psKhac must ignore the negative row');
    assert.equal(afterRow!.tongPhaiThuTra, beforeRow!.tongPhaiThuTra, 'Tổng phải trả must ignore the negative row');
    assert.equal(afterRow!.conLai, beforeRow!.conLai, 'Còn lại must ignore the negative row too');

    const beforeGrand = before.grand;
    const afterGrand = after.grand;
    assert.equal(afterGrand.tienNang, beforeGrand.tienNang, 'TỔNG CỘNG tienNang (:731) inherits the exclusion');
    assert.equal(afterGrand.psKhac, beforeGrand.psKhac, 'TỔNG CỘNG psKhac (:731) inherits the exclusion');
    assert.equal(afterGrand.tongPhaiThuTra, beforeGrand.tongPhaiThuTra, 'TỔNG CỘNG total (:731) inherits the exclusion');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The save path. Everything above proves a negative row that EXISTS leaves the
// totals alone; this block proves a negative row can be SAVED at all.
//
// It could not, and the failure was invisible. `createOpsExpense` derives the
// receivable for an invoice-group row as `charge = amount` — an identity that
// only holds while the amount is non-negative. Card 20260928_181 made the amount
// signed and did not revisit the derivation, so a negative cost dragged the
// receivable negative, and the unsigned `expenseVndSchema` at
// expense-accounting-source.service.ts:105 rejected it with
//   {"code":"too_small","minimum":0,"path":[]}
// — a 400 whose `path` is empty, because the failing value is a bare number
// parsed inside the service rather than a named request field. The UI renders
// that as the generic "Giá trị không hợp lệ", which is what staging showed.
//
// The invariant this pins: the COST side is signed, the RECEIVABLE side is not.
// A negative line is a correction, not money the customer owes, so it charges
// 0 — never a negative receivable, which would net against the customer's
// balance instead of leaving it as if the row did not exist.
describe('card 20260928_197 — a negative cost row can be saved, and charges nothing', () => {
  /** An ACTIVE catalog type of this fixture's own, so `assertActiveExpenseType`
   *  passes without borrowing a shared code another suite may be mutating. */
  async function mkActiveType(tag: string) {
    const code = `C197T${tag}${suffix}`.replace(/[^A-Za-z0-9_]/g, '').slice(0, 50);
    const [type] = await db.insert(s.forwarderExpenseTypes).values({
      code, name: `C197 type ${tag}`, status: 'ACTIVE', requiresInvoice: true, category: 'LIFT',
    }).returning();
    await track(s.forwarderExpenseTypes, s.forwarderExpenseTypes.id, type);
    return code;
  }

  /** Grant the OPS payer the lot via branch 3 of `assertOpsExpenseAssignment`
   *  (their own saved, non-voided expense) — the branch a real returning
   *  forwarder already has, so the test is about the charge, not the scope. */
  async function mkGranted(fixture: Fixture, expenseTypeCode: string) {
    const [seed] = await db.insert(s.opsExpenseEntries).values({
      shipmentId: fixture.lot.id, expenseTypeCode, amount: '1000',
      paidById: fixture.payer.id, paidAt: fixture.day, approvalStatus: 'RECORDED',
    }).returning();
    await track(s.opsExpenseEntries, s.opsExpenseEntries.id, seed);
  }

  test('an INVOICED_ ops row with a negative amount saves, with a 0 receivable', async () => {
    const fixture = await mkFixture('chg');
    const code = await mkActiveType('chg');
    await mkGranted(fixture, code);

    const created = await createOpsExpense(fixture.payer.id, {
      shipmentId: fixture.lot.id,
      expenseTypeCode: code,
      amount: '-50000',
      paidAt: fixture.day,
      costGroup: 'INVOICED_LIFT',
      note: 'C197: negative correction against a prior over-declaration',
    });

    assert.equal(created.amount, '-50000', 'the signed cost is stored as sent');
    assert.equal(created.customerChargeAmount, '0',
      'a negative cost must charge the customer 0 — never a negative receivable');
  });

  test('a POSITIVE INVOICED_ row still charges the full amount (the invariant is untouched)', async () => {
    const fixture = await mkFixture('pos');
    const code = await mkActiveType('pos');
    await mkGranted(fixture, code);

    const created = await createOpsExpense(fixture.payer.id, {
      shipmentId: fixture.lot.id,
      expenseTypeCode: code,
      amount: '50000',
      paidAt: fixture.day,
      costGroup: 'INVOICED_LIFT',
      note: 'C197: positive baseline',
    });

    assert.equal(created.customerChargeAmount, '50000', 'charge = amount still holds for a real charge');
  });

  test('an explicit negative customerChargeAmount override is refused, naming the field', async () => {
    const fixture = await mkFixture('ovr');
    const code = await mkActiveType('ovr');
    await mkGranted(fixture, code);

    // A caller may not push a negative receivable in through the override
    // either. It used to surface as the same field-less "must be >= 0".
    await assert.rejects(
      createOpsExpense(fixture.payer.id, {
        shipmentId: fixture.lot.id,
        expenseTypeCode: code,
        amount: '50000',
        paidAt: fixture.day,
        costGroup: 'OPS_REGULAR',
        customerChargeAmount: '-1',
        note: 'C197: negative override',
      }),
      /nhập âm|không được âm/i,
      'a negative receivable override must be refused with a message that names it',
    );
  });
});
