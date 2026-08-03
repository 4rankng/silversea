import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { resolveShipmentPricingProjection } from '../services/pricing.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdTierIds: number[] = [];

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
    name: `P3 pricing customer ${suffix}-${createdCustomerIds.length}`,
    fuelSurchargeSharePct: '50.00',
  }).returning();
  createdCustomerIds.push(customer.id);
  return customer;
}

async function mkRoute() {
  const [route] = await db.insert(s.routes).values({
    name: `P3 pricing route ${suffix}-${createdRouteIds.length}`,
    defaultLegs: [{ origin: 'CT', destination: 'BD', km: 100, loadingType: 'HANG' }],
  }).returning();
  createdRouteIds.push(route.id);
  return route;
}

async function mkCargoType(isBulk: boolean) {
  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `P3 pricing cargo ${suffix}-${createdCargoTypeIds.length}`,
    isBulk,
  }).returning();
  createdCargoTypeIds.push(cargoType.id);
  return cargoType;
}

async function mkContainerType(code: string, name: string) {
  const [containerType] = await db.insert(s.containerTypes).values({
    code,
    name,
  }).returning();
  createdContainerTypeIds.push(containerType.id);
  return containerType;
}

async function mkPricingTable(customerId: number, routeId: number, price: string, containerTypeId?: number | null) {
  const [row] = await db.insert(s.pricingTables).values({
    customerId,
    routeId,
    price,
    effectiveDate: '2026-01-01',
    containerTypeId: containerTypeId ?? null,
  }).returning();
  createdPricingTableIds.push(row.id);
  return row;
}

async function mkTier(routeId: number, cargoTypeId: number, minKg: string, maxKg: string, pricePerKg: string) {
  const [row] = await db.insert(s.weightPricingTiers).values({
    routeId,
    cargoTypeId,
    minKg,
    maxKg,
    pricePerKg,
    effectiveDate: '2026-01-01',
  }).returning();
  createdTierIds.push(row.id);
  return row;
}

before(async () => {
  await ensureFuelConfig();
});

after(async () => {
  if (createdTierIds.length > 0) {
    await db.delete(s.weightPricingTiers).where(inArray(s.weightPricingTiers.id, createdTierIds));
  }
  if (createdPricingTableIds.length > 0) {
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
  }
  if (createdContainerTypeIds.length > 0) {
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
  }
  if (createdCargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
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

describe('phase 3 shipment pricing projection', () => {
  test('returns governed FCL freight and expected fuel surcharge from current authorities', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const containerType = await mkContainerType(`20GP-${suffix}`.slice(0, 20), 'Container 20 feet');
    await mkPricingTable(customer.id, route.id, '1200000', containerType.id);

    const projection = await resolveShipmentPricingProjection({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      containerCount: 2,
      containerTypeIds: [containerType.id, containerType.id],
      date: '2026-08-03',
    });

    assert.equal(projection.readiness, 'READY');
    assert.equal(projection.freightPrice, 2_400_000);
    assert.equal(projection.expectedFuelLiters, 200);
    assert.equal(projection.expectedFuelSurcharge, 500_000);
    assert.match(projection.message, /2.400.000/);
    assert.equal(projection.breakdown.length, 1);
    assert.equal(projection.breakdown[0]?.quantity, 2);
  });

  test('returns governed LCL weight-tier freight and expected fuel surcharge', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();
    const cargoType = await mkCargoType(true);
    await mkTier(route.id, cargoType.id, '0', '5000', '1000');

    const projection = await resolveShipmentPricingProjection({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'LCL',
      cargoTypeId: cargoType.id,
      cargoWeightKg: 1250,
      date: '2026-08-03',
    });

    assert.equal(projection.readiness, 'READY');
    assert.equal(projection.freightPrice, 1_250_000);
    assert.equal(projection.expectedFuelLiters, 100);
    assert.equal(projection.expectedFuelSurcharge, 250_000);
    assert.match(projection.freightFormula ?? '', /1250kg/);
  });

  test('surfaces missing freight authority without inventing a manual preview', async () => {
    const customer = await mkCustomer();
    const route = await mkRoute();

    const projection = await resolveShipmentPricingProjection({
      customerId: customer.id,
      routeId: route.id,
      cargoMode: 'FCL',
      containerCount: 1,
      containerTypeIds: [],
      date: '2026-08-03',
    });

    assert.equal(projection.readiness, 'MISSING_AUTHORITY');
    assert.equal(projection.freightPrice, null);
    assert.match(projection.message, /bảng giá cước/);
  });
});
