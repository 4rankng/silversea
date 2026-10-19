/**
 * FB-081 v2 (card 181026003045) — ACTIVE Kẹp pair rig law.
 *
 * A KEP pair is two 20' orders riding ONE mooc simultaneously
 * (`trip_pairs.pair_kind = 'KEP'`; the pairing gate forces both legs onto the
 * same truck + same driver). That makes the partner leg's window an overlap
 * BY CONSTRUCTION on the very rig every FB-038/072 guard scans — the shape
 * those guards were built to refuse. This leaf owns the two pair-aware
 * primitives the guards and the reassign write commands share:
 *
 *  - `findActiveKepPairPartner` / `findActiveKepPairPartnerByFulfillment`:
 *    resolve the OTHER leg of the ACTIVE KEP pair a trip/row belongs to
 *    (KET_HOP pairs resolve to null — owner ruling Q4: their windows are
 *    sequential by construction and need no carve-out).
 *  - `propagateKepPairRigToPartner`: apply the issuing leg's new
 *    truck/trailer/driver onto the partner leg inside the SAME transaction,
 *    with an audit row for both legs — the pair moves as one rig, never as
 *    two half-updates (option 2-lite, owner ruling Q2/Q3).
 */
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { localDateInBusinessZone, TripStatus } from '@tingting/shared';

import * as s from '../db/schema';
import type { Tx } from '../db';
import { ApiError } from '../errors';
import { persistAuditInTransaction } from './audit.service';
import { AuditEvent } from './audit-types';

/** The business-zone day a partner leg claims its rig for (pair law: both
 *  KEP legs run the same day; `departureDate` is the date-only fallback). */
export interface ActiveKepPairPartner {
  pairId: number;
  partnerTripId: number;
  /** Null only when the partner carries neither a staged start nor a
   *  departure date — callers treat that as "cannot prove same-day pair" and
   *  keep the conflict. */
  partnerClaimDay: string | null;
}

/**
 * The other leg of the ACTIVE KEP pair `tripId` belongs to, or null when the
 * trip is unpaired, its pair is not ACTIVE, or the pair is not KEP (Q4).
 */
