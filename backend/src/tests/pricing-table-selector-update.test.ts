/**
 * Pricing-table selector UPDATE-path regression (ticket 161026095800,
 * FB-090 follow-up). The FB-090 pin (pricing-table-selector-axis.test.ts)
 * covers the CREATE-side pair law; manual QA still failed on the update
 * path for a real customer selector, for three sibling defects fixed in
 * catalog-crud.routes.ts:
 *
 *  PTC01 — customer-shape class patch: a patch that sets/moves
 *      vehicleSizeClassId WITHOUT rateKey used to inherit the row's stale
 *      denormalized key and 400 at the mismatch guard
 *      ("Mã lớp giá … không khớp mã loại xe"). The stored key is
 *      server-owned denormalized data, so the patch must rebase it.
 *  PTC02 — canonical FE edit wipe: the UI edit payload sends
 *      rateKey:null alongside an UNCHANGED vehicleSizeClassId; the old
 *      only-on-change return spread that null into the row and wiped the
 *      denormalized key on every routine price edit.
 *  PTC03 — lane guard blindness: the duplicate guard compared only
 *      rateKey, so a row whose key had been wiped (PTC02) escaped the
 *      class lane — phantom general-lane 409s and duplicate live rows on
 *      one selector.
 *
 * Pure-function cases run first; the DB cases exercise the real exported
 * hooks (pricingTableBeforeCreate/pricingTableBeforeUpdate) against the
 * dev database with dedicated fixtures and full cleanup.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';

import { db, client } from '../db';
import * as s from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import {
  validatePricingSelector,
  rebasePricingSelectorPatch,
  pricingTableBeforeCreate,
  pricingTableBeforeUpdate,
} from '../routes/config/catalog-crud.routes';

const noReq = undefined as unknown as Request;
const tx = db as unknown as Parameters<typeof pricingTableBeforeCreate>[2];
type SelectorMerge = { containerTypeId?: number | null; rateKey?: string | null; vehicleSizeClassId?: number | null };
type PricingTableInsert = typeof s.pricingTables.$inferInsert;

/** The hooks emit schema-shaped payloads (price: number); the numeric
 * column inserts/updates take strings — convert at the DB boundary. */
function toInsertValues(patch: Record<string, unknown>): PricingTableInsert {
  const out = { ...patch };
  if (out.price !== undefined) out.price = String(out.price);
  return out as PricingTableInsert;
}

// ─── Pure cases (no DB) ──────────────────────────────────────────────────────

describe('rebasePricingSelectorPatch — customer-shape class patch', () => {
  test('PTC01 pure: class-only patch rebases the stale denormalized key to null', () => {
    const current = { vehicleSizeClassId: 6, rateKey: '2.5T', containerTypeId: null };
    const merged = rebasePricingSelectorPatch(current, { vehicleSizeClassId: 8 }) as SelectorMerge;
    assert.equal(merged.rateKey, null);
    // The rebased merge is exactly the shape the axis law accepts.
    assert.deepEqual(validatePricingSelector(merged), merged);
  });

  test('explicit rateKey alongside the class is NOT rebased (agreement stays denormalize\'s job)', () => {
    const current = { vehicleSizeClassId: 6, rateKey: '2.5T', containerTypeId: null };
    const merged = rebasePricingSelectorPatch(current, { vehicleSizeClassId: 8, rateKey: '2.5T' }) as SelectorMerge;
    assert.equal(merged.rateKey, '2.5T');
    // The axis validator lets the pair through; the loud mismatch rejection
    // happens in denormalizeVehicleClassSelector at DB time (pinned by the
    // DB cases below and the pinned FB-090 suite).
    assert.deepEqual(validatePricingSelector(merged), merged);
  });

  test('price-only patch inherits the stored selector unchanged', () => {
    const current = { vehicleSizeClassId: 5, rateKey: '1.25T', containerTypeId: null };
    const merged = rebasePricingSelectorPatch(current, { rateKey: null }) as SelectorMerge;
    assert.equal(merged.rateKey, null);
    assert.equal(merged.vehicleSizeClassId, 5);
  });
});

// ─── DB cases (real hooks, dev database) ─────────────────────────────────────

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdPricingTableIds: number[] = [];
let customerIds: number[] = [];
let routeIds: number[] = [];
let classIds: number[] = [];

