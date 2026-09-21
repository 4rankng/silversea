/**
 * Driver fulfillment write path (split from driver.service, 2026-09-01 — LOC
 * budget): milestone recording on owned fulfillments, start side-effects,
 * incidental costs, and the "HOÀN THÀNH CHUYẾN" full-close. Shared
 * progress-event/milestone helpers live in trip-pod.service; the read models
 * and trip-level progress stay in driver.service, which re-exports this
 * module's public surface for import compatibility.
 */
import { config } from '../config';
import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  DRIVER_FULFILLMENT_PROGRESS_SEQUENCE,
  DriverProgressEventType,
  Role,
  TripStatus,
  type DriverIncidentalCostType,
  type DriverIncidentalCostInput,
  type ExpenseCostGroup,
} from '@tingting/shared';
import { upsertExpenseAccountingSource } from './expense-accounting-source.service';
import { ApiError } from '../errors';
import { runIdempotent, IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { assertTripShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import type { Tx } from './trip-shared';
import { transitionTripStatus } from './trip-status-machine.service';
import { syncAttendanceAfterStatusChange, toBusinessDateString } from './trip-attendance-sync.service';
import { syncTripWorkDays } from './attendance.service';
import { invalidateReportCaches } from '../lib/report-cache';
import { createCustomerVisibleEvent } from './shipment-coordination.service';
import {
  assertTripOwnedByDriver,
  buildDriverFulfillmentSequenceError,
  getDriverCompletionEvidenceStatus,
  insertDriverProgressEventTx,
  isDriverFulfillmentMilestone,
  listOrderedMilestoneTypesTx,
  loadDriverProgressEventTx,
  loadOwnedFulfillmentTrip,
  nextDriverFulfillmentMilestone,
  type DriverCompletionEvidenceStatus,
  type DriverProgressEvent,
} from './trip-pod.service';

/**
 * Kết hợp sequencing gate (LoHangKepKetHop §3.3 / TC-GHEP-010): Lệnh 2 of an
 * ACTIVE KET_HOP pair must not start until Lệnh 1 has finished returning the
 * cargo — "finished" means the first trip is COMPLETED or its completion
 * evidence is already submitted (the board's same readiness signal). KEP
 * pairs run simultaneously, so they never gate. Lệnh 1 (order 1) and unpaired
 * trips pass straight through.
 */
async function assertKetHopSequencingAllowedTx(tx: Tx, tripId: number): Promise<void> {
  const [row] = await tx.select({
    pairId: s.trips.activeTripPairId,
    pairOrder: s.trips.activeTripPairOrder,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!row?.pairId || row.pairOrder !== 2) return;

  const [pair] = await tx.select({
    status: s.tripPairs.status,
    pairKind: s.tripPairs.pairKind,
    firstTripId: s.tripPairs.firstTripId,
  }).from(s.tripPairs).where(eq(s.tripPairs.id, row.pairId)).limit(1);
  if (!pair || pair.status !== 'ACTIVE' || pair.pairKind !== 'KET_HOP') return;

  const [first] = await tx.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, pair.firstTripId)).limit(1);
  const firstDone = first?.status === TripStatus.COMPLETED
    || (await getDriverCompletionEvidenceStatus(pair.firstTripId, tx)).ready;
  if (!firstDone) {
    throw new ApiError(
      409,
      'Đây là Lệnh 2 của cặp kết hợp: hãy hoàn thành trả hàng Lệnh 1 trước khi bắt đầu lệnh này.',
    );
  }
}

/**
 * Shared milestone-event recorder (tx-scoped): inserts the progress event,
 * publishes the customer-visible milestone event, and — for DELIVERED —
 * writes the deliveryAttempts audit row. Used by both the driver's explicit
 * progress route and the completion auto-record loop below.
 */
async function recordMilestoneEventTx(
  tx: Tx,
  ownedTrip: Awaited<ReturnType<typeof loadOwnedFulfillmentTrip>>,
  driverId: number,
  eventType: DriverProgressEventType,
  occurredAtIso: string,
  actorUserId: number,
  evidence: { note?: string; inferredFromCompletion?: boolean } = {},
): Promise<DriverProgressEvent> {
  const event = await insertDriverProgressEventTx(tx, ownedTrip.tripId, driverId, {
    eventType, occurredAt: occurredAtIso, note: evidence.note,
  }, actorUserId);
  const publication = customerPublicationForDriverEvent(eventType, event.occurredAt, evidence.inferredFromCompletion);
  if (publication) {
    const customerEvent = await createCustomerVisibleEvent({
      shipmentId: ownedTrip.shipmentId,
      eventKey: `driver-progress:${event.id}:${eventType}`,
      eventType: 'MILESTONE',
      title: publication.title,
      message: publication.message,
      occurredAt: event.occurredAt,
      createdBy: actorUserId,
    }, undefined, tx);
    // Ad-hoc shipments produce no customer-visible event (skipped upstream),
    // so the delivery attempt records only what exists.
    if (eventType === DriverProgressEventType.DELIVERED) {
      const [scope] = await tx.select({
        shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      }).from(s.shipmentFulfillments).where(eq(s.shipmentFulfillments.id, ownedTrip.fulfillmentId)).limit(1);
      await tx.insert(s.deliveryAttempts).values({
        shipmentId: ownedTrip.shipmentId,
        fulfillmentId: ownedTrip.fulfillmentId,
        tripId: ownedTrip.tripId,
        shipmentContainerId: scope?.shipmentContainerId ?? null,
        driverProgressEventId: event.id,
        customerVisibleEventId: customerEvent?.id ?? null,
        result: 'DELIVERED',
        occurredAt: event.occurredAt,
        recordedBy: actorUserId,
      });
    }
  }
  return event;
}

export async function recordDriverFulfillmentProgress(args: {
  fulfillmentId: number;
  driverId: number;
  input: {
    eventType: DriverProgressEventType;
    occurredAt: string;
    note?: string;
    expectedVersion?: number;
  };
  recordedBy: number;
  idempotencyKey: string | undefined;
}): Promise<{ event: DriverProgressEvent; replayed: boolean }> {
  const eventType = args.input.eventType;
  if (!isDriverFulfillmentMilestone(eventType)) {
    throw new ApiError(400, 'Mốc thực hiện không hợp lệ.');
  }

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PROGRESS,
    idempotencyKey: args.idempotencyKey,
    payload: {
      fulfillmentId: args.fulfillmentId,
      driverId: args.driverId,
      eventType: args.input.eventType,
      occurredAt: args.input.occurredAt,
      note: args.input.note ?? null,
      expectedVersion: args.input.expectedVersion ?? null,
    },
    createdBy: args.recordedBy,
    entityType: 'driver_progress_event',
    create: async (tx) => {
      // Shipment is the aggregate lock root. Acquire it before the trip so
      // driver acknowledgement follows the same lock order as dispatch/POD
      // review and cannot deadlock against those workflows.
      await tx.select({ id: s.shipments.id })
        .from(s.shipmentFulfillments)
        .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
        .where(eq(s.shipmentFulfillments.id, args.fulfillmentId))
        .for('update');
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true, canceledConflict: 'Chuyến đi đã hủy — không thể thực hiện thao tác này.' });
      if (args.input.expectedVersion != null && ownedTrip.tripVersion !== args.input.expectedVersion) {
        throw new ApiError(409, 'Tác vụ đã thay đổi. Vui lòng tải lại.');
      }
      const recorded = await listOrderedMilestoneTypesTx(tx, ownedTrip.tripId);
      const next = nextDriverFulfillmentMilestone(recorded);
      if (next == null || eventType !== next) {
        throw new ApiError(409, buildDriverFulfillmentSequenceError(recorded, eventType));
      }
      if (
        config.driverOpsPaperOrderGateEnabled
        && eventType === DriverProgressEventType.ORDER_RECEIVED
        && (!ownedTrip.paperOrderCollectedAt || !ownedTrip.paperOrderCollectedBy)
      ) {
        throw new ApiError(409, 'Ops chưa xác nhận giao lệnh gốc cho chuyến này.');
      }
      await assertKetHopSequencingAllowedTx(tx, ownedTrip.tripId);
      const event = await recordMilestoneEventTx(tx, ownedTrip, args.driverId, eventType, args.input.occurredAt, args.recordedBy, { note: args.input.note });
      if (eventType === DriverProgressEventType.ORDER_RECEIVED && ownedTrip.tripStatus === TripStatus.CREATED) {
        await transitionTripStatus(
          ownedTrip.tripId,
          TripStatus.IN_TRANSIT,
          args.recordedBy,
          Role.DRIVER,
          false,
          false,
          {
            expectedVersion: ownedTrip.tripVersion,
            transaction: tx,
            // Ownership was verified and locked above. Receiving the assigned
            // order is the driver's explicit start action for this fulfillment.
            driverOwnedFulfillmentStart: {
              driverId: args.driverId,
              fulfillmentId: args.fulfillmentId,
            },
          },
        );
        const { recomputeShipmentCompletion } = await import('./shipment.service.js');
        await recomputeShipmentCompletion(ownedTrip.shipmentId, { changedBy: args.recordedBy }, tx);
      }
      return event;
    },
    load: async (id, tx) => loadDriverProgressEventTx(tx, id),
  });
  return { event: result, replayed };
}

