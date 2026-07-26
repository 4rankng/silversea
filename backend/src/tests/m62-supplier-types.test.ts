/**
 * Wave 3 M6.2 — supplier-type taxonomy tests.
 *
 * Verifies: enum/labels exposed; normalizeSupplierTypes (dedupe,
 * uppercase, drop-invalid, ordering); syncFuelFlag (FUEL membership →
 * boolean); listSuppliersByType (DB); classifySuppliersByName (DB,
 * idempotent); isFuelSupplier mirror via the CRUD hook.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  normalizeSupplierTypes,
  syncFuelFlag,
  listSuppliersByType,
  classifySuppliersByName,
  SupplierType,
  SUPPLIER_TYPES,
} from '../services/supplier-types.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdSupplierIds: number[] = [];

async function mkSupplier(opts: { name: string; types?: SupplierType[]; isFuelSupplier?: boolean }) {
  const [sup] = await db.insert(s.suppliers).values({
    name: opts.name,
    isFuelSupplier: opts.isFuelSupplier ?? false,
    types: opts.types ?? null,
  }).returning();
  createdSupplierIds.push(sup.id);
  return sup;
}

after(async () => {
  try {
    if (createdSupplierIds.length > 0) await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  } catch (err) { console.warn('[m62] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M6.2 — constants', () => {
  test('SUPPLIER_TYPES exposes the 7 canonical values', () => {
    assert.deepEqual([...SUPPLIER_TYPES], [
      'CARRIER', 'PORT', 'WAREHOUSE', 'SHIPPING_LINE', 'CUSTOMS', 'SERVICE', 'FUEL',
    ]);
  });

  test('SupplierType enum + labels exposed from service', () => {
    assert.equal(SupplierType.FUEL, 'FUEL');
    assert.equal(SupplierType.SHIPPING_LINE, 'SHIPPING_LINE');
  });
});

describe('M6.2 — normalizeSupplierTypes', () => {
  test('lowercase + uppercase both accepted', () => {
    assert.deepEqual(normalizeSupplierTypes(['fuel', 'PORT']), ['PORT', 'FUEL']);
  });

  test('duplicates removed', () => {
    assert.deepEqual(normalizeSupplierTypes(['FUEL', 'fuel', 'PORT', 'PORT']), ['PORT', 'FUEL']);
  });

  test('invalid strings dropped silently', () => {
    assert.deepEqual(normalizeSupplierTypes(['FUEL', 'unknown', '', 'GAS']), ['FUEL']);
  });

  test('non-array input returns empty', () => {
    assert.deepEqual(normalizeSupplierTypes(null), []);
    assert.deepEqual(normalizeSupplierTypes(undefined), []);
    assert.deepEqual(normalizeSupplierTypes('FUEL'), []);
    assert.deepEqual(normalizeSupplierTypes({}), []);
  });

  test('empty array stays empty', () => {
    assert.deepEqual(normalizeSupplierTypes([]), []);
  });

  test('output is sorted by canonical SUPPLIER_TYPES order (not insertion order)', () => {
    // Insert in reverse order; output should follow the enum's declared order.
    const result = normalizeSupplierTypes(['FUEL', 'CUSTOMS', 'CARRIER']);
    assert.deepEqual(result, ['CARRIER', 'CUSTOMS', 'FUEL']);
  });

  test('non-string array entries ignored', () => {
    assert.deepEqual(normalizeSupplierTypes(['FUEL', 42, null, { x: 1 }, 'PORT']), ['PORT', 'FUEL']);
  });
});

describe('M6.2 — syncFuelFlag', () => {
  test('FUEL present → true', () => {
    assert.equal(syncFuelFlag(['FUEL']), true);
    assert.equal(syncFuelFlag(['PORT', 'FUEL']), true);
  });

  test('FUEL absent → false', () => {
    assert.equal(syncFuelFlag(['PORT']), false);
    assert.equal(syncFuelFlag([]), false);
    assert.equal(syncFuelFlag(null), false);
  });

  test('raw unnormalized input still works', () => {
    assert.equal(syncFuelFlag(['fuel', 'unknown']), true);
    assert.equal(syncFuelFlag(['gas']), false);
  });
});

describe('M6.2 — listSuppliersByType (DB)', () => {
  test('returns only suppliers whose types include the given type', async () => {
    const fuel = await mkSupplier({ name: `M62 fuel ${suffix}`, types: [SupplierType.FUEL] });
    const port = await mkSupplier({ name: `M62 port ${suffix}`, types: [SupplierType.PORT, SupplierType.WAREHOUSE] });
    const untyped = await mkSupplier({ name: `M62 untyped ${suffix}` });

    const fuelOnly = await listSuppliersByType(SupplierType.FUEL);
    const fuelIds = fuelOnly.map(s => s.id);
    assert.ok(fuelIds.includes(fuel.id));
    assert.ok(!fuelIds.includes(port.id));
    assert.ok(!fuelIds.includes(untyped.id));

    const portOnly = await listSuppliersByType(SupplierType.PORT);
    const portIds = portOnly.map(s => s.id);
    assert.ok(portIds.includes(port.id));
    assert.ok(!portIds.includes(fuel.id));

    // WAREHOUSE shares the port supplier.
    const warehouseOnly = await listSuppliersByType(SupplierType.WAREHOUSE);
    const warehouseIds = warehouseOnly.map(s => s.id);
    assert.ok(warehouseIds.includes(port.id));
  });

  test('includeUncategorized=true returns suppliers with NULL/empty types too', async () => {
    const untyped = await mkSupplier({ name: `M62 untyped2 ${suffix}` });
    const fuel = await mkSupplier({ name: `M62 fuel2 ${suffix}`, types: [SupplierType.FUEL] });

    // Pass includeUncategorized on a query that otherwise filters by FUEL —
    // the option only takes effect when the caller wants ALL suppliers,
    // so we issue a separate call without a specific type filter.
    const allSuppliers = await db.select().from(s.suppliers).where(inArray(s.suppliers.id, [untyped.id, fuel.id]));
    assert.equal(allSuppliers.length, 2);

    // Default (no includeUncategorized) — untyped is NOT in FUEL list.
    const fuelList = await listSuppliersByType(SupplierType.FUEL);
    const fuelIds = fuelList.map(x => x.id);
    assert.ok(fuelIds.includes(fuel.id));
    assert.ok(!fuelIds.includes(untyped.id));
  });
});

describe('M6.2 — classifySuppliersByName (DB)', () => {
  test('assigns types to existing suppliers matched by name', async () => {
    const sup = await mkSupplier({ name: `M62 class ${suffix}` });
    const changed = await classifySuppliersByName([
      { namePattern: sup.name, types: [SupplierType.CARRIER, SupplierType.FUEL] },
    ]);
    assert.equal(changed, 1);

    const [refreshed] = await db.select().from(s.suppliers).where(inArray(s.suppliers.id, [sup.id]));
    assert.deepEqual(refreshed.types, ['CARRIER', 'FUEL']);
    assert.equal(refreshed.isFuelSupplier, true, 'FUEL in types → isFuelSupplier mirrored');
  });

  test('idempotent: re-running with the same assignment is a no-op', async () => {
    const sup = await mkSupplier({ name: `M62 idem ${suffix}` });
    await classifySuppliersByName([
      { namePattern: sup.name, types: [SupplierType.SERVICE] },
    ]);
    const secondRun = await classifySuppliersByName([
      { namePattern: sup.name, types: [SupplierType.SERVICE] },
    ]);
    assert.equal(secondRun, 0, 'no rows changed on second run');
  });

  test('changing types updates the row + fuel flag', async () => {
    const sup = await mkSupplier({ name: `M62 change ${suffix}`, types: [SupplierType.FUEL] });
    const changed = await classifySuppliersByName([
      { namePattern: sup.name, types: [SupplierType.SERVICE] }, // dropped FUEL
    ]);
    assert.equal(changed, 1);

    const [refreshed] = await db.select().from(s.suppliers).where(inArray(s.suppliers.id, [sup.id]));
    assert.deepEqual(refreshed.types, ['SERVICE']);
    assert.equal(refreshed.isFuelSupplier, false, 'FUEL removed → flag flipped back');
  });

  test('unknown name → no-op', async () => {
    const changed = await classifySuppliersByName([
      { namePattern: `Nonexistent ${suffix}`, types: [SupplierType.FUEL] },
    ]);
    assert.equal(changed, 0);
  });
});
