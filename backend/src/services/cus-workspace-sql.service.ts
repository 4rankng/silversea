/**
 * CUS workspace SQL fragments — operational-name expressions, join aliases,
 * and SQL fragment factories/sort tables for the CUS shipment workspace
 * readers. Moved verbatim from cus-shipment-workspace-reads.service.ts, which
 * re-exports every symbol so consumer imports are unchanged. Acyclic rule:
 * readers (main) and mapping import FROM this leaf, never the reverse.
 */
import { and, or, sql, type Column, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type ShipmentCusContainerSortKey, type ShipmentCusWorkspaceSortKey } from '@tingting/shared';
import * as s from '../db/schema';
import { operationalName } from '../db/master-data-name';

export const CUSTOMER_OPERATIONAL_NAME = operationalName(s.customers.shortName, s.customers.name);
const ROUTE_OPERATIONAL_NAME = operationalName(s.routes.shortName, s.routes.name);
export const SITE_OPERATIONAL_NAME = operationalName(s.operationalSites.shortName, s.operationalSites.name);

// Hybrid display names (Lệnh chạy ngoài — MasterDataNhaMay §2.1 rule 4): the
// catalog operational name wins; the shipment's raw free-text stands in when
// no catalog row is linked. Every read surface uses these so ad-hoc rows
// never render an empty cell.
export const CUSTOMER_DISPLAY_NAME = sql<string | null>`coalesce(${CUSTOMER_OPERATIONAL_NAME}, ${s.shipments.rawCustomerName})`;
export const ROUTE_DISPLAY_NAME = sql<string | null>`coalesce(${ROUTE_OPERATIONAL_NAME}, ${s.shipments.rawRouteName})`;

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

/**
 * SIL-434 (QA fail 06/11, build dcaa8295 — lot K-rows printing 06/11/07:11
 * under a 10/11..10/11 filter): a container-less LCL lot row's FILTER day was
 * the EDD leg of {@link containerTransportDateSql}, but its LỊCH TRÌNH cell
 * prints the SIL-645 instant — the stored closingAt/plannedReturnAt
 * (direction-aware cross-fallback, `lotScheduleInstantFor` in
 * shipment-container-ledger-utils.tsx) — so a lot filtered on its EDD could
 * display a day outside the chosen range. The filter must read the SAME day
 * the cell prints: the stored instant's VN day with the exact same
 * precedence (IMPORT prefers plannedReturnAt, EXPORT closingAt; nulls cross-
 * fall back), else the EDD day — `derivedScheduleAt` (SIL-610) is anchored to
 * the EDD's ICT day, so the EDD fallback agrees with that leg too.
 */
export function lotTransportDaySql() {
  return sql<string>`coalesce(
    date(case when ${s.shipments.tradeDirection} = 'IMPORT'
      then coalesce(${s.shipments.plannedReturnAt}, ${s.shipments.closingAt})
      else coalesce(${s.shipments.closingAt}, ${s.shipments.plannedReturnAt}) end
      at time zone 'Asia/Ho_Chi_Minh'),
    ${s.shipments.expectedDeliveryDate}
  )`;
}

/**
 * The workboard row's triage day: container rows keep the appointment/EDD
 * coalesce (their cell prints the appointment); the container-less lot row
 * (LEFT-JOIN null arm, card 365) reads the SIL-645 display day. This is a
 * day-SOURCE switch, not a lane escape — every row still satisfies both date
 * arms (`containerDayTriageCondition` stays a pure AND, SIL-506 law intact).
 */
export function workboardRowDaySql() {
  return sql<string>`case when ${s.shipmentContainers.id} is null
    then ${lotTransportDaySql()}
    else ${containerTransportDateSql()}
  end`;
}

