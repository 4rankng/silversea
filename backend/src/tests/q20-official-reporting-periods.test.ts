import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';

import { client, db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate, cacheInvalidatePattern, disconnectRedis } from '../lib/redis';
import { getDashboardStats } from '../services/dashboard-stats.service';
import { getFuelApReconciliation } from '../services/fuel-ap-recon.service';
import { getPnlReport, getFuelVarianceReport } from '../services/pnl.service';
import { previewDistribution } from '../services/profit-distribution.service';
import { resolveSalaryPeriodDateRange } from '../services/salary-period.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createdTripIds: number[] = [];
const createdTripLegIds: number[] = [];
const createdExpenseIds: number[] = [];
const createdTruckCapIds: number[] = [];
const createdTruckIds: number[] = [];
const createdSupplierIds: number[] = [];
const createdRouteIds: number[] = [];
const createdCargoTypeIds: number[] = [];
const createdCustomerIds: number[] = [];

type TripRow = {
  id: number;
  tripCode: string | null;
  truckId: number | null;
};

let dashboardBefore: Awaited<ReturnType<typeof getDashboardStats>>;
let boundaryStart = '';
let boundaryEnd = '';
let previousPeriodStart = '';
let previousPeriodEnd = '';

function addDays(dateStr: string, delta: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return value.toISOString().slice(0, 10);
}

function atBusinessNoon(dateStr: string): Date {
  return new Date(`${dateStr}T05:00:00.000Z`);
}

async function invalidateReportCaches() {
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
    cacheInvalidatePattern('reports:pnl:*'),
    cacheInvalidatePattern('reports:fuel-variance:*'),
  ]);
}

async function mkSupplier(label: string) {
  const [row] = await db.insert(s.suppliers).values({
    name: `Q20 ${label} supplier ${suffix}-${createdSupplierIds.length}`,
    isFuelSupplier: true,
  }).returning();
  createdSupplierIds.push(row.id);
  return row;
}

async function mkTruck(label: string) {
  const [row] = await db.insert(s.trucks).values({
    licensePlate: `Q20-${label}-${suffix}`.slice(0, 20),
    status: 'ACTIVE',
  }).returning();
  createdTruckIds.push(row.id);
  return row;
}

async function mkCustomer() {
  const [row] = await db.insert(s.customers).values({
    name: `Q20 customer ${suffix}-${createdCustomerIds.length}`,
  }).returning();
  createdCustomerIds.push(row.id);
  return row;
}

async function mkRoute() {
  const [row] = await db.insert(s.routes).values({
    name: `Q20 route ${suffix}-${createdRouteIds.length}`,
  }).returning();
  createdRouteIds.push(row.id);
  return row;
}

async function mkCargoType() {
  const [row] = await db.insert(s.cargoTypes).values({
    name: `Q20 cargo ${suffix}-${createdCargoTypeIds.length}`,
  }).returning();
  createdCargoTypeIds.push(row.id);
  return row;
}

async function mkTrip(input: {
  label: string;
  supplierId: number;
  truckId: number | null;
  departureDate: string;
  completedAt: Date | null;
  status: 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED';
  revenue?: string;
  grossProfit?: string;
  totalCost?: string;
  totalFuelCost?: string;
  totalRoadAllowance?: string;
  driverSalary?: string;
  fuelLiters?: string;
}): Promise<TripRow> {
  const customer = await mkCustomer();
  const route = await mkRoute();
  const cargoType = await mkCargoType();
  const [row] = await db.insert(s.trips).values({
    tripCode: `Q20-${input.label}-${suffix}-${createdTripIds.length}`.slice(0, 50),
    customerId: customer.id,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    truckId: input.truckId,
    status: input.status,
    departureDate: input.departureDate,
    completedAt: input.completedAt,
    carrierType: 'OWN',
    fuelSupplierId: input.supplierId,
    revenue: input.revenue ?? '0',
    grossProfit: input.grossProfit ?? '0',
    totalCost: input.totalCost ?? '0',
    totalFuelCost: input.totalFuelCost ?? '0',
    totalRoadAllowance: input.totalRoadAllowance ?? '0',
    driverSalary: input.driverSalary ?? '0',
    fuelLiters: input.fuelLiters ?? '0',
  }).returning({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    truckId: s.trips.truckId,
  });
  createdTripIds.push(row.id);
  return row;
}

async function mkTripLeg(tripId: number, km: number, calculatedLiters: string) {
  const [row] = await db.insert(s.tripLegs).values({
    tripId,
    sequence: 1,
    origin: 'Q20 start',
    destination: 'Q20 end',
    km,
    loadingType: 'HANG',
    calculatedLiters,
  }).returning({ id: s.tripLegs.id });
  createdTripLegIds.push(row.id);
  return row;
}

