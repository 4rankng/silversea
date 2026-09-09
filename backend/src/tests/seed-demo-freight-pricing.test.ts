import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { seedDemoFreightPricing } from '../seed/seed-demo-freight-pricing';
import { resolveFreightRate } from '../services/freight-pricing-engine.service';

// D4 demo-pricing seed: converges the LONG MINH demo chain (15T base prices,
// threshold modes, lag) and leaves foreign fixture rows alone. Runs against
// the shared dev DB — the module is idempotent, so a second invocation must
// change nothing (the "converges" contract).
const CANONICAL_CLASS_CODES = ['1.25T', '2.5T', '3.5T', '5T', '8T', '10T', '15T', 'CONT20', 'CONT40'];
const ROUTE_NAMES = ['Hải Phòng-NEWEB', 'ASKEY', 'SUNRISE+  SJ'] as const;
const LONG_MINH_NAME = 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH';

const EXPECTED_15T_PRICE: Record<string, string> = {
  'Hải Phòng-NEWEB': '3500000',
  'ASKEY': '3400000',
  'SUNRISE+  SJ': '3500000',
};

// base price × (1 + sharePct/100)
const EXPECTED_15T_FREIGHT: Record<string, number> = {
  'Hải Phòng-NEWEB': 3_570_000,   // 3.5M × 1.02
  'ASKEY': 3_536_000,             // 3.4M × 1.04
  'SUNRISE+  SJ': 3_587_500,      // 3.5M × 1.025
};

let customerId = 0;
let routeIds: Record<string, number> = {};
let fixtureClassCountBefore = 0;

describe('seed-demo-freight-pricing (D4 demo chain convergence)', () => {
  before(async () => {
    const [customer] = await db.select({ id: s.customers.id })
      .from(s.customers)
      .where(and(eq(s.customers.name, LONG_MINH_NAME), isNull(s.customers.deletedAt)))
      .limit(1);
    assert.ok(customer, 'LONG MINH customer must exist (run the base seed first)');
    customerId = customer.id;

    const routes = await db.select({ id: s.routes.id, name: s.routes.name })
      .from(s.routes)
      .where(and(inArray(s.routes.name, [...ROUTE_NAMES]), isNull(s.routes.deletedAt)));
    for (const name of ROUTE_NAMES) {
      const route = routes.find((r) => r.name === name);
      assert.ok(route, `route ${name} must exist (run the base seed first)`);
      routeIds[name] = route.id;
    }

    // Fixture isolation proof: count non-canonical (QA/fullstack leftover)
    // vehicle classes before and after — the seed must not touch them.
    const classes = await db.select({ code: s.vehicleSizeClasses.code })
      .from(s.vehicleSizeClasses);
    fixtureClassCountBefore = classes.filter((c) => !CANONICAL_CLASS_CODES.includes(c.code)).length;
  });

  after(async () => {
    await client.end();
  });

  test('converges idempotently — two runs, one row set', async () => {
    await seedDemoFreightPricing();
    await seedDemoFreightPricing();

    // Exactly one 15T row per route (revive must not duplicate), active,
    // on the matrix rung, with the DEMO ladder price.
    const rows15T = await db.select({
      routeId: s.pricingTables.routeId,
      price: s.pricingTables.price,
      deletedAt: s.pricingTables.deletedAt,
    }).from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.rateKey, '15T'),
        eq(s.pricingTables.effectiveDate, '2026-07-30'),
      ));
    assert.equal(rows15T.length, ROUTE_NAMES.length, JSON.stringify(rows15T));
    for (const name of ROUTE_NAMES) {
      const row = rows15T.find((r) => r.routeId === routeIds[name]);
      assert.ok(row, `15T row for ${name}`);
      assert.equal(row.price, EXPECTED_15T_PRICE[name], `${name} DEMO 15T price`);
      assert.equal(row.deletedAt, null, `${name} 15T row must be active`);
    }
  });

  test('terms carry the D4 demo knobs: lag 1/0/0, all 3 threshold modes', async () => {
    const terms = await db.select()
      .from(s.freightRateTerms)
      .where(and(
        eq(s.freightRateTerms.customerId, customerId),
        inArray(s.freightRateTerms.routeId, Object.values(routeIds)),
        eq(s.freightRateTerms.effectiveDate, '2026-09-09'),
      ));
    assert.equal(terms.length, ROUTE_NAMES.length);

    const byRoute = new Map(terms.map((t) => [t.routeId, t]));
    const neweb = byRoute.get(routeIds['Hải Phòng-NEWEB'])!;
    assert.equal(neweb.fuelLagDays, 1);
    assert.equal(neweb.surchargeThresholdPct, '5.00');
    assert.equal(neweb.surchargeThresholdAbs, null);

    const askey = byRoute.get(routeIds['ASKEY'])!;
    assert.equal(askey.fuelLagDays, 0);
    assert.equal(askey.surchargeThresholdPct, null);
    assert.equal(askey.surchargeThresholdAbs, '1500.00');

    const sunrise = byRoute.get(routeIds['SUNRISE+  SJ'])!;
    assert.equal(sunrise.fuelLagDays, 0);
    assert.equal(sunrise.surchargeThresholdPct, null);
    assert.equal(sunrise.surchargeThresholdAbs, null);

    for (const t of terms) {
      assert.match(t.note ?? '', /DEMO/, 'terms note must be DEMO-flagged');
    }
  });

  test('engine resolves 15T as AUTO on all 3 demo routes', async () => {
    const transportDate = new Date().toISOString().slice(0, 10);
    for (const name of ROUTE_NAMES) {
      const result = await resolveFreightRate({
        customerId,
        routeId: routeIds[name],
        vehicleSizeClassCode: '15T',
        transportDate,
      });
      assert.equal(result.source, 'AUTO', `${name}: ${result.formula}`);
      assert.equal(Number(result.freight), EXPECTED_15T_FREIGHT[name], `${name} freight`);
      // Fuel is well above the base price, so every threshold mode adjusts.
      assert.ok(Number(result.surcharge) > 0, `${name} surcharge must be positive`);
      assert.ok(result.formula.length > 0, `${name} formula trace`);
    }
  });

  test('leaves fixture vehicle classes untouched', async () => {
    const classes = await db.select({ code: s.vehicleSizeClasses.code })
      .from(s.vehicleSizeClasses);
    const fixtureCountAfter = classes.filter((c) => !CANONICAL_CLASS_CODES.includes(c.code)).length;
    assert.equal(fixtureCountAfter, fixtureClassCountBefore);
    // Canonical catalog is complete after the seed.
    for (const code of CANONICAL_CLASS_CODES) {
      assert.ok(classes.some((c) => c.code === code), `canonical class ${code}`);
    }
  });
});