function customerPublicationForDriverEvent(eventType: DriverProgressEventType, occurredAt: Date, inferredFromCompletion = false): { title: string; message: string } | null {
  // This is a deliberately closed allowlist. It must never interpolate notes,
  // evidence references, expense details, incident text, or internal IDs.
  const occurred = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(occurredAt);
  if (inferredFromCompletion) {
    const titles: Partial<Record<DriverProgressEventType, string>> = {
      [DriverProgressEventType.PICKED_UP]: 'Nhận hàng — suy ra từ hoàn thành chuyến',
      [DriverProgressEventType.LOADING_OR_RETURNING]: 'Thực hiện chặng — suy ra từ hoàn thành chuyến',
      [DriverProgressEventType.DELIVERED]: 'Giao hàng — suy ra từ hoàn thành chuyến',
    };
    const title = titles[eventType];
    return title ? { title, message: `Mốc được suy ra từ việc tài xế hoàn thành chuyến lúc ${occurred}. Đây là thời điểm ghi nhận, không phải thời điểm quan sát thực tế.${eventType === DriverProgressEventType.DELIVERED ? ' Đây chưa phải xác nhận chấp nhận giao hàng cuối cùng.' : ''}` } : null;
  }
  if (eventType === DriverProgressEventType.PICKED_UP) return { title: 'Đã nhận hàng để vận chuyển', message: `Tài xế đã báo nhận hàng lúc ${occurred}.` };
  if (eventType === DriverProgressEventType.LOADING_OR_RETURNING) return { title: 'Đang thực hiện chặng vận chuyển', message: `Tài xế đã báo đang thực hiện chặng vận chuyển lúc ${occurred}.` };
  if (eventType === DriverProgressEventType.DELIVERED) return { title: 'Tài xế báo đã giao hàng', message: `Tài xế đã báo giao hàng lúc ${occurred}. Đây chưa phải xác nhận chấp nhận giao hàng cuối cùng.` };
  return null;
}

