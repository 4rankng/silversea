/**
 * Trips CRUD + list/summary/stats reads and create/copy/pairs/bulk-figures
 * writes. Handler bodies moved verbatim from routes/trips.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  Role, TripStatus, createTripSchema, createTripPairSchema, updateTripFiguresSchema, bulkUpdateTripFiguresSchema,
} from '@tingting/shared';
import { ApiError } from '../../errors';
import { copyTripWriteCommand, createTripWriteCommand } from '../../services/trip-command.service';
import { requestTripFinancialChange } from '../../services/adjustment-governance.service';
import { loadTripStatusVersion } from '../../services/trip-queries.service';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { config } from '../../config';
import * as tripService from '../../services/trip.service';
import { getTripFactorySiteView } from '../../services/trip-factory-site.service';
import { createTripPair } from '../../services/trip-pairs.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { parsePagination } from '../utils/pagination';
import { tripListSortQuerySchema } from './trips-shared';
import { invalidateReportCaches } from '../../lib/report-cache';

const router = Router();

// List trips with filters
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const truckIdVal = (req.query.truckId || req.query.truck_id) as string;
  const driverIdVal = (req.query.driverId || req.query.driver_id) as string;
  const customerIdVal = (req.query.customerId || req.query.customer_id) as string;
  const dateFromVal = (req.query.dateFrom || req.query.date_from) as string;
  const dateToVal = (req.query.dateTo || req.query.date_to) as string;
  const searchVal = (req.query.search || req.query.q) as string;

  const parsedSort = tripListSortQuerySchema.safeParse({
    sortBy: req.query.sortBy,
    sortDir: req.query.sortDir,
  });
  if (!parsedSort.success) {
    throw new ApiError(400, 'Tham số sắp xếp không hợp lệ');
  }

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
    sortBy: parsedSort.data.sortBy,
    sortDir: parsedSort.data.sortDir,
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
          const current = await loadTripStatusVersion(tx, update.tripId);
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
  // F6: attach the factory-site view (snapshot preferred, live join for
  // legacy rows) alongside the composite detail.
  const [trip, factorySite] = await Promise.all([
    tripService.getTripById(id),
    getTripFactorySiteView(id),
  ]);
  res.json({ ...trip, factorySite });
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

export default router;
