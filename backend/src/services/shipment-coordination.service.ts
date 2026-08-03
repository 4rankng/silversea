import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import {
  assertClerkCanAccessShipment,
  isClerkScopedUser,
  loadClerkShipmentScope,
} from './clerk-shipment-scope.service';
import type { Tx } from './trip-shared';

export const CUSTOMER_EVENT_TYPES = [
  'MILESTONE',
  'DELIVERY_PLAN',
  'DOCUMENT_UPDATE',
  'DEBIT_NOTE_CONFIRMATION',
] as const;

export type CustomerEventType = typeof CUSTOMER_EVENT_TYPES[number];
export type CustomerAcknowledgementKind = 'SEEN' | 'ACKNOWLEDGED';

export interface CustomerVisibleContent {
  title: string;
  message: string;
  occurredAt: string;
  shipmentCode?: string;
}

export interface CreateCustomerVisibleEventInput {
  shipmentId: number;
  eventKey: string;
  eventType: CustomerEventType;
  title: string;
  message: string;
  occurredAt?: Date;
  milestoneId?: number | null;
  supersedesEventId?: number | null;
  createdBy: number;
}

export interface AcknowledgeCustomerEventInput {
  shipmentId: number;
  eventId: number;
  expectedVersion: number;
  kind: CustomerAcknowledgementKind;
  idempotencyKey: string;
  actor: AuthUser;
  expectedCustomerId?: number;
}

type ShipmentAccessRow = Pick<
  typeof s.shipments.$inferSelect,
  'id' | 'customerId' | 'responsibleUnitId' | 'shipmentCode'
>;

function normalizeBoundedText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new ApiError(400, `${label} là bắt buộc`);
  if (normalized.length > maxLength) {
    throw new ApiError(400, `${label} không được vượt quá ${maxLength} ký tự`);
  }
  return normalized;
}

function actorCustomerIds(actor: AuthUser): number[] {
  return actor.customerIds?.length
    ? actor.customerIds
    : actor.customerId != null
      ? [actor.customerId]
      : [];
}

export async function assertActorCanAccessShipment(
  tx: Tx,
  shipmentId: number,
  actor: AuthUser,
  options: { expectedCustomerId?: number; write?: boolean } = {},
): Promise<ShipmentAccessRow> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    responsibleUnitId: s.shipments.responsibleUnitId,
    shipmentCode: s.shipments.shipmentCode,
  }).from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  if (options.expectedCustomerId != null && shipment.customerId !== options.expectedCustomerId) {
    throw new ApiError(404, 'Không tìm thấy lô hàng');
  }

  if (actor.role === Role.CUSTOMER) {
    if (!actorCustomerIds(actor).includes(shipment.customerId)) {
      throw new ApiError(404, 'Không tìm thấy lô hàng');
    }
    if (options.write && options.expectedCustomerId == null) {
      throw new ApiError(404, 'Không tìm thấy lô hàng');
    }
    return shipment;
  }

  if (isClerkScopedUser(actor)) {
    const scope = await loadClerkShipmentScope(actor.userId, tx);
    assertClerkCanAccessShipment(scope, shipment);
    return shipment;
  }

  // Kế toán can close a ready shipment directly. Route handlers still enforce
  // per-action roles, while this check limits access to the shipment scope.
  const officeRoles: Role[] = options.write
    ? [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT, Role.CLERK]
    : [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT, Role.CLERK];
  if (!officeRoles.includes(actor.role)) throw new ApiError(403, 'Bạn không có quyền thao tác lô hàng');
  return shipment;
}

function toCustomerEventDto(
  row: typeof s.customerVisibleEvents.$inferSelect,
  acknowledgement?: Pick<typeof s.customerEventAcknowledgements.$inferSelect, 'acknowledgedAt'>,
) {
  const snapshot = row.contentSnapshot;
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    version: row.contentVersion,
    eventType: row.eventType,
    title: snapshot.title,
    message: snapshot.message,
    occurredAt: snapshot.occurredAt,
    acknowledged: Boolean(acknowledgement),
    acknowledgedAt: acknowledgement?.acknowledgedAt.toISOString() ?? null,
    ...(snapshot.shipmentCode ? { shipmentCode: snapshot.shipmentCode } : {}),
  };
}

