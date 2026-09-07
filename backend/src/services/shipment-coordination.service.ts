import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import {
  lockApplicationOwnedUniqueness,
  lockApplicationOwnedUniquenessSet,
} from './application-owned-uniqueness.service';
import type { Tx } from './trip-shared';

export const CUSTOMER_EVENT_TYPES = [
  'MILESTONE',
  'DELIVERY_PLAN',
  'DOCUMENT_UPDATE',
  'DEBIT_NOTE_CONFIRMATION',
] as const;

export type CustomerEventType = typeof CUSTOMER_EVENT_TYPES[number];
export type CustomerAcknowledgementKind = 'SEEN' | 'ACKNOWLEDGED';
type CustomerVisibleEventRow = typeof s.customerVisibleEvents.$inferSelect;

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

const LEGACY_TRIP_MILESTONE_EVENT_PREFIX = 'trip:';
const SHIPMENT_STATUS_EVENT_TITLE_BY_STATUS = {
  IN_TRANSIT: 'Đang vận chuyển',
  COMPLETED: 'Đã giao hàng',
} as const;

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
    // Ad-hoc shipments (null customer) have no portal audience — the portal
    // scope check can never include them.
    if (shipment.customerId == null || !actorCustomerIds(actor).includes(shipment.customerId)) {
      throw new ApiError(404, 'Không tìm thấy lô hàng');
    }
    if (options.write && options.expectedCustomerId == null) {
      throw new ApiError(404, 'Không tìm thấy lô hàng');
    }
    return shipment;
  }

  // Kế toán can close a ready shipment directly. Route handlers still enforce
  // per-action roles, while this check limits access to the shipment scope.
  const officeRoles: Role[] = options.write
    ? [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT, Role.CUS]
    : [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.ACCOUNTANT, Role.CUS];
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
  };
}

function isLegacyTripMilestoneEvent(
  row: CustomerVisibleEventRow,
  title: string,
  status: keyof typeof SHIPMENT_STATUS_EVENT_TITLE_BY_STATUS,
): boolean {
  return row.eventType === 'MILESTONE'
    && new RegExp(`^${LEGACY_TRIP_MILESTONE_EVENT_PREFIX}\\d+:milestone:${status}$`).test(row.eventKey)
    && row.contentSnapshot.title === title;
}

function isShipmentStatusEvent(
  row: CustomerVisibleEventRow,
  shipmentId: number,
  title: string,
): boolean {
  return row.eventType === 'MILESTONE'
    && row.eventKey.startsWith(`shipment:${shipmentId}:status-history:`)
    && row.contentSnapshot.title === title;
}