/** Lot-level transport-date filter (cards 261022201006b and 231026000252,
 *  null lane superseded by SIL-588 — id 688, khách 29/10): the lot's schedule
 *  days are the UNION of its containers' coalesce(appointment VN date, EDD)
 *  days — the exact per-container law `containerTransportDateSql()` states —
 *  and the lot-level expectedDeliveryDate is the day ONLY for a lot that owns
 *  no container at all (container-less LCL lots, intake skeletons before the
 *  first container exists).
 *
 *  The previous shape OR-ed the EDD arm UNCONDITIONALLY, so a lot whose every
 *  container had been reappointed to another day still surfaced under its old
 *  EDD day ("lọc ngày A vẫn trả lô ngày khác" — card 261022201006b, probe
 *  fixture lot Z) and contradicted the Chi tiết workboard, which day-gates
 *  each container row by the same coalesce. Gating the fallback restores the
 *  single-source contract shared by Tổng quan, Chi tiết and the dispatch
 *  master-plan delivery-date filter.
 *
 *  SIL-588 (superseding card 231026000252's "undated = luôn hiện" overview
 *  lane, mirroring the SIL-506 owner ruling that already narrowed Chi tiết):
 *  a lot whose only candidate day is NULL (container rows with neither
 *  appointment nor lot EDD, or a container-less LCL lot with no transport
 *  date) has no day the chosen range names — under an ACTIVE range it DROPS,
 *  and returns the moment the range is cleared (the call site pushes this
 *  condition only when a bound is set, so the no-filter path keeps the full
 *  set with its undated rows). Tổng quan, Chi tiết and the master-plan now
 *  agree row-for-row: the filter returns only lots whose day is in range.
 *
 *  SIL-791 (id 917, QA 10/11, KB Ch3 §3.1.5) carves the LOT-level exception
 *  back out at the /shipments call site: the list composes this condition
 *  with {@link undatedShipmentLaneSql} via `or(...)`, so an undated lot
 *  stays visible while a range is held. This function ALONE (the dispatch
 *  master-plan delivery-date filter) keeps the SIL-588 drop unchanged. */
export function shipmentTransportDateCondition(dateFrom: string, dateTo: string): SQL {
  return or(
    sql`exists (
      select 1 from ${s.shipmentContainers}
      where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
        and ${containerTransportDateSql()} between ${dateFrom} and ${dateTo}
    )`,
    and(
      sql`not exists (
        select 1 from ${s.shipmentContainers}
        where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
      )`,
      sql`${s.shipments.expectedDeliveryDate} between ${dateFrom} and ${dateTo}`,
    ),
  )!;
}

/** SIL-791 (id 917, QA 10/11, KB Ch3 §3.1.5) — the undated lane RETURNS at
 *  LOT level: a lot with no day evidence at all (expectedDeliveryDate null
 *  AND no container carrying an appointment — intake skeletons, staging
 *  lots like 982/R7B-C3-702L) stays visible while a date range is held.
 *  Hiding it loses rows from the operator's board; KB: "lô không ngày vẫn
 *  hiện ở mức lô — chỉ container không ngày bị loại ở mức dòng container".
 *  The /shipments list call site composes this with
 *  {@link shipmentTransportDateCondition} via `or(...)`, so dated lots keep
 *  the exact SIL-588 range law (in-range shows, out-range drops) and the
 *  Chi tiết container triage (SIL-506) still drops undated containers at
 *  row level. `not exists (appointment)` is the exact complement of
 *  containerTransportDateSql's dated arm — a lot with ANY appointment is a
 *  dated lot and is judged by the range alone. The dispatch master-plan
 *  call site is NOT touched (keeps the SIL-588 law until its own ticket). */
export function undatedShipmentLaneSql(): SQL {
  return and(
    sql`${s.shipments.expectedDeliveryDate} is null`,
    sql`not exists (
      select 1 from ${s.shipmentContainers}
      where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
        and ${s.shipmentContainers.customerAppointmentAt} is not null
    )`,
  )!;
}

