/**
 * CUS shipment workspace — read model.
 *
 * Formatting/compute helpers, SQL fragment builders, read-model builders, and
 * the list/detail reads for the CUS workspace. Write commands live in
 * `cus-shipment-workspace-writes.service.ts`, which imports this module —
 * the dependency direction is writes → reads only, never the reverse.
 * `cus-shipment-workspace.service.ts` remains the facade importers target.
 */
import { Role, ShipmentCusBucket, ShipmentStatus, localDateInBusinessZone, type DispatchClassification, type ShipmentCusContainerQuery, type ShipmentCusWorkspaceDetail, type ShipmentCusWorkspaceListResponse, type ShipmentCusWorkspaceQuery, type ShipmentCusContainerFlatResponse, type ShipmentCusContainerFlatRow } from '@tingting/shared';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';


import { db } from '../db';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';

import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import {
  getShipmentFinanceConfirmationSummaries,
  getShipmentFinanceConfirmationSummary,
} from './shipment-accounting-lock.service';


import { CUSTOMER_DISPLAY_NAME, ROUTE_DISPLAY_NAME, CUSTOMER_OPERATIONAL_NAME, ROUTE_OPERATIONAL_NAME, SITE_OPERATIONAL_NAME, plannedCarrier, actualCarrier, billingSourceTrip, billingExpenseTrip, liftPort, containerTransportDateSql, containerDispatchRankSql, CONTAINER_DISPATCH_RANKS, CONTAINER_SORT_SQL, WORKSPACE_SORT_SQL, activeCarrierTypeSql, containerIncompleteSql, cargoRankSql } from './cus-workspace-sql.service';
import { billOrBookNumberFor, trimOrNull } from './cus-workspace-mapping.service';

export * from './cus-workspace-sql.service';
export * from './cus-workspace-mapping.service';

import { buildListItem, buildContainerLine, containerMissingFields, shipmentFieldAccess } from './cus-workspace-builders.service';

type Executor = typeof db | Tx;
export type ShipmentRow = typeof s.shipments.$inferSelect;
export type ShipmentFulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

export type ShipmentListRow = {
  shipment: ShipmentRow;
  customerName: string | null;
  routeName: string | null;
};

export type ContainerRow = {
  id: number;
  shipmentId: number;
  containerNumber: string | null;
  customerAppointmentAt: Date | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
  containerTypeId: number | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
  routeId: number | null;
  routeName: string | null;
  shippingLineName: string | null;
  operationalSiteId: number | null;
  pickupPortId: number | null;
  dropoffPortId: number | null;
};

export type DeclarationRow = {
  id: number;
  shipmentId: number;
  declarationNumber: string | null;
  issuedAt: Date | null;
  scope: 'SINGLE' | 'SHARED' | null;
  note: string | null;
};

export type LockRow = {
  id: number;
  shipmentId: number;
  billingDocumentId: number;
  activatedAt: Date;
  activatedByName: string | null;
  reason: string;
};

export type DebitNoteRow = {
  shipmentId: number;
  billingDocumentId: number;
  issuedAt: Date | null;
  debitNoteStatus: string | null;
};

export type CustodyRow = {
  shipmentId: number;
  status: string;
};

export type TripRow = {
  id: number;
  shipmentId: number | null;
  version: number;
  revenue: string | null;
  totalCost: string | null;
  revenueCombine: string | null;
};

export type BillingLineRow = {
  shipmentId: number;
  documentId: number;
  lineId: number;
  sourceType: string;
  sourceTripShipmentId: number | null;
  sourceExpenseShipmentId: number | null;
  excluded: boolean;
  grossAmount: string | null;
  baseAmount: string;
  amountOverride: string | null;
  vatTreatment: string;
};

export type RecoveryFactRow = {
  id: number;
  shipmentId: number;
  shipmentContainerId: number | null;
  version: number;
  kind: string;
  status: string;
  expectedAmount: string;
  recoveredAmount: string;
  outstandingAmount: string;
  sourceExpenseId: number | null;
  sourceVersion: string | null;
  waiverReason: string | null;
  sourceExpenseUpdatedAt: Date | null;
  sourceExpenseApprovalStatus: string | null;
  sourceExpenseSellAmount: string | null;
};

export type AssignmentRow = {
  shipmentContainerId: number | null;
  shipmentId: number | null;
  fulfillmentId: number;
  fulfillmentVersion: number;
  dispatchClassification: DispatchClassification;
  siteSnapshot: Record<string, unknown> | null;
  plannedCarrierType: string | null;
  plannedExternalCarrierId: number | null;
  plannedExternalCarrierVehicleId: number | null;
  plannedVehiclePlateNumber: string | null;
  plannedCarrierName: string | null;
  plannedCarrierShortName: string | null;
  tripId: number | null;
  tripVersion: number | null;
  tripStatus: string | null;
  tripPlannedEndAt: Date | null;
  tripCarrierType: string | null;
  tripExternalCarrierId: number | null;
  tripExternalCarrierVehicleId: number | null;
  tripExternalCarrierName: string | null;
  tripExternalCarrierShortName: string | null;
  tripExternalPlateNumber: string | null;
  tripTruckId: number | null;
  tripTruckPlate: string | null;
};

export type WorkspaceSupport = Awaited<ReturnType<typeof loadSupportRows>>;


export function normalizeCarrierName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function formatPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizePlate(value: string): string {
  return formatPlate(value).replace(/[^A-Z0-9]/g, '');
}

/**
 * Row-visibility conditions for the CUS workspace lists.
 *
 * Staff roles are never customer/shipment-scoped — every CUS user sees the
 * full lot list, so anything listed here is actionable. The customer-link
 * fallbacks below remain for any actor whose token still carries customer
 * links (portal-compat paths only).
 */
async function buildScopeConditions(actor: AuthUser): Promise<SQL[]> {
  if (
    actor.role === Role.ADMIN
    || actor.role === Role.MANAGER
    || actor.role === Role.ACCOUNTANT
    || actor.role === Role.DISPATCHER
    || actor.role === Role.CUS
  ) {
    return [];
  }
  if (actor.customerIds?.length) return [inArray(s.shipments.customerId, actor.customerIds)];
  if (actor.customerId != null) return [eq(s.shipments.customerId, actor.customerId)];
  return [];
}