async function mkFuelExpense(input: {
  tripId: number;
  supplierId: number;
  buyAmount: string;
  expenseDate: string;
  invoiceDate: string;
}) {
  const [row] = await db.insert(s.tripExpenses).values({
    tripId: input.tripId,
    expenseType: 'FUEL_DIESEL',
    buyAmount: input.buyAmount,
    sellAmount: '0',
    supplierId: input.supplierId,
    expenseDate: input.expenseDate,
    invoiceDate: input.invoiceDate,
    approvalStatus: 'APPROVED',
    payeeName: 'Q20 fuel vendor',
  }).returning({ id: s.tripExpenses.id });
  createdExpenseIds.push(row.id);
  return row;
}

async function mkTruckCap(truckId: number, effectiveDate: string) {
  const [row] = await db.insert(s.truckCapTable).values({
    truckId,
    partnerName: `Q20 owner ${suffix}`,
    percentage: '100.00',
    role: 'INVESTOR',
    effectiveDate,
  }).returning({ id: s.truckCapTable.id });
  createdTruckCapIds.push(row.id);
  return row;
}

before(async () => {
  const july = await resolveSalaryPeriodDateRange(7, 2026);
  const june = await resolveSalaryPeriodDateRange(6, 2026);

  boundaryStart = july.start;
  boundaryEnd = july.end;
  previousPeriodStart = june.start;
  previousPeriodEnd = june.end;

  await invalidateReportCaches();
  dashboardBefore = await getDashboardStats();
});

