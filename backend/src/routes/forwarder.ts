import { Router } from 'express';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import multer from 'multer';
import {
  getForwarderTrips,
  getForwarderTripCounts,
  getForwarderTripDetail,
  assertForwarderTripScope,
  assertForwarderMutableTripScope,
  assertForwarderMutableShipmentScope,
  createTripExpense,
  deleteTripExpenseInTx,
  listUnlinkedTripExpenses,
  getExpensePhotos,
  getForwarderOwnedExpenseId,
  listActiveSuppliersForForwarder,
  getTripExpenseAuditInfo,
  updateForwarderTripExpenseInTx,
  setTripExpenseCompletion,
} from '../services/forwarder.service';
import { createTripContainerInClient } from '../services/forwarder-container.service';
import { exportSettlementXlsx, exportSettlementHtml, previewSettlementHtml, previewSettlementXlsx } from '../services/settlement-export.service';
import { formatLocalDate } from '../lib/format';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveForwarder } from '../middleware/forwarder';
import { throwValidation } from '../lib/validation';
import { db } from '../db';
import * as s from '../db/schema';
import { tripContainerSchema, tripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema } from '@tingting/shared';
import { createAdvanceRequest, listAdvanceRequests, getAdvanceRequestCounts, createAdvanceSettlement, listAdvanceSettlements, getAdvanceSettlement, getOutstandingAdvanceBalance } from '../services/advance.service';
import { createAdvanceRequestSchema, createAdvanceSettlementSchema } from '@tingting/shared';
import { buildNoInvoicePolicySnapshot } from '../services/no-invoice-disbursement.service';
import { storageService } from '../services/storage.service';
import sharp from 'sharp';
import { sniffImageType } from '../lib/format';
import { getRequestIdempotencyKey } from './utils/idempotency';
import {
  findIdempotencyRecord,
  runIdempotent,
  waitForIdempotencyRecord,
} from '../services/idempotency.service';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { Tx } from '../services/trip-shared';
import { ApiError } from '../errors';
import {
  runWithAuditRequestContext,
} from '../services/audit.service';
import {
  armStorageCleanupGuard,
  cancelStorageCleanupGuard,
  enqueueStorageDelete,
  releaseStorageCleanupGuard,
  STORAGE_DELETE_MODE,
  type StorageCleanupGuardLease,
} from '../services/durable-effect.service';
import { resolveLiftPrice } from '../services/pricing.service';
import {
  assertShipmentAccountingUnlocked,
  assertTripShipmentAccountingUnlocked,
} from '../services/shipment-accounting-lock.service';
import { z } from 'zod';

const expensePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// Unify with upload.ts / expense.ts (2048). Was 1600 — inconsistent downscale ceiling.
const MAX_IMAGE_DIMENSION = 2048;

const router = Router();

function withMaterialWriteAuditContext<T>(
  req: Request,
  res: Response,
  endpoint: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithAuditRequestContext({
    req,
    res,
    fullPath: (req.originalUrl || req.url || '').split('?')[0],
    isLoginPath: false,
    declaredMaterialWriteEndpoint: endpoint,
  }, fn);
}

export const FORWARDER_IDEMPOTENCY_ENDPOINTS = {
  CONTAINER_CREATE: 'forwarder.containers.create',
  EXPENSE_CREATE: 'forwarder.expenses.create',
  EXPENSE_UPDATE: 'forwarder.expenses.update',
  EXPENSE_DELETE: 'forwarder.expenses.delete',
  EXPENSE_COMPLETION: 'forwarder.expense-completion.update',
  EXPENSE_PHOTO_CREATE: 'forwarder.expense-photos.create',
  EXPENSE_PHOTO_DELETE: 'forwarder.expense-photos.delete',
  PAPER_ORDER_COLLECTION: 'forwarder.paper-order.collection',
  ORDER_EXCHANGE_START: 'forwarder.order-exchange.start',
  ORDER_EXCHANGE_COMPLETE: 'forwarder.order-exchange.complete',
} as const;

let expensePhotoAfterUploadHookForTest: null | (() => void | Promise<void>) = null;

export function setForwarderExpensePhotoAfterUploadHookForTest(
  hook: null | (() => void | Promise<void>),
) {
  expensePhotoAfterUploadHookForTest = hook;
}

function requireForwarderIdempotencyKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác giao nhận này.');
  }
  return key;
}

function readExpectedUpdatedAt(req: Request): Date | undefined {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return undefined;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const expected = readExpectedUpdatedAt(req);
  if (!expected) throw new ApiError(428, message);
  return expected;
}

type ForwarderExpensePhotoDeleteCommand = {
  success: true;
  storageKeys: string[];
};

function hashStorageKey(storageKey: string): string {
  return createHash('sha256').update(storageKey).digest('hex').slice(0, 32);
}

