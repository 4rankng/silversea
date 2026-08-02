import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  assertForwarderTripScope,
  assertForwarderMutableTripScope,
  getForwarderTripDetail,
  getForwarderTrips,
} from '../services/forwarder-trip-query.service';
import { createUser, updateUser } from '../services/user.service';
import {
  createTripExpense,
  updateForwarderTripExpenseInTx,
} from '../services/forwarder.service';

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
  test('current schema keeps explicit shipment-scope links with unique and lookup indexes', async () => {
    const tableRows = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'user_shipment_links'
    `;
    assert.equal(tableRows.length, 1, 'expected the shipment-scope link table to exist in the current schema');

    const indexRows = await client<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'user_shipment_links'
        and indexname in (
          'user_shipment_links_user_shipment_uniq_idx',
          'user_shipment_links_user_idx',
          'user_shipment_links_shipment_idx'
        )
      order by indexname
    `;
    assert.deepEqual(
      indexRows.map((row) => row.indexname),
      [
        'user_shipment_links_shipment_idx',
        'user_shipment_links_user_idx',
        'user_shipment_links_user_shipment_uniq_idx',
      ],
    );
    assert.match(
      indexRows.find((row) => row.indexname === 'user_shipment_links_user_shipment_uniq_idx')!.indexdef,
      /unique index .* \(user_id, shipment_id\)/i,
    );

    await assert.rejects(
      () => db.insert(s.userShipmentLinks).values({ userId: forwarderA, shipmentId: shipmentA }),
      (error: unknown) => (
        error instanceof Error
        && 'cause' in error
        && error.cause instanceof Error
        && /user_shipment_links_user_shipment_uniq_idx|duplicate key/i.test(error.cause.message)
      ),
    );
  });

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

  test('scope revocation and terminal shipment state deny mutations immediately', async () => {
    await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, [forwarderA]));
    await assert.rejects(
      () => assertForwarderMutableTripScope(tripA, forwarderA),
      (error: unknown) => (
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 404
      ),
    );
    await db.insert(s.userShipmentLinks).values({ userId: forwarderA, shipmentId: shipmentA });

    await db.update(s.shipments).set({ status: 'COMPLETED' }).where(inArray(s.shipments.id, [shipmentA]));
    await assert.rejects(
      () => assertForwarderMutableTripScope(tripA, forwarderA),
      (error: unknown) => (
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 409
      ),
    );
    await assert.rejects(
      () => createUser({
        username: `forwarder-terminal-${suffix}`,
        password: 'test-only-password',
        role: Role.FORWARDER,
        status: 'ACTIVE',
        shipmentIds: [shipmentA],
      }),
      /chưa kết thúc/,
    );
    await db.update(s.shipments).set({ status: 'NEW' }).where(inArray(s.shipments.id, [shipmentA]));
  });

  test('mutable-scope validation serializes a concurrent terminal shipment transition', async () => {
    let releaseGuard!: () => void;
    const holdGuard = new Promise<void>((resolve) => {
      releaseGuard = resolve;
    });
    let guardReady!: () => void;
    const guardStarted = new Promise<void>((resolve) => {
      guardReady = resolve;
    });

    const guardedMutation = db.transaction(async (tx) => {
      await assertForwarderMutableTripScope(tripA, forwarderA, tx);
      guardReady();
      await holdGuard;
    });
    await guardStarted;

    let transitionCompleted = false;
    const terminalTransition = db.transaction(async (tx) => {
      await tx.update(s.shipments)
        .set({ status: 'COMPLETED' })
        .where(eq(s.shipments.id, shipmentA));
      transitionCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(transitionCompleted, false);

    releaseGuard();
    await guardedMutation;
    await terminalTransition;
    assert.equal(transitionCompleted, true);
    await db.update(s.shipments).set({ status: 'NEW' }).where(eq(s.shipments.id, shipmentA));
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

  test('forwarder PATCH validates the merged no-invoice record', async () => {
    const expense = await db.transaction((tx) => createTripExpense(tx, {
      tripId: tripA,
      forwarderId: forwarderA,
      createdBy: forwarderA,
      expenseType: 'OTHER',
      buyAmount: '3000',
      sellAmount: '0',
      expenseDate: '2026-07-28',
      payeeName: 'Cảng Hải Phòng',
      note: 'Chi phí hiện trường',
      noInvoiceEvidenceTypes: ['RECEIPT'],
    }));
    await assert.rejects(
      () => db.transaction((tx) => updateForwarderTripExpenseInTx(
        tx,
        expense.id,
        forwarderA,
        { note: null },
        expense.updatedAt,
      )),
      /Lý do chi là bắt buộc/,
    );
  });
});
