// Trip Queries — Read-only data retrieval functions
// getTrips, getTripById, getTripsSummary and their helpers

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, or, isNull, sql, desc, lte, gte, inArray, type SQL } from 'drizzle-orm';
import { TripStatus, normalizeContainerNumber } from '@tingting/shared';
import { ApiError } from '../errors';
import { getTripInstructions } from './trip-instructions.service';
import { resolveRoute } from './gps/route-capture';
import { fetchRouteMap } from './gps/route-lookup';
import { resolveLegCoords } from './maps.service';
import { loadTripPairingSummaries } from './trip-pairs.service';
import { getShipmentAccountingLockSummary } from './shipment-accounting-lock.service';
import { operationalName } from '../db/master-data-name';
import { escapeLikeTerm } from '../lib/format';

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

// ─── Query helpers ─────────────────────────────────────────────────────────

/** Common field set joined with relation names for trip list/detail. */
const TRIP_RELATION_FIELDS = {
  customerName: CUSTOMER_OPERATIONAL_NAME,
  driverName: s.drivers.name,
  truckPlate: s.trucks.licensePlate,
  routeName: ROUTE_OPERATIONAL_NAME,
  routeDistance: s.routes.distanceKm,
  routeIsMountain: s.routes.isMountain,
  routeFixedFuelAllowance: s.routes.fixedFuelAllowance,
  trailerLicensePlate: s.trailers.licensePlate,
  trailerId: s.trips.trailerId,
  trailerType: s.trips.trailerType,
  fuelSupplierName: s.suppliers.name,
};

/** Minimal structural type for the leftJoin method so we can chain joins generically. */
type WithLeftJoin = { leftJoin: (table: typeof s.customers | typeof s.drivers | typeof s.trucks | typeof s.routes | typeof s.trailers | typeof s.suppliers, on: SQL) => WithLeftJoin };

/**
 * Apply the 6 standard relation LEFT JOINs to a trip select query.
 * Generic over T to preserve the builder's row type for downstream .where/.orderBy chains.
 */
const TRIP_RELATION_JOINS = <T extends WithLeftJoin>(query: T): T => (query as WithLeftJoin)
  .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
  .leftJoin(s.drivers, eq(s.trips.driverId, s.drivers.id))
  .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
  .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
  .leftJoin(s.trailers, eq(s.trips.trailerId, s.trailers.id))
  .leftJoin(s.suppliers, eq(s.trips.fuelSupplierId, s.suppliers.id)) as unknown as T;

