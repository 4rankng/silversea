/**
 * FB-014 (card 201026112500) — the "đã gán xe" definition of the detail-plan
 * board, one owner for the three consumers that must never drift:
 *
 *   1. the trips left-join of the row read (the row's trip hydrate),
 *   2. the quick-tab assignment predicate (Chưa gán xe / Đã gán xe),
 *   3. both chip-count halves (`assignmentStatusCounts`).
 *
 * A row counts as ASSIGNED when it carries a planned plate OR a live trip:
 * an external-carrier dispatch whose plate string is still pending ("CUS sẽ
 * bổ sung") already has a CREATED trip + an issued driver order, and filing
 * it under "Chưa gán xe" made the quick tab lie while the row's own dispatch
 * cell rendered the carrier name and the phát-lệnh chip.
 *
 * A LIVE trip is any dispatch decision not canceled. `trips.status` is free
 * text (`applicationEnum`), so the legacy double-L spelling 'CANCELLED'
 * sails past a `<> 'CANCELED'` comparison (seen live: trips/11 'CANCELLED'
 * hydrated as a phát-lệnh row) — spell both out instead of trusting the
 * enum. The two halves partition the fulfillment row set by construction
 * (plate set XOR plate empty; live trip joins ASSIGNED), so the chip counts
 * keep summing to the view total (card 20261008_3 invariant).
 *
 * Pure SQL builders over the schema — no database handle, so unit tests can
 * pin the generated text.
 */
import { sql, type SQL } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import * as s from '../db/schema';

/** Every trip status that means "canceled", including the legacy spelling. */
export const DISPATCH_DETAIL_CANCELED_TRIP_STATUSES: readonly string[] = [
  TripStatus.CANCELED,
  'CANCELLED',
];

/** A live trip exists for the fulfillment — the row's assignment progressed
 *  past the plan (carrier allocated, lệnh issued) regardless of its plate. */
export function dispatchDetailLiveTripSql(): SQL {
  return sql`exists (
    select 1 from ${s.trips} lt
    where lt.fulfillment_id = ${s.shipmentFulfillments.id}
      and lt.status not in (${sql.join(DISPATCH_DETAIL_CANCELED_TRIP_STATUSES.map((status) => sql`${status}`), sql`, `)})
      and lt.deleted_at is null
  )`;
}

/** The trips left-join's live-trip condition — the SAME canceled-status list,
 *  so the row hydrate and the assignment split cannot disagree about which
 *  trips count. */
export function dispatchDetailLiveTripJoinSql(): SQL {
  return sql`${s.trips.status} not in (${sql.join(DISPATCH_DETAIL_CANCELED_TRIP_STATUSES.map((status) => sql`${status}`), sql`, `)})`;
}

/** The row's planned plate is set (OWN plate / carrier-vehicle plate / typed). */
export function dispatchDetailPlateSetSql(): SQL {
  return sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is not null and ${s.shipmentFulfillments.plannedVehiclePlateNumber} <> '')`;
}

/** The row's planned plate is absent — "chưa có biển số" on its own is NOT
 *  enough to call the row unassigned (FB-014). */
export function dispatchDetailPlateEmptySql(): SQL {
  return sql`(${s.shipmentFulfillments.plannedVehiclePlateNumber} is null or ${s.shipmentFulfillments.plannedVehiclePlateNumber} = '')`;
}

/** Đã gán xe: a planned plate or a live trip. */
export function dispatchDetailAssignedSql(): SQL {
  return sql`(${dispatchDetailPlateSetSql()} or ${dispatchDetailLiveTripSql()})`;
}

/** Chưa gán xe: no plate AND no live trip — still awaiting the dispatcher's
 *  assignment action. */
export function dispatchDetailUnassignedSql(): SQL {
  return sql`(${dispatchDetailPlateEmptySql()} and not ${dispatchDetailLiveTripSql()})`;
}
