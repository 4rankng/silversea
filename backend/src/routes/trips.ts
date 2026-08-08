import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { TripStatus, NotificationType, Role, createTripSchema, createTripPairSchema, updateTripFiguresSchema, bulkUpdateTripFiguresSchema, createAdjustmentSchema, tripReopenRequestSchema, tripContainerBatchSchema, tripExpenseSchema, tripExpensePatchSchema, upsertTripInstructionsSchema } from '@tingting/shared';
import * as tripService from '../services/trip.service';
import * as gpsService from '../services/gps.service';
import * as financialService from '../services/financial.service';
import { listTripContainers, batchUpsertTripContainers, createTripExpense, updateTripExpense, getTripExpenses, deleteTripExpenseGuarded, getTripExpenseAuditInfo, latestTripPhotoKey, listTripPhotoKeys } from '../services/forwarder.service';
import { requestTripExpenseDecision } from '../services/approval.service';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { config } from '../config';
import { db } from '../db';
import * as s from '../db/schema';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { registerAuditEvent } from '../services/audit-registry';
import { AuditEvent } from '../services/audit-types';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import { parsePagination } from './utils/pagination';
import { throwValidation } from '../lib/validation';
import { emitNotification } from '../services/notification.service';
import { getFuelVoucherHtml, getFuelVoucherXlsx } from '../services/fuel-voucher.service';
import {
  copyTripWriteCommand,
  createTripWriteCommand,
  dispatchTripWriteCommand,
  transitionTripWriteCommand,
} from '../services/trip-command.service';
import {
  listTripGovernanceActions,
  requestCompletedTripCancellation,
  requestTripFinancialChange,
  requestTripFinancialClose,
  requestTripReopen,
} from '../services/adjustment-governance.service';
import { createTripPair } from '../services/trip-pairs.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';

// Audit event registrations — declared once at module load, matched by middleware
registerAuditEvent('POST', '/api/trips', AuditEvent.TRIP_CREATED);
registerAuditEvent('POST', '/api/trips/', '/copy', AuditEvent.TRIP_CREATED);
registerAuditEvent('PUT', '/api/trips/', '/pre-departure', AuditEvent.TRIP_UPDATED_PRE_DEPARTURE);
registerAuditEvent('PUT', '/api/trips/', '/actuals', AuditEvent.TRIP_UPDATED_ACTUALS);
registerAuditEvent('POST', '/api/trips/bulk-figures', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/trips/', '/dispatch', AuditEvent.TRIP_DISPATCHED);
registerAuditEvent('POST', '/api/trips/', '/complete', AuditEvent.TRIP_COMPLETED);
registerAuditEvent('POST', '/api/trips/', '/cancel', AuditEvent.TRIP_CANCELED);
registerAuditEvent('POST', '/api/trips/', '/adjustment', AuditEvent.ADJUSTMENT_CREATED);
registerAuditEvent('POST', '/api/trips/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/trips/', '/unlock', AuditEvent.ENTITY_CREATED);
registerAuditEvent('PATCH', '/api/trips/', '/departure-date', AuditEvent.TRIP_DEPARTURE_DATE_CHANGED);

const router = Router();

function getExpectedVersion(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>).expectedVersion;
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'Phiên bản chuyến đi không hợp lệ');
  }
  return value as number;
}

function getRequiredGovernanceReason(body: unknown): string {
  const value = body && typeof body === 'object'
    ? (body as Record<string, unknown>).governanceReason
      ?? (body as Record<string, unknown>).reason
    : undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, 'Lý do đề nghị kiểm tra và phê duyệt là bắt buộc');
  }
  return value.trim();
}

const tripExpenseDecisionRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Lý do xử lý chi phí là bắt buộc').max(1000),
  expectedVersion: z.number().int().positive('Phiên bản chi phí không hợp lệ'),
  evidence: z.object({
    reviewNote: z.string().trim().min(1, 'Căn cứ kiểm tra chi phí là bắt buộc').max(1000),
    attachmentRefs: z.array(z.string().trim().min(1).max(255)).max(20).default([]),
  }),
});

async function invalidateReportCaches(invalidatePnl?: boolean) {
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
    cacheInvalidate('reports:dashboard:executive'),
    cacheInvalidatePattern('reports:entity-results:*'),   // trip writes change AR/AP aging
    cacheInvalidatePattern('reports:fuel-variance:*'),    // trip writes change fuel variance
    invalidatePnl ? cacheInvalidatePattern('reports:pnl:*') : Promise.resolve(),
  ]).catch(() => {});
}

