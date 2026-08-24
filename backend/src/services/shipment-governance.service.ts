import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { runInTx } from '../lib/tx';
import type { Tx } from './trip-shared';
import { softDeleteShipment } from './shipment-lifecycle.service';
import { assertCusShipmentScope } from './cus-shipment-workspace-reads.service';
import { isPastRunCutoff } from './container-date-filter';
import { IDEMPOTENCY_ENDPOINTS } from './idempotency.service';

export { isPastRunCutoff } from './container-date-filter';

// Material-write boundary markers — referenced by material-write-registry-exhaustive.test.ts
// endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST
// endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST_DECISION
// endpoint: IDEMPOTENCY_ENDPOINTS.CONTAINER_EDIT_REQUEST
// endpoint: IDEMPOTENCY_ENDPOINTS.CONTAINER_EDIT_REQUEST_DECISION

const ACTIVE_GOVERNANCE_STATUSES = ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'] as const;

// CUS-initiated deletion (direct or admin-approved) may tombstone a shipment
// through READY_FOR_DISPATCH — a carrier allocation with no trip row yet —
// but never DISPATCHED/IN_TRANSIT/PENDING_EXPENSE_APPROVAL/COMPLETED, where a
// real trip exists and soft-delete would orphan it (same boundary
// `softDeleteShipment` enforces by default for every other caller; this only
// adds the one additional pre-trip status this flow needs).
const CUS_DELETE_ALLOWED_STATUSES = ['PENDING_DATE', 'READY_FOR_DISPATCH', 'CANCELED'] as const;

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
    await assertCusShipmentScope(args.actor, shipment, tx);
    if (shipment.version !== args.version) {
      throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
    }

    const pastCutoff = isPastRunCutoff(shipment.expectedDeliveryDate);

    if (!pastCutoff) {
      const deleted = await softDeleteShipment(args.shipmentId, {
        version: args.version,
        deletedBy: args.actor.userId,
        allowedStatuses: CUS_DELETE_ALLOWED_STATUSES,
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

    const deleted = await softDeleteShipment(args.shipmentId, {
      version: action.originalVersion,
      deletedBy: args.actor.userId,
      allowedStatuses: CUS_DELETE_ALLOWED_STATUSES,
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

/**
 * CUS requests an edit to container fields (route, container number, pickup/drop-off)
 * past the run-date cutoff. Creates a governance action for admin approval.
 */
export async function requestContainerEdit(args: {
  shipmentId: number;
  containerId: number;
  fields: Record<string, unknown>;
  reason: string;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.CUS) {
    throw new ApiError(403, 'Chỉ CUS mới được yêu cầu chỉnh sửa container.');
  }

  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select().from(s.shipments)
      .where(and(eq(s.shipments.id, args.shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertCusShipmentScope(args.actor, shipment, tx);

    const [container] = await tx.select({ id: s.shipmentContainers.id }).from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.id, args.containerId),
        eq(s.shipmentContainers.shipmentId, shipment.id),
      ))
      .limit(1);
    if (!container) throw new ApiError(404, 'Không tìm thấy container thuộc lô hàng này');

    const [pending] = await tx.select().from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'SHIPMENT'),
        eq(s.governanceActions.subjectId, shipment.id),
        eq(s.governanceActions.actionKind, 'CONTAINER_EDIT_REQUEST'),
        inArray(s.governanceActions.status, [...ACTIVE_GOVERNANCE_STATUSES]),
      ))
      .orderBy(desc(s.governanceActions.id))
      .limit(1)
      .for('update');

    const afterSnapshot = {
      containerId: args.containerId,
      fields: args.fields,
    };

    if (pending) {
      const [updated] = await tx.update(s.governanceActions).set({
        afterSnapshot,
        reason: args.reason,
        updatedAt: new Date(),
        version: sql`${s.governanceActions.version} + 1`,
      }).where(eq(s.governanceActions.id, pending.id)).returning();
      return { action: updated, replayed: true };
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'SHIPMENT',
      subjectId: shipment.id,
      actionKind: 'CONTAINER_EDIT_REQUEST',
      status: 'PENDING_APPROVAL',
      reason: args.reason,
      originalVersion: shipment.version,
      beforeSnapshot: {
        shipmentCode: shipment.shipmentCode,
      },
      afterSnapshot,
      deltaSnapshot: {
        resource: 'container',
        operation: 'UPDATE',
      },
      makerId: args.actor.userId,
      makerRole: args.actor.role,
    }).returning();

    return { action, replayed: false };
  };

  return runInTx(args.transaction, execute);
}

/**
 * Admin/MANAGER approves or rejects a pending container edit request.
 */
export async function decideContainerEditRequest(args: {
  shipmentId: number;
  actionId: number;
  decision: 'APPROVE' | 'REJECT';
  expectedVersion: number;
  reason: string;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (args.actor.role !== Role.ADMIN && args.actor.role !== Role.MANAGER) {
    throw new ApiError(403, 'Chỉ ADMIN/MANAGER được xử lý yêu cầu chỉnh sửa container.');
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
      || action.actionKind !== 'CONTAINER_EDIT_REQUEST'
    ) {
      throw new ApiError(404, 'Không tìm thấy yêu cầu chỉnh sửa container');
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
      return { action: rejected, applied: false };
    }

    const afterSnapshot = action.afterSnapshot as { containerId?: number; fields?: Record<string, unknown> } | null;
    if (!afterSnapshot?.containerId || !afterSnapshot?.fields) {
      throw new ApiError(409, 'Yêu cầu chỉnh sửa thiếu dữ liệu container.');
    }

    const containerId = afterSnapshot.containerId;
    const fields = afterSnapshot.fields;

    const [container] = await tx.select({ id: s.shipmentContainers.id }).from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.id, containerId),
        eq(s.shipmentContainers.shipmentId, action.subjectId),
      ))
      .limit(1);
    if (!container) throw new ApiError(409, 'Container không còn thuộc lô hàng của yêu cầu này.');

    const updateData: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(fields)) {
      if (['routeId', 'containerNumber', 'liftSiteId', 'dropoffSiteId'].includes(key)) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length > 1) {
      await tx.update(s.shipmentContainers)
        .set(updateData)
        .where(eq(s.shipmentContainers.id, containerId));
    }

    const [approved] = await tx.update(s.governanceActions).set({
      status: 'APPROVED',
      approverId: args.actor.userId,
      approverRole: args.actor.role,
      approvedAt: now,
      updatedAt: now,
      version: sql`${s.governanceActions.version} + 1`,
    }).where(eq(s.governanceActions.id, args.actionId)).returning();

    return { action: approved, applied: true };
  };

  return runInTx(args.transaction, execute);
}
