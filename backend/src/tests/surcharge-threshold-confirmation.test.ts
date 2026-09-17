import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import { resolveFreightRate } from '../services/freight-pricing-engine.service';
import { seedDemoFreightPricing } from '../seed/seed-demo-freight-pricing';
import { disconnectRedis } from '../lib/redis';

const LONG_MINH_NAME = 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH';
const NEWEB_ROUTE = 'Hải Phòng-NEWEB';
let customerId = 0;
let newebRouteId = 0;

async function setNewebTerms(mode: string, lagConfirmed: boolean) {
  await db.update(s.freightRateTerms)
    .set({ surchargeThresholdMode: mode, fuelLagConfirmed: lagConfirmed })
    .where(and(
      eq(s.freightRateTerms.customerId, customerId),
      eq(s.freightRateTerms.routeId, newebRouteId),
      eq(s.freightRateTerms.effectiveDate, '2026-09-09'),
    ));
}

after(async () => {
  await client.end();
  await disconnectRedis();
});

describe('surcharge threshold confirmation (20260917_11 criterion 5)', () => {
  before(async () => {
    await seedDemoFreightPricing();
    const [customer] = await db.select({ id: s.customers.id })
      .from(s.customers)
      .where(eq(s.customers.name, LONG_MINH_NAME))
      .limit(1);
    assert.ok(customer, 'demo customer must exist');
    customerId = customer.id;
    const [route] = await db.select({ id: s.routes.id })
      .from(s.routes)
      .where(eq(s.routes.name, NEWEB_ROUTE))
      .limit(1);
    assert.ok(route, 'demo route must exist');
    newebRouteId = route.id;
  });

  test('UNSET terms → MANUAL, never auto-applied', async () => {
    await setNewebTerms('UNSET', false);
    const result = await resolveFreightRate({
      customerId,
      routeId: newebRouteId,
      vehicleSizeClassCode: '15T',
      transportDate: '2026-09-09',
    });
    assert.equal(result.source, 'MANUAL');
    assert.match(result.formula, /chưa được khách chốt/);
  });

  test('confirmed NONE → auto-computes (no threshold gate)', async () => {
    await setNewebTerms('NONE', true);
    const result = await resolveFreightRate({
      customerId,
      routeId: newebRouteId,
      vehicleSizeClassCode: '15T',
      transportDate: '2026-09-09',
    });
    assert.equal(result.source, 'AUTO');
  });

  test('confirmed PCT → threshold applies (also reaches compute)', async () => {
    await setNewebTerms('PCT', true);
    const result = await resolveFreightRate({
      customerId,
      routeId: newebRouteId,
      vehicleSizeClassCode: '15T',
      transportDate: '2026-09-09',
    });
    assert.equal(result.source, 'AUTO');
    assert.equal(typeof result.total, 'number');
  });
});
