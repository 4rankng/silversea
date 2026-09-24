/**
 * Card 20260921_6 — driver lot-cost classification via the shared fee
 * catalog. Service-level suite in the m84-incidental-cost mold (fixtures
 * prefix `card6-`/`CARD6-`, local DB :5441 only, announced).
 *
 * Coverage:
 *   AC4 catalog pre-seeded: the card's 3 invoiced + 7 no-invoice codes ACTIVE
 *       with correct requires_invoice.
 *   AC1 invoiced class: invoice number mandatory (400 without), charge =
 *       amount on entry AND accounting source; same-key replay returns the
 *       same row.
 *   AC3 never-receivable: client-sent invoice number STILL yields charge = 0
 *       with invoice fields forced null - on entry AND source.
 *   AC2/AC5 confirm wiring: pre-confirm -> no tripExpenses (receivable)
 *       projection; after accountant confirm -> tripExpenses carries
 *       sellAmount = charge + invoice number.
 *   Legacy: enum-only entry (no expenseTypeCode) keeps the old heuristic.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { recordIncidentalCost } from '../services/driver.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { ApiError } from '../errors';
import { DriverIncidentalCostType, Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

/** One accountant fixture per confirming test. */
async function mkAccountant() {
  const [u] = await db.insert(s.users).values({
    username: `card6-${suffix}-acct`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkDriverTrip() {
  const [u] = await db.insert(s.users).values({
    username: `card6-${suffix}-${cleanup.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  const [d] = await db.insert(s.drivers).values({ name: 'card6 driver', userId: u.id }).returning();
  track(async () => { await db.delete(s.drivers).where(eq(s.drivers.id, d.id)); });
  const [customer] = await db.insert(s.customers).values({ name: `card6 cust ${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: 'card6 route' }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `card6 cargo ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `CARD6-${suffix}-${cleanup.length}`.slice(0, 50),
    driverId: d.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT', departureDate: TODAY,
  }).returning();
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return { user: u, driver: d, shipment, trip };
}

describe('card 20260921_6 - driver lot-cost classification', () => {
  test('catalog ships pre-seeded with the card classes (AC4)', async () => {
    const expected: ReadonlyArray<[string, boolean]> = [
      ['SANITATION', true], ['YARD_STORAGE', true], ['STORAGE_FEE', true],
      ['WAREHOUSE_LABOR', false], ['CONTAINER_WELD', false], ['TIRE_WEIGH', false],
      ['CONTAINER_SWAP', false], ['TWO_POINT_DROP', false], ['CARGO_RESTACK', false],
      ['FORKLIFT_DANGKHOA', false],
    ];
    const rows = await db.select({
      code: s.forwarderExpenseTypes.code,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
      status: s.forwarderExpenseTypes.status,
    }).from(s.forwarderExpenseTypes)
      .where(inArray(s.forwarderExpenseTypes.code, expected.map(([code]) => code)));
    assert.equal(rows.length, expected.length);
    for (const [code, requiresInvoice] of expected) {
      const row = rows.find((r) => r.code === code);
      assert.ok(row, `missing catalog row ${code}`);
      assert.equal(row.status, 'ACTIVE', `${code} must be ACTIVE`);
      assert.equal(row.requiresInvoice, requiresInvoice, `${code} wrong class`);
    }
  });

  test('invoiced type: invoice mandatory, charges customer, replay honors catalog ref (AC1/AC2)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const body = {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'SANITATION',
      amount: 250000, occurredAt: TODAY, invoiceNumber: 'card6-HD-1', invoiceDate: TODAY,
    };
    const { cost, replayed } = await recordIncidentalCost(trip.id, driver.id, body, user.id, `card6-key-${suffix}-inv`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    assert.equal(replayed, false);
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, cost.id)));
    track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
    assert.ok(source, 'registry row must exist for shipment-linked trips');
    const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(entryRow.customerChargeAmount, '250000');
    assert.equal(entryRow.invoiceNumber, 'card6-HD-1');

    const replay = await recordIncidentalCost(trip.id, driver.id, body, user.id, `card6-key-${suffix}-inv`);
    assert.equal(replay.replayed, true);
    assert.equal(replay.cost.id, cost.id);
  });

  test('invoiced without invoice number is rejected (AC1)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'SANITATION',
      amount: 250000, occurredAt: TODAY,
    }, user.id, `card6-key-${suffix}-noinv`).then(
      () => { throw new Error('expected 400 rejection'); },
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
        assert.equal((err as ApiError).statusCode, 400);
        assert.match((err as ApiError).message, /số hóa đơn/);
      },
    );
  });

  test('no-invoice type never charges, whatever the driver typed (AC3)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'WAREHOUSE_LABOR',
      amount: 120000, occurredAt: TODAY, invoiceNumber: 'card6-HD-should-be-dropped', invoiceDate: TODAY,
    }, user.id, `card6-key-${suffix}-noinvoice`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    const [entryRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(entryRow.customerChargeAmount, '0');
    assert.equal(entryRow.invoiceNumber, null);
  });

  test('enum-only entry without catalog ref keeps the legacy heuristic', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const withInvoice = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, amount: 60000, occurredAt: TODAY,
      invoiceNumber: 'card6-HD-legacy', invoiceDate: TODAY,
    }, user.id, `card6-key-${suffix}-legacy-1`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withInvoice.cost.id)); });
    const [withInvoiceRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withInvoice.cost.id));
    assert.equal(withInvoiceRow.customerChargeAmount, '60000');
    const withoutInvoice = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.TOLL, amount: 40000, occurredAt: TODAY,
    }, user.id, `card6-key-${suffix}-legacy-2`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withoutInvoice.cost.id)); });
    const [withoutInvoiceRow] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, withoutInvoice.cost.id));
    assert.equal(withoutInvoiceRow.customerChargeAmount, '0');
  });

  test('pre-confirm: no receivable projection; after accountant confirm it carries charge + invoice (AC2/AC5)', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const accountant = await mkAccountant();
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'SANITATION',
      amount: 250000, occurredAt: TODAY, invoiceNumber: 'card6-HD-2', invoiceDate: TODAY,
    }, user.id, `card6-key-${suffix}-confirm`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, cost.id)));
    track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });
    assert.equal(source.confirmedAt, null);
    const preConfirm = await db.select({ id: s.tripExpenses.id }).from(s.tripExpenses)
      .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, 'Phí vệ sinh')));
    assert.equal(preConfirm.length, 0);

    await db.transaction(async (tx) => {
      await confirmAccountingExpenses(tx, { userId: accountant.id, role: Role.ACCOUNTANT },
        [{ sourceKind: 'DRIVER', sourceId: cost.id, expectedVersion: source.version }]);
    });
    const [projection] = await db.select().from(s.tripExpenses)
      .where(and(eq(s.tripExpenses.tripId, trip.id), eq(s.tripExpenses.feeName, 'Phí vệ sinh')));
    track(async () => { await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, projection.id)); });
    assert.ok(projection, 'confirm must project the receivable');
    assert.equal(projection.sellAmount, '250000');
    assert.equal(projection.invoiceNumber, 'card6-HD-2');
  });
});
