import { Router } from 'express';
import { TripStatus, NotificationType, Role, createTripSchema, updateTripFiguresSchema, bulkUpdateTripFiguresSchema, createAdjustmentSchema, tripContainerBatchSchema, tripExpenseSchema, tripExpensePatchSchema, upsertTripInstructionsSchema } from '@tingting/shared';
import * as tripService from '../services/trip.service';
import * as gpsService from '../services/gps.service';
import { captureTripGpsTrack, deriveRoutesForStoredTrip } from '../services/gps/capture.service';
import * as financialService from '../services/financial.service';
import { listTripContainers, batchUpsertTripContainers, createTripExpense, updateTripExpense, getTripExpenses, deleteTripExpenseGuarded, getTripExpenseAuditInfo, latestTripPhotoKey, listTripPhotoKeys } from '../services/forwarder.service';
import { processExpenseApproval } from '../services/approval.service';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { db } from '../db';
import * as dbSchema from '../db/schema';
import { eq } from 'drizzle-orm';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { registerAuditEvent } from '../services/audit-registry';
import { AuditEvent } from '../services/audit-types';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { parsePagination } from './utils/pagination';
import { throwValidation } from '../lib/validation';
import { emitNotification } from '../services/notification.service';
import { getFuelVoucherHtml, getFuelVoucherXlsx } from '../services/fuel-voucher.service';
import { copyTripCommand, createTripCommand, dispatchTripCommand } from '../services/trip-command.service';

// Audit event registrations — declared once at module load, matched by middleware
registerAuditEvent('POST', '/api/trips', AuditEvent.TRIP_CREATED);
registerAuditEvent('POST', '/api/trips/', '/copy', AuditEvent.TRIP_CREATED);
registerAuditEvent('PUT', '/api/trips/', '/pre-departure', AuditEvent.TRIP_UPDATED_PRE_DEPARTURE);
registerAuditEvent('PUT', '/api/trips/', '/actuals', AuditEvent.TRIP_UPDATED_ACTUALS);
registerAuditEvent('POST', '/api/trips/bulk-figures', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/trips/', '/dispatch', AuditEvent.TRIP_DISPATCHED);
registerAuditEvent('POST', '/api/trips/', '/complete', AuditEvent.TRIP_COMPLETED);
registerAuditEvent('POST', '/api/trips/', '/lock', AuditEvent.TRIP_LOCKED);
registerAuditEvent('POST', '/api/trips/', '/cancel', AuditEvent.TRIP_CANCELED);
registerAuditEvent('POST', '/api/trips/', '/adjustment', AuditEvent.ADJUSTMENT_CREATED);
registerAuditEvent('POST', '/api/trips/', '/approve', AuditEvent.ENTITY_UPDATED);
registerAuditEvent('POST', '/api/trips/', '/unlock', AuditEvent.TRIP_UNLOCKED);
registerAuditEvent('PATCH', '/api/trips/', '/departure-date', AuditEvent.TRIP_DEPARTURE_DATE_CHANGED);

const router = Router();

async function invalidateReportCaches(invalidatePnl?: boolean) {
  await Promise.all([
    cacheInvalidate('reports:dashboard'),
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
  const trip = await createTripCommand(data, getUser(req));
  res.status(201).json(trip);
}));

// Copy every editable planning/financial field atomically. Execution evidence,
// expenses, lifecycle state, and container/seal identifiers start clean.
router.post('/:id/copy', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const tripId = Number(req.params.id);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    return res.status(400).json({ error: 'ID chuyến đi không hợp lệ' });
  }
  const trip = await copyTripCommand(tripId, getUser(req));
  res.locals.auditEntityId = trip.id;
  res.status(201).json(trip);
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
    locked: summary.statusCounts[TripStatus.LOCKED],
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
      const trip = await tripService.updateTripFigures(update.tripId, {
        ...parsedFigures.data,
        expectedVersion: parsedFigures.data.version,
        userId: user.userId,
        userRole: user.role,
      });
      results.push({ tripId: update.tripId, ok: true, trip });
    } catch (err) {
      results.push({
        tripId: update.tripId,
        ok: false,
        error: err instanceof Error ? err.message : 'Không thể cập nhật chuyến',
      });
    }
  }

  const updated = results.filter((r) => r.ok).length;
  await invalidateReportCaches();
  res.json({
    results,
    updated,
    failed: results.length - updated,
  });
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
  await tripService.deleteTrip(id);
  await invalidateReportCaches();
  res.json({ ok: true });
}));

