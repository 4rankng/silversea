/**
 * Forwarder expense write commands + the lift-pricing and expense-photo
 * domain logic they share. Split from routes/forwarder/forwarder-shared.ts and
 * the expenses leaf (2026-09-01): the route layer held pricing resolution with
 * advisory locks, a locked photo-delete command, and idempotent envelopes with
 * inline queries. forwarder-shared re-exports the domain names so existing
 * route imports keep working — this module is their owner.
 */
import { createHash } from 'node:crypto';
import { sql, eq, and, lte, isNull, desc } from 'drizzle-orm';
import { db } from '../db';
import type { z } from 'zod';
import {
  tripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema,
} from '@tingting/shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  findIdempotencyRecord, runIdempotent, waitForIdempotencyRecord,
} from './idempotency.service';
import {
  assertForwarderMutableTripScope,
  createTripExpense, deleteTripExpenseInTx,
  getTripExpenseAuditInfo, setTripExpenseCompletion, updateForwarderTripExpenseInTx,
} from './forwarder.service';
import {
  armStorageCleanupGuard, enqueueStorageDelete, releaseStorageCleanupGuard,
  STORAGE_DELETE_MODE, type StorageCleanupGuardLease,
} from './durable-effect.service';

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

// ─── Lift-expense pricing (moved verbatim from forwarder-shared) ──────────────

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

// ─── Expense-photo storage guards + locked delete (moved verbatim) ────────────

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
      releaseError instanceof Error ? releaseError.message : String(releaseError),
    );
  }
}

type ForwarderExpensePhotoDeleteCommand = {
  success: true;
  storageKeys: string[];
};

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

// ─── Expense write commands (envelopes moved from routes/forwarder/expenses.ts) ──

export type ForwarderExpenseCreateData = z.infer<typeof tripExpenseSchema>;
export type ForwarderExpensePatchData = z.infer<typeof tripExpensePatchSchema>;
export type ForwarderExpenseCompletionData = z.infer<typeof tripExpenseCompletionSchema>;

export async function createForwarderExpenseCommand(args: {
  forwarderId: number;
  data: ForwarderExpenseCreateData;
  idempotencyKey: string;
}) {
  return runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_CREATE,
    idempotencyKey: args.idempotencyKey,
    payload: { forwarderId: args.forwarderId, ...args.data },
    createdBy: args.forwarderId,
    responseStatusCode: 201,
    create: async (tx) => {
      await assertForwarderMutableTripScope(args.data.tripId, args.forwarderId, tx);
      const liftPricing = isLiftExpenseType(args.data.expenseType)
        ? await resolveLiftPricingForWrite(tx, {
            tripId: args.data.tripId,
            tripContainerId: args.data.tripContainerId,
            expenseType: args.data.expenseType,
            expenseDate: args.data.expenseDate,
            portId: args.data.portId,
            containerTypeId: args.data.containerTypeId,
            loadState: args.data.loadState,
            requestedBuyAmount: args.data.buyAmount,
          })
        : null;
      return createTripExpense(tx, {
        tripId: args.data.tripId,
        forwarderId: args.forwarderId,
        createdBy: args.forwarderId,
        expenseType: args.data.expenseType,
        buyAmount: String(liftPricing?.snapshot.unitPrice ?? args.data.buyAmount),
        sellAmount: String(args.data.sellAmount ?? 0),
        settlementMethod: args.data.settlementMethod,
        supplierId: args.data.supplierId ?? null,
        expenseDate: args.data.expenseDate ?? null,
        payeeName: args.data.payeeName?.trim() || null,
        invoiceNumber: args.data.invoiceNumber ?? null,
        invoiceDate: args.data.invoiceDate ?? null,
        declarationNumber: args.data.declarationNumber ?? null,
        containerNumber: args.data.containerNumber ?? null,
        tripContainerId: args.data.tripContainerId ?? null,
        liftPricingId: liftPricing?.liftPricingId ?? null,
        liftPricingSnapshot: liftPricing?.snapshot ?? null,
        note: args.data.note ?? null,
        noInvoiceEvidenceTypes: args.data.noInvoiceEvidenceTypes ?? [],
      });
    },
  });
}