export async function findActiveKepPairPartner(
  tx: Tx,
  tripId: number,
): Promise<ActiveKepPairPartner | null> {
  const [self] = await tx.select({ activeTripPairId: s.trips.activeTripPairId })
    .from(s.trips)
    .where(and(eq(s.trips.id, tripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (self?.activeTripPairId == null) return null;

  const [pair] = await tx.select({
    id: s.tripPairs.id,
    status: s.tripPairs.status,
    pairKind: s.tripPairs.pairKind,
    firstTripId: s.tripPairs.firstTripId,
    secondTripId: s.tripPairs.secondTripId,
  })
    .from(s.tripPairs)
    .where(eq(s.tripPairs.id, self.activeTripPairId))
    .limit(1);
  if (pair == null || pair.status !== 'ACTIVE' || pair.pairKind !== 'KEP') return null;

  const partnerTripId = pair.firstTripId === tripId ? pair.secondTripId : pair.firstTripId;
  const [partner] = await tx.select({
    id: s.trips.id,
    departureDate: s.trips.departureDate,
    plannedStartAt: s.trips.plannedStartAt,
  })
    .from(s.trips)
    .where(and(eq(s.trips.id, partnerTripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (partner == null) return null;

  return {
    pairId: pair.id,
    partnerTripId,
    partnerClaimDay: partner.plannedStartAt != null
      ? localDateInBusinessZone(partner.plannedStartAt)
      : partner.departureDate,
  };
}

/**
 * Same resolution keyed by the plan row's fulfillment: the dispatched trip
 * carrying `fulfillmentId` (the row's own leg), then its ACTIVE KEP pair
 * partner. Null when the row has no paired dispatched leg.
 */
export async function findActiveKepPairPartnerByFulfillment(
  tx: Tx,
  fulfillmentId: number,
): Promise<ActiveKepPairPartner | null> {
  const [leg] = await tx.select({ id: s.trips.id })
    .from(s.trips)
    .where(and(
      eq(s.trips.fulfillmentId, fulfillmentId),
      isNull(s.trips.deletedAt),
      isNotNull(s.trips.activeTripPairId),
      ne(s.trips.status, TripStatus.CANCELED),
    ))
    .limit(1);
  if (leg == null) return null;
  return findActiveKepPairPartner(tx, leg.id);
}

export interface KepPairRigSyncResult {
  pairId: number;
  partnerTripId: number;
  /** Rig state the partner carried before the sync (audit + attendance). */
  previous: { truckId: number | null; trailerId: number | null; driverId: number | null };
  /** The partner's departure date, for the caller's attendance re-key. */
  partnerDepartureDate: string | null;
  /** True when the partner had already departed (IN_TRANSIT) and the sync
   *  changed its driver — the caller re-keys attendance work-days after
   *  commit, best-effort, exactly like the issuing leg's resync. */
  attendanceResyncNeeded: boolean;
}

/**
 * Option 2-lite write half: move the pair's rig as ONE unit. Applies the
 * issuing leg's resolved truck/trailer/driver onto the partner leg of the
 * ACTIVE KEP pair inside the caller's transaction, bumps both optimistic
 * versions, mirrors the plate onto the partner's plan row, and persists an
 * audit row for BOTH legs. Returns null when there is nothing to do (no
 * ACTIVE KEP pair, partner released the rig, or the rig already matches).
 *
 * Throws (rolling the whole reassign back — never one leg without the other):
 *  - a KEP leg switched to an external carrier: the pair invariant (same
 *    internal truck + driver) cannot survive it, so the split must be an
 *    explicit pair break, not a silent reassign (the §3c defect class);
 *  - a driver change onto a partner that already acknowledged
 *    (ORDER_RECEIVED): FB-081 v1's vehicle-only law protects BOTH legs.
 */
export async function propagateKepPairRigToPartner(
  tx: Tx,
  args: {
    tripId: number;
    carrierType?: 'OWN' | 'EXTERNAL' | null;
    truckId: number | null;
    trailerId: number | null;
    driverId: number | null;
    actor?: { userId?: number; role?: string | null; name?: string | null } | null;
  },
): Promise<KepPairRigSyncResult | null> {
  const partnerLink = await findActiveKepPairPartner(tx, args.tripId);
  if (partnerLink == null) return null;

  if (args.carrierType === 'EXTERNAL') {
    throw new ApiError(
      409,
      'Cặp kẹp phải chạy bằng xe nội bộ — không thể chuyển một chân sang nhà xe ngoài. Hãy tách cặp trước.',
    );
  }

  const [partner] = await tx.select({
    id: s.trips.id,
    tripCode: s.trips.tripCode,
    status: s.trips.status,
    truckId: s.trips.truckId,
    trailerId: s.trips.trailerId,
    driverId: s.trips.driverId,
    fulfillmentId: s.trips.fulfillmentId,
    departureDate: s.trips.departureDate,
  })
    .from(s.trips)
    .where(and(eq(s.trips.id, partnerLink.partnerTripId), isNull(s.trips.deletedAt)))
    .limit(1);
  if (partner == null) return null;
  // A COMPLETED partner released its rig (its figures are governed
  // corrections); a CANCELED partner no longer belongs to the pair's run.
  // Either way the issuing leg's reassign needs no counterpart write.
  if (partner.status === TripStatus.COMPLETED || partner.status === TripStatus.CANCELED) {
    return null;
  }

  const previous = {
    truckId: partner.truckId,
    trailerId: partner.trailerId,
    driverId: partner.driverId,
  };
  const rigUnchanged = previous.truckId === args.truckId
    && previous.trailerId === args.trailerId
    && previous.driverId === args.driverId;
  if (rigUnchanged) return null;

  const driverChanges = args.driverId != null && args.driverId !== previous.driverId;
  if (driverChanges) {
    // FB-081 v1 law owner: `tripHasDriverAcknowledgement`
    // (trip-lifecycle-ops.service). Inlined here — importing the lifecycle
    // module would close a cycle (it consumes this service's carve-out).
    const [ack] = await tx.select({ id: s.driverProgressEvents.id })
      .from(s.driverProgressEvents)
      .where(and(
        eq(s.driverProgressEvents.tripId, partner.id),
        eq(s.driverProgressEvents.eventType, 'ORDER_RECEIVED'),
      ))
      .limit(1);
    if (ack != null) {
      throw new ApiError(409, 'Lái xe đã nhận việc ở chân còn lại của cặp kẹp — chỉ được đổi xe, giữ lái xe.');
    }
  }

  const now = new Date();
  await tx.update(s.trips).set({
    truckId: args.truckId,
    trailerId: args.trailerId,
    driverId: args.driverId,
    version: sqlBump(),
    updatedAt: now,
  }).where(eq(s.trips.id, partner.id));

  // Mirror the plate onto the partner's plan row so the detail grid and the
  // plan-row holder scans (plate-keyed) see one physical tractor for the
  // pair, not the issuing leg's new plate plus the partner's stale one.
  if (partner.fulfillmentId != null) {
    let plate: string | null = null;
    if (args.truckId != null) {
      const [truck] = await tx.select({ licensePlate: s.trucks.licensePlate })
        .from(s.trucks)
        .where(eq(s.trucks.id, args.truckId))
        .limit(1);
      plate = truck?.licensePlate ?? null;
    }
    await tx.update(s.shipmentFulfillments).set({
      plannedVehiclePlateNumber: plate,
      version: sql`${s.shipmentFulfillments.version} + 1`,
      updatedAt: now,
    }).where(eq(s.shipmentFulfillments.id, partner.fulfillmentId));
  }

  const [self] = await tx.select({ tripCode: s.trips.tripCode })
    .from(s.trips)
    .where(eq(s.trips.id, args.tripId))
    .limit(1);
  const actor = args.actor ?? null;
  const baseMetadata = {
    reason: 'KEP_PAIR_RIG_SYNC',
    pairId: partnerLink.pairId,
    applied: { truckId: args.truckId, trailerId: args.trailerId, driverId: args.driverId },
  };
  // One audit row per leg: the partner changed silently from the operator's
  // viewpoint, and the issuing leg's change is what the pair moved for.
  await persistAuditInTransaction(tx, {
    event: AuditEvent.TRIP_UPDATED_PRE_DEPARTURE,
    entityType: 'trips',
    entityId: partner.id,
    entityKey: partner.tripCode ?? undefined,
    userId: actor?.userId,
    actorRole: actor?.role ?? undefined,
    actorName: actor?.name ?? undefined,
    metadata: {
      ...baseMetadata,
      sourceTripId: args.tripId,
      sourceTripCode: self?.tripCode ?? null,
      previous,
    },
  });
  await persistAuditInTransaction(tx, {
    event: AuditEvent.TRIP_UPDATED_PRE_DEPARTURE,
    entityType: 'trips',
    entityId: args.tripId,
    entityKey: self?.tripCode ?? undefined,
    userId: actor?.userId,
    actorRole: actor?.role ?? undefined,
    actorName: actor?.name ?? undefined,
    metadata: {
      ...baseMetadata,
      reason: 'KEP_PAIR_RIG_SYNC_SOURCE',
      partnerTripId: partner.id,
      partnerTripCode: partner.tripCode ?? null,
      partnerPrevious: previous,
    },
  });

  return {
    pairId: partnerLink.pairId,
    partnerTripId: partner.id,
    previous,
    partnerDepartureDate: partner.departureDate ?? null,
    attendanceResyncNeeded: driverChanges && partner.status === TripStatus.IN_TRANSIT,
  };
}

function sqlBump() {
  return sql`${s.trips.version} + 1`;
}