// List trips with filters
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const truckIdVal = (req.query.truckId || req.query.truck_id) as string;
  const driverIdVal = (req.query.driverId || req.query.driver_id) as string;
  const customerIdVal = (req.query.customerId || req.query.customer_id) as string;
  const dateFromVal = (req.query.dateFrom || req.query.date_from) as string;
  const dateToVal = (req.query.dateTo || req.query.date_to) as string;
  const searchVal = (req.query.search || req.query.q) as string;

  const { page, limit } = parsePagination(req);
  res.json(await tripService.getTrips({
    page,
    limit,
    status: req.query.status as string,
    truckId: truckIdVal ? parseInt(truckIdVal, 10) : undefined,
    driverId: driverIdVal ? parseInt(driverIdVal, 10) : undefined,
    customerId: customerIdVal ? parseInt(customerIdVal, 10) : undefined,
    dateFrom: dateFromVal,
    dateTo: dateToVal,
    search: searchVal || undefined,
  }));
}));

// Create trip — only ADMIN/MANAGER can create (accountant still has trips:write for figure updates)
router.post('/', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const data = createTripSchema.parse(req.body);
  // Wave 0: SHIPMENT_FIRST_CREATE flag — when ON, shipmentId is mandatory on
  // every trip-create. When OFF (default), it stays optional. The schema
  // itself cannot encode this because it is shared with the frontend, which
  // does not see the server-side flag.
  if (config.shipmentFirstCreate && data.shipmentId == null) {
    return res.status(400).json({ error: 'shipmentId là bắt buộc khi SHIPMENT_FIRST_CREATE đang bật' });
  }
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await createTripWriteCommand(data, getUser(req), idempotencyKey);
  res.locals.auditEntityId = outcome.trip.id;
  res.status(201).json(idempotencyKey
    ? { ...outcome.trip, replayed: outcome.replayed }
    : outcome.trip);
}));

// Copy every editable planning/financial field atomically. Execution evidence,
// expenses, lifecycle state, and container/seal identifiers start clean.
router.post('/:id/copy', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'ID chuyến đi không hợp lệ' });
  }
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await copyTripWriteCommand(tripId, getUser(req), idempotencyKey);
  res.locals.auditEntityId = outcome.trip.id;
  res.status(201).json(idempotencyKey
    ? { ...outcome.trip, replayed: outcome.replayed }
    : outcome.trip);
}));

// Trip summary (status counts + aggregate metrics for a date range)
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  const dateFrom = (req.query.dateFrom || req.query.date_from) as string | undefined;
  const dateTo = (req.query.dateTo || req.query.date_to) as string | undefined;
  res.json(await tripService.getTripsSummary(dateFrom, dateTo));
}));

// Live fleet — current GPS positions of trucks on an active IN_TRANSIT trip,
// pulled from the Bách Khoa provider via a Redis pull-through cache. Declared
// BEFORE /:id so 'live-fleet' is not parsed as an id. Inherits the trips-read
// Casbin policy from the /api/trips mount in index.ts.
router.get('/live-fleet', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await gpsService.getLiveFleet());
}));

router.post('/pairs', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const payload = createTripPairSchema.parse(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: pair, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_PAIR_CREATE,
    idempotencyKey,
    payload: { actorId: user.userId, payload },
    createdBy: user.userId,
    entityType: 'trip_pair',
    create: (tx) => createTripPair(payload, user.userId, tx),
    getEntityId: (result) => result.id,
  });
  if (!replayed) await invalidateReportCaches();
  res.status(201).json(idempotencyKey ? { ...pair, replayed } : pair);
}));

// Get trip detail with legs
// Trip KPI/stats summary — must be declared BEFORE /:id so 'stats' is not parsed as id
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const dateFrom = (req.query.dateFrom || req.query.date_from) as string | undefined;
  const dateTo = (req.query.dateTo || req.query.date_to) as string | undefined;
  const summary = await tripService.getTripsSummary(dateFrom, dateTo);
  res.json({
    totalTrips: summary.statusCounts.all,
    created: summary.statusCounts[TripStatus.CREATED],
    inTransit: summary.statusCounts[TripStatus.IN_TRANSIT],
    completed: summary.statusCounts[TripStatus.COMPLETED],
    canceled: summary.statusCounts[TripStatus.CANCELED],
    totalRevenue: summary.totalRevenue,
    totalKm: summary.totalKm,
    totalFuel: summary.totalFuel,
    avgPer100: summary.avgPer100,
    missingFuel: summary.missingFuel,
  });
}));