function isCurrentRecoveryFact(row: RecoveryFactRow): boolean {
  if (row.sourceExpenseId == null) return true;
  if (
    row.sourceVersion == null
    || row.sourceExpenseUpdatedAt == null
    || row.sourceExpenseApprovalStatus == null
    || row.sourceExpenseSellAmount == null
  ) return false;
  return row.sourceVersion === `expense:${row.sourceExpenseUpdatedAt.toISOString()}:${row.sourceExpenseApprovalStatus}:${Number(row.sourceExpenseSellAmount)}`;
}

async function loadSupportRows(shipmentIds: number[], executor: Executor = db) {
  if (shipmentIds.length === 0) {
    return {
      containersByShipment: new Map<number, ContainerRow[]>(),
      declarationByShipment: new Map<number, DeclarationRow>(),
      locksByShipment: new Map<number, LockRow>(),
      debitNotesByShipment: new Map<number, DebitNoteRow>(),
      custodyByShipment: new Map<number, CustodyRow>(),
      tripsByShipment: new Map<number, TripRow[]>(),
      billingLinesByShipment: new Map<number, BillingLineRow[]>(),
      assignmentsByContainer: new Map<number, AssignmentRow>(),
      assignmentsByShipment: new Map<number, AssignmentRow>(),
      recoveryFactsByShipment: new Map<number, RecoveryFactRow[]>(),
      factoryNameBySiteId: new Map<number, { shortName: string; fullName: string }>(),
      portsById: new Map<number, { id: number; code: string | null; name: string }>(),
    };
  }

  const [
    containerRows,
    shipmentSiteRows,
    declarationRows,
    lockRows,
    debitNoteRows,
    custodyRows,
    tripRows,
    billingLineRows,
    assignmentRows,
    recoveryFactRows,
  ] = await Promise.all([
    executor.select({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
      containerNumber: s.shipmentContainers.containerNumber,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
      cargoWeightKg: s.shipmentContainers.cargoWeightKg,
      cargoVolumeCbm: s.shipmentContainers.cargoVolumeCbm,
      containerTypeId: s.shipmentContainers.containerTypeId,
      containerTypeCode: s.containerTypes.code,
      containerTypeName: s.containerTypes.name,
      routeId: s.shipmentContainers.routeId,
      routeName: ROUTE_OPERATIONAL_NAME,
      shippingLineName: s.shipmentContainers.shippingLineName,
      operationalSiteId: s.shipmentContainers.operationalSiteId,
      pickupPortId: s.shipmentContainers.pickupPortId,
      dropoffPortId: s.shipmentContainers.dropoffPortId,
    }).from(s.shipmentContainers)
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .leftJoin(s.routes, eq(s.routes.id, s.shipmentContainers.routeId))
      .where(inArray(s.shipmentContainers.shipmentId, shipmentIds))
      .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id)),
    executor.select({ operationalSiteId: s.shipments.operationalSiteId })
      .from(s.shipments)
      .where(inArray(s.shipments.id, shipmentIds)),
    executor.select({
      id: s.shipmentDeclarations.id,
      shipmentId: s.shipmentDeclarations.shipmentId,
      declarationNumber: s.shipmentDeclarations.declarationNumber,
      issuedAt: s.shipmentDeclarations.issuedAt,
      scope: s.shipmentDeclarations.scope,
      note: s.shipmentDeclarations.note,
      createdAt: s.shipmentDeclarations.createdAt,
    }).from(s.shipmentDeclarations)
      .where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds))
      .orderBy(asc(s.shipmentDeclarations.shipmentId), desc(s.shipmentDeclarations.createdAt)),
    executor.select({
      id: s.shipmentAccountingLocks.id,
      shipmentId: s.shipmentAccountingLocks.shipmentId,
      billingDocumentId: s.shipmentAccountingLocks.billingDocumentId,
      activatedAt: s.shipmentAccountingLocks.activatedAt,
      activatedByName: sql<string | null>`coalesce(${s.users.fullName}, ${s.users.username})`,
      reason: s.shipmentAccountingLocks.reason,
    }).from(s.shipmentAccountingLocks)
      .leftJoin(s.users, eq(s.users.id, s.shipmentAccountingLocks.activatedBy))
      .where(and(
        inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds),
        isNull(s.shipmentAccountingLocks.releasedAt),
      )),
    executor.select({
      shipmentId: s.shipments.id,
      billingDocumentId: s.billingDocuments.id,
      issuedAt: s.billingDocuments.issuedAt,
      debitNoteStatus: s.billingDocuments.debitNoteStatus,
    }).from(s.shipments)
      .innerJoin(s.trips, and(
        eq(s.trips.shipmentId, s.shipments.id),
        ne(s.trips.status, 'CANCELED'),
        isNull(s.trips.deletedAt),
      ))
      .innerJoin(s.billingDocumentTripClaims, and(
        eq(s.billingDocumentTripClaims.tripId, s.trips.id),
        isNull(s.billingDocumentTripClaims.releasedAt),
      ))
      .innerJoin(s.billingDocuments, and(
        eq(s.billingDocuments.id, s.billingDocumentTripClaims.documentId),
        eq(s.billingDocuments.entityType, 'CUSTOMER'),
        eq(s.billingDocuments.entityId, s.shipments.customerId),
        eq(s.billingDocuments.type, 'DEBIT_NOTE'),
        isNull(s.billingDocuments.deletedAt),
        sql`${s.billingDocuments.issuedAt} is not null`,
        sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') in ('SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID')`,
        eq(s.billingDocuments.authorityState, 'CURRENT'),
        sql`${s.billingDocuments.authorityWarningAt} is null`,
      ))
      .where(inArray(s.shipments.id, shipmentIds))
      .orderBy(asc(s.shipments.id), desc(s.billingDocuments.issuedAt), desc(s.billingDocuments.id)),
    executor.select({
      shipmentId: s.shipmentDocumentCustodyFacts.shipmentId,
      status: s.shipmentDocumentCustodyFacts.status,
      changedAt: s.shipmentDocumentCustodyFacts.changedAt,
    }).from(s.shipmentDocumentCustodyFacts)
      .where(inArray(s.shipmentDocumentCustodyFacts.shipmentId, shipmentIds))
      .orderBy(asc(s.shipmentDocumentCustodyFacts.shipmentId), desc(s.shipmentDocumentCustodyFacts.changedAt), desc(s.shipmentDocumentCustodyFacts.id)),
    executor.select({
      id: s.tripsComposite.id,
      shipmentId: s.tripsComposite.shipmentId,
      version: s.tripsComposite.version,
      revenue: s.tripsComposite.revenue,
      totalCost: s.tripsComposite.totalCost,
      revenueCombine: s.tripsComposite.revenueCombine,
    }).from(s.tripsComposite)
      .where(and(
        inArray(s.tripsComposite.shipmentId, shipmentIds),
        isNull(s.tripsComposite.deletedAt),
        ne(s.tripsComposite.status, 'CANCELED'),
      )),
    executor.select({
      shipmentId: s.trips.shipmentId,
      documentId: s.billingDocuments.id,
      lineId: s.billingDocumentLines.id,
      sourceType: s.billingDocumentLines.sourceType,
      sourceTripShipmentId: sql<number | null>`case
        when ${s.billingDocumentLines.sourceType} = 'TRIP' then ${billingSourceTrip.shipmentId}
        else null
      end`,
      sourceExpenseShipmentId: sql<number | null>`case
        when ${s.billingDocumentLines.sourceType} = 'EXPENSE' then ${billingExpenseTrip.shipmentId}
        else null
      end`,
      excluded: s.billingDocumentLines.excluded,
      grossAmount: s.billingDocumentLines.grossAmount,
      baseAmount: s.billingDocumentLines.baseAmount,
      amountOverride: s.billingDocumentLines.amountOverride,
      vatTreatment: s.billingDocumentLines.vatTreatment,
    }).from(s.billingDocumentTripClaims)
      .innerJoin(s.trips, and(
        eq(s.trips.id, s.billingDocumentTripClaims.tripId),
        inArray(s.trips.shipmentId, shipmentIds),
        ne(s.trips.status, 'CANCELED'),
        isNull(s.trips.deletedAt),
      ))
      .innerJoin(s.billingDocuments, and(
        eq(s.billingDocuments.id, s.billingDocumentTripClaims.documentId),
        eq(s.billingDocuments.type, 'DEBIT_NOTE'),
        isNull(s.billingDocuments.deletedAt),
        sql`${s.billingDocuments.issuedAt} is not null`,
        sql`coalesce(${s.billingDocuments.debitNoteStatus}, 'DRAFT') in ('SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID')`,
        eq(s.billingDocuments.authorityState, 'CURRENT'),
        sql`${s.billingDocuments.authorityWarningAt} is null`,
      ))
      .innerJoin(s.billingDocumentLines, eq(s.billingDocumentLines.documentId, s.billingDocuments.id))
      .leftJoin(billingSourceTrip, and(
        eq(s.billingDocumentLines.sourceType, 'TRIP'),
        eq(billingSourceTrip.id, s.billingDocumentLines.sourceId),
      ))
      .leftJoin(s.tripExpenses, and(
        eq(s.billingDocumentLines.sourceType, 'EXPENSE'),
        eq(s.tripExpenses.id, s.billingDocumentLines.sourceId),
      ))
      .leftJoin(billingExpenseTrip, eq(billingExpenseTrip.id, s.tripExpenses.tripId))
      .where(isNull(s.billingDocumentTripClaims.releasedAt)),
    executor.select({
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      shipmentId: s.shipmentFulfillments.shipmentId,
      fulfillmentId: s.shipmentFulfillments.id,
      fulfillmentVersion: s.shipmentFulfillments.version,
      dispatchClassification: s.shipmentFulfillments.dispatchClassification,
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      plannedExternalCarrierVehicleId: s.shipmentFulfillments.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
      plannedCarrierName: plannedCarrier.name,
      plannedCarrierShortName: plannedCarrier.shortName,
      tripId: s.trips.id,
      tripVersion: s.trips.version,
      tripStatus: s.trips.status,
      tripPlannedEndAt: s.trips.plannedEndAt,
      tripCarrierType: s.tripCarrierInfo.carrierType,
      tripExternalCarrierId: s.tripCarrierInfo.externalEntityId,
      tripExternalCarrierVehicleId: s.tripCarrierInfo.externalCarrierVehicleId,
      tripExternalCarrierName: actualCarrier.name,
      tripExternalCarrierShortName: actualCarrier.shortName,
      tripExternalPlateNumber: s.tripCarrierInfo.externalPlateNumber,
      tripTruckId: s.trips.truckId,
      tripTruckPlate: s.trucks.licensePlate,
    }).from(s.shipmentFulfillments)
      .leftJoin(plannedCarrier, eq(plannedCarrier.id, s.shipmentFulfillments.plannedExternalCarrierId))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, 'CANCELED'),
      ))
      .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
      .leftJoin(actualCarrier, eq(actualCarrier.id, s.tripCarrierInfo.externalEntityId))
      .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
        isNull(s.shipmentFulfillments.canceledAt),
      )),
    executor.select({
      id: s.shipmentRecoveryFacts.id,
      shipmentId: s.shipmentRecoveryFacts.shipmentId,
      shipmentContainerId: s.shipmentRecoveryFacts.shipmentContainerId,
      version: s.shipmentRecoveryFacts.version,
      kind: s.shipmentRecoveryFacts.kind,
      status: s.shipmentRecoveryFacts.status,
      expectedAmount: s.shipmentRecoveryFacts.expectedAmount,
      recoveredAmount: s.shipmentRecoveryFacts.recoveredAmount,
      outstandingAmount: s.shipmentRecoveryFacts.outstandingAmount,
      sourceExpenseId: s.shipmentRecoveryFacts.sourceExpenseId,
      sourceVersion: s.shipmentRecoveryFacts.sourceVersion,
      waiverReason: s.shipmentRecoveryFacts.waiverReason,
      sourceExpenseUpdatedAt: s.tripExpenses.updatedAt,
      sourceExpenseApprovalStatus: s.tripExpenses.approvalStatus,
      sourceExpenseSellAmount: s.tripExpenses.sellAmount,
    }).from(s.shipmentRecoveryFacts)
      .leftJoin(s.tripExpenses, eq(s.tripExpenses.id, s.shipmentRecoveryFacts.sourceExpenseId))
      .where(inArray(s.shipmentRecoveryFacts.shipmentId, shipmentIds)),
  ]);

  const containersByShipment = new Map<number, ContainerRow[]>();
  for (const row of containerRows) {
    const bucket = containersByShipment.get(row.shipmentId) ?? [];
    bucket.push(row);
    containersByShipment.set(row.shipmentId, bucket);
  }

  const declarationByShipment = new Map<number, DeclarationRow>();
  for (const row of declarationRows) {
    if (!declarationByShipment.has(row.shipmentId) && trimOrNull(row.declarationNumber)) {
      declarationByShipment.set(row.shipmentId, row as DeclarationRow);
    }
  }

  const locksByShipment = new Map<number, LockRow>();
  for (const row of lockRows) locksByShipment.set(row.shipmentId, row);

  const debitNotesByShipment = new Map<number, DebitNoteRow>();
  for (const row of debitNoteRows) {
    if (!debitNotesByShipment.has(row.shipmentId)) debitNotesByShipment.set(row.shipmentId, row);
  }

  const custodyByShipment = new Map<number, CustodyRow>();
  for (const row of custodyRows) {
    if (!custodyByShipment.has(row.shipmentId)) custodyByShipment.set(row.shipmentId, row as CustodyRow);
  }

  const tripsByShipment = new Map<number, TripRow[]>();
  for (const row of tripRows) {
    if (row.shipmentId == null) continue;
    const bucket = tripsByShipment.get(row.shipmentId) ?? [];
    bucket.push(row);
    tripsByShipment.set(row.shipmentId, bucket);
  }

  const billingLinesByShipment = new Map<number, BillingLineRow[]>();
  const seenBillingLineKeys = new Set<string>();
  for (const row of billingLineRows) {
    if (row.shipmentId == null) continue;
    const key = `${row.shipmentId}:${row.lineId}`;
    if (seenBillingLineKeys.has(key)) continue;
    seenBillingLineKeys.add(key);
    const bucket = billingLinesByShipment.get(row.shipmentId) ?? [];
    bucket.push(row as BillingLineRow);
    billingLinesByShipment.set(row.shipmentId, bucket);
  }

  const assignmentsByContainer = new Map<number, AssignmentRow>();
  // Lot-level (LCL) allocations ride fulfillments with no container row —
  // keyed by shipment so lot-level readiness and carrier chips can read the
  // allocation without any container line existing.
  const assignmentsByShipment = new Map<number, AssignmentRow>();
  for (const row of assignmentRows) {
    if (row.shipmentContainerId == null) {
      if (row.shipmentId == null || assignmentsByShipment.has(row.shipmentId)) continue;
      assignmentsByShipment.set(row.shipmentId, row as AssignmentRow);
      continue;
    }
    if (assignmentsByContainer.has(row.shipmentContainerId)) continue;
    assignmentsByContainer.set(row.shipmentContainerId, row as AssignmentRow);
  }

  // Effective-factory labels for per-container authority + shipment fallback:
  // short name preferred, unique by site id (one lookup for the whole page).
  const factoryNameBySiteId = new Map<number, { shortName: string; fullName: string }>();
  {
    const siteIds = new Set<number>();
    for (const container of containerRows) {
      if (container.operationalSiteId != null) siteIds.add(container.operationalSiteId);
    }
    for (const shipment of shipmentSiteRows) {
      if (shipment.operationalSiteId != null) siteIds.add(shipment.operationalSiteId);
    }
    if (siteIds.size > 0) {
      const siteRows = await executor.select({
        id: s.operationalSites.id,
        shortName: sql<string>`coalesce(nullif(btrim(${s.operationalSites.shortName}), ''), ${s.operationalSites.name})`,
        fullName: s.operationalSites.name,
      }).from(s.operationalSites)
        .where(inArray(s.operationalSites.id, [...siteIds]));
      for (const siteRow of siteRows) {
        factoryNameBySiteId.set(siteRow.id, { shortName: siteRow.shortName, fullName: siteRow.fullName });
      }
    }
  }

  const recoveryFactsByShipment = new Map<number, RecoveryFactRow[]>();
  for (const row of recoveryFactRows) {
    if (!isCurrentRecoveryFact(row as RecoveryFactRow)) continue;
    const byShipment = recoveryFactsByShipment.get(row.shipmentId) ?? [];
    byShipment.push(row as RecoveryFactRow);
    recoveryFactsByShipment.set(row.shipmentId, byShipment);
  }

  // Port labels for per-container lift/drop display (single lookup per page).
  const portsById = new Map<number, { id: number; code: string | null; name: string }>();
  {
    const portIds = new Set<number>();
    for (const container of containerRows) {
      if (container.pickupPortId != null) portIds.add(container.pickupPortId);
      if (container.dropoffPortId != null) portIds.add(container.dropoffPortId);
    }
    if (portIds.size > 0) {
      const portRows = await executor.select({
        id: s.ports.id,
        code: s.ports.code,
        name: s.ports.name,
      }).from(s.ports)
        .where(inArray(s.ports.id, [...portIds]));
      for (const portRow of portRows) {
        portsById.set(portRow.id, portRow);
      }
    }
  }

  return {
    containersByShipment,
    declarationByShipment,
    locksByShipment,
    debitNotesByShipment,
    custodyByShipment,
    tripsByShipment,
    billingLinesByShipment,
    assignmentsByContainer,
    assignmentsByShipment,
    recoveryFactsByShipment,
    factoryNameBySiteId,
    portsById,
  };
}

