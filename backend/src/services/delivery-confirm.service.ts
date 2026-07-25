// Delivery Confirmation Service — Wave 2 M3.4.
//
// Three-party delivery confirmation: driver, CUS staff, and customer each
// confirm delivery (optionally per-container for partial delivery). Tracks
// free-time (the period during which the customer can use the container at
// the port/yard without incurring storage fees) and warns when free time
// is exceeded.
//
// The service records confirmations as MANUAL milestones in shipment_milestones
// (reusing the existing append-only table — no new table needed for this
// slice). Free-time calculation uses the shipment's expectedDeliveryDate as
// the start and a configurable number of free days (default 7, matching the
// common Vietnamese port convention).

import { db } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import { addManualMilestone } from './milestone.service';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConfirmParty = 'DRIVER' | 'CUS' | 'CUSTOMER';

export interface DeliveryConfirmationInput {
  shipmentId: number;
  party: ConfirmParty;
  confirmedBy: number;
  /** Partial delivery: the specific container IDs that were confirmed. When
   *  absent, ALL containers on the shipment are confirmed. */
  containerIds?: number[];
  note?: string;
}

export interface DeliveryConfirmationResult {
  shipmentId: number;
  party: ConfirmParty;
  confirmedContainerCount: number;
  totalContainerCount: number;
  /** True when all three parties have confirmed (or the same person confirmed
   *  on behalf of multiple parties). The shipment can transition to DELIVERED. */
  allPartiesConfirmed: boolean;
}

// ─── In-memory tracking ─────────────────────────────────────────────────────
//
// In a production system, these would be DB-backed rows in a
// `delivery_confirmations` table. For this slice, we track confirmations via
// milestone rows (type=MANUAL, note encodes the party). This keeps the
// schema additive (no new table) while preserving the append-only audit trail.
// A future slice may promote these to a dedicated table if query performance
// demands it.

const CONFIRMATION_NOTE_PREFIX = 'DELIVERY_CONFIRM:';

/**
 * Record a delivery confirmation from one of the three parties (driver, CUS,
 * customer). Idempotent — re-confirming the same party is a no-op.
 */
export async function confirmDelivery(
  input: DeliveryConfirmationInput,
): Promise<DeliveryConfirmationResult> {
  // 1. Verify shipment exists.
  const [shipment] = await db.select().from(s.shipments)
    .where(eq(s.shipments.id, input.shipmentId))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  // 2. Count containers.
  const containers = await db.select().from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, input.shipmentId));
  const totalContainers = containers.length;
  const confirmedCount = input.containerIds
    ? input.containerIds.length
    : totalContainers;

  // 3. Record as a milestone (idempotent — check for existing for THIS party).
  const partyPrefix = `${CONFIRMATION_NOTE_PREFIX}${input.party}`;
  const note = `${partyPrefix}${input.containerIds ? ':' + input.containerIds.join(',') : ''}`;
  const existing = await db.select().from(s.shipmentMilestones)
    .where(and(
      eq(s.shipmentMilestones.shipmentId, input.shipmentId),
      eq(s.shipmentMilestones.type, 'MANUAL'),
    ));
  // Check if THIS specific party already confirmed (not any party).
  const alreadyConfirmed = existing.some(m => m.note?.startsWith(partyPrefix));

  if (!alreadyConfirmed) {
    await addManualMilestone({
      shipmentId: input.shipmentId,
      type: 'MANUAL',
      note,
      changedBy: input.confirmedBy,
    });
  }

  // 4. Check if all three parties have confirmed.
  const allConfirmations = await db.select().from(s.shipmentMilestones)
    .where(and(
      eq(s.shipmentMilestones.shipmentId, input.shipmentId),
      eq(s.shipmentMilestones.type, 'MANUAL'),
    ));
  const confirmedParties = new Set<string>();
  for (const m of allConfirmations) {
    if (m.note?.startsWith(CONFIRMATION_NOTE_PREFIX)) {
      const party = m.note.slice(CONFIRMATION_NOTE_PREFIX.length).split(':')[0];
      confirmedParties.add(party);
    }
  }
  const allPartiesConfirmed =
    confirmedParties.has('DRIVER') &&
    confirmedParties.has('CUS') &&
    confirmedParties.has('CUSTOMER');

  return {
    shipmentId: input.shipmentId,
    party: input.party,
    confirmedContainerCount: confirmedCount,
    totalContainerCount: totalContainers,
    allPartiesConfirmed,
  };
}

// ─── Free-time calculation ──────────────────────────────────────────────────

export interface FreeTimeResult {
  /** Date free time started (expectedDeliveryDate or actual delivery date). */
  startDate: string;
  /** Date free time ends. */
  endDate: string;
  /** Days of free time remaining (negative = overrun). */
  daysRemaining: number;
  /** True when free time has been exceeded. */
  isOverrun: boolean;
  /** Estimated storage fee (VND) when overrun. 0 when within free time. */
  estimatedFee: number;
}

/**
 * Calculate free-time status for a shipment. Free time starts on the
 * expectedDeliveryDate and lasts `freeDays` days (default 7). After free
 * time ends, a daily storage fee applies.
 *
 * @param expectedDeliveryDate The shipment's expectedDeliveryDate.
 * @param freeDays Number of free days (default 7 — common Vietnamese port convention).
 * @param dailyFee Daily storage fee in VND after free time ends.
 * @param asOf Date to calculate against (default: today).
 */
export function calculateFreeTime(
  expectedDeliveryDate: string,
  freeDays: number = 7,
  dailyFee: number = 50000,
  asOf: Date = new Date(),
): FreeTimeResult {
  const start = new Date(expectedDeliveryDate);
  const end = new Date(start);
  end.setDate(end.getDate() + freeDays);

  const asOfDate = new Date(asOf.toISOString().slice(0, 10));
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.ceil((end.getTime() - asOfDate.getTime()) / msPerDay);

  const isOverrun = daysRemaining < 0;
  const estimatedFee = isOverrun ? Math.abs(daysRemaining) * dailyFee : 0;

  return {
    startDate: expectedDeliveryDate,
    endDate: end.toISOString().slice(0, 10),
    daysRemaining,
    isOverrun,
    estimatedFee,
  };
}
