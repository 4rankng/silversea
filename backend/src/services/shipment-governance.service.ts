import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { runInTx } from '../lib/tx';
import type { Tx } from './trip-shared';
import { softDeleteShipment } from './shipment-lifecycle.service';
import { isPastRunCutoff } from './container-date-filter';


export { isPastRunCutoff } from './container-date-filter';

// Material-write boundary markers — referenced by material-write-registry-exhaustive.test.ts
// endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST
// endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST_DECISION

const ACTIVE_GOVERNANCE_STATUSES = ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'] as const;

// CUS-initiated deletion (direct or admin-approved) shares the
// `softDeleteShipment` boundary: tombstoning is allowed while no container has
// been dispatched (no live trip linked directly or through a fulfillment), so
// a carrier allocation without a trip may still be removed but a dispatched
// shipment never can.

/**
 * CUS requests deletion of a shipment.
 * - If before run-date cutoff: soft-delete immediately.
 * - If on/after run-date cutoff: create a governance action for admin approval.
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

    const pastCutoff = isPastRunCutoff(shipment.expectedDeliveryDate);

    if (!pastCutoff) {
      const deleted = await softDeleteShipment(args.shipmentId, {
        version: args.version,
        deletedBy: args.actor.userId,
      }, tx);
      return { action: null, deleted, pendingApproval: false };
    }

    const [pending] = await tx.select().from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'SHIPMENT'),
        eq(s.governanceActions.subjectId, shipment.id),
        eq(s.governanceActions.actionKind, 'SHIPMENT_DELETE_REQUEST'),
        inArray(s.governanceActions.status, [...ACTIVE_GOVERNANCE_STATUSES]),
      ))
      .orderBy(desc(s.governanceActions.id))
      .limit(1)
      .for('update');
    if (pending) {
      return { action: pending, deleted: null, pendingApproval: true, replayed: true };
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'SHIPMENT',
      subjectId: shipment.id,
      actionKind: 'SHIPMENT_DELETE_REQUEST',
      status: 'PENDING_APPROVAL',
      reason: args.reason,
      originalVersion: shipment.version,
      beforeSnapshot: {
        shipmentCode: shipment.shipmentCode,
        expectedDeliveryDate: shipment.expectedDeliveryDate,
      },
      afterSnapshot: {
        state: 'DELETED',
      },
      deltaSnapshot: {
        resource: 'shipment',
        operation: 'DELETE',
      },
      makerId: args.actor.userId,
      makerRole: args.actor.role,
    }).returning();

    return { action, deleted: null, pendingApproval: true, replayed: false };
  };

  return runInTx(args.transaction, execute);
}

/**
 * Admin/MANAGER approves or rejects a pending shipment deletion request.
 */
export async function decideShipmentDeleteRequest(args: {
  shipmentId: number;
  actionId: number;
  decision: 'APPROVE' | 'REJECT';
  expectedVersion: number;
  reason: string;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.ADMIN && args.actor.role !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ ADMIN/MANAGER được xử lý yêu cầu xóa lô hàng.');
  }

  const execute = async (tx: Tx) => {
    const [action] = await tx.select().from(s.governanceActions)
      .where(eq(s.governanceActions.id, args.actionId))
      .limit(1)
      .for('update');
    if (
      !action
      || action.subjectType !== 'SHIPMENT'
      || action.subjectId !== args.shipmentId
      || action.actionKind !== 'SHIPMENT_DELETE_REQUEST'
    ) {
      throw new ApiError(404, 'Không tìm thấy yêu cầu xóa lô hàng');
    }
    if (action.version !== args.expectedVersion) {
      throw new ApiError(409, 'Yêu cầu đã được người khác xử lý. Vui lòng tải lại.');
    }
    if (action.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, 'Yêu cầu không còn ở trạng thái chờ xử lý.');
    }

    const now = new Date();

    if (args.decision === 'REJECT') {
      const [rejected] = await tx.update(s.governanceActions).set({
        status: 'REJECTED',
        rejectedBy: args.actor.userId,
        rejectedRole: args.actor.role,
        rejectedAt: now,
        rejectionReason: args.reason,
        updatedAt: now,
        version: sql`${s.governanceActions.version} + 1`,
      }).where(eq(s.governanceActions.id, args.actionId)).returning();
      return { action: rejected, deleted: false };
    }

    await softDeleteShipment(args.shipmentId, {
      version: action.originalVersion,
      deletedBy: args.actor.userId,
    }, tx);

    const [approved] = await tx.update(s.governanceActions).set({
      status: 'APPROVED',
      approverId: args.actor.userId,
      approverRole: args.actor.role,
      approvedAt: now,
      updatedAt: now,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(eq(s.governanceActions.id, args.actionId)).returning();

    return { action: approved, deleted: true };
  };

  return runInTx(args.transaction, execute);
}
