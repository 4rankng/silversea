/**
 * CUS shipment workspace — read model.
 *
 * Formatting/compute helpers, SQL fragment builders, read-model builders, and
 * the list/detail reads for the CUS workspace. Write commands live in
 * `cus-shipment-workspace-writes.service.ts`, which imports this module —
 * the dependency direction is writes → reads only, never the reverse.
 * `cus-shipment-workspace.service.ts` remains the facade importers target.
 */
import {
  Role,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  ShipmentStatus,
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  SHIPMENT_CUS_MISSING_FIELD_LABELS,
  canonicalShipmentStatus,
  localDateInBusinessZone,
  type DispatchClassification,
  type ShipmentCusContainerQuery,
  type ShipmentCusContainerSortKey,
  type ShipmentCusWorkspaceSortKey,
  type ShipmentCusMissingField,
  type ShipmentCusMissingFieldCode,
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceFieldAccess,
  type ShipmentCusWorkspaceDetail,
  type ShipmentCusWorkspaceListItem,
  type ShipmentCusWorkspaceListResponse,
  type ShipmentCusWorkspaceQuery,
  type ShipmentCusContainerFlatResponse,
  type ShipmentCusContainerFlatRow,
} from '@tingting/shared';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type Column, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { CARGO_MODE } from '../db/schema';
import { operationalName } from '../db/master-data-name';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { assertClerkCanAccessShipment, buildShipmentScopeWhere, loadClerkShipmentScope } from './clerk-shipment-scope.service';
import {
  getShipmentFinanceConfirmationSummaries,
  getShipmentFinanceConfirmationSummary,
} from './shipment-accounting-lock.service';
import { filterContainersByDateRange, isPastRunCutoff } from './container-date-filter';

export const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);
export const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);

type Executor = typeof db | Tx;
type ShipmentRow = typeof s.shipments.$inferSelect;
export type ShipmentFulfillmentRow = typeof s.shipmentFulfillments.$inferSelect;

type ShipmentListRow = {
  shipment: ShipmentRow;
  customerName: string | null;
  routeName: string | null;
};