export async function syncDriverFulfillmentStartSideEffects(
  args: {
    fulfillmentId: number;
    driverId: number;
    recordedBy: number;
  },
  invalidateReports: () => Promise<void> = () => invalidateReportCaches('tripStart'),
): Promise<void> {
    const [startedTrip] = await db.select({
      id: s.trips.id,
      driverId: s.trips.driverId,
      departureDate: s.trips.departureDate,
      status: s.trips.status,
    }).from(s.trips)
      .where(and(
        eq(s.trips.fulfillmentId, args.fulfillmentId),
        eq(s.trips.driverId, args.driverId),
        isNull(s.trips.deletedAt),
      ))
      .limit(1);
    if (!startedTrip || startedTrip.status !== TripStatus.IN_TRANSIT) return;
    await syncAttendanceAfterStatusChange(
      startedTrip.id,
      TripStatus.IN_TRANSIT,
      startedTrip.driverId,
      startedTrip.departureDate,
      null,
      args.recordedBy,
    );
    await invalidateReports();
}

export async function listDriverFulfillmentProgress(
  fulfillmentId: number,
  driverId: number,
): Promise<DriverProgressEvent[]> {
  const ownedTrip = await loadOwnedFulfillmentTrip(db, fulfillmentId, driverId, { includeCanceled: true });
  const rows = await db.select().from(s.driverProgressEvents)
    .where(and(
      eq(s.driverProgressEvents.tripId, ownedTrip.tripId),
      inArray(s.driverProgressEvents.eventType, [...DRIVER_FULFILLMENT_PROGRESS_SEQUENCE]),
    ))
    .orderBy(asc(s.driverProgressEvents.occurredAt), asc(s.driverProgressEvents.id));
  return rows as DriverProgressEvent[];
}

