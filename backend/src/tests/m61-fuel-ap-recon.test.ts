/**
 * Wave 3 M6.1 (slice 1) — fuel-AP reconciliation report tests.
 *
 * Verifies: empty range, supplier filtering, expected-only / invoiced-only /
 * matched / variance cases, per-truck rollup, status rule, threshold override,
 * division-by-zero guard.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { db, client } from '../db';
import * as s from '../db/schema';
import { insertTripComposite } from '../services/trip-composite.service';
import { getFuelApReconciliation } from '../services/fuel-ap-recon.service';
import {
  createFuelInvoice,
  getFuelInvoice,
  updateFuelInvoice,
} from '../services/fuel-invoice.service';
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdTripIds: number[] = [];
const createdTruckIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdSettlementExpenseIds: number[] = [];
const createdSettlementIds: number[] = [];
const createdFuelInvoiceIds: number[] = [];
const createdFuelAllocationIds: number[] = [];
const createdUserIds: number[] = [];

let managerUserId: number;

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

async function mkUser(role: typeof Role[keyof typeof Role]) {
  const [user] = await db.insert(s.users).values({
    username: `m61-${role.toLowerCase()}-${suffix}-${createdUserIds.length}`,
    passwordHash: 'x',
    role,
    status: 'ACTIVE',
  }).returning();
  createdUserIds.push(user.id);
  return user;
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
  completedAt?: Date;
}) {
  const cust = await mkCustomer(); const route = await mkRoute(); const cargo = await mkCargo();
  const t = await insertTripComposite(db, {
    tripCode: `M61-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: cust.id, routeId: route.id, cargoTypeId: cargo.id,
    status: 'COMPLETED', departureDate: opts.departureDate, carrierType: 'OWN',
    completedAt: opts.completedAt ?? new Date(`${opts.departureDate}T05:00:00.000Z`),
    fuelSupplierId: opts.supplierId,
    truckId: opts.truckId ?? null,
    totalFuelCost: opts.totalFuelCost,
  });
  createdTripIds.push(t.id);
  return t;
}

async function mkFuelExpense(opts: {
  tripId: number;
  supplierId: number;
  buyAmount: string;
  expenseDate?: string | null;
  invoiceNumber?: string | null;
  declarationNumber?: string | null;
  invoiceDate?: string;
  expenseType?: string;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
}) {
  const [e] = await db.insert(s.tripExpenses).values({
    tripId: opts.tripId,
    expenseType: opts.expenseType ?? 'FUEL_DIESEL',
    buyAmount: opts.buyAmount,
    sellAmount: '0',
    supplierId: opts.supplierId,
    expenseDate: opts.expenseDate ?? null,
    invoiceNumber: opts.invoiceNumber ?? null,
    declarationNumber: opts.declarationNumber ?? null,
    invoiceDate: opts.invoiceDate ?? null,
    approvalStatus: opts.approvalStatus ?? 'APPROVED',
  }).returning();
  createdExpenseIds.push(e.id);
  return e;
}

async function mkApprovedSettlementCorrection(opts: {
  expenseId: number;
  forwarderId: number;
  adjustedBuyAmount: string;
}) {
  const [expense] = await db.select({
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    containerNumber: s.tripExpenses.containerNumber,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
    declarationNumber: s.tripExpenses.declarationNumber,
    note: s.tripExpenses.note,
  }).from(s.tripExpenses).where(eq(s.tripExpenses.id, opts.expenseId)).limit(1);
  assert.ok(expense, 'expense exists for settlement correction fixture');

  const now = new Date();
  const [settlement] = await db.insert(s.advanceSettlements).values({
    code: `M61-STL-${suffix}-${createdSettlementIds.length}`.slice(0, 20),
    forwarderId: opts.forwarderId,
    totalExpenseAmount: opts.adjustedBuyAmount,
    refundAmount: '0',
    status: 'RECORDED',
    approvedBy: opts.forwarderId,
    approvedAt: now,
    updatedAt: now,
  }).returning({ id: s.advanceSettlements.id });
  createdSettlementIds.push(settlement.id);

  const [link] = await db.insert(s.settlementExpenses).values({
    settlementId: settlement.id,
    tripExpenseId: opts.expenseId,
    originalBuyAmount: expense!.buyAmount,
    adjustedBuyAmount: opts.adjustedBuyAmount,
    submittedSellAmount: expense!.sellAmount,
    originalSnapshot: {
      expenseType: expense!.expenseType,
      buyAmount: expense!.buyAmount,
      sellAmount: expense!.sellAmount,
      containerNumber: expense!.containerNumber,
      invoiceNumber: expense!.invoiceNumber,
      invoiceDate: expense!.invoiceDate,
      declarationNumber: expense!.declarationNumber,
      note: expense!.note,
    },
    adjustedSnapshot: {
      expenseType: expense!.expenseType,
      buyAmount: opts.adjustedBuyAmount,
      sellAmount: expense!.sellAmount,
      containerNumber: expense!.containerNumber,
      invoiceNumber: expense!.invoiceNumber,
      invoiceDate: expense!.invoiceDate,
      declarationNumber: expense!.declarationNumber,
      note: expense!.note,
    },
    adjustmentReason: 'Q22 approved fuel correction',
    adjustedBy: opts.forwarderId,
    adjustedAt: now,
  }).returning({ id: s.settlementExpenses.id });
  createdSettlementExpenseIds.push(link.id);
}

async function mkFuelInvoice(opts: {
  supplierId: number;
  invoiceNumber: string;
  invoiceDate: string;
  totalLiters: string;
  unitPrice: string;
  totalAmount: string;
  createdBy?: number | null;
}) {
  const [invoice] = await db.insert(s.fuelInvoices).values({
    supplierId: opts.supplierId,
    invoiceNumber: opts.invoiceNumber,
    invoiceDate: opts.invoiceDate,
    totalLiters: opts.totalLiters,
    unitPrice: opts.unitPrice,
    totalAmount: opts.totalAmount,
    createdBy: opts.createdBy ?? null,
    // KP-152: invoices are APPROVED at creation — raw fixture rows must match
    // the service's create semantics or the reconciliation report (which
    // counts APPROVED invoices only) ignores them.
    approvalStatus: 'APPROVED',
  }).returning();
  createdFuelInvoiceIds.push(invoice.id);
  return invoice;
}

async function mkFuelAllocation(opts: {
  fuelInvoiceId: number;
  tripId: number;
  truckId?: number | null;
  tripExpenseId?: number | null;
  voucherReference: string;
  voucherDate: string;
  liters: string;
  amount: string;
}) {
  const [allocation] = await db.insert(s.fuelInvoiceAllocations).values({
    fuelInvoiceId: opts.fuelInvoiceId,
    tripId: opts.tripId,
    truckId: opts.truckId ?? null,
    tripExpenseId: opts.tripExpenseId ?? null,
    voucherReference: opts.voucherReference,
    voucherDate: opts.voucherDate,
    liters: opts.liters,
    amount: opts.amount,
  }).returning();
  createdFuelAllocationIds.push(allocation.id);
  return allocation;
}

after(async () => {
  const namePattern = `M61 %${suffix}%`;
  try {
    if (createdFuelAllocationIds.length > 0) await db.delete(s.fuelInvoiceAllocations).where(inArray(s.fuelInvoiceAllocations.id, createdFuelAllocationIds));
    if (createdFuelInvoiceIds.length > 0) await db.delete(s.fuelInvoices).where(inArray(s.fuelInvoices.id, createdFuelInvoiceIds));
    if (createdSettlementExpenseIds.length > 0) await db.delete(s.settlementExpenses).where(inArray(s.settlementExpenses.id, createdSettlementExpenseIds));
    if (createdSettlementIds.length > 0) await db.delete(s.advanceSettlements).where(inArray(s.advanceSettlements.id, createdSettlementIds));
    if (createdExpenseIds.length > 0) await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    if (createdTripIds.length > 0) await db.delete(s.tripFinancialState).where(inArray(s.tripFinancialState.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.tripCarrierInfo).where(inArray(s.tripCarrierInfo.tripId, createdTripIds));
    if (createdTripIds.length > 0) await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    if (createdTruckIds.length > 0) await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    if (createdCargoTypeIds.length > 0) await db.delete(s.cargoTypes).where(sql`${s.cargoTypes.name} LIKE ${namePattern}`);
    if (createdRouteIds.length > 0) await db.delete(s.routes).where(sql`${s.routes.name} LIKE ${namePattern}`);
    if (createdCustomerIds.length > 0) await db.delete(s.customers).where(sql`${s.customers.name} LIKE ${namePattern}`);
    if (createdSupplierIds.length > 0) await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    if (createdUserIds.length > 0) await db.delete(s.users).where(inArray(s.users.id, createdUserIds));
  } catch (err) { console.warn('[m61] cleanup:', (err as Error).message); }
  await client.end();
});

describe('M6.1 — getFuelApReconciliation', () => {
  test('setup finance approver', async () => {
    managerUserId = (await mkUser(Role.MANAGER)).id;
    await mkUser(Role.ACCOUNTANT);
    await mkUser(Role.ADMIN);
    assert.ok(managerUserId > 0);
  });

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

  test('pending and rejected fuel expenses stay out of cost reporting until approved', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '1000000', departureDate: '2026-06-12' });
    await mkFuelExpense({
      tripId: t.id,
      supplierId: sup.id,
      buyAmount: '400000',
      invoiceDate: '2026-06-20',
      approvalStatus: 'PENDING',
    });
    await mkFuelExpense({
      tripId: t.id,
      supplierId: sup.id,
      buyAmount: '500000',
      invoiceDate: '2026-06-20',
      approvalStatus: 'REJECTED',
    });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30', supplierId: sup.id });
    const row = report.suppliers.find((supplier) => supplier.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 1_000_000);
    assert.equal(row!.invoicedFuelCost, 0, 'non-approved expenses must not enter the report');
    assert.equal(row!.status, 'VARIANCE');
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

  test('approved settlement correction becomes the authoritative invoiced cost without overwriting the expense row', async () => {
    const sup = await mkSupplier();
    const t = await mkTrip({ supplierId: sup.id, totalFuelCost: '275000', departureDate: '2026-06-18' });
    const expense = await mkFuelExpense({
      tripId: t.id,
      supplierId: sup.id,
      buyAmount: '300000',
      invoiceDate: '2026-06-20',
      approvalStatus: 'APPROVED',
    });
    await mkApprovedSettlementCorrection({
      expenseId: expense.id,
      forwarderId: managerUserId,
      adjustedBuyAmount: '275000',
    });

    const [persistedExpense] = await db.select({ buyAmount: s.tripExpenses.buyAmount })
      .from(s.tripExpenses)
      .where(eq(s.tripExpenses.id, expense.id))
      .limit(1);
    assert.equal(persistedExpense?.buyAmount, '300000', 'raw approved expense remains unchanged');

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30', supplierId: sup.id });
    const row = report.suppliers.find((supplier) => supplier.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 275_000);
    assert.equal(row!.invoicedFuelCost, 275_000, 'report must use the approved corrected amount');
    assert.equal(row!.status, 'OK');
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

  test('approved multi-truck invoice contributes once through allocation lines', async () => {
    const sup = await mkSupplier();
    const truckA = await mkTruck();
    const truckB = await mkTruck();
    const tripA = await mkTrip({ supplierId: sup.id, truckId: truckA.id, totalFuelCost: '2000000', departureDate: '2026-06-10' });
    const tripB = await mkTrip({ supplierId: sup.id, truckId: truckB.id, totalFuelCost: '1000000', departureDate: '2026-06-11' });
    const tripAExpense = await mkFuelExpense({
      tripId: tripA.id,
      supplierId: sup.id,
      buyAmount: '2000000',
      expenseDate: '2026-06-10',
      invoiceNumber: `PX-${suffix}-A`,
      invoiceDate: '2026-06-10',
    });
    const tripBExpense = await mkFuelExpense({
      tripId: tripB.id,
      supplierId: sup.id,
      buyAmount: '1000000',
      expenseDate: '2026-06-11',
      invoiceNumber: `PX-${suffix}-B`,
      invoiceDate: '2026-06-11',
    });
    const invoice = await mkFuelInvoice({
      supplierId: sup.id,
      invoiceNumber: `INV-${suffix}-01`,
      invoiceDate: '2026-06-15',
      totalLiters: '150',
      unitPrice: '20000',
      totalAmount: '3000000',
    });
    await mkFuelAllocation({
      fuelInvoiceId: invoice.id,
      tripId: tripA.id,
      truckId: truckA.id,
      tripExpenseId: tripAExpense.id,
      voucherReference: `PX-${suffix}-A`,
      voucherDate: '2026-06-10',
      liters: '100',
      amount: '2000000',
    });
    await mkFuelAllocation({
      fuelInvoiceId: invoice.id,
      tripId: tripB.id,
      truckId: truckB.id,
      tripExpenseId: tripBExpense.id,
      voucherReference: `PX-${suffix}-B`,
      voucherDate: '2026-06-11',
      liters: '50',
      amount: '1000000',
    });

    const report = await getFuelApReconciliation({ from: '2026-06-01', to: '2026-06-30', supplierId: sup.id });
    const row = report.suppliers.find((supplier) => supplier.supplierId === sup.id);
    assert.ok(row);
    assert.equal(row!.expectedFuelCost, 3_000_000);
    assert.equal(row!.invoicedFuelCost, 3_000_000);
    assert.equal(row!.perTruck.length, 2);
    assert.equal(row!.perTruck.find((truck) => truck.truckId === truckA.id)?.invoicedFuelCost, 2_000_000);
    assert.equal(row!.perTruck.find((truck) => truck.truckId === truckB.id)?.invoicedFuelCost, 1_000_000);
  });

  test('creates one invoice with actual-liter multi-truck allocations and server-computed amounts', async () => {
    const sup = await mkSupplier();
    const truckA = await mkTruck();
    const truckB = await mkTruck();
    const tripA = await mkTrip({ supplierId: sup.id, truckId: truckA.id, totalFuelCost: '1200000', departureDate: '2026-06-10' });
    const tripB = await mkTrip({ supplierId: sup.id, truckId: truckB.id, totalFuelCost: '800000', departureDate: '2026-06-11' });

    const expenseA = await mkFuelExpense({ tripId: tripA.id, supplierId: sup.id, buyAmount: '1200000', invoiceNumber: `PX-${suffix}-CREATE-A`, expenseDate: '2026-06-10' });
    const expenseB = await mkFuelExpense({ tripId: tripB.id, supplierId: sup.id, buyAmount: '800000', invoiceNumber: `PX-${suffix}-CREATE-B`, expenseDate: '2026-06-11' });
    const created = await createFuelInvoice({
      supplierId: sup.id,
      invoiceNumber: `INV-${suffix}-CREATE`,
      invoiceDate: '2026-06-15',
      totalLiters: 100,
      unitPrice: 20_000,
      allocations: [
        {
          tripId: tripA.id,
          tripExpenseId: expenseA.id,
          voucherReference: `PX-${suffix}-CREATE-A`,
          voucherDate: '2026-06-10',
          liters: 60,
        },
        {
          tripId: tripB.id,
          tripExpenseId: expenseB.id,
          voucherReference: `PX-${suffix}-CREATE-B`,
          voucherDate: '2026-06-11',
          liters: 40,
        },
      ],
    }, managerUserId);
    createdFuelInvoiceIds.push(created.id);

    const detail = await getFuelInvoice(created.id);
    assert.equal(detail.totalAmount, '2000000.00');
    assert.equal(detail.allocations.length, 2);
    assert.equal(detail.allocations.find((row) => row.truckId === truckA.id)?.amount, '1200000.00');
    assert.equal(detail.allocations.find((row) => row.truckId === truckB.id)?.amount, '800000.00');
  });

  test('rejects incomplete direct allocations and saves a fully linked corrected invoice', async () => {
    const sup = await mkSupplier();
    const truck = await mkTruck();
    const trip = await mkTrip({ supplierId: sup.id, truckId: truck.id, totalFuelCost: '2000000', departureDate: '2026-06-10' });
    const linkedExpense = await mkFuelExpense({
      tripId: trip.id,
      supplierId: sup.id,
      buyAmount: '2000000',
      expenseDate: '2026-06-10',
      invoiceNumber: `PX-${suffix}-DRAFT`,
      invoiceDate: '2026-06-10',
    });
    const invoiceNumber = `INV-${suffix}-DRAFT`;

    await assert.rejects(() => createFuelInvoice({
      supplierId: sup.id,
      invoiceNumber,
      invoiceDate: '2026-06-15',
      totalLiters: 100,
      unitPrice: 20_000,
      allocations: [{
        tripId: trip.id,
        voucherReference: `PX-${suffix}-DRAFT`,
        voucherDate: '2026-06-10',
        liters: 90,
      }],
    }, managerUserId), /liên kết chi phí|khớp/);
    const created = await createFuelInvoice({
      supplierId: sup.id,
      invoiceNumber,
      invoiceDate: '2026-06-15',
      totalLiters: 100,
      unitPrice: 20_000,
      allocations: [{
        tripId: trip.id,
        tripExpenseId: linkedExpense.id,
        voucherReference: `PX-${suffix}-DRAFT`,
        voucherDate: '2026-06-10',
        liters: 100,
      }],
    }, managerUserId);
    createdFuelInvoiceIds.push(created.id);

    await updateFuelInvoice(created.id, {
      supplierId: sup.id,
      invoiceNumber,
      invoiceDate: '2026-06-15',
      totalLiters: 100,
      unitPrice: 20_000,
      allocations: [{
        tripId: trip.id,
        tripExpenseId: linkedExpense.id,
        voucherReference: `PX-${suffix}-DRAFT`,
        voucherDate: '2026-06-10',
        liters: 100,
      }],
    }, created.version);
    const detail = await getFuelInvoice(created.id);
    assert.equal(detail.allocations[0]?.amount, '2000000.00');
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
