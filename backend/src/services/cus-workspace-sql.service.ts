/**
 * CUS workspace SQL fragments — operational-name expressions, join aliases,
 * and SQL fragment factories/sort tables for the CUS shipment workspace
 * readers. Moved verbatim from cus-shipment-workspace-reads.service.ts, which
 * re-exports every symbol so consumer imports are unchanged. Acyclic rule:
 * readers (main) and mapping import FROM this leaf, never the reverse.
 */
import { sql, type Column, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type ShipmentCusContainerSortKey, type ShipmentCusWorkspaceSortKey } from '@tingting/shared';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';

export const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);
export const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);

const plannedCarrier = alias(s.customers, 'cus_workspace_planned_carrier');
const actualCarrier = alias(s.customers, 'cus_workspace_actual_carrier');
const billingSourceTrip = alias(s.trips, 'cus_workspace_billing_source_trip');
const billingExpenseTrip = alias(s.trips, 'cus_workspace_billing_expense_trip');
// Sort-only join for the container workboard's lift-site column (1:1 on the
// container's port reference; snapshot fallbacks live in the sort SQL below).
const liftPort = alias(s.ports, 'cus_container_lift_port');


export function containerTransportDateSql() {
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
 * COMPLETED > IN_TRANSIT > a CREATED trip still missing its ngày đóng/trả;
 * everything else — no trip, or a CREATED trip that already has the
 * appointment — is AWAITING_VEHICLE (rank 0). Only relative order matters
 * for sorting. */
function containerDispatchRankSql(): SQL {
  return sql`(
    select case
      when t.status = 'COMPLETED' then 3
      when t.status = 'IN_TRANSIT' then 2
      when t.status = 'CREATED' and ${s.shipmentContainers.customerAppointmentAt} is null then 1
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
 * that status. AWAITING_VEHICLE needs no entry: it is the coalesced rank-0
 * default (containers without any fulfillment rank 0 too). */
const CONTAINER_DISPATCH_RANKS = {
  CREATED: 1,
  IN_TRANSIT: 2,
  COMPLETED: 3,
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
    left join ${s.tripsComposite} t
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
 * accounting lock — or a driver full-closed (COMPLETED) shipment — is
 * LOCKED, then PENDING_LOCK (approval), RUNNING (dispatched/in-transit),
 * else NEW. Only relative order matters. */
function workspaceBucketRankSql(): SQL {
  return sql`case
    when exists (
      select 1 from ${s.shipmentAccountingLocks} sal
      where sal.shipment_id = ${s.shipments.id} and sal.released_at is null
    ) or ${s.shipments.status} = 'COMPLETED' then 3
    when ${s.shipments.status} in ('DISPATCHED', 'IN_TRANSIT') then 2
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
  return sql`(select ${s.tripsComposite.carrierType}
    from ${s.shipmentFulfillments}
    join ${s.tripsComposite} on ${s.tripsComposite.fulfillmentId} = ${s.shipmentFulfillments.id}
      and ${s.tripsComposite.deletedAt} is null
      and ${s.tripsComposite.status} <> 'CANCELED'
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
  return sql`(select ${s.tripsComposite.externalPlateNumber}
    from ${s.shipmentFulfillments}
    join ${s.tripsComposite} on ${s.tripsComposite.fulfillmentId} = ${s.shipmentFulfillments.id}
      and ${s.tripsComposite.deletedAt} is null
      and ${s.tripsComposite.status} <> 'CANCELED'
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

export {
  ROUTE_OPERATIONAL_NAME, plannedCarrier, actualCarrier, billingSourceTrip, billingExpenseTrip, liftPort,
  containerDispatchRankSql, CONTAINER_DISPATCH_RANKS, containerCarrierNameSql, containerSnapshotLiftSiteSql,
  billOrBookNumberSortSql, CONTAINER_SORT_SQL, workspaceBucketRankSql, WORKSPACE_SORT_SQL,
  activeTripCarrierTypeSql, activePlannedCarrierTypeSql, activeCarrierTypeSql, activeTripPlateSql,
  activePlannedPlateSql, portRowExistsSql, siteSnapshotHalfIsObjectSql, trimmedPresentSql,
  containerMissingBitsSql, containerIncompleteSql, cargoRankSql,
};