async function acquireForwarderCleanupGuard(args: {
  endpoint: string;
  idempotencyKey: string;
  dedupeKey: string;
  storageKey: string;
  entityId: number;
}): Promise<StorageCleanupGuardLease | null> {
  const existingIdempotency = await findIdempotencyRecord(args.endpoint, args.idempotencyKey);
  if (existingIdempotency) return null;
  try {
    return await armStorageCleanupGuard({
      dedupeKey: args.dedupeKey,
      storageKey: args.storageKey,
      entityType: 'trip_expense_photos',
      entityId: args.entityId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('storage cleanup guard already leased')) {
      const committed = await waitForIdempotencyRecord(args.endpoint, args.idempotencyKey);
      if (committed) return null;
      throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
    }
    throw error;
  }
}

async function releaseForwarderCleanupGuard(
  lease: StorageCleanupGuardLease | null,
  error: unknown,
  context: string,
): Promise<void> {
  if (!lease) return;
  try {
    await releaseStorageCleanupGuard(lease, error);
  } catch (releaseError) {
    console.warn(
      `[${context}] failed to release durable cleanup guard ${lease.dedupeKey}:`,
      releaseError instanceof Error ? releaseError.message : releaseError,
    );
  }
}

async function deleteForwarderExpensePhotoCommand(
  client: Tx,
  photoId: number,
  forwarderId: number,
  expectedUpdatedAt: Date | undefined,
): Promise<ForwarderExpensePhotoDeleteCommand | null> {
  await client.execute(sql`SELECT pg_advisory_xact_lock(6111, ${photoId})`);
  const [photo] = await client.select({
      id: s.tripExpensePhotos.id,
      tripExpenseId: s.tripExpensePhotos.tripExpenseId,
      storageKey: s.tripExpensePhotos.storageKey,
      uploadedAt: s.tripExpensePhotos.uploadedAt,
      ownerForwarderId: s.tripExpenses.forwarderId,
    })
      .from(s.tripExpensePhotos)
      .innerJoin(s.tripExpenses, eq(s.tripExpensePhotos.tripExpenseId, s.tripExpenses.id))
      .where(eq(s.tripExpensePhotos.id, photoId))
      .limit(1)
      .for('update');
  if (!photo || photo.ownerForwarderId !== forwarderId) return null;
  const [expense] = await client.select({ tripId: s.tripExpenses.tripId })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, photo.tripExpenseId))
    .limit(1);
  if (!expense) return null;
  await assertForwarderMutableTripScope(expense.tripId, forwarderId, client);
  if (expectedUpdatedAt && photo.uploadedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new ApiError(409, 'Ảnh hóa đơn đã thay đổi. Vui lòng tải lại chi phí trước khi xóa.');
  }
  await enqueueStorageDelete(client, {
    dedupeKey: `forwarder-expense-photo-final:${photo.id}:${hashStorageKey(photo.storageKey)}`,
    payload: {
      storageKey: photo.storageKey,
      mode: STORAGE_DELETE_MODE.FINAL_DELETE,
      entityType: 'trip_expense_photos',
      entityId: photo.id,
    },
  });
  await client.delete(s.tripExpensePhotos).where(eq(s.tripExpensePhotos.id, photoId));
  return {
    success: true,
    storageKeys: [photo.storageKey],
  };
}

export const forwarderTripContainerSchema = tripContainerSchema.refine(
  (container) => Boolean(container.containerNumber?.trim()),
  {
    path: ['containerNumber'],
    message: 'Số container không được để trống',
  },
);

const paperOrderCollectionSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

const orderExchangeSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// Resolve forwarder profile once for all routes — handlers access req.forwarder
router.use(resolveForwarder);

router.get('/trips', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const status = req.query.status as string | undefined;
  // N4: optional filters — search (container number OR customer name),
  // dateFrom/dateTo (filter on trip.departure_date). Mirrors the param-reading
  // pattern in routes/trips.ts summary handler (accepts camelCase and snake_case).
  const search = (req.query.search as string | undefined) || undefined;
  const dateFrom = (req.query.dateFrom || req.query.date_from) as string | undefined;
  const dateTo = (req.query.dateTo || req.query.date_to) as string | undefined;
  const [items, counts] = await Promise.all([
    getForwarderTrips(forwarder.id, status, { search, dateFrom, dateTo }),
    getForwarderTripCounts(forwarder.id),
  ]);
  res.json({ items, counts });
}));

router.get('/trips/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const trip = await getForwarderTripDetail(parseInt(req.params.id as string, 10), forwarder.id);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  res.json(trip);
}));

