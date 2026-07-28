import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { db, client } from '../db';
import * as s from '../db/schema';
import { and, eq, like, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { authorizeExpensePhoto } from '../services/photo-authz.service';
import {
  getForwarderOwnedExpenseId,
  deleteExpensePhoto,
} from '../services/forwarder.service';

/**
 * Decision-matrix + ownership tests for receipt-photo authorization.
 *
 * The `/api/photos` router serves the AMBIGUOUS `expense-photos/<id>/` prefix
 * shared by two receipt tables (expense_photos, trip_expense_photos). Serving
 * is gated by `authorizeExpensePhoto`, which resolves the domain by EXACT
 * storage_key and applies strictest-match. The forwarder write/list/delete
 * endpoints gate on expense ownership via `getForwarderOwnedExpenseId`.
 *
 * These tests seed rows with HARDCODED storage keys (never via addExpensePhoto,
 * whose Date.now() would mask a colliding-key bug — pre-mortem #3) and clean
 * up by the `photoauthz/` namespace marker.
 */

const NS = 'photoauthz';
const KEY = {
  tripOwnedF1: `${NS}/trip-owned-f1.jpg`,
  tripNullFwd: `${NS}/trip-null-fwd.jpg`,
  tripOwnedF2: `${NS}/trip-owned-f2.jpg`,
  collision: `${NS}/collision.jpg`,
  companyOnly: `${NS}/company-only.jpg`,
  nothing: `${NS}/nothing.jpg`,
};

let tripId: number;
let shipmentId: number;
let customerId: number;
let routeId: number;
let cargoTypeId: number;
let fwdActive: number; // FORWARDER, ACTIVE — owns E1
let fwdInactive: number; // FORWARDER, DISABLED — owns E3
let accountantId: number;
let driverId: number;
let expenseE1: number; // forwarderId = fwdActive
let expenseE2: number; // forwarderId = NULL (accountant-created)
let expenseE3: number; // forwarderId = fwdInactive
let companyExpenseId: number;
let seededCompanyExpense = false;

async function ensureUser(username: string, role: Role, status: string): Promise<number> {
  const existing = await db.select({ id: s.users.id }).from(s.users)
    .where(eq(s.users.username, username)).limit(1);
  if (existing[0]) {
    await db.update(s.users).set({ role, status }).where(eq(s.users.id, existing[0].id));
    return existing[0].id;
  }
  const [u] = await db.insert(s.users).values({
    username,
    fullName: `QA ${username}`,
    email: `${username}@photoauthz.test`,
    phone: null,
    passwordHash: 'x',
    role,
    status,
  }).returning({ id: s.users.id });
  return u.id;
}

async function ensureTripExpense(forwarderId: number | null): Promise<number> {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId,
    forwarderId,
    expenseType: 'OTHER',
    buyAmount: '1000',
    sellAmount: '0',
    note: NS,
  }).returning({ id: s.tripExpenses.id });
  return e.id;
}

async function ensureCompanyExpense(): Promise<number> {
  let [supplier] = await db.select({ id: s.suppliers.id }).from(s.suppliers).limit(1);
  if (!supplier) {
    [supplier] = await db.insert(s.suppliers).values({ name: `${NS} supplier` }).returning({ id: s.suppliers.id });
  }
  let [cat] = await db.select({ id: s.expenseCategories.id }).from(s.expenseCategories).limit(1);
  if (!cat) {
    [cat] = await db.insert(s.expenseCategories).values({ name: `${NS} category` }).returning({ id: s.expenseCategories.id });
  }
  const [exp] = await db.insert(s.expenses).values({
    expenseDate: '2026-06-17', // date() column wants a 'YYYY-MM-DD' string, not Date
    supplierId: supplier.id,
    categoryId: cat.id,
    amount: '1000',
    paymentStatus: 'UNPAID',
    note: NS,
  }).returning({ id: s.expenses.id });
  seededCompanyExpense = true;
  return exp.id;
}

