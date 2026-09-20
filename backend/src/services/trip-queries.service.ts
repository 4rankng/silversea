// Trip Queries — Read-only data retrieval functions
// getTrips, getTripById, getTripsSummary and their helpers

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, or, isNull, sql, desc, lte, gte, inArray, type SQL } from 'drizzle-orm';
import { TripStatus, normalizeContainerNumber } from '@tingting/shared';
import { ApiError } from '../errors';
import { getTripInstructions } from './trip-instructions.service';
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
  truckClass: s.trucks.vehicleClass,
  routeName: ROUTE_OPERATIONAL_NAME,
  routeDistance: s.routes.distanceKm,
  routeIsMountain: s.routes.isMountain,
  routeFixedFuelAllowance: s.routes.fixedFuelAllowance,
  trailerLicensePlate: s.trailers.licensePlate,
  trailerId: s.tripsComposite.trailerId,
  trailerType: s.tripsComposite.trailerType,
  fuelSupplierName: s.suppliers.name,
};

/** Minimal structural type for the leftJoin method so we can chain joins generically. */
type WithLeftJoin = { leftJoin: (table: typeof s.customers | typeof s.drivers | typeof s.trucks | typeof s.routes | typeof s.trailers | typeof s.suppliers, on: SQL) => WithLeftJoin };

/**
 * Apply the 6 standard relation LEFT JOINs to a trip select query.
 * Generic over T to preserve the builder's row type for downstream .where/.orderBy chains.
 */
