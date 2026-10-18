/**
 * Card 20260922_60 — per-customer surcharge rounding (ruling 7).
 *
 * Excel ROUND(x; -n) half-away-from-zero, surcharge ONLY (Giá cos contracted).
 * Raw + rounded both snapshotted; unconfigured (NONE) = deterministic no-op.
 * Fixture = Mẫu báo giá 1 ASKEY worked numbers (fuel 29.940, base 17.842,5926).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { roundHalfAwayFromZero } from '@tingting/shared';
import {
  resolveFreightRate, persistFreightRateSnapshot,
} from '../services/freight-pricing-engine.service';
import { createQuotation, getQuotation } from '../services/quotation.service';

const suffix = `q60-${Date.now().toString(36)}`;
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
let customerId = 0;
let routeId = 0;

// The engine prices fuel at the LATEST period ≤ transport date, and
// fuel_price_periods is a global table on the shared dev DB — any stray
// period another suite or a manual QA run leaves inside the fixture window
// silently outranks this suite's own (a QA-approved 30000 @ 2026-09-09 once
// moved every worked number by +60đ/ℓ and reddened the whole file on main).
// So the suite owns an unoccupied far-future window instead of fixed
// 2026-09 dates (the fuel-period-envelope pattern, shared with
// heso-surcharge.test.ts). Only the calendar moves: the worked numbers —
// Δ 12.097,4074 = 29.940 − 17.842,5926 — are exactly the card's, so the
// assertions below stay pinned.
let FUEL_FROM = '';      // P — the suite's own fuel period
let EFFECTIVE_DATE = ''; // P+14 — transport + quotation date of A3 / A1 TEN_THOUSAND
let THOUSAND_DATE = '';  // P+15 — A1 THOUSAND's quotation + transport date
let NONE_DATE = '';      // P+19 — the latest-quotation NONE date
const WINDOW_DAYS = 19;  // any period in (P, P+19] would outrank P somewhere

before(async () => {
  // Pick P so every date in [P, P+WINDOW_DAYS] is unoccupied — verified
  // against the live table, never by deleting an existing row (effectiveFrom
  // is globally unique; the far-future base keeps business periods and other
  // suites' random windows out of reach).
  const occupied = new Set((await db.select({ date: s.fuelPricePeriods.effectiveFrom })
    .from(s.fuelPricePeriods)).map((row) => row.date));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const day = new Date('8200-01-01T00:00:00.000Z');
  day.setUTCDate(day.getUTCDate() + Number.parseInt(randomUUID().slice(0, 6), 16) % 100000);
  for (;;) {
    day.setUTCDate(day.getUTCDate() + 1);
    let free = true;
    for (let i = 0; i <= WINDOW_DAYS; i += 1) {
      const probe = new Date(day);
      probe.setUTCDate(probe.getUTCDate() + i);
      if (occupied.has(iso(probe))) { free = false; break; }
    }
    if (free) break;
  }
  const plusDays = (offset: number) => {
    const d = new Date(day);
    d.setUTCDate(d.getUTCDate() + offset);
    return iso(d);
  };
  FUEL_FROM = iso(day);
  EFFECTIVE_DATE = plusDays(14);
  THOUSAND_DATE = plusDays(15);
  NONE_DATE = plusDays(19);

  const [customer] = await db.insert(s.customers).values({ name: `Q60 customer ${suffix}` }).returning();
  customerId = customer.id;
  ids.customers.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: `Q60 route ${suffix}` }).returning();
  routeId = route.id;
  ids.routes.push(route.id);
  const [cls] = await db.insert(s.vehicleSizeClasses)
    .values({ code: '1.25T', name: 'Class 1.25T' })
    .onConflictDoNothing().returning();
  if (cls) ids.classes.push(cls.id);
  const [clsRow] = await db.select().from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.code, '1.25T'));
  const [norm] = await db.insert(s.fuelConsumptionNorms)
    .values({ vehicleSizeClassId: clsRow.id, litersPerKm: '0.1000', effectiveDate: '2026-01-01' })
    .returning();
  ids.norms.push(norm.id);
  const [terms] = await db.insert(s.freightRateTerms)
    .values({
      customerId, routeId, sharePct: '4.00', billingKmOneWay: 100, billingKmMultiplier: '2',
      baseFuelPrice: '17842.5926', fuelLagDays: 0, fuelLagConfirmed: true,
      surchargeThresholdMode: 'NONE', effectiveDate: '2026-07-30',
    }).returning();
  ids.terms.push(terms.id);
  const [price] = await db.insert(s.pricingTables)
    .values({ customerId, routeId, rateKey: '1.25T', price: '1200000', effectiveDate: '2026-07-30' })
    .returning();
  ids.pricing.push(price.id);
  const [period] = await db.insert(s.fuelPricePeriods)
    .values({ unitPrice: '29940.00', effectiveFrom: FUEL_FROM })
    .returning();
  ids.periods.push(period.id);
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

function resolveAskey() {
  return resolveFreightRate({
    customerId, routeId, vehicleSizeClassCode: '1.25T', transportDate: EFFECTIVE_DATE,
  });
}

describe('surcharge rounding (card 20260922_60)', () => {
  test('A1+A2 pure fn: Excel ROUND half-away-from-zero probes', () => {
    assert.equal(roundHalfAwayFromZero(823250, -3), 823000);
    assert.equal(roundHalfAwayFromZero(823250, -4), 820000);
    assert.equal(roundHalfAwayFromZero(825000, -4), 830000); // half-point away
    assert.equal(roundHalfAwayFromZero(823500, -3), 824000); // half-point away
    assert.equal(roundHalfAwayFromZero(241948.14, -4), 240000);
    assert.equal(roundHalfAwayFromZero(241948.14, -3), 242000);
    assert.equal(roundHalfAwayFromZero(774234.048, -4), 770000);
    assert.equal(roundHalfAwayFromZero(774234.048, -3), 774000);
    assert.equal(roundHalfAwayFromZero(696810.6432, -4), 700000);
    assert.equal(roundHalfAwayFromZero(696810.6432, -3), 697000);
  });

  test('A3 unconfigured (NONE): deterministic — raw == charged, both snapshotted', async () => {
    const rate = await resolveAskey();
    assert.equal(rate.surcharge, 241948);
    assert.equal(rate.surchargeRaw, 241948);
    const sid = await persistFreightRateSnapshot(rate, {});
    ids.snapshots.push(sid);
    const [row] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, sid));
    assert.equal(Number(row.surchargeRaw), 241948);
    assert.equal(Number(row.surchargeAmount), 241948);
    assert.equal(Number(row.heSo), 1);
  });

  test('A1 engine TEN_THOUSAND (4 số): 241948 → 240000, freight untouched', async () => {
    const { id } = await createQuotation({
      customerId, templateName: 'Mẫu 4 số', effectiveDate: EFFECTIVE_DATE,
      surchargeRoundingMode: 'TEN_THOUSAND', cells: [],
    });
    ids.quotations.push(id);
    const rate = await resolveAskey();
    assert.equal(rate.surchargeRaw, 241948);
    assert.equal(rate.surcharge, 240000);
    assert.equal(rate.total, 1248000 + 240000);
    assert.equal(rate.freight, 1248000); // ruling 7: Giá cos never rounded
    assert.match(rate.formula, /làm tròn 4 số = 240000/);
    const sid = await persistFreightRateSnapshot(rate, {});
    ids.snapshots.push(sid);
    const [row] = await db.select().from(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, sid));
    assert.equal(Number(row.surchargeRaw), 241948);
    assert.equal(Number(row.surchargeAmount), 240000);
  });

  test('A1 engine THOUSAND (3 số): 241948 → 242000', async () => {
    const { id } = await createQuotation({
      customerId, templateName: 'Mẫu 3 số', effectiveDate: THOUSAND_DATE,
      surchargeRoundingMode: 'THOUSAND', cells: [],
    });
    ids.quotations.push(id);
    const rate = await resolveFreightRate({
      customerId, routeId, vehicleSizeClassCode: '1.25T', transportDate: THOUSAND_DATE,
    });
    assert.equal(rate.surchargeRaw, 241948);
    assert.equal(rate.surcharge, 242000);
    assert.match(rate.formula, /làm tròn 3 số = 242000/);
  });

  test('latest quotation supplies the mode; CRUD roundtrips it', async () => {
    const { id } = await createQuotation({
      customerId, templateName: 'Mẫu NONE mới', effectiveDate: NONE_DATE,
      surchargeRoundingMode: 'NONE', cells: [],
    });
    ids.quotations.push(id);
    const at16 = await resolveFreightRate({
      customerId, routeId, vehicleSizeClassCode: '1.25T', transportDate: THOUSAND_DATE,
    });
    assert.equal(at16.surcharge, 242000); // THOUSAND_DATE's THOUSAND governs
    const at20 = await resolveFreightRate({
      customerId, routeId, vehicleSizeClassCode: '1.25T', transportDate: NONE_DATE,
    });
    assert.equal(at20.surcharge, 241948); // NONE_DATE's NONE governs
    const view = await getQuotation(id);
    assert.equal(view.surchargeRoundingMode, 'NONE');
  });
});
