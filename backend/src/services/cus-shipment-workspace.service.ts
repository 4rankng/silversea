import {
  Role,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  ShipmentStatus,
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  canonicalShipmentStatus,
  type ShipmentCusContainerLineUpdateInput,
  type ShipmentCusContainerLineUpdateResult,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceListResponse,
  type ShipmentCusWorkspacePassThroughCharge,
  type ShipmentCusWorkspaceQuery,
} from '@tingting/shared';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { ensureShipmentFulfillmentsInTx } from './shipment-fulfillment.service';
import {
  assertShipmentAccountingUnlocked,
  getShipmentFinanceConfirmationSummaries,
  getShipmentFinanceConfirmationSummary,
} from './shipment-accounting-lock.service';

type Executor = typeof db | Tx;
type ShipmentRow = typeof s.shipments.$inferSelect;
type ShipmentFulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

type ShipmentListRow = {
  shipment: ShipmentRow;
  customerName: string | null;
  routeName: string | null;
};

type ContainerRow = {
  id: number;
  shipmentId: number;
  containerNumber: string | null;
  shippingLineName: string | null;
  cargoWeightKg: string | null;
  containerTypeId: number | null;
  containerTypeCode: string | null;
  containerTypeName: string | null;
};

type LockRow = {
  id: number;
  shipmentId: number;
  billingDocumentId: number;
  activatedAt: Date;
  activatedByName: string | null;
  reason: string;
};

type DebitNoteRow = {
  shipmentId: number;
  billingDocumentId: number;
  issuedAt: Date | null;
  debitNoteStatus: string | null;
};

type CustodyRow = {
  shipmentId: number;
  status: string;
};

type TripRow = {
  id: number;
  shipmentId: number | null;
  version: number;
  revenue: string | null;
  totalCost: string | null;
  revenueCombine: string | null;
};

type BillingLineRow = {
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

type ExpenseRow = {
  id: number;
  shipmentId: number | null;
  sourceShipmentContainerId: number | null;
  expenseType: string;
  sellAmount: string;
  invoiceNumber: string | null;
  supplierName: string | null;
};

type ChargeFactRow = {
  shipmentContainerId: number;
  version: number;
  outboundTransportAmount: string | null;
  outboundHandlingAmount: string | null;
  outboundIncidentalAmount: string | null;
  inboundTransportAmount: string | null;
  inboundHandlingAmount: string | null;
};

type RecoveryFactRow = {
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

type AssignmentRow = {
  shipmentContainerId: number | null;
  fulfillmentId: number;
  fulfillmentVersion: number;
  siteSnapshot: Record<string, unknown> | null;
  plannedCarrierType: string | null;
  plannedExternalCarrierId: number | null;
  plannedExternalCarrierVehicleId: number | null;
  plannedVehiclePlateNumber: string | null;
  plannedCarrierName: string | null;
  tripId: number | null;
  tripVersion: number | null;
  tripStatus: string | null;
  tripPlannedEndAt: Date | null;
  tripCarrierType: string | null;
  tripExternalCarrierId: number | null;
  tripExternalCarrierVehicleId: number | null;
  tripExternalCarrierName: string | null;
  tripExternalPlateNumber: string | null;
  tripTruckId: number | null;
  tripTruckPlate: string | null;
};

type WorkspaceSupport = Awaited<ReturnType<typeof loadSupportRows>>;
const plannedCarrier = alias(s.customers, 'cus_workspace_planned_carrier');
const actualCarrier = alias(s.customers, 'cus_workspace_actual_carrier');
const billingSourceTrip = alias(s.trips, 'cus_workspace_billing_source_trip');
const billingExpenseTrip = alias(s.trips, 'cus_workspace_billing_expense_trip');

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const next = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(next) ? next : 0;
}

function toMoneyString(value: number): string {
  return Math.round(value).toString();
}

function sumMoney(values: Array<string | number | null | undefined>): string {
  return toMoneyString(values.reduce<number>((sum, value) => sum + toNumber(value), 0));
}

function sumIfAny(values: Array<string | number | null | undefined>): string | null {
  const present = values.filter((value) => value != null && String(value).trim() !== '');
  return present.length === 0 ? null : sumMoney(present);
}

function businessDateNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildOperationalSummary(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  bucket: ShipmentCusBucket,
  actor: AuthUser,
): ShipmentCusWorkspaceListItem['operational'] {
  const containers = support.containersByShipment.get(row.shipment.id) ?? [];
  let assignedContainers = 0;
  let externalContainers = 0;
  let plateAssignedContainers = 0;
  let missingCarrierContainers = 0;
  let missingPlateContainers = 0;

  for (const container of containers) {
    const assignment = support.assignmentsByContainer.get(container.id) ?? null;
    const carrierType = assignment?.tripCarrierType ?? assignment?.plannedCarrierType ?? null;
    const plateNumber = carrierType === 'OWN'
      ? assignment?.tripTruckPlate ?? null
      : assignment?.tripExternalPlateNumber ?? assignment?.plannedVehiclePlateNumber ?? null;
    if (carrierType == null) {
      missingCarrierContainers += 1;
      continue;
    }
    const hasAssignedVehicle = carrierType === 'EXTERNAL'
      ? assignment?.plannedExternalCarrierId != null || assignment?.tripExternalCarrierId != null
      : assignment?.tripTruckId != null;
    if (hasAssignedVehicle) assignedContainers += 1;
    if (carrierType === 'EXTERNAL') {
      externalContainers += 1;
    }
    if (!trimOrNull(plateNumber)) missingPlateContainers += 1;
    else plateAssignedContainers += 1;
  }

  const totalContainers = containers.length;
  const vehicleReadiness = totalContainers === 0
    ? 'NO_CONTAINERS' as const
    : missingCarrierContainers > 0
      ? 'WAITING_CARRIER' as const
      : missingPlateContainers > 0
        ? 'WAITING_PLATE' as const
        : 'READY' as const;
  const scheduleReadiness = row.shipment.expectedDeliveryDate == null
    ? 'WAITING_DATE' as const
    : bucket === ShipmentCusBucket.NEW && row.shipment.expectedDeliveryDate < businessDateNow()
      ? 'OVERDUE' as const
      : 'SCHEDULED' as const;
  const canonicalStatus = canonicalShipmentStatus(row.shipment.status);
  const transportDateEditable = actor.role === Role.CUS
    && support.locksByShipment.get(row.shipment.id) == null
    && (canonicalStatus === ShipmentStatus.PENDING_DATE || canonicalStatus === ShipmentStatus.READY_FOR_DISPATCH);

  return {
    scheduleReadiness,
    vehicleReadiness,
    totalContainers,
    assignedContainers,
    externalContainers,
    plateAssignedContainers,
    missingCarrierContainers,
    missingPlateContainers,
    transportDateEditable,
  };
}

function effectiveBillingLineAmount(line: BillingLineRow): number {
  if (line.excluded) return 0;
  if (line.grossAmount != null) return toNumber(line.grossAmount);
  return toNumber(line.amountOverride ?? line.baseAmount);
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeCarrierName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizePlate(value: string): string {
  return formatPlate(value).replace(/[^A-Z0-9]/g, '');
}

function buildScopeConditions(actor: AuthUser) {
  if (
    actor.role === Role.ADMIN
    || actor.role === Role.MANAGER
    || actor.role === Role.ACCOUNTANT
    || actor.role === Role.DISPATCHER
  ) {
    return [];
  }
  if (actor.customerIds?.length) return [inArray(s.shipments.customerId, actor.customerIds)];
  if (actor.customerId != null) return [eq(s.shipments.customerId, actor.customerId)];
  return actor.role === Role.CUS ? [sql`1 = 0`] : [];
}

function assertCusShipmentScope(actor: AuthUser, shipmentCustomerId: number | null) {
  if (actor.role !== Role.CUS) return;
  if (shipmentCustomerId == null) {
    throw new ApiError(404, 'Không tìm thấy lô hàng CUS.');
  }
  if (actor.customerIds?.length) {
    if (actor.customerIds.includes(shipmentCustomerId)) return;
    throw new ApiError(404, 'Không tìm thấy lô hàng CUS.');
  }
  if (actor.customerId != null && actor.customerId === shipmentCustomerId) return;
  throw new ApiError(404, 'Không tìm thấy lô hàng CUS.');
}

function deriveCusBucket(status: string | null, hasActiveLock: boolean): ShipmentCusBucket {
  if (hasActiveLock) return ShipmentCusBucket.LOCKED;
  const canonical = canonicalShipmentStatus(status);
  if (canonical === ShipmentStatus.DISPATCHED || canonical === ShipmentStatus.IN_TRANSIT) {
    return ShipmentCusBucket.RUNNING;
  }
  if (canonical === ShipmentStatus.PENDING_EXPENSE_APPROVAL || canonical === ShipmentStatus.COMPLETED) {
    return ShipmentCusBucket.PENDING_LOCK;
  }
  return ShipmentCusBucket.NEW;
}

function buildContainerSummary(rows: ContainerRow[]): string {
  if (rows.length === 0) return '0 cont';
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.containerTypeCode ?? row.containerTypeName ?? 'Cont';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, qty]) => `${qty}x${label}`).join(' + ');
}

