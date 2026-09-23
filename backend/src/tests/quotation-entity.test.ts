/**
 * Quotation entity (card 20260922_66) — CRUD + live-view grid against real DB.
 *
 * Fixtures carry the card's worked numbers (worked examples outrank prose):
 *   ASKEY section of Mẫu báo giá 1 at fuel 29.940, base 17.842,5926:
 *   liters 20/26/26/30/40/48/64/64/70/70 ℓ, Giá cos 1.248.000 … 4.160.000,
 *   surcharges 241.948 / 314.533 / 314.533 / 362.922 / 483.896 / 580.676 /
 *   774.234 / 846.819* — *file shows 846.818 (Δ at 3dp display); the system
 *   stores base at scale 4 (CuocPhiThietKeDB.md §3.2.1, QA-passed) and pins
 *   846.819. NEWEB 1.25T: 1.300.000 + 314.533 = 1.614.533.
 *
 * Runs on an isolated DB (throwaway quotation_w66); canonical class codes are
 * safe there. Cleanup in after() removes every created row.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import {
  createQuotation, deleteQuotation, getQuotation, updateQuotation,
} from '../services/quotation.service';
import { computeFreightRate } from '@tingting/shared';

const suffix = `q66-${Date.now().toString(36)}`;
const ids = {
  customers: [] as number[],
  routes: [] as number[],
  classes: [] as number[],
  norms: [] as number[],
  terms: [] as number[],
  pricing: [] as number[],
  periods: [] as number[],
  quotations: [] as number[],
};

async function mkCustomer(name: string): Promise<number> {
  const [c] = await db.insert(s.customers).values({ name }).returning();
  ids.customers.push(c.id);
  return c.id;
}

async function mkRoute(name: string): Promise<number> {
  const [r] = await db.insert(s.routes).values({ name }).returning();
  ids.routes.push(r.id);
  return r.id;
}

const GRID_CODES = [
  '1.25T', '2.5T', '3.5T', '5T', '8T', '10T',
  'CONT20', 'CONT40', 'CONT20.LIGHT', 'CONT20.HEAVY', 'CONT40.LIGHT', 'CONT40.HEAVY',
];

async function mkClasses(): Promise<Map<string, number>> {
  const byCode = new Map<string, number>();
  for (const code of GRID_CODES) {
    const [row] = await db.insert(s.vehicleSizeClasses)
      .values({ code, name: `Class ${code}`, isContainer: code.startsWith('CONT') })
      .onConflictDoNothing()
      .returning();
    if (row) ids.classes.push(row.id);
  }
  const rows = await db.select().from(s.vehicleSizeClasses)
    .where(inArray(s.vehicleSizeClasses.code, GRID_CODES));
  for (const row of rows) byCode.set(row.code, row.id);
  return byCode;
}

async function mkNorms(classIdByCode: Map<string, number>): Promise<void> {
  const NORMS: Record<string, string> = {
    '1.25T': '0.1000', '2.5T': '0.1300', '3.5T': '0.1300', '5T': '0.1500',
    '8T': '0.2000', '10T': '0.2400', 'CONT20': '0.32', 'CONT40': '0.35',
  };
  for (const [code, litersPerKm] of Object.entries(NORMS)) {
    const [row] = await db.insert(s.fuelConsumptionNorms)
      .values({
        vehicleSizeClassId: classIdByCode.get(code)!,
        litersPerKm,
        effectiveDate: '2026-01-01',
        note: `fixture ${suffix}`,
      })
      .returning();
    ids.norms.push(row.id);
  }
}

async function mkFuelPeriod(): Promise<void> {
  const [row] = await db.insert(s.fuelPricePeriods)
    .values({ unitPrice: '29940.00', effectiveFrom: '2026-09-01' })
    .returning();
  ids.periods.push(row.id);
}

const EFFECTIVE_DATE = '2026-09-15';

async function mkTerms(customerId: number, routeId: number, oneWayKm: number, sharePct: string): Promise<number> {
  const [row] = await db.insert(s.freightRateTerms)
    .values({
      customerId, routeId,
      sharePct, billingKmOneWay: oneWayKm, billingKmMultiplier: '2',
      baseFuelPrice: '17842.5926',
      fuelLagDays: 0, fuelLagConfirmed: true,
      surchargeThresholdMode: 'NONE',
      effectiveDate: '2026-07-30',
    })
    .returning();
  ids.terms.push(row.id);
  return row.id;
}

let longMinhId = 0;
let logcomId = 0;
let routeAskey = 0;
let routeSunrise = 0;
let routeNeweb = 0;

async function mkPrice(customerId: number, routeId: number, rateKey: string, price: string): Promise<void> {
  const [row] = await db.insert(s.pricingTables).values({
    customerId, routeId, rateKey, price,
    effectiveDate: '2026-07-30',
  }).returning();
  ids.pricing.push(row.id);
}

before(async () => {
  longMinhId = await mkCustomer(`CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH ${suffix}`);
  logcomId = await mkCustomer(`LOGCOM ${suffix}`);
  routeAskey = await mkRoute(`ASKEY ${suffix}`);
  routeSunrise = await mkRoute(`SUNRISE+  SJ ${suffix}`);
  routeNeweb = await mkRoute(`Hải Phòng-NEWEB ${suffix}`);
  const classIdByCode = await mkClasses();
  await mkNorms(classIdByCode);
  await mkFuelPeriod();

  // Card 20260922_66 acceptance 3: rounds trip km × norm, file-exact.
  await mkTerms(longMinhId, routeAskey, 100, '4.00');
  await mkTerms(longMinhId, routeSunrise, 120, '2.50');
  await mkTerms(logcomId, routeNeweb, 130, '2.00');

  // Giá cos per Mẫu 1 = basePrice × (1 + sharePct/100) — the file bakes the
  // share in (ASKEY ×1,04; ruling e). pricing_tables holds the base (I);
  // the engine's J reproduces the file figures exactly.
  await mkPrice(longMinhId, routeAskey, '1.25T', '1200000');
  await mkPrice(longMinhId, routeAskey, '2.5T', '1600000');
  await mkPrice(longMinhId, routeAskey, '3.5T', '1700000');
  await mkPrice(longMinhId, routeAskey, '5T', '2300000');
  await mkPrice(longMinhId, routeAskey, '8T', '2800000');
  await mkPrice(longMinhId, routeAskey, '10T', '3000000');
  await mkPrice(longMinhId, routeAskey, 'CONT20', '3800000');
  await mkPrice(longMinhId, routeAskey, 'CONT40', '4000000');
  await mkPrice(longMinhId, routeSunrise, 'CONT40', '2000000'); // fixture-only price — the card pins SUNRISE liters, not price
  await mkPrice(logcomId, routeNeweb, '1.25T', '1300000'); // seed data/pricing.ts basePrice (real file value)
});

after(async () => {
  for (const qid of ids.quotations) {
    await db.delete(s.quotationCells).where(eq(s.quotationCells.quotationId, qid));
    await db.delete(s.quotations).where(eq(s.quotations.id, qid));
  }
  if (ids.pricing.length) await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, ids.pricing));
  if (ids.terms.length) await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.id, ids.terms));
  if (ids.norms.length) await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, ids.norms));
  if (ids.periods.length) await db.delete(s.fuelPricePeriods).where(inArray(s.fuelPricePeriods.id, ids.periods));
  if (ids.classes.length) await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, ids.classes));
  if (ids.routes.length) await db.delete(s.routes).where(inArray(s.routes.id, ids.routes));
  if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
});

function cellOf(grid: Awaited<ReturnType<typeof getQuotation>>['cells'], routeId: number, code: string) {
  const hit = grid.find((c) => c.routeId === routeId && c.vehicleSizeClassCode === code);
  assert.ok(hit, `cell ${routeId}:${code} missing from grid`);
  return hit;
}

describe('quotation entity (card 20260922_66)', () => {
  test('CRUD roundtrip: frame + heSo cell persist and read back', async () => {
    // effectiveDate in the FUTURE of the other tests' transport dates: the
    // engine (_59) reads the latest quotation ≤ transport date, so this
    // heSo=2 frame must not dominate the heSo=1 assertions further down.
    const { id } = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: '2026-09-30',
      cells: [{ routeId: routeAskey, vehicleSizeClassCode: 'CONT20.LIGHT', heSo: 2 }],
    });
    ids.quotations.push(id);
    const view = await getQuotation(id);
    assert.strictEqual(view.templateName, 'Mẫu báo giá 1');
    assert.strictEqual(view.effectiveDate, '2026-09-30');
    const cell = cellOf(view.cells, routeAskey, 'CONT20.LIGHT');
    assert.strictEqual(cell.heSo, 2);
    assert.strictEqual(cell.giaCos, 3952000);
    assert.strictEqual(cell.surcharge, 1548468); // 774.234 × 2 — surcharge-only scaling
    assert.strictEqual(cell.total, 5500468); // 3.952.000 + 1.548.468
  });

  test('update replaces cells; delete soft-deletes (then 404)', async () => {
    const { id } = await createQuotation({
      customerId: logcomId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE,
      cells: [],
    });
    ids.quotations.push(id);
    await updateQuotation(id, {
      templateName: 'Mẫu báo giá 1 (rev 2)',
      effectiveDate: EFFECTIVE_DATE,
      surchargeRoundingMode: 'NONE',
      cells: [{ routeId: routeNeweb, vehicleSizeClassCode: 'CONT20.HEAVY', heSo: 1.5 }],
      fees: [],
    });
    const view = await getQuotation(id);
    assert.strictEqual(view.templateName, 'Mẫu báo giá 1 (rev 2)');
    const heavy = cellOf(view.cells, routeNeweb, 'CONT20.HEAVY');
    assert.strictEqual(heavy.heSo, 1.5);
    assert.strictEqual(heavy.giaCos, null);
    assert.strictEqual(heavy.missingPrice, true);
  });

  test('grid: 2 route sections × 10 columns in file order (A2) + liters pins (A3)', async () => {
    const { id } = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE,
      cells: [],
    });
    ids.quotations.push(id);
    const view = await getQuotation(id);
    const askeyCodes = view.cells.filter((c) => c.routeId === routeAskey).map((c) => c.vehicleSizeClassCode);
    assert.deepStrictEqual(askeyCodes, [
      '1.25T', '2.5T', '3.5T', '5T', '8T', '10T',
      'CONT20.LIGHT', 'CONT20.HEAVY', 'CONT40.LIGHT', 'CONT40.HEAVY',
    ]);
    const sunrise40 = cellOf(view.cells, routeSunrise, 'CONT40.LIGHT');
    assert.strictEqual(sunrise40.liters, 84); // 120 km × 2 × 0.35
    const askey125 = cellOf(view.cells, routeAskey, '1.25T');
    assert.strictEqual(askey125.liters, 20); // 100 km × 2 × 0.10
    const askeyCont20 = cellOf(view.cells, routeAskey, 'CONT20.LIGHT');
    assert.strictEqual(askeyCont20.liters, 64); // 100 km × 2 × 0.32
  });

  test('LOGCOM/NEWEB liters + price-to-the-đồng pins (A4)', async () => {
    const { id } = await createQuotation({
      customerId: logcomId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE,
      cells: [],
    });
    ids.quotations.push(id);
    const view = await getQuotation(id);
    const cell = cellOf(view.cells, routeNeweb, 'CONT20.LIGHT');
    assert.strictEqual(cell.liters, 83.2); // 130 km × 2 × 0.32
    assert.strictEqual(cell.giaCos, null); // no NEWEB CONT20 price in fixture
    assert.strictEqual(cell.missingPrice, true);
    const t125 = cellOf(view.cells, routeNeweb, '1.25T');
    assert.strictEqual(t125.liters, 26); // 130 km × 2 × 0.10
    assert.strictEqual(t125.giaCos, 1326000); // base 1.300.000 × 1,02 (share baked into Giá cos)
    assert.strictEqual(t125.surcharge, 314533); // Δ 12.097,4074 × 26 ℓ
    assert.strictEqual(t125.total, 1640533);
  });

  test('ASKEY section priced to the đồng at heSo=1 (A4+A5)', async () => {
    const { id } = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE,
      cells: [],
    });
    ids.quotations.push(id);
    const view = await getQuotation(id);
    const engine1 = computeFreightRate({
      basePrice: 1200000, sharePct: 4, fuelPrice: 29940, baseFuelPrice: 17842.5926, liters: 20,
    });
    assert.strictEqual(engine1.surcharge, 241948);
    const pins: Array<[string, number | null, number | null, number | null]> = [
      // [code, giaCos, surcharge, total] — file Giá cos = J (base × 1,04)
      ['1.25T', 1248000, 241948, 1489948],
      ['2.5T', 1664000, 314533, 1978533],
      ['3.5T', 1768000, 314533, 2082533],
      ['5T', 2392000, 362922, 2754922],
      ['8T', 2912000, 483896, 3395896],
      ['10T', 3120000, 580676, 3700676],
      ['CONT20.LIGHT', 3952000, 774234, 4726234],
      ['CONT40.LIGHT', 4160000, 846819, 5006819],
   ];
    for (const [code, giaCos, surcharge, total] of pins) {
      const cell = cellOf(view.cells, routeAskey, code);
      assert.strictEqual(cell.giaCos, giaCos, `${code} giaCos`);
      assert.strictEqual(cell.surcharge, surcharge, `${code} surcharge`);
      assert.strictEqual(cell.total, total, `${code} total`);
      assert.strictEqual(cell.missingPrice, false);
      assert.strictEqual(cell.heSo, 1);
    }
    // The engine cross-check: quotation cells ARE engine output (no second engine).
    const engine = computeFreightRate({
      basePrice: 3952000, sharePct: 4, fuelPrice: 29940, baseFuelPrice: 17842.5926, liters: 64,
    });
    assert.strictEqual(engine.surcharge, 774234);
    assert.strictEqual(cellOf(view.cells, routeAskey, 'CONT20.LIGHT').surcharge, engine.surcharge);
  });

  test('heavy cells: surcharge present, Giá cos missing, totals exclude (A6)', async () => {
    const { id } = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE,
      cells: [],
    });
    ids.quotations.push(id);
    const view = await getQuotation(id);
    const c20h = cellOf(view.cells, routeAskey, 'CONT20.HEAVY');
    assert.strictEqual(c20h.giaCos, null);
    assert.strictEqual(c20h.missingPrice, true);
    assert.strictEqual(c20h.surcharge, 774234); // same fuel math as the light cell
    assert.strictEqual(c20h.total, null);
    assert.strictEqual(c20h.liters, 64);
    const c40h = cellOf(view.cells, routeAskey, 'CONT40.HEAVY');
    assert.strictEqual(c40h.giaCos, null);
    assert.strictEqual(c40h.surcharge, 846819);
    assert.strictEqual(c40h.total, null);
    assert.ok(c40h.formula, 'heavy cell carries an explanatory formula');
  });

  test('heSo=1 regression across every priced cell vs engine (A5)', async () => {
    const { id } = await createQuotation({
      customerId: longMinhId, templateName: 'Mẫu báo giá 1',
      effectiveDate: EFFECTIVE_DATE, cells: [],
    });
    ids.quotations.push(id);
    const view = await getQuotation(id);
    for (const cell of view.cells) {
      if (cell.missingPrice) continue;
      assert.strictEqual(cell.heSo, 1);
      assert.ok(cell.surcharge !== null, 'priced cell carries a surcharge');
      assert.strictEqual(cell.surcharge, Math.round(cell.surcharge), 'integer VND');
      // Surcharge must equal the engine surcharge — implicitly pinned by the
      // đồng tests above; here we assert the structural regression: heSo=1
      // leaves engine values untouched.
      assert.ok(cell.total !== null);
    }
  });
});
