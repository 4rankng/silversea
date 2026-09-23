import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, desc, sql, count, or } from 'drizzle-orm';
import { getTripInstructions } from './trip-instructions.service';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { listFuelEvidenceReviewsForTrip } from './fuel-evidence-review.service';
import { getShipmentAccountingLockSummary } from './shipment-accounting-lock.service';
import { operationalName } from '../db/master-data-name';

const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);

/**
 * Derived payment/approval status for a forwarder trip row, used for row
 * coloring on the forwarder trips list (N4).
 */
const hasApprovedSettlement = (forwarderId: number) => sql<boolean>`EXISTS (
  SELECT 1
  FROM settlement_expenses se
  INNER JOIN advance_settlements a ON a.id = se.settlement_id
  WHERE se.trip_expense_id IN (
    SELECT id FROM trip_expenses
    WHERE trip_id = ${s.trips.id} AND forwarder_id = ${forwarderId}
  )
    AND a.status = 'APPROVED'
)`;

const hasPendingExpenseOrSettlement = (forwarderId: number) => sql<boolean>`EXISTS (
  SELECT 1 FROM trip_expenses te
  WHERE te.trip_id = ${s.trips.id}
    AND te.forwarder_id = ${forwarderId}
    AND te.approval_status IN ('DRAFT', 'PENDING', 'RETURN_FOR_EVIDENCE')
)`;

function withinForwarderScope(forwarderId: number) {
  return sql<boolean>`
    EXISTS (
      SELECT 1
      FROM user_shipment_links scoped_assignment
      WHERE scoped_assignment.user_id = ${forwarderId}
        AND scoped_assignment.shipment_id = ${s.trips.shipmentId}
    )
  `;
}

type QueryClient = typeof db | Tx;

export async function assertForwarderTripScope(
  tripId: number,
  forwarderId: number,
  client: QueryClient = db,
): Promise<void> {
  const [trip] = await client.select({ id: s.trips.id })
    .from(s.trips)
    .where(and(
      eq(s.trips.id, tripId),
      isNull(s.trips.deletedAt),
      withinForwarderScope(forwarderId),
    ))
    .limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
}

/**
 * Locks the current assignment row and rejects writes after scope revocation or
 * after either the trip or shipment reaches a terminal state.
 */
export async function assertForwarderMutableTripScope(
  tripId: number,
  forwarderId: number,
  client: QueryClient = db,
): Promise<void> {
  const [trip] = await client.select({
    id: s.trips.id,
    shipmentId: s.trips.shipmentId,
    tripStatus: s.trips.status,
    shipmentStatus: s.shipments.status,
  })
    .from(s.trips)
    .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1)
    .for('share');
  if (!trip?.shipmentId) throw new ApiError(404, 'Không tìm thấy chuyến đi');

  const [assignment] = await client.select({ shipmentId: s.userShipmentLinks.shipmentId })
    .from(s.userShipmentLinks)
    .where(and(
      eq(s.userShipmentLinks.userId, forwarderId),
      eq(s.userShipmentLinks.shipmentId, trip.shipmentId),
    ))
    .limit(1)
    .for('update');
  if (!assignment) throw new ApiError(404, 'Không tìm thấy chuyến đi');

  if (
    trip.tripStatus === 'COMPLETED'
    || trip.tripStatus === 'CANCELED'
    || (trip.shipmentStatus === 'COMPLETED' || trip.shipmentStatus === 'CANCELED')
  ) {
    throw new ApiError(409, 'Không thể cập nhật chuyến hoặc lô hàng đã kết thúc');
  }
}

export async function assertForwarderMutableShipmentScope(
  shipmentId: number,
  forwarderId: number,
  client: QueryClient = db,
): Promise<void> {
  const [shipment] = await client.select({
    id: s.shipments.id,
    status: s.shipments.status,
  }).from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1)
    .for('share');
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  const [assignment] = await client.select({ shipmentId: s.userShipmentLinks.shipmentId })
    .from(s.userShipmentLinks)
    .where(and(
      eq(s.userShipmentLinks.userId, forwarderId),
      eq(s.userShipmentLinks.shipmentId, shipmentId),
    ))
    .limit(1)
    .for('update');
  if (!assignment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  if (shipment.status === 'NEW' || shipment.status === 'PENDING_DATE') {
    throw new ApiError(409, 'Lô hàng chưa sẵn sàng để đổi lệnh');
  }
  if (shipment.status === 'COMPLETED' || shipment.status === 'CANCELED') {
    throw new ApiError(409, 'Không thể cập nhật lô hàng đã kết thúc');
  }
}

