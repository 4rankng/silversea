import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { FuelMode, LoadingType, TxnType } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import { createTrip, updateTripFigures } from '../services/trip-mutations.service';
import { buildTripRenderData, documentLedgerAdjustment } from '../services/billingDocument.service';
import { resolveFuelSurcharge } from '../services/pricing.service';
import { customerTripReceivableAmount, LedgerService } from '../services/ledger.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTripIds: number[] = [];

let originalFuelConfig: typeof s.fuelConfig.$inferSelect | null = null;
let createdFuelConfigId: number | null = null;

async function ensureFuelConfig() {
  const [existing] = await db.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1);
  if (existing) {
    originalFuelConfig = existing;
    await db.update(s.fuelConfig).set({
      loadedNorm: '100',
      emptyNorm: '100',
      supplement: '0',
      unitPrice: '25000',
      baseUnitPrice: '20000',
      warningThreshold: existing.warningThreshold,
      criticalThreshold: existing.criticalThreshold,
      updatedAt: new Date(),
    }).where(eq(s.fuelConfig.id, existing.id));
    return;
  }

  const [created] = await db.insert(s.fuelConfig).values({
    loadedNorm: '100',
    emptyNorm: '100',
    supplement: '0',
    unitPrice: '25000',
    baseUnitPrice: '20000',
    warningThreshold: '37',
    criticalThreshold: '40',
  }).returning();
  createdFuelConfigId = created.id;
}

