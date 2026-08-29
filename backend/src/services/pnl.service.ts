/**
 * P&L Report Service
 *
 * P&L report generation with per-truck breakdown, maintenance expenses,
 * external carrier trip margins.
 */

import { createHash } from 'node:crypto';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql, gte, inArray, ne, getTableColumns, desc } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { cacheGet } from '../lib/redis';
import { calendarMonthDateRange, tripCompletionBusinessDateSql } from './reporting-shared';
import {
  resolveFinancialReportingPolicyForMonth,
  type FinancialReportMonthRef,
  type FinancialReportingPolicyForMonth,
} from './financial-reporting-policy.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type QueryClient = typeof db | Tx;

type AllocationReasonCode =
  | 'UNCONFIGURED_POLICY'
  | 'UNCONFIGURED_PROFILE'
  | 'NOT_IN_SERVICE'
  | 'FULLY_DEPRECIATED'
  | 'ZERO_ELIGIBLE_REVENUE'
  | 'MISSING_TRUCK_ATTRIBUTION';

export type ActiveTruckFinancialProfile = {
  profileVersionId: number;
  truckId: number;
  truckLabel: string;
  effectiveFrom: string;
  acquisitionCost: bigint;
  residualValue: bigint;
  inServiceDate: string;
  usefulLifeMonths: number;
  monthlyFixedCost: bigint;
  source: 'APPROVED_GOVERNANCE';
};

function monthStartOf(dateOnly: string): string {
  return `${dateOnly.slice(0, 7)}-01`;
}

function monthOrdinal(dateOnly: string): number {
  const year = Number(dateOnly.slice(0, 4));
  const month = Number(dateOnly.slice(5, 7));
  return (year * 12) + month;
}

function monthsBetween(startMonth: string, endMonth: string): number {
  return monthOrdinal(endMonth) - monthOrdinal(startMonth);
}

