/**
 * Wave 3 M4.6 — invoice-required enforcement in the approval flow.
 *
 * Verifies the wiring of assertInvoiceRequiredForExpense into
 * transitionApproval: approval is blocked when the FET has
 * requiresInvoice=true AND invoiceNumber/invoiceDate are missing.
 * Rejections, non-invoice-required types, and unknown codes bypass.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { transitionApproval } from '../services/approval.service';
import {
  checkTripExpenseInvoiceByCode,
  assertInvoiceRequiredForExpense,
} from '../services/invoice-required.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdFetIds: number[] = [];
const createdExpenseIds: number[] = [];

async function mkFet(requiresInvoice: boolean, tag: string) {
  const code = `M46-${tag}-${suffix}-${createdFetIds.length}`;
  const [fet] = await db.insert(s.forwarderExpenseTypes).values({
    code,
    name: `M46 type ${tag} ${suffix}`,
    requiresInvoice,
  }).returning();
  createdFetIds.push(fet.id);
  return fet;
}

async function mkTrip() {
  const [cust] = await db.insert(s.customers).values({ name: `M46 cust ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(cust.id);
  const [route] = await db.insert(s.routes).values({ name: `M46 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(route.id);
  const [cargo] = await db.insert(s.cargoTypes).values({ name: `M46 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(cargo.id);
  const [trip] = await db.insert(s.trips).values({
    tripCode: `M46-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: '2026-07-15', carrierType: 'OWN',
  }).returning();
  createdTripIds.push(trip.id);
  return trip;
}

async function mkExpense(opts: {
  tripId: number;
  expenseTypeCode: string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  note?: string | null;
  approvalStatus?: string;
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    expenseType: opts.expenseTypeCode,
    buyAmount: '100000',
    sellAmount: '0',
    supplierId: null,
    invoiceNumber: opts.invoiceNumber ?? null,
    invoiceDate: opts.invoiceDate ?? null,
    note: opts.note ?? null,
    approvalStatus: opts.approvalStatus ?? 'PENDING',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

/** Run transitionApproval inside a transaction that we force-rollback via
 *  a sentinel throw, so the test doesn't leave PENDING rows in APPROVED
 *  state. The guard fires BEFORE the status update, so we still observe
 *  whether it threw. */
async function runApproveTx(expenseId: number, actorRole: 'ADMIN' | 'ACCOUNTANT' = 'ADMIN'): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await transitionApproval(tx, {
        table: 'trip_expenses', id: expenseId, toStatus: 'APPROVED',
        actorId: 1, actorRole,
      });
      throw new RollbackSentinel();
    });
  } catch (e) {
    if (e instanceof RollbackSentinel) return;
    throw e;
  }
}
class RollbackSentinel extends Error {}

