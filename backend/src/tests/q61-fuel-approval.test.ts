// Card 20260922_61 (ruling 8): the "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" workflow —
// period entry targets exactly active-quotation customers; the engine prices
// the OLD period until kế toán ticks Đồng ý; Không/Để sau keep the old price.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import {
  spawnQuotationFuelApprovals, decideQuotationFuelApprovals, listQuotationFuelApprovals,
} from '../services/quotation.service';
import { resolveFreightRate } from '../services/freight-pricing-engine.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-q61`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdClassIds: number[] = [];
const createdTermsIds: number[] = [];
const createdPricingIds: number[] = [];
const createdNormIds: number[] = [];
const createdPeriodIds: number[] = [];
const createdQuotationIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdUserId: number[] = [];

async function mkPricedCustomer(name: string) {
  const [customer] = await db.insert(s.customers).values({ name: `${name} ${suffix}` }).returning();
  createdCustomerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q61 route ${suffix} ${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [terms] = await db.insert(s.freightRateTerms).values({
    customerId: customer.id,
    routeId: route.id,
    sharePct: '2',
    billingKmOneWay: 100,
    billingKmMultiplier: '2',
    baseFuelPrice: '17842.5926',
    fuelLagDays: 0,
    fuelLagConfirmed: true,
    surchargeThresholdMode: 'PCT',
    surchargeThresholdPct: '5',
    effectiveDate: '2026-01-01',
    note: `Q61 ${suffix}`,
  }).returning();
  createdTermsIds.push(terms.id);
  const [cls] = await db.insert(s.vehicleSizeClasses).values({
    code: `E5T${suffix.replace(/\D/g, '').slice(-6)}${createdClassIds.length}`.slice(0, 20),
    name: `Q61 class ${createdClassIds.length}`,
  }).returning();
  createdClassIds.push(cls.id);
  const [pricing] = await db.insert(s.pricingTables).values({
    customerId: customer.id,
    routeId: route.id,
    rateKey: cls.code,
    price: '3000000',
    effectiveDate: '2026-01-01',
  }).returning();
  createdPricingIds.push(pricing.id);
  const [norm] = await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: cls.id,
    litersPerKm: '0.32',
    effectiveDate: '2026-01-01',
  }).returning();
  createdNormIds.push(norm.id);
  const [quotation] = await db.insert(s.quotations).values({
    customerId: customer.id,
    templateName: `Q61 mẫu ${createdQuotationIds.length}`,
    effectiveDate: '2026-01-01',
  }).returning();
  createdQuotationIds.push(quotation.id);
  return { customer, route, cls, quotation };
}

async function mkFuelPeriod(unitPrice: string, day: number) {
  const [period] = await db.insert(s.fuelPricePeriods).values({
    unitPrice,
    effectiveFrom: `2026-09-${String(day).padStart(2, '0')}`,
  }).returning();
  createdPeriodIds.push(period.id);
  return period;
}

async function mkActor() {
  const [user] = await db.insert(s.users).values({
    username: `q61-${suffix}-${createdUserId.length}`,
    passwordHash: 'test',
    role: Role.ACCOUNTANT,
    status: 'ACTIVE',
  }).returning();
  createdUserId.push(user.id);
  return user;
}

after(async () => {
  try {
    await db.delete(s.quotationFuelApprovals).where(inArray(s.quotationFuelApprovals.customerId, createdCustomerIds));
    await db.delete(s.quotationCells).where(inArray(s.quotationCells.quotationId, createdQuotationIds));
    await db.delete(s.quotations).where(inArray(s.quotations.id, createdQuotationIds));
    await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.shipmentId, createdShipmentIds));
    await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingIds));
    await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.id, createdTermsIds));
    await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, createdNormIds));
    await db.delete(s.fuelPricePeriods).where(inArray(s.fuelPricePeriods.id, createdPeriodIds));
    await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, createdClassIds));
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    await db.delete(s.users).where(inArray(s.users.id, createdUserId));
  } catch { /* best-effort */ }
  await client.end();
  await disconnectRedis();
});

