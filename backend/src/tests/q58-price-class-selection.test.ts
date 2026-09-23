// Card 20260922_58 selection half: the lot money path picks the price column
// from container type + cargo weight (QA case 06: 18t→nhẹ, 22t→nặng,
// 20,0t→NẶNG kill-pin, missing→"Thiếu trọng tải" block, liters never change).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { lockShipmentFreightRate } from '../services/freight-rate-snapshot-lifecycle.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-q58`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdContainerTypeIds: number[] = [];
const createdContainerIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdTermsIds: number[] = [];
const createdPricingIds: number[] = [];
const createdNormIds: number[] = [];
const createdFuelPeriodIds: number[] = [];
const createdSnapshotIds: number[] = [];

/** Canonical catalog rows are seeded (global-unique codes) — reuse them. */
async function classIdByCode(code: string): Promise<number> {
  const [existing] = await db.select({ id: s.vehicleSizeClasses.id })
    .from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, code))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(s.vehicleSizeClasses).values({ code, name: `Q58 ${code}` }).returning();
  return created.id;
}

async function mkTerms(customerId: number, routeId: number) {
  const [t] = await db.insert(s.freightRateTerms).values({
    customerId,
    routeId,
    sharePct: '2',
    billingKmOneWay: 100,
    billingKmMultiplier: '2',
    baseFuelPrice: '17842.5926',
    fuelLagDays: 0,
    fuelLagConfirmed: true,
    surchargeThresholdMode: 'PCT',
    surchargeThresholdPct: '5',
    effectiveDate: '2026-01-01',
    note: `Q58 terms ${suffix}`,
  }).returning();
  createdTermsIds.push(t.id);
  return t;
}

async function mkPricing(customerId: number, routeId: number, rateKey: string, price: string) {
  const [p] = await db.insert(s.pricingTables).values({
    customerId,
    routeId,
    rateKey,
    price,
    effectiveDate: '2026-01-01',
  }).returning();
  createdPricingIds.push(p.id);
  return p;
}

async function mkNorm(classId: number, litersPerKm: string) {
  const [existing] = await db.select({ id: s.fuelConsumptionNorms.id })
    .from(s.fuelConsumptionNorms)
    .where(and(
      eq(s.fuelConsumptionNorms.vehicleSizeClassId, classId),
      eq(s.fuelConsumptionNorms.effectiveDate, '2026-01-01'),
    ))
    .limit(1);
  if (existing) return existing;
  const [n] = await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: classId,
    litersPerKm,
    effectiveDate: '2026-01-01',
  }).returning();
  createdNormIds.push(n.id);
  return n;
}

async function mkFuelPeriod(unitPrice: string, dayOffset: number) {
  const [f] = await db.insert(s.fuelPricePeriods).values({
    unitPrice,
    effectiveFrom: `2026-08-${String(10 + dayOffset).padStart(2, '0')}`,
  }).returning();
  createdFuelPeriodIds.push(f.id);
  return f;
}

