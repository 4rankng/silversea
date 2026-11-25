// CR-011 Task 4.2 — the contractor→carrier link on the write-path primitive.
// A supplier with NO types (the shape a fresh [+ Thêm nhà thầu phụ] row used
// to carry) that is ACTIVE and CARRIER-typed mints its `customers.isCarrier`
// mirror exactly once — the invariant all 4 vehicle-assignment dropdowns read
// (`is_carrier = true AND status = 'ACTIVE'`). Real dev DB, tracked cleanup,
// unique suffix so no other suite can bleed in.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, isNull } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { ensureSupplierCarrierLink } from '../services/supplier-carrier-link.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

after(async () => {
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

async function mkSupplier(opts: { name: string; types: string[] }) {
  const [supplier] = await db.insert(s.suppliers).values({
    name: opts.name, shortName: opts.name, status: 'ACTIVE', types: opts.types,
  }).returning({ id: s.suppliers.id, name: s.suppliers.name });
  track(s.suppliers, supplier.id);
  return supplier;
}

describe('CR-011 — ensureSupplierCarrierLink mints the carrier mirror (Task 4.2)', () => {
  test('a CARRIER-typed supplier with no link gets a linked is_carrier customer', async () => {
    const supplier = await mkSupplier({ name: `CR011 carrier ${suffix}`, types: ['CARRIER'] });
    const linkedId = await ensureSupplierCarrierLink(db as never, {
      id: supplier.id, name: supplier.name, shortName: supplier.name, status: 'ACTIVE', taxCode: null, types: ['CARRIER'],
    }, null);
    assert.ok(linkedId != null, 'a named carrier supplier mints its customer mirror');
    track(s.customers, linkedId!);
    const [customer] = await db.select().from(s.customers).where(eq(s.customers.id, linkedId!));
    assert.equal(customer.isCarrier, true);
    assert.equal(customer.linkedSupplierId, supplier.id);
    const [fresh] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplier.id));
    assert.equal(fresh.linkedCustomerId, linkedId);
  });

  test('re-running is idempotent — the same link, never a second customer', async () => {
    const supplier = await mkSupplier({ name: `CR011 idempotent ${suffix}`, types: [] });
    const first = await ensureSupplierCarrierLink(db as never, {
      id: supplier.id, name: supplier.name, shortName: supplier.name, status: 'ACTIVE', taxCode: null, types: ['CARRIER'],
    }, null);
    assert.ok(first != null);
    track(s.customers, first!);
    const second = await ensureSupplierCarrierLink(db as never, {
      id: supplier.id, name: supplier.name, shortName: supplier.name, status: 'ACTIVE', taxCode: null, types: ['CARRIER'],
    }, first);
    assert.equal(second, first);
    const mirrors = await db.select({ id: s.customers.id }).from(s.customers)
      .where(and(eq(s.customers.linkedSupplierId, supplier.id), isNull(s.customers.deletedAt)));
    assert.equal(mirrors.length, 1);
  });

  test('a non-carrier supplier never mints a mirror (the Petrolimex guard stays)', async () => {
    const supplier = await mkSupplier({ name: `CR011 fuel ${suffix}`, types: ['FUEL'] });
    const linkedId = await ensureSupplierCarrierLink(db as never, {
      id: supplier.id, name: supplier.name, shortName: supplier.name, status: 'ACTIVE', taxCode: null, types: ['FUEL'],
    }, null);
    assert.equal(linkedId, null);
    const [fresh] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, supplier.id));
    assert.equal(fresh.linkedCustomerId, null);
  });
});