// Update pre-departure figures
router.put('/:id/pre-departure', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = updateTripFiguresSchema.parse(req.body);
  const trip = await tripService.updateTripFigures(id, {
    ...data,
    expectedVersion: data.version,
    userId: getUser(req).userId,
    userRole: getUser(req).role,
  });
  await invalidateReportCaches();
  res.json(trip);
}));

// Update actuals
router.put('/:id/actuals', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = updateTripFiguresSchema.parse(req.body);
  const updated = await tripService.updateTripFigures(id, {
    ...data,
    expectedVersion: data.version,
    userId: getUser(req).userId,
    userRole: getUser(req).role,
  });
  await invalidateReportCaches();
  res.json(updated);
}));

// Dispatch trip
router.post('/:id/dispatch', asyncHandler(async (req: Request, res: Response) => {
  const trip = await dispatchTripCommand(parseInt(req.params.id as string), getUser(req));
  res.json(trip);
}));

// Complete trip (IN_TRANSIT → COMPLETED). Permissive — photos optional (B2):
// a trip may be marked "Hoàn thành" without photos; evidence can be added or
// edited afterwards. This is the explicit replacement for the old auto-complete
// that previously fired inside updateTripFigures whenever any photo existed.
router.post('/:id/complete', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const trip = await tripService.transitionTripStatus(
    id,
    TripStatus.COMPLETED,
    getUser(req).userId,
    getUser(req).role,
  );
  await invalidateReportCaches();
  // Sync attendance: completion closes the trip's wage window.
  await tripService.syncAttendanceAfterStatusChange(
    trip.id, TripStatus.COMPLETED, trip.driverId ?? null,
    trip.departureDate ?? null, null, getUser(req).userId,
  );
  emitNotification({
    type: NotificationType.TRIP_COMPLETED,
    title: 'Chuyến hoàn thành',
    message: `Chuyến ${trip.tripCode} đã hoàn thành`,
    relatedEntityType: 'trips',
    relatedEntityId: trip.id,
    targetDriverId: trip.driverId ?? undefined,
  });
  // Capture real GPS routes for this trip's legs (fire-and-forget). Phase 1
  // persists the trip-scoped trail (fast, no geocoding); Phase 2 derives the
  // per-leg routes untimed off the real persist promise (Nominatim ~1 req/s).
  // Both run after the response — never block completion. GPS may still be
  // ingesting at completion, so failures are logged — never fatal.
  void captureTripGpsTrack(trip.id)
    .then((r) => (r.status === 'ok' ? deriveRoutesForStoredTrip(trip.id) : null))
    .catch((err) => console.warn('[gps] capture/derive hook error', { tripId: trip.id, err }));
  res.json(trip);
}));

// Lock trip
router.post('/:id/lock', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const confirmZeroRevenue = req.body.confirmZeroRevenue === true;
  const confirmNoPhoto = req.body.confirmNoPhoto === true;
  const trip = await tripService.transitionTripStatus(
    id,
    TripStatus.LOCKED,
    getUser(req).userId,
    getUser(req).role,
    confirmZeroRevenue,
    confirmNoPhoto,
  );
  await invalidateReportCaches(true);
  emitNotification({
    type: NotificationType.TRIP_LOCKED,
    title: 'Chuyến đã khóa',
    message: `Chuyến ${trip.tripCode} đã được khóa`,
    relatedEntityType: 'trips',
    relatedEntityId: id,
  });
  res.json(trip);
}));

