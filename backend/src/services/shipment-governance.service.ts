import { and, eq, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { runInTx } from '../lib/tx';
import type { Tx } from './trip-shared';
import { softDeleteShipment } from './shipment-lifecycle.service';


export { isPastRunCutoff } from './container-date-filter';

// Material-write boundary markers — referenced by material-write-registry-exhaustive.test.ts
// endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST

// CUS-initiated deletion shares the `softDeleteShipment` boundary:
// tombstoning is allowed while no container has been dispatched (no live trip
// linked directly or through a fulfillment), so a carrier allocation without
// a trip may still be removed but a dispatched shipment never can.

/**
 * CUS deletes a shipment directly (2026-09-10 user directive: the phê duyệt
 * flow is removed — past-cutoff deletions no longer wait for admin approval).
 */
export async function requestShipmentDelete(args: {
  shipmentId: number;
  version: number;
  reason: string;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.CUS) {
    throw new ApiError(403, 'Chỉ CUS mới được yêu cầu xóa lô hàng.');
  }

  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, args.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    if (shipment.version !== args.version) {
      throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
    }

    // 2026-09-10 user directive: the phê duyệt flow is removed — a CUS
    // delete request deletes immediately regardless of the run-date cutoff.
    // Audit history rides on softDeleteShipment (deletedAt/deletedBy) plus
    // the request's audit-log entry.
    const deleted = await softDeleteShipment(args.shipmentId, {
      version: args.version,
      deletedBy: args.actor.userId,
    }, tx);
    return { action: null, deleted, pendingApproval: false };
  };

  return runInTx(args.transaction, execute);
}