router.post('/bulk-figures', asyncHandler(async (req: Request, res: Response) => {
  const payload = bulkUpdateTripFiguresSchema.parse(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_BULK_FIGURES,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, payload },
    createdBy: user.userId,
    entityType: 'trip_bulk_figures',
    create: async (tx) => {
      const results = [];
      for (const update of payload.updates) {
        const parsedFigures = updateTripFiguresSchema.safeParse(update.figures);
        if (!parsedFigures.success) {
          results.push({
            tripId: update.tripId,
            ok: false,
            error: parsedFigures.error.issues[0]?.message ?? 'Dữ liệu dòng không hợp lệ',
          });
          continue;
        }

        try {
          const [current] = await tx.select({
            status: s.trips.status,
            version: s.trips.version,
          }).from(s.trips).where(eq(s.trips.id, update.tripId)).limit(1);
          if (!current) throw new ApiError(404, 'Không tìm thấy chuyến đi');
          if (current.status === TripStatus.COMPLETED) {
            const governanceReason = update.governanceReason?.trim() ?? '';
            if (!governanceReason) {
              throw new ApiError(400, 'Lý do đề nghị thay đổi chuyến đã hoàn thành là bắt buộc');
            }
            const action = await requestTripFinancialChange({
              tripId: update.tripId,
              reason: governanceReason,
              figures: {
                ...parsedFigures.data,
                expectedVersion: parsedFigures.data.version,
                userId: user.userId,
                userRole: user.role,
              },
              makerId: user.userId,
              makerRole: user.role,
              expectedTripVersion: parsedFigures.data.version!,
              transaction: tx,
            });
            results.push({
              tripId: update.tripId,
              ok: true,
              pendingApproval: true,
              governanceAction: action,
            });
            continue;
          }
          const trip = await tripService.updateTripFigures(update.tripId, {
            ...parsedFigures.data,
            expectedVersion: parsedFigures.data.version,
            userId: user.userId,
            userRole: user.role,
          }, tx);
          results.push({ tripId: update.tripId, ok: true, trip });
        } catch (err) {
          results.push({
            tripId: update.tripId,
            ok: false,
            error: err instanceof Error ? err.message : 'Không thể cập nhật chuyến',
          });
        }
      }
      const updated = results.filter((row) => row.ok && !row.pendingApproval).length;
      const pending = results.filter((row) => row.ok && row.pendingApproval).length;
      return { results, updated, pending, failed: results.length - updated - pending };
    },
  });
  if (!replayed) await invalidateReportCaches();
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: 'ID chuyến đi không hợp lệ' });
  res.json(await tripService.getTripById(id));
}));

// Soft-delete trip — only ADMIN/MANAGER, only CREATED status (flow 01 §2.6)
router.delete('/:id', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) return res.status(400).json({ error: 'ID chuyến đi không hợp lệ' });
  const rawExpectedVersion = req.query.expectedVersion
    ?? (req.body as Record<string, unknown> | undefined)?.expectedVersion;
  const expectedVersion = rawExpectedVersion === undefined
    ? undefined
    : Number(rawExpectedVersion);
  if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion <= 0)) {
    return res.status(400).json({ error: 'Phiên bản chuyến đi không hợp lệ' });
  }
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_DELETE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId: id, expectedVersion },
    createdBy: user.userId,
    entityType: 'trip',
    create: async (tx) => {
      await tripService.deleteTrip(id, expectedVersion, tx);
      return { ok: true };
    },
    getEntityId: () => id,
  });
  if (!replayed) await invalidateReportCaches();
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// Update pre-departure figures
router.put('/:id/pre-departure', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = updateTripFiguresSchema.parse(req.body);
  const user = getUser(req);
  const governanceReason = typeof req.body?.governanceReason === 'string'
    ? req.body.governanceReason.trim()
    : '';
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_PRE_DEPARTURE,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId: id, data, governanceReason },
    createdBy: user.userId,
    entityType: 'trip_or_governance_action',
    create: async (tx) => {
      const [current] = await tx.select({ status: s.trips.status }).from(s.trips)
        .where(eq(s.trips.id, id)).limit(1);
      if (current?.status === TripStatus.COMPLETED) {
        return requestTripFinancialChange({
          tripId: id,
          reason: governanceReason,
          figures: {
            ...data,
            expectedVersion: data.version,
            userId: user.userId,
            userRole: user.role,
          },
          makerId: user.userId,
          makerRole: user.role,
          expectedTripVersion: data.version!,
          transaction: tx,
        });
      }
      return tripService.updateTripFigures(id, {
        ...data,
        expectedVersion: data.version,
        userId: user.userId,
        userRole: user.role,
      }, tx);
    },
    getEntityId: (value) => value.id,
  });
  const pendingGovernance = 'actionKind' in result
    && result.actionKind === 'TRIP_FINANCIAL_CHANGE';
  if (pendingGovernance) {
    res.locals.auditEvent = AuditEvent.TRIP_FINANCIAL_CHANGE_REQUESTED;
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = result.subjectKey;
  }
  if (!replayed && !pendingGovernance) await invalidateReportCaches();
  res.status(pendingGovernance && !replayed ? 202 : 200)
    .json(idempotencyKey ? { ...result, replayed } : result);
}));