// Cancel trip
router.post('/:id/cancel', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const trip = await tripService.transitionTripStatus(
    id,
    TripStatus.CANCELED,
    getUser(req).userId,
    getUser(req).role,
  );
  await invalidateReportCaches();
  // Remove TRIP_DAY records for the canceled trip
  await tripService.syncAttendanceAfterStatusChange(
    trip.id, TripStatus.CANCELED, trip.driverId ?? null,
    trip.departureDate ?? null, null, getUser(req).userId,
  );
  emitNotification({
    type: NotificationType.TRIP_CANCELED,
    title: 'Chuyến đã hủy',
    message: `Chuyến ${trip.tripCode} đã bị hủy`,
    relatedEntityType: 'trips',
    relatedEntityId: id,
    targetDriverId: trip.driverId ?? undefined,
  });
  res.json(trip);
}));

// Reassign truck/driver (only for CREATED trips)
router.patch('/:id/reassign', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const data = req.body;
  if (data.carrierType === 'OWN' && (!data.truckId || !data.driverId)) {
    return res.status(400).json({ error: 'truckId và driverId là bắt buộc cho xe nhà' });
  }
  if (data.carrierType === 'EXTERNAL' && (!data.externalCarrierId && !data.externalPlateNumber)) {
    return res.status(400).json({ error: 'Vui lòng chọn đối tác xe ngoài hoặc nhập biển số' });
  }
  const trip = await tripService.reassignTrip(id, data);
  await invalidateReportCaches();
  res.json(trip);
}));

// Unlock trip (LOCKED → COMPLETED, reopens editing; ledger stays posted)
router.post('/:id/unlock', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  const trip = await tripService.transitionTripStatus(
    id,
    TripStatus.COMPLETED,
    getUser(req).userId,
    getUser(req).role,
  );
  await invalidateReportCaches(true);
  emitNotification({
    type: NotificationType.TRIP_UNLOCKED,
    title: 'Chuyến đã mở khóa',
    message: `Chuyến ${trip.tripCode} đã được mở khóa`,
    relatedEntityType: 'trips',
    relatedEntityId: id,
  });
  res.json(trip);
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
  const trip = await tripService.updateDepartureDate(
    id,
    departureDate,
    getUser(req).userId,
    getUser(req).role,
  );
  await invalidateReportCaches(true);
  res.json(trip);
}));

// Get adjustments for a specific trip
router.get('/:id/adjustments', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string);
  const items = await financialService.getTripAdjustments(tripId);
  res.json({ items });
}));

// Create adjustment for a specific trip
router.post('/:id/adjustment', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string);
  const data = createAdjustmentSchema.parse({ ...req.body, tripId });
  await financialService.createAdjustment({
    tripId,
    amount: data.amount,
    note: data.note,
    signedAgreementRef: data.signedAgreementRef,
  });
  await invalidateReportCaches(true);
  res.status(201).json({ ok: true });
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
  const items = await batchUpsertTripContainers(tripId, userId, parsed.containers);
  await invalidateReportCaches();
  res.json({ items });
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
  // Existence guard — otherwise a missing/hard-deleted trip would surface as an
  // opaque 500 (Postgres FK violation) from the upsert.
  const [trip] = await db.select({ id: dbSchema.trips.id })
    .from(dbSchema.trips).where(eq(dbSchema.trips.id, tripId)).limit(1);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  const row = await tripService.upsertTripInstructions(tripId, parsed.data, getUser(req).userId);
  res.json(row);
}));

// ─── Trip Expenses (ancillary fees) ──────────────────────────────────────────

// GET /api/trips/:id/expenses — list all expenses for a trip
router.get('/:id/expenses', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const items = await getTripExpenses(db, tripId);
  res.json({ items });
}));