/** One priced container lot: shipment + typed container with cargo weight. */
async function mkLot(input: { baseRateKey: string; cargoWeightKg: number | null; cont20LightPrice?: string; cont20HeavyPrice?: string; cont20BasePrice?: string }) {
  const [customer] = await db.insert(s.customers).values({ name: `Q58 customer ${suffix} ${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q58 route ${suffix} ${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  await mkTerms(customer.id, route.id);
  await mkNorm(await classIdByCode(input.baseRateKey), input.baseRateKey === 'CONT40' ? '0.35' : '0.32');
  await mkPricing(customer.id, route.id, input.baseRateKey, input.cont20BasePrice ?? '3000000');
  if (input.cont20LightPrice != null) await mkPricing(customer.id, route.id, `${input.baseRateKey}.LIGHT`, input.cont20LightPrice);
  if (input.cont20HeavyPrice != null) await mkPricing(customer.id, route.id, `${input.baseRateKey}.HEAVY`, input.cont20HeavyPrice);
  const typeCode = input.baseRateKey === 'CONT40' ? '40DC' : '20DC';
  const [existingType] = await db.select({ id: s.containerTypes.id })
    .from(s.containerTypes)
    .where(eq(s.containerTypes.code, typeCode))
    .limit(1);
  let containerTypeId = existingType?.id;
  if (containerTypeId == null) {
    const [createdType] = await db.insert(s.containerTypes).values({
      code: typeCode,
      name: `Q58 type ${suffix} ${createdContainerTypeIds.length}`,
    }).returning();
    createdContainerTypeIds.push(createdType.id);
    containerTypeId = createdType.id;
  }
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `Q58-${suffix}-${createdShipmentIds.length}`,
    customerId: customer.id,
    routeId: route.id,
    status: 'DISPATCHED',
    expectedDeliveryDate: '2026-09-01',
  }).returning();
  createdShipmentIds.push(shipment.id);
  const [container] = await db.insert(s.shipmentContainers).values({
    shipmentId: shipment.id,
    containerTypeId,
    routeId: route.id,
    cargoWeightKg: input.cargoWeightKg != null ? String(input.cargoWeightKg) : null,
    containerNumber: `Q58${createdContainerIds.length}${suffix.slice(-4)}`.toUpperCase().slice(0, 11),
  }).returning();
  createdContainerIds.push(container.id);
  return { customer, route, shipment, container };
}

after(async () => {
  try {
    await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.shipmentId, createdShipmentIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.id, createdContainerIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
    await db.delete(s.containerTypes).where(inArray(s.containerTypes.id, createdContainerTypeIds));
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingIds));
    await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.id, createdTermsIds));
    await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, createdNormIds));
    await db.delete(s.fuelPricePeriods).where(inArray(s.fuelPricePeriods.id, createdFuelPeriodIds));
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  } catch { /* best-effort */ }
  await client.end();
  await disconnectRedis();
});

describe('container price-class selection at lot pricing (card 20260922_58)', () => {
  test('18t → LIGHT column, liters unchanged', async () => {
    const lot = await mkLot({ baseRateKey: 'CONT20', cargoWeightKg: 18000, cont20LightPrice: '3900000', cont20HeavyPrice: '4200000', cont20BasePrice: '3000000' });
    const outcome = await db.transaction((tx) => lockShipmentFreightRate(tx, { shipmentId: lot.shipment.id, shipmentContainerId: lot.container.id }));
    assert.ok(outcome, 'the lot prices');
    const [snap] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.shipmentId, lot.shipment.id));
    assert.equal(Number(snap.freightAmount), 3_978_000, `18t prices the LIGHT column; formula: ${outcome.formula}`);
    assert.equal(Number(snap.liters), 64, 'liters stay 64 (norm keyed on the BASE class)');
  });

  test('22t → HEAVY column, liters unchanged', async () => {
    const lot = await mkLot({ baseRateKey: 'CONT20', cargoWeightKg: 22000, cont20LightPrice: '3900000', cont20HeavyPrice: '4200000' });
    const outcome = await db.transaction((tx) => lockShipmentFreightRate(tx, { shipmentId: lot.shipment.id, shipmentContainerId: lot.container.id }));
    assert.ok(outcome);
    const [snap] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.shipmentId, lot.shipment.id));
    assert.equal(Number(snap.freightAmount), 4_284_000, '22t prices the HEAVY column (4.200.000 × 1.02)');
    assert.equal(Number(snap.liters), 64);
  });

  test('20,0t exactly → HEAVY (boundary kill-pin)', async () => {
    const lot = await mkLot({ baseRateKey: 'CONT20', cargoWeightKg: 20000, cont20LightPrice: '3900000', cont20HeavyPrice: '4200000' });
    await db.transaction((tx) => lockShipmentFreightRate(tx, { shipmentId: lot.shipment.id, shipmentContainerId: lot.container.id }));
    const [snap] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.shipmentId, lot.shipment.id));
    assert.equal(Number(snap.freightAmount), 4_284_000, 'exactly 20,0t is NẶNG (≥20 heavy — ruling 4a)');
  });

  test('missing cargo weight: pricing is SKIPPED deterministically — no freeze, no invented price (ruling c)', async () => {
    const lot = await mkLot({ baseRateKey: 'CONT20', cargoWeightKg: null, cont20LightPrice: '3900000', cont20HeavyPrice: '4200000' });
    const outcome = await db.transaction((tx) => lockShipmentFreightRate(tx, { shipmentId: lot.shipment.id, shipmentContainerId: lot.container.id }));
    assert.equal(outcome, null, 'missing weight → no freeze at all (deterministic absence, ruling c)');
    const snaps = await db.select({ id: s.freightRateSnapshots.id })
      .from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.shipmentId, lot.shipment.id));
    assert.equal(snaps.length, 0, 'no snapshot row is written — nothing priced by guesswork');
  });

  test('base-only customer inherits the base row at both weights (no 4-class grid)', async () => {
    const lot = await mkLot({ baseRateKey: 'CONT20', cargoWeightKg: 22000, cont20BasePrice: '3000000' });
    const outcome = await db.transaction((tx) => lockShipmentFreightRate(tx, { shipmentId: lot.shipment.id, shipmentContainerId: lot.container.id }));
    assert.ok(outcome);
    const [snap] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.shipmentId, lot.shipment.id));
    assert.equal(Number(snap.freightAmount), 3_060_000, 'no heavy row → base price inherited (3.000.000 × 1.02)');
    assert.match(outcome.formula, /kế thừa|giá tạm/, 'the formula records the inheritance (giá tạm doctrine)');
  });

  test('non-container classes price untouched (no weight requirement)', async () => {
    const lot = await mkLot({ baseRateKey: 'CONT20', cargoWeightKg: null });
    const overrideKey = ('E5T' + suffix.replace(/\D/g, '').slice(-8)).slice(0, 20);
    const classId = await classIdByCode(overrideKey);
    await mkPricing(lot.customer.id, lot.route.id, overrideKey, '1500000');
    await mkNorm(classId, '0.15');
    const outcome = await db.transaction((tx) => lockShipmentFreightRate(tx, {
      shipmentId: lot.shipment.id,
      shipmentContainerId: lot.container.id,
      rateKeyOverride: overrideKey,
    }));
    assert.ok(outcome, 'a non-container override prices without any cargo weight');
    const [snap] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.shipmentId, lot.shipment.id));
    assert.equal(Number(snap.freightAmount), 1_530_000, '1.500.000 × 1.02');
  });
});