/** Container workboard day triage (D.6, cards 211026132257/211026180528,
 *  law card 231026000252 — undated lane SUPERSEDED by SIL-506, owner ruling
 *  2026-10-26): a row's day is `coalesce(appointment VN date, EDD)` — for a
 *  container-less LCL lot row that is simply the lot EDD — and under an
 *  active range the triage is exactly the date arms:
 *    - a DATED row must pass the range: in-range shows, out-range drops
 *      (container-less LCL lot rows included — their day is the EDD leg of
 *      the same coalesce), and
 *    - an UNDATED row (coalesce NULL: no appointment and no EDD — intake
 *      skeleton, staging lot SHP-2610-00069) matches no range and DROPS.
 *  Card 231026000252's null lane ("undated = luôn hiện") let 30/45
 *  transportDate-null containers ride through the Chi tiết filter
 *  23/10..23/10 (ticket SIL-506, staging build e5239fb1, role CUS) — the
 *  owner ruling flips that law: an active range narrows the board to dated
 *  in-range rows only. Undated rows stay visible solely when NO range is
 *  active: the call site pushes this triage only when dateArms is non-empty,
 *  so the no-filter path keeps the full set with its nulls-first sort.
 *  Accepted consequence (per the ruling): LCL-01 same-filter parity with
 *  Tổng quan held for dated rows only — until SIL-588 (khách 29/10) closed
 *  the gap: shipmentTransportDateCondition now drops undated lots under an
 *  active range too, so Tổng quan and Chi tiết agree on undated rows as
 *  well (visible with no range, filtered out under one).
 */
export function containerDayTriageCondition(dateArms: SQL[]): SQL {
  return and(...dateArms)!;
}

/** CUS workboard record search (QA2-005, card 121026084713): one
 *  case-insensitive substring (`ilike`) predicate over every identifier a
 *  user can see on a row — Bill (bl_number), Booking (booking_ref), mã lô
 *  (shipment_code), container number, tờ khai number (declaration entity
 *  rows and the per-container attribute, card 261013200312), and the
 *  customer name.
 *  The name arms mirror the dispatch q-search (`shipmentQSearchPredicate` in
 *  dispatch-planning-utils.service.ts): the operational coalesce
 *  (short_name → name) OR the full name, because the coalesce alone hides
 *  the full name whenever a short name exists. Ad-hoc lots (lệnh chạy
 *  ngoài) have no customers row — their raw free-text name rides the
 *  shipment itself. Customer, container, and declaration references stay
 *  inside EXISTS subqueries so EVERY consumer of these conditions can run
 *  them (the page joins customers/routes, but the count and status-tab
 *  count queries select from shipments alone). Empty/whitespace term
 *  returns undefined — no condition, current behavior preserved, and the
 *  remaining filters compose AND with the search untouched. */
export function cusRecordSearchCondition(
  searchSuffix: string | undefined,
  searchMode: 'shipment' | 'container',
): SQL | undefined {
  // Substring, not suffix (2026-09-18): pasting a Bill/Book from the top
  // returned nothing because the filter only matched the tail. The URL param
  // keeps its `searchSuffix` name so existing links and saved filters work.
  // The schema already forbids % and _ (wildcard injection); the escape is
  // belt-and-suspenders for callers that bypass schema validation.
  const term = searchSuffix?.trim();
  if (!term) return undefined;
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    sql`btrim(${s.shipments.blNumber}) ilike ${pattern}`,
    sql`btrim(${s.shipments.bookingRef}) ilike ${pattern}`,
    sql`btrim(${s.shipments.shipmentCode}) ilike ${pattern}`,
    searchMode === 'container'
      ? sql`btrim(${s.shipmentContainers.containerNumber}) ilike ${pattern}`
      : sql`exists (
          select 1
          from ${s.shipmentContainers}
          where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
            and btrim(${s.shipmentContainers.containerNumber}) ilike ${pattern}
        )`,
    sql`exists (
        select 1
        from ${s.shipmentDeclarations}
        where ${s.shipmentDeclarations.shipmentId} = ${s.shipments.id}
          and btrim(${s.shipmentDeclarations.declarationNumber}) ilike ${pattern}
      )`,
    // Card 261013200312: the per-container tờ khai attribute is searchable
    // too — the copy/entry surface writes there, and a number that exists
    // only on containers must still find its lot. Mode-aware like the
    // container-number arm: direct column when the page already joins the
    // containers table, EXISTS for the shipment-scope count queries.
    searchMode === 'container'
      ? sql`btrim(${s.shipmentContainers.declarationNumber}) ilike ${pattern}`
      : sql`exists (
          select 1
          from ${s.shipmentContainers}
          where ${s.shipmentContainers.shipmentId} = ${s.shipments.id}
            and btrim(${s.shipmentContainers.declarationNumber}) ilike ${pattern}
        )`,
    sql`exists (
        select 1
        from ${s.customers}
        where ${s.customers.id} = ${s.shipments.customerId}
          and (
            btrim(coalesce(nullif(btrim(${s.customers.shortName}), ''), ${s.customers.name})) ilike ${pattern}
            or btrim(${s.customers.name}) ilike ${pattern}
          )
      )`,
    sql`btrim(${s.shipments.rawCustomerName}) ilike ${pattern}`,
  )!;
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
 * then a line whose PLAN carries a vehicle — the planned plate, the same
 * value the Phân xe column displays — is PLANNED ("Đã phân xe"); everything
 * else (no vehicle in the plan yet, with or without a trip) is
 * AWAITING_VEHICLE (rank 0). Only relative order matters for sorting. */
