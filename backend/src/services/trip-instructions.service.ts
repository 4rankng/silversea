// Trip Instructions (N2 / B1.3) — manager-authored contact + free-text guidance.
// One row per trip. Manager writes via TripEdit; driver reads read-only via
// the driver portal (getDriverTripDetail includes `instructions`).

import { db } from '../db';
import * as s from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import type { Tx } from './trip-shared';

export interface UpsertTripInstructionsInput {
  expectedVersion?: number;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}

// Shared select shape. `updatedAt` is a JS Date at the Drizzle layer; Express
// serializes it to an ISO string in the JSON response, matching the shared
// TripInstruction type over the wire.
const instructionSelect = {
  id: s.tripInstructions.id,
  tripId: s.tripInstructions.tripId,
  contactName: s.tripInstructions.contactName,
  contactPhone: s.tripInstructions.contactPhone,
  notes: s.tripInstructions.notes,
  updatedAt: s.tripInstructions.updatedAt,
} as const;

export type TripInstructionRow = {
  id: number;
  tripId: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  updatedAt: Date;
};

/**
 * Fetch the instructions row for a trip. Returns null when no row exists yet.
 */
export async function getTripInstructions(tripId: number): Promise<TripInstructionRow | null> {
  const [row] = await db.select(instructionSelect).from(s.tripInstructions)
    .where(eq(s.tripInstructions.tripId, tripId))
    .limit(1);
  return row ?? null;
}

/**
 * Upsert instructions for a trip. Coerces undefined → null so omitted fields
 * clear the stored value (managers can wipe guidance by leaving a field blank).
 */
export async function upsertTripInstructions(
  tripId: number,
  input: UpsertTripInstructionsInput,
  userId: number,
  transaction?: Tx,
): Promise<TripInstructionRow> {
  const execute = async (tx: Tx) => {
    const [trip] = await tx.select({
      id: s.trips.id,
      version: s.trips.version,
      deletedAt: s.trips.deletedAt,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip || trip.deletedAt) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (input.expectedVersion !== undefined && trip.version !== input.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    await lockApplicationOwnedUniqueness(tx, 'trip-instructions', [tripId]);

    const [existing] = await tx.select({ id: s.tripInstructions.id })
      .from(s.tripInstructions)
      .where(eq(s.tripInstructions.tripId, tripId))
      .limit(1);

    const [row] = existing
      ? await tx.update(s.tripInstructions)
        .set({
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          notes: input.notes ?? null,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(s.tripInstructions.id, existing.id))
        .returning(instructionSelect)
      : await tx.insert(s.tripInstructions)
        .values({
          tripId,
          contactName: input.contactName ?? null,
          contactPhone: input.contactPhone ?? null,
          notes: input.notes ?? null,
          updatedBy: userId,
        })
        .returning(instructionSelect);

    await tx.update(s.trips).set({
      version: sql`${s.trips.version} + 1`,
      updatedAt: new Date(),
    }).where(eq(s.trips.id, tripId));
    return row;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}