function baseChargeComponent(
  amount: string | null,
  available: boolean,
  repairRecoveryPending = false,
): {
  amount: string | null;
  invoiceNumber: string | null;
  repairRecoveryPending: boolean;
  available: boolean;
} {
  return {
    amount,
    invoiceNumber: null,
    repairRecoveryPending,
    available,
  };
}

function emptyPassThroughGroup(): {
  csht: ReturnType<typeof baseChargeComponent>;
  lift: ReturnType<typeof baseChargeComponent>;
  dropoff: ReturnType<typeof baseChargeComponent>;
  other: ReturnType<typeof baseChargeComponent>;
  total: string | null;
  available: boolean;
  authority: 'APPROVED_EXPENSE_SOURCE';
} {
  return {
    csht: baseChargeComponent(null, true),
    lift: baseChargeComponent(null, true),
    dropoff: baseChargeComponent(null, true),
    other: baseChargeComponent(null, true),
    total: null as string | null,
    available: true,
    authority: 'APPROVED_EXPENSE_SOURCE',
  };
}

function passThroughBucket(expenseType: string): 'csht' | 'lift' | 'dropoff' | 'other' {
  switch (expenseType) {
    case 'INFRASTRUCTURE':
      return 'csht';
    case 'LIFTING':
      return 'lift';
    case 'LOWERING':
      return 'dropoff';
    default:
      return 'other';
  }
}

function buildPassThrough(expenses: ExpenseRow[], recoveryFacts: RecoveryFactRow[]) {
  const grouped = emptyPassThroughGroup();
  const recoveryByExpenseId = new Map<number, RecoveryFactRow[]>();
  for (const fact of recoveryFacts) {
    if (fact.sourceExpenseId == null) continue;
    const bucket = recoveryByExpenseId.get(fact.sourceExpenseId) ?? [];
    bucket.push(fact);
    recoveryByExpenseId.set(fact.sourceExpenseId, bucket);
  }

  const charges: ShipmentCusWorkspacePassThroughCharge[] = [];
  for (const expense of expenses) {
    const expenseFacts = recoveryByExpenseId.get(expense.id) ?? [];
    const bucket = passThroughBucket(expense.expenseType);
    const current = grouped[bucket];
    const pendingRecovery = expenseFacts.some((fact) => toNumber(fact.outstandingAmount) > 0);
    const repairRecoveryPending = expenseFacts.some((fact) => fact.kind === 'REPAIR' && toNumber(fact.outstandingAmount) > 0);
    grouped[bucket] = {
      amount: sumIfAny([current.amount, expense.sellAmount]),
      invoiceNumber: current.invoiceNumber == null || current.invoiceNumber === expense.invoiceNumber
        ? expense.invoiceNumber
        : null,
      repairRecoveryPending: current.repairRecoveryPending || repairRecoveryPending,
      available: true,
    };
    charges.push({
      expenseId: expense.id,
      label: expense.supplierName ?? expense.expenseType,
      amount: expense.sellAmount,
      invoiceNumber: expense.invoiceNumber,
      pendingRecovery,
    });
  }

  grouped.total = sumIfAny([
    grouped.csht.amount,
    grouped.lift.amount,
    grouped.dropoff.amount,
    grouped.other.amount,
  ]);

  return {
    grouped,
    charges,
    repairRecoveryPending: grouped.other.repairRecoveryPending,
  };
}

function buildChargeGroups(fact: ChargeFactRow | null) {
  return {
    outboundCharges: {
      transport: baseChargeComponent(fact?.outboundTransportAmount ?? null, true),
      handling: baseChargeComponent(fact?.outboundHandlingAmount ?? null, true),
      incidental: baseChargeComponent(fact?.outboundIncidentalAmount ?? null, true),
      total: sumIfAny([
        fact?.outboundTransportAmount ?? null,
        fact?.outboundHandlingAmount ?? null,
        fact?.outboundIncidentalAmount ?? null,
      ]),
      available: true,
      authority: 'MANUAL_PROPOSAL' as const,
    },
    inboundCharges: {
      transport: baseChargeComponent(fact?.inboundTransportAmount ?? null, true),
      handling: baseChargeComponent(fact?.inboundHandlingAmount ?? null, true),
      incidental: baseChargeComponent(null, false),
      total: sumIfAny([
        fact?.inboundTransportAmount ?? null,
        fact?.inboundHandlingAmount ?? null,
      ]),
      available: true,
      authority: 'MANUAL_PROPOSAL' as const,
    },
  };
}