type ContainerRow = {
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

type DeclarationRow = {
  id: number;
  shipmentId: number;
  declarationNumber: string | null;
  issuedAt: Date | null;
  scope: 'SINGLE' | 'SHARED' | null;
  note: string | null;
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

type WorkspaceSupport = Awaited<ReturnType<typeof loadSupportRows>>;
const plannedCarrier = alias(s.customers, 'cus_workspace_planned_carrier');
const actualCarrier = alias(s.customers, 'cus_workspace_actual_carrier');
const billingSourceTrip = alias(s.trips, 'cus_workspace_billing_source_trip');
const billingExpenseTrip = alias(s.trips, 'cus_workspace_billing_expense_trip');
// Sort-only join for the container workboard's lift-site column (1:1 on the
// container's port reference; snapshot fallbacks live in the sort SQL below).
const liftPort = alias(s.ports, 'cus_container_lift_port');

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

// Sums numeric strings preserving `scale` decimal places. Returns null when no
// value is present, so callers can fall back to the shipment-level figure for
// historical rows that predate per-container cargo tracking.
function sumDecimal(values: Array<string | null | undefined>, scale: number): string | null {
  const present = values.filter((value): value is string => value != null && value !== '');
  if (present.length === 0) return null;
  const total = present.reduce<number>((sum, value) => sum + toNumber(value), 0);
  return total.toFixed(scale);
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

export function deriveTransportDateFromContainerAppointments(appointments: ReadonlyArray<Date | null>): string | null {
  let earliest: string | null = null;
  for (const appointment of appointments) {
    if (appointment == null) continue;
    const localDate = localDateInBusinessZone(appointment);
    if (localDate == null) continue;
    if (earliest == null || localDate < earliest) earliest = localDate;
  }
  return earliest;
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
  let orderIssuedContainers = 0;

  for (const container of containers) {
    const assignment = support.assignmentsByContainer.get(container.id) ?? null;
    const carrierType = assignment?.tripCarrierType ?? assignment?.plannedCarrierType ?? null;
    // "Issued" mirrors the driver-notification gate exactly: a live (not
    // canceled) trips row is the only thing the driver's task list and
    // tap-through match against — planned plates alone never count.
    if (assignment?.tripId != null && assignment.tripStatus !== 'CANCELED') {
      orderIssuedContainers += 1;
    }
    // Own-fleet plates: the dispatch plan already snapshots the truck plate
    // into plannedVehiclePlateNumber at allocation time, so mirror the
    // EXTERNAL fallback chain instead of waiting for the executed trip.
    const plateNumber = carrierType === 'OWN'
      ? assignment?.tripTruckPlate ?? assignment?.plannedVehiclePlateNumber ?? null
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
  const transportDateEditable = actor.role === Role.CUS
    && support.locksByShipment.get(row.shipment.id) == null;

  return {
    scheduleReadiness,
    vehicleReadiness,
    totalContainers,
    assignedContainers,
    externalContainers,
    plateAssignedContainers,
    missingCarrierContainers,
    missingPlateContainers,
    orderIssuedContainers,
    transportDateEditable,
  };
}

function effectiveBillingLineAmount(line: BillingLineRow): number {
  if (line.excluded) return 0;
  if (line.grossAmount != null) return toNumber(line.grossAmount);
  return toNumber(line.amountOverride ?? line.baseAmount);
}

/**
 * Display number for the Chứng từ cell: IMPORT shows the Bill, EXPORT shows
 * the Booking. Falls back to the other when the primary is missing so the
 * cell never hides data that exists.
 */
function billOrBookNumberFor(
  tradeDirection: 'IMPORT' | 'EXPORT' | null,
  blNumber: string | null,
  bookingRef: string | null,
): string | null {
  const bill = trimOrNull(blNumber);
  const booking = trimOrNull(bookingRef);
  return tradeDirection === 'EXPORT' ? (booking ?? bill) : (bill ?? booking);
}

export function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function containerTransportDateSql() {
  // Use the container's appointment date for exact-day filtering. Containers
  // without an appointment inherit the shipment's expected delivery date so
  // they still appear when the user filters by that day.
  return sql<string>`coalesce(
    date(${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh'),
    ${s.shipments.expectedDeliveryDate}
  )`;
}

// ─── Container workboard column sorting ──────────────────────────────────────
//

// Derived columns (carrier, dispatch status, legacy site snapshots) come from
// the first active fulfillment per container — mirroring the support loader's
// first-row-wins projection (assignmentsByContainer). Each is expressed as a
// correlated scalar subquery so it can be sorted WITHOUT joining
// fulfillment/trip rows into the paginated page query, where a join would
// multiply container rows and break LIMIT/OFFSET pagination.

/** Rank mirrors buildContainerLine's dispatchStatus derivation: trip status
 * COMPLETED > IN_TRANSIT > CREATED, then planned-carrier (PLANNED), else
 * UNASSIGNED. Only relative order matters for sorting. */
function containerDispatchRankSql(): SQL {
  return sql`(
    select case
      when t.status = 'COMPLETED' then 4
      when t.status = 'IN_TRANSIT' then 3
      when t.status = 'CREATED' then 2
      when sf.planned_carrier_type is not null then 1
      else 0
    end
    from ${s.shipmentFulfillments} sf
    left join ${s.trips} t
      on t.fulfillment_id = sf.id and t.deleted_at is null and t.status <> 'CANCELED'
    where sf.shipment_container_id = ${s.shipmentContainers.id}
      and sf.canceled_at is null
    order by sf.id, t.id
    limit 1
  )`;
}

/** Rank per record-status filter value — mirrors the case arms above so a
 * dispatchStatus filter selects exactly the rows whose ledger badge shows
 * that status. UNASSIGNED needs no entry: the carrier-presence split already
 * selects it. */
const CONTAINER_DISPATCH_RANKS = {
  PLANNED: 1,
  CREATED: 2,
  IN_TRANSIT: 3,
  COMPLETED: 4,
} as const;

/** Mirrors buildContainerLine's carrierName: own fleet renders as the fixed
 * SilverSea label; otherwise the executed trip's carrier wins over the plan. */
function containerCarrierNameSql(): SQL {
  return sql`(
    select coalesce(
      case when coalesce(t.carrier_type, sf.planned_carrier_type) = 'OWN' then 'SilverSea' end,
      coalesce(nullif(trim(ac.short_name), ''), ac.name),
      coalesce(nullif(trim(pc.short_name), ''), pc.name)
    )
    from ${s.shipmentFulfillments} sf
    left join ${s.trips} t
      on t.fulfillment_id = sf.id and t.deleted_at is null and t.status <> 'CANCELED'
    left join ${s.customers} ac on ac.id = t.external_entity_id
    left join ${s.customers} pc on pc.id = sf.planned_external_carrier_id
    where sf.shipment_container_id = ${s.shipmentContainers.id}
      and sf.canceled_at is null
    order by sf.id, t.id
    limit 1
  )`;
}

/** Legacy rows without port columns fall back to the first fulfillment's
 * site-snapshot label (shortName preferred, then name) for sort parity with
 * the displayed lift site. */
function containerSnapshotLiftSiteSql(): SQL {
  return sql`(
    select coalesce(
      nullif(btrim(sf.site_snapshot->'pickupWarehouse'->>'shortName'), ''),
      nullif(btrim(sf.site_snapshot->'pickupWarehouse'->>'name'), '')
    )
    from ${s.shipmentFulfillments} sf
    where sf.shipment_container_id = ${s.shipmentContainers.id}
      and sf.canceled_at is null
    order by sf.id
    limit 1
  )`;
}

// Whitelist mapping each sortable column's URL key to its sort expression.
// Expressions must yield exactly one value per container row; NULLs sort last
// in both directions via the `nulls last` wrapper at the call site.
function billOrBookNumberSortSql(): SQL {
  return sql`case
    when ${s.shipments.tradeDirection} = 'EXPORT'
      then coalesce(nullif(btrim(${s.shipments.bookingRef}), ''), nullif(btrim(${s.shipments.blNumber}), ''))
    else coalesce(nullif(btrim(${s.shipments.blNumber}), ''), nullif(btrim(${s.shipments.bookingRef}), ''))
  end`;
}

const CONTAINER_SORT_SQL: Record<ShipmentCusContainerSortKey, SQL> = {
  customerName: sql`${CUSTOMER_OPERATIONAL_NAME}`,
  billOrBookNumber: billOrBookNumberSortSql(),
  containerNumber: sql`${s.shipmentContainers.containerNumber}`,
  liftSite: sql`coalesce(${liftPort.name}, ${containerSnapshotLiftSiteSql()})`,
  transportDate: sql`case
    when ${s.shipments.cargoMode} = 'FCL'
      then (${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh')::date
    else ${s.shipments.expectedDeliveryDate}
  end`,
  carrierName: containerCarrierNameSql(),
  customerNotes: sql`${s.shipments.customerNotes}`,
  dispatchStatus: containerDispatchRankSql(),
};

/** Overview-workboard status rank mirrors deriveCusBucket: an active
 * accounting lock is LOCKED, then PENDING_LOCK (approval/completed), RUNNING
 * (dispatched/in-transit), else NEW. Only relative order matters. */
function workspaceBucketRankSql(): SQL {
  return sql`case
    when exists (
      select 1 from ${s.shipmentAccountingLocks} sal
      where sal.shipment_id = ${s.shipments.id} and sal.released_at is null
    ) then 3
    when ${s.shipments.status} in ('DISPATCHED', 'IN_TRANSIT') then 2
    when ${s.shipments.status} in ('PENDING_EXPENSE_APPROVAL', 'COMPLETED') then 1
    else 0
  end`;
}

// Same whitelist contract for the overview workboard's grouped columns.
const WORKSPACE_SORT_SQL: Record<ShipmentCusWorkspaceSortKey, SQL> = {
  customerName: sql`${CUSTOMER_OPERATIONAL_NAME}`,
  billOrBookNumber: billOrBookNumberSortSql(),
  shippingLineName: sql`${s.shipments.shippingLineName}`,
  cargoWeightKg: sql`${s.shipments.cargoWeightKg}`,
  transportDate: sql`${s.shipments.expectedDeliveryDate}`,
  customerNotes: sql`${s.shipments.customerNotes}`,
  status: workspaceBucketRankSql(),
};

// ─── "Chưa cập nhật" completeness (real FCL container rows only) ─────────────
//
// Mirrors the JS projection exactly so the SQL filter, the item query, and the
// count query always agree on which rows are incomplete. Vehicle fields are
// staged: carrier counts only after a transport date exists, and BKS only for
// an external carrier (own-fleet plates come from the dispatch trip and are
// never a CUS-entered completeness gap).
//
// Fulfillment/trip lookups are correlated scalar subqueries rather than joins:
// the container page queries only join shipments/customers/routes, and a join
// could fan out container rows and corrupt pagination counts. Precedence is
// trip value ?? planned value with canceled fulfillments ignored — identical
// to the in-memory assignmentsByContainer projection.

function activeTripCarrierTypeSql(): SQL {
  return sql`(select ${s.trips.carrierType}
    from ${s.shipmentFulfillments}
    join ${s.trips} on ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id}
      and ${s.trips.deletedAt} is null
      and ${s.trips.status} <> 'CANCELED'
    where ${s.shipmentFulfillments.shipmentContainerId} = ${s.shipmentContainers.id}
      and ${s.shipmentFulfillments.canceledAt} is null
    limit 1)`;
}

function activePlannedCarrierTypeSql(): SQL {
  return sql`(select ${s.shipmentFulfillments.plannedCarrierType}
    from ${s.shipmentFulfillments}
    where ${s.shipmentFulfillments.shipmentContainerId} = ${s.shipmentContainers.id}
      and ${s.shipmentFulfillments.canceledAt} is null
    limit 1)`;
}

function activeCarrierTypeSql(): SQL {
  return sql`coalesce(${activeTripCarrierTypeSql()}, ${activePlannedCarrierTypeSql()})`;
}

function activeTripPlateSql(): SQL {
  return sql`(select ${s.trips.externalPlateNumber}
    from ${s.shipmentFulfillments}
    join ${s.trips} on ${s.trips.fulfillmentId} = ${s.shipmentFulfillments.id}
      and ${s.trips.deletedAt} is null
      and ${s.trips.status} <> 'CANCELED'
    where ${s.shipmentFulfillments.shipmentContainerId} = ${s.shipmentContainers.id}
      and ${s.shipmentFulfillments.canceledAt} is null
    limit 1)`;
}

function activePlannedPlateSql(): SQL {
  return sql`(select ${s.shipmentFulfillments.plannedVehiclePlateNumber}
    from ${s.shipmentFulfillments}
    where ${s.shipmentFulfillments.shipmentContainerId} = ${s.shipmentContainers.id}
      and ${s.shipmentFulfillments.canceledAt} is null
    limit 1)`;
}

// Lift/drop presence in SQL mirrors resolveLiftSite/resolveDropoffSite: the
// per-container port column is the authority (port row must exist, matching
// the JS portsById lookup); the snapshot half only counts when it is a JSON
// object (readSiteSnapshotSite's presence rule). `is not distinct from`
// keeps a missing fulfillment row (NULL subquery) falsy. The port columns
// carry no DB FK by repo convention, but the write path validates ids
// against s.ports, so a dangling id is unreachable through the API.
function portRowExistsSql(column: SQL | Column): SQL {
  return sql`exists (select 1 from ${s.ports} where ${s.ports.id} = ${column})`;
}

function siteSnapshotHalfIsObjectSql(key: 'pickupWarehouse' | 'deliverySite'): SQL {
  return sql`(select jsonb_typeof(${s.shipmentFulfillments.siteSnapshot} -> ${key})
    from ${s.shipmentFulfillments}
    where ${s.shipmentFulfillments.shipmentContainerId} = ${s.shipmentContainers.id}
      and ${s.shipmentFulfillments.canceledAt} is null
    limit 1) is not distinct from 'object'`;
}

// nullif(btrim(x), '') mirrors the JS trimOrNull: null-or-whitespace is absent.
function trimmedPresentSql(value: SQL | Column): SQL {
  return sql`nullif(btrim(${value}), '') is not null`;
}

function containerMissingBitsSql(): SQL[] {
  const transportDate = sql<string>`case when ${s.shipments.cargoMode} = 'FCL'
    then date(${s.shipmentContainers.customerAppointmentAt} at time zone 'Asia/Ho_Chi_Minh')
    else ${s.shipments.expectedDeliveryDate} end`;
  const carrierType = activeCarrierTypeSql();
  return [
    // Shipment context (direction gates Bill/Booking via the DB CHECK).
    sql`${s.shipments.tradeDirection} is null`,
    sql`not (${trimmedPresentSql(s.shipments.blNumber)} or ${trimmedPresentSql(s.shipments.bookingRef)})`,
    sql`not exists (
      select 1 from ${s.shipmentDeclarations}
      where ${s.shipmentDeclarations.shipmentId} = ${s.shipments.id}
        and ${trimmedPresentSql(s.shipmentDeclarations.declarationNumber)}
    )`,
    sql`case when ${s.shipments.cargoMode} = 'FCL'
      then ${s.shipmentContainers.routeId} is null
      else ${s.shipments.routeId} is null end`,
    sql`not (${trimmedPresentSql(s.shipments.shippingLineName)} or ${trimmedPresentSql(s.shipmentContainers.shippingLineName)})`,
    sql`${transportDate} is null`,
    // Container row identity.
    sql`${s.shipmentContainers.containerNumber} is null`,
    sql`${s.shipmentContainers.containerTypeId} is null`,
    sql`not (${portRowExistsSql(s.shipmentContainers.pickupPortId)} or ${siteSnapshotHalfIsObjectSql('pickupWarehouse')})`,
    sql`not (${portRowExistsSql(s.shipmentContainers.dropoffPortId)} or ${siteSnapshotHalfIsObjectSql('deliverySite')})`,
    sql`${s.shipmentContainers.customerAppointmentAt} is null`,
    // Vehicle stage (date-gated carrier; external-only BKS).
    sql`${transportDate} is not null and ${carrierType} is null`,
    sql`${transportDate} is not null and ${carrierType} = 'EXTERNAL'
      and coalesce(${activeTripPlateSql()}, ${activePlannedPlateSql()}) is null`,
  ];
}

function containerIncompleteSql(): SQL {
  const presentBits = containerMissingBitsSql().map((bit) => sql`case when ${bit} then 1 else 0 end`);
  return sql`(${sql.join(presentBits, sql` + `)}) > 0`;
}

// Overview priority rank: Cont 20 → Cont 40 → other Cont → Lẻ → unknown.
// Determined from ACTIVE containers' canonical type code/name (any active 20-foot
// container wins before any active 40-foot one per the accepted mixed-lot
// rule), never from the rendered summary string.
function cargoRankSql(): SQL {
  const activeContainer = (size: string) => sql`exists (
    select 1
    from ${s.shipmentContainers}
    left join ${s.containerTypes} on ${s.containerTypes.id} = ${s.shipmentContainers.containerTypeId}
    where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
      and (
        ${s.containerTypes.code} ~* ${`(^|[^0-9])${size}([^0-9]|$)`}
        or ${s.containerTypes.name} ~* ${`(^|[^0-9])${size}([^0-9]|$)`}
      )
  )`;
  return sql`(case
    when ${activeContainer('20')} then 0
    when ${activeContainer('40')} then 1
    when ${s.shipments.cargoMode} = 'FCL' then 2
    when ${s.shipments.cargoMode} = 'LCL' then 3
    else 4
  end)`;
}

const postDispatchDirectShipmentFields = new Set<keyof ShipmentCusWorkspaceListItem['fieldAccess']>([
  'bookingRef', 'blNumber', 'closingAt', 'plannedReturnAt', 'customerNotes', 'operationalNotes',
]);

const allShipmentFieldKeys = [
  'customerId', 'factoryName', 'routeId', 'deliveryLocation', 'blNumber', 'bookingRef',
  'declarationNumber', 'tradeDirection', 'shippingLineName', 'packageCount', 'packageType',
  'cargoWeightKg', 'cargoVolumeCbm', 'customsCutoffAt', 'closingAt', 'plannedReturnAt',
  'customerNotes', 'operationalNotes',
] as const satisfies ReadonlyArray<keyof ShipmentCusWorkspaceListItem['fieldAccess']>;

function readOnly(reason: string): ShipmentCusWorkspaceFieldAccess {
  return { mode: 'READ_ONLY', reason };
}

function shipmentFieldAccess(
  shipment: ShipmentRow,
  actor: AuthUser,
  hasActiveLock: boolean,
  hasContainers: boolean,
): ShipmentCusWorkspaceListItem['fieldAccess'] {
  const access = {} as ShipmentCusWorkspaceListItem['fieldAccess'];
  const canWriteShipment = actor.role === Role.CUS || actor.role === Role.ADMIN || actor.role === Role.MANAGER;
  const preDispatch = canonicalShipmentStatus(shipment.status) === ShipmentStatus.PENDING_DATE
    || canonicalShipmentStatus(shipment.status) === ShipmentStatus.READY_FOR_DISPATCH;
  for (const field of allShipmentFieldKeys) {
    if (field === 'declarationNumber') {
      access[field] = !canWriteShipment
        ? readOnly('Chỉ CUS, Quản trị hoặc Quản lý được cập nhật tờ khai.')
        : hasActiveLock
          ? readOnly('Lô hàng đã khóa kế toán; không thể sửa tờ khai.')
          : { mode: 'DIRECT', reason: 'Cập nhật tờ khai trực tiếp theo lô hàng.' };
      continue;
    }
    if (hasActiveLock) {
      access[field] = readOnly('Lô hàng đã khóa kế toán; không thể thay đổi dữ liệu vận hành.');
    } else if (!canWriteShipment) {
      access[field] = readOnly('Vai trò hiện tại chỉ được xem trường này.');
    } else if (hasContainers && (field === 'cargoWeightKg' || field === 'cargoVolumeCbm')) {
      access[field] = readOnly('Số liệu hiển thị là tổng theo container; hãy cập nhật từng container.');
    } else if (actor.role === Role.CUS && !preDispatch && !postDispatchDirectShipmentFields.has(field)) {
      access[field] = { mode: 'REQUEST', reason: 'Thay đổi sau điều xe cần gửi yêu cầu để Điều vận xem xét.' };
    } else {
      access[field] = { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp trường này.' };
    }
  }
  return access;
}

function containerFieldAccess(
  actor: AuthUser,
  hasActiveLock: boolean,
  hasTrip: boolean,
  pastRunCutoff: boolean,
): ShipmentCusWorkspaceContainerLine['fieldAccess'] {
  const editable = !hasActiveLock && !hasTrip && (actor.role === Role.CUS || actor.role === Role.DISPATCHER);
  const reason = hasActiveLock
    ? 'Lô hàng đã khóa kế toán; không thể thay đổi container.'
    : hasTrip
      ? 'Container đã có chuyến thực tế; hãy dùng luồng điều chỉnh điều vận.'
      : actor.role !== Role.CUS && actor.role !== Role.DISPATCHER
        ? 'Vai trò hiện tại chỉ được xem dữ liệu container.'
        : 'Bạn có thể cập nhật trực tiếp trước khi điều xe.';
  const mode = editable ? 'DIRECT' as const : 'READ_ONLY' as const;
  // Route/container-number/pickup-drop-off stay CUS-editable through the
  // container's own run date even once a trip exists — past that date (or
  // once a trip exists), CUS submits an admin-reviewed request instead of
  // hitting the flat READ_ONLY every other field gets. Scoped to CUS only;
  // DISPATCHER keeps the existing trip-based DIRECT/READ_ONLY split.
  const dateGatedFields = new Set(['containerNumber', 'routeId', 'liftSiteId', 'dropoffSiteId']);
  const access = (key: keyof ShipmentCusWorkspaceContainerLine['fieldAccess']): ShipmentCusWorkspaceFieldAccess => {
    // plateNumber intentionally has no OWN special case: since the internal
    // fleet became plan-able (Cap_nhat_UI_va_logic 1.3) the field follows the
    // generic editable/READ_ONLY mode, mirroring permissions.plateEditable —
    // the plate is a plan; the official dispatch trip confirms it.
    if (dateGatedFields.has(key) && actor.role === Role.CUS && !hasActiveLock) {
      if (hasTrip || pastRunCutoff) {
        return {
          mode: 'REQUEST',
          reason: hasTrip
            ? 'Container đã có chuyến thực tế; thay đổi cần gửi yêu cầu để quản trị/quản lý phê duyệt.'
            : 'Đã qua ngày chạy container; thay đổi cần gửi yêu cầu để quản trị/quản lý phê duyệt.',
        };
      }
      return { mode: 'DIRECT', reason: 'Bạn có thể cập nhật trực tiếp trước khi điều xe.' };
    }
    return { mode, reason };
  };
  return {
    containerNumber: access('containerNumber'), containerTypeId: access('containerTypeId'),
    cargoWeightKg: access('cargoWeightKg'), cargoVolumeCbm: access('cargoVolumeCbm'),
    routeId: access('routeId'),
    carrierType: access('carrierType'), externalCarrierId: access('externalCarrierId'),
    externalCarrierVehicleId: access('externalCarrierVehicleId'), plateNumber: access('plateNumber'),
    liftSiteId: access('liftSiteId'), dropoffSiteId: access('dropoffSiteId'),
    customerAppointmentAt: access('customerAppointmentAt'),
  };
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map(trimOrNull).filter((value): value is string => value != null))];
}

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
 * CUS uses the full clerk scope (unit + customer/shipment assignment) — the
 * same rule `assertClerkCanAccessShipment` enforces on detail/update — so a
 * row listed here is always actionable. Customer-link-only filtering would
 * surface shipments whose writes 404 (e.g. responsible_unit_id IS NULL).
 * Async because the clerk scope is loaded from the link tables.
 */
async function buildScopeConditions(actor: AuthUser): Promise<SQL[]> {
  if (
    actor.role === Role.ADMIN
    || actor.role === Role.MANAGER
    || actor.role === Role.ACCOUNTANT
    || actor.role === Role.DISPATCHER
  ) {
    return [];
  }
  if (actor.role === Role.CUS) {
    const scope = await loadClerkShipmentScope(actor.userId);
    return [buildShipmentScopeWhere(scope)];
  }
  if (actor.customerIds?.length) return [inArray(s.shipments.customerId, actor.customerIds)];
  if (actor.customerId != null) return [eq(s.shipments.customerId, actor.customerId)];
  return [];
}

export async function assertCusShipmentScope(actor: AuthUser, shipment: ShipmentRow, tx: Tx) {
  if (actor.role !== Role.CUS) return;
  const scope = await loadClerkShipmentScope(actor.userId, tx);
  assertClerkCanAccessShipment(scope, shipment);
}

function deriveCusBucket(status: string | null, hasActiveLock: boolean): ShipmentCusBucket {
  if (hasActiveLock) return ShipmentCusBucket.LOCKED;
  const canonical = canonicalShipmentStatus(status);
  if (canonical === ShipmentStatus.DISPATCHED || canonical === ShipmentStatus.IN_TRANSIT) {
    return ShipmentCusBucket.RUNNING;
  }
  if (canonical === ShipmentStatus.PENDING_EXPENSE_APPROVAL) {
    return ShipmentCusBucket.PENDING_LOCK;
  }
  if (canonical === ShipmentStatus.COMPLETED) {
    return ShipmentCusBucket.LOCKED;
  }
  return ShipmentCusBucket.NEW;
}

function countContainerTypes(rows: ContainerRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = row.containerTypeCode ?? row.containerTypeName ?? 'Cont';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, qty]) => `${qty}x${label}`).join(' + ');
}