function containerDispatchRankSql(): SQL {
  return sql`(
    select case
      when t.status = 'COMPLETED' then 4
      when t.status = 'IN_TRANSIT' then 3
      when t.status = 'CREATED' and ${s.shipmentContainers.customerAppointmentAt} is null then 2
      when ${trimmedPresentSql(sql`sf.planned_vehicle_plate_number`)} then 1
      else 0
    end
    from ${s.shipmentFulfillments} sf
    left join ${s.tripsComposite} t
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
  PLANNED: 1,
  CREATED: 2,
  IN_TRANSIT: 3,
  COMPLETED: 4,
} as const;

/** Mirrors buildContainerLine's carrierName: own fleet renders as the fixed
 * SilverSea label; otherwise the planned allocation's carrier wins — the
 * planned-only identity rule shared with the row builders, so sort order
 * agrees with the displayed Phân xe column. */
function containerCarrierNameSql(): SQL {
  return sql`(
    select coalesce(
      case when sf.planned_carrier_type = 'OWN' then 'SilverSea' end,
      coalesce(nullif(trim(pc.short_name), ''), pc.name)
    )
    from ${s.shipmentFulfillments} sf
    left join ${s.customers} pc on pc.id = sf.planned_external_carrier_id
    where sf.shipment_container_id = ${s.shipmentContainers.id}
      and sf.canceled_at is null
    order by sf.id
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
// could fan out container rows and corrupt pagination counts. Carrier
// identity is planned-allocation-only with canceled fulfillments ignored —
// identical to the in-memory assignmentsByContainer projection.

function activePlannedCarrierTypeSql(): SQL {
  return sql`(select ${s.shipmentFulfillments.plannedCarrierType}
    from ${s.shipmentFulfillments}
    where ${s.shipmentFulfillments.shipmentContainerId} = ${s.shipmentContainers.id}
      and ${s.shipmentFulfillments.canceledAt} is null
    limit 1)`;
}

function activeCarrierTypeSql(): SQL {
  // Mirror the row builders' planned-allocation-only identity rule: the
  // Trạng thái facet must agree with what the Phân xe column displays.
  return activePlannedCarrierTypeSql();
}

// nullif(btrim(x), '') mirrors the JS trimOrNull: null-or-whitespace is absent.
function trimmedPresentSql(value: SQL | Column): SQL {
  return sql`nullif(btrim(${value}), '') is not null`;
}

// SIL-1151 (KB Ch.3 §3.4.2) — the "thiếu thông tin" triage is ONE criterion at
// container level: the row's own số tờ khai (có = ĐẦY ĐỦ, không = VẪN THIẾU).
// This is the SQL twin of declarationMissingFields(): a container row reads
// its OWN declaration column; a lot row (LCL, no container) reads the
// lot-level declaration entity — the same two sources the wire's
// declarationNumber field prints. The queue and the projection can never
// disagree, and no other field or sibling number moves a row's status.
function rowDeclarationMissingSql(): SQL {
  return sql`(case
    when ${s.shipmentContainers.id} is null then not (exists (
      select 1 from ${s.shipmentDeclarations}
      where ${s.shipmentDeclarations.shipmentId} = ${s.shipments.id}
        and ${trimmedPresentSql(s.shipmentDeclarations.declarationNumber)}
    ))
    else not (${trimmedPresentSql(s.shipmentContainers.declarationNumber)})
  end)`;
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
  activePlannedCarrierTypeSql, activeCarrierTypeSql,
  trimmedPresentSql, rowDeclarationMissingSql, cargoRankSql,
};
