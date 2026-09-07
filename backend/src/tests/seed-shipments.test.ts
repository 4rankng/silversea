/**
 * `seedShipments()` integration test.
 *
 * Verifies the seed block exported from `seed.ts`:
 *   - Creates the CUSTOMER demo user.
 *   - Creates the 5 stable sample customers (or finds them by taxCode).
 *   - Creates the 16 sample shipments across both trade directions and every
 *   - lifecycle status, each addressed by exactly ONE document ref
 *     (blNumber for IMPORT, bookingRef for EXPORT — the one-ref invariant).
 *   - Attaches the expected children to the seeded shipments (containers,
 *     documents, declarations, status-history rows).
 *   - IDEMPOTENCY: running the seed twice produces the same row counts —
 *     no duplicate shipments, no duplicate children, no duplicate users.
 *
 * Hits the real Postgres DB (mirrors shipment-service.test.ts). All rows
 * created by THIS test (the sample shipments + the 5 stable sample customers
 * + the CUSTOMER demo user if it did not pre-exist) are cleaned up in `after`
 * so re-running the test file does not accumulate. Rows that pre-existed
 * (from `pnpm seed`) are preserved via the `preExisting*` snapshots so the
 * dev environment's seed state survives.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { asc, eq, inArray, or } from 'drizzle-orm';

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
// The one-ref invariant stores each ref in exactly one column: blNumber for
// IMPORT, bookingRef for EXPORT.
const IMPORT_BL_REFS = [
  '105254544125', '105254544198', '137465191612', '137465191698',
  '105254549001', '105254549088', '137465192255', '105254550147', '137465192801',
];
const EXPORT_BOOKING_REFS = ['DNKM13333', 'DNKM13334', 'DNKM13335', 'DNKM13336', 'DNKM13337', 'DNKM13338', 'DNKM13339'];
const SAMPLE_TAX_CODES = ['0101234567', '0107654321', '1100987654', '1100456789', '0700321654'];
const CUSTOMER_USERNAME = 'customer';

// Expected status after seedShipments' own ladder — refs later dispatched by
// seed-trips (through the real dispatch chain) are NOT asserted here.
// DNKM13337 is the deep-ladder EXPORT fixture: under the retired
// PENDING_EXPENSE_APPROVAL contract (commit 4651f8f2, 2026-09-05) it now
// lands at IN_TRANSIT (seed.ts applies ['DISPATCHED', 'IN_TRANSIT']); the
// retired stage is kept only as an exit target for legacy rows, so a
// newly-seeded shipment can no longer reach it.
const EXPECTED_STATUS: Record<string, string> = {
  '105254544125': 'READY_FOR_DISPATCH', // expectedDeliveryDate → date-derived readiness
  '105254544198': 'PENDING_DATE', // no dates → awaiting schedule
  '137465192801': 'CANCELED',
  DNKM13333: 'DISPATCHED',
  DNKM13334: 'READY_FOR_DISPATCH',
  DNKM13337: 'IN_TRANSIT', // full ladder: DISPATCHED → IN_TRANSIT (PENDING_EXPENSE_APPROVAL retired)
  DNKM13339: 'CANCELED',
};

// Per-ref child expectations (containers / document / declaration counts).
const EXPECTED_CONTAINERS: Record<string, number> = {
  '137465191612': 2, '137465191698': 1, '105254549001': 2, '105254549088': 1,
  '137465192255': 2, '105254550147': 1, DNKM13335: 1, DNKM13336: 2, DNKM13337: 1, DNKM13338: 1,
};

// Lifecycle-ladder history depth ≥ creation row + one row per legal
// transition. DNKM13337's depth dropped from 4 → 3 when the
// PENDING_EXPENSE_APPROVAL transition was retired (2026-09-05); only the
// READY_FOR_DISPATCH creation row + DISPATCHED + IN_TRANSIT transitions
// remain.
const EXPECTED_HISTORY: Record<string, number> = {
  '105254544125': 1, '105254544198': 1,
  '137465192801': 2, DNKM13333: 1, DNKM13334: 1,
  DNKM13337: 3, DNKM13339: 2,
};

// Snapshot of SEED-* rows that existed BEFORE this test ran (created by a
// prior `pnpm seed`). The test cleans up only what it creates, so a prior
// seed run's rows are preserved.
const preExistingShipmentIds = new Set<number>();
const preExistingCustomerIds = new Set<number>();
const preExistingCustomerUser: {
  value: Pick<typeof s.users.$inferSelect, 'id' | 'email' | 'customerId'> | null;
} = { value: null };

async function findSeedShipments(): Promise<{ id: number; blNumber: string | null; bookingRef: string | null }[]> {
  return await db.select({ id: s.shipments.id, blNumber: s.shipments.blNumber, bookingRef: s.shipments.bookingRef })
    .from(s.shipments)
    .where(or(
      inArray(s.shipments.blNumber, IMPORT_BL_REFS),
      inArray(s.shipments.bookingRef, EXPORT_BOOKING_REFS),
    ));
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

  test('creates 16 sample shipments — one document ref each, across both directions', async () => {
    const shipments = await findSeedShipments();
    assert.equal(shipments.length, 16, 'exactly 16 sample shipments');
    const refOf = (sh: { blNumber: string | null; bookingRef: string | null }) => sh.blNumber ?? sh.bookingRef;
    const byRef = new Map(shipments.map((sh) => [refOf(sh), sh.id]));
    for (const ref of [...IMPORT_BL_REFS, ...EXPORT_BOOKING_REFS]) {
      assert.ok(byRef.has(ref), `shipment with ref=${ref} exists`);
    }

    // One-ref invariant: IMPORT rows carry blNumber only, EXPORT rows carry
    // bookingRef only — never both, never neither.
    for (const sh of shipments) {
      assert.ok(
        (sh.blNumber != null) !== (sh.bookingRef != null),
        `shipment ${sh.id} populates exactly one document ref`,
      );
    }

    // Verify the expected status for refs the trip-seeder does not dispatch.
    const rows = await db.select({ blNumber: s.shipments.blNumber, bookingRef: s.shipments.bookingRef, status: s.shipments.status })
      .from(s.shipments)
      .where(or(
        inArray(s.shipments.blNumber, IMPORT_BL_REFS),
        inArray(s.shipments.bookingRef, EXPORT_BOOKING_REFS),
      ))
      // Seed refs are reused across directions and the bulk seeder may emit
      // multiple rows per ref — resolve deterministically to the earliest
      // row per ref (mirrors the duplicate guard's orderBy-asc/limit-1).
      .orderBy(asc(s.shipments.id));
    const statusByRef = new Map<string, string>();
    for (const row of rows) {
      const ref = row.blNumber ?? row.bookingRef;
      if (!statusByRef.has(ref)) statusByRef.set(ref, row.status);
    }
    for (const [ref, expected] of Object.entries(EXPECTED_STATUS)) {
      assert.equal(statusByRef.get(ref), expected, `shipment ${ref} status`);
    }
  });

  test('attaches expected children to seeded shipments', async () => {
    const shipments = await findSeedShipments();
    const ids = shipments.map((sh) => sh.id);
    const idByRef = new Map(shipments.map((sh) => [sh.blNumber ?? sh.bookingRef, sh.id]));

    const containers = await db.select({ shipmentId: s.shipmentContainers.shipmentId })
      .from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, ids));
    for (const [ref, expected] of Object.entries(EXPECTED_CONTAINERS)) {
      const actual = containers.filter((c) => c.shipmentId === idByRef.get(ref)).length;
      assert.equal(actual, expected, `shipment ${ref} has ${expected} containers`);
    }

    // 105254549088 has 1 document; DNKM13338 has 1 document.
    const docs = await db.select({ shipmentId: s.shipmentDocuments.shipmentId })
      .from(s.shipmentDocuments)
      .where(inArray(s.shipmentDocuments.shipmentId, ids));
    assert.equal(docs.filter((d) => d.shipmentId === idByRef.get('105254549088')).length, 1, '105254549088 has 1 document');
    assert.equal(docs.filter((d) => d.shipmentId === idByRef.get('DNKM13338')).length, 1, 'DNKM13338 has 1 document');

    // 105254549001 has 1 declaration; DNKM13337 has 1 declaration.
    const decls = await db.select({ shipmentId: s.shipmentDeclarations.shipmentId })
      .from(s.shipmentDeclarations)
      .where(inArray(s.shipmentDeclarations.shipmentId, ids));
    assert.equal(decls.filter((d) => d.shipmentId === idByRef.get('105254549001')).length, 1, '105254549001 has 1 declaration');
    assert.equal(decls.filter((d) => d.shipmentId === idByRef.get('DNKM13337')).length, 1, 'DNKM13337 has 1 declaration');

    // Status history: creation row + one row per legal ladder transition.
    const history = await db.select({ shipmentId: s.shipmentStatusHistory.shipmentId })
      .from(s.shipmentStatusHistory)
      .where(inArray(s.shipmentStatusHistory.shipmentId, ids));
    const countFor = (ref: string) => history.filter((h) => h.shipmentId === idByRef.get(ref)).length;
    for (const [ref, minRows] of Object.entries(EXPECTED_HISTORY)) {
      assert.ok(countFor(ref) >= minRows, `shipment ${ref} has ≥${minRows} history rows`);
    }
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

    // Sample customers stay at 5 (no duplicate).
    const sampleCustomers = await findSampleCustomers();
    assert.equal(sampleCustomers.length, 5, 'exactly five sample customers');
  });
});
