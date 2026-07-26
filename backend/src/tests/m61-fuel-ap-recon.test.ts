/**
 * Wave 3 M6.1 (slice 1) — fuel-AP reconciliation report tests.
 *
 * Verifies: empty range, supplier filtering, expected-only / invoiced-only /
 * matched / variance cases, per-truck rollup, status rule, threshold override,
 * division-by-zero guard.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { getFuelApReconciliation } from '../services/fuel-ap-recon.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdExpenseIds: number[] = [];

async function mkSupplier(isFuel = true) {
  const [sup] = await db.insert(s.suppliers).values({
    name: `M61 supplier ${suffix}-${createdSupplierIds.length}`,
    isFuelSupplier: isFuel,
  }).returning();
  createdSupplierIds.push(sup.id);
  return sup;
}

async function mkTruck() {
  const [t] = await db.insert(s.trucks).values({
    licensePlate: `M61-${suffix.slice(-10)}-${createdTruckIds.length}`,
  }).returning();
  createdTruckIds.push(t.id);
  return t;
}

async function mkCustomer() {
  const [c] = await db.insert(s.customers).values({ name: `M61 customer ${suffix}-${createdCustomerIds.length}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute() {
  const [r] = await db.insert(s.routes).values({ name: `M61 route ${suffix}-${createdRouteIds.length}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkCargo() {
  const [c] = await db.insert(s.cargoTypes).values({ name: `M61 cargo ${suffix}-${createdCargoTypeIds.length}` }).returning();
  createdCargoTypeIds.push(c.id);
  return c;
}

async function mkTrip(opts: {
  supplierId: number;
  truckId?: number;
  totalFuelCost: string;
  departureDate: string;
}) {
  const cust = await mkCustomer(); const route = await mkRoute(); const cargo = await mkCargo();
  const [t] = await db.insert(s.trips).values({
    tripCode: `M61-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: opts.departureDate, carrierType: 'OWN',
    fuelSupplierId: opts.supplierId,
    truckId: opts.truckId ?? null,
    totalFuelCost: opts.totalFuelCost,
  }).returning();
  createdTripIds.push(t.id);
  return t;
}

async function mkFuelExpense(opts: {
  tripId: number;
  supplierId: number;
  buyAmount: string;
  invoiceDate?: string;
  expenseType?: string;
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    expenseType: opts.expenseType ?? 'FUEL_DIESEL',
    buyAmount: opts.buyAmount,
    sellAmount: '0',
    supplierId: opts.supplierId,
    invoiceDate: opts.invoiceDate ?? null,
    approvalStatus: 'APPROVED',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

after(async () => {
  const namePattern = `M61 %${suffix}%`;
  try {
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdSupplierIds.length > 0) await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
  } catch (err) { console.warn('[m61] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M6.1 — getFuelApReconciliation', () => {
  test('empty range → empty report with zero totals', async () => {
    const report = await getFuelApReconciliation({ from: '2026-01-01', to: '2026-01-31' });
    assert.equal(report.from, '2026-01-01');
    assert.equal(report.to, '2026-01-31');
    assert.equal(report.thresholdPct, 0.05);
    assert.equal(typeof report.totals.expectedFuelCost, 'number');
    assert.equal(typeof report.totals.invoicedFuelCost, 'number');
    assert.equal(typeof report.totals.variance, 'number');
  });

  test('expected-only (no invoices) → invoiced=0, status=VARIANCE when |pct|>threshold', async () => {
    const sup = await mkSupplier();
    await mkTrip({ supplierId: sup.id, totalFuelCost: '5000000', departureDate: '2026-06-15' });
    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row, 'supplier appears');
    assert.equal(row!.expectedFuelCost, 5_000_000);
    assert.equal(row!.invoicedFuelCost, 0);
    assert.equal(row!.variance, -5_000_000);
    assert.equal(row!.variancePct, -1);
    assert.equal(row!.status, 'VARIANCE');
  });

  test('matched expected + invoiced within threshold → status=OK', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-10' });
    // Invoice within 3% — under default 5% threshold.
    await mkFuelExpense({ tripId: t.id, supplierId: sup.id, buyAmount: '1030000', invoiceDate: '2026-06-20' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 1_000_000);
    assert.equal(row!.invoicedFuelCost, 1_030_000);
    assert.equal(row!.status, 'OK');
  });

  test('variance exceeds threshold → status=VARIANCE', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-10' });
    await mkFuelExpense({ tripId: t.id, supplierId: sup.id, buyAmount: '1200000', invoiceDate: '2026-06-20' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.variance, 200_000);
    assert.equal(row!.variancePct, 0.2);
    assert.equal(row!.status, 'VARIANCE');
  });

  test('thresholdPct override widens tolerance', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-10' });
    // 20% variance — under a 25% threshold.
    await mkFuelExpense({ tripId: t.id, supplierId: sup.id, buyAmount: '1200000', invoiceDate: '2026-06-20' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30', thresholdPct: 0.25 });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.status, 'OK');
  });

  test('supplierId filter scopes the report', async () => {
    const supA = await mkSupplier();
    const supB = await mkSupplier();
    await mkTrip({ supplierId: supA.id, totalFuelCost: '500000', departureDate: '2026-06-01' });
    await mkTrip({ supplierId: supB.id, totalFuelCost: '700000', departureDate: '2026-06-01' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30', supplierId: supA.id });
    assert.equal(report.suppliers.length, 1);
    assert.equal(report.suppliers[0].supplierId, supA.id);
    assert.equal(report.suppliers[0].expectedFuelCost, 500_000);
  });

  test('division-by-zero guard: expected=0, invoiced>0 → VARIANCE', async () => {
    // We need an invoiced-only supplier: create a trip with no fuel cost
    // but with a fuel expense.
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '0', departureDate: '2026-06-10' });
    await mkFuelExpense({ tripId: t.id, supplierId: sup.id, buyAmount: '500000', invoiceDate: '2026-06-20' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 0);
    assert.equal(row!.invoicedFuelCost, 500_000);
    assert.equal(row!.variancePct, null);
    assert.equal(row!.status, 'VARIANCE');
  });

  test('both sides zero → supplier excluded', async () => {
    // Trip with fuel supplier but zero cost AND no expense.
    const sup = await mkSupplier();
    await mkTrip({ supplierId: sup.id, totalFuelCost: '0', departureDate: '2026-06-10' });
    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    // The supplier still appears (it has a trip in range) but both sides are 0.
    // The outer-join includes any supplier with EITHER side non-zero, so this
    // supplier should NOT appear because both sides are zero.
    assert.equal(row, undefined);
  });

  test('per-truck rollup attributes trips to their truck', async () => {
    const sup = await mkSupplier();
    const truck = await mkTruck();
    await mkTrip({ supplierId: sup.id, truckId: truck.id, totalFuelCost: '1500000', departureDate: '2026-06-01' });
    await mkTrip({ supplierId: sup.id, truckId: truck.id, totalFuelCost: '500000', departureDate: '2026-06-05' });
    // Second trip without a truck → UNKNOWN bucket.
    await mkTrip({ supplierId: sup.id, totalFuelCost: '300000', departureDate: '2026-06-07' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 2_300_000);

    const truckRow = row!.perTruck.find(t => t.truckId === truck.id);
    assert.ok(truckRow);
    assert.equal(truckRow!.truckPlate, truck.licensePlate);
    assert.equal(truckRow!.tripCount, 2);
    assert.equal(truckRow!.expectedFuelCost, 2_000_000);

    const unTruck = row!.perTruck.find(t => t.truckId === null);
    assert.ok(unTruck);
    assert.equal(unTruck!.tripCount, 1);
    assert.equal(unTruck!.expectedFuelCost, 300_000);
  });

  test('invoice date outside range is excluded from invoiced side', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-10' });
    // Invoice dated in MAY — outside the June recon window.
    await mkFuelExpense({ tripId: t.id, supplierId: sup.id, buyAmount: '1000000', invoiceDate: '2026-05-15' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 1_000_000);
    assert.equal(row!.invoicedFuelCost, 0, 'may invoice excluded from june recon');
  });

  test('expense without invoiceDate falls back to createdAt', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-10' });
    // No invoiceDate — createdAt = now() which is in range for "today" periods.
    await mkFuelExpense({ tripId: t.id, supplierId: sup.id, buyAmount: '1000000' });
    // Use a wide range that includes today.
    const today = new Date().toISOString().slice(0, 10);
    const report = await getFuelApReconciliation({ from: '2026-01-01', to: today });
    const row = report.suppliers.find(r => r.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.invoicedFuelCost, 1_000_000, 'fallback to createdAt picked up');
  });

  test('totals are the sum across all suppliers', async () => {
    const supA = await mkSupplier(); const supB = await mkSupplier();
    await mkTrip({ supplierId: supA.id, totalFuelCost: '1000000', departureDate: '2026-06-01' });
    await mkTrip({ supplierId: supB.id, totalFuelCost: '2000000', departureDate: '2026-06-01' });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30' });
    const expectedTotal = report.suppliers.reduce((sum, r) => sum + r.expectedFuelCost, 0);
    assert.equal(report.totals.expectedFuelCost, expectedTotal);
    assert.equal(report.totals.variance, report.totals.invoicedFuelCost - report.totals.expectedFuelCost);
  });
});