const TRIP_RELATION_JOINS = <T extends WithLeftJoin>(query: T): T => (query as WithLeftJoin)
  .leftJoin(s.customers, eq(s.tripsComposite.customerId, s.customers.id))
  .leftJoin(s.drivers, eq(s.tripsComposite.driverId, s.drivers.id))
  .leftJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
  .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
  .leftJoin(s.trailers, eq(s.tripsComposite.trailerId, s.trailers.id))
  .leftJoin(s.suppliers, eq(s.tripsComposite.fuelSupplierId, s.suppliers.id)) as unknown as T;

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
    truck: item.truckPlate ? { id: item.truckId, licensePlate: item.truckPlate, vehicleClass: item.truckClass ?? null } : null,
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
  tripCode: sql`${s.tripsComposite.tripCode}`,
  truck: sql`coalesce(${s.trucks.licensePlate}, ${s.tripsComposite.externalPlateNumber})`,
  route: sql`${ROUTE_OPERATIONAL_NAME}`,
  container: sql`(
    select tc.container_number from ${s.tripContainers} tc
    where tc.trip_id = ${s.tripsComposite.id}
    order by tc.id
    limit 1
  )`,
  consumption: sql`${s.tripsComposite.fuelLiters}`,
  road: sql`coalesce(${s.tripsComposite.totalRoadAllowance}, 0) + coalesce(${s.tripsComposite.tollCost}, 0)`,
  revenue: sql`${s.tripsComposite.revenue}`,
  driverSalary: sql`${s.tripsComposite.driverSalary}`,
  totalCost: sql`${s.tripsComposite.totalCost}`,
  grossProfit: sql`case
    when ${s.tripsComposite.carrierType} = 'EXTERNAL'
      and coalesce(${s.tripsComposite.revenue}, 0) <> 0
      and coalesce(${s.tripsComposite.externalFreightCost}, 0) <> 0
    then round(${s.tripsComposite.revenue} / (1 + coalesce(${s.tripsComposite.vatRate}, 0.08)))
       - round(${s.tripsComposite.externalFreightCost} / (1 + coalesce(${s.tripsComposite.vatRate}, 0.08)))
    else ${s.tripsComposite.grossProfit}
  end`,
  status: sql`${s.tripsComposite.status}`,
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
    WHERE ${s.tripContainers.tripId} = ${s.tripsComposite.id}
      AND (${sql.join(containerNumberSearchConditions(rawTerm, normalizedTerm), sql` OR `)})
  )`;
}

function tripExpenseContainerExists(rawTerm: string, normalizedTerm: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${s.tripExpenses}
    WHERE ${s.tripExpenses.tripId} = ${s.tripsComposite.id}
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
  const countConditions: SQL<unknown>[] = [isNull(s.tripsComposite.deletedAt)];
  const conditions = [...countConditions];
  if (filters.status) {
    const c = eq(s.tripsComposite.status, filters.status as TripStatus);
    conditions.push(c); countConditions.push(c);
  }
  if (filters.truckId) {
    if (filters.truckId === -1) {
      const c = eq(s.tripsComposite.carrierType, 'EXTERNAL');
      conditions.push(c); countConditions.push(c);
    } else {
      const c = eq(s.tripsComposite.truckId, filters.truckId);
      conditions.push(c); countConditions.push(c);
    }
  }
  if (filters.driverId) {
    const c = eq(s.tripsComposite.driverId, filters.driverId);
    conditions.push(c); countConditions.push(c);
  }
  if (filters.customerId) {
    const c = eq(s.tripsComposite.customerId, filters.customerId);
    conditions.push(c); countConditions.push(c);
  }
  // Search intent is "find this specific trip regardless of when" — the date
  // range from the topbar month chip is suppressed so e.g. searching for
  // TRP-202605-0003 from the June chip still resolves to the May trip.
  // Frontend already omits the range when searching; this is a defense layer
  // for any client that doesn't.
  const applyDateRange = !filters.search;
  if (applyDateRange && filters.dateFrom) {
    const c = gte(s.tripsComposite.departureDate, filters.dateFrom);
    conditions.push(c); countConditions.push(c);
  }
  if (applyDateRange && filters.dateTo) {
    const c = lte(s.tripsComposite.departureDate, filters.dateTo);
    conditions.push(c); countConditions.push(c);
  }
  if (filters.search) {
    const term = `%${escapeLikeTerm(filters.search)}%`;
    const normalizedContainerTerm = `%${escapeLikeTerm(normalizeContainerNumber(filters.search))}%`;
    // List: full predicates (5 ILIKE + 2 EXISTS for container cross-refs)
    conditions.push(
      or(
        sql`unaccent(${s.tripsComposite.tripCode}) ILIKE unaccent(${term})`,
        sql`${s.tripsComposite.id}::text ILIKE ${term}`,
        sql`unaccent(${CUSTOMER_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.customers.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trucks.licensePlate}) ILIKE unaccent(${term})`,
        sql`unaccent(${ROUTE_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.routes.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.tripsComposite.customerReference}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.tripsComposite.externalPlateNumber}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.tripsComposite.externalDriverName}) ILIKE unaccent(${term})`,
        sql`(${s.tripsComposite.carrierType} = 'EXTERNAL' AND 'xe ngoai' ILIKE unaccent(${term}))`,
        tripContainerExists(term, normalizedContainerTerm),
        tripExpenseContainerExists(term, normalizedContainerTerm),
      )!
    );
    // Count mirrors the list predicates so container-only searches report a
    // usable total and pagination state instead of showing rows with total=0.
    countConditions.push(
      or(
        sql`unaccent(${s.tripsComposite.tripCode}) ILIKE unaccent(${term})`,
        sql`${s.tripsComposite.id}::text ILIKE ${term}`,
        sql`unaccent(${CUSTOMER_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.customers.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.trucks.licensePlate}) ILIKE unaccent(${term})`,
        sql`unaccent(${ROUTE_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.routes.name}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.tripsComposite.customerReference}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.tripsComposite.externalPlateNumber}) ILIKE unaccent(${term})`,
        sql`unaccent(${s.tripsComposite.externalDriverName}) ILIKE unaccent(${term})`,
        sql`(${s.tripsComposite.carrierType} = 'EXTERNAL' AND 'xe ngoai' ILIKE unaccent(${term}))`,
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
        desc(s.tripsComposite.id),
      ]
    : [desc(s.tripsComposite.departureDate), desc(s.tripsComposite.id)];

  const items = await TRIP_RELATION_JOINS(db.select({
    id: s.tripsComposite.id, tripCode: s.tripsComposite.tripCode, version: s.tripsComposite.version,
    customerId: s.tripsComposite.customerId, customerReference: s.tripsComposite.customerReference,
    shipmentId: s.tripsComposite.shipmentId,
    truckId: s.tripsComposite.truckId, driverId: s.tripsComposite.driverId, routeId: s.tripsComposite.routeId,
    cargoTypeId: s.tripsComposite.cargoTypeId, containerCount: s.tripsComposite.containerCount,
    status: s.tripsComposite.status, departureDate: s.tripsComposite.departureDate,
    plannedStartAt: s.tripsComposite.plannedStartAt,
    plannedEndAt: s.tripsComposite.plannedEndAt,
    canonicalOrigin: s.tripsComposite.canonicalOrigin,
    canonicalDestination: s.tripsComposite.canonicalDestination,
    cargoWeightKg: s.tripsComposite.cargoWeightKg,
    vehicleCapacityKg: s.tripsComposite.vehicleCapacityKg,
    activeTripPairId: s.tripsComposite.activeTripPairId,
    activeTripPairOrder: s.tripsComposite.activeTripPairOrder,
    fuelMode: s.tripsComposite.fuelMode, fuelLiters: s.tripsComposite.fuelLiters,
    fuelLitersOverride: s.tripsComposite.fuelLitersOverride,
    fuelSupplementLiters: s.tripsComposite.fuelSupplementLiters,
    fuelSupplementReason: s.tripsComposite.fuelSupplementReason,
    fuelActualUnitPrice: s.tripsComposite.fuelActualUnitPrice,
    fuelSupplierId: s.tripsComposite.fuelSupplierId,
    totalFuelCost: s.tripsComposite.totalFuelCost, totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
    totalCost: s.tripsComposite.totalCost, revenue: s.tripsComposite.revenue, revenueEmptyReturn: s.tripsComposite.revenueEmptyReturn,
    revenueCombine: s.tripsComposite.revenueCombine, grossProfit: s.tripsComposite.grossProfit,
    hasReturnCargo: s.tripsComposite.hasReturnCargo, driverSalary: s.tripsComposite.driverSalary,
    roadAllowanceOverride: s.tripsComposite.roadAllowanceOverride,
    customerCommission: s.tripsComposite.customerCommission,
    tripWageDays: s.tripsComposite.tripWageDays,
    notes: s.tripsComposite.notes,
    twoPointDeliveryBonus: s.tripsComposite.twoPointDeliveryBonus,
    vehicleShiftAllowance: s.tripsComposite.vehicleShiftAllowance,
    tollCost: s.tripsComposite.tollCost,
    tollsDiscount: s.tripsComposite.tollsDiscount, tollsAddition: s.tripsComposite.tollsAddition, tollsStations: s.tripsComposite.tollsStations,
    carrierType: s.tripsComposite.carrierType,
    // O2C: DB column renamed to external_entity_id (soft pointer), but the API
    // response keeps the externalCarrierId contract name for frontend compat.
    externalCarrierId: s.tripsComposite.externalEntityId,
    externalFreightCost: s.tripsComposite.externalFreightCost,
    externalPlateNumber: s.tripsComposite.externalPlateNumber, externalDriverName: s.tripsComposite.externalDriverName,
    createdAt: s.tripsComposite.createdAt, updatedAt: s.tripsComposite.updatedAt,
    ...TRIP_RELATION_FIELDS,
  }).from(s.tripsComposite))
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
    ? await TRIP_RELATION_JOINS(db.select({ count: sql<number>`count(*)` }).from(s.tripsComposite))
        .where(and(...countConditions))
    : await db.select({ count: sql<number>`count(*)` })
        .from(s.tripsComposite)
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
  const conditions = [isNull(s.tripsComposite.deletedAt)];
  if (dateFrom) conditions.push(gte(s.tripsComposite.departureDate, dateFrom));
  if (dateTo) conditions.push(lte(s.tripsComposite.departureDate, dateTo));

  const where = and(...conditions);

  // Aggregate metrics in one query
  const [agg] = await db.select({
    total: sql<number>`count(*)`,
    created: sql<number>`count(*) filter (where ${s.tripsComposite.status} = 'CREATED')`,
    inTransit: sql<number>`count(*) filter (where ${s.tripsComposite.status} = 'IN_TRANSIT')`,
    completed: sql<number>`count(*) filter (where ${s.tripsComposite.status} = 'COMPLETED')`,
    canceled: sql<number>`count(*) filter (where ${s.tripsComposite.status} = 'CANCELED')`,
    totalKm: sql<number>`coalesce(sum(coalesce((SELECT sum(${s.tripLegs.km}) FROM ${s.tripLegs} WHERE ${s.tripLegs.tripId} = ${s.tripsComposite.id}), ${s.routes.distanceKm})), 0)`,
    totalFuel: sql<number>`coalesce(sum(${s.tripsComposite.fuelLiters}), 0)`,
    totalRoad: sql<number>`coalesce(sum(${s.tripsComposite.totalRoadAllowance}), 0)`,
    totalRevenue: sql<number>`coalesce(sum(${s.tripsComposite.revenue}), 0)`,
    missingFuel: sql<number>`count(*) filter (where ${s.tripsComposite.fuelLiters} is null or ${s.tripsComposite.fuelLiters} = 0)`,
  }).from(s.tripsComposite)
    .leftJoin(s.routes, eq(s.tripsComposite.routeId, s.routes.id))
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
  }).from(s.tripsComposite)
    .innerJoin(s.trucks, eq(s.tripsComposite.truckId, s.trucks.id))
    .where(where)
    .orderBy(s.trucks.licensePlate);

  const truckOptions = truckRows.map(r => ({ id: r.id, licensePlate: r.licensePlate ?? '' }));
  // Always include 'Xe ngoài' (id: -1) as a filter option so users can always filter by external carriers.
  truckOptions.push({ id: -1, licensePlate: 'Xe ngoài' });

  // Distinct customer options
  const customerRows = await db.selectDistinct({
    id: s.customers.id,
    name: CUSTOMER_OPERATIONAL_NAME,
  }).from(s.tripsComposite)
    .innerJoin(s.customers, eq(s.tripsComposite.customerId, s.customers.id))
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
    id: s.tripsComposite.id, tripCode: s.tripsComposite.tripCode, version: s.tripsComposite.version,
    shipmentId: s.tripsComposite.shipmentId,
    customerId: s.tripsComposite.customerId, customerReference: s.tripsComposite.customerReference,
    truckId: s.tripsComposite.truckId, driverId: s.tripsComposite.driverId, routeId: s.tripsComposite.routeId,
    cargoTypeId: s.tripsComposite.cargoTypeId, containerCount: s.tripsComposite.containerCount,
    status: s.tripsComposite.status, departureDate: s.tripsComposite.departureDate,
    plannedStartAt: s.tripsComposite.plannedStartAt,
    plannedEndAt: s.tripsComposite.plannedEndAt,
    canonicalOrigin: s.tripsComposite.canonicalOrigin,
    canonicalDestination: s.tripsComposite.canonicalDestination,
    cargoWeightKg: s.tripsComposite.cargoWeightKg,
    vehicleCapacityKg: s.tripsComposite.vehicleCapacityKg,
    activeTripPairId: s.tripsComposite.activeTripPairId,
    activeTripPairOrder: s.tripsComposite.activeTripPairOrder,
    fuelMode: s.tripsComposite.fuelMode, fuelLiters: s.tripsComposite.fuelLiters,
    fuelLitersOverride: s.tripsComposite.fuelLitersOverride, fuelSupplementLiters: s.tripsComposite.fuelSupplementLiters,
    fuelSupplementReason: s.tripsComposite.fuelSupplementReason, fuelPriceApplied: s.tripsComposite.fuelPriceApplied,
    fuelActualUnitPrice: s.tripsComposite.fuelActualUnitPrice, fuelSupplierId: s.tripsComposite.fuelSupplierId,
    tollsDiscount: s.tripsComposite.tollsDiscount, tollsAddition: s.tripsComposite.tollsAddition, tollsStations: s.tripsComposite.tollsStations,
    totalFuelCost: s.tripsComposite.totalFuelCost, totalRoadAllowance: s.tripsComposite.totalRoadAllowance,
    totalCost: s.tripsComposite.totalCost, revenue: s.tripsComposite.revenue, revenueEmptyReturn: s.tripsComposite.revenueEmptyReturn,
    revenueCombine: s.tripsComposite.revenueCombine, grossProfit: s.tripsComposite.grossProfit,
    revenueOriginal: s.tripsComposite.revenueOriginal, revenueOverriddenBy: s.tripsComposite.revenueOverriddenBy,
    revenueOverriddenAt: s.tripsComposite.revenueOverriddenAt, hasReturnCargo: s.tripsComposite.hasReturnCargo,
    driverSalary: s.tripsComposite.driverSalary, notes: s.tripsComposite.notes,
    twoPointDeliveryBonus: s.tripsComposite.twoPointDeliveryBonus,
    vehicleShiftAllowance: s.tripsComposite.vehicleShiftAllowance,
    roadAllowanceOverride: s.tripsComposite.roadAllowanceOverride,
    tollCost: s.tripsComposite.tollCost,
    completedAt: s.tripsComposite.completedAt,
    roadAllowanceBaseApplied: s.tripsComposite.roadAllowanceBaseApplied,
    tollPerStationApplied: s.tripsComposite.tollPerStationApplied,
    returnCargoBonusApplied: s.tripsComposite.returnCargoBonusApplied,
    fuelLoadedNormApplied: s.tripsComposite.fuelLoadedNormApplied,
    fuelEmptyNormApplied: s.tripsComposite.fuelEmptyNormApplied,
    fuelFixedAllowanceApplied: s.tripsComposite.fuelFixedAllowanceApplied,
    fuelSupplementNormApplied: s.tripsComposite.fuelSupplementNormApplied,
    vatRate: s.tripsComposite.vatRate,
    carrierType: s.tripsComposite.carrierType, externalEntityId: s.tripsComposite.externalEntityId,
    externalFreightCost: s.tripsComposite.externalFreightCost,
    externalPlateNumber: s.tripsComposite.externalPlateNumber,
    externalDriverName: s.tripsComposite.externalDriverName,
    externalDriverPhone: s.tripsComposite.externalDriverPhone,
    customerCommission: s.tripsComposite.customerCommission,
    tripWageDays: s.tripsComposite.tripWageDays,
    createdAt: s.tripsComposite.createdAt, updatedAt: s.tripsComposite.updatedAt, deletedAt: s.tripsComposite.deletedAt,
    // Acceptance signal (ORDER_RECEIVED milestone) — the same fact the
    // reassignment guard keys on, surfaced so dispatcher UI can show the
    // lock before offering reassignment.
    driverAccepted: sql<boolean>`exists (select 1 from ${s.driverProgressEvents} dpe
      where dpe.trip_id = ${s.tripsComposite.id} and dpe.event_type = 'ORDER_RECEIVED')`,
    ...TRIP_RELATION_FIELDS,
  }).from(s.tripsComposite))
    .where(and(eq(s.tripsComposite.id, id), isNull(s.tripsComposite.deletedAt))).limit(1);

  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');

  const [legs, photos, instructions, accountingLock] = await Promise.all([
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
    trip.shipmentId == null ? Promise.resolve(null) : getShipmentAccountingLockSummary(trip.shipmentId),
  ]);

  const photoUrls = photos.map(p => `/api/photos/${encodeURIComponent(p.storageKey)}`);
  const pairingByTrip = await loadTripPairingSummaries([{
    id: trip.id,
    activeTripPairId: trip.activeTripPairId,
    activeTripPairOrder: trip.activeTripPairOrder,
  }]);
  return {
    ...shapeTripRelations(trip, {
      legs,
      photoUrls,
      pairing: pairingByTrip.get(trip.id) ?? null,
    }),
    instructions,
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
    status: s.tripsComposite.status,
    version: s.tripsComposite.version,
  }).from(s.tripsComposite).where(eq(s.tripsComposite.id, tripId)).limit(1);
  return current ?? null;
}