// ─── M8.4 slice 3: driver incidental costs ───────────────────────────────────
//
// Native driver claims feed accounting reconciliation. Explicit manual retries
// use the same command key; completed trips accept documentary additions until
// the shipment accounting lock is applied.

export interface DriverIncidentalCost {
  id: number;
  tripId: number;
  driverId: number;
  costType: DriverIncidentalCostType;
  amount: string;
  occurredAt: string;
  note: string | null;
  receiptStorageKey: string | null;
  recordedBy: number | null;
  createdAt: Date;
}

async function assertTripAcceptsIncidentalCostTx(tx: Tx, tripId: number): Promise<void> {
  await assertTripShipmentAccountingUnlocked(tx, tripId);
  const [trip] = await tx.select({ status: s.trips.status })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  // O2C: costs stay editable after COMPLETED (no hard-freeze). Only CANCELED
  // trips reject new incidental costs. A cost on a completed trip flips
  // ar_snapshot_dirty via the caller.
  if (trip?.status === 'CANCELED') {
    throw new ApiError(409, 'Không thể thêm chi phí cho chuyến đã hủy');
  }
}

async function insertDriverIncidentalCostTx(
  tx: Tx,
  tripId: number,
  driverId: number,
  input: DriverIncidentalCostInput & { expenseTypeCode?: string | null; feeNormCode?: string | null },
  recordedBy: number,
): Promise<DriverIncidentalCost> {
  const group = input.costGroup ?? (['TOLL', 'PARKING', 'PER_DIEM'].includes(input.costType) ? 'DRIVER_ROAD' : 'DRIVER_SHIPMENT');
  if (!['DRIVER_SHIPMENT', 'DRIVER_ROAD'].includes(group)) throw new ApiError(400, 'Nhóm chi phí lái xe không hợp lệ.');
  const customerChargeAmount = group === 'DRIVER_SHIPMENT' && input.invoiceNumber?.trim() ? input.amount : 0;
  // Classification source is exclusive: a fee norm (road bucket) and a lot-cost
  // catalog ref can never both drive one entry.
  if (input.feeNormCode && input.expenseTypeCode) {
    throw new ApiError(400, 'Chỉ chọn một nguồn phân loại: định mức hoặc loại phí trong danh mục.');
  }
  // Card 20260921_6: when the entry carries a catalog ref, invoiced-vs-no-invoice
  // is DATA (requiresInvoice) — invoiced types must carry an invoice number and
  // charge the customer; no-invoice types never charge, whatever the driver
  // typed. Entries without a catalog ref keep the heuristic above unchanged
  // (legacy enum-only entries and the offline app queue).
  const [catalogType] = input.expenseTypeCode
    ? await tx.select({ name: s.forwarderExpenseTypes.name, requiresInvoice: s.forwarderExpenseTypes.requiresInvoice })
        .from(s.forwarderExpenseTypes)
        .where(and(
          eq(s.forwarderExpenseTypes.code, input.expenseTypeCode),
          eq(s.forwarderExpenseTypes.status, 'ACTIVE'),
          isNull(s.forwarderExpenseTypes.deletedAt),
        ))
        .limit(1)
    : [];
  if (input.expenseTypeCode && !catalogType) {
    throw new ApiError(400, `Loại phí "${input.expenseTypeCode}" không tồn tại hoặc đã ngừng hiệu lực — chọn lại loại phí trong danh sách.`);
  }
  const invoicedClass = catalogType?.requiresInvoice === true;
  if (invoicedClass && !input.invoiceNumber?.trim()) {
    throw new ApiError(400, 'Phí có hóa đơn phải kèm số hóa đơn.');
  }
  // Card 20260921_7: a fee norm (định mức) pins the entry to the road bucket —
  // the norm's costType/costGroup apply, the entry never charges the customer
  // (AC1), and the amount stays the driver-reported actual (the norm amount is
  // the FE pre-fill default, overridable per AC3). Mutually exclusive with the
  // lot-cost catalog ref by contract.
  const [feeNorm] = input.feeNormCode
    ? await tx.select().from(s.driverFeeNorms)
        .where(and(
          eq(s.driverFeeNorms.code, input.feeNormCode),
          eq(s.driverFeeNorms.status, 'ACTIVE'),
        ))
        .limit(1)
    : [];
  if (input.feeNormCode && !feeNorm) {
    throw new ApiError(400, `Định mức "${input.feeNormCode}" không tồn tại hoặc đã ngừng hiệu lực.`);
  }
  const normClass = feeNorm != null;
  if (input.receiptStorageKey) {
    const [photo] = await tx.select({ id: s.tripPhotos.id }).from(s.tripPhotos).where(and(
      eq(s.tripPhotos.storageKey, input.receiptStorageKey), eq(s.tripPhotos.tripId, tripId), eq(s.tripPhotos.uploadedBy, recordedBy)));
    if (!photo) throw new ApiError(400, 'Ảnh biên lai phải do bạn tải lên cho chuyến này.');
  }
  const [row] = await tx.insert(s.driverIncidentalCosts).values({
    tripId,
    driverId,
    costType: normClass ? (feeNorm!.costType as DriverIncidentalCostType) : input.costType,
    expenseTypeCode: normClass ? null : (input.expenseTypeCode ?? null),
    feeNormCode: input.feeNormCode ?? null,
    amount: String(input.amount),
    occurredAt: input.occurredAt,
    note: input.note ?? null,
    receiptStorageKey: input.receiptStorageKey ?? null,
    recordedBy,
    payerKind: input.payerKind ?? 'USER',
    costGroup: normClass ? (feeNorm!.costGroup as ExpenseCostGroup) : group,
    feeName: normClass ? feeNorm!.label : (catalogType ? catalogType.name : (input.feeName ?? input.costType)),
    customerChargeAmount: String(normClass ? 0 : (invoicedClass ? input.amount : (catalogType ? 0 : customerChargeAmount))),
    invoiceNumber: normClass ? null : (invoicedClass ? input.invoiceNumber!.trim() : catalogType ? null : (input.invoiceNumber?.trim() || null)),
    invoiceDate: normClass ? null : (catalogType && !invoicedClass ? null : (input.invoiceDate || null)),
    photoStorageKeys: input.receiptStorageKey ? [input.receiptStorageKey] : [],
  }).returning();
  const [trip] = await tx.select({ shipmentId: s.trips.shipmentId, customerId: s.trips.customerId, truckId: s.trips.truckId }).from(s.trips).where(eq(s.trips.id, tripId));
  // Standalone trips retain their native claim. Accounting linkage starts only
  // when the real shipment exists; never manufacture a shipment for a fee.
  if (!trip?.shipmentId) {
    await tx.insert(s.auditLogs).values({ userId: recordedBy, message: 'DRIVER_INCIDENTAL_COST_RECORDED',
      entityType: 'driver_incidental_cost', entityId: row.id, payload: { paymentHistoryKnown: true, tripId } });
    return row as DriverIncidentalCost;
  }
  const source = await upsertExpenseAccountingSource(tx, { sourceKind: 'DRIVER', sourceId: row.id, shipmentId: trip.shipmentId,
    tripId, truckId: trip.truckId, customerId: trip.customerId, expenseTypeCode: row.expenseTypeCode ?? input.costType, costGroup: row.costGroup,
    feeName: row.feeName ?? input.costType, amount: Number(row.amount),
    customerChargeAmount: Number(row.customerChargeAmount),
    expenseDate: input.occurredAt, invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate,
    payerKind: input.payerKind ?? 'USER', payerUserId: input.payerKind === 'COMPANY' ? null : recordedBy, payableEntityType: input.payerKind === 'COMPANY' ? null : 'DRIVER', payableEntityId: input.payerKind === 'COMPANY' ? null : driverId,
    recordedById: recordedBy, note: input.note, photoStorageKeys: input.receiptStorageKey ? [input.receiptStorageKey] : [] });
  const [saved] = await tx.select().from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, row.id));
  return { ...saved, version: source.version } as DriverIncidentalCost;
}

