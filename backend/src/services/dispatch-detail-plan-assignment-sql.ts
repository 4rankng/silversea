/**
 * FB-014 (card 201026112500) — the assignment definition of the detail-plan
 * board, one owner for the three consumers that must never drift:
 *
 *   1. the trips left-join of the row read (the row's trip hydrate),
 *   2. the quick-tab assignment predicate (Chưa gán xe / Đã gán nhà xe ·
 *      Chờ biển / Đã gán xe),
 *   3. all three chip-count halves (`assignmentStatusCounts`).
 *
 * QA 28/11 UX-05 — the split is THREE-state, not two. FB-014's original
 * defect: "assigned" meant only "planned plate string non-empty", so an
 * external-carrier dispatch pending its plate filed under "Chưa gán xe"
 * while its own dispatch cell showed the carrier. FB-014 fixed that by
 * folding every live trip into ASSIGNED; QA 28/11 showed the remaining lie
 * from the other side: a carrier-only allocation (external carrier set, no
 * plate, no trip yet) still counted "Chưa gán xe" while the row rendered
 * the carrier + the "Chờ bổ sung biển" chip. The counters now answer the
 * two questions the dispatcher actually has — is a carrier on it, and is a
 * plate on it:
 *
 *   ASSIGNED        ("Đã gán xe")                    = plate set
 *   AWAITING_PLATE  ("Đã gán nhà xe · Chờ biển")     = plate empty AND carrier
 *                                                      set (external carrier
 *                                                      on the row, or a live
 *                                                      trip — FB-014's
 *                                                      assigned work keeps
 *                                                      its not-unassigned
 *                                                      reading; without its
 *                                                      plate string it is
 *                                                      exactly "chờ biển")
 *   UNASSIGNED      ("Chưa gán xe")                  = plate empty AND no
 *                                                      carrier set
 *
 * A LIVE trip is any dispatch decision not canceled. `trips.status` is free
 * text (`applicationEnum`), so the legacy double-L spelling 'CANCELLED'
 * sails past a `<> 'CANCELED'` comparison (seen live: trips/11 'CANCELLED'
 * hydrated as a phát-lệnh row) — spell both out instead of trusting the
 * enum. The three halves partition the fulfillment row set by construction
 * (plate set XOR plate empty; the empty half splits on carrier set), so the
 * chip counts keep summing to the view total (card 20261008_3 invariant).
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

/** The row's carrier allocation is set: an external carrier is on the row
 *  (its plate may still be deferred) or a live trip carries the run. This —
 *  not the plate — is what separates "chưa gán" from "đã gán nhà xe". */
export function dispatchDetailCarrierSetSql(): SQL {
  return sql`(${s.shipmentFulfillments.plannedExternalCarrierId} is not null or ${dispatchDetailLiveTripSql()})`;
}

/** Đã gán xe (QA 28/11 UX-05): carrier AND plate — the planned plate is set
 *  (OWN plate / carrier-vehicle plate / typed). */
export function dispatchDetailAssignedSql(): SQL {
  return dispatchDetailPlateSetSql();
}

/** Đã gán nhà xe · Chờ biển: carrier allocated, its plate string still
 *  pending — the carrier-only allocation QA 28/11 UX-05 saw fall through. */
export function dispatchDetailAwaitingPlateSql(): SQL {
  return sql`(${dispatchDetailPlateEmptySql()} and ${dispatchDetailCarrierSetSql()})`;
}

/** Chưa gán xe: no plate AND no carrier allocation — still awaiting the
 *  dispatcher's assignment action. */
export function dispatchDetailUnassignedSql(): SQL {
  return sql`(${dispatchDetailPlateEmptySql()} and not ${dispatchDetailCarrierSetSql()})`;
}