describe('Q20 official reporting period attribution', () => {
  test('completion date drives P&L, dashboard, fuel variance, and quarterly distribution while in-progress trips stay excluded', async () => {
    const supplier = await mkSupplier('official');
    const truck = await mkTruck('official');
    await mkTruckCap(truck.id, addDays(boundaryStart, -15));

    const crossPeriodTrip = await mkTrip({
      label: 'cross-lock',
      supplierId: supplier.id,
      truckId: truck.id,
      departureDate: addDays(boundaryStart, -1),
      completedAt: atBusinessNoon(boundaryStart),
      status: 'LOCKED',
      revenue: '3100000',
      grossProfit: '1200000',
      totalCost: '1900000',
      totalFuelCost: '600000',
      totalRoadAllowance: '250000',
      driverSalary: '300000',
      fuelLiters: '120',
    });
    await mkTripLeg(crossPeriodTrip.id, 100, '90');

    const inProgressTrip = await mkTrip({
      label: 'in-progress',
      supplierId: supplier.id,
      truckId: truck.id,
      departureDate: addDays(boundaryStart, 2),
      completedAt: null,
      status: 'IN_TRANSIT',
      revenue: '9900000',
      grossProfit: '7700000',
      totalCost: '2200000',
      totalFuelCost: '1800000',
      totalRoadAllowance: '500000',
      driverSalary: '900000',
      fuelLiters: '300',
    });

    await invalidateReportCaches();

    const previousMonthPnl = await getPnlReport(6, 2026);
    const currentMonthPnl = await getPnlReport(7, 2026);
    const dashboardAfter = await getDashboardStats();
    const q2Preview = await previewDistribution(2, 2026);
    const q3Preview = await previewDistribution(3, 2026);
    const previousFuelVariance = await getFuelVarianceReport(6, 2026);
    const currentFuelVariance = await getFuelVarianceReport(7, 2026);

    assert.equal(
      previousMonthPnl.tripDetails.some((trip) => trip.tripCode === crossPeriodTrip.tripCode),
      false,
      `completion date ${boundaryStart} must keep ${crossPeriodTrip.tripCode} out of the previous official month ${previousPeriodStart}..${previousPeriodEnd}`,
    );
    assert.equal(
      currentMonthPnl.tripDetails.some((trip) => trip.tripCode === crossPeriodTrip.tripCode),
      true,
      `completion date ${boundaryStart} must place ${crossPeriodTrip.tripCode} into the current official month`,
    );
    assert.equal(
      currentMonthPnl.tripDetails.some((trip) => trip.id === inProgressTrip.id),
      false,
      'in-progress trips must not appear in official P&L trip detail',
    );

    assert.equal(dashboardAfter.tripCount, dashboardBefore.tripCount + 1, 'dashboard official trip count should increase only for the completed cross-period trip');
    assert.equal(dashboardAfter.lockedTrips, dashboardBefore.lockedTrips + 1, 'dashboard locked-trip count should follow completion-period attribution');
    assert.equal(dashboardAfter.inTransitTrips, dashboardBefore.inTransitTrips + 1, 'in-transit trips remain operationally visible but stay outside official trip totals');

    assert.equal(
      q2Preview.perTruck.some((row) => row.truckId === truck.id),
      false,
      'previous quarter distribution must not pick up a trip that only completed in the current quarter',
    );
    const q3Truck = q3Preview.perTruck.find((row) => row.truckId === truck.id);
    assert.ok(q3Truck, `current quarter distribution must include truck ${truck.id} once the trip completes in-quarter`);
    assert.equal(q3Truck!.profit, 1200000);
    assert.equal(q3Truck!.partners[0]?.amount, 1200000);

    assert.equal(
      previousFuelVariance.trips.some((trip) => trip.tripCode === crossPeriodTrip.tripCode),
      false,
      'previous fuel variance period must not include the cross-period trip',
    );
    assert.equal(
      currentFuelVariance.trips.some((trip) => trip.tripCode === crossPeriodTrip.tripCode),
      true,
      'fuel variance must follow the completed business date for official monthly reporting',
    );
  });

  test('fuel reconciliation keeps trip fuel on the completion period and expense-side fuel on the actual invoice event date', async () => {
    const expectedSupplier = await mkSupplier('expected');
    const expectedTruck = await mkTruck('expected');
    await mkTrip({
      label: 'fuel-expected',
      supplierId: expectedSupplier.id,
      truckId: expectedTruck.id,
      departureDate: addDays(boundaryStart, -1),
      completedAt: atBusinessNoon(boundaryStart),
      status: 'COMPLETED',
      totalFuelCost: '700000',
      totalRoadAllowance: '150000',
      driverSalary: '200000',
      revenue: '2000000',
      grossProfit: '950000',
      totalCost: '1050000',
      fuelLiters: '110',
    });

    const eventSupplier = await mkSupplier('event');
    const eventTrip = await mkTrip({
      label: 'fuel-event',
      supplierId: eventSupplier.id,
      truckId: null,
      departureDate: addDays(boundaryStart, -1),
      completedAt: atBusinessNoon(addDays(boundaryStart, -1)),
      status: 'COMPLETED',
      totalFuelCost: '0',
      revenue: '1000000',
      grossProfit: '250000',
      totalCost: '750000',
      fuelLiters: '0',
    });
    await mkFuelExpense({
      tripId: eventTrip.id,
      supplierId: eventSupplier.id,
      buyAmount: '450000',
      expenseDate: addDays(boundaryStart, 1),
      invoiceDate: addDays(boundaryStart, 1),
    });

    const previousRecon = await getFuelApReconciliation({
      from: previousPeriodStart,
      to: previousPeriodEnd,
    });
    const currentRecon = await getFuelApReconciliation({
      from: boundaryStart,
      to: boundaryEnd,
    });

    assert.equal(
      previousRecon.suppliers.some((row) => row.supplierId === expectedSupplier.id),
      false,
      'previous fuel period must not include expected trip fuel from a trip that completed in the current month',
    );

    const currentExpected = currentRecon.suppliers.find((row) => row.supplierId === expectedSupplier.id);
    assert.ok(currentExpected, 'current fuel period must include expected fuel cost for the completed cross-period trip');
    assert.equal(currentExpected!.expectedFuelCost, 700000);
    assert.equal(currentExpected!.perTruck.some((row) => row.truckId === expectedTruck.id && row.tripCount === 1), true);

    assert.equal(
      previousRecon.suppliers.some((row) => row.supplierId === eventSupplier.id),
      false,
      'previous fuel period must not inherit a fuel expense from the trip departure date',
    );
    const currentEvent = currentRecon.suppliers.find((row) => row.supplierId === eventSupplier.id);
    assert.ok(currentEvent, 'current fuel period must include invoice-side fuel by its actual event date');
    assert.equal(currentEvent!.invoicedFuelCost, 450000);
  });
});

after(async () => {
  try {
    if (createdExpenseIds.length > 0) {
      await db.delete(s.tripExpenses).where(inArray(s.tripExpenses.id, createdExpenseIds));
    }
    if (createdTripLegIds.length > 0) {
      await db.delete(s.tripLegs).where(inArray(s.tripLegs.id, createdTripLegIds));
    }
    if (createdTruckCapIds.length > 0) {
      await db.delete(s.truckCapTable).where(inArray(s.truckCapTable.id, createdTruckCapIds));
    }
    if (createdTripIds.length > 0) {
      await db.delete(s.trips).where(inArray(s.trips.id, createdTripIds));
    }
    if (createdTruckIds.length > 0) {
      await db.delete(s.trucks).where(inArray(s.trucks.id, createdTruckIds));
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(s.suppliers).where(inArray(s.suppliers.id, createdSupplierIds));
    }
    if (createdCargoTypeIds.length > 0) {
      await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, createdCargoTypeIds));
    }
    if (createdRouteIds.length > 0) {
      await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    }
  } finally {
    await disconnectRedis();
    await client.end();
  }
});
