/**
 * Card 20260921_7 — driver road/allowance fee norms (định mức) as CONFIG DATA.
 * Service-level suite, card6 mold; fixtures prefix `card7-`/`CARD7-`, local DB
 * :5441 only, announced.
 *
 * Coverage:
 *   Seeds: 8 norms ACTIVE with the customer's amounts, all cost_group
 *       DRIVER_ROAD.
 *   AC1 norm entry never charges: client-sent invoice number dropped, charge
 *       0, costType/costGroup from the norm, feeName = norm label; registry
 *       row carries the norm classification via the owner row.
 *   AC3 driver override: amount differing from the norm accepted as-is.
 *   Guard: unknown norm code 400; catalog ref + norm ref together 400.
 *   AC2 data source: listActiveDriverFeeNorms returns the norms for the FE.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { recordIncidentalCost, listActiveDriverFeeNorms } from '../services/driver.service';
import { getExpenseAccountingCatalog } from '../services/expense-accounting-reads.service';
import { ApiError } from '../errors';
import { DriverIncidentalCostType, Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkDriverTrip() {
  const [u] = await db.insert(s.users).values({
    username: `card7-${suffix}-${cleanup.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  const [d] = await db.insert(s.drivers).values({ name: `card7 driver ${suffix}-${cleanup.length}`, userId: u.id }).returning();
  track(async () => { await db.delete(s.drivers).where(eq(s.drivers.id, d.id)); });
  const [customer] = await db.insert(s.customers).values({ name: `card7 cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card7 route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `card7 cargo ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `CARD7-${suffix}-${cleanup.length}`.slice(0, 50),
    driverId: d.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT', departureDate: TODAY,
  }).returning();
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return { user: u, driver: d, shipment, trip };
}

describe('card 20260921_7 - driver fee norms', () => {
  test('norms ship seeded: 8 rows, customer amounts, road bucket (AC2 data)', async () => {
    const expected: ReadonlyArray<[string, string]> = [
      ['LIFT_DROP_ALLOWANCE', '50000'], ['NIGHT_RETURN', '100000'], ['TURNAROUND', '100000'],
      ['OVERLOAD', '200000'], ['ICD_RELOCATION', '200000'], ['SUNDAY', '200000'],
      ['SHIFT', '200000'], ['SPECIAL_CONTAINER', '200000'],
    ];
    const rows = await db.select().from(s.driverFeeNorms)
      .where(inArray(s.driverFeeNorms.code, expected.map(([code]) => code)));
    assert.equal(rows.length, expected.length);
    for (const [code, amount] of expected) {
      const row = rows.find((r) => r.code === code);
      assert.ok(row, `missing norm ${code}`);
      assert.equal(row.amount, amount, `${code} wrong amount`);
      assert.equal(row.costGroup, 'DRIVER_ROAD', `${code} must be road bucket`);
      assert.equal(row.status, 'ACTIVE', `${code} must be ACTIVE`);
    }
  });

  test('norm entry pins the road bucket and drops customer charge (AC1)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, feeNormCode: 'LIFT_DROP_ALLOWANCE',
      amount: 50000, occurredAt: TODAY, invoiceNumber: 'card7-HD-must-drop', invoiceDate: TODAY,
    }, user.id, `card7-key-${suffix}-norm`);
    track(async () => {
      await db.delete(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), eq(s.expenseAccountingSources.sourceId, cost.id)));
      await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    });
    assert.equal(cost.costType, 'LIFT_DROP_ZONE');
    const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(entryRow.costGroup, 'DRIVER_ROAD');
    assert.equal(entryRow.customerChargeAmount, '0');
    assert.equal(entryRow.invoiceNumber, null);
    assert.equal(entryRow.feeName, 'Phụ cấp nâng/hạ Lạch Huyện, TIL, Hateco');
    assert.equal(entryRow.feeNormCode, 'LIFT_DROP_ALLOWANCE');
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, cost.id)));
    track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
    assert.ok(source, 'registry row exists for shipment-linked trip');
  });

  test('driver may override the amount away from the norm (AC3)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, feeNormCode: 'LIFT_DROP_ALLOWANCE',
      amount: 120000, occurredAt: TODAY,
    }, user.id, `card7-key-${suffix}-override`);
    track(async () => {
      await db.delete(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), eq(s.expenseAccountingSources.sourceId, cost.id)));
      await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    });
    assert.equal(String(cost.amount), '120000');
    const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(entryRow.customerChargeAmount, '0');
  });
});

describe('card 20260921_7 - guards', () => {
  test('unknown norm code rejected (400)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, feeNormCode: 'CARD7_NOPE_404',
      amount: 50000, occurredAt: TODAY,
    }, user.id, `card7-key-${suffix}-unknown`).then(
      () => { throw new Error('expected 400 rejection'); },
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
        assert.equal((err as ApiError).statusCode, 400);
        assert.match((err as ApiError).message, /Định mức/);
      },
    );
  });

  test('norm ref and catalog ref are mutually exclusive (400)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, feeNormCode: 'LIFT_DROP_ALLOWANCE',
      expenseTypeCode: 'SANITATION', amount: 50000, occurredAt: TODAY,
    }, user.id, `card7-key-${suffix}-both`).then(
      () => { throw new Error('expected 400 rejection'); },
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
        assert.equal((err as ApiError).statusCode, 400);
        assert.match((err as ApiError).message, /Chỉ chọn một/);
      },
    );
  });

  test('accounting suggestions use active configured labels and numeric amounts', async () => {
    const code = `custom-${suffix}`.slice(0, 50);
    const [norm] = await db.insert(s.driverFeeNorms).values({ code, label: 'Phụ cấp bãi cấu hình mới', amount: '73000', costType: 'OTHER', costGroup: 'DRIVER_ROAD', status: 'ACTIVE' }).returning();
    track(async () => { await db.delete(s.driverFeeNorms).where(eq(s.driverFeeNorms.id, norm.id)); });
    const active = await getExpenseAccountingCatalog({ userId: 1, role: Role.DRIVER });
    assert.deepEqual(active.driverCostSuggestions.find(item => item.code === code), { code, label: 'Phụ cấp bãi cấu hình mới', amount: 73000 });
    await db.update(s.driverFeeNorms).set({ status: 'INACTIVE' }).where(eq(s.driverFeeNorms.id, norm.id));
    const inactive = await getExpenseAccountingCatalog({ userId: 1, role: Role.DRIVER });
    assert.equal(inactive.driverCostSuggestions.some(item => item.code === code), false);
  });

  test('list fn returns the ACTIVE norms for the FE auto-fill (AC2)', async () => {
    const items = await listActiveDriverFeeNorms();
    assert.ok(items.length >= 8, `expected at least 8 ACTIVE norms, got ${items.length}`);
    const lift = items.find((item) => item.code === 'LIFT_DROP_ALLOWANCE');
    assert.ok(lift, 'LIFT_DROP_ALLOWANCE must be listed');
    assert.equal(lift.amount, '50000');
  });
});

after(async () => {
  try {
    const errors: unknown[] = [];
    for (const remove of cleanup) {
      try { await remove(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Fee norm fixture cleanup failed');
  } finally { await client.end(); }
});