async function updateOrderExchange(
  req: Request,
  res: Response,
  action: 'start' | 'complete',
) {
  const forwarder = req.forwarder!;
  const shipmentId = parseInt(req.params.shipmentId as string, 10);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    throw new ApiError(400, 'ID lô hàng không hợp lệ.');
  }
  const parsed = orderExchangeSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwValidation(parsed.error);
  const endpoint = action === 'start'
    ? FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_START
    : FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_COMPLETE;
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await withMaterialWriteAuditContext(req, res, endpoint, () => runIdempotent({
    endpoint,
    idempotencyKey,
    payload: { shipmentId, forwarderId: forwarder.id, expectedVersion: parsed.data.expectedVersion },
    createdBy: forwarder.id,
    entityType: 'shipment',
    responseStatusCode: 200,
    create: async (tx) => {
      await assertForwarderMutableShipmentScope(shipmentId, forwarder.id, tx);
      await assertShipmentAccountingUnlocked(tx, shipmentId);
      const [shipment] = await tx.select({
        id: s.shipments.id,
        version: s.shipments.version,
        orderExchangeStartedAt: s.shipments.orderExchangeStartedAt,
        orderExchangeStartedBy: s.shipments.orderExchangeStartedBy,
        orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
        orderExchangeCompletedBy: s.shipments.orderExchangeCompletedBy,
      }).from(s.shipments)
        .where(eq(s.shipments.id, shipmentId))
        .limit(1)
        .for('update');
      if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng.');
      const alreadyDone = action === 'start'
        ? shipment.orderExchangeStartedAt != null
        : shipment.orderExchangeCompletedAt != null;
      if (alreadyDone) return shipment;
      if (shipment.version !== parsed.data.expectedVersion) {
        throw new ApiError(409, 'Lô hàng đã thay đổi. Vui lòng tải lại.');
      }
      if (action === 'complete' && !shipment.orderExchangeStartedAt) {
        throw new ApiError(409, 'Cần bắt đầu đổi lệnh trước khi xác nhận hoàn tất.');
      }
      const now = new Date();
      const [updated] = await tx.update(s.shipments)
        .set(action === 'start' ? {
          orderExchangeStartedAt: now,
          orderExchangeStartedBy: forwarder.id,
          version: sql`${s.shipments.version} + 1`,
          updatedAt: now,
          updatedBy: forwarder.id,
        } : {
          orderExchangeCompletedAt: now,
          orderExchangeCompletedBy: forwarder.id,
          version: sql`${s.shipments.version} + 1`,
          updatedAt: now,
          updatedBy: forwarder.id,
        })
        .where(eq(s.shipments.id, shipmentId))
        .returning({
          id: s.shipments.id,
          version: s.shipments.version,
          orderExchangeStartedAt: s.shipments.orderExchangeStartedAt,
          orderExchangeStartedBy: s.shipments.orderExchangeStartedBy,
          orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
          orderExchangeCompletedBy: s.shipments.orderExchangeCompletedBy,
        });
      return updated;
    },
  }));
  res.json(outcome.result);
}

router.post('/shipments/:shipmentId/order-exchange/start', asyncHandler(
  async (req: Request, res: Response) => updateOrderExchange(req, res, 'start'),
));

router.post('/shipments/:shipmentId/order-exchange/complete', asyncHandler(
  async (req: Request, res: Response) => updateOrderExchange(req, res, 'complete'),
));