async function mkCustomer() {
  const [customer] = await db.insert(s.customers).values({
    name: `Fuel surcharge customer ${suffix}-${createdCustomerIds.length}`,
    fuelSurchargeSharePct: '50.00',
  }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({
    name: `Fuel surcharge route ${suffix}-${createdRouteIds.length}`,
    defaultLegs: [{ origin: 'HP', destination: 'HN', km: 100, loadingType: 'HANG' }],
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkTrip(customerId: number, routeId: number) {
  const [trip] = await db.insert(s.trips).values({
    customerId,
    routeId,
    departureDate: '2026-08-02',
    fuelMode: 'AUTO',
    status: 'CREATED',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

before(async () => {
  await ensureFuelConfig();
});

after(async () => {
  if (createdTripIds.length > 0) {
    await db.delete(s.ledger).where(inArray(s.ledger.txnId, createdTripIds));
    await db.delete(s.tripLegs).where(inArray(s.tripLegs.tripId, createdTripIds));
    await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
  }
  if (createdRouteIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }

  if (createdFuelConfigId != null) {
    await db.delete(s.fuelConfig).where(eq(s.fuelConfig.id, createdFuelConfigId));
  } else if (originalFuelConfig) {
    await db.update(s.fuelConfig).set({
      loadedNorm: originalFuelConfig.loadedNorm,
      emptyNorm: originalFuelConfig.emptyNorm,
      supplement: originalFuelConfig.supplement,
      unitPrice: originalFuelConfig.unitPrice,
      baseUnitPrice: originalFuelConfig.baseUnitPrice,
      warningThreshold: originalFuelConfig.warningThreshold,
      criticalThreshold: originalFuelConfig.criticalThreshold,
      updatedAt: originalFuelConfig.updatedAt,
    }).where(eq(s.fuelConfig.id, originalFuelConfig.id));
  }

  await client.end();
});

describe('Phase 3 fuel surcharge', () => {
  test('resolveFuelSurcharge returns the amount and auditable snapshot', async () => {
    const customer = await mkCustomer();

    const result = await resolveFuelSurcharge({
      customerId: customer.id,
      fuelLiters: 100,
    });

    assert.equal(result.amount, 250000);
    assert.deepEqual(
      {
        currentFuelPrice: result.snapshot.currentFuelPrice,
        baseFuelPrice: result.snapshot.baseFuelPrice,
        quotaLiters: result.snapshot.quotaLiters,
        customerSharePct: result.snapshot.customerSharePct,
        customerId: result.snapshot.customerId,
      },
      {
        currentFuelPrice: 25000,
        baseFuelPrice: 20000,
        quotaLiters: 100,
        customerSharePct: 50,
        customerId: customer.id,
      },
    );
    assert.match(result.snapshot.computedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('updateTripFigures stores the surcharge amount and snapshot', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const trip = await mkTrip(customer.id, route.id);

    const updated = await updateTripFigures(trip.id, {
      expectedVersion: trip.version,
      legs: [
        { sequence: 1, origin: 'HP', destination: 'HN', km: 100, loadingType: LoadingType.HANG },
      ],
      fuelMode: FuelMode.AUTO,
      tollsDiscount: 0,
      tollsAddition: 0,
      tollsStations: 0,
      hasReturnCargo: false,
      driverSalary: 0,
      revenue: 1_000_000,
      twoPointDeliveryBonus: 0,
      vehicleShiftAllowance: 0,
    });

    assert.equal(updated.fuelSurchargeAmount, '250000');
    assert.equal(updated.fuelSurchargeSnapshotDirty, false);
    assert.deepEqual(
      updated.fuelSurchargeSnapshot,
      {
        currentFuelPrice: 25000,
        baseFuelPrice: 20000,
        quotaLiters: 100,
        customerSharePct: 50,
        customerId: customer.id,
        computedAt: updated.fuelSurchargeSnapshot?.computedAt,
      },
    );

    const renderData = buildTripRenderData({
      tripId: trip.id,
      trip: {
        tripCode: updated.tripCode,
        departureDate: updated.departureDate,
        routeName: null,
        notes: updated.notes,
        truckPlate: null,
        externalPlateNumber: null,
        fuelSurchargeAmount: updated.fuelSurchargeAmount,
      },
      containers: [],
      note: updated.notes,
    });
    assert.equal(renderData.fuelSurchargeAmount, 250000);
  });

  test('createTrip snapshots the automatic surcharge from the route fuel quota', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();

    const created = await createTrip({
      customerId: customer.id,
      routeId: route.id,
      departureDate: '2026-08-02',
      fuelMode: FuelMode.AUTO,
    });
    createdTripIds.push(created.id);

    assert.equal(created.fuelSurchargeAmount, '250000');
    assert.equal(created.fuelSurchargeSnapshotDirty, false);
    assert.deepEqual(created.fuelSurchargeSnapshot, {
      currentFuelPrice: 25000,
      baseFuelPrice: 20000,
      quotaLiters: 100,
      customerSharePct: 50,
      customerId: customer.id,
      computedAt: created.fuelSurchargeSnapshot?.computedAt,
    });
  });

  test('customer AR, debit-note authority, and reversal reconcile revenue plus incl-VAT surcharge exactly', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const trip = await mkTrip(customer.id, route.id);
    const revenue = '1000000';
    const fuelSurchargeAmount = '250000';
    const receivable = customerTripReceivableAmount(revenue, fuelSurchargeAmount);
    assert.equal(receivable, 1_250_000);

    await db.transaction(async (tx) => {
      const ledgerTrip = {
        id: trip.id,
        customerId: customer.id,
        driverId: null,
        tripCode: `FUEL-AR-${trip.id}`,
        departureDate: '2026-08-02',
        revenue,
        fuelSurchargeAmount,
        driverSalary: '0',
        carrierType: 'OWN',
        ancillaryFees: [],
      };
      await LedgerService.postTripCompletion(tx, ledgerTrip);
      await LedgerService.postTripCompletionReverse(tx, ledgerTrip);
    });

    const rows = await db.select({
      txnType: s.ledger.txnType,
      debit: s.ledger.debit,
      credit: s.ledger.credit,
    }).from(s.ledger).where(and(
      eq(s.ledger.txnId, trip.id),
      eq(s.ledger.entityType, 'CUSTOMER'),
      eq(s.ledger.entityId, customer.id),
    ));
    assert.deepEqual(rows.map((row) => ({
      txnType: row.txnType,
      debit: Number(row.debit),
      credit: Number(row.credit),
    })), [
      { txnType: TxnType.TRIP_REVENUE, debit: 1_250_000, credit: 0 },
      { txnType: TxnType.UNLOCK_REVERSAL, debit: 0, credit: 1_250_000 },
    ]);

    // The source-backed freight line is already represented in trip-lock AR,
    // so a stored debit note contributes no duplicate ledger adjustment.
    const canonicalLine = {
      sourceType: 'TRIP' as const,
      sourceId: trip.id,
      lineType: 'FREIGHT' as const,
      typeLabel: 'Doanh thu',
      unit: 'chuyến',
      description: 'Cước vận chuyển và phụ phí nhiên liệu',
      routeName: null,
      containerNumbers: null,
      renderData: { fuelSurchargeAmount: 250000 },
      baseAmount: receivable,
      amountOverride: null,
      excluded: false,
      sortOrder: 0,
    };
    assert.equal(documentLedgerAdjustment([canonicalLine]), 0);
    assert.equal(documentLedgerAdjustment([{ ...canonicalLine, amountOverride: 1_300_000 }]), 50_000);
  });
});