describe('quotation fuel-update approvals (card 20260922_61, ruling 8)', () => {
  test('period entry targets exactly the active-quotation customers, idempotently', async () => {
    const a = await mkPricedCustomer('Q61 khách A');
    const b = await mkPricedCustomer('Q61 khách B');
    const period = await mkFuelPeriod('30000', 5);
    const created = await spawnQuotationFuelApprovals(period.id, db);
    assert.ok(created >= 2, 'both fixture customers targeted');
    const list = await listQuotationFuelApprovals('PENDING');
    const mine = list.items.filter((row) => row.fuelPricePeriodId === period.id
      && [a.customer.id, b.customer.id].includes(row.customerId));
    assert.equal(mine.length, 2, 'one PENDING row per targeted customer');
    assert.ok(mine.every((row) => row.customerName && row.periodUnitPrice === '30000.00'), 'list carries render names');
    const again = await spawnQuotationFuelApprovals(period.id, db);
    const after = await listQuotationFuelApprovals('PENDING');
    const mineAfter = after.items.filter((row) => row.fuelPricePeriodId === period.id
      && [a.customer.id, b.customer.id].includes(row.customerId));
    assert.equal(mineAfter.length, 2, 're-entry creates no duplicates');
    void again;
  });

  test('engine prices the OLD period while PENDING, NEW after Đồng ý', async () => {
    const a = await mkPricedCustomer('Q61 giá cũ/khác');
    const oldPeriod = await mkFuelPeriod('20000', 1);
    const newPeriod = await mkFuelPeriod('30000', 3);
    await spawnQuotationFuelApprovals(newPeriod.id, db);
    const list = await listQuotationFuelApprovals('PENDING');
    const mine = list.items.find((row) => row.customerId === a.customer.id
      && row.fuelPricePeriodId === newPeriod.id);
    assert.ok(mine, 'the customer is targeted for the new period');
    // PENDING: the new period stays invisible to this customer's pricing.
    const before = await resolveFreightRate({
      customerId: a.customer.id,
      routeId: a.route.id,
      vehicleSizeClassCode: a.cls.code,
      transportDate: '2026-09-04',
    });
    assert.equal(before.fuelPricePeriodId, oldPeriod.id, 'PENDING → old period prices');
    // Không (DECLINED): still the old period.
    await decideQuotationFuelApprovals(1, [mine.id], 'DECLINED', db);
    const declined = await resolveFreightRate({
      customerId: a.customer.id,
      routeId: a.route.id,
      vehicleSizeClassCode: a.cls.code,
      transportDate: '2026-09-04',
    });
    assert.equal(declined.fuelPricePeriodId, oldPeriod.id, 'DECLINED → old period holds');
    // Đồng ý (AGREED): the watermark advances — trips priced from now use it.
    const [row] = await db.select().from(s.quotationFuelApprovals)
      .where(eq(s.quotationFuelApprovals.id, mine.id));
    await db.update(s.quotationFuelApprovals).set({ status: 'PENDING' }).where(eq(s.quotationFuelApprovals.id, mine.id));
    await decideQuotationFuelApprovals(1, [mine.id], 'AGREED', db);
    void row;
    const agreed = await resolveFreightRate({
      customerId: a.customer.id,
      routeId: a.route.id,
      vehicleSizeClassCode: a.cls.code,
      transportDate: '2026-09-04',
    });
    assert.equal(agreed.fuelPricePeriodId, newPeriod.id, 'Đồng ý → new period applies');
  });

  test('batch decide updates many rows with actor + timestamp', async () => {
    const a = await mkPricedCustomer('Q61 batch 1');
    const b = await mkPricedCustomer('Q61 batch 2');
    const period = await mkFuelPeriod('31000', 7);
    await spawnQuotationFuelApprovals(period.id, db);
    const actor = await mkActor();
    const list = await listQuotationFuelApprovals('PENDING');
    const mine = list.items.filter((row) => row.fuelPricePeriodId === period.id
      && [a.customer.id, b.customer.id].includes(row.customerId));
    assert.equal(mine.length, 2);
    const result = await decideQuotationFuelApprovals(actor.id, mine.map((row) => row.id), 'AGREED', db);
    assert.equal(result.updated.length, 2);
    const rows = await db.select().from(s.quotationFuelApprovals)
      .where(inArray(s.quotationFuelApprovals.id, mine.map((row) => row.id)));
    assert.ok(rows.every((row) => row.status === 'AGREED' && row.decidedBy === actor.id && row.decidedAt != null));
  });

  test('decide with no ids is rejected', async () => {
    await assert.rejects(
      () => decideQuotationFuelApprovals(1, [], 'AGREED', db),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 400,
    );
  });
});
