/**
 * Card 20261018 — read-path twin of expense-source-fulfillment-trip.test.ts
 * (chiphispec §1 trace, flagged by the accounting lane): the expense register's
 * fallback reads (loadSources DRIVER/TRIP buckets) inner-joined shipments on
 * trips.shipmentId alone, so a cost on a fulfillment-linked trip
 * (trips.shipmentId NULL until materialization) vanished from every list and
 * the driver's own "Sửa khoản chi" read 404'd. The read now resolves
 * direct link → shipment_fulfillments.shipmentId, exactly like the write path,
 * and a genuinely lotless trip still lists nowhere.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

import { eq } from 'drizzle-orm';

import { client, db } from '../db';
import { disconnectRedis } from '../lib/redis';
import * as s from '../db/schema';
import { Role, expenseListQuerySchema } from '@tingting/shared';
import type { Tx } from '../services/trip-shared';
import { insertTripComposite } from '../services/trip-composite.service';
import { loadExpenseAccountingEntries } from '../services/expense-accounting-reads.service';

after(async () => { await disconnectRedis(); await client.end({ timeout: 5 }); });

interface Ctx {
  accountant: { id: number };
  customer: { id: number }; shipment: { id: number }; route: { id: number }; cargo: { id: number };
}
async function fixture(run: (tx: Tx, ctx: Ctx) => Promise<void>) {
  const rollback = Symbol('rollback fulfillment-trip read fixture');
  try {
    await db.transaction(async tx => {
      const key = crypto.randomUUID();
      const [accountant] = await tx.insert(s.users).values({ username: `${key}-kt`, passwordHash: 'fixture', role: Role.ACCOUNTANT }).returning();
      const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
      const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: key, customerId: customer.id }).returning();
      const [route] = await tx.insert(s.routes).values({ name: key }).returning();
      const [cargo] = await tx.insert(s.cargoTypes).values({ name: key }).returning();
      await run(tx, { accountant, customer, shipment, route, cargo });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

/** A wave-model trip (lot via fulfillmentId only) carrying one driver cost. */
async function mkFulfillmentTripCost(tx: Tx, ctx: Ctx, tag: string) {
  const [fulfillment] = await tx.insert(s.shipmentFulfillments).values({ shipmentId: ctx.shipment.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 }).returning();
  const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId: ctx.customer.id,
    routeId: ctx.route.id, cargoTypeId: ctx.cargo.id, departureDate: '2026-10-18', status: 'IN_TRANSIT',
    carrierType: 'OWN', fulfillmentId: fulfillment.id });
  const [driverUser] = await tx.insert(s.users).values({ username: `${tag}-drv`, passwordHash: 'fixture', role: Role.DRIVER }).returning();
  const [driver] = await tx.insert(s.drivers).values({ name: `Lái xe ${tag}`, userId: driverUser.id }).returning();
  // The register's DRIVER ownership filter reads trips.driver_id (not the
  // cost's driver) — assign the driver to the trip like a real dispatched run.
  await tx.update(s.trips).set({ driverId: driver.id }).where(eq(s.trips.id, trip.id));
  const [cost] = await tx.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id,
    costType: 'PARKING', costGroup: 'DRIVER_SHIPMENT', payerKind: 'USER', feeName: `Phí giữ xe ${tag}`,
    amount: '200000', occurredAt: '2026-10-18' }).returning();
  return { trip, cost, driverUser };
}

const isThatCost = (cost: { id: number }) => (row: { sourceKind: string; sourceId: number }) =>
  row.sourceKind === 'DRIVER' && row.sourceId === cost.id;

test('a DRIVER cost on a fulfillment-linked trip lists through the fulfillment lot before materialization', async () => fixture(async (tx, ctx) => {
  const { trip, cost, driverUser } = await mkFulfillmentTripCost(tx, ctx, `ftr-${crypto.randomUUID().slice(0, 6)}`);
  assert.equal(trip.shipmentId, null, 'precondition: the wave-model trip carries no direct shipmentId');

  // The driver's own register read resolves the row onto the lot.
  const ownRows = await loadExpenseAccountingEntries({ userId: driverUser.id, role: Role.DRIVER }, expenseListQuerySchema.parse({}), tx);
  const own = ownRows.find(isThatCost(cost));
  assert.ok(own, 'the pre-materialization driver cost is listed for its author');
  assert.equal(own!.shipmentId, ctx.shipment.id);
  assert.equal(own!.tripId, trip.id);

  // Finance sees the same row, lot-scoped reads work, another lot does not.
  const financeRows = await loadExpenseAccountingEntries({ userId: ctx.accountant.id, role: Role.ACCOUNTANT }, expenseListQuerySchema.parse({}), tx);
  assert.ok(financeRows.find(isThatCost(cost)), 'the row is listed for finance');
  const scoped = await loadExpenseAccountingEntries({ userId: ctx.accountant.id, role: Role.ACCOUNTANT }, expenseListQuerySchema.parse({ shipmentId: ctx.shipment.id }), tx);
  assert.ok(scoped.find(isThatCost(cost)), 'the lot panel read finds the row');
  const otherLot = await loadExpenseAccountingEntries({ userId: ctx.accountant.id, role: Role.ACCOUNTANT }, expenseListQuerySchema.parse({ shipmentId: ctx.shipment.id + 1_000_000 }), tx);
  assert.ok(!otherLot.find(isThatCost(cost)), 'a different lot does not leak the row');
}));

test('a genuinely lotless trip still lists nowhere — the fulfillment fallback never invents a lot', async () => fixture(async (tx, ctx) => {
  const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId: ctx.customer.id,
    routeId: ctx.route.id, cargoTypeId: ctx.cargo.id, departureDate: '2026-10-18', status: 'IN_TRANSIT',
    carrierType: 'OWN' });
  const [driverUser] = await tx.insert(s.users).values({ username: `lotless-${crypto.randomUUID().slice(0, 6)}-drv`, passwordHash: 'fixture', role: Role.DRIVER }).returning();
  const [driver] = await tx.insert(s.drivers).values({ name: 'Lái xe không lô', userId: driverUser.id }).returning();
  const [cost] = await tx.insert(s.driverIncidentalCosts).values({ tripId: trip.id, driverId: driver.id,
    costType: 'PARKING', costGroup: 'DRIVER_SHIPMENT', payerKind: 'USER', feeName: 'Phí giữ xe không lô',
    amount: '120000', occurredAt: '2026-10-18' }).returning();

  const rows = await loadExpenseAccountingEntries({ userId: driverUser.id, role: Role.DRIVER }, expenseListQuerySchema.parse({}), tx);
  assert.ok(!rows.find(isThatCost(cost)), 'a lotless cost stays out of the lot-keyed register');
}));