export async function updateForwarderExpenseCommand(args: {
  forwarderId: number;
  expenseId: number;
  data: ForwarderExpensePatchData;
  expectedUpdatedAt: Date;
  idempotencyKey: string;
}) {
  const { data, expenseId, forwarderId, expectedUpdatedAt } = args;
  const patch: Parameters<typeof updateForwarderTripExpenseInTx>[3] = {
    expenseType: data.expenseType,
    buyAmount: data.buyAmount !== undefined ? String(data.buyAmount) : undefined,
    sellAmount: data.sellAmount !== undefined ? String(data.sellAmount) : undefined,
    settlementMethod: data.settlementMethod,
    ...(data.supplierId !== undefined ? { supplierId: data.supplierId ?? null } : {}),
    ...(data.expenseDate !== undefined ? { expenseDate: data.expenseDate ?? null } : {}),
    ...(data.payeeName !== undefined ? { payeeName: data.payeeName?.trim() || null } : {}),
    ...(data.invoiceNumber !== undefined ? { invoiceNumber: data.invoiceNumber ?? null } : {}),
    ...(data.invoiceDate !== undefined ? { invoiceDate: data.invoiceDate ?? null } : {}),
    ...(data.declarationNumber !== undefined ? { declarationNumber: data.declarationNumber ?? null } : {}),
    ...(data.containerNumber !== undefined ? { containerNumber: data.containerNumber ?? null } : {}),
    ...(data.tripContainerId !== undefined ? { tripContainerId: data.tripContainerId ?? null } : {}),
    ...(data.note !== undefined ? { note: data.note ?? null } : {}),
    ...(data.noInvoiceEvidenceTypes !== undefined ? { noInvoiceEvidenceTypes: data.noInvoiceEvidenceTypes ?? [] } : {}),
  };
  return runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_UPDATE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      expenseId,
      forwarderId,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      ...patch,
      portId: data.portId,
      containerTypeId: data.containerTypeId,
      loadState: data.loadState,
    },
    createdBy: forwarderId,
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

      const nextExpenseType = data.expenseType ?? existing.expenseType;
      const pricingInputsChanged = [
        data.expenseType,
        data.buyAmount,
        data.expenseDate,
        data.tripContainerId,
        data.portId,
        data.containerTypeId,
        data.loadState,
      ].some((value) => value !== undefined);
      if (isLiftExpenseType(nextExpenseType) && (pricingInputsChanged || existing.liftPricingId == null)) {
        const prior = existing.liftPricingSnapshot;
        const liftPricing = await resolveLiftPricingForWrite(tx, {
          tripId: existing.tripId,
          tripContainerId: data.tripContainerId === undefined
            ? existing.tripContainerId
            : data.tripContainerId,
          expenseType: nextExpenseType,
          expenseDate: data.expenseDate === undefined
            ? existing.expenseDate
            : data.expenseDate,
          portId: data.portId ?? prior?.portId,
          containerTypeId: data.containerTypeId ?? prior?.containerTypeId,
          loadState: data.loadState ?? prior?.loadState,
          requestedBuyAmount: data.buyAmount ?? Number(existing.buyAmount),
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
        forwarderId,
        patch,
        expectedUpdatedAt,
      );
    },
  });
}

export async function setForwarderExpenseCompletionCommand(args: {
  forwarderId: number;
  tripId: number;
  data: ForwarderExpenseCompletionData;
  idempotencyKey: string;
}) {
  return runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_COMPLETION,
    idempotencyKey: args.idempotencyKey,
    payload: { forwarderId: args.forwarderId, tripId: args.tripId, ...args.data },
    createdBy: args.forwarderId,
    responseStatusCode: 200,
    create: async (tx) => {
      await assertForwarderMutableTripScope(args.tripId, args.forwarderId, tx);
      return setTripExpenseCompletion(
        args.tripId,
        args.data.tripContainerId,
        args.data.completed,
        args.forwarderId,
        tx,
      );
    },
  });
}

export async function deleteForwarderExpenseCommand(args: {
  forwarderId: number;
  expenseId: number;
  expectedUpdatedAt: Date;
  idempotencyKey: string;
}) {
  const { forwarderId, expenseId, expectedUpdatedAt } = args;
  return runIdempotent({
    endpoint: FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_DELETE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      expenseId,
      forwarderId,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    },
    createdBy: forwarderId,
    responseStatusCode: 200,
    create: async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(6102, ${expenseId})`);
      const expense = await getTripExpenseAuditInfo(expenseId, tx);
      const result = await deleteTripExpenseInTx(tx, expenseId, forwarderId, expectedUpdatedAt);
      if (result === null) throw new ApiError(404, 'Không tìm thấy chi phí');
      if (result === 'FORBIDDEN') throw new ApiError(403, 'Không có quyền xóa chi phí này');
      const auditEntityKey = expense
        ? `phí ${expense.typeName || 'hộ'} với số tiền chi ${Number(expense.buyAmount).toLocaleString('vi-VN')} ₫${expense.tripCode ? ` cho chuyến ${expense.tripCode}` : ''}${expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : ''}`
        : null;
      return { success: true as const, auditEntityKey };
    },
  });
}


/** Semantic expenseType gate (catalog-backed categories): the code must be an
 *  ACTIVE, non-deleted forwarder_expense_types row. The seeded legacy codes
 *  (LIFTING/…/OTHER) are catalog rows too, so one check covers both worlds.
 *  Vietnamese field-level message per the card; exact match — no silent
 *  normalization or substitution. */
export async function assertActiveExpenseTypeCode(tx: Tx | typeof db, code: string): Promise<void> {
  const [row] = await tx.select({ id: s.forwarderExpenseTypes.id })
    .from(s.forwarderExpenseTypes)
    .where(and(
      eq(s.forwarderExpenseTypes.code, code),
      eq(s.forwarderExpenseTypes.status, 'ACTIVE'),
      isNull(s.forwarderExpenseTypes.deletedAt),
    ))
    .limit(1);
  if (!row) {
    throw new ApiError(400, `Loại chi phí "${code}" không tồn tại hoặc đã ngừng hiệu lực — chọn lại loại phí trong danh sách.`);
  }
}