function nextMonthStart(dateOnly: string): string {
  const year = Number(dateOnly.slice(0, 4));
  const month = Number(dateOnly.slice(5, 7));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

function parseWholeMoney(value: string | number | bigint | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (value == null) return 0n;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Unsafe whole-money number input: ${value}`);
    }
    return BigInt(value);
  }
  const normalized = value.trim();
  if (/^-?\d+$/.test(normalized)) return BigInt(normalized);
  if (/^-?\d+\.0+$/.test(normalized)) return BigInt(normalized.slice(0, normalized.indexOf('.')));
  throw new Error(`Non-integer whole-money input: ${value}`);
}

function parseVatRatePermille(value: string | number | null | undefined): bigint {
  if (value == null) return 0n;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid VAT rate input: ${value}`);
    return BigInt(Math.round(value * 1000));
  }
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid VAT rate input: ${value}`);
  }
  const [wholePart, fractionPart = ''] = normalized.split('.');
  const paddedFraction = `${fractionPart}000`.slice(0, 3);
  const discardedFraction = fractionPart.slice(3);
  if (/[1-9]/.test(discardedFraction)) {
    throw new Error(`Unsupported VAT precision beyond 3 decimals: ${value}`);
  }
  return (BigInt(wholePart) * 1000n) + BigInt(paddedFraction);
}

function divideAndRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error(`Invalid divisor: ${denominator.toString()}`);
  return (numerator + (denominator / 2n)) / denominator;
}

function toSafeNumber(value: bigint): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`Money value exceeds safe integer range: ${value.toString()}`);
  }
  return numeric;
}

function buildCalendarMonthPeriod(month: number, year: number): FinancialReportMonthRef {
  return { month, year };
}

function canAllocateWithPolicy(policy: FinancialReportingPolicyForMonth): boolean {
  return policy.status === 'CONFIGURED'
    && policy.depreciationMethod === 'STRAIGHT_LINE'
    && policy.allocationBasis === 'COMPLETED_TRIP_REVENUE_SHARE';
}

function selectActiveProfileForMonth(
  profileHistory: ActiveTruckFinancialProfile[],
  reportMonthStart: string,
): ActiveTruckFinancialProfile | null {
  let active: ActiveTruckFinancialProfile | null = null;
  for (const profile of profileHistory) {
    if (profile.effectiveFrom > reportMonthStart) break;
    active = profile;
  }
  return active;
}

export function computeMonthlyDepreciationForReportMonth(
  profileHistory: ActiveTruckFinancialProfile[],
  reportMonthStart: string,
): { amount: number; reason: AllocationReasonCode | null; serviceMonthStart: string } {
  const activeProfile = selectActiveProfileForMonth(profileHistory, reportMonthStart);
  if (!activeProfile || profileHistory.length === 0) {
    return { amount: 0, reason: 'UNCONFIGURED_PROFILE', serviceMonthStart: reportMonthStart };
  }

  const firstProfile = profileHistory[0]!;
  const earliestInServiceMonth = profileHistory
    .map((profile) => monthStartOf(profile.inServiceDate))
    .sort()[0] ?? monthStartOf(activeProfile.inServiceDate);
  const serviceMonthStart = [firstProfile.effectiveFrom, earliestInServiceMonth]
    .sort()
    .at(-1)!;
  if (reportMonthStart < serviceMonthStart) {
    return { amount: 0, reason: 'NOT_IN_SERVICE', serviceMonthStart };
  }

  let accumulatedDepreciation = 0n;
  let monthCursor = serviceMonthStart;
  let currentMonthAmount = 0n;

  while (monthCursor <= reportMonthStart) {
    const monthProfile = selectActiveProfileForMonth(profileHistory, monthCursor);
    if (!monthProfile) break;
    const depreciableBase = monthProfile.acquisitionCost - monthProfile.residualValue;
    if (depreciableBase > 0n && monthProfile.usefulLifeMonths > 0) {
      const elapsedMonths = monthsBetween(serviceMonthStart, monthCursor);
      const usefulLifeMonths = BigInt(monthProfile.usefulLifeMonths);
      const cumulativeBefore = depreciableBase
        * BigInt(Math.min(Math.max(elapsedMonths, 0), monthProfile.usefulLifeMonths))
        / usefulLifeMonths;
      const cumulativeCurrent = depreciableBase
        * BigInt(Math.min(elapsedMonths + 1, monthProfile.usefulLifeMonths))
        / usefulLifeMonths;
      const protectedBefore = accumulatedDepreciation > cumulativeBefore
        ? accumulatedDepreciation
        : cumulativeBefore;
      const remainingBase = depreciableBase > accumulatedDepreciation
        ? depreciableBase - accumulatedDepreciation
        : 0n;
      const monthAmount = cumulativeCurrent > protectedBefore
        ? cumulativeCurrent - protectedBefore
        : 0n;
      currentMonthAmount = monthAmount > remainingBase ? remainingBase : monthAmount;
      accumulatedDepreciation += currentMonthAmount;
    } else {
      currentMonthAmount = 0n;
    }
    if (monthCursor === reportMonthStart) break;
    monthCursor = nextMonthStart(monthCursor);
  }

  const activeDepreciableBase = activeProfile.acquisitionCost - activeProfile.residualValue;
  if (activeDepreciableBase <= 0n) {
    return { amount: 0, reason: 'FULLY_DEPRECIATED', serviceMonthStart };
  }
  if (currentMonthAmount <= 0n) {
    return { amount: 0, reason: 'FULLY_DEPRECIATED', serviceMonthStart };
  }
  return {
    amount: toSafeNumber(currentMonthAmount),
    reason: null,
    serviceMonthStart,
  };
}

export function allocateIntegerAmountByRevenue(
  totalAmount: bigint,
  rows: Array<{ tripId: number; revenue: number }>,
): Map<number, bigint> {
  const allocations = new Map<number, bigint>();
  if (totalAmount <= 0n || rows.length === 0) return allocations;
  const eligibleRows = rows.filter((row) => row.revenue > 0);
  if (eligibleRows.length === 0) return allocations;
  const denominator = eligibleRows.reduce((sum, row) => sum + BigInt(row.revenue), 0n);
  if (denominator <= 0n) return allocations;

  const ranked = eligibleRows.map((row) => {
    const numerator = totalAmount * BigInt(row.revenue);
    const floorAmount = numerator / denominator;
    return {
      tripId: row.tripId,
      floorAmount,
      remainder: numerator % denominator,
    };
  });

  const floorSum = ranked.reduce((sum, row) => sum + row.floorAmount, 0n);
  const remaining = totalAmount - floorSum;
  ranked
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder > a.remainder ? 1 : -1;
      return a.tripId - b.tripId;
    })
    .forEach((row, index) => {
      const bonus = BigInt(index) < remaining ? 1n : 0n;
      allocations.set(row.tripId, row.floorAmount + bonus);
    });

  return allocations;
}

function recordedTripRevenueWhole(trip: {
  revenue: string | null;
  vatRate: string | null;
  customerCommission: string | null;
}): bigint {
  const grossRevenue = parseWholeMoney(trip.revenue);
  const vatRatePermille = parseVatRatePermille(trip.vatRate);
  const commission = parseWholeMoney(trip.customerCommission);
  const freightExVat = vatRatePermille > 0n
    ? divideAndRound(grossRevenue * 1000n, 1000n + vatRatePermille)
    : grossRevenue;
  return freightExVat - commission;
}

export function recordedTripRevenue(trip: {
  revenue: string | null;
  vatRate: string | null;
  customerCommission: string | null;
}): number {
  return toSafeNumber(recordedTripRevenueWhole(trip));
}

/**
 * P&L report for a given period, with per-truck breakdown.
 */
export async function getPnlReport(month: number, year: number, q: QueryClient = db) {
  const compute = async () => {
    const period = buildCalendarMonthPeriod(month, year);
    const { start: tripStart, end: tripEnd } = calendarMonthDateRange(year, month);
    const reportMonthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const financialPolicy = await resolveFinancialReportingPolicyForMonth(period, q);
    const allocationEnabled = canAllocateWithPolicy(financialPolicy);
    const completionBusinessDate = tripCompletionBusinessDateSql();
    const dateFilter = and(
      sql`${s.trips.completedAt} is not null`,
      gte(completionBusinessDate, tripStart),
      sql`${completionBusinessDate} < ${tripEnd}`,
    );

    // P&L includes only completed trips whose revenue has posted to the ledger.
    // COMPLETED is the single terminal/posting state (O2C reconciliation,
    // 01/08/2026). Draft, in-transit, and canceled trips are not yet reportable.
    // Costs stay editable after completion; grossProfit here reads the stored
    // value — it is "finalized" as a snapshot at completion, not immutable.
    const monthTrips = await q.select({
      ...getTableColumns(s.trips),
      financialPostingId: s.tripFinancialPostings.id,
      financialPostingVersion: s.tripFinancialPostings.version,
    }).from(s.trips)
      .innerJoin(s.tripFinancialPostings, and(
        eq(s.tripFinancialPostings.tripId, s.trips.id),
        eq(s.tripFinancialPostings.status, 'ACTIVE'),
      )).where(
      and(
        eq(s.trips.status, TripStatus.COMPLETED),
        isNull(s.trips.deletedAt),
        dateFilter,
      ),
    );

    // Separate OWN vs EXTERNAL carrier trips
    const ownTrips = monthTrips.filter(t => (t.carrierType ?? 'OWN') === 'OWN');
    const extTrips = monthTrips.filter(t => t.carrierType === 'EXTERNAL');

    // OWN trips contribute freight revenue and direct costs. External trips
    // contribute their net management margin as a revenue line (their hire
    // cost is already netted inside that margin).
    const trips = ownTrips;

    const ownRevenue = trips.reduce((sum, trip) => sum + recordedTripRevenue(trip), 0);
    const externalMarginTotal = extTrips.reduce((sum, trip) => (
      sum + recordedTripRevenue(trip) - Number(trip.externalFreightCost ?? 0)
    ), 0);
    const totalRevenue = ownRevenue + externalMarginTotal;
    const totalVariableTripCosts = trips.reduce((sum, t) => sum + Number(t.totalCost || 0), 0);

    const managementFee = 0;

    const penaltyDateFilter = and(gte(s.penalties.date, tripStart), sql`${s.penalties.date} < ${tripEnd}`);
    const penaltyRows = await q.select({ total: sql<string>`coalesce(sum(${s.penalties.amount}::numeric), 0)` })
      .from(s.penalties)
      .where(and(isNull(s.penalties.deletedAt), ne(s.penalties.status, 'CANCELED'), penaltyDateFilter));
    const otherIncome = parseFloat(penaltyRows[0]?.total || '0');

    const expenseDateFilter = and(gte(s.expenses.expenseDate, tripStart), sql`${s.expenses.expenseDate} < ${tripEnd}`);

    const truckRows = await q.select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
    }).from(s.trucks).where(isNull(s.trucks.deletedAt));
    const plateById = new Map(truckRows.map(t => [t.id, t.licensePlate]));

    const routeIds = [...new Set(monthTrips.map(t => t.routeId).filter((id): id is number => id != null))];
    const routeRows = routeIds.length > 0
      ? await q.select({ id: s.routes.id, name: s.routes.name }).from(s.routes).where(inArray(s.routes.id, routeIds))
      : [];
    const routeNameById = new Map(routeRows.map(route => [route.id, route.name]));

    // Keep the expandable rows in the same cached response as the aggregates.
    // Fetching trips separately can produce a newer snapshot than this report
    // and makes the visible detail fail to reconcile with its summary row.
    const tripDetails = monthTrips.map(trip => {
      const isExternal = trip.carrierType === 'EXTERNAL';
      const customerCommission = Number(trip.customerCommission ?? 0);
      const revenue = recordedTripRevenue(trip);
      const fuelOrHireCost = isExternal ? Number(trip.externalFreightCost ?? 0) : Number(trip.totalFuelCost ?? 0);
      const roadAllowance = isExternal ? 0 : Number(trip.totalRoadAllowance ?? 0);
      const tollAndCompanyTickets = isExternal ? 0 : Number(trip.tollCost ?? 0) + Number(trip.tollsDiscount ?? 0);
      const driverAndAllowances = isExternal
        ? 0
        : Number(trip.driverSalary ?? 0) + Number(trip.twoPointDeliveryBonus ?? 0) + Number(trip.vehicleShiftAllowance ?? 0);
      const reconstructedCost = fuelOrHireCost + roadAllowance + tollAndCompanyTickets + driverAndAllowances;
      const variableCost = isExternal ? Number(trip.externalFreightCost ?? 0) : Number(trip.totalCost ?? 0);
      const costDifference = variableCost - reconstructedCost;

      return {
        id: trip.id,
        financialPostingVersionId: trip.financialPostingId,
        financialPostingVersion: trip.financialPostingVersion,
        tripCode: trip.tripCode || 'Lệnh chưa có mã',
        departureDate: trip.departureDate,
        routeName: trip.routeId ? routeNameById.get(trip.routeId) ?? 'Chưa có tuyến' : 'Chưa có tuyến',
        revenue,
        customerCommission,
        fuelOrHireCost,
        roadAllowance,
        tollAndCompanyTickets,
        driverAndAllowances,
        totalCost: variableCost,
        allocatedFleetFixedCost: 0,
        totalCostWithFleetFixedCost: variableCost,
        profit: revenue - variableCost,
        netProfitAfterFleetFixedCost: revenue - variableCost,
        costDifference,
        costMatches: Math.abs(costDifference) <= 1,
        isExternal,
        vehicleBucketId: isExternal ? 0 : (trip.truckId ?? -1),
      };
    });
    const tripDetailById = new Map(tripDetails.map((detail) => [detail.id, detail]));

    // Truck-associated operating expenses (repairs, insurance, registration, parts, etc.).
    // These are separate from trip-level costs (fuel, road allowance, driver salary) and
    // do not overlap — expense categories cover vehicle overhead not captured per-trip.
    // Component-level breakdown: truck head vs trailer maintenance expenses.
    // Single query grouped by (truckId, vehicleComponent) serves both the
    // per-truck total and the truck/trailer split.
    const maintenanceExpensesByTruck = new Map<number, number>();
    const maintenanceByComponent = new Map<number, { truck: number; trailer: number }>();
    const maintenanceItemsByTruck = new Map<number, Array<{
      id: number;
      expenseDate: string;
      categoryName: string;
      supplierName: string;
      vehicleComponent: 'TRUCK' | 'TRAILER' | null;
      amount: number;
      note: string | null;
    }>>();
    const componentRows = await q.select({
      id: s.expenses.id,
      truckId: s.expenses.truckId,
      expenseDate: s.expenses.expenseDate,
      categoryName: s.expenseCategories.name,
      supplierName: s.suppliers.name,
      vehicleComponent: s.expenses.vehicleComponent,
      amount: s.expenses.amount,
      note: s.expenses.note,
    }).from(s.expenses)
      .leftJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
      .leftJoin(s.suppliers, eq(s.expenses.supplierId, s.suppliers.id))
      .where(and(
        isNull(s.expenses.deletedAt),
        sql`${s.expenses.truckId} is not null`,
        expenseDateFilter,
      ));

    for (const row of componentRows) {
      if (!row.truckId) continue;
      const amount = parseFloat(row.amount);
      const comp = maintenanceByComponent.get(row.truckId) ?? { truck: 0, trailer: 0 };
      if (row.vehicleComponent === 'TRAILER') {
        comp.trailer += amount;
      } else {
        comp.truck += amount;
      }
      maintenanceByComponent.set(row.truckId, comp);
      maintenanceExpensesByTruck.set(row.truckId, (maintenanceExpensesByTruck.get(row.truckId) ?? 0) + amount);
      const items = maintenanceItemsByTruck.get(row.truckId) ?? [];
      items.push({
        id: row.id,
        expenseDate: row.expenseDate,
        categoryName: row.categoryName ?? 'Chưa phân loại',
        supplierName: row.supplierName ?? 'Chưa có nhà cung cấp',
        vehicleComponent: row.vehicleComponent,
        amount,
        note: row.note,
      });
      maintenanceItemsByTruck.set(row.truckId, items);
    }

    const [companyExpenseRow] = await q.select({
      total: sql<string>`coalesce(sum(${s.expenses.amount}::numeric), 0)`,
    }).from(s.expenses).where(
      and(isNull(s.expenses.deletedAt), isNull(s.expenses.truckId), expenseDateFilter)
    );
    const companyExpenses = parseFloat(companyExpenseRow?.total || '0');

    const categoryBreakdownRows = await q.select({
      categoryName: s.expenseCategories.name,
      total: sql<string>`coalesce(sum(${s.expenses.amount}::numeric), 0)`,
    }).from(s.expenses)
      .innerJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
      .where(and(isNull(s.expenses.deletedAt), expenseDateFilter))
      .groupBy(s.expenseCategories.name);
    const categoryBreakdown = categoryBreakdownRows.map(r => ({
      categoryName: r.categoryName,
      total: r.total,
    }));

    const totalMaintenanceExpenses = Array.from(maintenanceExpensesByTruck.values())
      .reduce((sum, amount) => sum + amount, 0);
    const byTruck = new Map<number, {
      id: number;
      plate: string;
      revenue: number;
      costs: number;
      profit: number;
      trips: number;
      maintenanceExpenses: number;
      serviceMargin: number;
      externalMargin?: number;
      variableTripCosts: number;
      allocatedFleetFixedCost: number;
      unallocatedFleetFixedCost: number;
      monthlyDepreciation: number;
      monthlyFixedCost: number;
      eligibleRevenue: number;
      allocationReasonCodes: AllocationReasonCode[];
      profileVersionId: number | null;
      profileEffectiveFrom: string | null;
      profileSource: 'APPROVED_GOVERNANCE' | 'UNCONFIGURED';
    }>();
    const eligibleTripsByTruck = new Map<number, Array<{ tripId: number; revenue: number }>>();
    for (const trip of trips) {
      if (!trip.truckId) continue; // EXTERNAL trips have no truck
      const existing = byTruck.get(trip.truckId) || {
        id: trip.truckId,
        plate: plateById.get(trip.truckId) || '',
        revenue: 0,
        costs: 0,
        profit: 0,
        trips: 0,
        maintenanceExpenses: 0,
        serviceMargin: 0,
        variableTripCosts: 0,
        allocatedFleetFixedCost: 0,
        unallocatedFleetFixedCost: 0,
        monthlyDepreciation: 0,
        monthlyFixedCost: 0,
        eligibleRevenue: 0,
        allocationReasonCodes: [],
        profileVersionId: null,
        profileEffectiveFrom: null,
        profileSource: 'UNCONFIGURED' as const,
      };
      // Recorded revenue is freight ex-VAT after customer commission.
      const tripRevenueWhole = recordedTripRevenueWhole(trip);
      const tripRevenue = toSafeNumber(tripRevenueWhole);
      const tripCosts = Number(trip.totalCost || 0);
      existing.revenue += tripRevenue;
      existing.costs += tripCosts;
      existing.profit += tripRevenue - tripCosts;
      existing.variableTripCosts += tripCosts;
      existing.trips++;
      if (tripRevenue > 0) {
        const eligible = eligibleTripsByTruck.get(trip.truckId) ?? [];
        eligible.push({ tripId: trip.id, revenue: tripRevenue });
        eligibleTripsByTruck.set(trip.truckId, eligible);
        existing.eligibleRevenue += tripRevenue;
      }
      byTruck.set(trip.truckId, existing);
    }
    const profileRows = await q.select({
      profileVersionId: s.truckFinancialProfileVersions.id,
      truckId: s.truckFinancialProfileVersions.truckId,
      truckLabel: s.trucks.licensePlate,
      effectiveFrom: s.truckFinancialProfileVersions.effectiveFrom,
      acquisitionCost: s.truckFinancialProfileVersions.acquisitionCost,
      residualValue: s.truckFinancialProfileVersions.residualValue,
      inServiceDate: s.truckFinancialProfileVersions.inServiceDate,
      usefulLifeMonths: s.truckFinancialProfileVersions.usefulLifeMonths,
      monthlyFixedCost: s.truckFinancialProfileVersions.monthlyFixedCost,
    }).from(s.truckFinancialProfileVersions)
      .innerJoin(s.trucks, eq(s.trucks.id, s.truckFinancialProfileVersions.truckId))
      .where(and(
        isNull(s.trucks.deletedAt),
        sql`${s.truckFinancialProfileVersions.effectiveFrom} <= ${reportMonthStart}`,
      ))
      .orderBy(
        s.truckFinancialProfileVersions.truckId,
        s.truckFinancialProfileVersions.effectiveFrom,
        s.truckFinancialProfileVersions.createdAt,
      );

    const profileHistoryByTruck = new Map<number, ActiveTruckFinancialProfile[]>();
    const activeProfilesByTruck = new Map<number, ActiveTruckFinancialProfile>();
    for (const row of profileRows) {
      const normalizedProfile: ActiveTruckFinancialProfile = {
        profileVersionId: row.profileVersionId,
        truckId: row.truckId,
        truckLabel: row.truckLabel,
        effectiveFrom: row.effectiveFrom,
        acquisitionCost: parseWholeMoney(row.acquisitionCost),
        residualValue: parseWholeMoney(row.residualValue),
        inServiceDate: row.inServiceDate,
        usefulLifeMonths: row.usefulLifeMonths,
        monthlyFixedCost: parseWholeMoney(row.monthlyFixedCost),
        source: 'APPROVED_GOVERNANCE',
      };
      const history = profileHistoryByTruck.get(row.truckId) ?? [];
      history.push(normalizedProfile);
      profileHistoryByTruck.set(row.truckId, history);
      activeProfilesByTruck.set(row.truckId, normalizedProfile);
    }

    const relevantTruckIds = new Set<number>([
      ...byTruck.keys(),
      ...maintenanceExpensesByTruck.keys(),
      ...activeProfilesByTruck.keys(),
    ]);

    let fleetDepreciationTotal = 0;
    let fleetMonthlyFixedCostTotal = 0;
    let allocatedFleetFixedCostTotal = 0;
    let unallocatedFleetFixedCostTotal = 0;

    for (const truckId of relevantTruckIds) {
      const entry = byTruck.get(truckId) ?? {
        id: truckId,
        plate: plateById.get(truckId) || `Xe #${truckId}`,
        revenue: 0,
        costs: 0,
        profit: 0,
        trips: 0,
        maintenanceExpenses: 0,
        serviceMargin: 0,
        variableTripCosts: 0,
        allocatedFleetFixedCost: 0,
        unallocatedFleetFixedCost: 0,
        monthlyDepreciation: 0,
        monthlyFixedCost: 0,
        eligibleRevenue: 0,
        allocationReasonCodes: [],
        profileVersionId: null,
        profileEffectiveFrom: null,
        profileSource: 'UNCONFIGURED' as const,
      };

      const maintenanceExpense = maintenanceExpensesByTruck.get(truckId) ?? 0;
      entry.maintenanceExpenses = maintenanceExpense;
      entry.costs += maintenanceExpense;
      entry.profit -= maintenanceExpense;

      const profile = activeProfilesByTruck.get(truckId) ?? null;
      if (!profile) {
        if (entry.trips > 0 || maintenanceExpense > 0) {
          entry.allocationReasonCodes = Array.from(
            new Set<AllocationReasonCode>([...entry.allocationReasonCodes, 'UNCONFIGURED_PROFILE']),
          );
        }
        byTruck.set(truckId, entry);
        continue;
      }

      entry.profileVersionId = profile.profileVersionId;
      entry.profileEffectiveFrom = profile.effectiveFrom;
      entry.profileSource = profile.source;
      const profileHistory = profileHistoryByTruck.get(truckId) ?? [profile];
      const depreciation = computeMonthlyDepreciationForReportMonth(profileHistory, reportMonthStart);
      const serviceMonthStart = depreciation.serviceMonthStart;
      const monthlyFixedCost = reportMonthStart >= serviceMonthStart ? toSafeNumber(profile.monthlyFixedCost) : 0;
      const monthlyFleetCost = BigInt(depreciation.amount) + (reportMonthStart >= serviceMonthStart ? profile.monthlyFixedCost : 0n);

      entry.monthlyDepreciation = depreciation.amount;
      entry.monthlyFixedCost = monthlyFixedCost;
      fleetDepreciationTotal += depreciation.amount;
      fleetMonthlyFixedCostTotal += monthlyFixedCost;

      const nextReasons = new Set<AllocationReasonCode>(entry.allocationReasonCodes);
      if (depreciation.reason) nextReasons.add(depreciation.reason);

      if (monthlyFleetCost <= 0n) {
        entry.allocationReasonCodes = [...nextReasons];
        byTruck.set(truckId, entry);
        continue;
      }

      if (!allocationEnabled) {
        nextReasons.add('UNCONFIGURED_POLICY');
        const monthlyFleetCostNumber = toSafeNumber(monthlyFleetCost);
        entry.unallocatedFleetFixedCost = monthlyFleetCostNumber;
        entry.costs += monthlyFleetCostNumber;
        entry.profit -= monthlyFleetCostNumber;
        unallocatedFleetFixedCostTotal += monthlyFleetCostNumber;
        entry.allocationReasonCodes = [...nextReasons];
        byTruck.set(truckId, entry);
        continue;
      }

      const eligibleTrips = eligibleTripsByTruck.get(truckId) ?? [];
      const allocations = allocateIntegerAmountByRevenue(monthlyFleetCost, eligibleTrips);
      const allocatedAmount = Array.from(allocations.values()).reduce((sum, value) => sum + value, 0n);
      const unallocatedAmount = monthlyFleetCost - allocatedAmount;

      if (allocatedAmount <= 0n) {
        nextReasons.add('ZERO_ELIGIBLE_REVENUE');
      }

      const allocatedAmountNumber = toSafeNumber(allocatedAmount);
      const unallocatedAmountNumber = toSafeNumber(unallocatedAmount);
      const monthlyFleetCostNumber = toSafeNumber(monthlyFleetCost);
      entry.allocatedFleetFixedCost = allocatedAmountNumber;
      entry.unallocatedFleetFixedCost = unallocatedAmountNumber;
      entry.costs += monthlyFleetCostNumber;
      entry.profit -= monthlyFleetCostNumber;
      allocatedFleetFixedCostTotal += allocatedAmountNumber;
      unallocatedFleetFixedCostTotal += unallocatedAmountNumber;

      allocations.forEach((amount, tripId) => {
        const detail = tripDetailById.get(tripId);
        if (!detail) return;
        const amountNumber = toSafeNumber(amount);
        detail.allocatedFleetFixedCost += amountNumber;
        detail.totalCostWithFleetFixedCost += amountNumber;
        detail.netProfitAfterFleetFixedCost -= amountNumber;
      });

      if (unallocatedAmount > 0n) {
        nextReasons.add('ZERO_ELIGIBLE_REVENUE');
      }

      entry.allocationReasonCodes = [...nextReasons];
      byTruck.set(truckId, entry);
    }

    const adjustedTotalCosts = totalVariableTripCosts
      + totalMaintenanceExpenses
      + fleetDepreciationTotal
      + fleetMonthlyFixedCostTotal;
    const adjustedGrossProfit = totalRevenue - adjustedTotalCosts;
    const netProfit = adjustedGrossProfit - companyExpenses + otherIncome;

    const maintenanceExpensesByTruckResult: Record<number, string> = {};
    for (const [truckId, mtnExp] of maintenanceExpensesByTruck) {
      maintenanceExpensesByTruckResult[truckId] = String(mtnExp);
    }

    // Build truck breakdown array — own trucks first
    const truckBreakdown: Array<{
      id: number;
      plate: string;
      revenue: number;
      costs: number;
      profit: number;
      trips: number;
      maintenanceExpenses: number;
      serviceMargin?: number;
      externalMargin?: number;
      variableTripCosts: number;
      allocatedFleetFixedCost: number;
      unallocatedFleetFixedCost: number;
      monthlyDepreciation: number;
      monthlyFixedCost: number;
      eligibleRevenue: number;
      allocationReasonCodes: AllocationReasonCode[];
      profileVersionId: number | null;
      profileEffectiveFrom: string | null;
      profileSource: 'APPROVED_GOVERNANCE' | 'UNCONFIGURED';
    }> = Array.from(byTruck.values());

    // Add an "Chưa gắn xe" (unassigned) bucket for OWN trips that have no
    // truckId. Such trips still contribute revenue/cost to the period totals
    // above (totalRevenue/totalCosts iterate all `trips`), but the per-truck
    // loop skips them (line 120 `if (!trip.truckId) continue`). Without this
    // bucket the truck breakdown would silently under-count and fail to
    // reconcile with adjustedGrossProfit. id: -1 keeps it distinct from the
    // real-truck ids and the EXTERNAL id: 0 sentinel used downstream.
    const unassignedTrips = trips.filter(t => t.truckId == null);
    if (unassignedTrips.length > 0) {
      const unRev = unassignedTrips.reduce((sum, trip) => sum + recordedTripRevenue(trip), 0);
      const unCosts = unassignedTrips.reduce((sum, t) => sum + parseFloat(t.totalCost || '0'), 0);
      truckBreakdown.push({
        id: -1,
        plate: 'Chưa gắn xe',
        trips: unassignedTrips.length,
        revenue: unRev,
        costs: unCosts,
        profit: unRev - unCosts,
        maintenanceExpenses: 0,
        variableTripCosts: unCosts,
        allocatedFleetFixedCost: 0,
        unallocatedFleetFixedCost: 0,
        monthlyDepreciation: 0,
        monthlyFixedCost: 0,
        eligibleRevenue: 0,
        allocationReasonCodes: ['MISSING_TRUCK_ATTRIBUTION'],
        profileVersionId: null,
        profileEffectiveFrom: null,
        profileSource: 'UNCONFIGURED',
      });
    }

    // Add "Xe ngoài" bucket for external carrier trips
    if (extTrips.length > 0) {
      const extMgmtMargin = externalMarginTotal;

      const extRevenue = extTrips.reduce((sum, trip) => sum + recordedTripRevenue(trip), 0);
      const extCosts = extTrips.reduce((s, t) => s + Number(t.externalFreightCost ?? 0), 0);

      truckBreakdown.push({
        id: 0,
        plate: 'Xe ngoài',
        trips: extTrips.length,
        revenue: extRevenue,
        costs: extCosts,
        profit: extMgmtMargin,
        serviceMargin: 0,
        externalMargin: extMgmtMargin,
        maintenanceExpenses: 0,
        variableTripCosts: extCosts,
        allocatedFleetFixedCost: 0,
        unallocatedFleetFixedCost: 0,
        monthlyDepreciation: 0,
        monthlyFixedCost: 0,
        eligibleRevenue: 0,
        allocationReasonCodes: [],
        profileVersionId: null,
        profileEffectiveFrom: null,
        profileSource: 'UNCONFIGURED',
      });
    }

    const serviceMarginTotal = truckBreakdown.reduce((s, t) => s + (t.serviceMargin ?? 0), 0);
    const breakdownExternalMarginTotal = truckBreakdown.reduce((s, t) => s + (t.externalMargin ?? 0), 0);

    const payload = {
      period: { month, year },
      totalRevenue,
      totalCosts: adjustedTotalCosts,
      grossProfit: adjustedGrossProfit,
      managementFee,
      otherIncome,
      companyExpenses,
      netProfit,
      tripCount: monthTrips.length,
      maintenanceExpensesTotal: totalMaintenanceExpenses,
      maintenanceExpensesByTruck: maintenanceExpensesByTruckResult,
      maintenanceByComponent: Object.fromEntries(maintenanceByComponent),
      maintenanceItemsByTruck: Object.fromEntries(maintenanceItemsByTruck),
      tripDetails,
      categoryBreakdown,
      trucks: truckBreakdown,
      serviceMarginTotal,
      externalMarginTotal: breakdownExternalMarginTotal,
      externalTripsCount: extTrips.length,
      financialPolicy,
      fleetDepreciationTotal,
      fleetMonthlyFixedCostTotal,
      allocatedFleetFixedCostTotal,
      unallocatedFleetFixedCostTotal,
    };
    const definitionVersion = 'pnl-v3';
    return {
      ...payload,
      asOf: new Date().toISOString(),
      timezone: 'Asia/Ho_Chi_Minh',
      definitionVersion,
      consistency: 'BEST_EFFORT' as const,
      checksum: createHash('sha256')
        .update(JSON.stringify({ definitionVersion, payload }))
        .digest('hex'),
    };
  };

  if (q !== db) return compute();
  return cacheGet(`reports:pnl:${month}:${year}`, 120, compute);
}

