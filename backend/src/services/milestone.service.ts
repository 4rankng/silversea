// Milestone Service — Wave 2 M3.3.
//
// Derives shipment milestones from trip status changes and supports manual
// milestone entry by CUS staff. Append-only: milestones are never edited or
// deleted — history is preserved per M3.3's requirement.
//
// Derivation mapping (trip status → milestone type):
//   CREATED → BOOKING_RECEIVED (when the trip is first created for a shipment)
//   IN_TRANSIT → IN_TRANSIT (when dispatch occurs)
//   COMPLETED → DELIVERED (when the trip completes)
//
// Manual milestones (type = MANUAL) are added by CUS staff for events that
// don't have an automated trigger (e.g. CUSTOMS_CLEARED, PICKED_UP).
//
// Cross-customer isolation: all queries are scoped by shipmentId. A CUS staff
// member querying milestones for shipment A cannot see shipment B's milestones
// — the scopedByCustomer helper (Wave 0) is used when a CUSTOMER-role user
// requests milestones through the portal.

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ApiError } from '../errors';
import { TripStatus } from '@tingting/shared';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import type { Tx } from './trip-shared';
import { createCustomerVisibleEvent } from './shipment-coordination.service';

type MilestoneType = typeof s.shipmentMilestones.$inferSelect['type'];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AddMilestoneInput {
  shipmentId: number;
  type: MilestoneType;
  note?: string | null;
  tripId?: number | null;
  changedBy?: number | null;
  /** When the milestone occurred (operator may backdate). Defaults to now. */
  occurredAt?: Date | null;
}

// ─── Derivation from trip status ────────────────────────────────────────────

/**
 * Map a trip status transition to a milestone type. Returns null when the
 * status doesn't map to a shipment milestone (e.g. CANCELED).
 */
export function tripStatusToMilestoneType(
  _oldStatus: TripStatus | null,
  newStatus: TripStatus,
): MilestoneType | null {
  switch (newStatus) {
    case TripStatus.CREATED: return 'BOOKING_RECEIVED';
    case TripStatus.IN_TRANSIT: return 'IN_TRANSIT';
    case TripStatus.COMPLETED: return 'DELIVERED';
    default: return null; // CANCELED → no milestone
  }
}

/**
 * Derive and record a milestone from a trip status change. Idempotent: if a
 * milestone of the same type already exists for the same shipment + trip,
 * the function is a no-op (prevents duplicate milestones from retries).
 *
 * Called by the trip status machine AFTER the trip status is updated.
 */
export async function deriveMilestoneFromTripStatus(
  shipmentId: number,
  tripId: number,
  oldStatus: TripStatus | null,
  newStatus: TripStatus,
  actorUserId?: number | null,
  transaction?: Tx,
): Promise<void> {
  const milestoneType = tripStatusToMilestoneType(oldStatus, newStatus);
  if (!milestoneType) return; // no milestone for this status

  const execute = async (tx: Tx) => {
    const occurredAt = new Date();
    await lockApplicationOwnedUniqueness(tx, 'shipment-milestone', [shipmentId, tripId, milestoneType]);

    const [existing] = await tx.select().from(s.shipmentMilestones)
      .where(and(
        eq(s.shipmentMilestones.shipmentId, shipmentId),
        eq(s.shipmentMilestones.type, milestoneType),
        eq(s.shipmentMilestones.tripId, tripId),
      ))
      .limit(1);

    const [inserted] = existing
      ? [existing]
      : await tx.insert(s.shipmentMilestones).values({
        shipmentId,
        type: milestoneType,
        tripId,
        changedBy: actorUserId ?? null,
        occurredAt,
      }).returning();

    if (milestoneType !== 'BOOKING_RECEIVED' || actorUserId == null) return;

    const milestone = inserted;
    if (!milestone) return;
    const [shipment] = await tx.select({
      createdAt: s.shipments.createdAt,
    }).from(s.shipments)
      .where(eq(s.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) return;

    await createCustomerVisibleEvent({
      shipmentId,
      eventKey: `shipment:${shipmentId}:booking-received`,
      eventType: 'MILESTONE',
      title: 'Đã tiếp nhận booking',
      message: 'Thông tin booking của lô hàng đã được tiếp nhận.',
      occurredAt: shipment.createdAt,
      milestoneId: milestone.id,
      createdBy: actorUserId,
    }, undefined, tx);
  };
  await runInTx(transaction, execute);
}

// ─── Manual milestone entry ─────────────────────────────────────────────────

/**
 * Add a manual milestone (CUS staff entry). Append-only — no update or delete.
 */
export async function addManualMilestone(input: AddMilestoneInput, transaction?: Tx) {
  const client = transaction ?? db;
  // Verify the shipment exists.
  const [shipment] = await client.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, input.shipmentId)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  const [milestone] = await client.insert(s.shipmentMilestones).values({
    shipmentId: input.shipmentId,
    type: input.type,
    note: input.note ?? null,
    tripId: input.tripId ?? null,
    changedBy: input.changedBy ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  }).returning();

  return milestone;
}

// ─── List milestones ────────────────────────────────────────────────────────

/**
 * List milestones for a shipment, ordered by occurrence time (most recent
 * first). Cross-customer isolation is handled at the route layer via
 * scopedByCustomer — this service queries by shipmentId only.
 */
export async function listMilestones(shipmentId: number) {
  return await db.select()
    .from(s.shipmentMilestones)
    .where(eq(s.shipmentMilestones.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentMilestones.occurredAt));
}

/**
 * List milestones for multiple shipments (used by the customer portal to show
 * a customer's shipment timeline across all their shipments).
 */
export async function listMilestonesForShipments(shipmentIds: number[]) {
  if (shipmentIds.length === 0) return [];
  return await db.select()
    .from(s.shipmentMilestones)
    .where(inArray(s.shipmentMilestones.shipmentId, shipmentIds))
    .orderBy(desc(s.shipmentMilestones.occurredAt));
}