// Update actuals
router.put('/:id/actuals', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = updateTripFiguresSchema.parse(req.body);
  const user = getUser(req);
  const governanceReason = typeof req.body?.governanceReason === 'string'
    ? req.body.governanceReason.trim()
    : '';
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_ACTUALS,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId: id, data, governanceReason },
    createdBy: user.userId,
    entityType: 'trip_or_governance_action',
    create: async (tx) => {
      const [current] = await tx.select({ status: s.trips.status }).from(s.trips)
        .where(eq(s.trips.id, id)).limit(1);
      if (current?.status === TripStatus.COMPLETED) {
        return requestTripFinancialChange({
          tripId: id,
          reason: governanceReason,
          figures: {
            ...data,
            expectedVersion: data.version,
            userId: user.userId,
            userRole: user.role,
          },
          makerId: user.userId,
          makerRole: user.role,
          expectedTripVersion: data.version!,
          transaction: tx,
        });
      }
      return tripService.updateTripFigures(id, {
        ...data,
        expectedVersion: data.version,
        userId: user.userId,
        userRole: user.role,
      }, tx);
    },
    getEntityId: (value) => value.id,
  });
  const pendingGovernance = 'actionKind' in result
    && result.actionKind === 'TRIP_FINANCIAL_CHANGE';
  if (pendingGovernance) {
    res.locals.auditEvent = AuditEvent.TRIP_FINANCIAL_CHANGE_REQUESTED;
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = result.subjectKey;
  }
  if (!replayed && !pendingGovernance) await invalidateReportCaches();
  res.status(pendingGovernance && !replayed ? 202 : 200)
    .json(idempotencyKey ? { ...result, replayed } : result);
}));

// Dispatch trip
router.post('/:id/dispatch', asyncHandler(async (req: Request, res: Response) => {
  const idempotencyKey = getRequestIdempotencyKey(req);
  const outcome = await dispatchTripWriteCommand(
    parseInt(req.params.id as string),
    getUser(req),
    { idempotencyKey, expectedVersion: getExpectedVersion(req.body) },
  );
  res.json(idempotencyKey
    ? { ...outcome.trip, replayed: outcome.replayed }
    : outcome.trip);
}));

// Complete trip (IN_TRANSIT → COMPLETED). Permissive — photos optional (B2):
// a trip may be marked "Hoàn thành" without photos; evidence can be added or
// edited afterwards. This is the explicit replacement for the old auto-complete
// that previously fired inside updateTripFigures whenever any photo existed.
router.post('/:id/complete', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  if (expectedVersion === undefined) {
    throw new ApiError(400, 'Phiên bản chuyến đi là bắt buộc');
  }
  const reason = getRequiredGovernanceReason(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: action, replayed, statusCode } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_FINANCIAL_CLOSE,
    idempotencyKey,
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      tripId: id,
      expectedVersion,
      reason,
    },
    createdBy: user.userId,
    entityType: 'governance_action',
    create: (tx) => requestTripFinancialClose({
      tripId: id,
      reason,
      makerId: user.userId,
      makerRole: user.role,
      expectedTripVersion: expectedVersion,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
    responseStatusCode: 202,
  });
  res.locals.auditEvent = AuditEvent.TRIP_FINANCIAL_CLOSE_REQUESTED;
  res.locals.auditEntityId = id;
  res.locals.auditEntityKey = action.subjectKey;
  res.status(statusCode)
    .json(idempotencyKey ? { ...action, replayed } : action);
}));