router.post('/trips/:tripId/paper-order-collection', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    throw new ApiError(400, 'ID chuyến đi không hợp lệ.');
  }
  const parsed = paperOrderCollectionSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    FORWARDER_IDEMPOTENCY_ENDPOINTS.PAPER_ORDER_COLLECTION,
    () => runIdempotent({
      endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.PAPER_ORDER_COLLECTION,
      idempotencyKey,
      payload: {
        tripId,
        forwarderId: forwarder.id,
        expectedVersion: parsed.data.expectedVersion ?? null,
      },
      createdBy: forwarder.id,
      entityType: 'trip',
      responseStatusCode: 200,
      create: async (tx) => {
        await assertForwarderMutableTripScope(tripId, forwarder.id, tx);
        await assertTripShipmentAccountingUnlocked(tx, tripId);
        const [trip] = await tx.select({
          id: s.trips.id,
          version: s.trips.version,
          truckId: s.trips.truckId,
          shipmentId: s.trips.shipmentId,
          orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
          paperOrderCollectedAt: s.trips.paperOrderCollectedAt,
          paperOrderCollectedBy: s.trips.paperOrderCollectedBy,
        }).from(s.trips)
          .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
          .where(eq(s.trips.id, tripId))
          .limit(1)
          .for('update');
        if (!trip) {
          throw new ApiError(404, 'Không tìm thấy chuyến đi.');
        }
        if (parsed.data.expectedVersion != null && trip.version !== parsed.data.expectedVersion) {
          throw new ApiError(409, 'Chuyến đi đã thay đổi. Vui lòng tải lại.');
        }
        if (!trip.truckId) {
          throw new ApiError(409, 'Chưa thể bàn giao lệnh gốc khi điều vận chưa phân xe.');
        }
        if (!trip.orderExchangeCompletedAt) {
          throw new ApiError(409, 'Chưa thể bàn giao lệnh gốc khi Ops chưa hoàn tất đổi lệnh.');
        }
        if (trip.paperOrderCollectedAt || trip.paperOrderCollectedBy) {
          throw new ApiError(409, 'Lệnh gốc đã được giao nhận xác nhận trước đó.');
        }
        const [updated] = await tx.update(s.trips)
          .set({
            paperOrderCollectedAt: new Date(),
            paperOrderCollectedBy: forwarder.id,
            version: sql`${s.trips.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(s.trips.id, tripId))
          .returning({
            tripId: s.trips.id,
            version: s.trips.version,
            paperOrderCollectedAt: s.trips.paperOrderCollectedAt,
            paperOrderCollectedBy: s.trips.paperOrderCollectedBy,
          });
        return updated;
      },
    }),
  );
  res.json(outcome.result);
}));

router.post('/trips/:tripId/containers', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = forwarderTripContainerSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.CONTAINER_CREATE,
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    responseStatusCode: 201,
    create: async (tx) => {
      await assertForwarderMutableTripScope(tripId, forwarder.id, tx);
      return createTripContainerInClient(tx, {
        ...parsed.data,
        tripId,
        containerTypeId: parsed.data.containerTypeId ?? null,
        sealNumber: parsed.data.sealNumber ?? null,
        notes: parsed.data.notes ?? null,
        createdBy: forwarder.id,
      });
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.get('/suppliers', asyncHandler(async (_req: Request, res: Response) => {
  const items = await listActiveSuppliersForForwarder();
  res.json({ items });
}));

const resolveLiftPriceQuerySchema = z.object({
  portId: z.coerce.number().int().positive(),
  containerTypeId: z.coerce.number().int().positive(),
  direction: z.enum(['LIFT_UP', 'LIFT_DOWN']),
  loadState: z.enum(['LOADED', 'EMPTY']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Ngày áp dụng không hợp lệ'),
});

type LiftExpenseType = 'LIFTING' | 'LOWERING';
type LiftPricingSnapshot = NonNullable<typeof s.tripExpenses.$inferSelect.liftPricingSnapshot>;

function isLiftExpenseType(expenseType: string): expenseType is LiftExpenseType {
  return expenseType === 'LIFTING' || expenseType === 'LOWERING';
}

function isValidIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function resolveLiftPricingForWrite(
  tx: Tx,
  input: {
    tripId: number;
    tripContainerId: number | null | undefined;
    expenseType: LiftExpenseType;
    expenseDate: string | null | undefined;
    portId: number | undefined;
    containerTypeId: number | undefined;
    loadState: 'LOADED' | 'EMPTY' | undefined;
    requestedBuyAmount: number;
  },
): Promise<{ liftPricingId: number; snapshot: LiftPricingSnapshot }> {
  if (input.tripContainerId == null) {
    throw new ApiError(400, 'Chi phí nâng/hạ phải gắn với container của chuyến');
  }
  if (!input.expenseDate || input.portId == null || input.loadState == null) {
    throw new ApiError(400, 'Cần chọn ngày chi, cảng và trạng thái hàng/rỗng cho chi phí nâng/hạ');
  }
  if (!isValidIsoDate(input.expenseDate)) {
    throw new ApiError(400, 'Ngày chi không hợp lệ');
  }

  await tx.execute(sql`SELECT pg_advisory_xact_lock(6103, ${input.tripContainerId})`);
  const [container] = await tx.select({
    tripId: s.tripContainers.tripId,
    containerTypeId: s.tripContainers.containerTypeId,
  }).from(s.tripContainers)
    .where(eq(s.tripContainers.id, input.tripContainerId))
    .limit(1)
    .for('share');
  if (!container || container.tripId !== input.tripId) {
    throw new ApiError(400, 'Container không thuộc chuyến này');
  }
  if (container.containerTypeId == null) {
    throw new ApiError(409, 'Container chưa có loại để xác định biểu phí nâng/hạ');
  }
  if (input.containerTypeId != null && input.containerTypeId !== container.containerTypeId) {
    throw new ApiError(422, 'Loại container không khớp dữ liệu chuyến hiện tại');
  }

  const direction = input.expenseType === 'LIFTING' ? 'LIFT_UP' : 'LIFT_DOWN';
  const [pricing] = await tx.select({
    id: s.liftPricing.id,
    unitPrice: s.liftPricing.unitPrice,
    effectiveDate: s.liftPricing.effectiveDate,
  }).from(s.liftPricing)
    .where(and(
      eq(s.liftPricing.portId, input.portId),
      eq(s.liftPricing.containerTypeId, container.containerTypeId),
      eq(s.liftPricing.direction, direction),
      eq(s.liftPricing.loadState, input.loadState),
      lte(s.liftPricing.effectiveDate, input.expenseDate),
      isNull(s.liftPricing.deletedAt),
    ))
    .orderBy(desc(s.liftPricing.effectiveDate), desc(s.liftPricing.id))
    .limit(1)
    .for('share');
  if (!pricing) {
    throw new ApiError(409, 'Chưa có biểu phí nâng/hạ phù hợp với container và ngày chi');
  }

  const unitPrice = Number(pricing.unitPrice);
  if (input.requestedBuyAmount !== unitPrice) {
    throw new ApiError(422, 'Số tiền nâng/hạ không khớp biểu phí hiện hành');
  }
  return {
    liftPricingId: pricing.id,
    snapshot: {
      portId: input.portId,
      containerTypeId: container.containerTypeId,
      direction,
      loadState: input.loadState,
      expenseDate: input.expenseDate,
      effectiveDate: pricing.effectiveDate,
      unitPrice,
    },
  };
}

router.get('/lift-pricing/resolve', asyncHandler(async (req: Request, res: Response) => {
  const parsed = resolveLiftPriceQuerySchema.safeParse(req.query);
  if (!parsed.success) throwValidation(parsed.error);
  const resolved = await resolveLiftPrice(parsed.data);
  res.json(resolved
    ? { ...resolved, source: 'MATRIX' as const }
    : { suggestedPrice: 0, liftPricingId: null, effectiveDate: null, source: 'MANUAL' as const });
}));

router.post('/expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = tripExpenseSchema.safeParse({ ...req.body, forwarderId: forwarder.id });
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_CREATE,
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    responseStatusCode: 201,
    create: async (tx) => {
      await assertForwarderMutableTripScope(parsed.data.tripId, forwarder.id, tx);
      const liftPricing = isLiftExpenseType(parsed.data.expenseType)
        ? await resolveLiftPricingForWrite(tx, {
            tripId: parsed.data.tripId,
            tripContainerId: parsed.data.tripContainerId,
            expenseType: parsed.data.expenseType,
            expenseDate: parsed.data.expenseDate,
            portId: parsed.data.portId,
            containerTypeId: parsed.data.containerTypeId,
            loadState: parsed.data.loadState,
            requestedBuyAmount: parsed.data.buyAmount,
          })
        : null;
      return createTripExpense(tx, {
        tripId: parsed.data.tripId,
        forwarderId: forwarder.id,
        createdBy: forwarder.id,
        expenseType: parsed.data.expenseType,
        buyAmount: String(liftPricing?.snapshot.unitPrice ?? parsed.data.buyAmount),
        sellAmount: String(parsed.data.sellAmount ?? 0),
        settlementMethod: parsed.data.settlementMethod,
        supplierId: parsed.data.supplierId ?? null,
        expenseDate: parsed.data.expenseDate ?? null,
        payeeName: parsed.data.payeeName?.trim() || null,
        invoiceNumber: parsed.data.invoiceNumber ?? null,
        invoiceDate: parsed.data.invoiceDate ?? null,
        declarationNumber: parsed.data.declarationNumber ?? null,
        containerNumber: parsed.data.containerNumber ?? null,
        tripContainerId: parsed.data.tripContainerId ?? null,
        liftPricingId: liftPricing?.liftPricingId ?? null,
        liftPricingSnapshot: liftPricing?.snapshot ?? null,
        note: parsed.data.note ?? null,
        noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [],
      });
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.patch('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản chi phí mới nhất trước khi cập nhật.',
  );
  const patch: Parameters<typeof updateForwarderTripExpenseInTx>[3] = {
    expenseType: parsed.data.expenseType,
    buyAmount: parsed.data.buyAmount !== undefined ? String(parsed.data.buyAmount) : undefined,
    sellAmount: parsed.data.sellAmount !== undefined ? String(parsed.data.sellAmount) : undefined,
    settlementMethod: parsed.data.settlementMethod,
    ...(parsed.data.supplierId !== undefined ? { supplierId: parsed.data.supplierId ?? null } : {}),
    ...(parsed.data.expenseDate !== undefined ? { expenseDate: parsed.data.expenseDate ?? null } : {}),
    ...(parsed.data.payeeName !== undefined ? { payeeName: parsed.data.payeeName?.trim() || null } : {}),
    ...(parsed.data.invoiceNumber !== undefined ? { invoiceNumber: parsed.data.invoiceNumber ?? null } : {}),
    ...(parsed.data.invoiceDate !== undefined ? { invoiceDate: parsed.data.invoiceDate ?? null } : {}),
    ...(parsed.data.declarationNumber !== undefined ? { declarationNumber: parsed.data.declarationNumber ?? null } : {}),
    ...(parsed.data.containerNumber !== undefined ? { containerNumber: parsed.data.containerNumber ?? null } : {}),
    ...(parsed.data.tripContainerId !== undefined ? { tripContainerId: parsed.data.tripContainerId ?? null } : {}),
    ...(parsed.data.note !== undefined ? { note: parsed.data.note ?? null } : {}),
    ...(parsed.data.noInvoiceEvidenceTypes !== undefined ? { noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [] } : {}),
  };
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_UPDATE,
    idempotencyKey,
    payload: {
      expenseId,
      forwarderId: forwarder.id,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      ...patch,
      portId: parsed.data.portId,
      containerTypeId: parsed.data.containerTypeId,
      loadState: parsed.data.loadState,
    },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
      const [existing] = await tx.select({
        tripId: s.tripExpenses.tripId,
        expenseType: s.tripExpenses.expenseType,
        buyAmount: s.tripExpenses.buyAmount,
        expenseDate: s.tripExpenses.expenseDate,
        tripContainerId: s.tripExpenses.tripContainerId,
        liftPricingId: s.tripExpenses.liftPricingId,
        liftPricingSnapshot: s.tripExpenses.liftPricingSnapshot,
      }).from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).limit(1);
      if (!existing) throw new ApiError(404, 'Không tìm thấy chi phí');

      const nextExpenseType = parsed.data.expenseType ?? existing.expenseType;
      const pricingInputsChanged = [
        parsed.data.expenseType,
        parsed.data.buyAmount,
        parsed.data.expenseDate,
        parsed.data.tripContainerId,
        parsed.data.portId,
        parsed.data.containerTypeId,
        parsed.data.loadState,
      ].some((value) => value !== undefined);
      if (isLiftExpenseType(nextExpenseType) && (pricingInputsChanged || existing.liftPricingId == null)) {
        const prior = existing.liftPricingSnapshot;
        const liftPricing = await resolveLiftPricingForWrite(tx, {
          tripId: existing.tripId,
          tripContainerId: parsed.data.tripContainerId === undefined
            ? existing.tripContainerId
            : parsed.data.tripContainerId,
          expenseType: nextExpenseType,
          expenseDate: parsed.data.expenseDate === undefined
            ? existing.expenseDate
            : parsed.data.expenseDate,
          portId: parsed.data.portId ?? prior?.portId,
          containerTypeId: parsed.data.containerTypeId ?? prior?.containerTypeId,
          loadState: parsed.data.loadState ?? prior?.loadState,
          requestedBuyAmount: parsed.data.buyAmount ?? Number(existing.buyAmount),
        });
        patch.buyAmount = String(liftPricing.snapshot.unitPrice);
        patch.liftPricingId = liftPricing.liftPricingId;
        patch.liftPricingSnapshot = liftPricing.snapshot;
      } else if (!isLiftExpenseType(nextExpenseType) && isLiftExpenseType(existing.expenseType)) {
        patch.liftPricingId = null;
        patch.liftPricingSnapshot = null;
      }
      return updateForwarderTripExpenseInTx(
        tx,
        expenseId,
        forwarder.id,
        patch,
        expectedUpdatedAt,
      );
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.put('/trips/:tripId/expense-completion', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = tripExpenseCompletionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_COMPLETION,
    idempotencyKey,
    payload: { forwarderId: forwarder.id, tripId, ...parsed.data },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await assertForwarderMutableTripScope(tripId, forwarder.id, tx);
      return setTripExpenseCompletion(
        tripId,
        parsed.data.tripContainerId,
        parsed.data.completed,
        forwarder.id,
        tx,
      );
    },
  });
  res.json(outcome.result);
}));

router.delete('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản chi phí mới nhất trước khi xóa.',
  );
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_DELETE,
    idempotencyKey,
    payload: {
      expenseId,
      forwarderId: forwarder.id,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
      const expense = await getTripExpenseAuditInfo(expenseId, tx);
      const result = await deleteTripExpenseInTx(tx, expenseId, forwarder.id, expectedUpdatedAt);
      if (result === null) throw new ApiError(404, 'Không tìm thấy chi phí');
      if (result === 'FORBIDDEN') throw new ApiError(403, 'Không có quyền xóa chi phí này');
      const auditEntityKey = expense
        ? `phí ${expense.typeName || 'hộ'} với số tiền chi ${Number(expense.buyAmount).toLocaleString('vi-VN')} ₫${expense.tripCode ? ` cho chuyến ${expense.tripCode}` : ''}${expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : ''}`
        : null;
      return { success: true as const, auditEntityKey };
    },
  });
  if (outcome.result.auditEntityKey) {
    res.locals.auditEntityKey = outcome.result.auditEntityKey;
  }
  res.status(outcome.statusCode).json({ success: true });
}));

// ── Unlinked Trip Expenses (for settlement form) ──

router.get('/unlinked-expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const items = await listUnlinkedTripExpenses(forwarder.id);
  res.json({ items });
}));

// ── Advance Requests ──

router.get('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const status = req.query.status as string | undefined;
  const excludeLinkedToActiveSettlement = req.query.eligibleForSettlement === 'true';
  const [items, counts] = await Promise.all([
    listAdvanceRequests({ requesterId: forwarder.id, status, excludeLinkedToActiveSettlement }),
    getAdvanceRequestCounts(forwarder.id),
  ]);
  res.json({ items, counts });
}));

router.post('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceRequestSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: 'forwarder.advance-requests.create',
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    entityType: 'advance_request',
    responseStatusCode: 201,
    create: (tx) => createAdvanceRequest(forwarder.id, parsed.data, tx),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

// ── Advance Balance (F1) ──

router.get('/advance-balance', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const outstanding = await getOutstandingAdvanceBalance(forwarder.id);
  res.json({ outstanding: String(outstanding) });
}));

// ── Advance Settlements ──

router.get('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const items = await listAdvanceSettlements({ forwarderId: forwarder.id });
  res.json({ items });
}));

router.get('/advance-settlements/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const settlement = await getAdvanceSettlement(Number(req.params.id));
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  if (settlement.forwarderId !== forwarder.id) return res.status(403).json({ error: 'Không có quyền truy cập' });
  res.json(settlement);
}));

router.get('/advance-settlements/:id/export', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const id = Number(req.params.id);
  const settlement = await getAdvanceSettlement(id);
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  if (settlement.forwarderId !== forwarder.id) return res.status(403).json({ error: 'Không có quyền truy cập' });

  const format = (req.query.format as string) || 'xlsx';
  if (format === 'pdf' || format === 'html') {
    const html = await exportSettlementHtml(id);
    if (!html) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  const dateStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-${id}-${dateStr}.xlsx`);
  await exportSettlementXlsx(id, res);
}));

router.post('/advance-settlements/preview', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const { advanceRequestIds, tripExpenseIds, refundAmount, note } = parsed.data;

  const format = (req.query.format as string) || 'html';
  const input = { forwarderId: forwarder.id, advanceRequestIds, tripExpenseIds, refundAmount, note: note ?? undefined };

  if (format === 'xlsx') {
    const dateStr = formatLocalDate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-xem-truoc-${dateStr}.xlsx`);
    await previewSettlementXlsx(input, res);
    return;
  }

  const html = await previewSettlementHtml(input);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

router.post('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const { note, ...rest } = parsed.data;
  const input = { ...rest, note: note ?? undefined };
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: 'forwarder.advance-settlements.create',
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...input },
    createdBy: forwarder.id,
    entityType: 'advance_settlement',
    responseStatusCode: 201,
    create: (tx) => createAdvanceSettlement(forwarder.id, input, tx),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

// ── Expense Photos ──

router.get('/expenses/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  // N1: gate on expense ownership before listing — unowned → 404 (not 403),
  // so a forwarder cannot enumerate another forwarder's photo metadata.
  const ownedExpenseId = await getForwarderOwnedExpenseId(expenseId, forwarder.id);
  if (!ownedExpenseId) {
    return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  }
  const [ownedExpense] = await db.select({ tripId: s.tripExpenses.tripId })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);
  if (!ownedExpense) return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  await assertForwarderTripScope(ownedExpense.tripId, forwarder.id);
  const photos = await getExpensePhotos(expenseId);
  res.json({ items: photos });
}));

router.post('/expenses/:id/photos', expensePhotoUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Không có file tải lên' });

  const expenseId = parseInt(req.params.id as string, 10);

  // N1: ownership precheck BEFORE any processing — unowned → 404 (not 403),
  // so a forwarder cannot attach photos to another forwarder's trip_expense.
  const ownedExpenseId = await getForwarderOwnedExpenseId(expenseId, forwarder.id);
  if (!ownedExpenseId) {
    return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  }

  // Validate image type
  const mime = sniffImageType(file.buffer);
  if (!mime) return res.status(400).json({ error: 'Định dạng file không được hỗ trợ' });

  // Process: strip EXIF, downscale. Wrapped in try/catch (parity with
  // expense.ts) so a corrupt/unsupported codec yields a clean 400, not a 500.
  let processedBuffer: Buffer;
  let ext: string;
  try {
    if (mime === 'image/png') {
      processedBuffer = await sharp(file.buffer).rotate().resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      ext = '.png';
    } else {
      processedBuffer = await sharp(file.buffer).rotate().resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      ext = '.jpg';
    }
  } catch (err) {
    console.warn('[forwarder] expense-photo processing failed:', err instanceof Error ? err.message : err);
    return res.status(400).json({ error: 'Xử lý ảnh thất bại' });
  }
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const fileHash = createHash('sha256').update(processedBuffer).digest('hex');
  const storageKey = `expense-photos/${expenseId}/${createHash('sha256')
    .update(`forwarder-expense-photo:${forwarder.id}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32)}${ext}`;
  const cleanupGuard = await acquireForwarderCleanupGuard({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
    idempotencyKey,
    dedupeKey: `forwarder-expense-photo-orphan:${forwarder.id}:${hashStorageKey(storageKey)}:${idempotencyKey}`,
    storageKey,
    entityId: expenseId,
  });
  if (cleanupGuard) {
    try {
      await storageService.upload(processedBuffer, storageKey);
    } catch (error) {
      await releaseForwarderCleanupGuard(cleanupGuard, error, 'forwarder.expense-photo.create');
      throw error;
    }
  }
  try {
    const outcome = await withMaterialWriteAuditContext(
      req,
      res,
      FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
      () => runIdempotent({
        endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE,
        idempotencyKey,
        payload: { expenseId, forwarderId: forwarder.id, fileHash },
        createdBy: forwarder.id,
        responseStatusCode: 201,
        create: async (tx) => {
          if (!cleanupGuard) {
            throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
          }
          const [expense] = await tx.select({ id: s.tripExpenses.id })
            .from(s.tripExpenses)
            .where(and(eq(s.tripExpenses.id, expenseId), eq(s.tripExpenses.forwarderId, forwarder.id)))
            .limit(1);
          if (!expense) {
            throw new ApiError(404, 'Không tìm thấy chi phí');
          }
          const [ownedExpense] = await tx.select({ tripId: s.tripExpenses.tripId })
            .from(s.tripExpenses)
            .where(eq(s.tripExpenses.id, expenseId))
            .limit(1);
          if (!ownedExpense) throw new ApiError(404, 'Không tìm thấy chi phí');
          await assertForwarderMutableTripScope(ownedExpense.tripId, forwarder.id, tx);
          const cancelled = await cancelStorageCleanupGuard(tx, cleanupGuard);
          if (!cancelled) {
            throw new ApiError(409, 'Ảnh chứng từ đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
          }
          if (expensePhotoAfterUploadHookForTest) {
            await expensePhotoAfterUploadHookForTest();
          }
          const [photo] = await tx.insert(s.tripExpensePhotos).values({
            tripExpenseId: expense.id,
            storageKey,
            uploadedBy: forwarder.id,
          }).returning();
          return photo;
        },
      }),
    );
    res.status(outcome.statusCode).json(outcome.result);
  } catch (error) {
    await releaseForwarderCleanupGuard(cleanupGuard, error, 'forwarder.expense-photo.create');
    throw error;
  }
}));

router.delete('/expense-photos/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const photoId = parseInt(req.params.id as string, 10);
  const idempotencyKey = requireForwarderIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản ảnh mới nhất trước khi xóa.',
  );
  const outcome = await runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_DELETE,
    idempotencyKey,
    payload: {
      photoId,
      forwarderId: forwarder.id,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    },
    createdBy: forwarder.id,
    responseStatusCode: 200,
    create: async (tx) => {
      const result = await deleteForwarderExpensePhotoCommand(tx, photoId, forwarder.id, expectedUpdatedAt);
      if (!result) {
        throw new ApiError(404, 'Không tìm thấy ảnh');
      }
      return result;
    },
  });
  res.json({ success: true });
}));