function reconcileHistoricalShipmentMilestoneEvents(
  shipmentId: number,
  rows: CustomerVisibleEventRow[],
  statusHistoryRows: Array<Pick<typeof s.shipmentStatusHistory.$inferSelect, 'toStatus' | 'changedAt'>>,
  acknowledgedEventIds: ReadonlySet<number> = new Set<number>(),
): CustomerVisibleEventRow[] {
  if (rows.length < 2 || statusHistoryRows.length === 0) return rows;

  const keepIds = new Set(rows.map((row) => row.id));
  const compareCandidateRows = (left: CustomerVisibleEventRow, right: CustomerVisibleEventRow) => (
    Number(acknowledgedEventIds.has(right.id)) - Number(acknowledgedEventIds.has(left.id))
    || right.occurredAt.getTime() - left.occurredAt.getTime()
    || right.id - left.id
  );

  for (const [status, title] of Object.entries(SHIPMENT_STATUS_EVENT_TITLE_BY_STATUS)) {
    const preferredRows = rows.filter((row) => isShipmentStatusEvent(row, shipmentId, title));
    const legacyRows = rows.filter((row) => isLegacyTripMilestoneEvent(row, title, status as keyof typeof SHIPMENT_STATUS_EVENT_TITLE_BY_STATUS));
    const candidateRows = [...preferredRows, ...legacyRows];
    const transitions = statusHistoryRows
      .filter((row) => row.toStatus === status)
      .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
    if (transitions.length === 0 || candidateRows.length <= transitions.length) continue;

    const chosenIds = new Set<number>();
    const latestRowInWindow = (
      sourceRows: CustomerVisibleEventRow[],
      windowStart: number,
      windowEnd: number | null,
    ): CustomerVisibleEventRow | undefined => {
      const rowsInWindow = sourceRows
        .filter((row) => {
          if (chosenIds.has(row.id)) return false;
          const occurredAt = row.occurredAt.getTime();
          return occurredAt >= windowStart && (windowEnd == null || occurredAt < windowEnd);
        })
        .sort(compareCandidateRows);
      return rowsInWindow[0];
    };

    for (let index = 0; index < transitions.length; index += 1) {
      const windowStart = transitions[index]!.changedAt.getTime();
      const windowEnd = index + 1 < transitions.length
        ? transitions[index + 1]!.changedAt.getTime()
        : null;
      const preferred = latestRowInWindow(preferredRows, windowStart, windowEnd);
      if (preferred) {
        chosenIds.add(preferred.id);
        continue;
      }
      const legacy = latestRowInWindow(legacyRows, windowStart, windowEnd);
      if (legacy) chosenIds.add(legacy.id);
    }

    if (chosenIds.size < transitions.length) {
      for (const row of [...preferredRows, ...legacyRows].sort(compareCandidateRows)) {
        if (chosenIds.size >= transitions.length) break;
        if (!chosenIds.has(row.id)) chosenIds.add(row.id);
      }
    }

    for (const row of candidateRows) {
      if (!chosenIds.has(row.id)) keepIds.delete(row.id);
    }
  }

  return rows.filter((row) => keepIds.has(row.id));
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
    // Ad-hoc shipments (Lệnh chạy ngoài) have no catalog customer, hence no
    // portal audience — customer-visible events are skipped, not failed: the
    // operational flow (create/dispatch/lifecycle) proceeds regardless.
    if (shipment.customerId == null) return null;
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
    await lockApplicationOwnedUniqueness(tx, 'customer-visible-event', [eventKey, contentVersion]);

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
    if (existing) {
      throw new ApiError(409, 'Khóa sự kiện đã được dùng cho nội dung khác');
    }

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
    }).returning();

    if (inserted) return toCustomerEventDto(inserted);
    throw new ApiError(409, 'Khóa sự kiện đã được dùng cho nội dung khác');
  };
  return runInTx(transaction, execute);
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
    const statusHistoryRows = await tx.select({
      toStatus: s.shipmentStatusHistory.toStatus,
      changedAt: s.shipmentStatusHistory.changedAt,
    }).from(s.shipmentStatusHistory)
      .where(eq(s.shipmentStatusHistory.shipmentId, args.shipmentId))
      .orderBy(desc(s.shipmentStatusHistory.changedAt), desc(s.shipmentStatusHistory.id));
    const visibleRows = reconcileHistoricalShipmentMilestoneEvents(
      args.shipmentId,
      rows,
      statusHistoryRows,
      new Set(acknowledgementByEvent.keys()),
    );
    if (visibleRows.length === 0) return [];
    return visibleRows.map((row) => {
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
    if (shipment.customerId == null) {
      // Unreachable for a CUSTOMER actor (the access assert already 404'd),
      // but the narrowing keeps the event lookup honest.
      throw new ApiError(404, 'Không tìm thấy sự kiện khách hàng');
    }
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

    await lockApplicationOwnedUniquenessSet(tx, [
      {
        scope: 'customer-event-ack-idempotency',
        parts: [idempotencyKey],
      },
      {
        scope: 'customer-event-ack-actor-kind',
        parts: [event.id, input.actor.userId, input.kind],
      },
    ]);

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

    const [existing] = await tx.select().from(s.customerEventAcknowledgements)
      .where(and(
        eq(s.customerEventAcknowledgements.eventId, event.id),
        eq(s.customerEventAcknowledgements.acknowledgedBy, input.actor.userId),
        eq(s.customerEventAcknowledgements.kind, input.kind),
      ))
      .limit(1);
    if (existing && existing.eventVersion === event.contentVersion) return existing;
    if (existing) throw new ApiError(409, 'Sự kiện đã được xác nhận bằng phiên bản khác');

    const [inserted] = await tx.insert(s.customerEventAcknowledgements).values({
      eventId: event.id,
      eventVersion: event.contentVersion,
      customerId: shipment.customerId,
      acknowledgedBy: input.actor.userId,
      kind: input.kind,
      idempotencyKey,
    }).returning();
    if (inserted) return inserted;
    throw new ApiError(409, 'Sự kiện đã được xác nhận bằng phiên bản khác');
  });
}