/**
 * Fuel variance report for a given period.
 * Compares actual fuel dispensed (fuelLiters) against norm (sum of leg calculatedLiters).
 */
export async function getFuelVarianceReport(month: number, year: number) {
  return cacheGet(`reports:fuel-variance:${month}:${year}`, 120, async () => {
    const { start: tripStart, end: tripEnd } = calendarMonthDateRange(year, month);
    const completionBusinessDate = tripCompletionBusinessDateSql();

    // Query locked trips with fuel data for the period
    const trips = await db.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      departureDate: s.trips.departureDate,
      fuelLiters: s.trips.fuelLiters,
      fuelMode: s.trips.fuelMode,
      fuelLitersOverride: s.trips.fuelLitersOverride,
      fuelFixedAllowanceApplied: s.trips.fuelFixedAllowanceApplied,
      fuelSupplementNormApplied: s.trips.fuelSupplementNormApplied,
      totalFuelCost: s.trips.totalFuelCost,
      truckId: s.trips.truckId,
      routeId: s.trips.routeId,
    }).from(s.trips).where(
      and(
        // O2C: COMPLETED is the single posting state; grossProfit finalizes here.
        eq(s.trips.status, TripStatus.COMPLETED),
        isNull(s.trips.deletedAt),
        sql`${s.trips.completedAt} is not null`,
        gte(completionBusinessDate, tripStart),
        sql`${completionBusinessDate} < ${tripEnd}`,
      ),
    );

    if (trips.length === 0) {
      return { period: { month, year }, trips: [], totals: { trips: 0, totalActual: 0, totalNorm: 0, totalVariance: 0 } };
    }

    // Get trip IDs for leg lookup
    const tripIds = trips.map(t => t.id);

    // Aggregate norm liters per trip from legs
    const legSums = await db.select({
      tripId: s.tripLegs.tripId,
      normLiters: sql<string>`coalesce(sum(${s.tripLegs.calculatedLiters}::numeric), 0)`,
      totalKm: sql<string>`coalesce(sum(${s.tripLegs.km}), 0)`,
    }).from(s.tripLegs)
      .where(inArray(s.tripLegs.tripId, tripIds))
      .groupBy(s.tripLegs.tripId);

    const normByTrip = new Map(legSums.map(r => [r.tripId, { normLiters: parseFloat(r.normLiters), totalKm: Number(r.totalKm) }]));

    // Get truck plates
    const truckIds = [...new Set(trips.map(t => t.truckId).filter((id): id is number => id != null))];
    const truckRows = truckIds.length > 0
      ? await db.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate }).from(s.trucks)
          .where(sql`${s.trucks.id} IN (${sql.join(truckIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const plateById = new Map(truckRows.map(t => [t.id, t.licensePlate]));
    const confirmedEvidenceRows = tripIds.length > 0
      ? await db.select({
        id: s.fuelEvidenceReviews.id,
        tripId: s.fuelEvidenceReviews.tripId,
        storageKey: s.fuelEvidenceReviews.storageKey,
        capturedAt: s.fuelEvidenceReviews.capturedAt,
        litres: s.fuelEvidenceReviews.litres,
        unitPrice: s.fuelEvidenceReviews.unitPrice,
        totalAmount: s.fuelEvidenceReviews.totalAmount,
        reviewedAt: s.fuelEvidenceReviews.reviewedAt,
      }).from(s.fuelEvidenceReviews)
        .where(and(
          inArray(s.fuelEvidenceReviews.tripId, tripIds),
          eq(s.fuelEvidenceReviews.reviewStatus, 'CONFIRMED'),
        ))
        .orderBy(desc(s.fuelEvidenceReviews.reviewedAt), desc(s.fuelEvidenceReviews.createdAt), desc(s.fuelEvidenceReviews.id))
      : [];
    const latestConfirmedEvidenceByTrip = new Map<number, typeof confirmedEvidenceRows[number]>();
    for (const row of confirmedEvidenceRows) {
      if (!latestConfirmedEvidenceByTrip.has(row.tripId)) {
        latestConfirmedEvidenceByTrip.set(row.tripId, row);
      }
    }

    // Build per-trip variance data
    let totalActual = 0;
    let totalNorm = 0;
    let totalVariance = 0;

    const tripData = trips.map(t => {
      const actual = parseFloat(t.fuelLiters || '0');
      const normInfo = normByTrip.get(t.id);
      const legsNorm = normInfo?.normLiters ?? 0;
      const totalKm = normInfo?.totalKm ?? 0;

      const norm = (() => {
        if (t.fuelMode === 'FLAT_RATE') {
          return parseFloat(t.fuelLitersOverride || '0');
        }
        const fixedAllowance = parseFloat(t.fuelFixedAllowanceApplied || '0');
        if (fixedAllowance > 0) {
          return fixedAllowance;
        }
        const tripSupplement = parseFloat(t.fuelSupplementNormApplied || '0');
        return legsNorm + tripSupplement;
      })();

      const variance = actual - norm;

      totalActual += actual;
      totalNorm += norm;
      totalVariance += variance;
      const confirmedEvidence = latestConfirmedEvidenceByTrip.get(t.id);

      return {
        tripId: t.id,
        tripCode: t.tripCode,
        departureDate: t.departureDate,
        truckPlate: t.truckId ? plateById.get(t.truckId) || null : null,
        fuelMode: t.fuelMode,
        totalKm,
        actualLiters: Math.round(actual),
        normLiters: Math.round(norm),
        varianceLiters: Math.round(variance),
        variancePercent: norm > 0 ? Math.round((variance / norm) * 100) / 100 : 0,
        confirmedFuelEvidence: confirmedEvidence
          ? {
            reviewId: confirmedEvidence.id,
            photoUrl: `/api/photos/${encodeURIComponent(confirmedEvidence.storageKey)}`,
            capturedAt: confirmedEvidence.capturedAt.toISOString(),
            reviewedAt: confirmedEvidence.reviewedAt?.toISOString() ?? null,
            litres: confirmedEvidence.litres,
            unitPrice: confirmedEvidence.unitPrice,
            totalAmount: confirmedEvidence.totalAmount,
          }
          : null,
      };
    });

    return {
      period: { month, year },
      trips: tripData,
      totals: {
        trips: trips.length,
        totalActual: Math.round(totalActual),
        totalNorm: Math.round(totalNorm),
        totalVariance: Math.round(totalVariance),
      },
    };
  });
}