before(async () => {
  const suffix = Date.now().toString();
  const [customer] = await db.insert(s.customers).values({ name: `${NS} customer ${suffix}` }).returning();
  const [route] = await db.insert(s.routes).values({ name: `${NS} route ${suffix}` }).returning();
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `${NS} cargo ${suffix}` }).returning();
  customerId = customer.id;
  routeId = route.id;
  cargoTypeId = cargo.id;
  const [shipment] = await db.insert(s.shipments).values({
    shipmentCode: `${NS}-shipment-${suffix}`,
    customerId,
    cargoTypeId,
    status: 'IN_PROGRESS',
  }).returning({ id: s.shipments.id });
  shipmentId = shipment.id;
  const [trip] = await db.insert(s.trips).values({
    tripCode: `${NS}-${suffix}`,
    shipmentId,
    customerId,
    routeId,
    cargoTypeId,
    departureDate: '2026-06-17',
  }).returning({ id: s.trips.id });
  tripId = trip.id;

  fwdActive = await ensureUser('photoauthz_fwd1', Role.FORWARDER, 'ACTIVE');
  fwdInactive = await ensureUser('photoauthz_fwd2', Role.FORWARDER, 'DISABLED');
  accountantId = await ensureUser('photoauthz_acct', Role.ACCOUNTANT, 'ACTIVE');
  driverId = await ensureUser('photoauthz_drv', Role.DRIVER, 'ACTIVE');
  await db.insert(s.userShipmentLinks).values([
    { userId: fwdActive, shipmentId },
    { userId: fwdInactive, shipmentId },
  ]).onConflictDoNothing();

  expenseE1 = await ensureTripExpense(fwdActive);
  expenseE2 = await ensureTripExpense(null);
  expenseE3 = await ensureTripExpense(fwdInactive);
  companyExpenseId = await ensureCompanyExpense();

  // Trip-expense receipt photos (hardcoded keys).
  await db.insert(s.tripExpensePhotos).values([
    { tripExpenseId: expenseE1, storageKey: KEY.tripOwnedF1 },
    { tripExpenseId: expenseE2, storageKey: KEY.tripNullFwd },
    { tripExpenseId: expenseE3, storageKey: KEY.tripOwnedF2 },
    { tripExpenseId: expenseE1, storageKey: KEY.collision }, // also a company receipt below
  ]);

  // Company receipt photos. `collision` deliberately shares a key with the
  // trip-expense row above → strictest-match must deny a forwarder.
  await db.insert(s.expensePhotos).values([
    { expenseId: companyExpenseId, storageKey: KEY.collision },
    { expenseId: companyExpenseId, storageKey: KEY.companyOnly },
  ]);
});

after(async () => {
  try {
    await db.delete(s.tripExpensePhotos).where(like(s.tripExpensePhotos.storageKey, `${NS}/%`));
    await db.delete(s.expensePhotos).where(like(s.expensePhotos.storageKey, `${NS}/%`));
    await db.delete(s.tripExpenses).where(eq(s.tripExpenses.note, NS));
    if (seededCompanyExpense) {
      await db.delete(s.expenses).where(eq(s.expenses.note, NS));
    }
    await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, [fwdActive, fwdInactive]));
    await db.delete(s.trips).where(eq(s.trips.id, tripId));
    await db.delete(s.shipments).where(eq(s.shipments.id, shipmentId));
    await db.delete(s.users).where(like(s.users.username, `${NS}_%`));
    await db.delete(s.cargoTypes).where(eq(s.cargoTypes.id, cargoTypeId));
    await db.delete(s.routes).where(eq(s.routes.id, routeId));
    await db.delete(s.customers).where(eq(s.customers.id, customerId));
  } catch (err) {
    console.warn('[photo-authz.test] cleanup failed:', err);
  }
  await client.end();
});

// ─── authorizeExpensePhoto: full decision matrix ────────────────────────────

test('not_found: key in neither table → 404 for every role', async () => {
  for (const user of [
    { userId: driverId, role: Role.DRIVER },
    { userId: fwdActive, role: Role.FORWARDER },
    { userId: accountantId, role: Role.ACCOUNTANT },
  ]) {
    const d = await authorizeExpensePhoto(KEY.nothing, user);
    assert.strictEqual(d.allow, false);
    assert.strictEqual(d.reason, 'not_found');
  }
});

test('DRIVER is denied every receipt key (drivers never read expense receipts)', async () => {
  for (const key of [KEY.tripOwnedF1, KEY.companyOnly, KEY.collision]) {
    const d = await authorizeExpensePhoto(key, { userId: driverId, role: Role.DRIVER });
    assert.strictEqual(d.allow, false);
    assert.notStrictEqual(d.reason, 'not_found'); // exists, just forbidden
  }
});

test('FORWARDER (ACTIVE, owns) reads own trip-expense receipt', async () => {
  const d = await authorizeExpensePhoto(KEY.tripOwnedF1, { userId: fwdActive, role: Role.FORWARDER });
  assert.strictEqual(d.allow, true);
});

test('FORWARDER loses receipt access immediately when shipment assignment is revoked', async () => {
  await db.delete(s.userShipmentLinks).where(and(
    eq(s.userShipmentLinks.userId, fwdActive),
    eq(s.userShipmentLinks.shipmentId, shipmentId),
  ));
  const denied = await authorizeExpensePhoto(KEY.tripOwnedF1, {
    userId: fwdActive,
    role: Role.FORWARDER,
  });
  assert.strictEqual(denied.allow, false);
  assert.strictEqual(denied.reason, 'forbidden');
  await db.insert(s.userShipmentLinks).values({ userId: fwdActive, shipmentId });
});

