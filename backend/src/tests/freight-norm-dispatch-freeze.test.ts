/**
 * Dispatch-time freight freeze for UI-configured terms whose surcharge
 * grounds (threshold mode / fuel-lag confirmation) are NOT yet confirmed —
 * the state every config-created customer×route sits in (catalog CRUD never
 * writes fuel_lag_confirmed; only quotation import does, 20260917_11 chain).
 *
 * Defect proven: the engine's surcharge gate degraded the WHOLE freight to
 * MANUAL-0 BEFORE the fuel-norm lookup ran, and the snapshot view then
 * mislabeled that state as "Thiếu định mức tiêu hao dầu" — while the norm
 * rows were valid (census-proven). Contract under the freight-grounds vs
 * surcharge-grounds split:
 *   - freight computes from ITS OWN grounds (rate terms + base price row);
 *   - the norm lookup RUNS at issue (fuel_norm_id trace recorded);
 *   - unconfirmed surcharge grounds NEVER APPLY: surcharge stays 0, period
 *     id stays 0;
 *   - the read-side formula states the pending truth, not a wrong
 *     missing-norm message.
 * Confirmed-grounds terms keep the full AUTO path byte-identical.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { db, client } from '../db';
import * as s from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { Role, computeFreightRate } from '@tingting/shared';

import { createShipment } from '../services/shipment-create.service';
import { batchUpsertShipmentContainers } from '../services/shipment-containers.service';
import {
  lockShipmentFreightRate,
  getShipmentFreightRateView,
} from '../services/freight-rate-snapshot-lifecycle.service';

const suffix = `fndf-${Date.now().toString(36)}`;

const TERMS_EFF = '2027-06-01';
const NORM_LATE_EFF = '2027-06-09';
const NORM_EARLY_EFF = '2027-06-01';
const TRANSPORT_DATE = '2027-06-26';

const BASE_LIGHT = '1000000';
const BASE_HEAVY = '2000000';
const BASE_FUEL = '17842.5926';
const FUEL_PRICE = '22000';

let adminId = 0;
let containerType20Id = 0;
let customerPending = 0;
let customerConfirmed = 0;
let routeLight = 0;
let routeConfirmed = 0;
let baseNormId = 0;

const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTermsIds: number[] = [];
const createdPricingIds: number[] = [];
const createdNormIds: number[] = [];
const createdFuelPeriodIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdSnapshotIds: number[] = [];

async function mkCustomer(label: string) {
  const [c] = await db.insert(s.customers)
    .values({ name: `FreightNorm ${label} ${suffix}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute(label: string) {
  const [r] = await db.insert(s.routes)
    .values({ name: `FreightNorm route ${label} ${suffix}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}

/** Defect-state terms: UNSET threshold mode + unconfirmed fuel lag. */
async function mkTermsPending(customerId: number, routeId: number) {
  const [t] = await db.insert(s.freightRateTerms).values({
    customerId,
    routeId,
    sharePct: '0',
    billingKmOneWay: 100,
    billingKmMultiplier: '2',
    baseFuelPrice: BASE_FUEL,
    fuelLagDays: 1,
    fuelLagConfirmed: false,
    surchargeThresholdMode: 'UNSET',
    surchargeThresholdPct: null,
    surchargeThresholdAbs: null,
    effectiveDate: TERMS_EFF,
    note: `FreightNorm pending terms ${suffix}`,
  }).returning();
  createdTermsIds.push(t.id);
  return t;
}

/** Control terms: confirmed grounds — the full-AUTO contract. */
async function mkTermsConfirmed(customerId: number, routeId: number) {
  const [t] = await db.insert(s.freightRateTerms).values({
    customerId,
    routeId,
    sharePct: '0',
    billingKmOneWay: 100,
    billingKmMultiplier: '2',
    baseFuelPrice: BASE_FUEL,
    fuelLagDays: 0,
    fuelLagConfirmed: true,
    surchargeThresholdMode: 'NONE',
    surchargeThresholdPct: null,
    surchargeThresholdAbs: null,
    effectiveDate: TERMS_EFF,
  }).returning();
  createdTermsIds.push(t.id);
  return t;
}

async function mkPricing(customerId: number, routeId: number, rateKey: string, price: string) {
  const [p] = await db.insert(s.pricingTables).values({
    customerId, routeId, rateKey, price, effectiveDate: TERMS_EFF,
  }).returning();
  createdPricingIds.push(p.id);
  return p;
}

async function classIdFor(code: string): Promise<number> {
  const [cls] = await db.select({ id: s.vehicleSizeClasses.id })
    .from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, code)).limit(1);
  assert.ok(cls, `vehicle class ${code} must exist (template seed)`);
  return cls.id;
}