function toRecoveryFactDto(row: RecoveryFactRow) {
  return {
    id: row.id,
    version: row.version,
    shipmentContainerId: row.shipmentContainerId,
    kind: row.kind as 'DEPOSIT' | 'REPAIR' | 'OTHER',
    status: row.status as 'OPEN' | 'PARTIAL' | 'RECOVERED' | 'WAIVED',
    expectedAmount: row.expectedAmount,
    recoveredAmount: row.recoveredAmount,
    outstandingAmount: row.outstandingAmount,
    sourceExpenseId: row.sourceExpenseId,
    sourceVersion: row.sourceVersion,
    waiverReason: row.waiverReason,
  };
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

function readSiteSnapshotSite(
  snapshot: Record<string, unknown> | null,
  key: 'pickupWarehouse' | 'deliverySite',
) {
  const value = snapshot?.[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const site = value as Record<string, unknown>;
  return {
    id: typeof site.id === 'number' ? site.id : null,
    code: typeof site.code === 'string' ? site.code : null,
    name: typeof site.name === 'string' ? site.name : null,
    siteType: typeof site.siteType === 'string' ? site.siteType : null,
  };
}

async function loadSupportRows(shipmentIds: number[], executor: Executor = db) {
  if (shipmentIds.length === 0) {
    return {
      containersByShipment: new Map<number, ContainerRow[]>(),
      declarationByShipment: new Map<number, string | null>(),
      locksByShipment: new Map<number, LockRow>(),
      debitNotesByShipment: new Map<number, DebitNoteRow>(),
      custodyByShipment: new Map<number, CustodyRow>(),
      tripsByShipment: new Map<number, TripRow[]>(),
      billingLinesByShipment: new Map<number, BillingLineRow[]>(),
      expensesByContainer: new Map<number, ExpenseRow[]>(),
      assignmentsByContainer: new Map<number, AssignmentRow>(),
      chargeFactsByContainer: new Map<number, ChargeFactRow>(),
      recoveryFactsByShipment: new Map<number, RecoveryFactRow[]>(),
      recoveryFactsByContainer: new Map<number, RecoveryFactRow[]>(),
    };
  }

  const [
    containerRows,
    declarationRows,
    lockRows,
    debitNoteRows,
    custodyRows,
    tripRows,
    billingLineRows,
    expenseRows,
    assignmentRows,
    chargeFactRows,
    recoveryFactRows,
  ] = await Promise.all([
    executor.select({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
      containerNumber: s.shipmentContainers.containerNumber,
      shippingLineName: s.shipmentContainers.shippingLineName,
      cargoWeightKg: s.shipmentContainers.cargoWeightKg,
      containerTypeId: s.shipmentContainers.containerTypeId,
      containerTypeCode: s.containerTypes.code,
      containerTypeName: s.containerTypes.name,
    }).from(s.shipmentContainers)
      .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
      .where(inArray(s.shipmentContainers.shipmentId, shipmentIds))
      .orderBy(asc(s.shipmentContainers.shipmentId), asc(s.shipmentContainers.id)),
    executor.select({
      shipmentId: s.shipmentDeclarations.shipmentId,
      declarationNumber: s.shipmentDeclarations.declarationNumber,
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
      id: s.trips.id,
      shipmentId: s.trips.shipmentId,
      version: s.trips.version,
      revenue: s.trips.revenue,
      totalCost: s.trips.totalCost,
      revenueCombine: s.trips.revenueCombine,
    }).from(s.trips)
      .where(and(
        inArray(s.trips.shipmentId, shipmentIds),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, 'CANCELED'),
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
      id: s.tripExpenses.id,
      shipmentId: s.trips.shipmentId,
      sourceShipmentContainerId: s.tripContainers.sourceShipmentContainerId,
      expenseType: s.tripExpenses.expenseType,
      sellAmount: s.tripExpenses.sellAmount,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      supplierName: s.customers.name,
    }).from(s.tripExpenses)
      .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId))
      .leftJoin(s.tripContainers, eq(s.tripContainers.id, s.tripExpenses.tripContainerId))
      .leftJoin(s.customers, eq(s.customers.id, s.tripExpenses.supplierId))
      .where(and(
        inArray(s.trips.shipmentId, shipmentIds),
        eq(s.tripExpenses.approvalStatus, 'APPROVED'),
      )),
    executor.select({
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      fulfillmentId: s.shipmentFulfillments.id,
      fulfillmentVersion: s.shipmentFulfillments.version,
      siteSnapshot: s.shipmentFulfillments.siteSnapshot,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      plannedExternalCarrierVehicleId: s.shipmentFulfillments.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
      plannedCarrierName: plannedCarrier.name,
      tripId: s.trips.id,
      tripVersion: s.trips.version,
      tripStatus: s.trips.status,
      tripPlannedEndAt: s.trips.plannedEndAt,
      tripCarrierType: s.trips.carrierType,
      tripExternalCarrierId: s.trips.externalEntityId,
      tripExternalCarrierVehicleId: s.trips.externalCarrierVehicleId,
      tripExternalCarrierName: actualCarrier.name,
      tripExternalPlateNumber: s.trips.externalPlateNumber,
      tripTruckId: s.trips.truckId,
      tripTruckPlate: s.trucks.licensePlate,
    }).from(s.shipmentFulfillments)
      .leftJoin(plannedCarrier, eq(plannedCarrier.id, s.shipmentFulfillments.plannedExternalCarrierId))
      .leftJoin(s.trips, and(
        eq(s.trips.fulfillmentId, s.shipmentFulfillments.id),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, 'CANCELED'),
      ))
      .leftJoin(actualCarrier, eq(actualCarrier.id, s.trips.externalEntityId))
      .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
        isNull(s.shipmentFulfillments.canceledAt),
      )),
    executor.select({
      shipmentContainerId: s.shipmentContainerChargeFacts.shipmentContainerId,
      version: s.shipmentContainerChargeFacts.version,
      outboundTransportAmount: s.shipmentContainerChargeFacts.outboundTransportAmount,
      outboundHandlingAmount: s.shipmentContainerChargeFacts.outboundHandlingAmount,
      outboundIncidentalAmount: s.shipmentContainerChargeFacts.outboundIncidentalAmount,
      inboundTransportAmount: s.shipmentContainerChargeFacts.inboundTransportAmount,
      inboundHandlingAmount: s.shipmentContainerChargeFacts.inboundHandlingAmount,
    }).from(s.shipmentContainerChargeFacts)
      .where(inArray(s.shipmentContainerChargeFacts.shipmentId, shipmentIds)),
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

  const declarationByShipment = new Map<number, string | null>();
  for (const row of declarationRows) {
    if (!declarationByShipment.has(row.shipmentId) && trimOrNull(row.declarationNumber)) {
      declarationByShipment.set(row.shipmentId, row.declarationNumber);
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

  const expensesByContainer = new Map<number, ExpenseRow[]>();
  for (const row of expenseRows) {
    if (row.sourceShipmentContainerId == null) continue;
    const bucket = expensesByContainer.get(row.sourceShipmentContainerId) ?? [];
    bucket.push(row);
    expensesByContainer.set(row.sourceShipmentContainerId, bucket);
  }

  const assignmentsByContainer = new Map<number, AssignmentRow>();
  for (const row of assignmentRows) {
    if (row.shipmentContainerId == null || assignmentsByContainer.has(row.shipmentContainerId)) continue;
    assignmentsByContainer.set(row.shipmentContainerId, row as AssignmentRow);
  }

  const chargeFactsByContainer = new Map<number, ChargeFactRow>();
  for (const row of chargeFactRows) chargeFactsByContainer.set(row.shipmentContainerId, row);

  const recoveryFactsByShipment = new Map<number, RecoveryFactRow[]>();
  const recoveryFactsByContainer = new Map<number, RecoveryFactRow[]>();
  for (const row of recoveryFactRows) {
    if (!isCurrentRecoveryFact(row as RecoveryFactRow)) continue;
    const byShipment = recoveryFactsByShipment.get(row.shipmentId) ?? [];
    byShipment.push(row as RecoveryFactRow);
    recoveryFactsByShipment.set(row.shipmentId, byShipment);
    if (row.shipmentContainerId != null) {
      const byContainer = recoveryFactsByContainer.get(row.shipmentContainerId) ?? [];
      byContainer.push(row as RecoveryFactRow);
      recoveryFactsByContainer.set(row.shipmentContainerId, byContainer);
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
    expensesByContainer,
    assignmentsByContainer,
    chargeFactsByContainer,
    recoveryFactsByShipment,
    recoveryFactsByContainer,
  };
}

async function loadSelectors(customerId: number, executor: Executor = db) {
  const [containerTypes, operationalSites, externalCarriers, carrierVehicles] = await Promise.all([
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
      name: s.operationalSites.name,
    }).from(s.operationalSites)
      .where(and(
        eq(s.operationalSites.customerId, customerId),
        eq(s.operationalSites.isActive, true),
        isNull(s.operationalSites.deletedAt),
      ))
      .orderBy(asc(s.operationalSites.name), asc(s.operationalSites.id)),
    executor.select({
      id: s.customers.id,
      name: s.customers.name,
      shortName: sql<string | null>`null`,
    }).from(s.customers)
      .where(and(
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .orderBy(asc(s.customers.name), asc(s.customers.id)),
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
  ]);

  return {
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
      label: row.name,
    })),
    carrierVehicles: carrierVehicles.map((row) => ({
      ...row,
      label: row.licensePlate,
    })),
  };
}

