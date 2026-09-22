import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { resolveFreightRate } from '../services/freight-pricing-engine.service';

const fixtureKey = randomUUID();
const vehicleClassCode = `ST${fixtureKey.replace(/-/g, '').slice(0, 16)}`;
let fixture: {
  customerId: number; routeId: number; vehicleClassId: number; termsId: number;
  priceId: number; normId: number; fuelPeriodId: number; transportDate: string;
} | undefined;

async function setTerms(mode: 'UNSET' | 'NONE' | 'PCT', lagConfirmed: boolean) {
  assert.ok(fixture);
  await db.update(s.freightRateTerms)
    .set({
      surchargeThresholdMode: mode,
      surchargeThresholdPct: mode === 'PCT' ? '5' : null,
      surchargeThresholdAbs: null,
      fuelLagConfirmed: lagConfirmed,
    })
    .where(eq(s.freightRateTerms.id, fixture.termsId));
}

async function resolveFixtureRate() {
  assert.ok(fixture);
  return resolveFreightRate({
    customerId: fixture.customerId,
    routeId: fixture.routeId,
    vehicleSizeClassCode: vehicleClassCode,
    transportDate: fixture.transportDate,
  });
}

after(async () => {
  try {
    if (fixture) {
      await db.transaction(async tx => {
        await tx.delete(s.fuelPricePeriods).where(eq(s.fuelPricePeriods.id, fixture!.fuelPeriodId));
        await tx.delete(s.fuelConsumptionNorms).where(eq(s.fuelConsumptionNorms.id, fixture!.normId));
        await tx.delete(s.pricingTables).where(eq(s.pricingTables.id, fixture!.priceId));
        await tx.delete(s.freightRateTerms).where(eq(s.freightRateTerms.id, fixture!.termsId));
        await tx.delete(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, fixture!.vehicleClassId));
        await tx.delete(s.routes).where(eq(s.routes.id, fixture!.routeId));
        await tx.delete(s.customers).where(eq(s.customers.id, fixture!.customerId));
      });
    }
  } finally {
    await client.end();
  }
});

describe('surcharge threshold confirmation (20260917_11 criterion 5)', () => {
  before(async () => {
    // This contract requires a complete price chain. Demo seeds intentionally
    // leave unsupported business rates absent, so own every prerequisite here.
    fixture = await db.transaction(async tx => {
      const [customer] = await tx.insert(s.customers).values({ name: `Threshold customer ${fixtureKey}` }).returning();
      const [route] = await tx.insert(s.routes).values({ name: `Threshold route ${fixtureKey}` }).returning();
      const [vehicleClass] = await tx.insert(s.vehicleSizeClasses).values({ code: vehicleClassCode, name: `Threshold ${vehicleClassCode}` }).returning();
      const [terms] = await tx.insert(s.freightRateTerms).values({
        customerId: customer.id, routeId: route.id, sharePct: '2', billingKmOneWay: 50,
        billingKmMultiplier: '2', baseFuelPrice: '18000', fuelLagDays: 0,
        fuelLagConfirmed: false, surchargeThresholdMode: 'UNSET', effectiveDate: '2026-01-01',
      }).returning();
      const [price] = await tx.insert(s.pricingTables).values({
        customerId: customer.id, routeId: route.id, rateKey: vehicleClassCode,
        price: '2000000', effectiveDate: '2026-01-01',
      }).returning();
      const [norm] = await tx.insert(s.fuelConsumptionNorms).values({
        vehicleSizeClassId: vehicleClass.id, litersPerKm: '0.3', effectiveDate: '2026-01-01',
      }).returning();
      // A globally keyed fuel period needs its own date too. Conflict-safe
      // insertion reserves an unused future date without changing any seed row.
      const fuelDate = new Date('8000-01-01T00:00:00.000Z');
      fuelDate.setUTCDate(fuelDate.getUTCDate() + Number.parseInt(fixtureKey.slice(0, 6), 16) % 100000);
      let fuel: typeof s.fuelPricePeriods.$inferSelect | undefined;
      for (let attempts = 0; attempts < 100 && !fuel; attempts += 1) {
        [fuel] = await tx.insert(s.fuelPricePeriods).values({
          unitPrice: '22000', effectiveFrom: fuelDate.toISOString().slice(0, 10),
          sourceNote: `Threshold fixture ${fixtureKey}`,
        }).onConflictDoNothing().returning();
        if (!fuel) fuelDate.setUTCDate(fuelDate.getUTCDate() + 1);
      }
      assert.ok(fuel, 'reserved a unique fixture fuel period');
      return {
        customerId: customer.id, routeId: route.id, vehicleClassId: vehicleClass.id,
        termsId: terms.id, priceId: price.id, normId: norm.id,
        fuelPeriodId: fuel.id, transportDate: fuel.effectiveFrom,
      };
    });
  });

  test('UNSET terms → MANUAL, never auto-applied', async () => {
    await setTerms('UNSET', false);
    const result = await resolveFixtureRate();
    assert.equal(result.source, 'MANUAL');
    assert.match(result.formula, /chưa được khách chốt/);
    assert.equal(result.pricingTableId, fixture!.priceId);
  });

  test('confirmed NONE → auto-computes (no threshold gate)', async () => {
    await setTerms('NONE', true);
    const result = await resolveFixtureRate();
    assert.equal(result.source, 'AUTO');
    assert.equal(result.pricingTableId, fixture!.priceId);
    assert.equal(result.fuelPricePeriodId, fixture!.fuelPeriodId);
  });

  test('confirmed PCT → threshold applies (also reaches compute)', async () => {
    await setTerms('PCT', true);
    const result = await resolveFixtureRate();
    assert.equal(result.source, 'AUTO');
    assert.equal(typeof result.total, 'number');
    assert.equal(result.rateTermsId, fixture!.termsId);
  });
});
