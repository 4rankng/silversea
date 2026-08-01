/**
 * P&L Report Service
 *
 * P&L report generation with per-truck breakdown, maintenance expenses,
 * external carrier trip margins.
 */

import { createHash } from 'node:crypto';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, sql, gte, inArray, ne, getTableColumns } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { cacheGet } from '../lib/redis';
import { salaryPeriodDateRange, tripCompletionBusinessDateSql } from './reporting-shared';

export function recordedTripRevenue(trip: {
  revenue: string | null;
  vatRate: string | null;
  customerCommission: string | null;
}): number {
  const grossRevenue = Number(trip.revenue ?? 0);
  const vatRate = Number(trip.vatRate ?? 0);
  const freightExVat = vatRate > 0 ? Math.round(grossRevenue / (1 + vatRate)) : grossRevenue;
  return freightExVat - Number(trip.customerCommission ?? 0);
}

/**
 * P&L report for a given period, with per-truck breakdown.
 */
export async function getPnlReport(month: number, year: number) {
  return cacheGet(`reports:pnl:${month}:${year}`, 120, async () => {
    const { start: tripStart, end: tripEnd } = await salaryPeriodDateRange(month, year);
    const completionBusinessDate = tripCompletionBusinessDateSql();
    const dateFilter = month
      ? and(
        sql`${s.trips.completedAt} is not null`,
        gte(completionBusinessDate, tripStart),
        sql`${completionBusinessDate} < ${tripEnd}`,
      )
      : and(
        sql`${s.trips.completedAt} is not null`,
        gte(completionBusinessDate, tripStart),
      );

    // P&L includes only trips whose revenue has posted to the ledger. Draft,
    // in-transit, and canceled trips are not yet reportable.
    const monthTrips = await db.select({
      ...getTableColumns(s.trips),
      financialPostingId: s.tripFinancialPostings.id,
      financialPostingVersion: s.tripFinancialPostings.version,
    }).from(s.trips)
      .leftJoin(s.tripFinancialPostings, and(
        eq(s.tripFinancialPostings.tripId, s.trips.id),
        eq(s.tripFinancialPostings.status, 'ACTIVE'),
      )).where(
      and(
        inArray(s.trips.status, [TripStatus.COMPLETED, TripStatus.LOCKED]),
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
    const totalCosts = trips.reduce((sum, t) => sum + parseFloat(t.totalCost || '0'), 0);
    const grossProfit = totalRevenue - totalCosts;

    const managementFee = 0;

    const penaltyDateFilter = month
      ? and(gte(s.penalties.date, tripStart), sql`${s.penalties.date} < ${tripEnd}`)
      : gte(s.penalties.date, tripStart);
    const penaltyRows = await db.select({ total: sql<string>`coalesce(sum(${s.penalties.amount}::numeric), 0)` })
      .from(s.penalties)
      .where(and(isNull(s.penalties.deletedAt), ne(s.penalties.status, 'CANCELED'), penaltyDateFilter));
    const otherIncome = parseFloat(penaltyRows[0]?.total || '0');

    const expenseDateFilter = month
      ? and(gte(s.expenses.expenseDate, tripStart), sql`${s.expenses.expenseDate} < ${tripEnd}`)
      : gte(s.expenses.expenseDate, tripStart);

    const truckIds = [...new Set(trips.map(t => t.truckId).filter((id): id is number => id != null))];
    const truckRows = truckIds.length > 0
      ? await db.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate }).from(s.trucks)
          .where(sql`${s.trucks.id} IN (${sql.join(truckIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const plateById = new Map(truckRows.map(t => [t.id, t.licensePlate]));

    const routeIds = [...new Set(monthTrips.map(t => t.routeId).filter((id): id is number => id != null))];
    const routeRows = routeIds.length > 0
      ? await db.select({ id: s.routes.id, name: s.routes.name }).from(s.routes).where(inArray(s.routes.id, routeIds))
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
      const totalCost = isExternal ? Number(trip.externalFreightCost ?? 0) : Number(trip.totalCost ?? 0);
      const costDifference = totalCost - reconstructedCost;

      return {
        id: trip.id,
        financialPostingVersionId: trip.financialPostingId,
        financialPostingVersion: trip.financialPostingVersion,
        tripCode: trip.tripCode || `Lệnh #${trip.id}`,
        departureDate: trip.departureDate,
        routeName: trip.routeId ? routeNameById.get(trip.routeId) ?? 'Chưa có tuyến' : 'Chưa có tuyến',
        revenue,
        customerCommission,
        fuelOrHireCost,
        roadAllowance,
        tollAndCompanyTickets,
        driverAndAllowances,
        totalCost,
        profit: revenue - totalCost,
        costDifference,
        costMatches: Math.abs(costDifference) <= 1,
        isExternal,
        vehicleBucketId: isExternal ? 0 : (trip.truckId ?? -1),
      };
    });

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
    if (truckIds.length > 0) {
      const componentRows = await db.select({
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
        .where(and(isNull(s.expenses.deletedAt), inArray(s.expenses.truckId, truckIds), expenseDateFilter));

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
    }

    const [companyExpenseRow] = await db.select({
      total: sql<string>`coalesce(sum(${s.expenses.amount}::numeric), 0)`,
    }).from(s.expenses).where(
      and(isNull(s.expenses.deletedAt), isNull(s.expenses.truckId), expenseDateFilter)
    );
    const companyExpenses = parseFloat(companyExpenseRow?.total || '0');

    const categoryBreakdownRows = await db.select({
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

    let totalMaintenanceExpenses = 0;
    const byTruck = new Map<number, { id: number; plate: string; revenue: number; costs: number; profit: number; trips: number; maintenanceExpenses: number; serviceMargin: number }>();
    for (const trip of trips) {
      if (!trip.truckId) continue; // EXTERNAL trips have no truck
      const existing = byTruck.get(trip.truckId) || { id: trip.truckId, plate: plateById.get(trip.truckId) || '', revenue: 0, costs: 0, profit: 0, trips: 0, maintenanceExpenses: 0, serviceMargin: 0 };
      // Recorded revenue is freight ex-VAT after customer commission.
      const tripRevenue = recordedTripRevenue(trip);
      const tripCosts = parseFloat(trip.totalCost || '0');
      existing.revenue += tripRevenue;
      existing.costs += tripCosts;
      existing.profit += tripRevenue - tripCosts;
      existing.trips++;
      byTruck.set(trip.truckId, existing);
    }
    for (const [truckId, mtnExp] of maintenanceExpensesByTruck) {
      const entry = byTruck.get(truckId);
      if (entry) {
        entry.maintenanceExpenses = mtnExp;
        entry.costs += mtnExp;
        entry.profit -= mtnExp;
      }
      totalMaintenanceExpenses += mtnExp;
    }

    const adjustedGrossProfit = grossProfit - totalMaintenanceExpenses;
    const adjustedTotalCosts = totalCosts + totalMaintenanceExpenses;
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
    };
    const definitionVersion = 'pnl-v2';
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
  });
}

/**
 * Fuel variance report for a given period.
 * Compares actual fuel dispensed (fuelLiters) against norm (sum of leg calculatedLiters).
 */
export async function getFuelVarianceReport(month: number, year: number) {
  return cacheGet(`reports:fuel-variance:${month}:${year}`, 120, async () => {
    const { start: tripStart, end: tripEnd } = await salaryPeriodDateRange(month, year);
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
        eq(s.trips.status, TripStatus.LOCKED),
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