after(async () => {
  const namePattern = `M46 %${suffix}%`;
  try {
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdFetIds.length > 0) await db.delete(s.forwarderExpenseTypes).where(inArray(s.forwarderExpenseTypes.id, createdFetIds));
  } catch (err) { console.warn('[m46] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M4.6 — checkTripExpenseInvoiceByCode', () => {
  test('requiresInvoice=true + missing both fields → hasInvoice=false, missingFields lists both', async () => {
    const fet = await mkFet(true, 'req');
    const r = await checkTripExpenseInvoiceByCode(fet.code, null, null);
    assert.equal(r.requiresInvoice, true);
    assert.equal(r.hasInvoice, false);
    assert.deepEqual(r.missingFields.sort(), ['invoiceDate', 'invoiceNumber']);
  });

  test('requiresInvoice=true + both fields present → hasInvoice=true', async () => {
    const fet = await mkFet(true, 'req');
    const r = await checkTripExpenseInvoiceByCode(fet.code, 'INV-001', '2026-07-15');
    assert.equal(r.hasInvoice, true);
    assert.equal(r.missingFields.length, 0);
  });

  test('requiresInvoice=false → hasInvoice=true regardless of fields', async () => {
    const fet = await mkFet(false, 'opt');
    const r = await checkTripExpenseInvoiceByCode(fet.code, null, null);
    assert.equal(r.requiresInvoice, false);
    assert.equal(r.hasInvoice, true);
  });

  test('unknown code → fail open (requiresInvoice=false)', async () => {
    const r = await checkTripExpenseInvoiceByCode(`UNKNOWN-${suffix}`, null, null);
    assert.equal(r.requiresInvoice, false);
    assert.equal(r.hasInvoice, true);
  });
});

describe('M4.6 — assertInvoiceRequiredForExpense (standalone)', () => {
  test('throws 400 when requiresInvoice=true and invoiceNumber missing', async () => {
    const fet = await mkFet(true, 'req-num');
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, invoiceNumber: null, invoiceDate: '2026-07-15' });
    await assert.rejects(
      () => assertInvoiceRequiredForExpense(e.id),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /invoiceNumber/.test(err.message),
    );
  });

  test('throws 400 when requiresInvoice=true and invoiceDate missing', async () => {
    const fet = await mkFet(true, 'req-date');
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, invoiceNumber: 'INV-002', invoiceDate: null });
    await assert.rejects(
      () => assertInvoiceRequiredForExpense(e.id),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /invoiceDate/.test(err.message),
    );
  });

  test('no-op when requiresInvoice=false', async () => {
    const fet = await mkFet(false, 'opt');
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, invoiceNumber: null, invoiceDate: null });
    await assertInvoiceRequiredForExpense(e.id); // should not throw
  });

  test('no-op for unknown expense code (fail open)', async () => {
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: `NOPE-${suffix}` });
    await assertInvoiceRequiredForExpense(e.id); // should not throw
  });

  test('no-op when expense does not exist (let downstream 404 fire)', async () => {
    await assertInvoiceRequiredForExpense(99_999_999); // should not throw
  });
});

describe('M4.6 — transitionApproval wiring', () => {
  test('APPROVE requiresInvoice=true expense missing invoiceNumber → guard rejects', async () => {
    const fet = await mkFet(true, 'wiring-num');
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, invoiceNumber: null, invoiceDate: '2026-07-15' });
    await assert.rejects(
      () => runApproveTx(e.id),
      (err: Error & { statusCode?: number }) => err.statusCode === 400 && /hóa đơn/.test(err.message),
    );
  });

  test('APPROVE requiresInvoice=true expense with both invoice fields → succeeds', async () => {
    const fet = await mkFet(true, 'wiring-ok');
    const trip = await mkTrip();
    const e = await mkExpense({
      tripId: trip.id, expenseTypeCode: fet.code,
      invoiceNumber: 'INV-OK', invoiceDate: '2026-07-15',
    });
    // Should not throw — approval proceeds (then rolls back via sentinel).
    await runApproveTx(e.id);
  });

  test('APPROVE requiresInvoice=false expense → M4.6 guard bypassed (note satisfies M4.7)', async () => {
    const fet = await mkFet(false, 'wiring-skip');
    const trip = await mkTrip();
    // M4.7 (no-invoice disbursement) now also requires a note for the
    // requiresInvoice=false branch — provide one so this test isolates the
    // M4.6 guard's bypass behavior without tripping M4.7's evidence rule.
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, invoiceNumber: null, invoiceDate: null, note: 'tiền nước' });
    await runApproveTx(e.id);
  });

  test('REJECT requiresInvoice=true expense missing invoice → guard bypassed (rejection allowed)', async () => {
    const fet = await mkFet(true, 'wiring-reject');
    const trip = await mkTrip();
    const e = await mkExpense({ tripId: trip.id, expenseTypeCode: fet.code, invoiceNumber: null, invoiceDate: null });
    // Rejection should not throw — guard only runs on APPROVED transitions.
    try {
      await db.transaction(async (tx) => {
        await transitionApproval(tx, {
          table: 'trip_expenses', id: e.id, toStatus: 'REJECTED',
          actorId: 1, actorRole: 'ADMIN',
        });
        throw new RollbackSentinel();
      });
    } catch (err) {
      if (!(err instanceof RollbackSentinel)) throw err;
    }
  });
});
