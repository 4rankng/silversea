import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, isNull } from 'drizzle-orm';

import * as s from '../db/schema';
import type { Tx } from '../db';
import { withRollback } from './helpers/with-rollback';
import {
  getAccountingDebitBoard,
  createRateAdjustmentRequests,
  confirmRateAdjustmentRequests,
  withdrawRateAdjustmentRequests,
  assertNoPendingRateAdjustment,
} from '../services/accounting-debit-close.service';
import { Role } from '@tingting/shared';

// Rollback-per-test (card 20260930_225): every test seeds and asserts inside
// one transaction that is always rolled back, so nothing commits and there is
// no cleanup table to leak on a crashed run. The run tag below only guards
// unique keys against a CONCURRENT run of this suite (two open transactions
// still collide on unique indexes); it is no longer residue hygiene.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkUser(tx: Tx, role: Role) {
  const [user] = await tx.insert(s.users).values({
    username: `adc-${role.toLowerCase()}-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
    passwordHash: 'test-only', role, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  return user.id;
}

// Seeder discipline (88b5d2d0): display names carry a unique-index-safe
// human ordinal — never an <epoch-ms>-<rand> fragment that would re-expose
// the id leak once the sanitiser is gone. Usernames keep their run tags.
let nameOrdinal = 0;
async function mkCustomer(tx: Tx, base: string) {
  nameOrdinal += 1;
  const [row] = await tx.insert(s.customers).values({ name: `${base} ${nameOrdinal}` }).returning();
  return row;
}

async function mkRoute(tx: Tx, base: string) {
  const ordinal = ++nameOrdinal;
  const [row] = await tx.insert(s.routes).values({ name: `${base} ${ordinal}` }).returning();
  return row;
}

async function mkLot(tx: Tx, customerId: number, edd: string | null, extra: Record<string, unknown> = {}) {
  const [row] = await tx.insert(s.shipments).values({
    customerId, expectedDeliveryDate: edd, cargoMode: 'FCL', status: 'PENDING_DATE', ...extra,
  }).returning();
  return row;
}

async function mkTrip(tx: Tx, shipmentId: number, customerId: number, routeId: number) {
  const [row] = await tx.insert(s.trips).values({
    shipmentId, customerId, routeId, status: 'CREATED', departureDate: '2026-09-20',
  }).returning();
  return row;
}

/** Freight snapshot with SPLIT freight vs surcharge components (P1). */
async function mkFreight(tx: Tx, shipmentId: number, tripId: number, freight: string, surcharge = '0') {
  const total = String(Number(freight) + Number(surcharge));
  const [row] = await tx.insert(s.freightRateSnapshots).values({
    shipmentId, tripId,
    freightAmount: freight, surchargeAmount: surcharge, totalAmount: total,
    rateTermsId: 1, pricingTableId: 1, fuelNormId: 1, fuelPricePeriodId: 1,
    billedKm: '10', liters: '0', fuelDelta: '0', sharePct: '0',
  }).returning();
  return row;
}

async function mkOps(tx: Tx, shipmentId: number, code: string, cost: string, charge: string | null, paidById: number) {
  const [row] = await tx.insert(s.opsExpenseEntries).values({
    shipmentId, expenseTypeCode: code, amount: cost,
    customerChargeAmount: charge,
    paidById, paidAt: '2026-09-19',
  }).returning();
  return row;
}

async function mkExpense(tx: Tx, tripId: number, buy: string, sell = '0', expenseType = 'PHI_CHI_HO') {
  const [row] = await tx.insert(s.tripExpenses).values({
    tripId, expenseType, buyAmount: buy, sellAmount: sell,
  }).returning();
  return row;
}

async function mkCarrier(tx: Tx, tripId: number, cost: string) {
  const [row] = await tx.insert(s.tripCarrierInfo).values({
    tripId, carrierType: 'EXTERNAL', externalFreightCost: cost,
  }).returning();
  return row;
}

async function mkCostLock(tx: Tx, shipmentId: number, userId: number) {
  const [row] = await tx.insert(s.shipmentCostLocks).values({
    shipmentId, shipmentVersionAtLock: 1,
    costSnapshot: {}, lockedBy: userId,
  }).returning();
  return row;
}

async function mkRuRate(tx: Tx, customerId: number, routeId: number, price: string, effectiveDate: string) {
  const [row] = await tx.insert(s.pricingTables).values({
    customerId, routeId, price, rateKey: 'RU', effectiveDate,
  }).returning();
  return row;
}

describe('accounting debit-close board (card 20260921_21 CORE)', () => {
  test('worked numbers: full column ladder per lot — RU excluded from Tổng 1 (P1)', async () => {
    await withRollback(async (tx) => {
      const userId = await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC W1');
      const route = await mkRoute(tx, 'ADC route W1');
      const lot = await mkLot(tx, customer.id, '2026-09-25', { routeId: route.id });
      const trip = await mkTrip(tx, lot.id, customer.id, route.id);
      await mkFreight(tx, lot.id, trip.id, '1000000', '200000');
      await mkOps(tx, lot.id, 'ZONE_SURCHARGE', '50000', '90000', userId);
      await mkOps(tx, lot.id, 'QAC1-LIFT', '30000', null, userId);
      await mkExpense(tx, trip.id, '100000', '500000', 'OTHER');
      await mkCarrier(tx, trip.id, '400000');
      await mkRuRate(tx, customer.id, route.id, '150000', '2026-09-01');
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
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
  });

  test('null propagation: a bare lot reads Chưa xác định everywhere', async () => {
    await withRollback(async (tx) => {
      await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC N');
      const lot = await mkLot(tx, customer.id, '2026-09-26');
      await mkUser(tx, Role.ADMIN); // keep user counter exercised; unused otherwise
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
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
  });

  test('partial-known: freight alone → tongThu known, RU absent → lợi nhuận null', async () => {
    await withRollback(async (tx) => {
      const customer = await mkCustomer(tx, 'ADC P');
      const route = await mkRoute(tx, 'ADC route P');
      const lot = await mkLot(tx, customer.id, '2026-09-27', { routeId: route.id });
      const trip = await mkTrip(tx, lot.id, customer.id, lot.routeId ?? route.id);
      await mkFreight(tx, lot.id, trip.id, '777000');
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const row = result.items.find((r) => r.shipmentId === lot.id)!;
      assert.equal(row.thu.cuocThu, '777000');
      assert.equal(row.thu.tongThu, '777000', 'sum of the knowns when ANY is known');
      assert.equal(row.tra.phiRu, null, 'no RU rate row → Chưa xác định');
      assert.equal(row.loiNhuan, null, 'RU unknown → lợi nhuận unknown (P1 honest-null)');
    });
  });

  test('RU pick: latest effectiveDate ≤ lot delivery date wins', async () => {
    await withRollback(async (tx) => {
      const customer = await mkCustomer(tx, 'ADC RU');
      const route = await mkRoute(tx, 'ADC route RU');
      const lot = await mkLot(tx, customer.id, '2026-09-27', { routeId: route.id });
      await mkRuRate(tx, customer.id, route.id, '100000', '2026-09-01');
      await mkRuRate(tx, customer.id, route.id, '200000', '2026-09-20');
      await mkRuRate(tx, customer.id, route.id, '300000', '2026-10-01');
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const row = result.items.find((r) => r.shipmentId === lot.id)!;
      assert.equal(row.tra.phiRu, '200000', 'effective 09-20 ≤ edd 09-27 wins over 09-01; 10-01 too late');
    });
  });

  test('adjustment lifecycle: create → guard 409 → withdraw clears; re-create → confirm clears', async () => {
    await withRollback(async (tx) => {
      const accountantId = await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC A');
      const lot = await mkLot(tx, customer.id, '2026-09-28');
      const first = await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId }, tx);
      assert.deepEqual(first, { requested: [lot.id], alreadyPending: [], locked: [] });
      await assert.rejects(
        assertNoPendingRateAdjustment([lot.id], tx),
        /đang chờ đối soát cước/,
        '409 naming the lot in business language',
      );
      const wd = await withdrawRateAdjustmentRequests({ requestIds: [await livePendingId(tx, lot.id)], userId: accountantId }, tx);
      assert.equal(wd.withdrawn, 1);
      await assert.doesNotReject(assertNoPendingRateAdjustment([lot.id], tx));
      const second = await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId }, tx);
      assert.deepEqual(second, { requested: [lot.id], alreadyPending: [], locked: [] });
      const cf = await confirmRateAdjustmentRequests({ requestIds: [await livePendingId(tx, lot.id)], userId: accountantId }, tx);
      assert.equal(cf.confirmed, 1);
      await assert.doesNotReject(assertNoPendingRateAdjustment([lot.id], tx));
    });
  });

  test('a withdrawn re-request unmasks the earlier CONFIRMED state on the board', async () => {
    await withRollback(async (tx) => {
      const accountantId = await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC W');
      const lot = await mkLot(tx, customer.id, '2026-09-28');
      await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId }, tx);
      await confirmRateAdjustmentRequests({ requestIds: [await livePendingId(tx, lot.id)], userId: accountantId }, tx);
      await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId }, tx);
      await withdrawRateAdjustmentRequests({ requestIds: [await livePendingId(tx, lot.id)], userId: accountantId }, tx);
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const row = result.items.find((r) => r.shipmentId === lot.id)!;
      assert.equal(row.adjustment.status, 'CONFIRMED', 'latest non-withdrawn row is the confirmed one');
    });
  });

  test('P2: a cost-locked lot rejects new requests and the export guard stays clear', async () => {
    await withRollback(async (tx) => {
      const accountantId = await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC L');
      const lot = await mkLot(tx, customer.id, '2026-09-29');
      await mkCostLock(tx, lot.id, accountantId);
      const outcome = await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId: accountantId }, tx);
      assert.deepEqual(outcome, { requested: [], alreadyPending: [], locked: [lot.id] }, 'lock wins — frozen thereafter');
      await assert.doesNotReject(assertNoPendingRateAdjustment([lot.id], tx));
      const noop = await confirmRateAdjustmentRequests({ requestIds: [999999], userId: accountantId }, tx);
      assert.equal(noop.confirmed, 0, 'transition guard: non-PENDING ids confirm nothing');
    });
  });

  test('tick-all: confirming several pending requests in one call', async () => {
    await withRollback(async (tx) => {
      const accountantId = await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC T');
      const lotA = await mkLot(tx, customer.id, '2026-09-29');
      const lotB = await mkLot(tx, customer.id, '2026-09-29');
      await createRateAdjustmentRequests({ shipmentIds: [lotA.id, lotB.id], userId: accountantId }, tx);
      const ids = [await livePendingId(tx, lotA.id), await livePendingId(tx, lotB.id)];
      const all = await confirmRateAdjustmentRequests({ requestIds: ids, userId: accountantId }, tx);
      assert.equal(all.confirmed, 2, 'tick-all = the ids from the visible pending rows');
      await assert.doesNotReject(assertNoPendingRateAdjustment([lotA.id, lotB.id], tx));
    });
  });

  test('date range filter: lots outside the window stay off the board', async () => {
    await withRollback(async (tx) => {
      const customer = await mkCustomer(tx, 'ADC D');
      const lotSep = await mkLot(tx, customer.id, '2026-09-10');
      const lotOct = await mkLot(tx, customer.id, '2026-10-10');
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const ids = result.items.map((r) => r.shipmentId);
      assert.ok(ids.includes(lotSep.id), 'September lot present');
      assert.ok(!ids.includes(lotOct.id), 'October lot absent');
    });
  });

  // Card 20260928_162 criterion 3 (lead ruling (b)). The reason an uncharged Ops
  // cost is REQUIRED to carry is enforced server-side; this pins that kế toán can
  // actually READ it on the board whose title matches the card verbatim. Before
  // this, the column was hardcoded null, so the mandatory reason reached nobody.
  test('card 20260928_162: the uncharged reason reaches kế toán on this board', async () => {
    await withRollback(async (tx) => {
      const userId = await mkUser(tx, Role.ACCOUNTANT);
      const customer = await mkCustomer(tx, 'ADC 162');
      const route = await mkRoute(tx, 'ADC 162 route');
      const lot = await mkLot(tx, customer.id, '2026-09-26', { routeId: route.id });
      const reason = 'Chi nội bộ, không thu khách';
      await tx.insert(s.opsExpenseEntries).values({
        shipmentId: lot.id, expenseTypeCode: 'OTHER', amount: '20000',
        customerChargeAmount: '0', paidById: userId, paidAt: '2026-09-19', note: reason,
      }).returning();

      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const row = result.items.find((r) => r.shipmentId === lot.id)!;
      assert.ok(row, 'row present in the September window');
      assert.equal(row.ghiChu, reason, 'the mandatory reason must be readable on this board');
      // Standing ruling of the shared projection: the AMOUNT never enters it.
      assert.ok(!row.ghiChu!.includes('20000'), 'no amount in the note column');

      // A charged row keeps its own behaviour — it surfaces by FEE NAME (card
      // 20260921_5), so reusing the projection here must not change that.
      await tx.insert(s.opsExpenseEntries).values({
        shipmentId: lot.id, expenseTypeCode: 'OTHER', amount: '40000',
        customerChargeAmount: '60000', paidById: userId, paidAt: '2026-09-19', feeName: 'Phí xe nâng QA',
      }).returning();
      const withCharged = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const row2 = withCharged.items.find((r) => r.shipmentId === lot.id)!;
      assert.ok(
        row2.ghiChu?.includes('Thu khách: Phí xe nâng QA'),
        `a charged no-invoice fee still surfaces by fee name; got ${JSON.stringify(row2.ghiChu)}`,
      );
      assert.ok(!row2.ghiChu!.includes('40000') && !row2.ghiChu!.includes('60000'), 'no amounts in the note column');
    });
  });
});

async function livePendingId(tx: Tx, shipmentId: number): Promise<number> {
  const [row] = await tx.select({ id: s.shipmentRateAdjustmentRequests.id })
    .from(s.shipmentRateAdjustmentRequests)
    .where(and(
      eq(s.shipmentRateAdjustmentRequests.shipmentId, shipmentId),
      eq(s.shipmentRateAdjustmentRequests.status, 'PENDING'),
      isNull(s.shipmentRateAdjustmentRequests.withdrawnAt),
    ));
  assert.ok(row, `live PENDING request exists for lot ${shipmentId}`);
  return row.id;
}



describe('accounting debit board rows — customer + carrier keys (card 20260923_12)', () => {
  test('rows carry customerId + derived carrierKeys (own, subcontracted, external plate)', async () => {
    await withRollback(async (tx) => {
      const customer = await mkCustomer(tx, `ADC CK ${suffix}`);
      const carrier = await mkCustomer(tx, `ADC carrier CK ${suffix}`);
      const route = await mkRoute(tx, `ADC route CK ${suffix}`);
      const lotOwn = await mkLot(tx, customer.id, '2026-09-21', { routeId: route.id });
      const lotC = await mkLot(tx, customer.id, '2026-09-21', { routeId: route.id });
      const lotPlate = await mkLot(tx, customer.id, '2026-09-21', { routeId: route.id });
      const lotBare = await mkLot(tx, customer.id, '2026-09-21', { routeId: route.id });
      const plate = `ADC-OWN-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const [truckOwn] = await tx.insert(s.trucks).values({ licensePlate: plate, carrierId: null }).returning();
      const plateC = `ADC-CUS-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const [truckC] = await tx.insert(s.trucks).values({ licensePlate: plateC, carrierId: carrier.id }).returning();
      const tripOwn = await mkTrip(tx, lotOwn.id, customer.id, route.id);
      await tx.update(s.trips).set({ truckId: truckOwn.id }).where(eq(s.trips.id, tripOwn.id));
      const tripC = await mkTrip(tx, lotC.id, customer.id, route.id);
      await tx.update(s.trips).set({ truckId: truckC.id }).where(eq(s.trips.id, tripC.id));
      const tripPlate = await mkTrip(tx, lotPlate.id, customer.id, route.id);
      await tx.insert(s.tripCarrierInfo).values({ tripId: tripPlate.id, carrierType: 'EXTERNAL', externalPlateNumber: 'ab-12-x9' }).returning();
      const result = await getAccountingDebitBoard({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }, tx);
      const rowOwn = result.items.find((r) => r.shipmentId === lotOwn.id)!;
      const rowC = result.items.find((r) => r.shipmentId === lotC.id)!;
      const rowPlate = result.items.find((r) => r.shipmentId === lotPlate.id)!;
      const rowBare = result.items.find((r) => r.shipmentId === lotBare.id)!;
      assert.deepEqual(rowOwn.carrierKeys, ['OWN']);
      assert.deepEqual(rowC.carrierKeys, [`CUST:${carrier.id}`]);
      assert.deepEqual(rowPlate.carrierKeys, ['PLATE:AB-12-X9']);
      assert.deepEqual(rowBare.carrierKeys, []);
      assert.equal(rowOwn.customerId, customer.id);
      assert.equal(rowC.customerId, customer.id);
    });
  });
});
