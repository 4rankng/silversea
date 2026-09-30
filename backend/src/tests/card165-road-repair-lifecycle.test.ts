/**
 * Card 20260928_165 — the ROAD_REPAIR lifecycle, service level.
 *
 * The static identity tests live in card165-road-repair-receipt.test.ts (catalog
 * row, seed policy class, receipt mapping). This file pins the row's LIFE:
 *   gate   — the server refuses a road-repair entry that carries no receipt
 *            (driver-fulfillment.service reads the one shared evidence map), so
 *            the offline queue and every other caller obey the form's rule;
 *   marker — with the receipt uploaded, the entry persists the receipt storage
 *            key and lands in the DRIVER_ROAD bucket charging the customer 0;
 *   read   — after the accountant confirms, the accountant-facing read still
 *            carries the receipt (the phơi-phiếu row keeps its paper anchor)
 *            and the lot projection still charges the customer nothing.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { recordIncidentalCost } from '../services/driver.service';
import { confirmAccountingExpenses } from '../services/expense-accounting-write.service';
import { getExpenseAccountingEntry } from '../services/expense-accounting-reads.service';
import { DriverIncidentalCostType, Role } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = new Date().toISOString().slice(0, 10);

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

async function mkAccountant() {
  const [u] = await db.insert(s.users).values({
    username: `card165lc-${suffix}-${cleanup.length}-acct`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  return u;
}

async function mkDriverTrip() {
  const [u] = await db.insert(s.users).values({
    username: `card165lc-${suffix}-${cleanup.length}`, passwordHash: 'x', role: 'DRIVER',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  const [d] = await db.insert(s.drivers).values({ name: `card165lc driver ${suffix}`, userId: u.id }).returning();
  track(async () => { await db.delete(s.drivers).where(eq(s.drivers.id, d.id)); });
  // Per-run suffix on the customer name is load-bearing: customers carries a
  // partial unique index on ACTIVE (name, tax_code) — the card 20260929_206 lesson.
  const [customer] = await db.insert(s.customers).values({ name: `card165lc cust ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.customers).where(eq(s.customers.id, customer.id)); });
  const [route] = await db.insert(s.routes).values({ name: `card165lc route ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.routes).where(eq(s.routes.id, route.id)); });
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `card165lc cargo ${suffix}-${cleanup.length}` }).returning();
  track(async () => { await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoType.id)); });
  const [shipment] = await db.insert(s.shipments).values({
    customerId: customer.id, routeId: route.id, cargoMode: 'FCL', status: 'PENDING_DATE',
  }).returning();
  track(async () => { await db.delete(s.shipments).where(eq(s.shipments.id, shipment.id)); });
  const [trip] = await db.insert(s.trips).values({
    tripCode: `CARD165LC-${suffix}-${cleanup.length}`.slice(0, 50),
    driverId: d.id, shipmentId: shipment.id, customerId: customer.id, routeId: route.id, cargoTypeId: cargoType.id,
    status: 'IN_TRANSIT', departureDate: TODAY,
  }).returning();
  track(async () => { await db.delete(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, trip.id)); });
  track(async () => { await db.delete(s.trips).where(eq(s.trips.id, trip.id)); });
  return { user: u, driver: d, shipment, trip };
}

describe('card 20260928_165 — ROAD_REPAIR lifecycle', () => {
  test('gate: the server refuses a road-repair entry without its hand-written receipt', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    await assert.rejects(
      recordIncidentalCost(trip.id, driver.id, {
        costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'ROAD_REPAIR', amount: 50_000, occurredAt: TODAY,
      }, user.id, `card165lc-${suffix}-gate`),
      /Phiếu thu/,
      'the refusal must name the missing paper, not fail opaquely',
    );
  });

  test('marker: with the receipt uploaded the entry keeps it, lands DRIVER_ROAD, charges the customer 0', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const storageKey = `card165lc/receipt-${suffix}.jpg`;
    const [photo] = await db.insert(s.tripPhotos).values({
      tripId: trip.id, type: 'OTHER', storageKey, uploadedBy: user.id,
    }).returning();
    track(async () => { await db.delete(s.tripPhotos).where(eq(s.tripPhotos.id, photo.id)); });

    // The form sends costGroup: option.group for every option (useDriverExpenseEntry
    // save body) — mirror that, or the service's OTHER->DRIVER_SHIPMENT default fires.
    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'ROAD_REPAIR', costGroup: 'DRIVER_ROAD',
      amount: 50_000, occurredAt: TODAY,
      receiptStorageKey: storageKey,
    }, user.id, `card165lc-${suffix}-marker`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });

    const [row] = await db.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id));
    assert.equal(row.expenseTypeCode, 'ROAD_REPAIR', 'the catalog identity is stored');
    assert.equal(row.receiptStorageKey, storageKey, 'the receipt anchor is stored');
    assert.equal(row.costGroup, 'DRIVER_ROAD', 'the row lives in the road bucket');
    assert.equal(row.customerChargeAmount, '0', 'tiền đường không thu khách hàng');
  });

  test('read: after accountant confirm the receipt survives into the phơi-phiếu-facing read, receivable stays 0', async () => {
    const { user, driver, trip } = await mkDriverTrip();
    const accountant = await mkAccountant();
    const storageKey = `card165lc/receipt-lc-${suffix}.jpg`;
    const [photo] = await db.insert(s.tripPhotos).values({
      tripId: trip.id, type: 'OTHER', storageKey, uploadedBy: user.id,
    }).returning();
    track(async () => { await db.delete(s.tripPhotos).where(eq(s.tripPhotos.id, photo.id)); });

    const { cost } = await recordIncidentalCost(trip.id, driver.id, {
      costType: DriverIncidentalCostType.OTHER, expenseTypeCode: 'ROAD_REPAIR', costGroup: 'DRIVER_ROAD',
      amount: 50_000, occurredAt: TODAY,
      receiptStorageKey: storageKey,
    }, user.id, `card165lc-${suffix}-read`);
    track(async () => { await db.delete(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, cost.id)); });
    const [source] = await db.select().from(s.expenseAccountingSources).where(and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), eq(s.expenseAccountingSources.sourceId, cost.id)));
    track(async () => { await db.delete(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id)); });

    await db.transaction(async (tx) => {
      await confirmAccountingExpenses(tx, { userId: accountant.id, role: Role.ACCOUNTANT },
        [{ sourceKind: 'DRIVER', sourceId: cost.id, expectedVersion: source.version }]);
    });

    const entry = await getExpenseAccountingEntry(
      { userId: accountant.id, role: Role.ACCOUNTANT }, 'DRIVER', cost.id,
    );
    assert.ok(
      entry.photoStorageKeys.includes(storageKey),
      'the accountant-facing read still carries the receipt (the paper anchor survives confirm)',
    );
    assert.equal(entry.customerChargeAmount ?? 0, 0, 'still nothing charged to the customer');

    const projections = await db.select().from(s.tripExpenses)
      .where(eq(s.tripExpenses.tripId, trip.id));
    assert.equal(projections.length, 1, 'confirm puts the cost into the lot exactly once (vehicle cost)');
    assert.equal(projections[0].sellAmount, '0', 'the road row never charges the customer');
    track(async () => { await db.delete(s.tripExpenses).where(eq(s.tripExpenses.id, projections[0].id)); });
  });
});
