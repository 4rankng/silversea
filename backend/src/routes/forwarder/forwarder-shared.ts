/**
 * Shared helpers for the forwarder route leaves. Split verbatim from the old
 * single-file routes/forwarder.ts: material-write audit context, idempotency
 * key requirement, optimistic-concurrency helpers, storage cleanup guards,
 * the photo-deletion command, forwarder schemas/constants, and the
 * lift-expense pricing helpers shared by containers/expenses.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { sql, eq, and, lte, isNull, desc } from 'drizzle-orm';
import * as s from '../../db/schema';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { findIdempotencyRecord, waitForIdempotencyRecord } from '../../services/idempotency.service';
import { assertForwarderMutableTripScope } from '../../services/forwarder.service';
import { tripContainerSchema } from '@tingting/shared';
import type { Tx } from '../../services/trip-shared';
import { runWithAuditRequestContext } from '../../services/audit.service';
import {
  armStorageCleanupGuard, cancelStorageCleanupGuard, enqueueStorageDelete,
  releaseStorageCleanupGuard, STORAGE_DELETE_MODE, type StorageCleanupGuardLease,
} from '../../services/durable-effect.service';

import { ApiError } from '../../errors';

export function withMaterialWriteAuditContext<T>(
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

export let expensePhotoAfterUploadHookForTest: null | (() => void | Promise<void>) = null;

export function setForwarderExpensePhotoAfterUploadHookForTest(
  hook: null | (() => void | Promise<void>),
) {
  expensePhotoAfterUploadHookForTest = hook;
}

export function requireForwarderIdempotencyKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác giao nhận này.');
  }
  return key;
}

export function readExpectedUpdatedAt(req: Request): Date | undefined {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return undefined;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

export function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const expected = readExpectedUpdatedAt(req);
  if (!expected) throw new ApiError(428, message);
  return expected;
}

type ForwarderExpensePhotoDeleteCommand = {
  success: true;
  storageKeys: string[];
};

export function hashStorageKey(storageKey: string): string {
  return createHash('sha256').update(storageKey).digest('hex').slice(0, 32);
}

export async function acquireForwarderCleanupGuard(args: {
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

export async function releaseForwarderCleanupGuard(
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

export async function deleteForwarderExpensePhotoCommand(
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

export const paperOrderCollectionSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

export const orderExchangeSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

// Resolve forwarder profile once for all routes — handlers access req.forwarder


// Lift-expense pricing helpers used by the containers and expenses leaves.
export type LiftExpenseType = 'LIFTING' | 'LOWERING';
export type LiftPricingSnapshot = NonNullable<typeof s.tripExpenses.$inferSelect.liftPricingSnapshot>;
export function isLiftExpenseType(expenseType: string): expenseType is LiftExpenseType {
  return expenseType === 'LIFTING' || expenseType === 'LOWERING';
}

function isValidIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function resolveLiftPricingForWrite(
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

