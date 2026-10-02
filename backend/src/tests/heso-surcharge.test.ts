/**
 * Card 20260922_59 — per-cell Hệ số on the fuel surcharge (engine + snapshot).
 *
 * Contract: heSo multiplies the ENGINE surcharge only (Giá cos untouched);
 * heSo=1 is byte-identical to the pre-card engine (regression pin). The
 * snapshot carries the applied factor so the number explains itself.
 * Fixtures = Mẫu báo giá 1 worked numbers (fuel 29.940, base 17.842,5926).
 * Runs on an isolated throwaway DB; audit-free service-level suite.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  resolveFreightRate, persistFreightRateSnapshot,
} from '../services/freight-pricing-engine.service';
import { createQuotation } from '../services/quotation.service';

const suffix = `q59-${Date.now().toString(36)}`;
const ids = {
  customers: [] as number[],
  routes: [] as number[],
  classes: [] as number[],
  norms: [] as number[],
  terms: [] as number[],
  pricing: [] as number[],
  periods: [] as number[],
  quotations: [] as number[],
  snapshots: [] as number[],
};

let longMinhId = 0;
let logcomId = 0;
let routeAskey = 0;
let routeSunrise = 0;
let routeNeweb = 0;
const EFFECTIVE_DATE = '2026-09-15';

async function mkBase(classIdByCode: Map<string, number>): Promise<void> {
  const [customer] = await db.insert(s.customers).values({ name: `Q59 LONG MINH ${suffix}` }).returning();
  longMinhId = customer.id;
  ids.customers.push(customer.id);
  const [logcom] = await db.insert(s.customers).values({ name: `Q59 LOGCOM ${suffix}` }).returning();
  logcomId = logcom.id;
  ids.customers.push(logcom.id);
  for (const [i, name] of ['ASKEY', 'SUNRISE+  SJ', 'Hải Phòng-NEWEB'].entries()) {
    const [r] = await db.insert(s.routes).values({ name: `${name} ${suffix}` }).returning();
    if (i === 0) routeAskey = r.id;
    if (i === 1) routeSunrise = r.id;
    if (i === 2) routeNeweb = r.id;
    ids.routes.push(r.id);
  }
  const NORMS: Record<string, string> = {
    '1.25T': '0.1000', '2.5T': '0.1300', '3.5T': '0.1300', '5T': '0.1500',
    '8T': '0.2000', '10T': '0.2400', 'CONT20': '0.32', 'CONT40': '0.35',
  };
  for (const [code, litersPerKm] of Object.entries(NORMS)) {
    const [n] = await db.insert(s.fuelConsumptionNorms)
      .values({ vehicleSizeClassId: classIdByCode.get(code)!, litersPerKm, effectiveDate: '2026-01-01' })
      .returning();
    ids.norms.push(n.id);
  }
  for (const [customerId, routeId, km, share] of [
    [longMinhId, routeAskey, 100, '4.00'],
    [longMinhId, routeSunrise, 120, '2.50'],
    [logcomId, routeNeweb, 130, '2.00'],
  ] as const) {
    const [t] = await db.insert(s.freightRateTerms)
      .values({
        customerId, routeId, sharePct: share, billingKmOneWay: km, billingKmMultiplier: '2',
        baseFuelPrice: '17842.5926', fuelLagDays: 0, fuelLagConfirmed: true,
        surchargeThresholdMode: 'NONE', effectiveDate: '2026-07-30',
      }).returning();
    ids.terms.push(t.id);
  }
  for (const [customerId, routeId, rateKey, price] of [
    [longMinhId, routeAskey, '1.25T', '1200000'],
    [longMinhId, routeAskey, '10T', '3000000'],
    [longMinhId, routeAskey, 'CONT20', '3800000'],
    [longMinhId, routeAskey, 'CONT40', '4000000'],
    [longMinhId, routeSunrise, '10T', '3000000'],
    [logcomId, routeNeweb, 'CONT40', '4000000'],
  ] as const) {
    const [p] = await db.insert(s.pricingTables)
      .values({ customerId, routeId, rateKey, price, effectiveDate: '2026-07-30' })
      .returning();
    ids.pricing.push(p.id);
  }
  const [period] = await db.insert(s.fuelPricePeriods)
    .values({ unitPrice: '29940.00', effectiveFrom: '2026-09-01' })
    .returning();
  ids.periods.push(period.id);
}

before(async () => {
  const codes = ['1.25T', '2.5T', '3.5T', '5T', '8T', '10T', 'CONT20', 'CONT40'];
  const byCode = new Map<string, number>();
  for (const code of codes) {
    const [row] = await db.insert(s.vehicleSizeClasses)
      .values({ code, name: `Class ${code}`, isContainer: code.startsWith('CONT') })
      .onConflictDoNothing().returning();
    if (row) ids.classes.push(row.id);
  }
  const rows = await db.select().from(s.vehicleSizeClasses)
    .where(inArray(s.vehicleSizeClasses.code, codes));
  for (const row of rows) byCode.set(row.code, row.id);
  await mkBase(byCode);
});

after(async () => {
  for (const qid of ids.quotations) {
    await db.delete(s.quotationCells).where(eq(s.quotationCells.quotationId, qid));
    await db.delete(s.quotations).where(eq(s.quotations.id, qid));
  }
  if (ids.snapshots.length) await db.delete(s.freightRateSnapshots).where(inArray(s.freightRateSnapshots.id, ids.snapshots));
  if (ids.pricing.length) await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, ids.pricing));
  if (ids.terms.length) await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.id, ids.terms));
  if (ids.norms.length) await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, ids.norms));
  if (ids.periods.length) await db.delete(s.fuelPricePeriods).where(inArray(s.fuelPricePeriods.id, ids.periods));
  if (ids.classes.length) await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, ids.classes));
  if (ids.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
  if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  await client.end();
});

function resolveFor(customerId: number, routeId: number, classCode: string) {
  return resolveFreightRate({
    customerId, routeId, vehicleSizeClassCode: classCode, transportDate: EFFECTIVE_DATE,
  });
}

describe('heSo surcharge (card 20260922_59)', () => {
  test('AC1 heSo=1 regression: amounts byte-identical, snapshot records 1', async () => {
    const rate = await resolveFor(longMinhId, routeAskey, '1.25T');
    assert.equal(rate.heSo ?? 1, 1);
    assert.equal(rate.freight, 1248000); // 1.200.000 × 1,04
    assert.equal(rate.surcharge, 241948); // Δ 12.097,4074 × 20 ℓ
    assert.equal(rate.total, 1489948);
    const sid = await persistFreightRateSnapshot(rate, {});
    ids.snapshots.push(sid);
    const [row] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, sid));
    assert.equal(Number(row.heSo), 1);
    assert.equal(Number(row.surchargeAmount), 241948);
  });

  test('AC2 heSo=1.1 scales surcharge, Giá cos untouched', async () => {
    const { id } = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE,
      cells: [{ routeId: routeAskey, vehicleSizeClassCode: '1.25T', heSo: 1.1 }],
    });
    ids.quotations.push(id);
    const rate = await resolveFor(longMinhId, routeAskey, '1.25T');
    assert.equal(rate.heSo, 1.1);
    assert.equal(rate.freight, 1248000); // unchanged — the factor never touches Giá cos
    assert.equal(rate.surcharge, 266143); // round(241948 × 1.1) = round(266142.8)
    assert.equal(rate.total, 1514143);
    assert.match(rate.formula, /hệ số 1\.1/);
    const sid = await persistFreightRateSnapshot(rate, {});
    ids.snapshots.push(sid);
    const [row] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, sid));
    assert.equal(Number(row.heSo), 1.1);
    assert.equal(Number(row.surchargeAmount), 266143);
    assert.equal(Number(row.freightAmount), 1248000);
  });

  test('AC2b latest quotation wins over an older one', async () => {
    // A later quotation (no cells) supersedes the earlier heSo=1.1 one —
    // the engine reads the LATEST active quotation at the transport date.
    await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu A',
      effectiveDate: '2026-09-01',
      cells: [{ routeId: routeAskey, vehicleSizeClassCode: '1.25T', heSo: 2 }],
    }).then((q) => ids.quotations.push(q.id));
    await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu B-later',
      effectiveDate: '2026-09-20',
      cells: [],
    }).then((q) => ids.quotations.push(q.id));
    const rate = await resolveFreightRate({
      customerId: longMinhId, routeId: routeAskey,
      vehicleSizeClassCode: '1.25T', transportDate: '2026-09-20',
    });
    assert.equal(rate.heSo ?? 1, 1);
    assert.equal(rate.surcharge, 241948);
  });

  test('AC3 file samples at heSo=1: 241948 / 774234 / 696811 / 1100864', async () => {
    assert.equal((await resolveFor(longMinhId, routeAskey, 'CONT20')).surcharge, 774234);
    assert.equal((await resolveFor(longMinhId, routeSunrise, '10T')).surcharge, 696811);
    assert.equal((await resolveFor(logcomId, routeNeweb, 'CONT40')).surcharge, 1100864);
    // Precision note (E1 from _66): the card's raw figures use the file's 3dp
    // Δ display; the system pins scale-4 base — the ROUNDED values match.
  });

  test('AC4 snapshot explains the number without re-joining', async () => {
    // Latest quotation ≤ EFFECTIVE_DATE is AC2's (heSo 1.1) — the snapshot
    // must carry the factor, and raw = surcharge ÷ factor recovers 241948.
    const rate = await resolveFor(longMinhId, routeAskey, '1.25T');
    assert.equal(rate.heSo, 1.1);
    const sid = await persistFreightRateSnapshot(rate, {});
    ids.snapshots.push(sid);
    const [row] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, sid));
    assert.equal(Number(row.heSo), 1.1);
    assert.equal(Number(row.surchargeAmount), 266143);
    assert.equal(Math.round(Number(row.surchargeAmount) / Number(row.heSo)), 241948);
    assert.equal(Number(row.liters), 20);
    assert.ok(Number(row.fuelDelta) > 0);
  });
});

