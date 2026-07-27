import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, desc, sql, count, gte, lte, or } from 'drizzle-orm';
import { getTripInstructions } from './trip-instructions.service';

/**
 * Derived payment/approval status for a forwarder trip row, used for row
 * coloring on the forwarder trips list (N4).
 */
const hasApprovedSettlement = sql<boolean>`EXISTS (
  SELECT 1
  FROM settlement_expenses se
  INNER JOIN advance_settlements a ON a.id = se.settlement_id
  WHERE se.trip_expense_id IN (SELECT id FROM trip_expenses WHERE trip_id = ${s.trips.id})
    AND a.status = 'APPROVED'
)`;

const hasPendingExpenseOrSettlement = sql<boolean>`EXISTS (
  SELECT 1 FROM trip_expenses te
  WHERE te.trip_id = ${s.trips.id}
    AND (
      te.approval_status = 'PENDING'
      OR EXISTS (
        SELECT 1
        FROM settlement_expenses se2
        INNER JOIN advance_settlements a2 ON a2.id = se2.settlement_id
        WHERE se2.trip_expense_id = te.id
          AND a2.status IN ('PENDING', 'CHECKED_BY_ACCOUNTANT')
      )
    )
)`;

export async function getForwarderTrips(
  status?: string,
  filters?: { search?: string; dateFrom?: string; dateTo?: string },
) {
  const conditions = [isNull(s.trips.deletedAt)];
  if (status) {
    conditions.push(eq(s.trips.status, status as 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | 'LOCKED' | 'CANCELED'));
  }
  if (filters?.search) {
    const term = `%${filters.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(or(
      sql`unaccent(${s.customers.name}) ILIKE unaccent(${term})`,
      sql`EXISTS (
        SELECT 1 FROM trip_containers tc
        WHERE tc.trip_id = ${s.trips.id} AND tc.container_number ILIKE ${term}
      )`,
    )!);
  }
  if (filters?.dateFrom) {
    conditions.push(gte(s.trips.departureDate, filters.dateFrom));
  }
  if (filters?.dateTo) {
    conditions.push(lte(s.trips.departureDate, filters.dateTo));
  }

  return db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    routeName: s.routes.name,
    truckPlate: s.trucks.licensePlate,
    customerName: s.customers.name,
    customerReference: s.trips.customerReference,
    containerCount: s.trips.containerCount,
    containerNumbers: sql<string | null>`(
      SELECT string_agg(tc.container_number, ', ' ORDER BY tc.id)
      FROM trip_containers tc
      WHERE tc.trip_id = ${s.trips.id}
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
      WHEN ${hasApprovedSettlement} THEN 'paid'
      WHEN ${hasPendingExpenseOrSettlement} THEN 'pending'
      ELSE 'none'
    END`,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.trips.cargoTypeId, s.cargoTypes.id))
    .where(and(...conditions))
    .orderBy(desc(s.trips.departureDate));
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

export async function getForwarderTripCounts() {
  const rows = await db.select({
    status: s.trips.status,
    count: count(),
  }).from(s.trips)
    .where(isNull(s.trips.deletedAt))
    .groupBy(s.trips.status);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.status != null) counts[row.status] = row.count;
  }
  return counts;
}

export async function getForwarderTripDetail(tripId: number, _forwarderId: number) {
  const [trip] = await db.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    status: s.trips.status,
    routeName: s.routes.name,
    truckPlate: s.trucks.licensePlate,
    customerName: s.customers.name,
    customerReference: s.trips.customerReference,
    containerCount: s.trips.containerCount,
    cargoTypeName: s.cargoTypes.name,
    notes: s.trips.notes,
  }).from(s.trips)
    .leftJoin(s.routes, eq(s.trips.routeId, s.routes.id))
    .leftJoin(s.trucks, eq(s.trips.truckId, s.trucks.id))
    .leftJoin(s.customers, eq(s.trips.customerId, s.customers.id))
    .leftJoin(s.cargoTypes, eq(s.trips.cargoTypeId, s.cargoTypes.id))
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);

  if (!trip) return null;

  const legs = await db.select().from(s.tripLegs)
    .where(eq(s.tripLegs.tripId, tripId))
    .orderBy(s.tripLegs.sequence);

  const containers = await db.select({
    id: s.tripContainers.id,
    tripId: s.tripContainers.tripId,
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
        AND aset.status <> 'REJECTED'
      ORDER BY se.id DESC
      LIMIT 1
    )`,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
    declarationNumber: s.tripExpenses.declarationNumber,
    approvalStatus: s.tripExpenses.approvalStatus,
    note: s.tripExpenses.note,
    noInvoiceEvidenceTypes: s.tripExpenses.noInvoiceEvidenceTypes,
    noInvoicePolicySnapshot: s.tripExpenses.noInvoicePolicySnapshot,
    returnForEvidenceReason: s.tripExpenses.returnForEvidenceReason,
    returnedForEvidenceAt: s.tripExpenses.returnedForEvidenceAt,
    createdAt: s.tripExpenses.createdAt,
    forwarderName: s.users.fullName,
    canEdit: sql<boolean>`${s.tripExpenses.forwarderId} = ${_forwarderId}`,
  }).from(s.tripExpenses)
    .leftJoin(s.users, eq(s.tripExpenses.forwarderId, s.users.id))
    .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
    .where(and(eq(s.tripExpenses.tripId, tripId)))
    .orderBy(desc(s.tripExpenses.createdAt));

  const instructions = await getTripInstructions(tripId);

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

  return { ...trip, legs, containers, expenses, completionScopes, completionProgress, instructions };
}