function buildListItem(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  actor: AuthUser,
  confirmation: Awaited<ReturnType<typeof getShipmentFinanceConfirmationSummary>>,
): ShipmentCusWorkspaceListItem {
  const containers = support.containersByShipment.get(row.shipment.id) ?? [];
  const activeLock = support.locksByShipment.get(row.shipment.id) ?? null;
  const debitNote = support.debitNotesByShipment.get(row.shipment.id) ?? null;
  const custody = support.custodyByShipment.get(row.shipment.id) ?? null;
  const trips = support.tripsByShipment.get(row.shipment.id) ?? [];
  const recoveryFacts = support.recoveryFactsByShipment.get(row.shipment.id) ?? [];
  const totalCost = sumMoney(trips.map((trip) => trip.totalCost));
  const bucket = deriveCusBucket(row.shipment.status, activeLock != null);
  const hasPendingRecovery = recoveryFacts.some((fact) => toNumber(fact.outstandingAmount) > 0);
  const operational = buildOperationalSummary(row, support, bucket, actor);
  const billingLines = debitNote == null
    ? []
    : (support.billingLinesByShipment.get(row.shipment.id) ?? [])
      .filter((line) => line.documentId === debitNote.billingDocumentId);
  const hasUnattributableAdhoc = billingLines.some((line) => (
    line.sourceType === 'ADHOC' && effectiveBillingLineAmount(line) !== 0
  ));
  const attributedBillingLines = billingLines.filter((line) => (
    (line.sourceType === 'TRIP' && line.sourceTripShipmentId === row.shipment.id)
    || (line.sourceType === 'EXPENSE' && line.sourceExpenseShipmentId === row.shipment.id)
  ));
  const customerTotalsAvailable = debitNote != null
    && billingLines.length > 0
    && attributedBillingLines.length > 0
    && !hasUnattributableAdhoc;
  const customerInvoiceTotal = customerTotalsAvailable
    ? sumMoney(attributedBillingLines
      .filter((line) => line.vatTreatment === 'STANDARD' || line.vatTreatment === 'ZERO_RATED')
      .map(effectiveBillingLineAmount))
    : null;
  const customerNoInvoiceTotal = customerTotalsAvailable
    ? sumMoney(attributedBillingLines
      .filter((line) => line.vatTreatment === 'EXEMPT')
      .map(effectiveBillingLineAmount))
    : null;
  const authoritativeCustomerTotal = customerTotalsAvailable
    ? toNumber(customerInvoiceTotal) + toNumber(customerNoInvoiceTotal)
    : null;

  const shippingLines = new Set<string>();
  const shipmentShippingLine = trimOrNull(row.shipment.shippingLineName);
  if (shipmentShippingLine) shippingLines.add(shipmentShippingLine);
  for (const container of containers) {
    const value = trimOrNull(container.shippingLineName);
    if (value) shippingLines.add(value);
  }

  const accountantAction = confirmation.status === 'CONFIRMED'
    ? {
        kind: 'NONE' as const,
        label: 'Đã xác nhận',
        enabled: false,
        disabledReason: null,
      }
    : {
        kind: 'CONFIRM_FINANCE' as const,
        label: 'Xác nhận tài chính',
        enabled: debitNote != null,
        disabledReason: debitNote == null ? 'Chưa có Debit Note hiện hành đủ điều kiện.' : null,
      };

  return {
    id: row.shipment.id,
    version: row.shipment.version,
    bucket,
    bucketLabel: SHIPMENT_CUS_BUCKET_LABELS[bucket],
    customerName: row.customerName,
    factoryName: trimOrNull(row.shipment.factoryName),
    billOrBookNumber: trimOrNull(row.shipment.blNumber) ?? trimOrNull(row.shipment.bookingRef),
    declarationNumber: support.declarationByShipment.get(row.shipment.id) ?? null,
    shippingLineName: shippingLines.size > 0 ? Array.from(shippingLines).join(', ') : null,
    routeName: row.routeName,
    isCombined: trips.some((trip) => toNumber(trip.revenueCombine) > 0),
    direction: row.shipment.tradeDirection,
    containerSummary: buildContainerSummary(containers),
    weightKg: row.shipment.cargoWeightKg == null ? null : String(row.shipment.cargoWeightKg),
    volumeCbm: row.shipment.cargoVolumeCbm == null ? null : String(row.shipment.cargoVolumeCbm),
    transportDate: row.shipment.expectedDeliveryDate,
    note: trimOrNull(row.shipment.operationalNotes),
    operational,
    finance: {
      customerInvoiceTotal,
      customerNoInvoiceTotal,
      totalCost,
      isLoss: authoritativeCustomerTotal == null ? null : authoritativeCustomerTotal < toNumber(totalCost),
      hasPendingRecovery,
      customerChargeTotalsAvailable: customerTotalsAvailable,
      totalCostAvailable: true,
      customerTotalsAuthority: customerTotalsAvailable ? 'BILLING_DOCUMENT' : 'UNAVAILABLE',
    },
    debitNote: {
      available: debitNote != null,
      billingDocumentId: debitNote?.billingDocumentId ?? null,
      documentNumber: debitNote == null ? null : `Debit Note #${debitNote.billingDocumentId}`,
      issuedAt: debitNote?.issuedAt?.toISOString() ?? null,
      debitNoteStatus: debitNote?.debitNoteStatus ?? null,
      disabledReason: debitNote == null ? 'Chưa có Debit Note hiện hành đủ điều kiện.' : null,
    },
    documentCustody: {
      status: custody?.status == null ? null : custody.status as ShipmentDocumentCustody,
      label: custody == null
        ? null
        : SHIPMENT_DOCUMENT_CUSTODY_LABELS[custody.status as ShipmentDocumentCustody] ?? custody.status,
      available: custody != null,
      editable: activeLock == null && actor.role === Role.CUS,
    },
    accountingConfirmation: confirmation,
    activeLock: activeLock == null
      ? null
      : {
          id: activeLock.id,
          billingDocumentId: activeLock.billingDocumentId,
          activatedAt: activeLock.activatedAt.toISOString(),
          activatedByName: activeLock.activatedByName,
          reason: activeLock.reason,
        },
    action: activeLock != null
      ? {
          kind: 'REQUEST_REOPEN',
          label: 'Đề nghị điều chỉnh',
          enabled: actor.role === Role.CUS,
          disabledReason: actor.role === Role.CUS ? null : 'Chỉ CUS được gửi đề nghị điều chỉnh.',
        }
      : actor.role === Role.ACCOUNTANT
        ? accountantAction
        : {
            kind: 'LOCK',
            label: 'Khóa lô',
            enabled: actor.role === Role.CUS && confirmation.status === 'CONFIRMED',
            disabledReason: actor.role !== Role.CUS
              ? 'Chỉ CUS được khóa lô.'
              : confirmation.status === 'CONFIRMED'
                ? null
                : 'Cần Kế toán xác nhận lại số liệu trước khi khóa lô.',
          },
  };
}