// Cancel trip
router.post('/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const [current] = await db.select({
    status: s.trips.status,
  }).from(s.trips).where(eq(s.trips.id, id)).limit(1);
  if (!current) throw new ApiError(404, 'Không tìm thấy chuyến đi');

  if (current.status === TripStatus.COMPLETED) {
    if (expectedVersion === undefined) {
      throw new ApiError(400, 'Phiên bản chuyến đi là bắt buộc');
    }
    const reason = getRequiredGovernanceReason(req.body);
    const user = getUser(req);
    const { result: action, replayed, statusCode } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_COMPLETED_CANCEL,
      idempotencyKey,
      payload: {
        actorId: user.userId,
        actorRole: user.role,
        tripId: id,
        expectedVersion,
        reason,
      },
      createdBy: user.userId,
      entityType: 'governance_action',
      create: (tx) => requestCompletedTripCancellation({
        tripId: id,
        reason,
        makerId: user.userId,
        makerRole: user.role,
        expectedTripVersion: expectedVersion,
        transaction: tx,
      }),
      getEntityId: (result) => result.id,
      responseStatusCode: 202,
    });
    res.locals.auditEvent = AuditEvent.TRIP_FINANCIAL_CANCEL_REQUESTED;
    res.locals.auditEntityId = id;
    res.locals.auditEntityKey = action.subjectKey;
    res.status(statusCode)
      .json(idempotencyKey ? { ...action, replayed } : action);
    return;
  }

  const outcome = await transitionTripWriteCommand({
    tripId: id,
    targetStatus: TripStatus.CANCELED,
    actor: getUser(req),
    idempotencyKey,
    expectedVersion,
  });
  if (!outcome.replayed) {
    await invalidateReportCaches();
    // Remove TRIP_DAY records for the canceled trip
    await tripService.syncAttendanceAfterStatusChange(
      outcome.trip.id, TripStatus.CANCELED, outcome.trip.driverId ?? null,
      outcome.trip.departureDate ?? null, null, getUser(req).userId,
    );
    emitNotification({
      type: NotificationType.TRIP_CANCELED,
      title: 'Chuyến đã hủy',
      message: `Chuyến ${outcome.trip.tripCode} đã bị hủy`,
      relatedEntityType: 'trips',
      relatedEntityId: id,
      targetDriverId: outcome.trip.driverId ?? undefined,
    });
  }
  res.json(idempotencyKey
    ? { ...outcome.trip, replayed: outcome.replayed }
    : outcome.trip);
}));

// ─── O2C POD-recovery gate (260801-2200 phase-03) ────────────────────────────
// Records physical paper return ("Đã thu hồi chứng từ gốc / POD mộc đỏ").
// Distinct from digital e-POD acceptance. The IN_TRANSIT → COMPLETED transition
// throws if this is null; only ACCOUNTANT or CLERK may set it.
router.post('/:id/pod-recovered', requireRoles(Role.ACCOUNTANT, Role.CUS), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const expectedVersion = getExpectedVersion(req.body);
  const user = getUser(req);
  const [updated] = await db.update(s.trips).set({
    podRecoveredAt: new Date(),
    podRecoveredBy: user.userId,
    version: sql`${s.trips.version} + 1`,
    updatedAt: new Date(),
  }).where(and(
    eq(s.trips.id, id),
    ...(expectedVersion !== undefined ? [eq(s.trips.version, expectedVersion)] : []),
  )).returning();
  if (!updated) throw new ApiError(409, 'Chuyến đi đã bị thay đổi. Vui lòng tải lại.');
  res.json(updated);
}));

// ─── O2C field-ops hand-off timestamps (phase-04) ────────────────────────────
// Ops (FORWARDER) records the paper-order hand-off; Driver confirms order receipt.
router.post('/:id/paper-order-collected', requireRoles(Role.OPS), asyncHandler(async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Đường dẫn này đã ngừng dùng. Vui lòng dùng xác nhận bàn giao lệnh gốc trong cổng FORWARDER theo chuyến được giao.',
  });
}));

router.post('/:id/driver-order-accepted', requireRoles(Role.DRIVER), asyncHandler(async (req: Request, res: Response) => {
  res.status(410).json({
    error: 'Đường dẫn này đã ngừng dùng. Tài xế phải dùng mốc "Đã nhận lệnh gốc" trong cổng DRIVER để ghi nhận theo chuỗi chuẩn.',
  });
}));

