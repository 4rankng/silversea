import { and, eq } from 'drizzle-orm';
import { Role, type CustomerDeliveryResponseInput } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import { assertActorCanAccessShipment } from './shipment-coordination.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';

function responseDto(row: typeof s.customerDeliveryResponses.$inferSelect) {
  return { id: row.id, deliveryAttemptId: row.deliveryAttemptId, eventId: row.customerVisibleEventId, eventVersion: row.eventVersion, decision: row.decision, reason: row.reason, evidenceRefs: row.evidenceRefs, respondedAt: row.respondedAt.toISOString() };
}

export async function submitCustomerDeliveryResponse(args: {
  shipmentId: number; eventId: number; selectedCustomerId: number; actor: AuthUser;
  input: CustomerDeliveryResponseInput; idempotencyKey: string;
}): Promise<{ response: ReturnType<typeof responseDto>; replayed: boolean }> {
  if (args.actor.role !== Role.CUSTOMER) throw new ApiError(403, 'Chỉ khách hàng mới có thể phản hồi giao hàng');
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.PORTAL_DELIVERY_RESPONSE,
    idempotencyKey: args.idempotencyKey,
    payload: { shipmentId: args.shipmentId, eventId: args.eventId, selectedCustomerId: args.selectedCustomerId, actorId: args.actor.userId, ...args.input },
    createdBy: args.actor.userId,
    entityType: 'customer_delivery_response',
    create: async (tx) => {
      const shipment = await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, { expectedCustomerId: args.selectedCustomerId, write: true });
      const [event] = await tx.select().from(s.customerVisibleEvents).where(and(eq(s.customerVisibleEvents.id, args.eventId), eq(s.customerVisibleEvents.shipmentId, shipment.id), eq(s.customerVisibleEvents.customerId, shipment.customerId))).limit(1).for('update');
      if (!event) throw new ApiError(404, 'Không tìm thấy sự kiện giao hàng');
      if (event.contentVersion !== args.input.expectedVersion) throw new ApiError(409, 'Sự kiện đã có phiên bản mới. Vui lòng tải lại.');
      const [supersedingEvent] = await tx.select({ id: s.customerVisibleEvents.id }).from(s.customerVisibleEvents).where(and(eq(s.customerVisibleEvents.supersedesEventId, event.id), eq(s.customerVisibleEvents.shipmentId, shipment.id), eq(s.customerVisibleEvents.customerId, shipment.customerId))).limit(1).for('update');
      if (supersedingEvent) throw new ApiError(409, 'Sự kiện đã được thay thế. Vui lòng tải lại.');
      const [attempt] = await tx.select().from(s.deliveryAttempts).where(and(eq(s.deliveryAttempts.customerVisibleEventId, event.id), eq(s.deliveryAttempts.shipmentId, shipment.id))).limit(1).for('update');
      if (!attempt) throw new ApiError(409, 'Sự kiện không phải báo cáo giao hàng có thể phản hồi');
      const [existing] = await tx.select().from(s.customerDeliveryResponses).where(and(eq(s.customerDeliveryResponses.customerVisibleEventId, event.id), eq(s.customerDeliveryResponses.eventVersion, event.contentVersion), eq(s.customerDeliveryResponses.customerId, shipment.customerId))).limit(1);
      if (existing) {
        throw new ApiError(409, 'Sự kiện đã có phản hồi của khách hàng');
      }
      const [inserted] = await tx.insert(s.customerDeliveryResponses).values({ deliveryAttemptId: attempt.id, customerVisibleEventId: event.id, eventVersion: event.contentVersion, customerId: shipment.customerId, decision: args.input.decision, reason: args.input.reason?.trim() || null, evidenceRefs: args.input.evidenceRefs ?? [], respondedBy: args.actor.userId, idempotencyKey: args.idempotencyKey }).returning();
      if (!inserted) throw new ApiError(409, 'Không thể lưu phản hồi giao hàng');
      return responseDto(inserted);
    },
    getEntityId: (result) => result.id,
  });
  return { response: result, replayed };
}

export async function resolveCustomerDeliveryDispute(args: {
  responseId: number;
  actor: AuthUser;
  resolution: string;
}) {
  if (![Role.ADMIN, Role.MANAGER].includes(args.actor.role)) throw new ApiError(403, 'Chỉ quản lý mới có thể xử lý phản hồi sai lệch');
  return db.transaction(async (tx) => {
    const [response] = await tx.select().from(s.customerDeliveryResponses)
      .where(and(eq(s.customerDeliveryResponses.id, args.responseId), eq(s.customerDeliveryResponses.decision, 'DISPUTED')))
      .limit(1)
      .for('update');
    if (!response) throw new ApiError(404, 'Không tìm thấy phản hồi sai lệch');
    const [existing] = await tx.select().from(s.governanceActions).where(and(
      eq(s.governanceActions.subjectType, 'CUSTOMER_DELIVERY_RESPONSE'),
      eq(s.governanceActions.subjectId, response.id),
      eq(s.governanceActions.actionKind, 'CUSTOMER_DELIVERY_DISPUTE_RESOLUTION'),
      eq(s.governanceActions.status, 'APPLIED'),
    )).limit(1);
    if (existing) return { id: existing.id, responseId: response.id, resolution: existing.reason, resolvedAt: existing.appliedAt?.toISOString() ?? existing.updatedAt.toISOString(), replayed: true };
    const now = new Date();
    const [created] = await tx.insert(s.governanceActions).values({
      subjectType: 'CUSTOMER_DELIVERY_RESPONSE',
      subjectId: response.id,
      actionKind: 'CUSTOMER_DELIVERY_DISPUTE_RESOLUTION',
      status: 'APPLIED',
      reason: args.resolution,
      originalVersion: response.eventVersion,
      beforeSnapshot: { decision: response.decision, reason: response.reason, evidenceRefs: response.evidenceRefs },
      afterSnapshot: { resolution: args.resolution },
      makerId: args.actor.userId,
      makerRole: args.actor.role,
      approverId: args.actor.userId,
      approverRole: args.actor.role,
      approvedAt: now,
      appliedAt: now,
      applicationResult: { deliveryResponseId: response.id },
    }).returning();
    if (!created) throw new ApiError(409, 'Không thể ghi nhận xử lý phản hồi');
    return { id: created.id, responseId: response.id, resolution: created.reason, resolvedAt: now.toISOString(), replayed: false };
  });
}