async function mkNormAt(classCode: string, litersPerKm: string, effectiveDate: string) {
  const id = await classIdFor(classCode);
  const [n] = await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: id,
    litersPerKm,
    effectiveDate,
  }).returning();
  createdNormIds.push(n.id);
  return n;
}

async function mkFuelPeriod(unitPrice: string, effectiveFrom: string) {
  // fuel_price_periods.effective_from is globally unique — retry a day
  // forward on collision like the other suites.
  for (let attempt = 0; attempt < 60; attempt++) {
    const d = new Date(`${effectiveFrom}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + attempt);
    const iso = d.toISOString().slice(0, 10);
    const inserted = await db.insert(s.fuelPricePeriods)
      .values({ unitPrice, effectiveFrom: iso })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      createdFuelPeriodIds.push(inserted[0].id);
      return inserted[0];
    }
  }
  throw new Error(`could not find a free fuel period date near ${effectiveFrom}`);
}

async function mkShipment(customerId: number) {
  const shipment = await createShipment({
    isAdHoc: false,
    cargoMode: 'FCL',
    routeId: null,
    customerId,
  } as Parameters<typeof createShipment>[0]);
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function mkContainer(shipmentId: number, cargoWeightKg: number | null) {
  const [created] = await batchUpsertShipmentContainers(shipmentId, adminId, [{
    containerTypeId: containerType20Id,
    cargoWeightKg,
    routeId: routeLight,
    customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
  }]);
  return created;
}

async function mkContainerOnRoute(
  shipmentId: number,
  routeId: number,
  cargoWeightKg: number | null,
) {
  const [created] = await batchUpsertShipmentContainers(shipmentId, adminId, [{
    containerTypeId: containerType20Id,
    cargoWeightKg,
    routeId,
    customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
  }]);
  return created;
}

before(async () => {
  const [admin] = await db.insert(s.users).values({
    username: `fndf-admin-${suffix}`,
    passwordHash: 'test-only',
    role: Role.ADMIN,
    status: 'ACTIVE',
  }).returning({ id: s.users.id });
  adminId = admin.id;

  const [type20] = await db.insert(s.containerTypes)
    .values({ code: '20DC', name: "20'DC" })
    .onConflictDoNothing()
    .returning();
  if (type20) {
    containerType20Id = type20.id;
  } else {
    const [existing] = await db.select({ id: s.containerTypes.id })
      .from(s.containerTypes).where(eq(s.containerTypes.code, '20DC')).limit(1);
    assert.ok(existing, 'container type 20DC must exist');
    containerType20Id = existing.id;
  }

  // Pending-grounds world (the defect state: UNSET + unconfirmed lag).
  const custA = await mkCustomer('Pending');
  const routeA = await mkRoute('Pending');
  customerPending = custA.id;
  routeLight = routeA.id;
  await mkTermsPending(custA.id, routeA.id);
  await mkPricing(custA.id, routeA.id, 'CONT20.LIGHT', BASE_LIGHT);
  await mkPricing(custA.id, routeA.id, 'CONT20.HEAVY', BASE_HEAVY);

  // Confirmed-grounds world (control — full AUTO must stay identical).
  const custB = await mkCustomer('Confirmed');
  const routeB = await mkRoute('Confirmed');
  customerConfirmed = custB.id;
  routeConfirmed = routeB.id;
  await mkTermsConfirmed(custB.id, routeB.id);
  await mkPricing(custB.id, routeB.id, 'CONT20', '1500000');
  await mkPricing(custB.id, routeB.id, 'CONT20.LIGHT', '1500000');
  await mkFuelPeriod(FUEL_PRICE, '2027-06-20');

  // Norm family: base-class norm is the NEWEST row (must win the family
  // lookup), split norms sit earlier — staging shape, future-dated.
  baseNormId = (await mkNormAt('CONT20', '0.32', NORM_LATE_EFF)).id;
  await mkNormAt('CONT20.LIGHT', '0.32', NORM_EARLY_EFF);
  await mkNormAt('CONT20.HEAVY', '0.32', NORM_EARLY_EFF);
});

after(async () => {
  if (createdSnapshotIds.length) {
    await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.id, createdSnapshotIds));
  }
  if (createdShipmentIds.length) {
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdShipmentIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdShipmentIds));
  }
  if (createdNormIds.length) {
    await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, createdNormIds));
  }
  if (createdPricingIds.length) {
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingIds));
  }
  if (createdTermsIds.length) {
    await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.id, createdTermsIds));
  }
  if (createdFuelPeriodIds.length) {
    await db.delete(s.fuelPricePeriods).where(inArray(s.fuelPricePeriods.id, createdFuelPeriodIds));
  }
  if (createdRouteIds.length) {
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
  }
  if (createdCustomerIds.length) {
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
  }
  if (adminId) {
    await db.delete(s.users).where(eq(s.users.id, adminId));
  }
  await client.end();
});

/**
 * Freeze through the REAL dispatch path (requirePrice) and return the
 * post-freeze read model.
 */
async function freezeAndRead(shipmentId: number) {
  const outcome = await db.transaction(tx =>
    lockShipmentFreightRate(tx, { shipmentId, requirePrice: true }),
  );
  const view = await getShipmentFreightRateView(shipmentId);
  return { outcome, view };
}

describe('dispatch freeze with unconfirmed surcharge grounds (freight-grounds split)', () => {
  test('18t lot → freight = LIGHT base price, norm trace recorded, surcharge NEVER applied', async () => {
    const shipment = await mkShipment(customerPending);
    await mkContainer(shipment.id, 18_000);

    const { outcome, view } = await freezeAndRead(shipment.id);
    assert.ok(outcome, 'freeze must run (weight present)');
    createdSnapshotIds.push(view.latest!.id);
    assert.equal(outcome.source, 'AUTO', 'freight IS auto-computed from its own grounds');
    assert.equal(outcome.totalAmount, 1_000_000);
    assert.equal(view.latest!.freightAmount, 1_000_000, 'LIGHT base price column');
    assert.equal(view.latest!.surchargeAmount, 0, 'unconfirmed surcharge must NEVER apply');
    assert.equal(view.latest!.fuelPricePeriodId, 0, 'no fuel period consumed without confirmed grounds');
    assert.equal(view.latest!.fuelNormId, baseNormId, 'norm lookup must run at issue (newest family row wins)');
    assert.equal(view.latest!.source, 'AUTO');
    assert.match(view.latest!.formula, /chờ xác nhận/, 'view states the pending truth');
    assert.doesNotMatch(view.latest!.formula, /Thiếu định mức tiêu hao dầu/, 'the mislabel is gone');
    assert.equal(view.latest!.billedKm, 200);
    assert.equal(view.latest!.liters, 64);
  });

  test('20.0t lot → HEAVY column with the same pending semantics', async () => {
    const shipment = await mkShipment(customerPending);
    await mkContainer(shipment.id, 20_000);

    const { outcome, view } = await freezeAndRead(shipment.id);
    assert.ok(outcome);
    createdSnapshotIds.push(view.latest!.id);
    assert.equal(outcome.source, 'AUTO');
    assert.equal(view.latest!.freightAmount, 2_000_000);
    assert.equal(view.latest!.surchargeAmount, 0);
    assert.equal(view.latest!.fuelPricePeriodId, 0);
    assert.equal(view.latest!.fuelNormId, baseNormId);
  });

  test('missing weight → 409 "Thiếu trọng tải" unchanged (guard pin)', async () => {
    const shipment = await mkShipment(customerPending);
    await mkContainer(shipment.id, null);

    await assert.rejects(
      () => db.transaction(tx => lockShipmentFreightRate(tx, { shipmentId: shipment.id, requirePrice: true })),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Thiếu trọng tải/);
        return true;
      },
    );
  });

  test('confirmed grounds → full AUTO unchanged (surcharge + period trace, rebuild formula)', async () => {
    const shipment = await mkShipment(customerConfirmed);
    await mkContainerOnRoute(shipment.id, routeConfirmed, 18_000);

    const { outcome, view } = await freezeAndRead(shipment.id);
    assert.ok(outcome);
    createdSnapshotIds.push(view.latest!.id);
    const expected = computeFreightRate({
      basePrice: 1_500_000,
      sharePct: 0,
      fuelPrice: 22_000,
      baseFuelPrice: 17_842.5926,
      liters: 200 * 0.32,
    });
    assert.equal(outcome.source, 'AUTO');
    assert.equal(view.latest!.freightAmount, expected.freight);
    assert.ok(view.latest!.surchargeAmount > 0, 'control must APPLY surcharge');
    assert.ok(view.latest!.fuelPricePeriodId > 0, 'control consumes the fuel period');
    assert.ok(view.latest!.fuelNormId > 0);
    assert.doesNotMatch(view.latest!.formula, /chờ xác nhận/, 'confirmed terms carry no pending note');
    assert.match(view.latest!.formula, /MAX\(0/, 'confirmed terms rebuild the engine formula');
  });
});