async function loadDriverIncidentalCostTx(tx: Tx, id: number): Promise<DriverIncidentalCost> {
  const [row] = await tx.select().from(s.driverIncidentalCosts)
    .where(eq(s.driverIncidentalCosts.id, id)).limit(1);
  if (!row) throw new ApiError(404, 'Chi phí không tồn tại');
  return row as DriverIncidentalCost;
}

/** Card 20260921_7: ACTIVE fee norms for the driver cost-form auto-fill. */
export async function listActiveDriverFeeNorms() {
  return db.select({ code: s.driverFeeNorms.code, label: s.driverFeeNorms.label, amount: s.driverFeeNorms.amount })
    .from(s.driverFeeNorms)
    .where(eq(s.driverFeeNorms.status, 'ACTIVE'))
    .orderBy(asc(s.driverFeeNorms.code));
}

/**
 * Record a driver incidental cost. Server-side idempotent: same key + same
 * body → 201 first / 200 replay (no duplicate); same key + different body →
 * 409 (Q23). Canceled and accounting-locked trips reject new costs.
 */
export async function recordIncidentalCost(
  tripId: number,
  driverId: number,
  input: DriverIncidentalCostInput & { expenseTypeCode?: string | null; feeNormCode?: string | null },
  recordedBy: number,
  idempotencyKey: string | undefined,
): Promise<{ cost: DriverIncidentalCost; replayed: boolean }> {
  // Ownership check (reuses the progress-event helper).
  await assertTripOwnedByDriver(tripId, driverId);

  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_INCIDENTAL_COST,
    idempotencyKey,
    payload: { tripId, driverId, ...input },
    createdBy: recordedBy,
    entityType: 'driver_incidental_cost',
    create: async (tx) => {
      await lockTripFinancialAuthority(tx, [tripId]);
      await assertTripAcceptsIncidentalCostTx(tx, tripId);
      const [assigned] = await tx.select({ driverId: s.trips.driverId }).from(s.trips).where(eq(s.trips.id, tripId)).for('update');
      if (assigned?.driverId !== driverId) throw new ApiError(409, 'Công việc vừa thay đổi lái xe. Vui lòng tải lại.');
      return insertDriverIncidentalCostTx(tx, tripId, driverId, input, recordedBy);
    },
    load: async (id, tx) => loadDriverIncidentalCostTx(tx, id),
  });
  return { cost: result, replayed };
}