// POST /api/trips/:id/expenses — accountant/manager creates expense (auto-APPROVED)
router.post('/:id/expenses', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const parsed = tripExpenseSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) throwValidation(parsed.error);
  const item = await db.transaction(async (tx) =>
    createTripExpense(tx, {
      tripId,
      forwarderId: parsed.data.settlementMethod === 'FORWARDER_ADVANCE'
        ? (parsed.data.forwarderId ?? null)
        : null,
      approvalStatus: 'APPROVED',
      expenseType: parsed.data.expenseType,
      buyAmount: String(parsed.data.buyAmount),
      sellAmount: String(parsed.data.sellAmount ?? 0),
      settlementMethod: parsed.data.settlementMethod,
      supplierId: parsed.data.supplierId ?? null,
      invoiceNumber: parsed.data.invoiceNumber ?? null,
      invoiceDate: parsed.data.invoiceDate ?? null,
      declarationNumber: parsed.data.declarationNumber ?? null,
      containerNumber: parsed.data.containerNumber ?? null,
      tripContainerId: parsed.data.tripContainerId ?? null,
      note: parsed.data.note ?? null,
    }),
  );
  res.status(201).json(item);
}));

// PUT /api/trips/:id/expenses/:eid — update expense
router.put('/:id/expenses/:eid', asyncHandler(async (req: Request, res: Response) => {
  const eid = parseInt(req.params.eid as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const item = await db.transaction(async (tx) =>
    updateTripExpense(tx, eid, {
      expenseType: parsed.data.expenseType,
      buyAmount: parsed.data.buyAmount !== undefined ? String(parsed.data.buyAmount) : undefined,
      sellAmount: parsed.data.sellAmount !== undefined ? String(parsed.data.sellAmount) : undefined,
      settlementMethod: parsed.data.settlementMethod,
      // Only include nullable fields when explicitly provided (undefined = don't touch)
      ...(parsed.data.supplierId !== undefined ? { supplierId: parsed.data.supplierId ?? null } : {}),
      ...(parsed.data.invoiceNumber !== undefined ? { invoiceNumber: parsed.data.invoiceNumber ?? null } : {}),
      ...(parsed.data.invoiceDate !== undefined ? { invoiceDate: parsed.data.invoiceDate ?? null } : {}),
      ...(parsed.data.declarationNumber !== undefined ? { declarationNumber: parsed.data.declarationNumber ?? null } : {}),
      ...(parsed.data.containerNumber !== undefined ? { containerNumber: parsed.data.containerNumber ?? null } : {}),
      ...(parsed.data.tripContainerId !== undefined ? { tripContainerId: parsed.data.tripContainerId ?? null } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note ?? null } : {}),
    }),
  );
  if (!item) return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  res.json(item);
}));

// DELETE /api/trips/:id/expenses/:eid — hard delete (only if trip not locked)
router.delete('/:id/expenses/:eid', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.id as string, 10);
  const eid = parseInt(req.params.eid as string, 10);

  // Fetch expense info for audit log before delete
  const expense = await getTripExpenseAuditInfo(eid);

  const result = await deleteTripExpenseGuarded(tripId, eid);
  if ('error' in result) return res.status(result.status).json({ error: result.error });

  if (expense) {
    const buyAmt = Number(expense.buyAmount).toLocaleString('vi-VN') + ' ₫';
    const tripPart = expense.tripCode ? ` cho chuyến ${expense.tripCode}` : '';
    const supplierPart = expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : '';
    res.locals.auditEntityKey = `phí ${expense.typeName || 'hộ'} với số tiền chi ${buyAmt}${tripPart}${supplierPart}`;
  }

  res.json({ ok: true });
}));

// POST /api/trips/:id/expenses/:eid/approve — ADMIN/MANAGER/ACCOUNTANT
router.post(
  '/:id/expenses/:eid/approve',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const tripId = parseInt(req.params.id as string, 10);
    const eid = parseInt(req.params.eid as string, 10);
    const result = await processExpenseApproval(tripId, eid, getUser(req).userId, getUser(req).role, 'APPROVED');
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  }),
);

// POST /api/trips/:id/expenses/:eid/reject — ADMIN/MANAGER/ACCOUNTANT
router.post(
  '/:id/expenses/:eid/reject',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const tripId = parseInt(req.params.id as string, 10);
    const eid = parseInt(req.params.eid as string, 10);
    const result = await processExpenseApproval(tripId, eid, getUser(req).userId, getUser(req).role, 'REJECTED');
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
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