// ── Expense type labels (for forwarder catalog) ──

router.get('/expense-types', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select({
    code: s.forwarderExpenseTypes.code,
    name: s.forwarderExpenseTypes.name,
    requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: s.forwarderExpenseTypes.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: s.forwarderExpenseTypes.noInvoicePerItemLimit,
    noInvoicePerDayLimit: s.forwarderExpenseTypes.noInvoicePerDayLimit,
    noInvoiceFinanceLeadItemApprovalLimit: s.forwarderExpenseTypes.noInvoiceFinanceLeadItemApprovalLimit,
    noInvoiceDirectorDayApprovalLimit: s.forwarderExpenseTypes.noInvoiceDirectorDayApprovalLimit,
    noInvoiceFinanceLeadApprovalTitle: s.forwarderExpenseTypes.noInvoiceFinanceLeadApprovalTitle,
    noInvoiceDirectorApprovalTitle: s.forwarderExpenseTypes.noInvoiceDirectorApprovalTitle,
    noInvoicePolicyVersion: s.forwarderExpenseTypes.noInvoicePolicyVersion,
  }).from(s.forwarderExpenseTypes)
    .orderBy(s.forwarderExpenseTypes.name);
  res.json(rows.map((row) => ({
    code: row.code,
    name: row.name,
    noInvoicePolicySnapshot: row.requiresInvoice
      ? null
      : buildNoInvoicePolicySnapshot({
        code: row.code,
        name: row.name,
        requiresInvoice: row.requiresInvoice,
        substituteEvidenceAllowed: row.substituteEvidenceAllowed,
        noInvoiceEvidenceTypes: row.noInvoiceEvidenceTypes,
        noInvoicePerItemLimit: String(row.noInvoicePerItemLimit),
        noInvoicePerDayLimit: String(row.noInvoicePerDayLimit),
        noInvoiceFinanceLeadItemApprovalLimit: String(row.noInvoiceFinanceLeadItemApprovalLimit),
        noInvoiceDirectorDayApprovalLimit: String(row.noInvoiceDirectorDayApprovalLimit),
        noInvoiceFinanceLeadApprovalTitle: row.noInvoiceFinanceLeadApprovalTitle,
        noInvoiceDirectorApprovalTitle: row.noInvoiceDirectorApprovalTitle,
        noInvoicePolicyVersion: row.noInvoicePolicyVersion,
      }),
  })));
}));

export default router;
