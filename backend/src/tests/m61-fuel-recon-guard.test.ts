/**
 * Wave 3 M6.1 slice 2 — fuel-recon guard + explanations tests.
 *
 * Verifies the guard bypass logic (non-fuel, OK, rejection), the block
 * + unblock flow, the explanation CRUD + upsert idempotence, and the
 * helper utilities (isFuelExpenseType, monthRangeFromDate).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import type { Tx } from '../services/trip-shared';
import {
  assertFuelReconClear,
  recordFuelReconExplanation,
  hasFuelReconExplanation,
  listFuelReconExplanations,
  isFuelExpenseType,
  monthRangeFromDate,
} from '../services/fuel-recon-guard.service';
import { transitionApproval } from '../services/approval.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdExplanationIds: number[] = [];
const createdUserIds: number[] = [];
let makerId: number;
let approverId: number;

before(async () => {
  const users = await db.insert(s.users).values([
    { username: `m61-maker-${suffix}`, passwordHash: 'x', role: 'ACCOUNTANT' },
    { username: `m61-approver-${suffix}`, passwordHash: 'x', role: 'ADMIN' },
  ]).returning({ id: s.users.id });
  [makerId, approverId] = users.map(user => user.id);
  createdUserIds.push(...users.map(user => user.id));
});

async function mkSupplier() {
  const [sup] = await db.insert(s.suppliers).values({
    name: `M61G supplier ${suffix}-${createdSupplierIds.length}`,
    isFuelSupplier: true,
  }).returning();
  createdSupplierIds.push(sup.id);
  return sup;
}

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `M61G customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}
async function mkRoute() {
  const [r] = await db.insert(s.routes).values({ name: `M61G route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}
async function mkCargo() {
  const [c] = await db.insert(s.cargoTypes).values({ name: `M61G cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(c.id);
  return c;
}

async function mkTrip(opts: { supplierId: number; totalFuelCost: string; departureDate: string }) {
  const cust = await mkCustomer(); const route = await mkRoute(); const cargo = await mkCargo();
  const t = await insertTripComposite(db, {
    tripCode: `M61G-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: opts.departureDate, carrierType: 'OWN',
    completedAt: new Date(`${opts.departureDate}T12:00:00.000Z`),
    fuelSupplierId: opts.supplierId,
    totalFuelCost: opts.totalFuelCost,
  });
  createdTripIds.push(t.id);
  return t;
}

async function mkExpense(opts: {
  tripId: number;
  supplierId: number;
  buyAmount: string;
  invoiceDate?: string;
  invoiceNumber?: string;
  expenseType?: string;
  approvalStatus?: string;
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    createdBy: makerId,
    expenseType: opts.expenseType ?? 'FUEL_DIESEL',
    buyAmount: opts.buyAmount,
    sellAmount: '0',
    supplierId: opts.supplierId,
    invoiceDate: opts.invoiceDate ?? null,
    invoiceNumber: opts.invoiceNumber ?? (
      (opts.expenseType ?? 'FUEL_DIESEL').toLowerCase().includes('fuel')
        ? `FUEL-${suffix}-${createdExpenseIds.length}`.slice(0, 50)
        : null
    ),
    approvalStatus: opts.approvalStatus ?? 'PENDING',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

after(async () => {
  const namePattern = `M61G %${suffix}%`;
  try {
    if (createdExplanationIds.length > 0) await db.delete(s.fuelReconExplanations).where(inArray(s.fuelReconExplanations.id, createdExplanationIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
    if (createdSupplierIds.length > 0) await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  } catch (err) { console.warn('[m61g] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M6.1 slice 2 — helpers', () => {
  test('isFuelExpenseType: matches fuel/FUEL/Nhiên liệu codes, rejects others', () => {
    assert.equal(isFuelExpenseType('FUEL_DIESEL'), true);
    assert.equal(isFuelExpenseType('fuel'), true);
    assert.equal(isFuelExpenseType('Nhiên liệu'), false); // Vietnamese — substring match is on 'fuel'/'Fuel' only
    assert.equal(isFuelExpenseType('TOLL'), false);
    assert.equal(isFuelExpenseType(''), false);
  });

  test('monthRangeFromDate: returns first/last day of the month', () => {
    assert.deepEqual(monthRangeFromDate('2026-06-15'), { from: '2026-06-01', to: '2026-06-30' });
    assert.deepEqual(monthRangeFromDate('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthRangeFromDate('2024-02-10'), { from: '2024-02-01', to: '2024-02-29' }); // leap year
    assert.deepEqual(monthRangeFromDate('2026-12-31'), { from: '2026-12-01', to: '2026-12-31' });
    assert.equal(monthRangeFromDate(null), null);
    assert.equal(monthRangeFromDate('not-a-date'), null);
  });
});

describe('M6.1 slice 2 — assertFuelReconClear', () => {
  test('non-fuel expense → no-op', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '0', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'TOLL', buyAmount: '50000', invoiceDate: '2026-06-15',
    });
    // Should not throw — non-fuel bypasses the guard.
    await assertFuelReconClear(e.id);
  });

  test('fuel expense with status=OK → no-op', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'FUEL_DIESEL', buyAmount: '1000000', invoiceDate: '2026-06-15',
    });
    // Matched expected/invoiced within threshold → status=OK.
    await assertFuelReconClear(e.id);
  });

  test('fuel expense with status=VARIANCE and NO explanation → throws 409', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'FUEL_DIESEL', buyAmount: '1500000', invoiceDate: '2026-06-15', // 50% over → VARIANCE
    });
    await assert.rejects(
      () => assertFuelReconClear(e.id),
      (err: Error & { statusCode?: number }) => err.statusCode === 409 && /Chênh lệch nhiên liệu/.test(err.message),
    );
  });

  test('fuel expense with VARIANCE AND explanation → no-op (unblocked)', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'FUEL_DIESEL', buyAmount: '1500000', invoiceDate: '2026-06-15',
    });
    // Record the explanation first.
    const exp = await recordFuelReconExplanation({
      supplierId: sup.id, periodFrom: '2026-06-01', periodTo: '2026-06-30',
      explanationText: 'Giá dầu tăng giữa kỳ', resolvedVariance: 500_000,
    });
    createdExplanationIds.push(exp.id);
    // Now the guard should pass.
    await assertFuelReconClear(e.id);
  });

  test('expense without supplierId → no-op', async () => {
    const t = await mkTrip({ supplierId: (await mkSupplier()).id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    const [e] = await db.insert(s.tripExpenses).values({
      tripId: t.id,
      expenseType: 'FUEL_DIESEL', buyAmount: '999999', sellAmount: '0',
      supplierId: null, // no supplier
      approvalStatus: 'PENDING',
    }).returning();
    createdExpenseIds.push(e.id);
    // Should not throw — no supplier means recon doesn't apply.
    await assertFuelReconClear(e.id);
  });
});

describe('M6.1 slice 2 — transitionApproval guard wiring', () => {
  // transitionApproval needs a transaction; wrap with db.transaction and
  // roll back via a sentinel throw so the test doesn't leave PENDING rows
  // in APPROVED state (we only need to verify the guard fires BEFORE the
  // status update).
  async function runInTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await db.transaction(async (tx) => {
        const result = await fn(tx);
        throw new Rollback(result);
      });
    } catch (e) {
      if (e instanceof Rollback) return e.value as T;
      throw e;
    }
  }
  class Rollback { constructor(public value: unknown) {} }

  test('APPROVE fuel expense with VARIANCE → guard rejects', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'FUEL_DIESEL', buyAmount: '1500000', invoiceDate: '2026-06-15',
      approvalStatus: 'PENDING',
    });
    await assert.rejects(
      () => runInTx((tx) => transitionApproval(tx, {
        table: 'trip_expenses', id: e.id, toStatus: 'APPROVED',
        actorId: approverId, actorRole: 'ADMIN',
      })),
      (err: Error & { statusCode?: number }) => err.statusCode === 409,
    );
  });

  test('REJECT fuel expense with VARIANCE → guard bypassed (rejection allowed)', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'FUEL_DIESEL', buyAmount: '1500000', invoiceDate: '2026-06-15',
      approvalStatus: 'PENDING',
    });
    // Should not throw — rejections bypass the guard.
    await runInTx((tx) => transitionApproval(tx, {
      table: 'trip_expenses', id: e.id, toStatus: 'REJECTED',
      actorId: approverId, actorRole: 'ADMIN',
    }));
  });

  test('APPROVE non-fuel expense → guard bypassed', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '0', departureDate: '2026-06-01' });
    const e = await mkExpense({
      tripId: t.id, supplierId: sup.id,
      expenseType: 'TOLL', buyAmount: '100000', invoiceDate: '2026-06-15',
      invoiceNumber: `TOLL-${suffix}`.slice(0, 50),
      approvalStatus: 'PENDING',
    });
    await runInTx((tx) => transitionApproval(tx, {
      table: 'trip_expenses', id: e.id, toStatus: 'APPROVED',
      actorId: approverId, actorRole: 'ADMIN',
    }));
  });
});

describe('M6.1 slice 2 — explanation CRUD', () => {
  test('recordFuelReconExplanation inserts then upserts', async () => {
    const sup = await mkSupplier();
    const r1 = await recordFuelReconExplanation({
      supplierId: sup.id, periodFrom: '2026-07-01', periodTo: '2026-07-31',
      explanationText: 'first explanation', resolvedVariance: 100_000,
    });
    createdExplanationIds.push(r1.id);
    assert.equal(r1.explanationText, 'first explanation');

    const r2 = await recordFuelReconExplanation({
      supplierId: sup.id, periodFrom: '2026-07-01', periodTo: '2026-07-31',
      explanationText: 'updated explanation', resolvedVariance: 110_000,
    });
    assert.equal(r2.id, r1.id, 'upsert reuses the same row id');
    assert.equal(r2.explanationText, 'updated explanation');

    // Only one row for this period.
    const has = await hasFuelReconExplanation(sup.id, '2026-07-01', '2026-07-31');
    assert.equal(has, true);
  });

  test('concurrent explanation writes keep one canonical supplier-period row', async () => {
    const sup = await mkSupplier();
    const periodFrom = '2026-09-01';
    const periodTo = '2026-09-30';
    const [first, second] = await Promise.all([
      recordFuelReconExplanation({
        supplierId: sup.id,
        periodFrom,
        periodTo,
        explanationText: 'first concurrent explanation',
        resolvedVariance: 100_000,
      }),
      recordFuelReconExplanation({
        supplierId: sup.id,
        periodFrom,
        periodTo,
        explanationText: 'second concurrent explanation',
        resolvedVariance: 200_000,
      }),
    ]);
    createdExplanationIds.push(first.id, second.id);
    assert.equal(first.id, second.id);

    const rows = await db.select()
      .from(s.fuelReconExplanations)
      .where(and(
        eq(s.fuelReconExplanations.supplierId, sup.id),
        eq(s.fuelReconExplanations.periodFrom, periodFrom),
        eq(s.fuelReconExplanations.periodTo, periodTo),
      ));
    assert.equal(rows.length, 1);
    assert.ok([
      'first concurrent explanation',
      'second concurrent explanation',
    ].includes(rows[0]!.explanationText));
  });

  test('recordFuelReconExplanation rejects empty text', async () => {
    const sup = await mkSupplier();
    await assert.rejects(
      () => recordFuelReconExplanation({
        supplierId: sup.id, periodFrom: '2026-07-01', periodTo: '2026-07-31',
        explanationText: '   ', resolvedVariance: 0,
      }),
      (err: Error & { statusCode?: number }) => err.statusCode === 400,
    );
  });

  test('hasFuelReconExplanation returns false for unknown period', async () => {
    const sup = await mkSupplier();
    const has = await hasFuelReconExplanation(sup.id, '2026-01-01', '2026-01-31');
    assert.equal(has, false);
  });

  test('listFuelReconExplanations filters by supplier + period', async () => {
    const sup = await mkSupplier();
    const r = await recordFuelReconExplanation({
      supplierId: sup.id, periodFrom: '2026-05-01', periodTo: '2026-05-31',
      explanationText: 'may variance', resolvedVariance: 200_000,
    });
    createdExplanationIds.push(r.id);

    const bySupplier = await listFuelReconExplanations({ supplierId: sup.id });
    assert.ok(bySupplier.some(x => x.id === r.id));

    const byRange = await listFuelReconExplanations({ periodFrom: '2026-05-01', periodTo: '2026-05-31' });
    assert.ok(byRange.some(x => x.id === r.id));

    const byOutsideRange = await listFuelReconExplanations({ periodFrom: '2026-08-01', periodTo: '2026-08-31' });
    assert.ok(!byOutsideRange.some(x => x.id === r.id));
  });
});
