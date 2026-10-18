/**
 * Card 20261018 — "Không tìm thấy chi phí thuộc lô." must not strand driver
 * costs whose trip links the lot through a fulfillment only.
 *
 * Wave-model trips carry the lot link on `trips.fulfillmentId` while
 * `trips.shipmentId` stays NULL (trip-create inserts unlinked and links via a
 * guarded update; CUS/fulfillment trips are never back-filled). The DRIVER
 * materialization used to read `trips.shipmentId` alone, so tích duyệt / sửa /
 * thêm khoản chi on such a trip died with ApiError(404,
 * 'Không tìm thấy chi phí thuộc lô.') even though the trip was fully linked.
 *
 * Regression: a cost on a fulfillment-linked trip materializes through the
 * fulfillment's shipment (ensure + create paths); a genuinely lotless trip
 * (no direct link, no fulfillment) still refuses — lot accounting has nothing
 * to attach to.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';

import { client, db } from '../db';
import { disconnectRedis } from '../lib/redis';
import * as s from '../db/schema';
import { DriverIncidentalCostType, Role } from '@tingting/shared';
import type { Tx } from '../services/trip-shared';
import { insertTripComposite } from '../services/trip-composite.service';
import { ensureLegacyExpenseSource } from '../services/expense-accounting-source.service';
import { createAccountingExpense } from '../services/expense-accounting-create.service';

after(async () => { await disconnectRedis(); await client.end({ timeout: 5 }); });

interface Ctx {
  accountant: { id: number }; accountantActor: { userId: number; role: Role };
  customer: { id: number }; shipment: { id: number }; route: { id: number }; cargo: { id: number };
}

async function fixture(run: (tx: Tx, ctx: Ctx) => Promise<void>) {
  const rollback = Symbol('rollback fulfillment-trip fixture');
  try {
    await db.transaction(async tx => {
      const key = crypto.randomUUID();
      const [accountant] = await tx.insert(s.users).values({ username: `${key}-kt`, passwordHash: 'fixture', role: Role.ACCOUNTANT }).returning();
      const [customer] = await tx.insert(s.customers).values({ name: key }).returning();
      const [shipment] = await tx.insert(s.shipments).values({ shipmentCode: key, customerId: customer.id }).returning();
      const [route] = await tx.insert(s.routes).values({ name: key }).returning();
      const [cargo] = await tx.insert(s.cargoTypes).values({ name: key }).returning();
      await run(tx, { accountant, accountantActor: { userId: accountant.id, role: Role.ACCOUNTANT },
        customer, shipment, route, cargo });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}

/** A wave-model trip: lot reachable through fulfillmentId ONLY. */
async function mkFulfillmentTrip(tx: Tx, ctx: Ctx) {
  const [fulfillment] = await tx.insert(s.shipmentFulfillments).values({ shipmentId: ctx.shipment.id,
    fulfillmentType: 'FCL_CONTAINER', cargoMode: 'FCL', sourceShipmentVersion: 1 }).returning();
  return insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId: ctx.customer.id,
    routeId: ctx.route.id, cargoTypeId: ctx.cargo.id, departureDate: '2026-10-18', status: 'IN_TRANSIT',
    carrierType: 'OWN', fulfillmentId: fulfillment.id });
}

async function mkDriverCost(tx: Tx, tripId: number, tag: string) {
  const [driverUser] = await tx.insert(s.users).values({ username: `${tag}-drv`, passwordHash: 'fixture', role: Role.DRIVER }).returning();
  const [driver] = await tx.insert(s.drivers).values({ name: `Lái xe ${tag}`, userId: driverUser.id }).returning();
  const [cost] = await tx.insert(s.driverIncidentalCosts).values({ tripId, driverId: driver.id,
    costType: 'PARKING', costGroup: 'DRIVER_SHIPMENT', payerKind: 'USER', feeName: `Phí giữ xe ${tag}`,
    amount: '200000', occurredAt: '2026-10-18' }).returning();
  return { cost, driver, driverUser };
}

test('a DRIVER cost on a fulfillment-linked trip materializes through the fulfillment lot (was 404 Không tìm thấy chi phí thuộc lô.)', async () => fixture(async (tx, ctx) => {
  const trip = await mkFulfillmentTrip(tx, ctx);
  const { cost } = await mkDriverCost(tx, trip.id, `ft-${trip.id}`);
  assert.equal(trip.shipmentId, null, 'precondition: the wave-model trip carries no direct shipmentId');
  const [before] = await tx.select().from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), eq(s.expenseAccountingSources.sourceId, cost.id)));
  assert.equal(before, undefined, 'precondition: no accounting source materialized yet');

  const source = await ensureLegacyExpenseSource(tx, 'DRIVER', cost.id, ctx.accountant.id);
  assert.equal(source.shipmentId, ctx.shipment.id, 'the lot resolves through trips.fulfillmentId');
  assert.equal(source.tripId, trip.id);
  assert.equal(source.customerId, ctx.customer.id);
  assert.equal(Number(source.amount), 200000);
  const [row] = await tx.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.id, source.id));
  assert.equal(row.shipmentId, ctx.shipment.id, 'the materialized source carries the resolved lot');
}));

test('thêm khoản chi (accounting create) works against a fulfillment-linked trip (was 409 Chọn chuyến đang hoạt động và thuộc lô hàng.)', async () => fixture(async (tx, ctx) => {
  const trip = await mkFulfillmentTrip(tx, ctx);
  const [driverUser] = await tx.insert(s.users).values({ username: `ac-${trip.id}-ops`, passwordHash: 'fixture', role: Role.DRIVER }).returning();
  const [driver] = await tx.insert(s.drivers).values({ name: `Lái xe tạo ${trip.id}`, userId: driverUser.id }).returning();
  await tx.update(s.trips).set({ driverId: driver.id }).where(eq(s.trips.id, trip.id));

  const source = await createAccountingExpense(tx, ctx.accountantActor, {
    tripId: trip.id, shipmentId: ctx.shipment.id, expenseTypeCode: 'PARKING',
    amount: 150000, customerChargeAmount: 0, expenseDate: '2026-10-18',
    costGroup: 'DRIVER_SHIPMENT', feeName: 'Phí giữ xe thêm dòng', payerKind: 'COMPANY',
    driverCostType: DriverIncidentalCostType.PARKING,
  });
  assert.equal(source.shipmentId, ctx.shipment.id);
  assert.equal(source.tripId, trip.id);
}));

test('a genuinely lotless trip (no direct link, no fulfillment) still refuses', async () => fixture(async (tx, ctx) => {
  const trip = await insertTripComposite(tx, { tripCode: crypto.randomUUID(), customerId: ctx.customer.id,
    routeId: ctx.route.id, cargoTypeId: ctx.cargo.id, departureDate: '2026-10-18', status: 'IN_TRANSIT', carrierType: 'OWN' });
  const { cost } = await mkDriverCost(tx, trip.id, `ll-${trip.id}`);
  await assert.rejects(() => ensureLegacyExpenseSource(tx, 'DRIVER', cost.id, ctx.accountant.id),
    (error: unknown) => error instanceof Error && error.message === 'Không tìm thấy chi phí thuộc lô.');
}));
