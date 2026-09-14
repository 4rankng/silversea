/**
 * Shared helpers for the forwarder route leaves. Split verbatim from the old
 * single-file routes/forwarder.ts: material-write audit context, idempotency
 * key requirement, optimistic-concurrency helpers, and forwarder
 * schemas/constants. The domain command surface (idempotency endpoints,
 * lift-expense pricing, expense-photo guards + locked delete) moved to
 * services/forwarder-expense-commands.service.ts (2026-09-01) and is
 * re-exported here so route leaves keep a single import site.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validatedTripContainerSchema } from '@tingting/shared';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { runWithAuditRequestContext } from '../../services/audit.service';
import { ApiError } from '../../errors';

// Domain command surface owned by the service leaf — re-exported for the
// route leaves' convenience. Services must never import this module.
export {
  FORWARDER_IDEMPOTENCY_ENDPOINTS,
  acquireForwarderCleanupGuard,
  deleteForwarderExpensePhotoCommand,
  hashStorageKey,
  isLiftExpenseType,
  releaseForwarderCleanupGuard,
  resolveLiftPricingForWrite,
  type LiftExpenseType,
  type LiftPricingSnapshot,
} from '../../services/forwarder-expense-commands.service';

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

// The add-to-trip path enforces the shared ISO 6346 validator (format + check
// digit) at the persistence boundary — previously it accepted any non-empty
// string ('ABC' persisted and became a cost group); the batch path's check
// is FE-advisory only, so this is now the stronger of the two. The chain
// lives in @tingting/shared so the driver add path validates identically.
export const forwarderTripContainerSchema = validatedTripContainerSchema;

export const paperOrderCollectionSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
});

export const orderExchangeSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
