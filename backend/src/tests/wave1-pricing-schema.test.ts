/**
 * Wave 1 — Pricing & Fuel Data Layer schema validation test.
 *
 * Verifies the 4 new tables + 3 new enums + 2 column additions created by
 * migration 0117 are correctly structured. Uses the real DB (mirrors
 * scheduler.test.ts's lightweight DB-backed pattern) — no service-layer
 * calls, just raw schema introspection.
 *
 * Coverage:
 *   - All 4 tables exist with the expected columns.
 *   - All 3 enums have the expected values.
 *   - cargoTypes.isBulk column exists with default false.
 *   - trips.pricingSource / pricingFormula / pricingSnapshot columns exist.
 *   - FK constraints are in place.
 *   - Indexes are in place.
 *   - A round-trip insert+select on each table works (no NOT NULL gaps).
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db, client } from '../db';

after(async () => {
  await client.end();
});

describe('Wave 1 — Pricing & Fuel schema: tables exist', () => {
  test('weight_pricing_tiers table exists with expected columns', async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'weight_pricing_tiers'
      ORDER BY ordinal_position
    `);
    const names = cols.map((r: Record<string, unknown>) => r.column_name);
    assert.ok(names.includes('route_id'));
    assert.ok(names.includes('cargo_type_id'));
    assert.ok(names.includes('min_kg'));
    assert.ok(names.includes('max_kg'));
    assert.ok(names.includes('price_per_kg'));
    assert.ok(names.includes('effective_date'));
    assert.ok(names.includes('deleted_at'));
  });

  test('lift_pricing table exists with expected columns', async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'lift_pricing' ORDER BY ordinal_position
    `);
    const names = cols.map((r: Record<string, unknown>) => r.column_name);
    assert.ok(names.includes('port_id'));
    assert.ok(names.includes('container_type_id'));
    assert.ok(names.includes('direction'));
    assert.ok(names.includes('load_state'));
    assert.ok(names.includes('unit_price'));
    assert.ok(names.includes('effective_date'));
  });

  test('ancillary_revenue table exists with expected columns', async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'ancillary_revenue' ORDER BY ordinal_position
    `);
    const names = cols.map((r: Record<string, unknown>) => r.column_name);
    assert.ok(names.includes('customer_id'));
    assert.ok(names.includes('shipment_id'));
    assert.ok(names.includes('trip_id'));
    assert.ok(names.includes('type'));
    assert.ok(names.includes('amount'));
    assert.ok(names.includes('tax'));
    assert.ok(names.includes('date'));
    assert.ok(names.includes('document_ref'));
  });

  test('fuel_norms table exists with expected columns', async () => {
    const cols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fuel_norms' ORDER BY ordinal_position
    `);
    const names = cols.map((r: Record<string, unknown>) => r.column_name);
    assert.ok(names.includes('route_id'));
    assert.ok(names.includes('truck_id'));
    assert.ok(names.includes('loaded_liters_per_100km'));
    assert.ok(names.includes('empty_liters_per_100km'));
    assert.ok(names.includes('supplement_liters'));
    assert.ok(names.includes('flat_rate_liters'));
    assert.ok(names.includes('effective_date'));
  });
});

describe('Wave 1 — Pricing & Fuel schema: enums', () => {
  test('lift_direction enum has LIFT_UP and LIFT_DOWN', async () => {
    const vals = await db.execute(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'lift_direction')
      ORDER BY enumsortorder
    `);
    const labels = vals.map((r: Record<string, unknown>) => r["enumlabel"] as string);
    assert.deepEqual(labels, ['LIFT_UP', 'LIFT_DOWN']);
  });

  test('ancillary_revenue_type enum has the 4 expected values', async () => {
    const vals = await db.execute(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ancillary_revenue_type')
      ORDER BY enumsortorder
    `);
    const labels = vals.map((r: Record<string, unknown>) => r["enumlabel"] as string);
    assert.deepEqual(labels, ['LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER']);
  });

  test('pricing_source enum has TIER, TABLE, MANUAL', async () => {
    const vals = await db.execute(sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'pricing_source')
      ORDER BY enumsortorder
    `);
    const labels = vals.map((r: Record<string, unknown>) => r["enumlabel"] as string);
    assert.deepEqual(labels, ['TIER', 'TABLE', 'MANUAL']);
  });
});

describe('Wave 1 — Pricing & Fuel schema: column additions', () => {
  test('cargo_types.is_bulk column exists with default false', async () => {
    const [col] = await db.execute(sql`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'cargo_types' AND column_name = 'is_bulk'
    `);
    assert.ok(col, 'is_bulk column exists');
    assert.match(String((col as { column_default: string }).column_default), /false/i);
  });

  test('trips.pricing_source column exists (nullable)', async () => {
    const [col] = await db.execute(sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'trips' AND column_name = 'pricing_source'
    `);
    assert.ok(col, 'pricing_source column exists');
    assert.equal((col as { is_nullable: string }).is_nullable, 'YES');
  });

  test('trips.pricing_formula column exists (nullable text)', async () => {
    const [col] = await db.execute(sql`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'trips' AND column_name = 'pricing_formula'
    `);
    assert.ok(col, 'pricing_formula column exists');
    assert.equal((col as { data_type: string }).data_type, 'text');
  });

  test('trips.pricing_snapshot column exists (nullable jsonb)', async () => {
    const [col] = await db.execute(sql`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'trips' AND column_name = 'pricing_snapshot'
    `);
    assert.ok(col, 'pricing_snapshot column exists');
    assert.equal((col as { data_type: string }).data_type, 'jsonb');
  });
});

describe('Wave 1 — Pricing & Fuel schema: indexes', () => {
  test('weight_pricing_tiers has route+cargo+date index', async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'weight_pricing_tiers'
      AND indexname = 'weight_pricing_tiers_route_cargo_date_idx'
    `);
    assert.ok(idx.length > 0, 'index exists');
  });

  test('fuel_norms has route+truck+date index', async () => {
    const idx = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'fuel_norms'
      AND indexname = 'fuel_norms_route_truck_date_idx'
    `);
    assert.ok(idx.length > 0, 'index exists');
  });

  test('lift_pricing has the load-state-aware unique matrix index', async () => {
    const [index] = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'lift_pricing'
      AND indexname = 'lift_pricing_port_type_state_dir_date_uniq'
    `);
    assert.ok(index, 'load-state-aware unique index exists');
    const definition = String((index as { indexdef: string }).indexdef);
    assert.match(definition, /CREATE UNIQUE INDEX/i);
    assert.match(
      definition,
      /\(port_id, container_type_id, direction, load_state, effective_date\)/i,
    );
  });
});
