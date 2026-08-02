// O2C field-operations cost capture (260801-2200 phase-04).
// docs/prd/O2C dev.md: Ops (FORWARDER) records paid-on-behalf costs with
// receipt photos. Responses are FIELD-FILTERED to withhold margin/salary/
// cost-of-goods — the PRD forbids Ops from seeing those (§B0).

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import { ArSnapshotService } from './ar-snapshot.service';
import type { Tx } from './trip-shared';

/** Fields a FORWARDER is allowed to see on a field-cost response. */
export interface FieldCostResponse {
  tripId: number;
  status: string | null;
  carrierType: string;
  costRowId: number;
}

/**
 * Record a paid-on-behalf cost on behalf of a FORWARDER (Ops). Writes a
 * tripExpense row scoped to the forwarder. The response is deliberately a
 * narrow allow-list — never the full trip row (which carries revenue,
 * grossProfit, driverSalary, externalFreightCost the PRD withholds from Ops).
 *
 * If the parent trip is COMPLETED, the AR snapshot is marked dirty so the
 * accountant reconciliation view surfaces the late cost.
 */
export async function recordFieldCost(args: {
  tripId: number;
  forwarderId: number;
  expenseType: string;
  buyAmount: string;
  sellAmount: string;
  settlementMethod?: string;
  supplierId?: number | null;
  note?: string | null;
}): Promise<FieldCostResponse> {
  return db.transaction(async (tx) => {
    const [trip] = await tx.select({
      id: s.trips.id,
      status: s.trips.status,
      carrierType: s.trips.carrierType,
    }).from(s.trips).where(eq(s.trips.id, args.tripId)).limit(1);
    if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');

    const [expense] = await tx.insert(s.tripExpenses).values({
      tripId: trip.id,
      forwarderId: args.forwarderId,
      expenseType: args.expenseType,
      buyAmount: args.buyAmount,
      sellAmount: args.sellAmount,
      settlementMethod: args.settlementMethod ?? 'FORWARDER_ADVANCE',
      supplierId: args.supplierId ?? null,
      note: args.note ?? null,
      approvalStatus: 'PENDING',
    }).returning({ id: s.tripExpenses.id });

    // Late cost on a completed trip → mark the AR snapshot dirty.
    if (trip.status === 'COMPLETED') {
      await ArSnapshotService.markDirty(trip.id, tx);
    }

    // Field-filtered response: only what Ops needs.
    return {
      tripId: trip.id,
      status: trip.status,
      carrierType: trip.carrierType,
      costRowId: expense.id,
    };
  });
}

/**
 * Thin helper resolving the external-carrier soft pointer for display purposes.
 * Returns the customer/supplier name when the entity is resolvable, else null.
 * (App-layer resolution per the project's soft-columns convention.)
 */
export function resolveExternalCarrier(trip: {
  externalEntityId?: number | null;
  externalEntityType?: string | null;
}): { id: number; type: string } | null {
  if (!trip.externalEntityId || !trip.externalEntityType) return null;
  return { id: trip.externalEntityId, type: trip.externalEntityType };
}