/** Shape flat joined rows into nested relation objects. */
function shapeTripRelations(item: Record<string, unknown>, extras?: {
  legs?: unknown[];
  photoUrls?: string[];
  pairing?: unknown;
}) {
  return {
    ...item,
    customer: item.customerName ? { id: item.customerId, name: item.customerName } : null,
    driver: item.driverName ? { id: item.driverId, name: item.driverName } : null,
    truck: item.truckPlate ? { id: item.truckId, licensePlate: item.truckPlate } : null,
    route: item.routeName ? { id: item.routeId, name: item.routeName, distanceKm: item.routeDistance, isMountain: item.routeIsMountain, fixedFuelAllowance: item.routeFixedFuelAllowance } : null,
    trailerType: item.trailerType || '40FT',
    trailer: item.trailerId ? {
      id: item.trailerId,
      licensePlate: item.trailerLicensePlate ?? null,
      type: item.trailerType || '40FT',
    } : undefined,
    fuelSupplier: item.fuelSupplierName ? { id: item.fuelSupplierId, name: item.fuelSupplierName } : null,
    ...extras,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export interface TripListFilters {
  page?: number;
  limit?: number;
  status?: string;
  truckId?: number;
  driverId?: number;
  customerId?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sortBy?: TripListSortKey;
  sortDir?: 'asc' | 'desc';
}

/** Sort keys accepted by GET /api/trips (mirrors the trip-list column ids). */
export const TRIP_LIST_SORT_KEYS = [
  'tripCode', 'truck', 'route', 'container', 'consumption', 'road',
  'revenue', 'driverSalary', 'totalCost', 'grossProfit', 'status',
] as const;
export type TripListSortKey = (typeof TRIP_LIST_SORT_KEYS)[number];

// Whitelist mapping each sortable column key to its sort expression. The truck
// and route expressions reuse the joins the list query already applies; the
// container key resolves the page's first container via a scalar subquery so no
// row-multiplying join is introduced. The gross-profit expression mirrors the
// frontend's getTripDisplayGrossProfit (external trips recompute ex-VAT).
// NULLs sort last in both directions via the `nulls last` wrapper at the call
// site; trips.id stays the stable tiebreaker.
const TRIP_LIST_SORT_SQL: Record<TripListSortKey, SQL> = {
  tripCode: sql`${s.trips.tripCode}`,
  truck: sql`coalesce(${s.trucks.licensePlate}, ${s.trips.externalPlateNumber})`,
  route: sql`${ROUTE_OPERATIONAL_NAME}`,
  container: sql`(
    select tc.container_number from ${s.tripContainers} tc
    where tc.trip_id = ${s.trips.id}
    order by tc.id
    limit 1
  )`,
  consumption: sql`${s.trips.fuelLiters}`,
  road: sql`coalesce(${s.trips.totalRoadAllowance}, 0) + coalesce(${s.trips.tollCost}, 0)`,
  revenue: sql`${s.trips.revenue}`,
  driverSalary: sql`${s.trips.driverSalary}`,
  totalCost: sql`${s.trips.totalCost}`,
  grossProfit: sql`case
    when ${s.trips.carrierType} = 'EXTERNAL'
      and coalesce(${s.trips.revenue}, 0) <> 0
      and coalesce(${s.trips.externalFreightCost}, 0) <> 0
    then round(${s.trips.revenue} / (1 + coalesce(${s.trips.vatRate}, 0.08)))
       - round(${s.trips.externalFreightCost} / (1 + coalesce(${s.trips.vatRate}, 0.08)))
    else ${s.trips.grossProfit}
  end`,
  status: sql`${s.trips.status}`,
};

function normalizedContainerSql(column: unknown): SQL {
  return sql`upper(regexp_replace(${column}, '[[:space:]-]', '', 'g'))`;
}

function containerNumberSearchConditions(rawTerm: string, normalizedTerm: string): SQL[] {
  const conditions: SQL[] = [sql`${s.tripContainers.containerNumber} ILIKE ${rawTerm}`];
  if (normalizedTerm !== '%%') {
    conditions.push(sql`${normalizedContainerSql(s.tripContainers.containerNumber)} ILIKE ${normalizedTerm}`);
  }
  return conditions;
}

function expenseContainerSearchConditions(rawTerm: string, normalizedTerm: string): SQL[] {
  const conditions: SQL[] = [sql`${s.tripExpenses.containerNumber} ILIKE ${rawTerm}`];
  if (normalizedTerm !== '%%') {
    conditions.push(sql`${normalizedContainerSql(s.tripExpenses.containerNumber)} ILIKE ${normalizedTerm}`);
  }
  return conditions;
}

function tripContainerExists(rawTerm: string, normalizedTerm: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${s.tripContainers}
    WHERE ${s.tripContainers.tripId} = ${s.trips.id}
      AND (${sql.join(containerNumberSearchConditions(rawTerm, normalizedTerm), sql` OR `)})
  )`;
}

function tripExpenseContainerExists(rawTerm: string, normalizedTerm: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${s.tripExpenses}
    WHERE ${s.tripExpenses.tripId} = ${s.trips.id}
      AND (${sql.join(expenseContainerSearchConditions(rawTerm, normalizedTerm), sql` OR `)})
  )`;
}

export async function getTrips(filters: TripListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, filters.limit ?? 50);

  // Count predicates skip the expensive EXISTS subqueries (container_number
  // on trip_containers / trip_expenses) so the total-row-count query stays
  // cheap on the full table. The list query still uses the full OR — and
  // it's bounded by LIMIT 50 so the per-row EXISTS probes are fine.
  const countConditions: SQL<unknown>[] = [isNull(s.trips.deletedAt)];
  const conditions = [...countConditions];
  if (filters.status) {
    const c = eq(s.trips.status, filters.status as TripStatus);
    conditions.push(c); countConditions.push(c);
  }
  if (filters.truckId) {
    if (filters.truckId === -1) {
      const c = eq(s.trips.carrierType, 'EXTERNAL');
      conditions.push(c); countConditions.push(c);
    } else {
      const c = eq(s.trips.truckId, filters.truckId);
      conditions.push(c); countConditions.push(c);
    }
  }
  if (filters.driverId) {
    const c = eq(s.trips.driverId, filters.driverId);
    conditions.push(c); countConditions.push(c);
  }
  if (filters.customerId) {
    const c = eq(s.trips.customerId, filters.customerId);
    conditions.push(c); countConditions.push(c);
  }
  // Search intent is "find this specific trip regardless of when" — the date
  // range from the topbar month chip is suppressed so e.g. searching for
  // TRP-202605-0003 from the June chip still resolves to the May trip.
  // Frontend already omits the range when searching; this is a defense layer
  // for any client that doesn't.
  const applyDateRange = !filters.search;
  if (applyDateRange && filters.dateFrom) {
    const c = gte(s.trips.departureDate, filters.dateFrom);
    conditions.push(c); countConditions.push(c);
  }
  if (applyDateRange && filters.dateTo) {
    const c = lte(s.trips.departureDate, filters.dateTo);
    conditions.push(c); countConditions.push(c);
  }
  if (filters.search) {
    const term = `%${escapeLikeTerm(filters.search)}%`;
    const normalizedContainerTerm = `%${escapeLikeTerm(normalizeContainerNumber(filters.search))}%`;
    // List: full predicates (5 ILIKE + 2 EXISTS for container cross-refs)
    conditions.push(
      or(
        sql`unaccent(${s.trips.tripCode}) ILIKE unaccent(${term})`,
        sql`${s.trips.id}::text ILIKE ${term}`,
        sql`unaccent(${CUSTOMER_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.customers.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trucks.licensePlate}) ILIKE unaccent(${term})`,
        sql`unaccent(${ROUTE_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.routes.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trips.customerReference}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trips.externalPlateNumber}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trips.externalDriverName}) ILIKE unaccent(${term})`,
        sql`(${s.trips.carrierType} = 'EXTERNAL' AND 'xe ngoai' ILIKE unaccent(${term}))`,
        tripContainerExists(term, normalizedContainerTerm),
        tripExpenseContainerExists(term, normalizedContainerTerm),
      )!
    );
    // Count mirrors the list predicates so container-only searches report a
    // usable total and pagination state instead of showing rows with total=0.
    countConditions.push(
      or(
        sql`unaccent(${s.trips.tripCode}) ILIKE unaccent(${term})`,
        sql`${s.trips.id}::text ILIKE ${term}`,
        sql`unaccent(${CUSTOMER_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.customers.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trucks.licensePlate}) ILIKE unaccent(${term})`,
        sql`unaccent(${ROUTE_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.routes.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trips.customerReference}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trips.externalPlateNumber}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trips.externalDriverName}) ILIKE unaccent(${term})`,
        sql`(${s.trips.carrierType} = 'EXTERNAL' AND 'xe ngoai' ILIKE unaccent(${term}))`,
        tripContainerExists(term, normalizedContainerTerm),
        tripExpenseContainerExists(term, normalizedContainerTerm),
      )!
    );
  }

  // Explicit sort (server-side): `nulls last` keeps empty cells at the bottom in
  // both directions, with trips.id desc as the stable tiebreaker. Absent sort
  // params keep the historical default (departureDate desc, id desc) unchanged.
  const sortOrder: SQL[] = filters.sortBy
    ? [
        sql`${TRIP_LIST_SORT_SQL[filters.sortBy]} ${filters.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        desc(s.trips.id),
      ]
    : [desc(s.trips.departureDate), desc(s.trips.id)];

  const items = await TRIP_RELATION_JOINS(db.select({
    id: s.trips.id, tripCode: s.trips.tripCode, version: s.trips.version,
    customerId: s.trips.customerId, customerReference: s.trips.customerReference,
    shipmentId: s.trips.shipmentId,
    truckId: s.trips.truckId, driverId: s.trips.driverId, routeId: s.trips.routeId,
    cargoTypeId: s.trips.cargoTypeId, containerCount: s.trips.containerCount,
    status: s.trips.status, departureDate: s.trips.departureDate,
    plannedStartAt: s.trips.plannedStartAt,
    plannedEndAt: s.trips.plannedEndAt,
    canonicalOrigin: s.trips.canonicalOrigin,
    canonicalDestination: s.trips.canonicalDestination,
    cargoWeightKg: s.trips.cargoWeightKg,
    vehicleCapacityKg: s.trips.vehicleCapacityKg,
    activeTripPairId: s.trips.activeTripPairId,
    activeTripPairOrder: s.trips.activeTripPairOrder,
    fuelMode: s.trips.fuelMode, fuelLiters: s.trips.fuelLiters,
    fuelLitersOverride: s.trips.fuelLitersOverride,
    fuelSupplementLiters: s.trips.fuelSupplementLiters,
    fuelSupplementReason: s.trips.fuelSupplementReason,
    fuelActualUnitPrice: s.trips.fuelActualUnitPrice,
    fuelSupplierId: s.trips.fuelSupplierId,
    totalFuelCost: s.trips.totalFuelCost, totalRoadAllowance: s.trips.totalRoadAllowance,
    totalCost: s.trips.totalCost, revenue: s.trips.revenue, revenueEmptyReturn: s.trips.revenueEmptyReturn,
    revenueCombine: s.trips.revenueCombine, grossProfit: s.trips.grossProfit,
    hasReturnCargo: s.trips.hasReturnCargo, driverSalary: s.trips.driverSalary,
    roadAllowanceOverride: s.trips.roadAllowanceOverride,
    customerCommission: s.trips.customerCommission,
    tripWageDays: s.trips.tripWageDays,
    notes: s.trips.notes,
    twoPointDeliveryBonus: s.trips.twoPointDeliveryBonus,
    vehicleShiftAllowance: s.trips.vehicleShiftAllowance,
    tollCost: s.trips.tollCost,
    tollsDiscount: s.trips.tollsDiscount, tollsAddition: s.trips.tollsAddition, tollsStations: s.trips.tollsStations,
    carrierType: s.trips.carrierType,
    // O2C: DB column renamed to external_entity_id (soft pointer), but the API
    // response keeps the externalCarrierId contract name for frontend compat.
    externalCarrierId: s.trips.externalEntityId,
    externalFreightCost: s.trips.externalFreightCost,
    externalPlateNumber: s.trips.externalPlateNumber, externalDriverName: s.trips.externalDriverName,
    createdAt: s.trips.createdAt, updatedAt: s.trips.updatedAt,
    ...TRIP_RELATION_FIELDS,
  }).from(s.trips))
    .where(and(...conditions))
    .orderBy(...sortOrder)
    .limit(limit).offset((page - 1) * limit);

  // Count uses the simpler ILIKE-only conditions (no relation joins needed
  // since none of the simple ILIKE columns are in joined tables). Falls back
  // to the full conditions if the search term is empty.
  // The simplified count predicates reference joined-table columns
  // (customers.name, trucks.license_plate, routes.name), so the count query
  // needs the same JOINs as the list query — otherwise the SQL fails with
  // "missing FROM-clause entry" the moment a search term is present.
  const [countRow] = filters.search
    ? await TRIP_RELATION_JOINS(db.select({ count: sql<number>`count(*)` }).from(s.trips))
        .where(and(...countConditions))
    : await db.select({ count: sql<number>`count(*)` })
        .from(s.trips)
        .where(and(...conditions));

  // Batch-load container instances for this page so the list can show
  // "Loại container" + "Số container" columns (Pete's request 2026-06).
  // One extra query keyed by the page's trip ids — keeps the main JOIN small.
  const tripIds = items.map((it) => it.id);
  const containersByTrip = new Map<number, Array<{ containerNumber: string | null; containerTypeId: number | null; containerTypeCode: string | null; containerTypeName: string | null }>>();
  if (tripIds.length > 0) {
    const containerRows = await db.select({
      tripId: s.tripContainers.tripId,
      containerNumber: s.tripContainers.containerNumber,
      containerTypeId: s.tripContainers.containerTypeId,
      containerTypeCode: s.containerTypes.code,
      containerTypeName: s.containerTypes.name,
    }).from(s.tripContainers)
      .leftJoin(s.containerTypes, eq(s.tripContainers.containerTypeId, s.containerTypes.id))
      .where(inArray(s.tripContainers.tripId, tripIds))
      .orderBy(s.tripContainers.id);
    for (const row of containerRows) {
      const list = containersByTrip.get(row.tripId) || [];
      list.push({
        containerNumber: row.containerNumber,
        containerTypeId: row.containerTypeId,
        containerTypeCode: row.containerTypeCode,
        containerTypeName: row.containerTypeName,
      });
      containersByTrip.set(row.tripId, list);
    }
  }

  // Batch-load legs for the trips on this page to calculate correct distance and fuel average in list views
  const legsByTrip = new Map<number, Array<typeof s.tripLegs.$inferSelect>>();
  if (tripIds.length > 0) {
    const legRows = await db.select().from(s.tripLegs)
      .where(inArray(s.tripLegs.tripId, tripIds))
      .orderBy(s.tripLegs.sequence);
    for (const row of legRows) {
      const list = legsByTrip.get(row.tripId) || [];
      list.push(row);
      legsByTrip.set(row.tripId, list);
    }
  }

  const pairingByTrip = await loadTripPairingSummaries(items.map((item) => ({
    id: item.id,
    activeTripPairId: item.activeTripPairId,
    activeTripPairOrder: item.activeTripPairOrder,
  })));

  return {
    items: items.map((item) => ({
      ...shapeTripRelations(item, {
        legs: legsByTrip.get(item.id) ?? [],
        pairing: pairingByTrip.get(item.id) ?? null,
      }),
      containers: containersByTrip.get(item.id) ?? [],
    })),
    total: Number(countRow?.count ?? 0),
    page,
    pageSize: limit,
  };
}

export interface TripSummary {
  statusCounts: Record<string, number>;
  totalKm: number;
  totalFuel: number;
  totalRoad: number;
  totalRevenue: number;
  missingFuel: number;
  avgPer100: number;
  truckOptions: Array<{ id: number; licensePlate: string }>;
  customerOptions: Array<{ id: number; name: string }>;
}

export async function getTripsSummary(dateFrom?: string, dateTo?: string): Promise<TripSummary> {
  const conditions = [isNull(s.trips.deletedAt)];
  if (dateFrom) conditions.push(gte(s.trips.departureDate, dateFrom));
  if (dateTo) conditions.push(lte(s.trips.departureDate, dateTo));

  const where = and(...conditions);

  // Aggregate metrics in one query
  const [agg] = await db.select({
    total: sql<number>`count(*)`,
    created: sql<number>`count(*) filter (where ${s.trips.status} = 'CREATED')`,
    inTransit: sql<number>`count(*) filter (where ${s.trips.status} = 'IN_TRANSIT')`,
    completed: sql<number>`count(*) filter (where ${s.trips.status} = 'COMPLETED')`,
    canceled: sql<number>`count(*) filter (where ${s.trips.status} = 'CANCELED')`,
    totalKm: sql<number>`coalesce(sum(coalesce((SELECT sum(${s.tripLegs.km}) FROM ${s.tripLegs} WHERE ${s.tripLegs.tripId} = ${s.trips.id}), ${s.routes.distanceKm})), 0)`,
    totalFuel: sql<number>`coalesce(sum(${s.trips.fuelLiters}), 0)`,
    totalRoad: sql<number>`coalesce(sum(${s.trips.totalRoadAllowance}), 0)`,
    totalRevenue: sql<number>`coalesce(sum(${s.trips.revenue}), 0)`,
    missingFuel: sql<number>`count(*) filter (where ${s.trips.fuelLiters} is null or ${s.trips.fuelLiters} = 0)`,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .where(where);

  const totalKm = Number(agg?.totalKm ?? 0);
  const totalFuel = Number(agg?.totalFuel ?? 0);
  const avgPer100 = totalKm > 0 && totalFuel > 0 ? (totalFuel / totalKm) * 100 : 0;

  const statusCounts: Record<string, number> = {
    all: Number(agg?.total ?? 0),
    [TripStatus.CREATED]: Number(agg?.created ?? 0),
    [TripStatus.IN_TRANSIT]: Number(agg?.inTransit ?? 0),
    [TripStatus.COMPLETED]: Number(agg?.completed ?? 0),
    [TripStatus.CANCELED]: Number(agg?.canceled ?? 0),
  };

  // Distinct truck options
  const truckRows = await db.selectDistinct({
    id: s.trucks.id,
    licensePlate: s.trucks.licensePlate,
  }).from(s.trips)
    .innerJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .where(where)
    .orderBy(s.trucks.licensePlate);

  const truckOptions = truckRows.map(r => ({ id: r.id, licensePlate: r.licensePlate ?? '' }));
  // Always include 'Xe ngoài' (id: -1) as a filter option so users can always filter by external carriers.
  truckOptions.push({ id: -1, licensePlate: 'Xe ngoài' });

  // Distinct customer options
  const customerRows = await db.selectDistinct({
    id: s.customers.id,
    name: CUSTOMER_OPERATIONAL_NAME,
  }).from(s.trips)
    .innerJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .where(where)
    .orderBy(CUSTOMER_OPERATIONAL_NAME);

  return {
    statusCounts,
    totalKm,
    totalFuel,
    totalRoad: Number(agg?.totalRoad ?? 0),
    totalRevenue: Number(agg?.totalRevenue ?? 0),
    missingFuel: Number(agg?.missingFuel ?? 0),
    avgPer100,
    truckOptions,
    customerOptions: customerRows,
  };
}

export async function getTripById(id: number) {
  const [trip] = await TRIP_RELATION_JOINS(db.select({
    id: s.trips.id, tripCode: s.trips.tripCode, version: s.trips.version,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId, customerReference: s.trips.customerReference,
    truckId: s.trips.truckId, driverId: s.trips.driverId, routeId: s.trips.routeId,
    cargoTypeId: s.trips.cargoTypeId, containerCount: s.trips.containerCount,
    status: s.trips.status, departureDate: s.trips.departureDate,
    plannedStartAt: s.trips.plannedStartAt,
    plannedEndAt: s.trips.plannedEndAt,
    canonicalOrigin: s.trips.canonicalOrigin,
    canonicalDestination: s.trips.canonicalDestination,
    cargoWeightKg: s.trips.cargoWeightKg,
    vehicleCapacityKg: s.trips.vehicleCapacityKg,
    activeTripPairId: s.trips.activeTripPairId,
    activeTripPairOrder: s.trips.activeTripPairOrder,
    fuelMode: s.trips.fuelMode, fuelLiters: s.trips.fuelLiters,
    fuelLitersOverride: s.trips.fuelLitersOverride, fuelSupplementLiters: s.trips.fuelSupplementLiters,
    fuelSupplementReason: s.trips.fuelSupplementReason, fuelPriceApplied: s.trips.fuelPriceApplied,
    fuelActualUnitPrice: s.trips.fuelActualUnitPrice, fuelSupplierId: s.trips.fuelSupplierId,
    tollsDiscount: s.trips.tollsDiscount, tollsAddition: s.trips.tollsAddition, tollsStations: s.trips.tollsStations,
    totalFuelCost: s.trips.totalFuelCost, totalRoadAllowance: s.trips.totalRoadAllowance,
    totalCost: s.trips.totalCost, revenue: s.trips.revenue, revenueEmptyReturn: s.trips.revenueEmptyReturn,
    revenueCombine: s.trips.revenueCombine, grossProfit: s.trips.grossProfit,
    revenueOriginal: s.trips.revenueOriginal, revenueOverriddenBy: s.trips.revenueOverriddenBy,
    revenueOverriddenAt: s.trips.revenueOverriddenAt, hasReturnCargo: s.trips.hasReturnCargo,
    driverSalary: s.trips.driverSalary, notes: s.trips.notes,
    twoPointDeliveryBonus: s.trips.twoPointDeliveryBonus,
    vehicleShiftAllowance: s.trips.vehicleShiftAllowance,
    roadAllowanceOverride: s.trips.roadAllowanceOverride,
    tollCost: s.trips.tollCost,
    completedAt: s.trips.completedAt,
    roadAllowanceBaseApplied: s.trips.roadAllowanceBaseApplied,
    tollPerStationApplied: s.trips.tollPerStationApplied,
    returnCargoBonusApplied: s.trips.returnCargoBonusApplied,
    fuelLoadedNormApplied: s.trips.fuelLoadedNormApplied,
    fuelEmptyNormApplied: s.trips.fuelEmptyNormApplied,
    fuelFixedAllowanceApplied: s.trips.fuelFixedAllowanceApplied,
    fuelSupplementNormApplied: s.trips.fuelSupplementNormApplied,
    vatRate: s.trips.vatRate,
    carrierType: s.trips.carrierType, externalEntityId: s.trips.externalEntityId,
    externalFreightCost: s.trips.externalFreightCost,
    externalPlateNumber: s.trips.externalPlateNumber,
    externalDriverName: s.trips.externalDriverName,
    externalDriverPhone: s.trips.externalDriverPhone,
    customerCommission: s.trips.customerCommission,
    tripWageDays: s.trips.tripWageDays,
    createdAt: s.trips.createdAt, updatedAt: s.trips.updatedAt, deletedAt: s.trips.deletedAt,
    ...TRIP_RELATION_FIELDS,
  }).from(s.trips))
    .where(and(eq(s.trips.id, id), isNull(s.trips.deletedAt))).limit(1);

  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');

  const [legs, photos, instructions, gpsTrackRow, accountingLock] = await Promise.all([
    db.select().from(s.tripLegs).where(eq(s.tripLegs.tripId, id)).orderBy(s.tripLegs.sequence),
    // Only general (`OTHER`) photos belong in the trip-level `photoUrls`.
    // CONTAINER/SEAL photos are surfaced separately by the "Container & Seal"
    // card via GET /trips/:id/containers (contPhotoKeys/sealPhotoKeys), so
    // including them here would duplicate them across both sections.
    db.select({ storageKey: s.tripPhotos.storageKey }).from(s.tripPhotos)
      .where(and(eq(s.tripPhotos.tripId, id), eq(s.tripPhotos.type, 'OTHER'))),
    // Manager-authored contact + guidance (N2 / B1.3). Included here so the
    // edit form can populate the TripInstructionsCard fields from the same
    // detail payload (one row per trip; null when none exists yet).
    getTripInstructions(id),
    // The vehicle's full real GPS trail (Bách Khoa), captured at completion —
    // the complete driven path, drawn on the trip map as the real route.
    db.select({
      encodedPolyline: s.tripGpsTracks.encodedPolyline,
      distanceKm: s.tripGpsTracks.distanceKm,
      pointCount: s.tripGpsTracks.pointCount,
      stops: s.tripGpsTracks.stops,
    }).from(s.tripGpsTracks).where(eq(s.tripGpsTracks.tripId, id)).limit(1),
    trip.shipmentId == null ? Promise.resolve(null) : getShipmentAccountingLockSummary(trip.shipmentId),
  ]);

  // Routes (bidirectional: A→B also covers B→A reversed) for each leg.
  const byPair = await fetchRouteMap(legs);
  const legsWithPaths = legs.map(leg => {
    const route = resolveRoute(byPair, leg.origin, leg.destination);
    return { ...leg, polylinePath: route?.polyline ?? null };
  });

  // Per-leg stop coordinates so the map can number every stop (1,2,3..) even
  // when a leg has no captured route polyline (e.g. trip 76 legs 2-3). Resolves
  // free route-endpoint coords first, then Nominatim geocode (cached/throttled).
  const legCoords = await resolveLegCoords(legsWithPaths);
  const legsWithCoords = legsWithPaths.map((leg, i) => ({
    ...leg,
    originCoord: legCoords[i]?.originCoord ?? null,
    destinationCoord: legCoords[i]?.destinationCoord ?? null,
  }));

  const photoUrls = photos.map(p => `/api/photos/${encodeURIComponent(p.storageKey)}`);
  const pairingByTrip = await loadTripPairingSummaries([{
    id: trip.id,
    activeTripPairId: trip.activeTripPairId,
    activeTripPairOrder: trip.activeTripPairOrder,
  }]);
  const gpsRow = gpsTrackRow[0];
  const gpsTrail = gpsRow
    ? { encodedPolyline: gpsRow.encodedPolyline, distanceKm: Number(gpsRow.distanceKm), pointCount: gpsRow.pointCount, stops: gpsRow.stops ?? [] }
    : null;
  return {
    ...shapeTripRelations(trip, {
      legs: legsWithCoords,
      photoUrls,
      pairing: pairingByTrip.get(trip.id) ?? null,
    }),
    instructions,
    gpsTrail,
    accountingLock,
  };
}

/**
 * Transaction-scoped status/version read for trip figure mutations. Route
 * leaves call this inside runIdempotent create-callbacks instead of touching
 * the db client directly (arch-layering route->db boundary).
 */
export async function loadTripStatusVersion(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  tripId: number,
): Promise<{ status: string | null; version: number } | null> {
  const [current] = await executor.select({
    status: s.trips.status,
    version: s.trips.version,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  return current ?? null;
}
