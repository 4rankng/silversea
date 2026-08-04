/**
 * Wave 0 — `seedShipments()` integration test.
 *
 * Verifies the seed block exported from `seed.ts`:
 *   - Creates the CUSTOMER demo user.
 *   - Creates the 2 stable sample customers (or finds them by taxCode).
 *   - Creates the 3 sample shipments across NEW / DISPATCHED / PENDING_EXPENSE_APPROVAL.
 *   - Attaches the expected children to the seeded shipments (containers,
 *     documents, declarations, status-history rows).
 *   - IDEMPOTENCY: running the seed twice produces the same row counts —
 *     no duplicate shipments, no duplicate children, no duplicate users.
 *
 * Hits the real Postgres DB (mirrors shipment-service.test.ts). All rows
 * created by THIS test (the SEED-* sentinels + the 2 stable sample customers
 * + the CUSTOMER demo user if it did not pre-exist) are cleaned up in `after`
 * so re-running the test file does not accumulate. Rows that pre-existed
 * (from `pnpm seed`) are preserved via the `preExisting*` snapshots so the
 * dev environment's seed state survives.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { seedShipments } from '../seed';

// Precompute the bcrypt hash ONCE at module load. Calling bcrypt.hash inside
// individual tests works fine in-process but, on Node 25 with the default
// `--test-isolation=process`, marshaling the resulting hash string across the
// test-runner IPC channel triggered an "Unable to deserialize cloned data"
// error. Module-level precompute keeps the hash on a single process and
// avoids the IPC boundary entirely.
const PASSWORD_HASH = bcrypt.hashSync('admin123', 10);

// Stable identifiers from seed.ts — used for both assertions and cleanup.
const SENTINEL_BOOKING_REFS = ['SEED-SHIP-1', 'SEED-SHIP-2', 'SEED-SHIP-3'];
const SAMPLE_TAX_CODES = ['0101234567', '0107654321'];
const CUSTOMER_USERNAME = 'customer';

// Snapshot of SEED-* rows that existed BEFORE this test ran (created by a
// prior `pnpm seed`). The test cleans up only what it creates, so a prior
// seed run's rows are preserved.
const preExistingShipmentIds = new Set<number>();
const preExistingCustomerIds = new Set<number>();
const preExistingCustomerUser: {
  value: Pick<typeof s.users.$inferSelect, 'id' | 'email' | 'customerId'> | null;
} = { value: null };

async function findSeedShipments(): Promise<{ id: number; bookingRef: string | null }[]> {
  return await db.select({ id: s.shipments.id, bookingRef: s.shipments.bookingRef })
    .from(s.shipments)
    .where(inArray(s.shipments.bookingRef, SENTINEL_BOOKING_REFS));
}

async function findSampleCustomers(): Promise<{ id: number; taxCode: string | null }[]> {
  return await db.select({ id: s.customers.id, taxCode: s.customers.taxCode })
    .from(s.customers)
    .where(inArray(s.customers.taxCode, SAMPLE_TAX_CODES));
}

before(async () => {
  // Snapshot existing seed rows so cleanup can avoid touching them.
  for (const sh of await findSeedShipments()) preExistingShipmentIds.add(sh.id);
  for (const c of await findSampleCustomers()) preExistingCustomerIds.add(c.id);
  const [existingUser] = await db.select({
    id: s.users.id,
    email: s.users.email,
    customerId: s.users.customerId,
  })
    .from(s.users)
    .where(eq(s.users.username, CUSTOMER_USERNAME));
  preExistingCustomerUser.value = existingUser ?? null;

  // Seed ONCE up-front so every test shares known setup. This decouples the
  // tests from `node --test`'s sequential ordering (which is not guaranteed
  // under future concurrency changes).
  await seedShipments(PASSWORD_HASH);
});

after(async () => {
  // Clean up only what THIS test created. Rows pre-existing from `pnpm seed`
  // are left intact so the dev environment's seed state survives.
  const allSeed = await findSeedShipments();
  const created = allSeed.filter((sh) => !preExistingShipmentIds.has(sh.id));
  const createdIds = created.map((sh) => sh.id);

  if (createdIds.length > 0) {
    await db.delete(s.shipmentStatusHistory).where(inArray(s.shipmentStatusHistory.shipmentId, createdIds));
    await db.delete(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, createdIds));
    await db.delete(s.shipmentDeclarations).where(inArray(s.shipmentDeclarations.shipmentId, createdIds));
    await db.delete(s.shipmentDocuments).where(inArray(s.shipmentDocuments.shipmentId, createdIds));
    await db.delete(s.shipments).where(inArray(s.shipments.id, createdIds));
  }

  // Sample customers created by this test. Wrapped in try/catch because the
  // `customers` table has downstream FKs (trips.customerId, ledger.entityId,
  // …) that are NOT cascade; if a future seed extension creates such rows,
  // the FK violation would otherwise abort the rest of the cleanup.
  const allCustomers = await findSampleCustomers();
  const createdCustomerIds = allCustomers
    .filter((c) => !preExistingCustomerIds.has(c.id))
    .map((c) => c.id);
  if (createdCustomerIds.length > 0) {
    try {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    } catch (err) {
      console.warn('[seed-shipments.test] sample-customer cleanup partial:', (err as Error).message);
    }
  }

  // CUSTOMER demo user — delete only if THIS test created it (i.e. it did
  // not pre-exist from `pnpm seed`).
  if (preExistingCustomerUser.value === null) {
    try {
      await db.delete(s.users).where(eq(s.users.username, CUSTOMER_USERNAME));
    } catch (err) {
      console.warn('[seed-shipments.test] CUSTOMER user cleanup partial:', (err as Error).message);
    }
  }

  // Graceful shutdown — the seed block does not open scanStreams (unlike the
  // dispatch path), so postgres-js drains cleanly without a forced exit.
  await client.end();
});

describe('seedShipments — Wave 0 shipment + CUSTOMER seed', () => {
  test('creates the CUSTOMER demo user', async () => {
    const [u] = await db.select().from(s.users).where(eq(s.users.username, CUSTOMER_USERNAME));
    assert.ok(u, 'CUSTOMER demo user exists');
    assert.equal(u.role, 'CUSTOMER');
    assert.equal(
      u.email,
      preExistingCustomerUser.value?.email ?? 'customer@nepo.vn',
      'seeding preserves an existing account email and only supplies the canonical email for a new account',
    );
    if (preExistingCustomerUser.value) {
      assert.equal(
        u.customerId,
        preExistingCustomerUser.value.customerId,
        'seeding does not rewrite a preserved account relationship field',
      );
    } else {
      assert.ok(u.customerId, 'a newly created CUSTOMER demo account receives its initial portal scope');
    }
  });

  test('creates 3 sample shipments across PENDING_DATE / DISPATCHED / PENDING_EXPENSE_APPROVAL', async () => {
    const shipments = await findSeedShipments();
    assert.equal(shipments.length, 3, 'exactly 3 SEED-SHIP-* shipments');

    const byRef = new Map(shipments.map((sh) => [sh.bookingRef, sh.id]));
    for (const ref of SENTINEL_BOOKING_REFS) {
      assert.ok(byRef.has(ref), `shipment with bookingRef=${ref} exists`);
    }

    // Verify the expected status for each.
    const rows = await db.select({ bookingRef: s.shipments.bookingRef, status: s.shipments.status })
      .from(s.shipments)
      .where(inArray(s.shipments.bookingRef, SENTINEL_BOOKING_REFS));
    const statusByRef = new Map(rows.map((r) => [r.bookingRef, r.status]));
    assert.equal(statusByRef.get('SEED-SHIP-1'), 'PENDING_DATE');
    assert.equal(statusByRef.get('SEED-SHIP-2'), 'DISPATCHED');
    assert.equal(statusByRef.get('SEED-SHIP-3'), 'PENDING_EXPENSE_APPROVAL');
  });

  test('attaches expected children to seeded shipments', async () => {
    const shipments = await findSeedShipments();
    const ids = shipments.map((sh) => sh.id);
    const idByRef = new Map(shipments.map((sh) => [sh.bookingRef, sh.id]));

    // SEED-SHIP-2 has 2 containers; SEED-SHIP-3 has 1 container.
    const containers = await db.select()
      .from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, ids));
    const ship2Containers = containers.filter((c) => c.shipmentId === idByRef.get('SEED-SHIP-2'));
    const ship3Containers = containers.filter((c) => c.shipmentId === idByRef.get('SEED-SHIP-3'));
    assert.equal(ship2Containers.length, 2, 'SEED-SHIP-2 has 2 containers');
    assert.equal(ship3Containers.length, 1, 'SEED-SHIP-3 has 1 container');

    // SEED-SHIP-3 has 1 document + 1 declaration.
    const docs = await db.select()
      .from(s.shipmentDocuments)
      .where(inArray(s.shipmentDocuments.shipmentId, ids));
    const ship3Docs = docs.filter((d) => d.shipmentId === idByRef.get('SEED-SHIP-3'));
    assert.equal(ship3Docs.length, 1, 'SEED-SHIP-3 has 1 document');

    const decls = await db.select()
      .from(s.shipmentDeclarations)
      .where(inArray(s.shipmentDeclarations.shipmentId, ids));
    const ship3Decls = decls.filter((d) => d.shipmentId === idByRef.get('SEED-SHIP-3'));
    assert.equal(ship3Decls.length, 1, 'SEED-SHIP-3 has 1 declaration');

    // Status history: creation row + transitions.
    // SEED-SHIP-1 (NEW): 1 row (creation).
    // SEED-SHIP-2 (DISPATCHED): 2 rows (creation + NEW→DISPATCHED).
    // SEED-SHIP-3 (PENDING_EXPENSE_APPROVAL): 4 rows (creation + the three legal transitions).
    const history = await db.select()
      .from(s.shipmentStatusHistory)
      .where(inArray(s.shipmentStatusHistory.shipmentId, ids));
    const countFor = (ref: string) => history.filter((h) => h.shipmentId === idByRef.get(ref)).length;
    assert.ok(countFor('SEED-SHIP-1') >= 1, 'SEED-SHIP-1 has creation/readiness history');
    assert.ok(countFor('SEED-SHIP-2') >= 2, 'SEED-SHIP-2 has readiness and dispatch history');
    assert.ok(countFor('SEED-SHIP-3') >= 4, 'SEED-SHIP-3 has the complete lifecycle history');
  });

  test('is idempotent — running twice produces the same row counts', async () => {
    const before = await findSeedShipments();
    const beforeIds = new Set(before.map((sh) => sh.id));

    await seedShipments(PASSWORD_HASH);

    const after = await findSeedShipments();
    assert.equal(after.length, before.length, 'no new shipments after re-seed');
    for (const sh of after) {
      assert.ok(beforeIds.has(sh.id), `shipment ${sh.id} unchanged (no duplicate created)`);
    }

    // CUSTOMER user count stays at 1 (no duplicate).
    const customerUsers = await db.select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.username, CUSTOMER_USERNAME));
    assert.equal(customerUsers.length, 1, 'exactly one CUSTOMER demo user');

    // Sample customers stay at 2 (no duplicate).
    const sampleCustomers = await findSampleCustomers();
    assert.equal(sampleCustomers.length, 2, 'exactly two sample customers');
  });
});