function buildContainerSummary(rows: ContainerRow[], packageCount: number | null, packageType: string | null): string {
  if (rows.length === 0) {
    if (packageCount == null) return '';
    return `${packageCount} ${trimOrNull(packageType) ?? 'kiện'}`;
  }
  return countContainerTypes(rows);
}

/**
 * Group a lot's containers by (appointment instant, effective factory) so the
 * "Lịch trình & điều xe" cell can show every close/return time on its own
 * line ("09:00 25/08/2026 · Sunrise · 1x40HC"). Factory resolves through the
 * SILVER L1 precedence chain (container site → shipment site → shipment
 * factory text). Containers without an appointment are skipped; groups are
 * ordered earliest-first, then factory name. Legacy noon-UTC date-only
 * encodings retain their stored calendar date.
 */
function buildAppointmentGroups(
  containers: ContainerRow[],
  shipment: ShipmentRow,
  factoryNameBySiteId: Map<number, { shortName: string; fullName: string }>,
): Array<{ at: string; localDate: string; factoryName: string | null; factoryShortName: string | null; factoryFullName: string | null; containerSummary: string }> {
  const byKey = new Map<string, { at: string; localDate: string; factoryName: string | null; factoryShortName: string | null; factoryFullName: string | null; group: ContainerRow[] }>();
  for (const container of containers) {
    if (container.customerAppointmentAt == null) continue;
    const localDate = localDateInBusinessZone(container.customerAppointmentAt) ?? '0000-00-00';
    const factorySiteId = container.operationalSiteId ?? shipment.operationalSiteId ?? null;
    const factorySite = factorySiteId != null
      ? factoryNameBySiteId.get(factorySiteId)
      : null;
    const legacyFactoryName = trimOrNull(shipment.factoryName);
    const factoryShortName = factorySite?.shortName ?? legacyFactoryName ?? null;
    const factoryFullName = factorySite?.fullName ?? legacyFactoryName ?? null;
    const factoryName = factoryShortName;
    const factoryKey = factorySite != null && factorySiteId != null
      ? `site:${factorySiteId}`
      : `legacy:${factoryFullName ?? ''}`;
    const at = container.customerAppointmentAt.toISOString();
    const key = `${at}|${factoryKey}`;
    const entry = byKey.get(key);
    if (entry) {
      entry.group.push(container);
    } else {
      byKey.set(key, { at, localDate, factoryName, factoryShortName, factoryFullName, group: [container] });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.at.localeCompare(b.at)
      || (a.factoryName ?? '').localeCompare(b.factoryName ?? ''))
    .map(({ at, localDate, factoryName, factoryShortName, factoryFullName, group }) => ({
      at,
      localDate,
      factoryName,
      factoryShortName,
      factoryFullName,
      containerSummary: countContainerTypes(group),
    }));
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
    name: typeof site.shortName === 'string'
      ? site.shortName
      : typeof site.name === 'string' ? site.name : null,
    siteType: typeof site.siteType === 'string' ? site.siteType : null,
  };
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
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
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
      tripCarrierType: s.trips.carrierType,
      tripExternalCarrierId: s.trips.externalEntityId,
      tripExternalCarrierVehicleId: s.trips.externalCarrierVehicleId,
      tripExternalCarrierName: actualCarrier.name,
      tripExternalCarrierShortName: actualCarrier.shortName,
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
  for (const row of assignmentRows) {
    if (row.shipmentContainerId == null || assignmentsByContainer.has(row.shipmentContainerId)) continue;
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
    recoveryFactsByShipment,
    factoryNameBySiteId,
    portsById,
  };
}