export async function getForwarderTrips(
  forwarderId: number,
  status?: string,
  filters?: { search?: string; dateFrom?: string; dateTo?: string },
) {
  const conditions = [
    eq(s.userShipmentLinks.userId, forwarderId),
    isNull(s.shipments.deletedAt),
    sql`${s.shipments.status} <> 'PENDING_DATE'`,
    sql`${s.shipments.status} <> 'NEW'`,
    sql`${s.shipments.status} <> 'CANCELED'`,
  ];
  if (status) {
    conditions.push(eq(s.trips.status, status as 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELED'));
  }
  if (filters?.search) {
    const term = `%${filters.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(or(
      sql`unaccent(${CUSTOMER_OPERATIONAL_NAME}) ILIKE unaccent(${term})`,
      sql`unaccent(${s.customers.name}) ILIKE unaccent(${term})`,
      sql`${s.shipments.shipmentCode} ILIKE ${term}`,
      sql`${s.shipments.blNumber} ILIKE ${term}`,
      sql`${s.shipments.bookingRef} ILIKE ${term}`,
      sql`EXISTS (
        SELECT 1 FROM shipment_declarations sd
        WHERE sd.shipment_id = ${s.shipments.id}
          AND sd.declaration_number ILIKE ${term}
      )`,
      sql`EXISTS (
        SELECT 1 FROM shipment_containers sc
        WHERE sc.shipment_id = ${s.shipments.id}
          AND sc.container_number ILIKE ${term}
      )`,
      sql`EXISTS (
        SELECT 1 FROM trip_containers tc
        WHERE tc.trip_id = ${s.trips.id} AND tc.container_number ILIKE ${term}
      )`,
    )!);
  }
  if (filters?.dateFrom) {
    conditions.push(sql`coalesce(${s.trips.departureDate}, ${s.shipments.expectedDeliveryDate}) >= ${filters.dateFrom}`);
  }
  if (filters?.dateTo) {
    conditions.push(sql`coalesce(${s.trips.departureDate}, ${s.shipments.expectedDeliveryDate}) <= ${filters.dateTo}`);
  }

  return db.select({
    workItemKey: sql<string>`concat('shipment:', ${s.shipments.id}, ':trip:', coalesce(${s.trips.id}, 0))`,
    id: s.trips.id,
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    shipmentId: s.shipments.id,
    shipmentVersion: s.shipments.version,
    shipmentCode: s.shipments.shipmentCode,
    departureDate: sql<string | null>`coalesce(${s.trips.departureDate}, ${s.shipments.expectedDeliveryDate})`,
    status: s.trips.status,
    tripStatus: s.trips.status,
    shipmentStatus: s.shipments.status,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    customerReference: s.trips.customerReference,
    billNumber: s.shipments.blNumber,
    bookingNumber: s.shipments.bookingRef,
    factoryName: s.shipments.factoryName,
    tradeDirection: s.shipments.tradeDirection,
    declarationNumbers: sql<string | null>`(
      SELECT string_agg(sd.declaration_number, ', ' ORDER BY sd.id)
      FROM shipment_declarations sd
      WHERE sd.shipment_id = ${s.shipments.id}
        AND sd.declaration_number IS NOT NULL
    )`,
    containerTypeSummary: sql<string | null>`(
      SELECT string_agg(container_group.label, ', ' ORDER BY container_group.label)
      FROM (
        SELECT concat(count(*)::int, '×', coalesce(ct.code, ct.name, 'Chưa rõ')) AS label
        FROM shipment_containers sc
        LEFT JOIN container_types ct ON ct.id = sc.container_type_id
        WHERE sc.shipment_id = ${s.shipments.id}
        GROUP BY ct.code, ct.name
      ) container_group
    )`,
    containerCount: sql<number>`(
      SELECT count(*)::int FROM shipment_containers sc
      WHERE sc.shipment_id = ${s.shipments.id}
    )`,
    containerNumbers: sql<string | null>`coalesce(
      (
        SELECT string_agg(sc.container_number, ', ' ORDER BY sc.id)
        FROM shipment_containers sc
        WHERE sc.shipment_id = ${s.shipments.id}
          AND sc.container_number IS NOT NULL
      ),
      (
        SELECT string_agg(tc.container_number, ', ' ORDER BY tc.id)
        FROM trip_containers tc
        WHERE tc.trip_id = ${s.trips.id}
          AND tc.container_number IS NOT NULL
      )
    )`,
    cargoTypeName: s.cargoTypes.name,
    expenseScopesCompleted: sql<number>`(
      SELECT count(*)::int FROM trip_expense_completion_scopes scope
      WHERE scope.trip_id = ${s.trips.id}
        AND scope.trip_container_id IS NOT NULL
        AND scope.status = 'COMPLETED'
    )`,
    expenseScopesTotal: sql<number>`(
      SELECT count(*)::int FROM trip_containers tc
      WHERE tc.trip_id = ${s.trips.id}
    )`,
    statusColor: sql<'paid' | 'pending' | 'none'>`CASE
      WHEN ${hasApprovedSettlement(forwarderId)} THEN 'paid'
      WHEN ${hasPendingExpenseOrSettlement(forwarderId)} THEN 'pending'
      ELSE 'none'
    END`,
    orderExchangeStatus: sql<'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>`CASE
      WHEN ${s.shipments.orderExchangeCompletedAt} IS NOT NULL THEN 'COMPLETED'
      WHEN ${s.shipments.orderExchangeStartedAt} IS NOT NULL THEN 'IN_PROGRESS'
      ELSE 'PENDING'
    END`,
    orderExchangeStartedAt: s.shipments.orderExchangeStartedAt,
    orderExchangeStartedBy: s.shipments.orderExchangeStartedBy,
    orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
    orderExchangeCompletedBy: s.shipments.orderExchangeCompletedBy,
  }).from(s.userShipmentLinks)
    .innerJoin(s.shipments, eq(s.userShipmentLinks.shipmentId, s.shipments.id))
    .leftJoin(s.trips, and(
      eq(s.trips.shipmentId, s.shipments.id),
      isNull(s.trips.deletedAt),
      sql`${s.trips.status} <> 'CANCELED'`,
    ))
    .leftJoin(s.routes, sql`${s.routes.id} = coalesce(${s.trips.routeId}, ${s.shipments.routeId})`)
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.shipments.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.shipments.cargoTypeId, s.cargoTypes.id))
    .where(and(...conditions))
    .orderBy(desc(sql`coalesce(${s.trips.departureDate}, ${s.shipments.expectedDeliveryDate})`), desc(s.shipments.id));
}

export async function latestTripPhotoKey(
  tripId: number,
  type: 'CONTAINER' | 'SEAL',
): Promise<string | null> {
  const rows = await db.select({ storageKey: s.tripPhotos.storageKey })
    .from(s.tripPhotos)
    .where(and(eq(s.tripPhotos.tripId, tripId), eq(s.tripPhotos.type, type)))
    .orderBy(desc(s.tripPhotos.uploadedAt))
    .limit(1);
  return rows[0]?.storageKey ?? null;
}

export async function listTripPhotoKeys(
  tripId: number,
  type: 'CONTAINER' | 'SEAL',
): Promise<string[]> {
  const rows = await db.select({ storageKey: s.tripPhotos.storageKey })
    .from(s.tripPhotos)
    .where(and(eq(s.tripPhotos.tripId, tripId), eq(s.tripPhotos.type, type)))
    .orderBy(desc(s.tripPhotos.uploadedAt));
  return rows.map(r => r.storageKey);
}

export async function getForwarderTripCounts(forwarderId: number) {
  const rows = await db.select({
    status: s.trips.status,
    count: count(),
  }).from(s.trips)
    .where(and(isNull(s.trips.deletedAt), withinForwarderScope(forwarderId)))
    .groupBy(s.trips.status);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.status != null) counts[row.status] = row.count;
  }
  return counts;
}

export async function getForwarderTripDetail(tripId: number, forwarderId: number) {
  const [trip] = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    shipmentId: s.trips.shipmentId,
    version: s.trips.version,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    routeName: ROUTE_OPERATIONAL_NAME,
    truckPlate: s.trucks.licensePlate,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    customerReference: s.trips.customerReference,
    shipmentCode: s.shipments.shipmentCode,
    billNumber: s.shipments.blNumber,
    bookingNumber: s.shipments.bookingRef,
    factoryName: s.shipments.factoryName,
    tradeDirection: s.shipments.tradeDirection,
    shipmentStatus: s.shipments.status,
    declarationNumbers: sql<string | null>`(
      SELECT string_agg(sd.declaration_number, ', ' ORDER BY sd.id)
      FROM shipment_declarations sd
      WHERE sd.shipment_id = ${s.shipments.id}
        AND sd.declaration_number IS NOT NULL
    )`,
    containerTypeSummary: sql<string | null>`(
      SELECT string_agg(container_group.label, ', ' ORDER BY container_group.label)
      FROM (
        SELECT concat(count(*)::int, '×', coalesce(ct.code, ct.name, 'Chưa rõ')) AS label
        FROM shipment_containers sc
        LEFT JOIN container_types ct ON ct.id = sc.container_type_id
        WHERE sc.shipment_id = ${s.shipments.id}
        GROUP BY ct.code, ct.name
      ) container_group
    )`,
    containerCount: s.trips.containerCount,
    cargoTypeName: s.cargoTypes.name,
    shipmentSourceVersion: sql<number | null>`coalesce(
      ${s.trips.sourceShipmentVersion},
      (
        SELECT max(tc.source_shipment_version)
        FROM trip_containers tc
        WHERE tc.trip_id = ${s.trips.id}
          AND tc.source_shipment_id = ${s.trips.shipmentId}
      )
    )`,
    notes: s.trips.notes,
    paperOrderCollectedAt: s.trips.paperOrderCollectedAt,
    paperOrderCollectedBy: s.trips.paperOrderCollectedBy,
    paperOrderCollectedByName: s.users.fullName,
    shipmentVersion: s.shipments.version,
    orderExchangeStatus: sql<'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>`CASE
      WHEN ${s.shipments.orderExchangeCompletedAt} IS NOT NULL THEN 'COMPLETED'
      WHEN ${s.shipments.orderExchangeStartedAt} IS NOT NULL THEN 'IN_PROGRESS'
      ELSE 'PENDING'
    END`,
    orderExchangeStartedAt: s.shipments.orderExchangeStartedAt,
    orderExchangeStartedBy: s.shipments.orderExchangeStartedBy,
    orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
    orderExchangeCompletedBy: s.shipments.orderExchangeCompletedBy,
  }).from(s.trips)
    .innerJoin(s.shipments, eq(s.trips.shipmentId, s.shipments.id))
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.trips.cargoTypeId, s.cargoTypes.id))
    .leftJoin(s.users, eq(s.users.id, s.trips.paperOrderCollectedBy))
    .where(and(
      eq(s.trips.id, tripId),
      isNull(s.trips.deletedAt),
      withinForwarderScope(forwarderId),
    ))
    .limit(1);

  if (!trip) return null;

  const legs = await db.select().from(s.tripLegs)
    .where(eq(s.tripLegs.tripId, tripId))
    .orderBy(s.tripLegs.sequence);

  const containers = await db.select({
    id: s.tripContainers.id,
    tripId: s.tripContainers.tripId,
    sourceShipmentId: s.tripContainers.sourceShipmentId,
    sourceShipmentContainerId: s.tripContainers.sourceShipmentContainerId,
    sourceShipmentVersion: s.tripContainers.sourceShipmentVersion,
    containerTypeId: s.tripContainers.containerTypeId,
    containerTypeName: s.containerTypes.name,
    containerNumber: s.tripContainers.containerNumber,
    sealNumber: s.tripContainers.sealNumber,
    notes: s.tripContainers.notes,
    createdBy: s.tripContainers.createdBy,
    createdAt: s.tripContainers.createdAt,
  }).from(s.tripContainers)
    .leftJoin(s.containerTypes, eq(s.tripContainers.containerTypeId, s.containerTypes.id))
    .where(eq(s.tripContainers.tripId, tripId))
    .orderBy(desc(s.tripContainers.createdAt));

  const expenses = await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    forwarderId: s.tripExpenses.forwarderId,
    expenseType: s.tripExpenses.expenseType,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    settlementMethod: s.tripExpenses.settlementMethod,
    supplierId: s.tripExpenses.supplierId,
    supplierName: s.suppliers.name,
    expenseDate: s.tripExpenses.expenseDate,
    payeeName: s.tripExpenses.payeeName,
    containerNumber: s.tripExpenses.containerNumber,
    tripContainerId: s.tripExpenses.tripContainerId,
    activeSettlementId: sql<number | null>`(
      SELECT se.settlement_id
      FROM settlement_expenses se
      JOIN advance_settlements aset ON aset.id = se.settlement_id
      WHERE se.trip_expense_id = ${s.tripExpenses.id}
        AND aset.status NOT IN ('VOIDED', 'REVERSED')
      ORDER BY se.id DESC
      LIMIT 1
    )`,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
    declarationNumber: s.tripExpenses.declarationNumber,
    approvalStatus: s.tripExpenses.approvalStatus,
    deletionReason: s.tripExpenses.deletionReason,
    deletedAt: s.tripExpenses.deletedAt,
    deletedByName: sql<string | null>`(SELECT u.full_name FROM users u WHERE u.id = ${s.tripExpenses.deletedBy})`,
    note: s.tripExpenses.note,
    noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
    noInvoicePolicySnapshot: s.tripExpenses.noInvoicePolicySnapshot,
    returnForEvidenceReason: s.tripExpenses.returnForEvidenceReason,
    returnedForEvidenceAt: s.tripExpenses.returnedForEvidenceAt,
    createdAt: s.tripExpenses.createdAt,
    updatedAt: s.tripExpenses.updatedAt,
    forwarderName: s.users.fullName,
    canEdit: sql<boolean>`${s.tripExpenses.forwarderId} = ${forwarderId}`,
  }).from(s.tripExpenses)
    .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(eq(s.tripExpenses.tripId, tripId))
    .orderBy(desc(s.tripExpenses.createdAt));

  const [instructions, fuelEvidenceReviews, accountingLock] = await Promise.all([
    getTripInstructions(tripId),
    listFuelEvidenceReviewsForTrip(tripId),
    trip.shipmentId == null ? Promise.resolve(null) : getShipmentAccountingLockSummary(trip.shipmentId),
  ]);

  const storedScopes = await db.select({
    tripId: s.tripExpenseCompletionScopes.tripId,
    tripContainerId: s.tripExpenseCompletionScopes.tripContainerId,
    status: s.tripExpenseCompletionScopes.status,
    completedBy: s.tripExpenseCompletionScopes.completedBy,
    completedAt: s.tripExpenseCompletionScopes.completedAt,
    completedByName: s.users.fullName,
  }).from(s.tripExpenseCompletionScopes)
    .leftJoin(s.users, eq(s.users.id, s.tripExpenseCompletionScopes.completedBy))
    .where(eq(s.tripExpenseCompletionScopes.tripId, tripId));

  const scopeByContainer = new Map(storedScopes.map(scope => [scope.tripContainerId, scope]));
  const completionScopes = containers.map(container => scopeByContainer.get(container.id) ?? ({
    tripId,
    tripContainerId: container.id,
    status: 'IN_PROGRESS',
    completedBy: null,
    completedAt: null,
    completedByName: null,
  }));
  if (expenses.some(expense => expense.tripContainerId == null) || scopeByContainer.has(null)) {
    completionScopes.push(scopeByContainer.get(null) ?? ({
      tripId,
      tripContainerId: null,
      status: 'IN_PROGRESS',
      completedBy: null,
      completedAt: null,
      completedByName: null,
    }));
  }
  const completionProgress = {
    completed: completionScopes.filter(scope => scope.tripContainerId != null && scope.status === 'COMPLETED').length,
    total: containers.length,
  };

  return { ...trip, legs, containers, expenses, completionScopes, completionProgress, instructions, fuelEvidenceReviews, accountingLock };
}