test('FORWARDER (ACTIVE) is denied a company-only receipt (B1 confidentiality preserved)', async () => {
  const d = await authorizeExpensePhoto(KEY.companyOnly, { userId: fwdActive, role: Role.FORWARDER });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, 'forbidden');
});

test('FORWARDER (ACTIVE) is denied another forwarder’s receipt', async () => {
  const d = await authorizeExpensePhoto(KEY.tripOwnedF2, { userId: fwdActive, role: Role.FORWARDER });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, 'forbidden');
});

test('NULL-forwarderId (accountant-created) receipt is denied to a forwarder (N3)', async () => {
  // The nullable FK makes ownership genuinely ambiguous; forwarderId===userId
  // denies it naturally. Pending the §4c product decision, default = DENY.
  const d = await authorizeExpensePhoto(KEY.tripNullFwd, { userId: fwdActive, role: Role.FORWARDER });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, 'forbidden');
});

test('FORWARDER (DISABLED) is denied own receipt even though it matches (closes JWT bypass, N5)', async () => {
  const d = await authorizeExpensePhoto(KEY.tripOwnedF2, { userId: fwdInactive, role: Role.FORWARDER });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, 'forbidden');
});

test('collision (key in BOTH tables): forwarder denied with collision reason (strictest-match + N6 signal)', async () => {
  const d = await authorizeExpensePhoto(KEY.collision, { userId: fwdActive, role: Role.FORWARDER });
  // Fwd owns the trip side but not the company side → strictest-match denies.
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, 'collision');
});

test('ACCOUNTANT reads trip-expense receipts, company receipts, and even a colliding key', async () => {
  for (const key of [KEY.tripOwnedF1, KEY.companyOnly, KEY.collision, KEY.tripOwnedF2]) {
    const d = await authorizeExpensePhoto(key, { userId: accountantId, role: Role.ACCOUNTANT });
    assert.strictEqual(d.allow, true, `accountant should read ${key}`);
  }
});

test('ACCOUNTANT can read a receipt owned by a DISABLED forwarder (financial evidence survives disablement)', async () => {
  // Guards the N5 design choice: ACTIVE is validated only on the forwarder-self
  // path, NOT folded into the shared trip lookup (which would corrupt tripMatch
  // for finance reading disabled-owner receipts).
  const d = await authorizeExpensePhoto(KEY.tripOwnedF2, { userId: accountantId, role: Role.ACCOUNTANT });
  assert.strictEqual(d.allow, true);
});

// ─── Forwarder write/list/delete ownership (N1: unowned → 404, never 403) ────

test('getForwarderOwnedExpenseId: owned → id; unowned → null; NULL-forwarderId → null', async () => {
  const owned = await getForwarderOwnedExpenseId(expenseE1, fwdActive);
  assert.strictEqual(owned, expenseE1);

  const unowned = await getForwarderOwnedExpenseId(expenseE3, fwdActive); // E3 belongs to fwdInactive
  assert.strictEqual(unowned, null);

  const nullFwd = await getForwarderOwnedExpenseId(expenseE2, fwdActive); // accountant-created
  assert.strictEqual(nullFwd, null);

  const missing = await getForwarderOwnedExpenseId(9_999_999, fwdActive);
  assert.strictEqual(missing, null);
});

test('deleteExpensePhoto: unowned returns null (route maps to 404, no existence oracle)', async () => {
  // Seed a photo on E3 (owned by fwdInactive), then ask fwdActive to delete.
  const [photo] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId: expenseE3,
    storageKey: `${NS}/delete-unowned.jpg`,
  }).returning({ id: s.tripExpensePhotos.id });

  const result = await deleteExpensePhoto(photo.id, fwdActive);
  assert.strictEqual(result, null, 'unowned delete must return null, not "FORBIDDEN"');

  // cleanup (row must still exist — the unowned delete did nothing)
  await db.delete(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.id, photo.id));
});

test('deleteExpensePhoto: owner deletes successfully and returns the storage key', async () => {
  const [photo] = await db.insert(s.tripExpensePhotos).values({
    tripExpenseId: expenseE1,
    storageKey: `${NS}/delete-owned.jpg`,
  }).returning({ id: s.tripExpensePhotos.id });

  const result = await deleteExpensePhoto(photo.id, fwdActive);
  assert.ok(result && typeof result === 'object', 'owned delete returns a result object');
  assert.strictEqual(result!.storageKey, `${NS}/delete-owned.jpg`);

  // row is gone; ensure no leftover
  const leftover = await db.select({ id: s.tripExpensePhotos.id }).from(s.tripExpensePhotos)
    .where(inArray(s.tripExpensePhotos.id, [photo.id]));
  assert.strictEqual(leftover.length, 0);
});