/** List a trip's incidental costs, newest-first. */
export async function listIncidentalCosts(tripId: number, driverId: number): Promise<DriverIncidentalCost[]> {
  await assertTripOwnedByDriver(tripId, driverId);
  const rows = await db.select().from(s.driverIncidentalCosts)
    .where(eq(s.driverIncidentalCosts.tripId, tripId))
    .orderBy(desc(s.driverIncidentalCosts.createdAt));
  const enriched = rows.length ? await db.select().from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), inArray(s.expenseAccountingSources.sourceId, rows.map(row => row.id)))) : [];
  return rows.filter(row => enriched.find(item => item.sourceId === row.id)?.status !== 'VOIDED').map(row => {
    const source = enriched.find(item => item.sourceId === row.id);
    return { ...row, version: source?.version ?? 1, costGroup: row.costGroup, feeName: row.feeName,
      invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate };
  }) as DriverIncidentalCost[];
}

export interface DriverFulfillmentCompletionResult {
  tripId: number;
  fulfillmentId: number;
  status: typeof s.trips.$inferSelect.status;
  version: number;
  completedAt: string | null;
  evidenceStatus: DriverCompletionEvidenceStatus;
}

async function buildDriverFulfillmentCompletionResultTx(
  tx: Tx,
  tripId: number,
  driverId: number,
): Promise<DriverFulfillmentCompletionResult> {
  const [trip] = await tx.select({
    id: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    status: s.trips.status,
    version: s.trips.version,
    completedAt: s.trips.completedAt,
  }).from(s.trips)
    .where(and(
      eq(s.trips.id, tripId),
      eq(s.trips.driverId, driverId),
      isNull(s.trips.deletedAt),
    ))
    .limit(1);
  if (!trip || trip.fulfillmentId == null) {
    throw new ApiError(404, 'Không tìm thấy tác vụ được giao.');
  }
  const evidenceStatus = await getDriverCompletionEvidenceStatus(trip.id, tx);
  return {
    tripId: trip.id,
    fulfillmentId: trip.fulfillmentId,
    status: trip.status,
    version: trip.version,
    completedAt: trip.completedAt?.toISOString() ?? null,
    evidenceStatus,
  };
}