export async function createCustomerVisibleEvent(
  input: CreateCustomerVisibleEventInput,
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const shipment = actor
      ? await assertActorCanAccessShipment(tx, input.shipmentId, actor, { write: true })
      : await loadShipmentForSystemEvent(tx, input.shipmentId);
    const eventKey = normalizeBoundedText(input.eventKey, 'Khóa sự kiện', 120);
    const title = normalizeBoundedText(input.title, 'Tiêu đề', 160);
    const message = normalizeBoundedText(input.message, 'Nội dung', 1_000);
    const occurredAt = input.occurredAt ?? new Date();

    let contentVersion = 1;
    if (input.supersedesEventId != null) {
      const [previous] = await tx.select().from(s.customerVisibleEvents)
        .where(eq(s.customerVisibleEvents.id, input.supersedesEventId))
        .limit(1)
        .for('update');
      if (
        !previous
        || previous.shipmentId !== shipment.id
        || previous.customerId !== shipment.customerId
        || previous.eventKey !== eventKey
      ) {
        throw new ApiError(409, 'Sự kiện trước đó không hợp lệ để tạo phiên bản mới');
      }
      contentVersion = previous.contentVersion + 1;
    }

    const contentSnapshot: CustomerVisibleContent = {
      title,
      message,
      occurredAt: occurredAt.toISOString(),
      ...(shipment.shipmentCode ? { shipmentCode: shipment.shipmentCode } : {}),
    };
    const [inserted] = await tx.insert(s.customerVisibleEvents).values({
      shipmentId: shipment.id,
      customerId: shipment.customerId,
      milestoneId: input.milestoneId ?? null,
      eventKey,
      contentVersion,
      eventType: input.eventType,
      classification: 'CUSTOMER_VISIBLE',
      contentSnapshot,
      supersedesEventId: input.supersedesEventId ?? null,
      createdBy: input.createdBy,
      occurredAt,
    }).onConflictDoNothing().returning();

    if (inserted) return toCustomerEventDto(inserted);
    const [existing] = await tx.select().from(s.customerVisibleEvents)
      .where(and(
        eq(s.customerVisibleEvents.eventKey, eventKey),
        eq(s.customerVisibleEvents.contentVersion, contentVersion),
      ))
      .limit(1);
    if (
      existing
      && existing.shipmentId === shipment.id
      && existing.customerId === shipment.customerId
      && existing.eventType === input.eventType
      && JSON.stringify(existing.contentSnapshot) === JSON.stringify(contentSnapshot)
    ) {
      return toCustomerEventDto(existing);
    }
    throw new ApiError(409, 'Khóa sự kiện đã được dùng cho nội dung khác');
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

async function loadShipmentForSystemEvent(tx: Tx, shipmentId: number): Promise<ShipmentAccessRow> {
  const [shipment] = await tx.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    responsibleUnitId: s.shipments.responsibleUnitId,
    shipmentCode: s.shipments.shipmentCode,
  }).from(s.shipments).where(eq(s.shipments.id, shipmentId)).limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
  return shipment;
}