function buildContainerLine(
  row: ShipmentListRow,
  actor: AuthUser,
  support: WorkspaceSupport,
  container: ContainerRow,
  ordinal: number,
): ShipmentCusWorkspaceContainerLine {
  const assignment = support.assignmentsByContainer.get(container.id) ?? null;
  const chargeFact = support.chargeFactsByContainer.get(container.id) ?? null;
  const recoveryFacts = (support.recoveryFactsByContainer.get(container.id) ?? []).map(toRecoveryFactDto);
  const passThrough = buildPassThrough(
    support.expensesByContainer.get(container.id) ?? [],
    support.recoveryFactsByContainer.get(container.id) ?? [],
  );
  const { outboundCharges, inboundCharges } = buildChargeGroups(chargeFact);
  const activeLock = support.locksByShipment.get(row.shipment.id) ?? null;
  const editableBase = activeLock == null && (actor.role === Role.CUS || actor.role === Role.DISPATCHER);
  const canEditOperational = editableBase && assignment?.tripId == null;
  const canEditCloseOrReturn = editableBase
    && assignment?.tripId == null
    && (support.containersByShipment.get(row.shipment.id)?.length ?? 0) === 1;
  const liftSite = readSiteSnapshotSite(assignment?.siteSnapshot ?? null, 'pickupWarehouse');
  const dropoffSite = readSiteSnapshotSite(assignment?.siteSnapshot ?? null, 'deliverySite');
  const carrierType = assignment?.tripCarrierType ?? assignment?.plannedCarrierType ?? null;
  const externalCarrierId = assignment?.tripExternalCarrierId ?? assignment?.plannedExternalCarrierId ?? null;
  const carrierName = carrierType === 'OWN'
    ? 'SilverSea'
    : assignment?.tripExternalCarrierName ?? assignment?.plannedCarrierName ?? null;
  const plateEditable = canEditOperational && carrierType === 'EXTERNAL';

  return {
    id: container.id,
    ordinal,
    containerNumber: container.containerNumber,
    containerTypeId: container.containerTypeId,
    containerTypeLabel: container.containerTypeCode ?? container.containerTypeName,
    carrierType: carrierType as 'OWN' | 'EXTERNAL' | null,
    externalCarrierId,
    externalCarrierVehicleId: assignment?.tripExternalCarrierVehicleId ?? assignment?.plannedExternalCarrierVehicleId ?? null,
    carrierName,
    plateNumber: carrierType === 'OWN'
      ? assignment?.tripTruckPlate ?? null
      : assignment?.tripExternalPlateNumber ?? assignment?.plannedVehiclePlateNumber ?? null,
    liftSiteId: liftSite?.id ?? null,
    liftSite: liftSite?.name ?? null,
    dropoffSiteId: dropoffSite?.id ?? null,
    dropoffSite: dropoffSite?.name ?? null,
    closeOrReturnAt: assignment?.tripPlannedEndAt?.toISOString()
      ?? (row.shipment.closingAt ?? row.shipment.plannedReturnAt)?.toISOString()
      ?? null,
    outboundCharges,
    inboundCharges,
    passThroughChargesGrouped: passThrough.grouped,
    passThroughCharges: passThrough.charges,
    recoveryFacts,
    repairRecoveryPending: passThrough.repairRecoveryPending || recoveryFacts.some((fact) => fact.kind === 'REPAIR' && toNumber(fact.outstandingAmount) > 0),
    permissions: {
      carrierEditable: canEditOperational,
      plateEditable,
      containerTypeEditable: canEditOperational,
      liftSiteEditable: canEditOperational,
      dropoffSiteEditable: canEditOperational,
      closeOrReturnTimeEditable: canEditCloseOrReturn,
      outboundEditable: editableBase && actor.role === Role.CUS,
      inboundEditable: editableBase,
      passThroughEditable: false,
    },
    shipmentVersion: row.shipment.version,
    factVersion: chargeFact?.version ?? 0,
    relatedTripVersion: assignment?.tripVersion ?? null,
  };
}

async function loadShipmentRow(
  shipmentId: number,
  actor: AuthUser,
  executor: Executor = db,
) {
  const [row] = await executor.select({
    shipment: s.shipments,
    customerName: s.customers.name,
    routeName: s.routes.name,
  }).from(s.shipments)
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
    .where(and(
      eq(s.shipments.id, shipmentId),
      isNull(s.shipments.deletedAt),
      ne(s.shipments.status, ShipmentStatus.CANCELED),
      ...buildScopeConditions(actor),
    ))
    .limit(1);
  if (!row) throw new ApiError(404, 'Không tìm thấy lô hàng CUS.');
  return row;
}

async function buildWorkspaceDetail(
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
      hasExplicitRecoveryFacts: (support.recoveryFactsByShipment.get(row.shipment.id) ?? []).length > 0,
      hasAuthoritativeChargeBreakdown: containers.length > 0 && containers.every((line) => line.factVersion > 0),
    },
  };
}