export async function completeOwnedFulfillmentTrip(args: {
  fulfillmentId: number;
  driverId: number;
  actorUserId: number;
  expectedVersion: number;
  idempotencyKey: string | undefined;
  /** Post-commit report-cache bust; injectable for tests. Defaults to the full trip-write group. */
  invalidateReports?: () => Promise<void>;
}): Promise<{ trip: DriverFulfillmentCompletionResult; replayed: boolean }> {
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_FULFILLMENT_COMPLETE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      fulfillmentId: args.fulfillmentId,
      driverId: args.driverId,
      actorUserId: args.actorUserId,
      expectedVersion: args.expectedVersion,
    },
    createdBy: args.actorUserId,
    entityType: 'trip',
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.select({ id: s.shipments.id })
        .from(s.shipmentFulfillments)
        .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
        .where(eq(s.shipmentFulfillments.id, args.fulfillmentId))
        .for('update');
      const ownedTrip = await loadOwnedFulfillmentTrip(tx, args.fulfillmentId, args.driverId, { forUpdate: true, canceledConflict: 'Chuyến đi đã hủy — không thể thực hiện thao tác này.' });
      await assertTripShipmentAccountingUnlocked(tx, ownedTrip.tripId);
      if (ownedTrip.tripVersion !== args.expectedVersion) {
        throw new ApiError(409, 'Tác vụ đã thay đổi. Vui lòng tải lại.');
      }
      // Spec (Man_hình Phần 3 Bước 2 + 27.8 A5 "BỐN MỐC THỰC HIỆN: BỎ"): the
      // driver UI no longer has intermediate milestone controls — "Hoàn thành
      // chuyến" is the single trip-progress action left. Completing the trip
      // means the cargo reached the drop point, so any missing post-accept
      // milestones are recorded here, in order, on the driver's behalf.
      // ORDER_RECEIVED is never auto-recorded: accepting the order stays an
      // explicit driver action (sticky bar), and a never-accepted trip fails
      // the evidence check below with a clear message.
      let autoRecorded = await listOrderedMilestoneTypesTx(tx, ownedTrip.tripId);
      let nextMilestone = nextDriverFulfillmentMilestone(autoRecorded);
      while (nextMilestone != null && nextMilestone !== DriverProgressEventType.ORDER_RECEIVED) {
        await recordMilestoneEventTx(
          tx,
          ownedTrip,
          args.driverId,
          nextMilestone,
          new Date().toISOString(),
          args.actorUserId,
          { inferredFromCompletion: true, note: 'Suy ra từ hoàn thành chuyến; thời điểm ghi nhận, không phải thời điểm quan sát thực tế.' },
        );
        autoRecorded = [...autoRecorded, nextMilestone];
        nextMilestone = nextDriverFulfillmentMilestone(autoRecorded);
      }
      const evidenceStatus = await getDriverCompletionEvidenceStatus(ownedTrip.tripId, tx);
      if (!evidenceStatus.ready) {
        throw new ApiError(409, `Chưa thể hoàn thành chuyến. Còn thiếu: ${evidenceStatus.missing.join(', ')}.`);
      }
      // Driver full-close: e-POD already proves delivery. Skip accountant
      // gates per user instruction ("skip kế toán for now").
      await transitionTripStatus(
        ownedTrip.tripId,
        TripStatus.COMPLETED,
        args.actorUserId,
        Role.DRIVER,
        true,
        true,
        {
          expectedVersion: ownedTrip.tripVersion,
          transaction: tx,
          driverOwnedFulfillmentClose: {
            driverId: args.driverId,
            fulfillmentId: args.fulfillmentId,
          },
        },
      );
      const { recomputeShipmentCompletion } = await import('./shipment.service.js');
      await recomputeShipmentCompletion(ownedTrip.shipmentId, { changedBy: args.actorUserId }, tx);

      // Sync attendance for completed trip within the same transaction so the
      // work-day records are atomically consistent with the trip status.
      const [tripForAttendance] = await tx.select({
        departureDate: s.trips.departureDate,
        completedAt: s.trips.completedAt,
      }).from(s.trips).where(eq(s.trips.id, ownedTrip.tripId)).limit(1);

      if (tripForAttendance && args.driverId) {
        const completionDate = toBusinessDateString(tripForAttendance.completedAt);
        await syncTripWorkDays(
          args.driverId,
          ownedTrip.tripId,
          tripForAttendance.departureDate,
          completionDate,
          args.actorUserId,
          tx,
        );
      }

      return buildDriverFulfillmentCompletionResultTx(tx, ownedTrip.tripId, args.driverId);
    },
    load: async (entityId, tx) => buildDriverFulfillmentCompletionResultTx(tx, entityId, args.driverId),
    getEntityId: (value) => value.tripId,
  });

  // Post-commit on BOTH the create and the replay path: the close posts
  // revenue/AP/AR/profitability, so every trip-write report cache must bust.
  await (args.invalidateReports ?? (() => invalidateReportCaches()))();
  return { trip: result, replayed };
}

// Advisory evidence-readiness before completion (M8.4 slice 4).
export type CompletionEvidenceStatus = DriverCompletionEvidenceStatus;
export async function getCompletionEvidenceStatus(tripId: number): Promise<CompletionEvidenceStatus> {
  return getDriverCompletionEvidenceStatus(tripId);
}