export async function listCustomerVisibleEvents(args: {
  shipmentId: number;
  actor: AuthUser;
  expectedCustomerId?: number;
}) {
  return db.transaction(async (tx) => {
    await assertActorCanAccessShipment(tx, args.shipmentId, args.actor, {
      expectedCustomerId: args.expectedCustomerId,
    });
    const rows = await tx.select().from(s.customerVisibleEvents)
      .where(and(
        eq(s.customerVisibleEvents.shipmentId, args.shipmentId),
        eq(s.customerVisibleEvents.classification, 'CUSTOMER_VISIBLE'),
      ))
      .orderBy(desc(s.customerVisibleEvents.occurredAt), desc(s.customerVisibleEvents.id));
    if (rows.length === 0) return [];
    const acknowledgementConditions = [
      inArray(s.customerEventAcknowledgements.eventId, rows.map(row => row.id)),
      eq(s.customerEventAcknowledgements.customerId, rows[0]!.customerId),
      eq(s.customerEventAcknowledgements.kind, 'ACKNOWLEDGED'),
    ];
    if (args.actor.role === Role.CUSTOMER) {
      acknowledgementConditions.push(eq(s.customerEventAcknowledgements.acknowledgedBy, args.actor.userId));
    }
    const acknowledgements = await tx.select({
      eventId: s.customerEventAcknowledgements.eventId,
      eventVersion: s.customerEventAcknowledgements.eventVersion,
      acknowledgedAt: s.customerEventAcknowledgements.acknowledgedAt,
    }).from(s.customerEventAcknowledgements)
      .where(and(...acknowledgementConditions))
      .orderBy(desc(s.customerEventAcknowledgements.acknowledgedAt));
    const acknowledgementByEvent = new Map<number, typeof acknowledgements[number]>();
    for (const acknowledgement of acknowledgements) {
      if (!acknowledgementByEvent.has(acknowledgement.eventId)) {
        acknowledgementByEvent.set(acknowledgement.eventId, acknowledgement);
      }
    }
    return rows.map((row) => {
      const acknowledgement = acknowledgementByEvent.get(row.id);
      return toCustomerEventDto(
        row,
        acknowledgement?.eventVersion === row.contentVersion ? acknowledgement : undefined,
      );
    });
  });
}

export async function acknowledgeCustomerVisibleEvent(input: AcknowledgeCustomerEventInput) {
  return db.transaction(async (tx) => {
    const shipment = await assertActorCanAccessShipment(tx, input.shipmentId, input.actor, {
      expectedCustomerId: input.expectedCustomerId,
      write: input.actor.role === Role.CUSTOMER,
    });
    if (input.actor.role !== Role.CUSTOMER) {
      throw new ApiError(403, 'Chỉ khách hàng mới có thể xác nhận sự kiện');
    }
    const idempotencyKey = normalizeBoundedText(input.idempotencyKey, 'Khóa chống trùng', 100);
    const [event] = await tx.select().from(s.customerVisibleEvents)
      .where(and(
        eq(s.customerVisibleEvents.id, input.eventId),
        eq(s.customerVisibleEvents.shipmentId, shipment.id),
        eq(s.customerVisibleEvents.customerId, shipment.customerId),
        eq(s.customerVisibleEvents.classification, 'CUSTOMER_VISIBLE'),
      ))
      .limit(1)
      .for('update');
    if (!event) throw new ApiError(404, 'Không tìm thấy sự kiện khách hàng');
    if (event.contentVersion !== input.expectedVersion) {
      throw new ApiError(409, 'Sự kiện đã có phiên bản mới. Vui lòng tải lại.');
    }

    const [sameKey] = await tx.select().from(s.customerEventAcknowledgements)
      .where(eq(s.customerEventAcknowledgements.idempotencyKey, idempotencyKey))
      .limit(1);
    if (sameKey) {
      if (
        sameKey.eventId === event.id
        && sameKey.eventVersion === event.contentVersion
        && sameKey.customerId === shipment.customerId
        && sameKey.acknowledgedBy === input.actor.userId
        && sameKey.kind === input.kind
      ) return sameKey;
      throw new ApiError(409, 'Khóa chống trùng đã được dùng cho yêu cầu khác');
    }

    const [inserted] = await tx.insert(s.customerEventAcknowledgements).values({
      eventId: event.id,
      eventVersion: event.contentVersion,
      customerId: shipment.customerId,
      acknowledgedBy: input.actor.userId,
      kind: input.kind,
      idempotencyKey,
    }).onConflictDoNothing().returning();
    if (inserted) return inserted;

    const [existing] = await tx.select().from(s.customerEventAcknowledgements)
      .where(and(
        eq(s.customerEventAcknowledgements.eventId, event.id),
        eq(s.customerEventAcknowledgements.acknowledgedBy, input.actor.userId),
        eq(s.customerEventAcknowledgements.kind, input.kind),
      ))
      .limit(1);
    if (existing && existing.eventVersion === event.contentVersion) return existing;
    throw new ApiError(409, 'Sự kiện đã được xác nhận bằng phiên bản khác');
  });
}
