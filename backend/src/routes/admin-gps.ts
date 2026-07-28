/**
 * Admin GPS endpoints — seed + repair the real-route database.
 *
 * With Google Directions retired, a trip's map is blank until its real GPS trail
 * is captured. The completion hook captures new trips automatically; these
 * endpoints handle the backlog (backfill) and one-off repairs (recapture).
 * RBAC: gps-admin action (ADMIN + MANAGER only) — applied at mount time.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import { captureTripGpsTrack, deriveRoutesForStoredTrip, type CaptureResult } from '../services/gps/capture.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { hashPayload } from '../services/idempotency.service';
import {
  persistMaterialWriteAttemptAuditInTransaction,
  persistMaterialWriteConflictAuditInTransaction,
  persistMaterialWriteSuccessAuditInTransaction,
} from '../services/audit.service';

const GPS_COMMAND_ENDPOINTS = {
  BACKFILL: 'gps.backfill',
  RECAPTURE: 'gps.recapture',
} as const;

const GPS_COMMAND_LEASE_MS = 2 * 60 * 1000;
const GPS_PUBLIC_FAILURE_MESSAGE = 'Tác vụ GPS thất bại. Vui lòng thử lại hoặc kiểm tra nhật ký máy chủ.';

type GpsCommandSnapshot<T> = {
  commandStatus: 'PENDING' | 'EFFECT_APPLIED' | 'SUCCEEDED' | 'FAILED';
  attempt: number;
  acceptedAt: string;
  leaseExpiresAt?: string;
  finishedAt?: string;
  result?: T;
  error?: string;
};

function buildPendingSnapshot<T>(acceptedAt: Date, attempt: number): GpsCommandSnapshot<T> {
  return {
    commandStatus: 'PENDING',
    attempt,
    acceptedAt: acceptedAt.toISOString(),
    leaseExpiresAt: new Date(acceptedAt.getTime() + GPS_COMMAND_LEASE_MS).toISOString(),
  };
}

export interface AdminGpsDeps {
  captureAndDeriveTripGps: (tripId: number) => Promise<CaptureResult>;
  selectBackfillTripIds: (input: {
    dateFrom?: string;
    dateTo?: string;
    tripIds?: number[];
  }) => Promise<{ tripIds: number[]; truncated: boolean }>;
}

export async function captureAndDeriveTripGps(tripId: number): Promise<CaptureResult> {
  const capture = await captureTripGpsTrack(tripId); // never throws
  if (capture.status !== 'ok') return capture;

  try {
    const derivation = await deriveRoutesForStoredTrip(tripId);
    return {
      ...capture,
      legsDerived: derivation.legsDerived,
      legsTotal: derivation.legsTotal,
      status: derivation.legsDerived > 0 ? 'ok' : 'partial',
    };
  } catch (err: unknown) {
    console.warn('[gps] derive after capture failed', {
      tripId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ...capture,
      status: 'partial',
      errorKind: 'derive_failed',
    };
  }
}

async function selectBackfillTripIds(input: {
  dateFrom?: string;
  dateTo?: string;
  tripIds?: number[];
}): Promise<{ tripIds: number[]; truncated: boolean }> {
  const ids = Array.isArray(input.tripIds)
    ? input.tripIds.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 200)
    : [];

  const conds = [inArray(schema.trips.status, ['COMPLETED', 'LOCKED'])];
  if (ids.length) {
    conds.push(inArray(schema.trips.id, ids));
  } else if (input.dateFrom && input.dateTo) {
    conds.push(gte(schema.trips.departureDate, input.dateFrom));
    conds.push(lte(schema.trips.departureDate, input.dateTo));
  }

  const BACKFILL_CAP = 500;
  const selected = await db.select({ id: schema.trips.id })
    .from(schema.trips)
    .where(and(...conds))
    .orderBy(schema.trips.id)
    .limit(BACKFILL_CAP + 1);
  const truncated = selected.length > BACKFILL_CAP;
  return {
    tripIds: (truncated ? selected.slice(0, BACKFILL_CAP) : selected).map((row) => row.id),
    truncated,
  };
}

const defaultDeps: AdminGpsDeps = {
  captureAndDeriveTripGps,
  selectBackfillTripIds,
};

function requireGpsCommandKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho tác vụ GPS này.');
  }
  return key;
}

async function runDurableGpsCommand<T>(args: {
  endpoint: string;
  idempotencyKey: string;
  payload: unknown;
  createdBy?: number | null;
  execute: () => Promise<T>;
}): Promise<{ statusCode: number; body: T | GpsCommandSnapshot<T> }> {
  const { endpoint, idempotencyKey, payload, createdBy, execute } = args;
  const payloadHash = hashPayload(payload);
  const lockKey = `${endpoint}\u001f${idempotencyKey}`;
  const now = new Date();

  const setup = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [existing] = await tx.select()
      .from(schema.idempotencyKeys)
      .where(and(
        eq(schema.idempotencyKeys.endpoint, endpoint),
        eq(schema.idempotencyKeys.idempotencyKey, idempotencyKey),
      ))
      .limit(1);

    if (existing) {
      const requestedActor = createdBy ?? null;
      const persistedActor = existing.createdBy ?? null;
      if (requestedActor !== persistedActor) {
        const error = new ApiError(
          409,
          'Khóa giao dịch này thuộc về người thực hiện khác — vui lòng dùng mã giao dịch mới.',
          `idempotency_key=${idempotencyKey}`,
        );
        await persistMaterialWriteConflictAuditInTransaction({
          tx,
          responseBody: { error: error.message },
          entityKey: endpoint,
        });
        return { mode: 'conflict' as const, error };
      }
      if (existing.payloadHash !== payloadHash) {
        const error = new ApiError(
          409,
          'Khóa giao dịch trùng nhưng nội dung khác — vui lòng dùng mã giao dịch mới.',
          `idempotency_key=${idempotencyKey}`,
        );
        await persistMaterialWriteConflictAuditInTransaction({
          tx,
          responseBody: { error: error.message },
          entityKey: endpoint,
        });
        return { mode: 'conflict' as const, error };
      }
      const snapshot = (existing.responseSnapshot ?? null) as GpsCommandSnapshot<T> | null;
      if (snapshot?.commandStatus === 'PENDING') {
        return { mode: 'pending' as const, snapshot };
      }
      if (snapshot?.commandStatus === 'SUCCEEDED' && snapshot.result !== undefined) {
        return { mode: 'replay' as const, result: snapshot.result };
      }
      if (snapshot?.commandStatus === 'EFFECT_APPLIED' && snapshot.result !== undefined) {
        return { mode: 'finalize' as const, snapshot };
      }
      if (snapshot?.commandStatus === 'FAILED') {
        return {
          mode: 'failed-replay' as const,
          snapshot,
          statusCode: existing.responseStatusCode ?? 500,
        };
      }
      return { mode: 'pending' as const, snapshot };
    }

    const pendingSnapshot = buildPendingSnapshot<T>(now, 1);
    await tx.insert(schema.idempotencyKeys).values({
      endpoint,
      idempotencyKey,
      entityType: 'GPS_COMMAND',
      entityId: null,
      payloadHash,
      responseStatusCode: 202,
      responseSnapshot: pendingSnapshot,
      createdBy: createdBy ?? null,
    });
    await persistMaterialWriteAttemptAuditInTransaction({
      tx,
      statusCode: 202,
      responseBody: pendingSnapshot,
      entityKey: endpoint,
    });
    return { mode: 'execute' as const, attempt: 1 };
  });

  if (setup.mode === 'pending') {
    return {
      statusCode: 202,
      body: setup.snapshot ?? buildPendingSnapshot<T>(now, 1),
    };
  }
  if (setup.mode === 'replay') {
    return { statusCode: 200, body: setup.result };
  }
  if (setup.mode === 'failed-replay') {
    return { statusCode: setup.statusCode, body: setup.snapshot };
  }
  if (setup.mode === 'conflict') {
    throw setup.error;
  }

  const finalizeEffect = async (snapshot: GpsCommandSnapshot<T>) => {
    await db.transaction(async (tx) => {
      await tx.update(schema.idempotencyKeys)
        .set({
          responseStatusCode: 200,
          responseSnapshot: {
            ...snapshot,
            commandStatus: 'SUCCEEDED',
          },
        })
        .where(and(
          eq(schema.idempotencyKeys.endpoint, endpoint),
          eq(schema.idempotencyKeys.idempotencyKey, idempotencyKey),
        ));
      await persistMaterialWriteSuccessAuditInTransaction({
        tx,
        statusCode: 200,
        responseBody: snapshot.result && typeof snapshot.result === 'object'
          ? snapshot.result as Record<string, unknown>
          : null,
        entityKey: endpoint,
      });
    });
  };

  if (setup.mode === 'finalize') {
    try {
      await finalizeEffect(setup.snapshot);
      return { statusCode: 200, body: setup.snapshot.result! };
    } catch (error) {
      console.error('[gps] command finalization retry failed', {
        endpoint,
        idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { statusCode: 500, body: setup.snapshot };
    }
  }

  try {
    const result = await execute();
    const effectAppliedSnapshot: GpsCommandSnapshot<T> = {
      commandStatus: 'EFFECT_APPLIED',
      attempt: setup.attempt,
      acceptedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      result,
    };
    await db.transaction(async (tx) => {
      await tx.update(schema.idempotencyKeys)
        .set({
          responseStatusCode: 202,
          responseSnapshot: effectAppliedSnapshot,
        })
        .where(and(
          eq(schema.idempotencyKeys.endpoint, endpoint),
          eq(schema.idempotencyKeys.idempotencyKey, idempotencyKey),
        ));
    });
    try {
      await finalizeEffect(effectAppliedSnapshot);
    } catch (error) {
      console.error('[gps] command effect applied but final audit failed', {
        endpoint,
        idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { statusCode: 500, body: effectAppliedSnapshot };
    }
    return { statusCode: 200, body: result };
  } catch (error) {
    console.error('[gps] durable command failed', {
      endpoint,
      idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    });
    const failureSnapshot: GpsCommandSnapshot<T> = {
      commandStatus: 'FAILED',
      attempt: setup.attempt,
      acceptedAt: now.toISOString(),
      finishedAt: new Date().toISOString(),
      error: GPS_PUBLIC_FAILURE_MESSAGE,
    };
    await db.update(schema.idempotencyKeys)
      .set({
        responseStatusCode: 500,
        responseSnapshot: failureSnapshot,
      })
      .where(and(
        eq(schema.idempotencyKeys.endpoint, endpoint),
        eq(schema.idempotencyKeys.idempotencyKey, idempotencyKey),
      ));
    return { statusCode: 500, body: failureSnapshot };
  }
}

export function createAdminGpsRouter(deps: AdminGpsDeps = defaultDeps) {
  const router = Router();

/**
 * POST /api/admin/gps/backfill
 * Derive real GPS routes for historical COMPLETED/LOCKED trips. Iterates
 * SEQUENTIALLY (one provider window per trip — don't hammer Bách Khoa), each
 * trip isolated so one failure can't abort the run.
 *
 * Body: { dateFrom?, dateTo?, tripIds?: number[] }
 *   - tripIds given  → only those trips (any status except CANCELED is attempted)
 *   - else           → all COMPLETED/LOCKED trips with departureDate in [dateFrom, dateTo]
 */
  router.post('/backfill', asyncHandler(async (req: Request, res: Response) => {
    const idempotencyKey = requireGpsCommandKey(req);
    const { dateFrom, dateTo, tripIds } = (req.body ?? {}) as {
      dateFrom?: string;
      dateTo?: string;
      tripIds?: number[];
    };

    const outcome = await runDurableGpsCommand({
      endpoint: GPS_COMMAND_ENDPOINTS.BACKFILL,
      idempotencyKey,
      payload: { dateFrom: dateFrom ?? null, dateTo: dateTo ?? null, tripIds: tripIds ?? [] },
      createdBy: req.user?.userId ?? null,
      execute: async () => {
        const selected = await deps.selectBackfillTripIds({ dateFrom, dateTo, tripIds });
        let ok = 0;
        let partial = 0;
        let failed = 0;
        let empty = 0;
        const failures: Array<{ tripId: number; errorKind?: string }> = [];
        for (const tripId of selected.tripIds) {
          const result = await deps.captureAndDeriveTripGps(tripId);
          if (result.status === 'ok') ok += 1;
          else if (result.status === 'partial') partial += 1;
          else if (result.status === 'empty') empty += 1;
          else {
            failed += 1;
            failures.push({ tripId, errorKind: result.errorKind });
          }
        }
        return {
          total: selected.tripIds.length,
          ok,
          partial,
          empty,
          failed,
          failures,
          truncated: selected.truncated,
        };
      },
    });
    res.status(outcome.statusCode).json(outcome.body);
  }));

/**
 * POST /api/admin/gps/recapture/:tripId
 * Force re-capture + re-derive for one trip — overwrites its trip_gps_tracks row
 * and refreshes route_polylines for its pairs. Escape hatch for a trip whose
 * initial capture failed or whose displayed route looks wrong.
 */
  router.post('/recapture/:tripId', asyncHandler(async (req: Request, res: Response) => {
    const tripId = parseInt(req.params.tripId as string, 10);
    if (!Number.isFinite(tripId)) {
      res.status(400).json({ error: 'tripId không hợp lệ' });
      return;
    }
    const idempotencyKey = requireGpsCommandKey(req);
    const outcome = await runDurableGpsCommand({
      endpoint: GPS_COMMAND_ENDPOINTS.RECAPTURE,
      idempotencyKey,
      payload: { tripId },
      createdBy: req.user?.userId ?? null,
      execute: () => deps.captureAndDeriveTripGps(tripId),
    });
    res.status(outcome.statusCode).json(outcome.body);
  }));

  return router;
}
export default createAdminGpsRouter();
