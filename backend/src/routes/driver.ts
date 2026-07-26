import { Router } from 'express';
// auth + Casbin applied at mount point in index.ts
import type { Request, Response } from 'express';
import { getUser } from '../middleware/auth';
import {
  getDriverByUserId,
  getDriverTrips,
  getDriverTripDetail,
  getDriverEarnings,
  getDriverPenalties,
  getDriverVehicleAlerts,
  getDriverTwoOrdersView,
  recordDriverProgress,
  listDriverProgress,
  recordIncidentalCost,
  listIncidentalCosts,
  getDriverPayslipPeriods,
} from '../services/driver.service';
import { createTripContainer, listTripContainers, updateTripContainer, batchUpsertContainerSeals } from '../services/forwarder.service';
import { deleteTripPhotosByType, type TripPhotoType } from './upload';
import { tripContainerSchema, tripContainerPatchSchema, tripContainerSealBatchSchema, driverProgressSchema, driverIncidentalCostSchema } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';

const router = Router();

// List assigned trips (Driver allowlisted DTO)
router.get('/trips', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await getDriverTrips(driver.id);
  res.json({ items });
}));

// M8.3 — two-orders-per-day view: today's active + next trip distinctly,
// with an advisory firstOrderLate flag. Read-only; RBAC inherits the
// driver_portal mount (DRIVER read).
router.get('/two-orders', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const view = await getDriverTwoOrdersView(driver.id);
  res.json(view);
}));

// M8.4 — driver progress events (append-only log). The create path is
// server-side idempotent (Idempotency-Key header) so an offline-queue replay
// (slice 2 frontend) does not duplicate events (PRD M08-04-03). Ownership is
// enforced inside the service (trip.driverId must match the caller).
router.post('/trips/:tripId/progress', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  const parsed = driverProgressSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((i: { message: string }) => i.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const idempotencyKey = req.header('Idempotency-Key') as string | undefined;
  const { event, replayed } = await recordDriverProgress(
    tripId,
    driver.id,
    parsed.data,
    getUser(req).userId,
    idempotencyKey,
  );
  res.status(replayed ? 200 : 201).json(event);
}));

router.get('/trips/:tripId/progress', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await listDriverProgress(tripId, driver.id);
  res.json({ items });
}));

// M8.4 slice 3 — driver incidental costs (per-diem, lift fee, parking, toll,
// fuel, other). Idempotent create (Idempotency-Key header) so the offline-
// queue replay doesn't duplicate. LOCKED trips reject (costs affect financials).
router.post('/trips/:tripId/incidental-costs', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  const parsed = driverIncidentalCostSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((i: { message: string }) => i.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const idempotencyKey = req.header('Idempotency-Key') as string | undefined;
  const { cost, replayed } = await recordIncidentalCost(
    tripId,
    driver.id,
    parsed.data,
    getUser(req).userId,
    idempotencyKey,
  );
  res.status(replayed ? 200 : 201).json(cost);
}));

router.get('/trips/:tripId/incidental-costs', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await listIncidentalCosts(tripId, driver.id);
  res.json({ items });
}));

// M8.6 — driver payslip periods (own issued salary periods with earnings).
// Read-only; RBAC inherits the driver_portal mount (DRIVER read).
router.get('/payslips', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await getDriverPayslipPeriods(driver.id);
  res.json({ items });
}));

// N5 / B4 — vehicle compliance/service reminders for the driver's truck.
// Mounted under driver_portal (DRIVER already has read), so no new Casbin line.
// Always returns 200 with { items: [...] } — an empty list means either no
// truck is resolvable or all dates are 'ok'. The frontend hides the reminder
// section when items is empty.
router.get('/vehicle-alerts', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const alerts = await getDriverVehicleAlerts(driver.id);
  res.json({ items: alerts ?? [] });
}));

// Trip detail (ownership-enforced)
router.get('/trips/:id', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const trip = await getDriverTripDetail(driver.id, parseInt(req.params.id as string, 10));
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  res.json(trip);
}));

// Earnings summary — requires month/year for salary-period scoping
router.get('/earnings', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const month = parseInt(req.query.month as string, 10);
  const year = parseInt(req.query.year as string, 10);
  if (!month || !year || month < 1 || month > 12) {
    throw new ApiError(400, 'Cần có tham số month (1-12) và year');
  }
  res.json(await getDriverEarnings(driver.id, month, year));
}));

// Penalties — optional date_from/date_to for salary-period scoping
router.get('/penalties', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const dateFrom = req.query.dateFrom as string | undefined;
  const dateTo = req.query.dateTo as string | undefined;
  const items = await getDriverPenalties(driver.id, dateFrom, dateTo);
  res.json({ items });
}));