/** customerId null = ad-hoc order (Lệnh chạy ngoài): no customer-scoped
 *  factories exist for the edit form — the other catalogs still load. */
async function loadSelectors(customerId: number | null, executor: Executor = db) {
  const [routes, containerTypes, operationalSites, externalCarriers, carrierVehicles, ports] = await Promise.all([
    executor.select({
      id: s.routes.id,
      name: ROUTE_OPERATIONAL_NAME,
    }).from(s.routes)
      .where(isNull(s.routes.deletedAt))
      .orderBy(asc(ROUTE_OPERATIONAL_NAME), asc(s.routes.id)),
    executor.select({
      id: s.containerTypes.id,
      code: s.containerTypes.code,
      name: s.containerTypes.name,
    }).from(s.containerTypes)
      .where(isNull(s.containerTypes.deletedAt))
      .orderBy(asc(s.containerTypes.name), asc(s.containerTypes.id)),
    executor.select({
      id: s.operationalSites.id,
      siteType: s.operationalSites.siteType,
      code: s.operationalSites.code,
      name: SITE_OPERATIONAL_NAME,
    }).from(s.operationalSites)
      .where(and(
        ...(customerId != null ? [eq(s.operationalSites.customerId, customerId)] : []),
        eq(s.operationalSites.siteType, 'FACTORY'),
        eq(s.operationalSites.isActive, true),
        isNull(s.operationalSites.deletedAt),
      ))
      .orderBy(asc(SITE_OPERATIONAL_NAME), asc(s.operationalSites.id)),
    executor.select({
      id: s.customers.id,
      name: s.customers.name,
      shortName: s.customers.shortName,
    }).from(s.customers)
      .where(and(
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .orderBy(asc(CUSTOMER_OPERATIONAL_NAME), asc(s.customers.id)),
    executor.select({
      id: s.carrierFleetVehicles.id,
      carrierId: s.carrierFleetVehicles.carrierId,
      licensePlate: s.carrierFleetVehicles.licensePlate,
    }).from(s.carrierFleetVehicles)
      .where(and(
        eq(s.carrierFleetVehicles.isActive, true),
        isNull(s.carrierFleetVehicles.deletedAt),
      ))
      .orderBy(asc(s.carrierFleetVehicles.licensePlate), asc(s.carrierFleetVehicles.id)),
    // Master-data Cảng/Bãi for the lift/drop editors — the create form picks
    // these same rows for its per-container port fields.
    executor.select({
      id: s.ports.id,
      code: s.ports.code,
      name: s.ports.name,
    }).from(s.ports)
      .where(isNull(s.ports.deletedAt))
      .orderBy(asc(s.ports.name), asc(s.ports.id)),
  ]);

  return {
    routes: routes.map((row) => ({ ...row, label: row.name })),
    containerTypes: containerTypes.map((row) => ({
      ...row,
      label: `${row.code} - ${row.name}`,
    })),
    operationalSites: operationalSites.map((row) => ({
      ...row,
      siteType: row.siteType as 'FACTORY' | 'WAREHOUSE',
      label: `${row.code} - ${row.name}`,
    })),
    externalCarriers: externalCarriers.map((row) => ({
      ...row,
      label: row.shortName?.trim() || row.name,
    })),
    carrierVehicles: carrierVehicles.map((row) => ({
      ...row,
      label: row.licensePlate,
    })),
    ports: ports.map((row) => ({
      ...row,
      label: row.name,
    })),
  };
}

export async function loadShipmentRow(
  shipmentId: number,
  actor: AuthUser,
  executor: Executor = db,
) {
  const [row] = await executor.select({
    shipment: s.shipments,
    customerName: CUSTOMER_DISPLAY_NAME,
    routeName: ROUTE_DISPLAY_NAME,
  }).from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
    .where(and(
      eq(s.shipments.id, shipmentId),
      isNull(s.shipments.deletedAt),
      ne(s.shipments.status, ShipmentStatus.CANCELED),
      ...(await buildScopeConditions(actor)),
    ))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy lô hàng CUS.');
  return row;
}

export async function buildWorkspaceDetail(
  row: ShipmentListRow,
  actor: AuthUser,
  executor: Executor = db,
): Promise<ShipmentCusWorkspaceDetail> {
  const support = await loadSupportRows([row.shipment.id], executor);
  const confirmation = await getShipmentFinanceConfirmationSummary(row.shipment.id, executor as Tx);
  const summary = buildListItem(row, support, actor, confirmation);
  const selectors = await loadSelectors(row.shipment.customerId, executor);
  const containers = (support.containersByShipment.get(row.shipment.id) ?? [])
    .map((container, index) => buildContainerLine(row, actor, support, container, index + 1));
  return {
    summary,
    containers,
    selectors,
    dataState: {
      hasExplicitDocumentCustody: summary.documentCustody.available,
    },
  };
}

async function buildShipmentPageConditions(
  query: ShipmentCusWorkspaceQuery | ShipmentCusContainerQuery,
  actor: AuthUser,
  searchMode: 'shipment' | 'container',
) {
  const activeLockExists = sql`exists (
    select 1
    from ${s.shipmentAccountingLocks}
    where ${s.shipmentAccountingLocks.shipmentId} = ${s.shipments.id}
      and ${s.shipmentAccountingLocks.releasedAt} is null
  )`;
  const conditions = [
    isNull(s.shipments.deletedAt),
    ne(s.shipments.status, ShipmentStatus.CANCELED),
    ...(await buildScopeConditions(actor)),
  ];
  const transportDate = searchMode === 'container'
    ? containerTransportDateSql()
    : s.shipments.expectedDeliveryDate;
  if (searchMode === 'container') {
    if (query.transportDateFrom) {
      conditions.push(sql`${transportDate} >= ${query.transportDateFrom}`);
    }
    if (query.transportDateTo) {
      conditions.push(sql`${transportDate} <= ${query.transportDateTo}`);
    }
  } else if (query.transportDateFrom || query.transportDateTo) {
    // Shipment-level: also consider container appointment dates so allocated
    // shipments (whose containers may have been reappointed to a different
    // day than the shipment's EDD) still appear under the user's chosen day.
    // containerTransportDateSql() is interpolated verbatim so the
    // appointment-date contract stays single-sourced with container mode.
    const dateFrom = query.transportDateFrom ?? '0001-01-01';
    const dateTo = query.transportDateTo ?? '9999-12-31';
    conditions.push(or(
      and(
        gte(s.shipments.expectedDeliveryDate, dateFrom),
        lte(s.shipments.expectedDeliveryDate, dateTo),
      ),
      sql`exists (
        select 1 from ${s.shipmentContainers}
        where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
          and ${containerTransportDateSql()} between ${dateFrom} and ${dateTo}
      )`,
    )!);
  }
  if (query.customerId) {
    conditions.push(eq(s.shipments.customerId, query.customerId));
  }
  // 20260917_12: the ad-hoc list filter — 'true'/'false' narrows to lệnh
  // chạy ngoài / catalog-flow rows; absent means no filtering.
  if (query.isAdHoc !== undefined) {
    conditions.push(eq(s.shipments.isAdHoc, query.isAdHoc === 'true'));
  }
  if (query.direction) {
    conditions.push(eq(s.shipments.tradeDirection, query.direction));
  }
  if (query.searchSuffix) {
    const suffix = `%${query.searchSuffix.trim().replace(/[\\%_]/g, '\\$&')}`;
    conditions.push(or(
      sql`btrim(${s.shipments.blNumber}) ilike ${suffix}`,
      sql`btrim(${s.shipments.bookingRef}) ilike ${suffix}`,
      searchMode === 'container'
        ? sql`btrim(${s.shipmentContainers.containerNumber}) ilike ${suffix}`
        : sql`exists (
            select 1
            from ${s.shipmentContainers}
            where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
              and btrim(${s.shipmentContainers.containerNumber}) ilike ${suffix}
          )`,
      sql`exists (
        select 1
        from ${s.shipmentDeclarations}
        where ${s.shipmentDeclarations.shipmentId} = ${s.shipments.id}
          and btrim(${s.shipmentDeclarations.declarationNumber}) ilike ${suffix}
      )`,
    )!);
  }
  if (query.bucket === ShipmentCusBucket.LOCKED) {
    // Mirrors deriveCusBucket: an active lock is LOCKED, and so is a
    // driver full-closed (COMPLETED) shipment no one has locked yet —
    // otherwise the badge says "Đã khóa" while only the "Chờ khóa" tab
    // can retrieve the row.
    conditions.push(or(
      activeLockExists,
      eq(s.shipments.status, ShipmentStatus.COMPLETED),
    )!);
  } else if (query.bucket === ShipmentCusBucket.RUNNING) {
    conditions.push(sql`not ${activeLockExists}`);
    conditions.push(inArray(s.shipments.status, [
      ShipmentStatus.DISPATCHED,
      ShipmentStatus.IN_TRANSIT,
    ]));
  } else if (query.bucket === ShipmentCusBucket.PENDING_LOCK) {
    // Driver full-close lands on COMPLETED (LOCKED bucket); the unlocked
    // "Chờ khóa" tab was only for the partial-close PENDING_EXPENSE_APPROVAL
    // state (retired 2026-09-05) and the disabled accountant flow's advances.
    // No live status feeds it now; the bucket stays in the vocabulary until
    // the close-readiness redesign repurposes or removes the tab.
    conditions.push(sql`not ${activeLockExists}`);
    conditions.push(sql`false`);
  } else if (query.bucket === ShipmentCusBucket.NEW) {
    conditions.push(sql`not ${activeLockExists}`);
    conditions.push(sql`${s.shipments.status} not in (${ShipmentStatus.DISPATCHED}, ${ShipmentStatus.IN_TRANSIT}, ${ShipmentStatus.COMPLETED})`);
  }
  // Detail-only completeness triage: real FCL container rows whose applicable
  // operational fields are not yet filled. LCL lots are explicitly excluded —
  // they never appear on this container workboard.
  if (searchMode === 'container' && 'informationStatus' in query && query.informationStatus === 'MISSING') {
    conditions.push(eq(s.shipments.cargoMode, 'FCL'));
    conditions.push(containerIncompleteSql());
  }
  // Detail-only dispatch triage: ASSIGNED = the container line has a planned
  // carrier (the same planned-only identity the rows display); UNASSIGNED is
  // its legacy carrier-absence complement. Both predate the four-state badge
  // vocabulary and stay in the query schema so older links keep filtering.
  // The badge values filter on the derivation itself (the same rank expression that
  // orders the Trạng thái column); AWAITING_VEHICLE is the coalesced rank-0
  // complement — no trip, or a CREATED trip whose ngày đóng/trả exists.
  if (searchMode === 'container' && 'dispatchStatus' in query) {
    if (query.dispatchStatus === 'ASSIGNED') conditions.push(sql`${activeCarrierTypeSql()} is not null`);
    else if (query.dispatchStatus === 'UNASSIGNED') conditions.push(sql`${activeCarrierTypeSql()} is null`);
    else if (query.dispatchStatus === 'AWAITING_VEHICLE') conditions.push(sql`coalesce(${containerDispatchRankSql()}, 0) = 0`);
    else if (query.dispatchStatus) {
      conditions.push(sql`${containerDispatchRankSql()} = ${CONTAINER_DISPATCH_RANKS[query.dispatchStatus]}`);
    }
  }

  return conditions;
}

async function loadShipmentPage(query: ShipmentCusWorkspaceQuery, actor: AuthUser) {
  const conditions = await buildShipmentPageConditions(query, actor, 'shipment');

  const offset = (query.page - 1) * query.limit;
  // Explicit `nulls last` keeps empty cells at the bottom in both directions.
  // Cargo rank stays as a secondary key so sorting never scrambles the
  // operational priority queue it shares a page with.
  const sortOrder = query.sortBy
    ? [
        sql`${WORKSPACE_SORT_SQL[query.sortBy]} ${query.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        sql`${cargoRankSql()} asc`,
        sql`${s.shipments.id} desc`,
      ]
    : [
        // Operational priority queue before pagination: unscheduled first, then
        // queue-date descending (intake date for unscheduled, expected delivery
        // date otherwise), then cargo rank (Cont 20 → Cont 40 → other Cont →
        // Lẻ → unknown), with createdAt/id as stable final tie-breakers.
        sql`case when ${s.shipments.expectedDeliveryDate} is null then 0 else 1 end`,
        sql`coalesce(${s.shipments.expectedDeliveryDate}, ${s.shipments.createdAt}) desc`,
        cargoRankSql(),
        desc(s.shipments.createdAt),
        desc(s.shipments.id),
      ];
  const [items, totalRows] = await Promise.all([
    db.select({
      shipment: s.shipments,
      customerName: CUSTOMER_OPERATIONAL_NAME,
      routeName: ROUTE_OPERATIONAL_NAME,
    }).from(s.shipments)
      .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
      .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
      .where(and(...conditions))
      .orderBy(...sortOrder)
      .limit(query.limit)
      .offset(offset),
    db.select({ value: count() }).from(s.shipments)
      .where(and(...conditions)),
  ]);

  return {
    items,
    total: Number(totalRows[0]?.value ?? 0),
  };
}

async function loadActorScopedCustomerOptions(actor: AuthUser, executor: Executor = db) {
  const conditions = [
    isNull(s.shipments.deletedAt),
    ne(s.shipments.status, ShipmentStatus.CANCELED),
    isNull(s.customers.deletedAt),
    ...(await buildScopeConditions(actor)),
  ];
  return executor.selectDistinct({
    id: s.customers.id,
    name: CUSTOMER_OPERATIONAL_NAME,
  }).from(s.shipments)
    .innerJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .where(and(...conditions))
    .orderBy(asc(CUSTOMER_OPERATIONAL_NAME), asc(s.customers.id));
}

export async function listCusShipmentWorkspace(
  query: ShipmentCusWorkspaceQuery,
  actor: AuthUser,
): Promise<ShipmentCusWorkspaceListResponse> {
  const { items, total } = await loadShipmentPage(query, actor);
  const support = await loadSupportRows(items.map((row) => row.shipment.id));
  const confirmations = await getShipmentFinanceConfirmationSummaries(
    items.map((row) => row.shipment.id),
  );
  const dateRange = (query.transportDateFrom || query.transportDateTo)
    ? { dateFrom: query.transportDateFrom, dateTo: query.transportDateTo }
    : undefined;
  const projectedItems = items.map((row) => buildListItem(
    row,
    support,
    actor,
    confirmations.get(row.shipment.id)!,
    dateRange,
  ));
  const needsSchedule = projectedItems.filter((item) => item.operational.scheduleReadiness === 'WAITING_DATE').length;
  const needsVehicle = projectedItems.filter((item) => (
    item.operational.vehicleReadiness === 'WAITING_CARRIER'
    || item.operational.vehicleReadiness === 'WAITING_PLATE'
  )).length;
  const waitingAccounting = projectedItems.filter((item) => (
    item.activeLock == null
    && (item.accountingConfirmation.status === 'PENDING' || item.accountingConfirmation.status === 'STALE')
  )).length;
  const readyToLock = projectedItems.filter((item) => item.action.kind === 'LOCK' && item.action.enabled).length;
  const needsAttention = projectedItems.filter((item) => (
    item.operational.scheduleReadiness !== 'SCHEDULED'
    || item.operational.vehicleReadiness === 'WAITING_CARRIER'
    || item.operational.vehicleReadiness === 'WAITING_PLATE'
    || item.finance.isLoss === true
    || item.finance.hasPendingRecovery
    || item.accountingConfirmation.status === 'UNAVAILABLE'
    || item.accountingConfirmation.status === 'STALE'
  )).length;

  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    pageSummary: { needsSchedule, needsVehicle, waitingAccounting, readyToLock, needsAttention },
    items: projectedItems,
  };
}

export async function getCusShipmentWorkspaceDetail(
  shipmentId: number,
  actor: AuthUser,
): Promise<ShipmentCusWorkspaceDetail> {
  const row = await loadShipmentRow(shipmentId, actor);
  return buildWorkspaceDetail(row, actor);
}

/**
 * Container-flat projection across all in-scope shipments: one row per
 * container, carrying shipment context (customer, factory, bill/booking)
 * plus the per-container operational fields. Pagination counts shipments via
 * loadShipmentPage's filters, then flattens each shipment's containers. The
 * projection carries only the scheduling permission needed to decide whether
 * to offer inline editing; current selectors and versions stay authoritative
 * in the lazily-loaded workspace detail.
 */
export async function listCusShipmentContainers(
  query: ShipmentCusContainerQuery,
  actor: AuthUser,
): Promise<ShipmentCusContainerFlatResponse> {
  const conditions = await buildShipmentPageConditions(query, actor, 'container');
  const offset = (query.page - 1) * query.limit;
  // Explicit `nulls last` keeps empty cells at the bottom in both directions
  // (Postgres would otherwise float NULLs first on desc). Cargo rank + id stay
  // as secondary keys so one shipment's containers still cluster in place.
  const sortOrder = query.sortBy
    ? [
        sql`${CONTAINER_SORT_SQL[query.sortBy]} ${query.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
        sql`${cargoRankSql()} asc`,
        sql`${s.shipmentContainers.id} asc`,
      ]
    : [
        asc(sql`case when ${containerTransportDateSql()} is null then 0 else 1 end`),
        sql`coalesce(${containerTransportDateSql()}, ${s.shipments.createdAt}) desc`,
        cargoRankSql(),
        desc(s.shipments.createdAt),
        asc(s.shipmentContainers.id),
      ];
  // Page rows, total count, and customer options run in one read-only
  // REPEATABLE READ transaction so all three see the same snapshot — a
  // container deleted between the page query and the support load can no
  // longer produce a silently dropped row (`if (!container) continue`).
  const [selectedContainers, totalRows, customerOptions] = await db.transaction(async (tx) => {
    const [containers, totals, options] = await Promise.all([
      tx.select({
        shipment: s.shipments,
        customerName: CUSTOMER_DISPLAY_NAME,
        routeName: ROUTE_DISPLAY_NAME,
        containerId: s.shipmentContainers.id,
      }).from(s.shipmentContainers)
        .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
        .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
        .leftJoin(s.routes, eq(s.routes.id, sql<number>`coalesce(${s.shipmentContainers.routeId}, ${s.shipments.routeId})`))
        .leftJoin(liftPort, eq(liftPort.id, s.shipmentContainers.pickupPortId))
        .where(and(...conditions))
        .orderBy(...sortOrder)
        .limit(query.limit)
        .offset(offset),
      tx.select({ value: count() }).from(s.shipmentContainers)
        .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentContainers.shipmentId))
        .where(and(...conditions)),
      loadActorScopedCustomerOptions(actor, tx),
    ]);
    return [containers, totals, options] as const;
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  const total = Number(totalRows[0]?.value ?? 0);
  const shipmentIds = [...new Set(selectedContainers.map((row) => row.shipment.id))];
  const support = await loadSupportRows(shipmentIds);
  const flatRows: ShipmentCusContainerFlatRow[] = [];
  for (const selected of selectedContainers) {
    const row: ShipmentListRow = selected;
    const containers = support.containersByShipment.get(row.shipment.id) ?? [];
    const containerIndex = containers.findIndex((container) => container.id === selected.containerId);
    const container = containers[containerIndex];
    if (!container) continue;
    const line = buildContainerLine(row, actor, support, container, containerIndex + 1);
    const shipmentEditable = actor.role === Role.CUS
      && support.locksByShipment.get(row.shipment.id) == null;
    const missingFields = containerMissingFields(
      row,
      support,
      container,
      support.assignmentsByContainer.get(container.id) ?? null,
    );
    // Container-level factory takes precedence over shipment-level (SILVER L1).
    // Resolved as locals — the same shape cus-workspace-builders uses — because
    // nesting both lookups inline made the compiler read the whole chain as
    // always nullish.
    const containerFactoryName = container.operationalSiteId != null
      ? support.factoryNameBySiteId.get(container.operationalSiteId)?.shortName ?? null
      : null;
    const shipmentFactoryName = row.shipment.operationalSiteId != null
      ? support.factoryNameBySiteId.get(row.shipment.operationalSiteId)?.shortName ?? null
      : null;
    flatRows.push({
      id: line.id,
      shipmentId: row.shipment.id,
      shipmentVersion: row.shipment.version,
      ordinal: line.ordinal,
      customerId: row.shipment.customerId,
      isAdHoc: row.shipment.isAdHoc,
      customerName: row.customerName,
      factoryName: containerFactoryName ?? shipmentFactoryName ?? trimOrNull(row.shipment.factoryName),
      routeName: line.routeName,
      billOrBookNumber: billOrBookNumberFor(row.shipment.tradeDirection, row.shipment.blNumber, row.shipment.bookingRef),
      declarationNumber: support.declarationByShipment.get(row.shipment.id)?.declarationNumber ?? null,
      shippingLineName: trimOrNull(row.shipment.shippingLineName) ?? trimOrNull(container.shippingLineName),
      isCombined: row.shipment.isCombined,
      classification: support.assignmentsByContainer.get(container.id)?.dispatchClassification
        ?? (row.shipment.cargoMode === CARGO_MODE.LCL ? 'LCL' : (row.shipment.isCombined ? 'COMBINED' : 'SINGLE')),
      direction: row.shipment.tradeDirection as 'IMPORT' | 'EXPORT' | null,
      containerNumber: line.containerNumber,
      containerTypeLabel: line.containerTypeLabel,
      dispatchStatus: line.dispatchStatus,
      carrierName: line.carrierName,
      plateNumber: line.plateNumber,
      liftSite: line.liftSite,
      dropoffSite: line.dropoffSite,
      transportDate: row.shipment.cargoMode === CARGO_MODE.FCL
        ? (container.customerAppointmentAt ? localDateInBusinessZone(container.customerAppointmentAt) : null)
        : row.shipment.expectedDeliveryDate,
      closingAt: row.shipment.closingAt?.toISOString() ?? null,
      plannedReturnAt: row.shipment.plannedReturnAt?.toISOString() ?? null,
      customerAppointmentAt: line.customerAppointmentAt,
      customerNotes: trimOrNull(row.shipment.customerNotes),
      operationalNotes: trimOrNull(row.shipment.operationalNotes),
      raw: line.raw,
      fieldAccess: {
        operationalSiteId: line.fieldAccess.operationalSiteId,
        containerNumber: line.fieldAccess.containerNumber,
        containerTypeId: line.fieldAccess.containerTypeId,
        cargoWeightKg: line.fieldAccess.cargoWeightKg,
        cargoVolumeCbm: line.fieldAccess.cargoVolumeCbm,
        routeId: line.fieldAccess.routeId,
        liftSiteId: line.fieldAccess.liftSiteId,
        dropoffSiteId: line.fieldAccess.dropoffSiteId,
      },
      shipmentFieldAccess: shipmentFieldAccess(
        row.shipment,
        actor,
        support.locksByShipment.get(row.shipment.id) != null,
        containers.length > 0,
      ),
      informationStatus: missingFields.length > 0 ? 'MISSING' : 'COMPLETE',
      missingFields,
      shipmentScheduleEditable: shipmentEditable,
      shipmentNotesEditable: shipmentEditable,
      carrierEditable: line.permissions.carrierEditable,
      plateEditable: line.permissions.plateEditable,
      liftSiteEditable: line.permissions.liftSiteEditable,
      dropoffSiteEditable: line.permissions.dropoffSiteEditable,
      routeEditable: line.permissions.routeEditable,
      customerAppointmentEditable: line.permissions.customerAppointmentEditable,
      scheduleEditable: line.permissions.liftSiteEditable
        || line.permissions.dropoffSiteEditable
        || line.permissions.customerAppointmentEditable,
    });
  }
  return {
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    filterOptions: { customers: customerOptions },
    items: flatRows,
  };
}
