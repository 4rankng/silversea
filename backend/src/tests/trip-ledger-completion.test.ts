import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';
import { FuelMode, TripStatus, Role, TxnType } from '@tingting/shared';
import { db, client } from '../db';
import * as s from '../db/schema';
import { transitionTripStatus } from '../services/trip-status-machine.service';
import { updateTripFigures } from '../services/trip-mutations.service';

const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];

after(async () => {
  if (createdTripIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdSupplierIds.length > 0) {
    await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
  }
  await client.end();
});

async function createInTransitTrip(values?: {
  revenue?: number;
  totalFuelCost?: number;
}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [customer] = await db.insert(s.customers).values({ name: `Ledger customer ${suffix}` }).returning();
  const [supplier] = await db.insert(s.suppliers).values({ name: `Ledger supplier ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `Ledger route ${suffix}` }).returning();
  const [cargoType] = await db.insert(s.cargoTypes).values({ name: `Ledger cargo ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  createdSupplierIds.push(supplier.id);
  createdRouteIds.push(route.id);
  createdCargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `TLC-${suffix}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    status: TripStatus.IN_TRANSIT,
    departureDate: '2026-06-20',
    revenue: String(values?.revenue ?? 1_200_000),
    totalFuelCost: String(values?.totalFuelCost ?? 300_000),
    fuelSupplierId: supplier.id,
    carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return { trip, customer, supplier };
}

async function ledgerRowsForTrip(tripId: number) {
  return db.select().from(s.ledger)
    .where(eq(s.ledger.txnId, tripId))
    .orderBy(s.ledger.id);
}

describe('trip completion ledger posting', () => {
  test('posts customer and supplier ledger entries when a trip is completed', async () => {
    const { trip, customer, supplier } = await createInTransitTrip({
      revenue: 1_234_000,
      totalFuelCost: 456_000,
    });

    await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);

    const rows = await ledgerRowsForTrip(trip.id);
    assert.equal(rows.filter(r => r.txnType === TxnType.TRIP_REVENUE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.FUEL_EXPENSE).length, 1);
    assert.ok(rows.some(r =>
      r.entityType === 'CUSTOMER' &&
      r.entityId === customer.id &&
      r.debit === '1234000' &&
      r.credit === '0'
    ));
    assert.ok(rows.some(r =>
      r.entityType === 'VENDOR' &&
      r.entityId === supplier.id &&
      r.debit === '0' &&
      r.credit === '456000'
    ));
  });

  test('locking a completed trip does not duplicate ledger entries', async () => {
    const { trip } = await createInTransitTrip();

    await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
    await transitionTripStatus(trip.id, TripStatus.LOCKED, 1, Role.MANAGER, false, true);

    const rows = await ledgerRowsForTrip(trip.id);
    assert.equal(rows.filter(r => r.txnType === TxnType.TRIP_REVENUE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.FUEL_EXPENSE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.UNLOCK_REVERSAL).length, 0);
  });

  test('unlocking a locked trip keeps completed-trip ledger entries intact', async () => {
    const { trip } = await createInTransitTrip();

    await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
    await transitionTripStatus(trip.id, TripStatus.LOCKED, 1, Role.MANAGER, false, true);
    await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);

    const rows = await ledgerRowsForTrip(trip.id);
    assert.equal(rows.filter(r => r.txnType === TxnType.TRIP_REVENUE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.FUEL_EXPENSE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.UNLOCK_REVERSAL).length, 0);
  });

  test('canceling a completed trip reverses its completed-trip ledger entries', async () => {
    const { trip, customer, supplier } = await createInTransitTrip({
      revenue: 700_000,
      totalFuelCost: 200_000,
    });

    await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
    await transitionTripStatus(trip.id, TripStatus.CANCELED, 1, Role.MANAGER);

    const rows = await ledgerRowsForTrip(trip.id);
    assert.equal(rows.filter(r => r.txnType === TxnType.TRIP_REVENUE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.FUEL_EXPENSE).length, 1);
    assert.equal(rows.filter(r => r.txnType === TxnType.UNLOCK_REVERSAL).length, 2);

    const [customerBalance] = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customer.id)))
      .orderBy(s.ledger.id);
    const [supplierBalance] = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplier.id)))
      .orderBy(s.ledger.id);
    assert.equal(customerBalance.balance, '700000');
    assert.equal(supplierBalance.balance, '200000');

    const latestCustomerRows = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customer.id)))
      .orderBy(s.ledger.id);
    const latestSupplierRows = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, supplier.id)))
      .orderBy(s.ledger.id);
    assert.equal(latestCustomerRows.at(-1)?.balance, '0');
    assert.equal(latestSupplierRows.at(-1)?.balance, '0');
  });

  test('editing completed trip figures reverses and reposts ledger entries', async () => {
    const { trip, customer } = await createInTransitTrip({
      revenue: 800_000,
      totalFuelCost: 100_000,
    });

    const completed = await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
    await updateTripFigures(trip.id, {
      legs: [],
      fuelMode: FuelMode.AUTO,
      fuelSupplementLiters: 0,
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: 0,
      hasReturnCargo: false,
      revenue: 1_500_000,
      expectedVersion: completed.version,
      userId: 1,
    });

    const rows = await ledgerRowsForTrip(trip.id);
    assert.equal(rows.filter(r => r.txnType === TxnType.TRIP_REVENUE).length, 2);
    assert.ok(rows.some(r =>
      r.txnType === TxnType.UNLOCK_REVERSAL &&
      r.entityType === 'CUSTOMER' &&
      r.entityId === customer.id &&
      r.credit === '800000'
    ));

    const customerRows = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, customer.id)))
      .orderBy(s.ledger.id);
    assert.equal(customerRows.at(-1)?.balance, '1500000');
  });

  test('changing a completed trip customer reverses the old receivable and posts it to the new customer', async () => {
    const { trip, customer: oldCustomer } = await createInTransitTrip({ revenue: 800_000 });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [newCustomer] = await db.insert(s.customers).values({ name: `Replacement customer ${suffix}` }).returning();
    createdCustomerIds.push(newCustomer.id);

    const completed = await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
    const updated = await updateTripFigures(trip.id, {
      legs: [],
      fuelMode: FuelMode.AUTO,
      fuelSupplementLiters: 0,
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: 0,
      hasReturnCargo: false,
      customerId: newCustomer.id,
      expectedVersion: completed.version,
      userId: 1,
      userRole: Role.MANAGER,
    });

    assert.equal(updated.customerId, newCustomer.id);
    const oldRows = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, oldCustomer.id)))
      .orderBy(s.ledger.id);
    const newRows = await db.select({ balance: s.ledger.balance }).from(s.ledger)
      .where(and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, newCustomer.id)))
      .orderBy(s.ledger.id);
    assert.equal(oldRows.at(-1)?.balance, '0');
    assert.equal(newRows.at(-1)?.balance, '800000');
  });

  test('rejects changing a completed trip customer after payment has been recorded', async () => {
    const { trip, customer } = await createInTransitTrip({ revenue: 800_000 });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [newCustomer] = await db.insert(s.customers).values({ name: `Paid replacement customer ${suffix}` }).returning();
    createdCustomerIds.push(newCustomer.id);

    const completed = await transitionTripStatus(trip.id, TripStatus.COMPLETED, 1, Role.MANAGER);
    await db.insert(s.ledger).values({
      txnType: TxnType.PAYMENT_RECEIVED,
      txnId: trip.id,
      receiptId: `RC-${suffix}`,
      entityType: 'CUSTOMER',
      entityId: customer.id,
      debit: '0',
      credit: '800000',
      balance: '0',
      note: 'Test payment',
    });

    await assert.rejects(
      updateTripFigures(trip.id, {
        legs: [],
        fuelMode: FuelMode.AUTO,
        fuelSupplementLiters: 0,
        tollsDiscount: 0,
        tollsAddition: 0,
        tollsStations: 0,
        hasReturnCargo: false,
        customerId: newCustomer.id,
        expectedVersion: completed.version,
        userId: 1,
        userRole: Role.MANAGER,
      }),
      /đã phát sinh thanh toán/,
    );
  });

  test('updating external carrier details on a trip persists in the database', async () => {
    const { trip, customer } = await createInTransitTrip({
      revenue: 800_000,
      totalFuelCost: 100_000,
    });

    const updated = await updateTripFigures(trip.id, {
      legs: [],
      fuelMode: FuelMode.AUTO,
      fuelSupplementLiters: 0,
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: 0,
      hasReturnCargo: false,
      expectedVersion: trip.version,
      userId: 1,
      carrierType: 'EXTERNAL',
      externalCarrierId: customer.id,
      externalFreightCost: 600_000,
      externalPlateNumber: '29A-99999',
      externalDriverName: 'Driver X',
      externalDriverPhone: '0999999999',
    });

    assert.equal(updated.carrierType, 'EXTERNAL');
    assert.equal(updated.externalCarrierId, customer.id);
    assert.equal(updated.externalFreightCost, '600000');
    assert.equal(updated.externalPlateNumber, '29A-99999');
    assert.equal(updated.externalDriverName, 'Driver X');
    assert.equal(updated.externalDriverPhone, '0999999999');
  });
});
