import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import {
  createDebitSettlementRound,
  listDebitSettlementRounds,
} from '../services/debit-settlement-rounds.service';
import { createRateAdjustmentRequests } from '../services/accounting-debit-close.service';
import { ApiError } from '../errors';
import { Role } from '@tingting/shared';

const suffix = `dsr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
async function track<T extends { id: number }>(table: any, row: T): Promise<T> {
  cleanup.unshift({ table, id: row.id });
  return row;
}

async function mkUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `dsr-${role.toLowerCase()}-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
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

async function mkTrip(shipmentId: number, customerId: number, routeId: number, truckId: number | null = null) {
  const [row] = await db.insert(s.trips).values({
    shipmentId, customerId, routeId, status: 'CREATED', departureDate: '2026-09-20', truckId,
  }).returning();
  return track(s.trips, row);
}

async function mkTruck(carrierId: number | null) {
  const [row] = await db.insert(s.trucks).values({
    licensePlate: `DSR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    carrierId,
  }).returning();
  return track(s.trucks, row);
}

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

async function mkCarrierCost(tripId: number, value: string) {
  const [row] = await db.insert(s.tripCarrierInfo).values({
    tripId, carrierType: 'EXTERNAL', externalFreightCost: value,
  }).returning();
  return track(s.tripCarrierInfo, row);
}

async function mkExternalCarrierInfo(tripId: number, opts: { entityId?: number; entityType?: string; plate?: string }) {
  const [row] = await db.insert(s.tripCarrierInfo).values({
    tripId, carrierType: 'EXTERNAL',
    externalEntityId: opts.entityId ?? null,
    externalEntityType: opts.entityType ?? null,
    externalPlateNumber: opts.plate ?? null,
  }).returning();
  return track(s.tripCarrierInfo, row);
}

/** ApiError with statusCode 400 and a business-language message matching `pattern`. */
function rejects400(promise: Promise<unknown>, pattern: RegExp, note: string) {
  return assert.rejects(promise, (error: any) => {
    assert.ok(error instanceof ApiError, `${note}: expected ApiError, got ${error?.constructor?.name}`);
    assert.equal(error.statusCode, 400, note);
    assert.match(error.message, pattern);
    return true;
  });
}

describe('debit settlement rounds (card 20260923_12 Chọn Debit)', () => {
  test('happy THU: amount=Σ tổng thu, VAT+ghiChu persisted, lots attached, GET carries labels+math', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR THU ${suffix}`);
    const route = await mkRoute(`DSR route THU ${suffix}`);
    const truck = await mkTruck(null); // own fleet
    const carrierC = await mkCustomer(`DSR carrier C ${suffix}`);
    const lotA = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const lotB = await mkLot(customer.id, '2026-09-22', { routeId: route.id });
    const tripA = await mkTrip(lotA.id, customer.id, route.id, truck.id);
    const tripB = await mkTrip(lotB.id, customer.id, route.id, truck.id);
    await mkFreight(lotA.id, tripA.id, '1000000', '200000'); // tổng thu 1.200.000
    await mkFreight(lotB.id, tripB.id, '500000');            // tổng thu 500.000
    const created = await createDebitSettlementRound({
      shipmentIds: [lotA.id, lotB.id],
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      roundNo: 1, month: 9, year: 2026,
      direction: 'THU', vatRate: 8, ghiChu: 'đợt tháng 9',
      userId,
    });
    assert.equal(created.direction, 'THU');
    assert.equal(created.roundNo, 1);
    assert.equal(created.periodKey, '2026-09');
    assert.equal(created.amount, '1700000'); // Σ tổng thu
    assert.equal(created.lotCount, 2);
    assert.equal(created.carrierKey, 'OWN');
    const [roundRow] = await db.select().from(s.debitSettlementRounds)
      .where(eq(s.debitSettlementRounds.id, created.id));
    assert.equal(roundRow.vatRate, 8);
    assert.equal(roundRow.ghiChu, 'đợt tháng 9');
    const listed = await listDebitSettlementRounds();
    const row = listed.items.find((r) => r.id === created.id)!;
    assert.equal(row.customerName, customer.name);
    assert.equal(row.carrierLabel, 'Xe công ty');
    assert.equal(row.vatAmount, 136000);    // 1.700.000 × 8%
    assert.equal(row.totalAmount, 1836000); // amount + VAT
    // second THU lần in the same month spanning two carriers → MIXED, allowed
    const truckX = await mkTruck(null);
    const truckY = await mkTruck(carrierC.id);
    const lotX = await mkLot(customer.id, '2026-09-23', { routeId: route.id });
    const lotY = await mkLot(customer.id, '2026-09-23', { routeId: route.id });
    const tripX = await mkTrip(lotX.id, customer.id, route.id, truckX.id);
    const tripY = await mkTrip(lotY.id, customer.id, route.id, truckY.id);
    await mkFreight(lotX.id, tripX.id, '60000');
    await mkFreight(lotY.id, tripY.id, '40000');
    const second = await createDebitSettlementRound({
      shipmentIds: [lotX.id, lotY.id],
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      roundNo: 2, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId,
    });
    assert.equal(second.carrierKey, 'MIXED');
    assert.equal(second.amount, '100000'); // 60.000 + 40.000
    assert.equal(second.lotCount, 2);
  });

  test('happy TRA subcontracted: amount=Σ Tổng 1, carrier = the truck owner', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR TRA ${suffix}`);
    const route = await mkRoute(`DSR route TRA ${suffix}`);
    const carrier = await mkCustomer(`DSR carrier TRA ${suffix}`);
    const truck = await mkTruck(carrier.id);
    const lot = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const trip = await mkTrip(lot.id, customer.id, route.id, truck.id);
    await mkCarrierCost(trip.id, '400000'); // cước trả ĐV → Tổng 1 = 400.000
    const created = await createDebitSettlementRound({
      shipmentIds: [lot.id],
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      roundNo: 1, month: 9, year: 2026, direction: 'TRA', vatRate: 5, userId,
    });
    assert.equal(created.amount, '400000'); // Σ Tổng 1
    assert.equal(created.carrierKey, `CUST:${carrier.id}`);
    const listed = await listDebitSettlementRounds();
    const row = listed.items.find((r) => r.id === created.id);
    assert.equal(row?.carrierLabel, carrier.name);
  });

  test('happy TRA external plate-only carrier: PLATE key + plate label', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR PLATE ${suffix}`);
    const route = await mkRoute(`DSR route PLATE ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const trip = await mkTrip(lot.id, customer.id, route.id);
    // trip_carrier_info is 1:1 per trip — one row carrying BOTH the plate and the cost
    const [info] = await db.insert(s.tripCarrierInfo).values({
      tripId: trip.id, carrierType: 'EXTERNAL',
      externalPlateNumber: 'xx-abc-1234', externalFreightCost: '250000',
    }).returning();
    cleanup.unshift({ table: s.tripCarrierInfo, id: info.id });
    const created = await createDebitSettlementRound({
      shipmentIds: [lot.id],
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      roundNo: 1, month: 9, year: 2026, direction: 'TRA', vatRate: 0, userId,
    });
    assert.equal(created.carrierKey, 'PLATE:XX-ABC-1234');
    const listed = await listDebitSettlementRounds();
    const row = listed.items.find((r) => r.id === created.id);
    assert.equal(row?.carrierLabel, 'XX-ABC-1234');
  });

  test('THU with a carrier-less lot is allowed (chốt với khách hàng không cần nhà xe)', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR NCL ${suffix}`);
    const route = await mkRoute(`DSR route NCL ${suffix}`);
    const lot = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    // trip without truck and without any carrier info → no nhà xe identity
    const trip = await mkTrip(lot.id, customer.id, route.id);
    await mkFreight(lot.id, trip.id, '300000');
    const created = await createDebitSettlementRound({
      shipmentIds: [lot.id],
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId,
    });
    assert.equal(created.carrierKey, 'MIXED');
    assert.equal(created.amount, '300000');
  });

  test('guard: mixed customers → 400', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const custA = await mkCustomer(`DSR X1 ${suffix}`);
    const custB = await mkCustomer(`DSR X2 ${suffix}`);
    const route = await mkRoute(`DSR route X ${suffix}`);
    const truck = await mkTruck(null);
    const lotA = await mkLot(custA.id, '2026-09-21', { routeId: route.id });
    const lotB = await mkLot(custB.id, '2026-09-21', { routeId: route.id });
    await mkTrip(lotA.id, custA.id, route.id, truck.id);
    await mkTrip(lotB.id, custB.id, route.id, truck.id);
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lotA.id, lotB.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      /cùng một khách hàng/,
      'mixed customers 400',
    );
  });

  test('guard: lot EDD outside the popup range → 400', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR R ${suffix}`);
    const route = await mkRoute(`DSR route R ${suffix}`);
    const truck = await mkTruck(null);
    const lot = await mkLot(customer.id, '2026-08-20', { routeId: route.id }); // outside the Sep range
    const trip = await mkTrip(lot.id, customer.id, route.id, truck.id);
    (void trip);
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lot.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      /ngoài khoảng/,
      'edd outside range 400',
    );
  });

  test('guard: null EDD → 400', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR ND ${suffix}`);
    const route = await mkRoute(`DSR route ND ${suffix}`);
    const truck = await mkTruck(null);
    const lot = await mkLot(customer.id, null);
    const trip = await mkTrip(lot.id, customer.id, route.id, truck.id);
    (void trip);
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lot.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      /chưa có ngày giao/,
      'null EDD 400',
    );
  });

  test('guard: VAT outside 0/5/8/10 → 400', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR V ${suffix}`);
    const route = await mkRoute(`DSR route V ${suffix}`);
    const truck = await mkTruck(null);
    const lot = await mkLot(customer.id, '2026-09-21');
    const trip = await mkTrip(lot.id, customer.id, route.id, truck.id);
    (void trip);
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lot.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 7, userId }),
      /VAT/,
      'invalid VAT 400',
    );
  });

  test('guard: duplicate lần for (customer, month, direction) → 400', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR DUP ${suffix}`);
    const route = await mkRoute(`DSR route DUP ${suffix}`);
    const truck = await mkTruck(null);
    const lotA = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const lotB = await mkLot(customer.id, '2026-09-22', { routeId: route.id });
    const tripA = await mkTrip(lotA.id, customer.id, route.id, truck.id);
    const tripB = await mkTrip(lotB.id, customer.id, route.id, truck.id);
    await mkFreight(lotA.id, tripA.id, '100000');
    await mkFreight(lotB.id, tripB.id, '200000');
    await createDebitSettlementRound({ shipmentIds: [lotA.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId });
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lotB.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      /đã chốt/,
      'duplicate lần 400',
    );
  });

  test('guard: lot-overlap → 400 (lot already in a round)', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR O ${suffix}`);
    const route = await mkRoute(`DSR route O ${suffix}`);
    const truck = await mkTruck(null);
    const lotA = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const lotB = await mkLot(customer.id, '2026-09-22', { routeId: route.id });
    const tripA = await mkTrip(lotA.id, customer.id, route.id, truck.id);
    const tripB = await mkTrip(lotB.id, customer.id, route.id, truck.id);
    await mkFreight(lotA.id, tripA.id, '100000');
    await mkFreight(lotB.id, tripB.id, '200000');
    await createDebitSettlementRound({ shipmentIds: [lotA.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId });
    // lần 2 attempt reusing lotA → overlap guard
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lotA.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 2, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      /đã thuộc một đợt chốt/,
      'lot overlap 400',
    );
  });

  test('guard: TRA with mixed carriers → 400', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR TM ${suffix}`);
    const carrier = await mkCustomer(`DSR carrier TM ${suffix}`);
    const route = await mkRoute(`DSR route TM ${suffix}`);
    const truckOwn = await mkTruck(null);
    const truckC = await mkTruck(carrier.id);
    const lotA = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const lotB = await mkLot(customer.id, '2026-09-22', { routeId: route.id });
    await mkTrip(lotA.id, customer.id, route.id, truckOwn.id);
    await mkTrip(lotB.id, customer.id, route.id, truckC.id);
    await rejects400(
      createDebitSettlementRound({ shipmentIds: [lotA.id, lotB.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'TRA', vatRate: 0, userId }),
      /một nhà xe/,
      'TRA mixed carriers 400',
    );
  });

  test('409 guard: pending rate adjustment on a selected lot blocks chốt', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    const customer = await mkCustomer(`DSR 409 ${suffix}`);
    const route = await mkRoute(`DSR route 409 ${suffix}`);
    const truck = await mkTruck(null);
    const lot = await mkLot(customer.id, '2026-09-21', { routeId: route.id });
    const trip = await mkTrip(lot.id, customer.id, route.id, truck.id);
    (void trip);
    await createRateAdjustmentRequests({ shipmentIds: [lot.id], userId });
    await assert.rejects(
      createDebitSettlementRound({ shipmentIds: [lot.id], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      (error: any) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 409);
        assert.match(error.message, /đang chờ đối soát cước/);
        return true;
      },
      '409 pending adjustment',
    );
  });

  test('missing lot → 404', async () => {
    const userId = await mkUser(Role.ACCOUNTANT);
    await assert.rejects(
      createDebitSettlementRound({ shipmentIds: [999999999], dateFrom: '2026-09-01', dateTo: '2026-09-30', roundNo: 1, month: 9, year: 2026, direction: 'THU', vatRate: 0, userId }),
      (error: any) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.statusCode, 404);
        assert.match(error.message, /không tồn tại/);
        return true;
      },
      'missing lot 404',
    );
  });
});

after(async () => {
  try {
    // the 409 test's rate-adjustment rows reference tracked shipments — clear them first
    const trackedShipmentIds = cleanup.filter((c) => c.table === s.shipments).map((c) => c.id);
    if (trackedShipmentIds.length > 0) {
      await db.delete(s.shipmentRateAdjustmentRequests).where(inArray(s.shipmentRateAdjustmentRequests.shipmentId, trackedShipmentIds));
    }
    const roundIds = (await db.select({ id: s.debitSettlementRounds.id })
      .from(s.debitSettlementRounds)).map((r) => r.id);
    if (roundIds.length > 0) {
      await db.delete(s.debitSettlementRoundLots).where(inArray(s.debitSettlementRoundLots.roundId, roundIds));
      await db.delete(s.debitSettlementRounds).where(inArray(s.debitSettlementRounds.id, roundIds));
  }
  } catch { /* best-effort cleanup */ }
  for (const { table, id } of cleanup) {
    await db.delete(table).where(eq(table.id, id));
  }
});