// Reassign truck/driver (only for CREATED trips)
router.patch('/:id/reassign', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = req.body;
  if (data.expectedVersion !== undefined
      && (!Number.isInteger(data.expectedVersion) || data.expectedVersion <= 0)) {
    return res.status(400).json({ error: 'Phiên bản chuyến đi không hợp lệ' });
  }
  if (data.carrierType === 'OWN' && (!data.truckId || !data.driverId)) {
    return res.status(400).json({ error: 'truckId và driverId là bắt buộc cho xe nhà' });
  }
  if (data.carrierType === 'EXTERNAL' && (!data.externalCarrierId && !data.externalPlateNumber)) {
    return res.status(400).json({ error: 'Vui lòng chọn đối tác xe ngoài hoặc nhập biển số' });
  }
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: trip, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_REASSIGN,
    idempotencyKey,
    payload: { actorId: user.userId, tripId: id, data },
    createdBy: user.userId,
    entityType: 'trip',
    create: (tx) => tripService.reassignTrip(id, data, tx),
    getEntityId: (result) => result.id,
  });
  if (!replayed) await invalidateReportCaches();
  res.json(idempotencyKey ? { ...trip, replayed } : trip);
}));

// Submit an exceptional reopen request. The trip remains COMPLETED until a
// distinct checker and approver complete the governance action.
router.post('/:id/unlock', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = tripReopenRequestSchema.parse(req.body);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: action, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_UNLOCK,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId: id, data },
    createdBy: user.userId,
    entityType: 'governance_action',
    create: (tx) => requestTripReopen({
      tripId: id,
      reason: data.reason,
      makerId: user.userId,
      makerRole: user.role,
      expectedTripVersion: data.expectedVersion,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
  });
  res.status(202).json(idempotencyKey ? { ...action, replayed } : action);
}));

// Change departure date (any status except CANCELED)
router.patch('/:id/departure-date', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { departureDate } = req.body;
  if (!departureDate || typeof departureDate !== 'string') {
    return res.status(400).json({ error: 'Ngày khởi hành không hợp lệ' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    return res.status(400).json({ error: 'Định dạng ngày không hợp lệ (YYYY-MM-DD)' });
  }
  const parsed = Date.parse(departureDate);
  if (isNaN(parsed)) {
    return res.status(400).json({ error: 'Giá trị ngày không hợp lệ' });
  }
  if (req.body.expectedVersion !== undefined
      && (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion <= 0)) {
    return res.status(400).json({ error: 'Phiên bản chuyến đi không hợp lệ' });
  }
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: trip, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_DEPARTURE_DATE,
    idempotencyKey,
    payload: {
      actorId: user.userId,
      actorRole: user.role,
      tripId: id,
      departureDate,
      expectedVersion: req.body.expectedVersion,
    },
    createdBy: user.userId,
    entityType: 'trip',
    create: (tx) => tripService.updateDepartureDate(
      id,
      departureDate,
      user.userId,
      user.role,
      req.body.expectedVersion,
      tx,
    ),
    getEntityId: (result) => result.id,
  });
  if (!replayed) await invalidateReportCaches(true);
  res.json(idempotencyKey ? { ...trip, replayed } : trip);
}));

// Get adjustments for a specific trip
router.get('/:id/adjustments', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string);
  const [postedItems, actions] = await Promise.all([
    financialService.getTripAdjustments(tripId),
    listTripGovernanceActions(tripId),
  ]);
  res.json({ items: postedItems, actions });
}));

// Create adjustment for a specific trip
router.post('/:id/adjustment', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string);
  const data = createAdjustmentSchema.parse({ ...req.body, tripId });
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: action, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_ADJUSTMENT,
    idempotencyKey,
    payload: { actorId: user.userId, actorRole: user.role, tripId, data },
    createdBy: user.userId,
    entityType: 'governance_action',
    create: (tx) => financialService.createAdjustment({
      tripId,
      amount: data.amount,
      note: data.note,
      signedAgreementRef: data.signedAgreementRef,
      makerId: user.userId,
      makerRole: user.role,
      expectedTripVersion: data.expectedVersion,
      transaction: tx,
    }),
    getEntityId: (result) => result.id,
  });
  res.status(201).json(idempotencyKey ? { ...action, replayed } : action);
}));

// ─── Container instances per trip (accessible to ADMIN/MANAGER/ACCOUNTANT) ────
// The /api/trips route is already gated by casbin via the parent router mount,
// so authorisation is consistent with the rest of the trip endpoints.

