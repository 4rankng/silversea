import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  assertForwarderTripScope,
  getForwarderTripDetail,
  getForwarderTrips,
} from '../services/forwarder-trip-query.service';
import { createUser, updateUser } from '../services/user.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  users: [] as number[],
  shipments: [] as number[],
  trips: [] as number[],
  customers: [] as number[],
  routes: [] as number[],
  cargoTypes: [] as number[],
};
let forwarderA: number;
let forwarderB: number;
let shipmentA: number;
let shipmentB: number;
let tripA: number;
let tripB: number;

before(async () => {
  const [customer] = await db.insert(s.customers)
    .values({ name: `Forwarder scope customer ${suffix}` }).returning();
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes)
    .values({ name: `Forwarder scope route ${suffix}` }).returning();
  ids.routes.push(route.id);
  const [cargoType] = await db.insert(s.cargoTypes)
    .values({ name: `Forwarder scope cargo ${suffix}` }).returning();
  ids.cargoTypes.push(cargoType.id);
  const users = await db.insert(s.users).values([
    {
      username: `forwarder-scope-a-${suffix}`,
      passwordHash: 'test-only',
      role: Role.FORWARDER,
      status: 'ACTIVE',
    },
    {
      username: `forwarder-scope-b-${suffix}`,
      passwordHash: 'test-only',
      role: Role.FORWARDER,
      status: 'ACTIVE',
    },
  ]).returning({ id: s.users.id });
  [forwarderA, forwarderB] = users.map((row) => row.id);
  ids.users.push(forwarderA, forwarderB);
  const shipments = await db.insert(s.shipments).values([
    { shipmentCode: `FS-A-${suffix}`, customerId: customer.id, cargoTypeId: cargoType.id },
    { shipmentCode: `FS-B-${suffix}`, customerId: customer.id, cargoTypeId: cargoType.id },
  ]).returning({ id: s.shipments.id });
  [shipmentA, shipmentB] = shipments.map((row) => row.id);
  ids.shipments.push(shipmentA, shipmentB);
  const trips = await db.insert(s.trips).values([
    {
      tripCode: `FS-TRIP-A-${suffix}`,
      shipmentId: shipmentA,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-07-28',
    },
    {
      tripCode: `FS-TRIP-B-${suffix}`,
      shipmentId: shipmentB,
      customerId: customer.id,
      routeId: route.id,
      cargoTypeId: cargoType.id,
      departureDate: '2026-07-28',
    },
  ]).returning({ id: s.trips.id });
  [tripA, tripB] = trips.map((row) => row.id);
  ids.trips.push(tripA, tripB);
  await db.insert(s.userShipmentLinks).values([
    { userId: forwarderA, shipmentId: shipmentA },
    { userId: forwarderB, shipmentId: shipmentB },
  ]);
});

after(async () => {
  await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.tripId, ids.trips));
  await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, ids.users));
  await db.delete(s.trips).where(inArray(s.trips.id, ids.trips));
  await db.delete(s.shipments).where(inArray(s.shipments.id, ids.shipments));
  await db.delete(s.users).where(inArray(s.users.id, ids.users));
  await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, ids.cargoTypes));
  await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
  await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  await client.end();
});

describe('forwarder shipment scope', () => {
  test('ACTIVE forwarder accounts require admin-managed shipment assignments', async () => {
    await assert.rejects(
      () => createUser({
        username: `forwarder-unassigned-${suffix}`,
        password: 'test-only-password',
        role: Role.FORWARDER,
        status: 'ACTIVE',
      }),
      /ít nhất một lô hàng/,
    );
    const assigned = await createUser({
      username: `forwarder-assigned-${suffix}`,
      password: 'test-only-password',
      role: Role.FORWARDER,
      status: 'ACTIVE',
      shipmentIds: [shipmentA],
    });
    ids.users.push(assigned.id);
    assert.deepEqual(assigned.shipmentIds, [shipmentA]);
    const updated = await updateUser(assigned.id, { shipmentIds: [shipmentB] });
    assert.deepEqual(updated.shipmentIds, [shipmentB]);
  });

  test('list, detail, and mutation guard deny an out-of-scope trip', async () => {
    const listA = await getForwarderTrips(forwarderA);
    assert.ok(listA.some((trip) => trip.id === tripA));
    assert.ok(!listA.some((trip) => trip.id === tripB));
    assert.equal(await getForwarderTripDetail(tripB, forwarderA), null);
    await assert.rejects(
      () => assertForwarderTripScope(tripB, forwarderA),
      (error: unknown) => (
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 404
      ),
    );
  });

  test('shared assignment allows trip visibility but only the owner can edit each expense', async () => {
    await db.insert(s.userShipmentLinks).values({
      userId: forwarderB,
      shipmentId: shipmentA,
    });
    const expenses = await db.insert(s.tripExpenses).values([
      {
        tripId: tripA,
        forwarderId: forwarderA,
        createdBy: forwarderA,
        expenseType: 'OTHER',
        buyAmount: '1000',
        sellAmount: '0',
      },
      {
        tripId: tripA,
        forwarderId: forwarderB,
        createdBy: forwarderB,
        expenseType: 'OTHER',
        buyAmount: '2000',
        sellAmount: '0',
      },
    ]).returning({ id: s.tripExpenses.id });

    const detailA = await getForwarderTripDetail(tripA, forwarderA);
    const detailB = await getForwarderTripDetail(tripA, forwarderB);
    assert.ok(detailA);
    assert.ok(detailB);
    const seededIds = new Set(expenses.map((row) => row.id));
    const aRows = detailA.expenses.filter((expense) => seededIds.has(expense.id));
    const bRows = detailB.expenses.filter((expense) => seededIds.has(expense.id));
    assert.equal(aRows.find((expense) => expense.forwarderId === forwarderA)?.canEdit, true);
    assert.equal(aRows.find((expense) => expense.forwarderId === forwarderB)?.canEdit, false);
    assert.equal(bRows.find((expense) => expense.forwarderId === forwarderA)?.canEdit, false);
    assert.equal(bRows.find((expense) => expense.forwarderId === forwarderB)?.canEdit, true);
  });
});