async function loadSelectors(customerId: number, executor: Executor = db) {
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
        eq(s.operationalSites.customerId, customerId),
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

function buildListItem(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  actor: AuthUser,
  confirmation: Awaited<ReturnType<typeof getShipmentFinanceConfirmationSummary>>,
  dateRange?: { dateFrom?: string; dateTo?: string },
): ShipmentCusWorkspaceListItem {
  const allContainers = support.containersByShipment.get(row.shipment.id) ?? [];
  const containers = dateRange
    ? filterContainersByDateRange(
      allContainers,
      dateRange.dateFrom,
      dateRange.dateTo,
      // Undated containers plan by the shipment's delivery date — the same
      // fallback containerTransportDateSql() uses for the row filter, so the
      // scoped summary never zero-counts a row the filter still shows.
      () => row.shipment.expectedDeliveryDate,
    )
    : allContainers;
  const activeLock = support.locksByShipment.get(row.shipment.id) ?? null;
  const debitNote = support.debitNotesByShipment.get(row.shipment.id) ?? null;
  const custody = support.custodyByShipment.get(row.shipment.id) ?? null;
  const trips = support.tripsByShipment.get(row.shipment.id) ?? [];
  const recoveryFacts = support.recoveryFactsByShipment.get(row.shipment.id) ?? [];
  const declaration = support.declarationByShipment.get(row.shipment.id) ?? null;
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
  const assignments = containers.map((container) => support.assignmentsByContainer.get(container.id) ?? null);
  const liftSiteNames = uniqueNonEmpty(assignments.map((assignment) => (
    readSiteSnapshotSite(assignment?.siteSnapshot ?? null, 'pickupWarehouse')?.name
  )));
  const dropoffSiteNames = uniqueNonEmpty(assignments.map((assignment) => (
    readSiteSnapshotSite(assignment?.siteSnapshot ?? null, 'deliverySite')?.name
  )));
  const customerAppointmentAts = uniqueNonEmpty(containers.map((container) => (
    container.customerAppointmentAt?.toISOString() ?? null
  )));
  const appointmentGroups = buildAppointmentGroups(
    containers,
    row.shipment,
    support.factoryNameBySiteId,
  );
  // Multi-factory display (SILVER L1 P3): distinct effective factory labels
  // across containers — never a false single factory. Falls back to the
  // shipment-level factory text when no container names a site.
  const containerFactoryNames = uniqueNonEmpty(containers.map((container) => (
    container.operationalSiteId != null
      ? support.factoryNameBySiteId.get(container.operationalSiteId)?.shortName ?? null
      : null
  )));
  const effectiveFactoryNames = containerFactoryNames.length > 0
    ? containerFactoryNames
    : uniqueNonEmpty([
        row.shipment.operationalSiteId != null
          ? support.factoryNameBySiteId.get(row.shipment.operationalSiteId)?.shortName ?? null
          : null,
        trimOrNull(row.shipment.factoryName),
      ]);
  const effectiveRouteNames = row.shipment.cargoMode === CARGO_MODE.FCL
    ? uniqueNonEmpty(containers.map((container) => container.routeName ?? row.routeName))
    : uniqueNonEmpty([row.routeName]);
  const carrierAssignments = assignments.reduce<Array<{ carrierName: string | null; plateNumber: string | null }>>((result, assignment) => {
    if (assignment == null) return result;
    const carrierType = assignment.tripCarrierType ?? assignment.plannedCarrierType ?? null;
    const carrierName = carrierType === 'OWN'
      ? 'SilverSea'
      : (assignment.tripExternalCarrierShortName?.trim() || assignment.tripExternalCarrierName)
        ?? (assignment.plannedCarrierShortName?.trim() || assignment.plannedCarrierName)
        ?? null;
    const plateNumber = trimOrNull(carrierType === 'OWN'
      ? assignment.tripTruckPlate ?? assignment.plannedVehiclePlateNumber
      : assignment.tripExternalPlateNumber ?? assignment.plannedVehiclePlateNumber);
    if (carrierName == null && plateNumber == null) return result;
    if (!result.some((item) => item.carrierName === carrierName && item.plateNumber === plateNumber)) {
      result.push({ carrierName, plateNumber });
    }
    return result;
  }, []);

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
    status: canonicalShipmentStatus(row.shipment.status) ?? ShipmentStatus.PENDING_DATE,
    cargoMode: row.shipment.cargoMode,
    bucket,
    bucketLabel: SHIPMENT_CUS_BUCKET_LABELS[bucket],
    customerName: row.customerName,
    factoryName: trimOrNull(row.shipment.factoryName),
    effectiveFactoryNames,
    billOrBookNumber: billOrBookNumberFor(row.shipment.tradeDirection, row.shipment.blNumber, row.shipment.bookingRef),
    declarationNumber: declaration?.declarationNumber ?? null,
    shippingLineName: trimOrNull(row.shipment.shippingLineName),
    // A lot overview may summarize multiple FCL routes, but individual
    // container rows retain the exact route that drives dispatch.
    routeName: effectiveRouteNames.join(' · ') || null,
    isCombined: row.shipment.isCombined,
    direction: row.shipment.tradeDirection,
    containerSummary: buildContainerSummary(containers, row.shipment.packageCount, row.shipment.packageType),
    packageCount: row.shipment.packageCount,
    packageType: trimOrNull(row.shipment.packageType),
    weightKg: sumDecimal(containers.map((container) => container.cargoWeightKg), 2)
      ?? (row.shipment.cargoWeightKg == null ? null : String(row.shipment.cargoWeightKg)),
    volumeCbm: sumDecimal(containers.map((container) => container.cargoVolumeCbm), 3)
      ?? (row.shipment.cargoVolumeCbm == null ? null : String(row.shipment.cargoVolumeCbm)),
    transportDate: row.shipment.cargoMode === CARGO_MODE.FCL
      ? (() => {
          const earliest = containers
            .map((container) => container.customerAppointmentAt)
            .filter((value): value is Date => value != null)
            .sort((left, right) => left.getTime() - right.getTime())[0];
          return earliest ? localDateInBusinessZone(earliest) : null;
        })()
      : row.shipment.expectedDeliveryDate,
    customsCutoffAt: row.shipment.customsCutoffAt?.toISOString() ?? null,
    closingAt: row.shipment.closingAt?.toISOString() ?? null,
    plannedReturnAt: row.shipment.plannedReturnAt?.toISOString() ?? null,
    deliveryLocation: trimOrNull(row.shipment.deliveryLocation),
    liftSiteNames,
    dropoffSiteNames,
    customerAppointmentAts,
    appointmentGroups,
    carrierAssignments,
    customerNotes: trimOrNull(row.shipment.customerNotes),
    operationalNotes: trimOrNull(row.shipment.operationalNotes),
    raw: {
      customerId: row.shipment.customerId,
      factoryName: trimOrNull(row.shipment.factoryName),
      routeId: row.shipment.routeId,
      deliveryLocation: trimOrNull(row.shipment.deliveryLocation),
      blNumber: trimOrNull(row.shipment.blNumber),
      bookingRef: trimOrNull(row.shipment.bookingRef),
      declarationNumber: declaration?.declarationNumber ?? null,
      tradeDirection: row.shipment.tradeDirection,
      shippingLineName: trimOrNull(row.shipment.shippingLineName),
      packageCount: row.shipment.packageCount,
      packageType: trimOrNull(row.shipment.packageType),
      cargoWeightKg: row.shipment.cargoWeightKg == null ? null : String(row.shipment.cargoWeightKg),
      cargoVolumeCbm: row.shipment.cargoVolumeCbm == null ? null : String(row.shipment.cargoVolumeCbm),
      customsCutoffAt: row.shipment.customsCutoffAt?.toISOString() ?? null,
      closingAt: row.shipment.closingAt?.toISOString() ?? null,
      plannedReturnAt: row.shipment.plannedReturnAt?.toISOString() ?? null,
      customerNotes: trimOrNull(row.shipment.customerNotes),
      operationalNotes: trimOrNull(row.shipment.operationalNotes),
      declarationId: declaration?.id ?? null,
      declarationIssuedAt: declaration?.issuedAt?.toISOString() ?? null,
      declarationScope: declaration?.scope ?? null,
      declarationNote: trimOrNull(declaration?.note),
    },
    fieldAccess: shipmentFieldAccess(row.shipment, actor, activeLock != null, containers.length > 0),
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

// Lift/drop authority is the per-container port columns (same columns the
// create form writes). The fulfillment site-snapshot remains the fallback
// for legacy rows decomposed before ports existed. The missing-status bits
// in containerMissingFields/containerMissingBitsSql resolve through the
// same helpers so a row can never display a site name while its status
// still says "Chưa cập nhật" (or the reverse).
function resolveLiftSite(
  support: WorkspaceSupport,
  container: ContainerRow,
  assignment: AssignmentRow | null,
) {
  return container.pickupPortId != null
    ? support.portsById.get(container.pickupPortId) ?? null
    : readSiteSnapshotSite(assignment?.siteSnapshot ?? null, 'pickupWarehouse');
}

function resolveDropoffSite(
  support: WorkspaceSupport,
  container: ContainerRow,
  assignment: AssignmentRow | null,
) {
  return container.dropoffPortId != null
    ? support.portsById.get(container.dropoffPortId) ?? null
    : readSiteSnapshotSite(assignment?.siteSnapshot ?? null, 'deliverySite');
}

function buildContainerLine(
  row: ShipmentListRow,
  actor: AuthUser,
  support: WorkspaceSupport,
  container: ContainerRow,
  ordinal: number,
): ShipmentCusWorkspaceContainerLine {
  const assignment = support.assignmentsByContainer.get(container.id) ?? null;
  const activeLock = support.locksByShipment.get(row.shipment.id) ?? null;
  const editableBase = activeLock == null && (actor.role === Role.CUS || actor.role === Role.DISPATCHER);
  const canEditOperational = editableBase && assignment?.tripId == null;
  const liftSite = resolveLiftSite(support, container, assignment);
  const dropoffSite = resolveDropoffSite(support, container, assignment);
  const carrierType = assignment?.tripCarrierType ?? assignment?.plannedCarrierType ?? null;
  const externalCarrierId = assignment?.tripExternalCarrierId ?? assignment?.plannedExternalCarrierId ?? null;
  const carrierName = carrierType === 'OWN'
    ? 'SilverSea'
    : (assignment?.tripExternalCarrierShortName?.trim() || assignment?.tripExternalCarrierName)
      ?? (assignment?.plannedCarrierShortName?.trim() || assignment?.plannedCarrierName)
      ?? null;
  // CUS may plan the plate for BOTH external carriers and the internal fleet
  // (customer ask, Cap_nhat_UI_va_logic 1.3): the value is a plan; the
  // official dispatch trip remains the confirming source once assigned.
  const plateEditable = canEditOperational;
  const dispatchStatus = assignment?.tripStatus === 'COMPLETED'
    ? 'COMPLETED'
    : assignment?.tripStatus === 'IN_TRANSIT'
      ? 'IN_TRANSIT'
      : assignment?.tripStatus === 'CREATED'
        ? 'CREATED'
        : assignment?.plannedCarrierType
          ? 'PLANNED'
          : 'UNASSIGNED';

  return {
    id: container.id,
    ordinal,
    containerNumber: container.containerNumber,
    containerTypeId: container.containerTypeId,
    containerTypeLabel: container.containerTypeCode ?? container.containerTypeName,
    routeId: row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeId : row.shipment.routeId,
    routeName: row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeName : row.routeName,
    dispatchStatus,
    carrierType: carrierType as 'OWN' | 'EXTERNAL' | null,
    externalCarrierId,
    externalCarrierVehicleId: assignment?.tripExternalCarrierVehicleId ?? assignment?.plannedExternalCarrierVehicleId ?? null,
    carrierName,
    plateNumber: carrierType === 'OWN'
      ? assignment?.tripTruckPlate ?? assignment?.plannedVehiclePlateNumber ?? null
      : assignment?.tripExternalPlateNumber ?? assignment?.plannedVehiclePlateNumber ?? null,
    liftSiteId: container.pickupPortId ?? liftSite?.id ?? null,
    liftSite: liftSite?.name ?? null,
    dropoffSiteId: container.dropoffPortId ?? dropoffSite?.id ?? null,
    dropoffSite: dropoffSite?.name ?? null,
    customerAppointmentAt: container.customerAppointmentAt?.toISOString() ?? null,
    raw: {
      containerNumber: container.containerNumber,
      containerTypeId: container.containerTypeId,
      cargoWeightKg: container.cargoWeightKg,
      cargoVolumeCbm: container.cargoVolumeCbm,
      routeId: row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeId : row.shipment.routeId,
    },
    fieldAccess: containerFieldAccess(
      actor,
      activeLock != null,
      assignment?.tripId != null,
      isPastRunCutoff(container.customerAppointmentAt),
    ),
    permissions: {
      carrierEditable: canEditOperational,
      plateEditable,
      containerTypeEditable: canEditOperational,
      liftSiteEditable: canEditOperational,
      dropoffSiteEditable: canEditOperational,
      customerAppointmentEditable: canEditOperational,
      routeEditable: canEditOperational,
    },
    shipmentVersion: row.shipment.version,
    relatedTripVersion: assignment?.tripVersion ?? null,
  };
}

// JS twin of containerMissingBitsSql(): identical field set, applicability
// gating, and precedence so the projected missingFields list can never
// disagree with the SQL informationStatus=MISSING filter.
function containerMissingFields(
  row: ShipmentListRow,
  support: WorkspaceSupport,
  container: ContainerRow,
  assignment: AssignmentRow | null,
): ShipmentCusMissingField[] {
  const missing: ShipmentCusMissingFieldCode[] = [];
  const transportDate = row.shipment.cargoMode === CARGO_MODE.FCL
    ? (container.customerAppointmentAt ? localDateInBusinessZone(container.customerAppointmentAt) : null)
    : row.shipment.expectedDeliveryDate;
  const carrierType = assignment?.tripCarrierType ?? assignment?.plannedCarrierType ?? null;
  const push = (code: ShipmentCusMissingFieldCode, absent: boolean) => {
    if (absent) missing.push(code);
  };
  // Shipment context.
  push('DIRECTION', row.shipment.tradeDirection == null);
  push('BILL_BOOKING', !(trimOrNull(row.shipment.blNumber) || trimOrNull(row.shipment.bookingRef)));
  push('DECLARATION', !support.declarationByShipment.has(row.shipment.id));
  push('ROUTE', (row.shipment.cargoMode === CARGO_MODE.FCL ? container.routeId : row.shipment.routeId) == null);
  push('SHIPPING_LINE', !(trimOrNull(row.shipment.shippingLineName) || trimOrNull(container.shippingLineName)));
  push('TRANSPORT_DATE', transportDate == null);
  // Container row.
  push('CONTAINER_NUMBER', container.containerNumber == null);
  push('CONTAINER_TYPE', container.containerTypeId == null);
  push('LIFT_SITE', resolveLiftSite(support, container, assignment) == null);
  push('DROPOFF_SITE', resolveDropoffSite(support, container, assignment) == null);
  push('APPOINTMENT', container.customerAppointmentAt == null);
  // Vehicle stage: carrier only after a transport date exists; BKS only for
  // an external carrier (own-fleet plates come from the dispatch trip).
  push('CARRIER', transportDate != null && carrierType == null);
  push('BKS', transportDate != null
    && carrierType === 'EXTERNAL'
    && (assignment?.tripExternalPlateNumber ?? assignment?.plannedVehiclePlateNumber) == null);
  return missing.map((code) => ({ code, label: SHIPMENT_CUS_MISSING_FIELD_LABELS[code] }));
}

export async function loadShipmentRow(
  shipmentId: number,
  actor: AuthUser,
  executor: Executor = db,
) {
  const [row] = await executor.select({
    shipment: s.shipments,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    routeName: ROUTE_OPERATIONAL_NAME,
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
  if (query.direction) {
    conditions.push(eq(s.shipments.tradeDirection, query.direction));
  }
  if (query.searchSuffix) {
    const suffix = `%${query.searchSuffix}`;
    conditions.push(or(
      ilike(s.shipments.blNumber, suffix),
      ilike(s.shipments.bookingRef, suffix),
      searchMode === 'container'
        ? ilike(s.shipmentContainers.containerNumber, suffix)
        : sql`exists (
            select 1
            from ${s.shipmentContainers}
            where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
              and ${s.shipmentContainers.containerNumber} ilike ${suffix}
          )`,
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
  // Detail-only completeness triage: real FCL container rows whose applicable
  // operational fields are not yet filled. LCL lots are explicitly excluded —
  // they never appear on this container workboard.
  if (searchMode === 'container' && 'informationStatus' in query && query.informationStatus === 'MISSING') {
    conditions.push(eq(s.shipments.cargoMode, 'FCL'));
    conditions.push(containerIncompleteSql());
  }
  // Detail-only dispatch triage: ASSIGNED = the container line has any active
  // carrier (trip first, planned as fallback), UNASSIGNED is its complement —
  // exactly the rows the ledger badges "Chưa điều xe". Every other value is a
  // record status and filters on the badge derivation itself (the same rank
  // expression that orders the Trạng thái column).
  if (searchMode === 'container' && 'dispatchStatus' in query) {
    if (query.dispatchStatus === 'ASSIGNED') conditions.push(sql`${activeCarrierTypeSql()} is not null`);
    else if (query.dispatchStatus === 'UNASSIGNED') conditions.push(sql`${activeCarrierTypeSql()} is null`);
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
        customerName: CUSTOMER_OPERATIONAL_NAME,
        routeName: ROUTE_OPERATIONAL_NAME,
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
    flatRows.push({
      id: line.id,
      shipmentId: row.shipment.id,
      shipmentVersion: row.shipment.version,
      ordinal: line.ordinal,
      customerId: row.shipment.customerId,
      customerName: row.customerName,
      factoryName: trimOrNull(row.shipment.factoryName),
      routeName: line.routeName,
      billOrBookNumber: billOrBookNumberFor(row.shipment.tradeDirection, row.shipment.blNumber, row.shipment.bookingRef),
      declarationNumber: support.declarationByShipment.get(row.shipment.id)?.declarationNumber ?? null,
      shippingLineName: trimOrNull(row.shipment.shippingLineName) ?? trimOrNull(container.shippingLineName),
      isCombined: row.shipment.isCombined,
      classification: support.assignmentsByContainer.get(container.id)?.dispatchClassification
        ?? (row.shipment.cargoMode === CARGO_MODE.LCL ? 'LCL' : 'SINGLE'),
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
      vehicleReadOnlyReason: line.permissions.carrierEditable || line.permissions.plateEditable
        ? null
        : line.fieldAccess.carrierType.reason,
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
