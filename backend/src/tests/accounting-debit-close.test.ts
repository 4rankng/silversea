import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import {
  getAccountingDebitBoard,
  createRateAdjustmentRequests,
  confirmRateAdjustmentRequests,
  withdrawRateAdjustmentRequests,
  assertNoPendingRateAdjustment,
} from '../services/accounting-debit-close.service';
import { Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
async function track<T extends { id: number }>(table: any, row: T): Promise<T> {
  cleanup.unshift({ table, id: row.id });
  return row;
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `adc-${role.toLowerCase()}-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
    passwordHash: 'test-only', role, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  return (await track(s.users, user)).id;
}

async function mkCustomer(name: string) {
  const [row] = await db.insert(s.customers).values({ name }).returning();
  return track(s.customers, row);
}

async function mkRoute(name: string) {
  const [row] = await db.insert(s.routes).values({ name }).returning();
  return track(s.routes, row);
}

async function mkLot(customerId: number, edd: string | null, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(s.shipments).values({
    customerId, expectedDeliveryDate: edd, cargoMode: 'FCL', status: 'PENDING_DATE', ...extra,
  }).returning();
  return track(s.shipments, row);
}

async function mkTrip(shipmentId: number, customerId: number, routeId: number) {
  const [row] = await db.insert(s.trips).values({
    shipmentId, customerId, routeId, status: 'CREATED', departureDate: '2026-09-20',
  }).returning();
  return track(s.trips, row);
}

/** Freight snapshot with SPLIT freight vs surcharge components (P1). */
async function mkFreight(shipmentId: number, tripId: number, freight: string, surcharge = '0') {
  const total = String(Number(freight) + Number(surcharge));
  const [row] = await db.insert(s.freightRateSnapshots).values({
    shipmentId, tripId,
    freightAmount: freight, surchargeAmount: surcharge, totalAmount: total,
    rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
    billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
  }).returning();
  return track(s.freightRateSnapshots, row);
}

async function mkOps(shipmentId: number, code: string, cost: string, charge: string | null, paidById: number) {
  const [row] = await db.insert(s.opsExpenseEntries).values({
    shipmentId, expenseTypeCode: code, amount: cost,
    customerChargeAmount: charge,
    paidById, paidAt: '2026-09-19',
  }).returning();
  return track(s.opsExpenseEntries, row);
}

async function mkExpense(tripId: number, buy: string, sell = '0', expenseType = 'PHI_CHI_HO') {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId, expenseType, buyAmount: buy, sellAmount: sell,
  }).returning();
  return track(s.tripExpenses, row);
}

async function mkCarrier(tripId: number, cost: string) {
  const [row] = await db.insert(s.tripCarrierInfo).values({
    tripId, carrierType: 'EXTERNAL', externalFreightCost: cost,
  }).returning();
  return track(s.tripCarrierInfo, row);
}

async function mkCostLock(shipmentId: number, userId: number) {
  const [row] = await db.insert(s.shipmentCostLocks).values({
    shipmentId, shipmentVersionAtLock: 1,
    costSnapshot: {}, lockedBy: userId,
  }).returning();
  return track(s.shipmentCostLocks, row);
}

async function mkRuRate(customerId: number, routeId: number, price: string, effectiveDate: string) {
  const [row] = await db.insert(s.pricingTables).values({
    customerId, routeId, price, rateKey: 'RU', effectiveDate,
  }).returning();
  return track(s.pricingTables, row);
}

describe('accounting debit-close board (card 20260921_21 CORE)', () => {
  test('worked numbers: full column ladder per lot — RU excluded from Tổng 1 (P1)', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`ADC W1 ${suffix}`);
    const route = await mkRoute(`ADC route W1 ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-25', { routeId: route.id });
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '1000000', '200000');
    await mkOps(lot.id, 'ZONE_SURCHARGE', '50000', '90000', userId);
    await mkOps(lot.id, 'QAC1-LIFT', '30000', null, userId);
    await mkExpense(trip.id, '100000', '500000', 'OTHER');
    await mkCarrier(trip.id, '400000');
    await mkRuRate(customer.id, route.id, '150000', '2026-09-01');
    const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    const row = result.items.find((r) => r.shipmentId === lot.id)!;
    assert.ok(row, 'row present in the September window');
    assert.equal(row.thu.cuocThu, '1000000');
    assert.equal(row.thu.lachHuyen, '90000', 'ops ZONE_SURCHARGE customerChargeAmount');
    assert.equal(row.thu.phuPs, '200000', 'snapshot surcharge component');
    assert.equal(row.thu.phatSinhCus, '500000', 'OTHER trip_expenses sell');
    assert.equal(row.thu.tongThu, '1790000');
    assert.equal(row.tra.cuocTraDv, '400000');
    assert.equal(row.tra.lachHuyenDv, '50000');
    assert.equal(row.tra.phatSinhDv, '30000', 'other ops cost only — zone rows stay out');
    assert.equal(row.tra.tong1, '480000', 'P1: RU NOT in Tổng 1');
    assert.equal(row.tra.phiRu, '150000');
    assert.equal(row.loiNhuan, '1160000', '1.790.000 − 480.000 − 150.000');
  });

  test('null propagation: a bare lot reads Chưa xác định everywhere', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`ADC N ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-26');
    await mkUser(Role.ADMIN); // keep user counter exercised; unused otherwise
    const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    const row = result.items.find((r) => r.shipmentId === lot.id)!;
    assert.ok(row);
    for (const cell of [
      row.thu.cuocThu, row.thu.lachHuyen, row.thu.phuPs, row.thu.phatSinhCus, row.thu.tongThu,
      row.tra.cuocTraDv, row.tra.lachHuyenDv, row.tra.phatSinhDv, row.tra.tong1, row.tra.phiRu,
      row.loiNhuan,
    ]) {
      assert.equal(cell, null, 'no data → null (Chưa xác định), never a fabricated 0');
    }
    assert.equal(row.adjustment.status, 'NONE');
  });

  test('partial-known: freight alone → tongThu known, RU absent → lợi nhuận null', async () => {
    const customer = await mkCustomer(`ADC P ${suffix}`);
    const route = await mkRoute(`ADC route P ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-27', { routeId: route.id });
    const trip = await mkTrip(lot.id, customer.id, lot.routeId ?? route.id);
    await mkFreight(lot.id, trip.id, '777000');
    const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    const row = result.items.find((r) => r.shipmentId === lot.id)!;
    assert.equal(row.thu.cuocThu, '777000');
    assert.equal(row.thu.tongThu, '777000', 'sum of the knowns when ANY is known');
    assert.equal(row.tra.phiRu, null, 'no RU rate row → Chưa xác định');
    assert.equal(row.loiNhuan, null, 'RU unknown → lợi nhuận unknown (P1 honest-null)');
  });

  test('RU pick: latest effectiveDate ≤ lot delivery date wins', async () => {
    const customer = await mkCustomer(`ADC RU ${suffix}`);
    const route = await mkRoute(`ADC route RU ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-27', { routeId: route.id });
    await mkRuRate(customer.id, route.id, '100000', '2026-09-01');
    await mkRuRate(customer.id, route.id, '200000', '2026-09-20');
    await mkRuRate(customer.id, route.id, '300000', '2026-10-01');
    const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    const row = result.items.find((r) => r.shipmentId === lot.id)!;
    assert.equal(row.tra.phiRu, '200000', 'effective 09-20 ≤ edd 09-27 wins over 09-01; 10-01 too late');
  });

  test('adjustment lifecycle: create → guard 409 → withdraw clears; re-create → confirm clears', async () => {
    const accountantId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`ADC A ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-28');
    const first = await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId });
    assert.deepEqual(first, { requested: [lot.id], alreadyPending: [], locked: [] });
    await assert.rejects(
      assertNoPendingRateAdjustment([lot.id]),
      /đang chờ đối soát cước/,
      '409 naming the lot in business language',
    );
    const wd = await withdrawRateAdjustmentRequests({ requestIds: [await livePendingId(lot.id)], userId: accountantId });
    assert.equal(wd.withdrawn, 1);
    await assert.doesNotReject(assertNoPendingRateAdjustment([lot.id]));
    const second = await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId });
    assert.deepEqual(second, { requested: [lot.id], alreadyPending: [], locked: [] });
    const cf = await confirmRateAdjustmentRequests({ requestIds: [await livePendingId(lot.id)], userId: accountantId });
    assert.equal(cf.confirmed, 1);
    await assert.doesNotReject(assertNoPendingRateAdjustment([lot.id]));
  });

  test('a withdrawn re-request unmasks the earlier CONFIRMED state on the board', async () => {
    const accountantId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`ADC W ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-28');
    await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId });
    await confirmRateAdjustmentRequests({ requestIds: [await livePendingId(lot.id)], userId: accountantId });
    await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId });
    await withdrawRateAdjustmentRequests({ requestIds: [await livePendingId(lot.id)], userId: accountantId });
    const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    const row = result.items.find((r) => r.shipmentId === lot.id)!;
    assert.equal(row.adjustment.status, 'CONFIRMED', 'latest non-withdrawn row is the confirmed one');
  });

  test('P2: a cost-locked lot rejects new requests and the export guard stays clear', async () => {
    const accountantId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`ADC L ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-29');
    await mkCostLock(lot.id, accountantId);
    const outcome = await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId });
    assert.deepEqual(outcome, { requested: [], alreadyPending: [], locked: [lot.id] }, 'lock wins — frozen thereafter');
    await assert.doesNotReject(assertNoPendingRateAdjustment([lot.id]));
    const noop = await confirmRateAdjustmentRequests({ requestIds: [999999], userId: accountantId });
    assert.equal(noop.confirmed, 0, 'transition guard: non-PENDING ids confirm nothing');
  });

  test('tick-all: confirming several pending requests in one call', async () => {
    const accountantId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`ADC T ${suffix}`);
    const lotA = await mkLot(customer.id, '2026-09-29');
    const lotB = await mkLot(customer.id, '2026-09-29');
    await createRateAdjustmentRequests({ shipmentIds: [lotA.id, lotB.id], userId: accountantId });
    const ids = [await livePendingId(lotA.id), await livePendingId(lotB.id)];
    const all = await confirmRateAdjustmentRequests({ requestIds: ids, userId: accountantId });
    assert.equal(all.confirmed, 2, 'tick-all = the ids from the visible pending rows');
    await assert.doesNotReject(assertNoPendingRateAdjustment([lotA.id, lotB.id]));
  });

  test('date range filter: lots outside the window stay off the board', async () => {
    const customer = await mkCustomer(`ADC D ${suffix}`);
    const lotSep = await mkLot(customer.id, '2026-09-10');
    const lotOct = await mkLot(customer.id, '2026-10-10');
    const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    const ids = result.items.map((r) => r.shipmentId);
    assert.ok(ids.includes(lotSep.id), 'September lot present');
    assert.ok(!ids.includes(lotOct.id), 'October lot absent');
  });
});

async function livePendingId(shipmentId: number): Promise<number> {
  const [row] = await db.select({ id: s.shipmentRateAdjustmentRequests.id })
    .from(s.shipmentRateAdjustmentRequests)
    .where(and(
      eq(s.shipmentRateAdjustmentRequests.shipmentId, shipmentId),
      eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'),
      isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
    ));
  assert.ok(row, `live PENDING request exists for lot ${shipmentId}`);
  return row.id;
}

after(async () => {
  try {
    for (const { table, id } of cleanup) {
      await db.delete(table).where(eq(table.id, id));
    }
  } catch { /* best-effort cleanup */ }
});