// List containers for the driver's own trip (ownership via getDriverTripDetail)
router.get('/trips/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.id as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  const items = await listTripContainers(tripId);
  res.json({ items });
}));

// Create one container for the driver's own trip — driver confirms/edits the OCR
// result, then saves through this endpoint (numbers are never auto-committed).
router.post('/trips/:tripId/containers', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.tripId as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });

  const parsed = tripContainerSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
  }
  const created = await createTripContainer({
    tripId,
    containerTypeId: parsed.data.containerTypeId ?? null,
    containerNumber: parsed.data.containerNumber,
    sealNumber: parsed.data.sealNumber ?? null,
    cargoWeightKg: parsed.data.cargoWeightKg ?? null,
    notes: parsed.data.notes ?? null,
    createdBy: getUser(req).userId,
    // Phase 2: optional initial seals list (e.g. customs + carrier).
    seals: parsed.data.seals,
  });
  res.status(201).json(created);
}));

// PATCH one of the driver's own containers (Sửa / change number / change seal /
// change type). Ownership is enforced via getDriverTripDetail. The trip must
// not be LOCKED — updateTripContainer enforces that.
router.patch('/trips/:tripId/containers/:containerId', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.tripId as string, 10);
  const containerId = parseInt(req.params.containerId as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  // The container must belong to THIS driver's trip. Ownership above only
  // proves the driver owns `tripId`; without this check a driver who owns any
  // single trip could patch any container row by guessing its id (IDOR).
  if (!trip.containers.some(c => c.id === containerId)) {
    return res.status(404).json({ error: 'Không tìm thấy số cont' });
  }

  const parsed = tripContainerPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
  }

  const updated = await updateTripContainer(containerId, {
    containerTypeId: parsed.data.containerTypeId,
    containerNumber: parsed.data.containerNumber,
    sealNumber: parsed.data.sealNumber,
    cargoWeightKg: parsed.data.cargoWeightKg,
    notes: parsed.data.notes,
    // Phase 2: driver's one-at-a-time seal add flow.
    addSeals: parsed.data.addSeals,
    userId: getUser(req).userId,
  });
  res.json(updated);
}));

// Phase 2: full reconcile of one container's seals. Driver UI sends the
// desired full list; backend matches by id (insert new, update existing,
// delete the rest). Refuses on a LOCKED trip — same guard as PATCH above.
router.put('/trips/:tripId/containers/:containerId/seals', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.tripId as string, 10);
  const containerId = parseInt(req.params.containerId as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  if (!trip.containers.some(c => c.id === containerId)) {
    return res.status(404).json({ error: 'Không tìm thấy số cont' });
  }

  const parsed = tripContainerSealBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
  }
  const seals = await batchUpsertContainerSeals(containerId, parsed.data.seals, getUser(req).userId);
  res.json({ seals });
}));

// Remove all photos of one type (CONTAINER | SEAL) for the driver's own trip —
// the Sửa flow's "remove photo" affordance. Ownership is enforced via
// getDriverTripDetail (same IDOR-safe pattern as the PATCH route above): a
// driver can only touch photos of trips they own. The trip must not be LOCKED,
// mirroring updateTripContainer's guard — a settled trip's evidence is
// immutable. Casbin maps DELETE → a distinct `delete` action, granted to DRIVER
// on driver_portal in policy.csv (separate from `write` so destructive ops are
// never implicitly permitted alongside create/mutate).
router.delete('/trips/:tripId/photos/:type', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.tripId as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });

  const photoType = String(req.params.type).toUpperCase();
  if (photoType !== 'CONTAINER' && photoType !== 'SEAL') {
    return res.status(400).json({ error: 'Loại ảnh không hợp lệ (container hoặc seal)' });
  }

  if (trip.status === 'LOCKED') {
    throw new ApiError(409, 'Không thể xóa ảnh của chuyến đã chốt');
  }

  // Phase 2: optional container_id scopes the delete to one container's
  // photos only. Without it, we wipe ALL of this type (legacy behaviour).
  let containerId: number | undefined;
  const containerIdRaw = req.query.container_id;
  if (containerIdRaw !== undefined && containerIdRaw !== '') {
    containerId = parseInt(String(containerIdRaw), 10);
    if (isNaN(containerId)) {
      return res.status(400).json({ error: 'container_id không hợp lệ' });
    }
    if (!trip.containers.some(c => c.id === containerId)) {
      return res.status(404).json({ error: 'Không tìm thấy số cont' });
    }
  }

  const removed = await deleteTripPhotosByType(tripId, photoType as TripPhotoType, containerId);
  res.json({ ok: true, removed });
}));

export default router;