async function loadShipmentPage(query: ShipmentCusWorkspaceQuery, actor: AuthUser) {
  const activeLockExists = sql`exists (
    select 1
    from ${s.shipmentAccountingLocks}
    where ${s.shipmentAccountingLocks.shipmentId} = ${s.shipments.id}
      and ${s.shipmentAccountingLocks.releasedAt} is null
  )`;
  const conditions = [
    isNull(s.shipments.deletedAt),
    ne(s.shipments.status, ShipmentStatus.CANCELED),
    ...buildScopeConditions(actor),
  ];
  if (query.transportDateFrom) {
    conditions.push(sql`${s.shipments.expectedDeliveryDate} >= ${query.transportDateFrom}`);
  }
  if (query.transportDateTo) {
    conditions.push(sql`${s.shipments.expectedDeliveryDate} <= ${query.transportDateTo}`);
  }
  if (query.searchSuffix) {
    const suffix = `%${query.searchSuffix}`;
    conditions.push(or(
      ilike(s.shipments.blNumber, suffix),
      ilike(s.shipments.bookingRef, suffix),
      sql`exists (
        select 1
        from ${s.shipmentDeclarations}
        where ${s.shipmentDeclarations.shipmentId} = ${s.shipments.id}
          and ${s.shipmentDeclarations.declarationNumber} ilike ${suffix}
      )`,
    )!);
  }
  if (query.bucket === ShipmentCusBucket.LOCKED) {
    conditions.push(activeLockExists);
  } else if (query.bucket === ShipmentCusBucket.RUNNING) {
    conditions.push(sql`not ${activeLockExists}`);
    conditions.push(inArray(s.shipments.status, [
      ShipmentStatus.DISPATCHED,
      ShipmentStatus.IN_TRANSIT,
    ]));
  } else if (query.bucket === ShipmentCusBucket.PENDING_LOCK) {
    conditions.push(sql`not ${activeLockExists}`);
    conditions.push(inArray(s.shipments.status, [
      ShipmentStatus.PENDING_EXPENSE_APPROVAL,
      ShipmentStatus.COMPLETED,
    ]));
  } else if (query.bucket === ShipmentCusBucket.NEW) {
    conditions.push(sql`not ${activeLockExists}`);
    conditions.push(sql`${s.shipments.status} not in (${ShipmentStatus.DISPATCHED}, ${ShipmentStatus.IN_TRANSIT}, ${ShipmentStatus.PENDING_EXPENSE_APPROVAL}, ${ShipmentStatus.COMPLETED})`);
  }

  const offset = (query.page - 1) * query.limit;
  const [items, totalRows] = await Promise.all([
    db.select({
      shipment: s.shipments,
      customerName: s.customers.name,
      routeName: s.routes.name,
    }).from(s.shipments)
      .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
      .leftJoin(s.routes, eq(s.routes.id, s.shipments.routeId))
      .where(and(...conditions))
      .orderBy(desc(s.shipments.createdAt), desc(s.shipments.id))
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

export async function listCusShipmentWorkspace(
  query: ShipmentCusWorkspaceQuery,
  actor: AuthUser,
): Promise<ShipmentCusWorkspaceListResponse> {
  const { items, total } = await loadShipmentPage(query, actor);
  const support = await loadSupportRows(items.map((row) => row.shipment.id));
  const confirmations = await getShipmentFinanceConfirmationSummaries(
    items.map((row) => row.shipment.id),
  );
  const projectedItems = items.map((row) => buildListItem(
    row,
    support,
    actor,
    confirmations.get(row.shipment.id)!,
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

function requireWorkspaceWriter(actor: AuthUser) {
  if (actor.role !== Role.CUS && actor.role !== Role.DISPATCHER) {
    throw new ApiError(403, 'Chỉ CUS hoặc Điều vận được cập nhật dòng container trong workspace này.');
  }
}

async function assertActiveContainerType(containerTypeId: number, tx: Tx) {
  const [row] = await tx.select({ id: s.containerTypes.id }).from(s.containerTypes)
    .where(and(eq(s.containerTypes.id, containerTypeId), isNull(s.containerTypes.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError(409, 'Loại container không còn hiệu lực.');
}

async function loadOperationalSiteRecords(
  customerId: number,
  siteIds: number[],
  tx: Tx,
) {
  if (siteIds.length === 0) return new Map<number, Record<string, unknown>>();
  const rows = await tx.select({
    id: s.operationalSites.id,
    code: s.operationalSites.code,
    name: s.operationalSites.name,
    siteType: s.operationalSites.siteType,
    address: s.operationalSites.address,
    googleMapsUrl: s.operationalSites.googleMapsUrl,
    contactName: s.operationalSites.contactName,
    contactPhone: s.operationalSites.contactPhone,
    liftFeeInvoiceName: s.operationalSites.liftFeeInvoiceName,
    liftFeeInvoiceAddress: s.operationalSites.liftFeeInvoiceAddress,
    liftFeeTaxCode: s.operationalSites.liftFeeTaxCode,
    strictRules: s.operationalSites.strictRules,
    version: s.operationalSites.version,
  }).from(s.operationalSites)
    .where(and(
      eq(s.operationalSites.customerId, customerId),
      inArray(s.operationalSites.id, siteIds),
      eq(s.operationalSites.isActive, true),
      isNull(s.operationalSites.deletedAt),
    ));
  if (rows.length !== new Set(siteIds).size) {
    throw new ApiError(409, 'Điểm nâng/hạ không còn hiệu lực hoặc không thuộc khách hàng của lô.');
  }
  return new Map(rows.map((row) => [row.id, {
    id: row.id,
    code: row.code,
    name: row.name,
    siteType: row.siteType,
    address: row.address,
    googleMapsUrl: row.googleMapsUrl,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    liftFeeInvoiceName: row.liftFeeInvoiceName,
    liftFeeInvoiceAddress: row.liftFeeInvoiceAddress,
    liftFeeTaxCode: row.liftFeeTaxCode,
    strictRules: row.strictRules,
    sourceVersion: row.version,
  }]));
}

async function loadExternalCarrier(
  carrierId: number,
  tx: Tx,
) {
  const [carrier] = await tx.select({
    id: s.customers.id,
    name: s.customers.name,
    isCarrier: s.customers.isCarrier,
    status: s.customers.status,
    deletedAt: s.customers.deletedAt,
  }).from(s.customers).where(eq(s.customers.id, carrierId)).limit(1);
  if (!carrier || carrier.deletedAt != null || carrier.status !== 'ACTIVE' || !carrier.isCarrier) {
    throw new ApiError(409, 'Nhà xe không còn hiệu lực.');
  }
  return carrier;
}

async function loadCarrierVehicle(
  carrierId: number,
  vehicleId: number,
  tx: Tx,
) {
  const [vehicle] = await tx.select({
    id: s.carrierFleetVehicles.id,
    carrierId: s.carrierFleetVehicles.carrierId,
    licensePlate: s.carrierFleetVehicles.licensePlate,
  }).from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.id, vehicleId),
      eq(s.carrierFleetVehicles.carrierId, carrierId),
      eq(s.carrierFleetVehicles.isActive, true),
      isNull(s.carrierFleetVehicles.deletedAt),
    ))
    .limit(1)
    .for('update');
  if (!vehicle) throw new ApiError(409, 'Xe nhà xe không còn hiệu lực hoặc không thuộc nhà xe đã chọn.');
  return vehicle;
}

async function resolveInlineExternalCarrier(
  input: { name: string; plateNumber: string },
  actor: AuthUser,
  tx: Tx,
) {
  const normalizedCarrierName = normalizeCarrierName(input.name);
  const displayCarrierName = trimOrNull(input.name);
  if (displayCarrierName == null) {
    throw new ApiError(400, 'Tên nhà xe là bắt buộc.');
  }
  const licensePlate = formatPlate(input.plateNumber);
  const normalizedPlate = normalizePlate(input.plateNumber);
  if (normalizedPlate.length < 5) {
    throw new ApiError(400, 'Biển số xe không hợp lệ.');
  }

  const [matchedCarrier] = await tx.select({
    id: s.customers.id,
    name: s.customers.name,
    status: s.customers.status,
    isCarrier: s.customers.isCarrier,
    deletedAt: s.customers.deletedAt,
  }).from(s.customers)
    .where(sql`lower(btrim(${s.customers.name})) = ${normalizedCarrierName}`)
    .limit(1)
    .for('update');

  if (matchedCarrier && (matchedCarrier.deletedAt != null || matchedCarrier.status !== 'ACTIVE' || !matchedCarrier.isCarrier)) {
    throw new ApiError(409, 'Tên nhà xe đã tồn tại nhưng không ở trạng thái nhà xe hoạt động.');
  }

  let carrier = matchedCarrier ?? null;
  if (carrier == null) {
    try {
      [carrier] = await tx.insert(s.customers).values({
        name: displayCarrierName,
        status: 'ACTIVE',
        isCarrier: true,
      }).returning({
        id: s.customers.id,
        name: s.customers.name,
        status: s.customers.status,
        isCarrier: s.customers.isCarrier,
        deletedAt: s.customers.deletedAt,
      });
    } catch (error) {
      const code = typeof error === 'object' && error != null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
      if (code !== '23505') throw error;
      [carrier] = await tx.select({
        id: s.customers.id,
        name: s.customers.name,
        status: s.customers.status,
        isCarrier: s.customers.isCarrier,
        deletedAt: s.customers.deletedAt,
      }).from(s.customers)
        .where(sql`lower(btrim(${s.customers.name})) = ${normalizedCarrierName}`)
        .limit(1)
        .for('update');
      if (!carrier || carrier.deletedAt != null || carrier.status !== 'ACTIVE' || !carrier.isCarrier) {
        throw new ApiError(409, 'Tên nhà xe vừa được dùng bởi bản ghi không hợp lệ cho workspace.');
      }
    }
  }

  const matchingVehicles = await tx.select({
    id: s.carrierFleetVehicles.id,
    licensePlate: s.carrierFleetVehicles.licensePlate,
    isActive: s.carrierFleetVehicles.isActive,
    deletedAt: s.carrierFleetVehicles.deletedAt,
  }).from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.carrierId, carrier.id),
      eq(s.carrierFleetVehicles.normalizedPlate, normalizedPlate),
    ))
    .for('update');

  const blockedVehicle = matchingVehicles.find((vehicle) => (
    vehicle.deletedAt != null || vehicle.isActive !== true
  ));
  if (blockedVehicle) {
    throw new ApiError(
      409,
      'Biển số nhà xe đã tồn tại nhưng không còn hiệu lực. Vui lòng liên hệ ADMIN hoặc Quản lý để xử lý danh mục xe.',
    );
  }

  const activeVehicles = matchingVehicles.filter((vehicle) => (
    vehicle.deletedAt == null && vehicle.isActive === true
  ));
  if (activeVehicles.length > 1) {
    throw new ApiError(
      409,
      'Biển số nhà xe đang có dữ liệu trùng lặp trong danh mục. Vui lòng liên hệ ADMIN hoặc Quản lý để xử lý trước khi tiếp tục.',
    );
  }

  const existingVehicle = activeVehicles[0] ?? null;
  if (existingVehicle) {
    if (existingVehicle.licensePlate !== licensePlate) {
      throw new ApiError(
        409,
        'Biển số nhà xe đã tồn tại với định dạng khác trong danh mục hoạt động. Vui lòng chọn xe hiện có hoặc liên hệ ADMIN hoặc Quản lý để cập nhật.',
      );
    }
    return {
      carrierId: carrier.id,
      carrierVehicleId: existingVehicle.id,
      plateNumber: licensePlate,
    };
  }

  const [vehicle] = await tx.insert(s.carrierFleetVehicles).values({
    carrierId: carrier.id,
    licensePlate,
    normalizedPlate,
    isActive: true,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  }).returning({
    id: s.carrierFleetVehicles.id,
  }).catch(async (error) => {
    const code = typeof error === 'object' && error != null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code !== '23505') throw error;

    const rows = await tx.select({
      id: s.carrierFleetVehicles.id,
      licensePlate: s.carrierFleetVehicles.licensePlate,
      isActive: s.carrierFleetVehicles.isActive,
      deletedAt: s.carrierFleetVehicles.deletedAt,
    }).from(s.carrierFleetVehicles)
      .where(and(
        eq(s.carrierFleetVehicles.carrierId, carrier.id),
        eq(s.carrierFleetVehicles.normalizedPlate, normalizedPlate),
      ))
      .limit(2)
      .for('update');

    const blocked = rows.find((row) => row.deletedAt != null || row.isActive !== true);
    if (blocked) {
      throw new ApiError(
        409,
        'Biển số nhà xe đã tồn tại nhưng không còn hiệu lực. Vui lòng liên hệ ADMIN hoặc Quản lý để xử lý danh mục xe.',
      );
    }
    const active = rows.filter((row) => row.deletedAt == null && row.isActive === true);
    if (active.length === 1 && active[0]!.licensePlate === licensePlate) {
      return [{ id: active[0]!.id }];
    }
    throw new ApiError(
      409,
      'Biển số nhà xe đã tồn tại trong danh mục hoạt động. Vui lòng chọn xe hiện có hoặc liên hệ ADMIN hoặc Quản lý để xử lý.',
    );
  });

  return {
    carrierId: carrier.id,
    carrierVehicleId: vehicle.id,
    plateNumber: licensePlate,
  };
}

function resolveCloseField(shipment: ShipmentRow): 'closingAt' | 'plannedReturnAt' {
  if (shipment.closingAt != null && shipment.plannedReturnAt == null) return 'closingAt';
  if (shipment.plannedReturnAt != null && shipment.closingAt == null) return 'plannedReturnAt';
  return shipment.tradeDirection === 'IMPORT' ? 'plannedReturnAt' : 'closingAt';
}

export async function updateCusShipmentContainerLine(args: {
  shipmentId: number;
  containerId: number;
  input: ShipmentCusContainerLineUpdateInput;
  actor: AuthUser;
  transaction?: Tx;
}): Promise<ShipmentCusContainerLineUpdateResult> {
  requireWorkspaceWriter(args.actor);

  const execute = async (tx: Tx) => {
    const shipment = await assertShipmentAccountingUnlocked(tx, args.shipmentId);
    assertCusShipmentScope(args.actor, shipment.customerId);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật dòng container.');
    }

    const [container] = await tx.select().from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.id, args.containerId),
        eq(s.shipmentContainers.shipmentId, args.shipmentId),
      ))
      .limit(1)
      .for('update');
    if (!container) throw new ApiError(404, 'Không tìm thấy container của lô hàng.');

    let fulfillment: ShipmentFulfillmentRow | null = (await tx.select().from(s.shipmentFulfillments)
      .where(and(
        eq(s.shipmentFulfillments.shipmentId, args.shipmentId),
        eq(s.shipmentFulfillments.shipmentContainerId, args.containerId),
        isNull(s.shipmentFulfillments.canceledAt),
      ))
      .limit(1)
      .for('update'))[0] ?? null;
    if (!fulfillment) {
      const ensured = await ensureShipmentFulfillmentsInTx(tx, {
        shipmentId: args.shipmentId,
        actorId: args.actor.userId,
        allowClerkIntake: true,
      });
      fulfillment = ensured.find((row) => row.shipmentContainerId === args.containerId) ?? null;
    }
    if (!fulfillment) {
      throw new ApiError(409, 'Container chưa có tác vụ thực hiện chuẩn hóa để cập nhật từ workspace.');
    }

    const shipmentContainerRows = await tx.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, args.shipmentId));

    const [trip] = await tx.select().from(s.trips)
      .where(and(
        eq(s.trips.fulfillmentId, fulfillment.id),
        isNull(s.trips.deletedAt),
        ne(s.trips.status, 'CANCELED'),
      ))
      .limit(1)
      .for('update');

    const requestedOperationalMutation = (
      args.input.containerTypeId !== undefined
      || args.input.liftSiteId !== undefined
      || args.input.dropoffSiteId !== undefined
      || args.input.closeOrReturnAt !== undefined
      || args.input.carrierType !== undefined
      || args.input.externalCarrierId !== undefined
      || args.input.externalCarrierVehicleId !== undefined
      || args.input.plateNumber !== undefined
      || args.input.newExternalCarrier !== undefined
    );
    if (trip && requestedOperationalMutation) {
      throw new ApiError(409, 'Tác vụ đã điều xe; hãy dùng luồng điều chỉnh hiện có thay vì ghi đè trực tiếp lịch sử thực hiện.');
    }

    const [existingChargeFact] = await tx.select().from(s.shipmentContainerChargeFacts)
      .where(eq(s.shipmentContainerChargeFacts.shipmentContainerId, args.containerId))
      .limit(1)
      .for('update');
    const currentFactVersion = existingChargeFact?.version ?? 0;
    if (currentFactVersion !== args.input.expectedFactVersion) {
      throw new ApiError(409, 'Dòng phí container vừa thay đổi. Vui lòng tải lại.');
    }

    let touched = false;
    const now = new Date();

    if (args.input.containerTypeId !== undefined && args.input.containerTypeId !== container.containerTypeId) {
      if (args.input.containerTypeId != null) await assertActiveContainerType(args.input.containerTypeId, tx);
      await tx.update(s.shipmentContainers).set({
        containerTypeId: args.input.containerTypeId ?? null,
        updatedAt: now,
      }).where(eq(s.shipmentContainers.id, container.id));
      touched = true;
    }

    if (args.input.liftSiteId !== undefined || args.input.dropoffSiteId !== undefined) {
      const siteIds = [args.input.liftSiteId, args.input.dropoffSiteId]
        .filter((value): value is number => value != null);
      const byId = await loadOperationalSiteRecords(shipment.customerId, siteIds, tx);
      const nextSnapshot = { ...((fulfillment.siteSnapshot ?? {}) as Record<string, unknown>) };
      if (args.input.liftSiteId !== undefined) {
        nextSnapshot.pickupWarehouse = args.input.liftSiteId == null ? null : byId.get(args.input.liftSiteId) ?? null;
      }
      if (args.input.dropoffSiteId !== undefined) {
        nextSnapshot.deliverySite = args.input.dropoffSiteId == null ? null : byId.get(args.input.dropoffSiteId) ?? null;
      }
      await tx.update(s.shipmentFulfillments).set({
        siteSnapshot: nextSnapshot,
        version: fulfillment.version + 1,
        updatedAt: now,
      }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      touched = true;
    }

    if (args.input.closeOrReturnAt !== undefined) {
      if (shipmentContainerRows.length !== 1) {
        throw new ApiError(409, 'Giờ đóng/trả hiện là dữ liệu cấp lô cho nhiều container; không được sửa từ một dòng đơn lẻ.');
      }
      const field = resolveCloseField(shipment);
      await tx.update(s.shipments).set({
        [field]: args.input.closeOrReturnAt == null ? null : new Date(args.input.closeOrReturnAt),
        updatedAt: now,
        updatedBy: args.actor.userId,
      }).where(eq(s.shipments.id, shipment.id));
      touched = true;
    }

    if (
      args.input.carrierType !== undefined
      || args.input.externalCarrierId !== undefined
      || args.input.externalCarrierVehicleId !== undefined
      || args.input.plateNumber !== undefined
      || args.input.newExternalCarrier !== undefined
    ) {
      const nextCarrierType = args.input.carrierType ?? fulfillment.plannedCarrierType ?? null;
      if (nextCarrierType === 'EXTERNAL') {
        const inlineCarrier = args.input.newExternalCarrier == null
          ? null
          : await resolveInlineExternalCarrier(args.input.newExternalCarrier, args.actor, tx);
        const nextCarrierId = inlineCarrier?.carrierId
          ?? args.input.externalCarrierId
          ?? fulfillment.plannedExternalCarrierId
          ?? null;
        if (nextCarrierId == null) throw new ApiError(400, 'Cần chọn hoặc nhập nhà xe ngoài hợp lệ.');
        await loadExternalCarrier(nextCarrierId, tx);
        const nextCarrierVehicleId = inlineCarrier?.carrierVehicleId
          ?? (args.input.externalCarrierVehicleId !== undefined
            ? args.input.externalCarrierVehicleId
            : fulfillment.plannedExternalCarrierVehicleId);
        const requestedPlate = inlineCarrier?.plateNumber
          ?? (args.input.plateNumber !== undefined
            ? trimOrNull(args.input.plateNumber)
            : fulfillment.plannedVehiclePlateNumber);
        const carrierVehicle = nextCarrierVehicleId == null
          ? null
          : await loadCarrierVehicle(nextCarrierId, nextCarrierVehicleId, tx);
        const nextPlateNumber = requestedPlate ?? carrierVehicle?.licensePlate ?? null;
        if (nextPlateNumber == null) {
          throw new ApiError(400, 'Cần chọn xe nhà xe hoặc nhập biển số kế hoạch trước khi cập nhật.');
        }
        await tx.update(s.shipmentFulfillments).set({
          plannedCarrierType: 'EXTERNAL',
          plannedExternalCarrierId: nextCarrierId,
          plannedExternalCarrierVehicleId: nextCarrierVehicleId ?? null,
          plannedVehiclePlateNumber: nextPlateNumber,
          version: fulfillment.version + 1,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      } else if (nextCarrierType === 'OWN') {
        if (trimOrNull(args.input.plateNumber) != null) {
          throw new ApiError(409, 'Biển số kế hoạch cho xe nội bộ chỉ được xác định từ lệnh điều xe chính thức.');
        }
        await tx.update(s.shipmentFulfillments).set({
          plannedCarrierType: 'OWN',
          plannedExternalCarrierId: null,
          plannedExternalCarrierVehicleId: null,
          plannedVehiclePlateNumber: null,
          version: fulfillment.version + 1,
          updatedAt: now,
        }).where(eq(s.shipmentFulfillments.id, fulfillment.id));
      } else if (nextCarrierType != null) {
        throw new ApiError(400, 'Loại nhà xe không hợp lệ.');
      }
      touched = true;
    }

    if (args.input.outboundCharges && args.actor.role !== Role.CUS) {
      throw new ApiError(403, 'Chỉ CUS được cập nhật nhóm cước đầu ra.');
    }

    if (args.input.outboundCharges || args.input.inboundCharges) {
      const nextValues = {
        shipmentId: shipment.id,
        shipmentContainerId: container.id,
        outboundTransportAmount: args.input.outboundCharges?.transportAmount ?? existingChargeFact?.outboundTransportAmount ?? null,
        outboundHandlingAmount: args.input.outboundCharges?.handlingAmount ?? existingChargeFact?.outboundHandlingAmount ?? null,
        outboundIncidentalAmount: args.input.outboundCharges?.incidentalAmount ?? existingChargeFact?.outboundIncidentalAmount ?? null,
        inboundTransportAmount: args.input.inboundCharges?.transportAmount ?? existingChargeFact?.inboundTransportAmount ?? null,
        inboundHandlingAmount: args.input.inboundCharges?.handlingAmount ?? existingChargeFact?.inboundHandlingAmount ?? null,
      };
      if (existingChargeFact) {
        await tx.update(s.shipmentContainerChargeFacts).set({
          ...nextValues,
          version: existingChargeFact.version + 1,
          updatedBy: args.actor.userId,
          updatedAt: now,
        }).where(eq(s.shipmentContainerChargeFacts.id, existingChargeFact.id));
      } else {
        await tx.insert(s.shipmentContainerChargeFacts).values({
          ...nextValues,
          version: 1,
          createdBy: args.actor.userId,
          updatedBy: args.actor.userId,
        });
      }
      touched = true;
    }

    if (touched) {
      const [updatedShipment] = await tx.update(s.shipments).set({
        version: shipment.version + 1,
        updatedAt: now,
        updatedBy: args.actor.userId,
      }).where(and(
        eq(s.shipments.id, shipment.id),
        eq(s.shipments.version, shipment.version),
      )).returning();
      if (!updatedShipment) {
        throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại và thử lại.');
      }
    }

    const detail = await buildWorkspaceDetail(await loadShipmentRow(args.shipmentId, args.actor, tx), args.actor, tx);
    const line = detail.containers.find((item) => item.id === args.containerId);
    if (!line) throw new ApiError(500, 'Không thể tải lại dòng container vừa cập nhật.');
    return { line };
  };

  return args.transaction ? execute(args.transaction) : db.transaction(execute);
}
