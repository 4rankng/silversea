import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { seedDemoFreightPricing } from '../seed/seed-demo-freight-pricing';
import { resolveFreightRate } from '../services/freight-pricing-engine.service';

// D4 demo-pricing seed: converges the LONG MINH demo chain (threshold modes,
// lag, norms, anchors) and leaves foreign fixture rows alone. Since the
// 2026-09-20 NO-SEED ruling (card 20260920_29) the seed leaves the 15T rung
// blank — the engine must answer MANUAL for 15T exactly like prod.
const CANONICAL_CLASS_CODES = ['1.25T', '2.5T', '3.5T', '5T', '8T', '10T', '15T', 'CONT20', 'CONT40'];
const ROUTE_NAMES = ['Hải Phòng-NEWEB', 'ASKEY', 'SUNRISE+  SJ'] as const;
const LONG_MINH_NAME = 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH';

let customerId = 0;
const routeIds: Record<string, number> = {};
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

  test('converges idempotently and leaves NO active 15T rows (NO-SEED)', async () => {
    await seedDemoFreightPricing();
    await seedDemoFreightPricing();

    // Two runs must not create 15T rows — invented ladder prices read as real
    // contract data (card 20260920_29). Any 15T row here would be a regression.
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
    const active15T = rows15T.filter((r) => r.deletedAt === null);
    assert.equal(active15T.length, 0, JSON.stringify(rows15T));
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

  test('engine resolves 15T as MANUAL (missing base price) on all 3 routes', async () => {
    const transportDate = new Date().toISOString().slice(0, 10);
    for (const name of ROUTE_NAMES) {
      const result = await resolveFreightRate({
        customerId,
        routeId: routeIds[name],
        vehicleSizeClassCode: '15T',
        transportDate,
      });
      // NO-SEED: the 15T rung is blank everywhere, so the engine answers
      // MANUAL with the missing-base-price reason on every environment —
      // exactly like prod (PRD CuocPhiPhuPhiDau §5: missing data, not
      // policy). The lag/threshold MANUAL paths keep their own pins in the
      // surcharge-threshold-confirmation suite.
      assert.equal(result.source, 'MANUAL', `${name}: ${result.formula}`);
      assert.match(result.formula, /Thiếu giá gốc cho 15T/);
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