// List container instances for a trip
router.get('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  // Include the trip's latest cont/seal photo keys so the office-staff editor
  // can render persisted thumbnails (mirrors the driver detail response).
  // Also include the FULL list (newest first) so the trip detail page can
  // surface every captured photo, not just the latest. The singular fields
  // are kept for back-compat with older clients; contPhotoKeys[0] === contPhotoKey.
  const [
    items,
    contPhotoKey,
    sealPhotoKey,
    contPhotoKeys,
    sealPhotoKeys,
  ] = await Promise.all([
    listTripContainers(tripId),
    latestTripPhotoKey(tripId, 'CONTAINER'),
    latestTripPhotoKey(tripId, 'SEAL'),
    listTripPhotoKeys(tripId, 'CONTAINER'),
    listTripPhotoKeys(tripId, 'SEAL'),
  ]);
  res.json({ items, contPhotoKey, sealPhotoKey, contPhotoKeys, sealPhotoKeys });
}));

// Batch upsert container instances. Body shape: { containers: [...] }
// Inserts new rows, updates rows by id, deletes existing rows whose id
// is not in the incoming list.
router.put('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const parsed = tripContainerBatchSchema.parse(req.body);
  const userId = req.user?.userId ?? null;
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_CONTAINERS,
    idempotencyKey,
    payload: { actorId: userId, tripId, data: parsed },
    createdBy: userId,
    entityType: 'trip_containers',
    create: async (tx) => ({
      items: await batchUpsertTripContainers(
        tripId,
        userId,
        parsed.containers,
        parsed.expectedVersion,
        tx,
      ),
    }),
    getEntityId: () => tripId,
  });
  if (!replayed) await invalidateReportCaches();
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// ─── Trip instructions (N2 / B1.3) ──────────────────────────────────────────
// Manager-authored contact + free-text guidance. One row per trip; upsert on
// conflict. No new casbin line — MANAGER/ACCOUNTANT already have `trips write`
// and ADMIN has the wildcard policy.

// GET /api/trips/:id/instructions — returns null when no row exists yet.
router.get('/:id/instructions', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  res.json(await tripService.getTripInstructions(tripId));
}));

// PUT /api/trips/:id/instructions — upsert contact + guidance for a trip.
router.put('/:id/instructions', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  if (!Number.isFinite(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'ID chuyến đi không hợp lệ' });
  }
  const parsed = upsertTripInstructionsSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: row, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_INSTRUCTIONS,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, data: parsed.data },
    createdBy: user.userId,
    entityType: 'trip_instructions',
    create: (tx) => tripService.upsertTripInstructions(
      tripId,
      parsed.data,
      user.userId,
      tx,
    ),
    getEntityId: (result) => result.id,
  });
  res.json(idempotencyKey ? { ...row, replayed } : row);
}));

// ─── Trip Expenses (ancillary fees) ──────────────────────────────────────────

// GET /api/trips/:id/expenses — list all expenses for a trip
router.get('/:id/expenses', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const items = await getTripExpenses(db, tripId);
  res.json({ items });
}));

// POST /api/trips/:id/expenses — office maker creates a pending expense;
// another financial actor must approve it.
router.post('/:id/expenses', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const parsed = tripExpenseSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) throwValidation(parsed.error);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: item, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_CREATE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, data: parsed.data },
    createdBy: user.userId,
    entityType: 'trip_expense',
    create: (tx) => createTripExpense(tx, {
      tripId,
      forwarderId: parsed.data.settlementMethod === 'OPS_ADVANCE'
        ? (parsed.data.forwarderId ?? null)
        : null,
      createdBy: user.userId,
      approvalStatus: 'PENDING',
      expenseType: parsed.data.expenseType,
      buyAmount: String(parsed.data.buyAmount),
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
      note: parsed.data.note ?? null,
      noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [],
    }),
    getEntityId: (result) => result.id,
  });
  res.status(201).json(idempotencyKey ? { ...item, replayed } : item);
}));

// PUT /api/trips/:id/expenses/:eid — update expense
router.put('/:id/expenses/:eid', asyncHandler(async (req: Request, res: Response) => {
  const eid = parseInt(req.params.eid as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const tripId = parseInt(req.params.id as string, 10);
  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: item, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_UPDATE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, expenseId: eid, data: parsed.data },
    createdBy: user.userId,
    entityType: 'trip_expense',
    create: async (tx) => {
      const updated = await updateTripExpense(tx, eid, {
        expenseType: parsed.data.expenseType,
        buyAmount: parsed.data.buyAmount !== undefined ? String(parsed.data.buyAmount) : undefined,
        sellAmount: parsed.data.sellAmount !== undefined ? String(parsed.data.sellAmount) : undefined,
        settlementMethod: parsed.data.settlementMethod,
        // Only include nullable fields when explicitly provided (undefined = don't touch)
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
      });
      if (!updated) throw new ApiError(404, 'Không tìm thấy chi phí');
      return updated;
    },
    getEntityId: (result) => result.id,
  });
  res.json(idempotencyKey ? { ...item, replayed } : item);
}));