async function mkFixtures() {
  const [customer] = await db.insert(s.customers)
    .values({ name: `PTSel customer ${suffix}` })
    .returning();
  const [route] = await db.insert(s.routes)
    .values({ name: `PTSel route ${suffix}` })
    .returning();
  const [clsA] = await db.insert(s.vehicleSizeClasses)
    .values({ code: `PTSA${suffix.replace(/[^A-Z0-9]/gi, '').slice(0, 10)}`.toUpperCase(), name: `PTSel class A ${suffix}` })
    .returning();
  const [clsB] = await db.insert(s.vehicleSizeClasses)
    .values({ code: `PTSB${suffix.replace(/[^A-Z0-9]/gi, '').slice(0, 10)}`.toUpperCase(), name: `PTSel class B ${suffix}` })
    .returning();
  customerIds = [customer.id];
  routeIds = [route.id];
  classIds = [clsA.id, clsB.id];
  return { customer, route, clsA, clsB };
}

describe('pricing-tables update path — customer selector (161026095800)', () => {
  let fixtures: Awaited<ReturnType<typeof mkFixtures>>;

  before(async () => {
    fixtures = await mkFixtures();
  });

  after(async () => {
    if (createdPricingTableIds.length) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.id, createdPricingTableIds));
    }
    if (classIds.length) await db.delete(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.id, classIds));
    if (routeIds.length) await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
    if (customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
    await client.end();
  });

  test('PTC01 db: partial class-change patch is accepted (was HTTP 400 mismatch)', async () => {
    const created = await pricingTableBeforeCreate({
      customerId: fixtures.customer.id,
      routeId: fixtures.route.id,
      price: 1_350_000,
      vehicleSizeClassId: fixtures.clsA.id,
      rateKey: fixtures.clsA.code,
      containerTypeId: null,
      effectiveDate: '2027-03-01',
    }, noReq, tx);
    const [row] = await db.insert(s.pricingTables).values(toInsertValues(created)).returning();
    createdPricingTableIds.push(row.id);

    // Customer-shape patch: move the class, send NO rateKey field.
    const patch = await pricingTableBeforeUpdate(row.id, {
      vehicleSizeClassId: fixtures.clsB.id,
      price: 1_355_000,
    }, noReq, tx);
    assert.equal(patch.vehicleSizeClassId, fixtures.clsB.id);
    assert.equal(patch.rateKey, fixtures.clsB.code);
    await db.update(s.pricingTables).set(toInsertValues(patch)).where(eq(s.pricingTables.id, row.id));
    const [afterRow] = await db.select().from(s.pricingTables).where(eq(s.pricingTables.id, row.id));
    assert.equal(afterRow.rateKey, fixtures.clsB.code);
  });

  test('PTC02 db: canonical FE edit (class unchanged, rateKey:null) keeps the denormalized key', async () => {
    const [row] = await db.select().from(s.pricingTables)
      .where(eq(s.pricingTables.customerId, fixtures.customer.id));
    // Exactly the payload PricingTablesConfigPage sends on a routine price edit.
    const patch = await pricingTableBeforeUpdate(row.id, {
      customerId: fixtures.customer.id,
      routeId: fixtures.route.id,
      price: 1_360_000,
      vehicleSizeClassId: fixtures.clsB.id,
      rateKey: null,
      containerTypeId: null,
      effectiveDate: '2027-03-01',
    }, noReq, tx);
    assert.equal(patch.rateKey, fixtures.clsB.code, 'patch must carry the denormalized key');
    await db.update(s.pricingTables).set(toInsertValues(patch)).where(eq(s.pricingTables.id, row.id));
    const [afterRow] = await db.select().from(s.pricingTables).where(eq(s.pricingTables.id, row.id));
    assert.equal(afterRow.rateKey, fixtures.clsB.code, 'stored key must not be wiped');
  });

  test('PTC03 db: wiped-key row still collides on the class lane', async () => {
    // Simulate a historically corrupted row: class linked, rate_key wiped.
    const [row] = await db.select().from(s.pricingTables)
      .where(eq(s.pricingTables.customerId, fixtures.customer.id));
    await db.update(s.pricingTables).set({ rateKey: null }).where(eq(s.pricingTables.id, row.id));

    // Same selector lane must now be rejected as a duplicate (previously
    // slipped past the rateKey-only predicate and created a second live row).
    await assert.rejects(
      () => pricingTableBeforeCreate({
        customerId: fixtures.customer.id,
        routeId: fixtures.route.id,
        price: 999_999,
        vehicleSizeClassId: fixtures.clsB.id,
        rateKey: fixtures.clsB.code,
        containerTypeId: null,
        effectiveDate: '2027-03-01',
      }, noReq, tx),
      (err: { statusCode?: number; message?: string }) =>
        err.statusCode === 409 && /đã tồn tại/.test(err.message ?? ''),
    );

    // And the corrupted row must not squat the GENERAL lane either: healing
    // it through the canonical edit patch restores the key.
    const patch = await pricingTableBeforeUpdate(row.id, {
      vehicleSizeClassId: fixtures.clsB.id,
      rateKey: null,
    }, noReq, tx);
    assert.equal(patch.rateKey, fixtures.clsB.code);
  });
});
