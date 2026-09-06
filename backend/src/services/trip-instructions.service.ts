// Trip Instructions (N2 / B1.3) — manager-authored contact + free-text guidance.
// Stored on the trips row itself since the 1:1 trip_instructions table was
// merged away (lean-down 2026-09-06). Manager writes via TripEdit; driver
// reads read-only via the driver portal (getDriverTripDetail includes
// `instructions`).

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';

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
  id: s.trips.id,
  tripId: s.trips.id,
  contactName: s.trips.instructionContactName,
  contactPhone: s.trips.instructionContactPhone,
  notes: s.trips.instructionNotes,
  updatedAt: s.trips.updatedAt,
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
 * Fetch the instructions for a trip. Returns null when no guidance has been
 * written yet (all fields null) — same wire shape as the old no-row case.
 */
export async function getTripInstructions(tripId: number): Promise<TripInstructionRow | null> {
  const [row] = await db.select(instructionSelect).from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  if (!row) return null;
  if (row.contactName == null && row.contactPhone == null && row.notes == null) {
    return null;
  }
  return row;
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
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const [trip] = await tx.select({
      id: s.trips.id,
      version: s.trips.version,
      deletedAt: s.trips.deletedAt,
    }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1).for('update');
    if (!trip || trip.deletedAt) throw new ApiError(404, 'Không tìm thấy chuyến đi');
    if (input.expectedVersion !== undefined && trip.version !== input.expectedVersion) {
      throw new ApiError(409, 'Dữ liệu đã bị thay đổi bởi người khác. Vui lòng tải lại trang.');
    }

    const [row] = await tx.update(s.trips)
      .set({
        instructionContactName: input.contactName ?? null,
        instructionContactPhone: input.contactPhone ?? null,
        instructionNotes: input.notes ?? null,
        version: sql`${s.trips.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(s.trips.id, tripId))
      .returning(instructionSelect);

    return row;
  };
  return runInTx(transaction, execute);
}