// DELETE /api/trips/:id/expenses/:eid — hard delete (only if trip not locked)
router.delete('/:id/expenses/:eid', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const eid = parseInt(req.params.eid as string, 10);

  const user = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result: outcome, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_DELETE,
    idempotencyKey,
    payload: { actorId: user.userId, tripId, expenseId: eid },
    createdBy: user.userId,
    entityType: 'trip_expense',
    create: async (tx) => {
      const expense = await getTripExpenseAuditInfo(eid, tx);
      const result = await deleteTripExpenseGuarded(tripId, eid, tx);
      return { result, expense };
    },
    getEntityId: () => eid,
  });
  if ('error' in outcome.result) {
    return res.status(outcome.result.status).json({ error: outcome.result.error });
  }

  if (outcome.expense) {
    const buyAmt = Number(outcome.expense.buyAmount).toLocaleString('vi-VN') + ' ₫';
    const tripPart = outcome.expense.tripCode ? ` cho chuyến ${outcome.expense.tripCode}` : '';
    const supplierPart = outcome.expense.supplierName ? ` (Nhà cung cấp: ${outcome.expense.supplierName})` : '';
    res.locals.auditEntityKey = `phí ${outcome.expense.typeName || 'hộ'} với số tiền chi ${buyAmt}${tripPart}${supplierPart}`;
  }

  res.json(idempotencyKey ? { ok: true, replayed } : { ok: true });
}));

// POST /api/trips/:id/expenses/:eid/approve — submit governed approval request
router.post(
  '/:id/expenses/:eid/approve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const tripId = parseInt(req.params.id as string, 10);
    const eid = parseInt(req.params.eid as string, 10);
    const user = getUser(req);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const input = tripExpenseDecisionRequestSchema.parse(req.body);
    const { result, replayed, statusCode } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_APPROVE,
      idempotencyKey,
      payload: {
        actorId: user.userId,
        actorRole: user.role,
        tripId,
        expenseId: eid,
        decision: 'APPROVED',
        ...input,
      },
      createdBy: user.userId,
      entityType: 'governance_action',
      create: (tx) => requestTripExpenseDecision({
        tripId,
        expenseId: eid,
        decision: 'APPROVED',
        reason: input.reason,
        evidence: input.evidence,
        expectedExpenseVersion: input.expectedVersion,
        makerId: user.userId,
        makerRole: user.role,
        transaction: tx,
      }),
      getEntityId: (action) => action.id,
      responseStatusCode: 202,
    });
    res.locals.auditEntityId = eid;
    res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

// POST /api/trips/:id/expenses/:eid/reject — submit governed rejection request
router.post(
  '/:id/expenses/:eid/reject',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const tripId = parseInt(req.params.id as string, 10);
    const eid = parseInt(req.params.eid as string, 10);
    const user = getUser(req);
    const idempotencyKey = getRequestIdempotencyKey(req);
    const input = tripExpenseDecisionRequestSchema.parse(req.body);
    const { result, replayed, statusCode } = await runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.TRIP_EXPENSE_REJECT,
      idempotencyKey,
      payload: {
        actorId: user.userId,
        actorRole: user.role,
        tripId,
        expenseId: eid,
        decision: 'REJECTED',
        ...input,
      },
      createdBy: user.userId,
      entityType: 'governance_action',
      create: (tx) => requestTripExpenseDecision({
        tripId,
        expenseId: eid,
        decision: 'REJECTED',
        reason: input.reason,
        evidence: input.evidence,
        expectedExpenseVersion: input.expectedVersion,
        makerId: user.userId,
        makerRole: user.role,
        transaction: tx,
      }),
      getEntityId: (action) => action.id,
      responseStatusCode: 202,
    });
    res.locals.auditEntityId = eid;
    res.status(statusCode).json(idempotencyKey ? { ...result, replayed } : result);
  }),
);

// GET /api/trips/:id/fuel-voucher/html — fuel voucher HTML
router.get('/:id/fuel-voucher/html',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const html = await getFuelVoucherHtml(id);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

// GET /api/trips/:id/fuel-voucher/xlsx — fuel voucher Excel download
router.get('/:id/fuel-voucher/xlsx',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=phieu-cap-nhien-lieu-${id}.xlsx`);
  await getFuelVoucherXlsx(id, res);
}));

export default router;
