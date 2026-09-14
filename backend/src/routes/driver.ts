import { Router } from 'express';
import multer from 'multer';
// auth + Casbin applied at mount point in index.ts
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getUser } from '../middleware/auth';
import {
  assertTripOwnedByDriver,
  completeOwnedFulfillmentTrip,
  getDriverByUserId,
  getDriverFulfillmentDetail,
  getDriverTrips,
  getDriverTripDetail,
  getDriverEarnings,
  getDriverPenalties,
  getDriverVehicle,
  getDriverVehicleAlerts,
  getDriverTwoOrdersView,
  listDriverFulfillmentProgress,
  recordDriverProgress,
  recordDriverFulfillmentProgress,
  syncDriverFulfillmentStartSideEffects,
  listDriverProgress,
  recordIncidentalCost,
  listIncidentalCosts,
  updateDriverTripCostSubmissionNote,
  getDriverPayslipPeriods,
  getCompletionEvidenceStatus,
} from '../services/driver.service';
import {
  extractFuelEvidencePumpValues,
  persistFuelEvidenceReviewForDriver,
  type FuelEvidenceReviewView,
  type PersistFuelEvidenceReviewOutcome,
} from '../services/fuel-evidence-review.service';
import {
  attachPodFile,
  createPodSubmission,
  getDriverPodFileForDownload,
  listPodSubmissionsForDriver,
  submitPod,
} from '../services/trip-pod.service';
import {
  batchUpsertContainerSeals,
  createTripContainerInClient,
  listTripContainers,
  updateTripContainerInClient,
} from '../services/forwarder-container.service';
import type { TripPhotoType } from './upload';
import {
  driverIncidentalCostSchema,
  driverCostSubmissionNoteSchema,
  driverProgressSchema,
  DriverProgressEventType,
  TripPodFileType,
  tripContainerSealBatchSchema,
  validatedTripContainerSchema, validatedTripContainerPatchSchema, normalizeContainerNumber,
} from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import * as s from '../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { sniffImageType } from '../lib/format';
import { getRequestIdempotencyKey } from './utils/idempotency';
import {
  findIdempotencyRecord,
  runIdempotent,
  waitForIdempotencyRecord,
} from '../services/idempotency.service';
import type { Tx } from '../services/trip-shared';
import { getDriverJourneyBoard } from '../services/driver-journey-board.service';
import { runWithAuditRequestContext } from '../services/audit.service';
import {
  armStorageCleanupGuard,
  cancelStorageCleanupGuard,
  enqueueStorageDelete,
  releaseStorageCleanupGuard,
  STORAGE_DELETE_MODE,
  type StorageCleanupGuardLease,
} from '../services/durable-effect.service';
import { storageService } from '../services/storage.service';

const router = Router();

const DRIVER_IDEMPOTENCY_ENDPOINTS = {
  CONTAINER_CREATE: 'driver.containers.create',
  CONTAINER_UPDATE: 'driver.containers.update',
  CONTAINER_SEALS_REPLACE: 'driver.containers.seals.replace',
  PHOTO_DELETE: 'driver.trip-photos.delete',
  FUEL_EVIDENCE_CREATE: 'driver.fuel-evidence.create',
} as const;

const podUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const fuelEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

let fuelEvidenceAfterUploadHookForTest: null | (() => void | Promise<void>) = null;

export function setDriverFuelEvidenceAfterUploadHookForTest(
  hook: null | (() => void | Promise<void>),
) {
  fuelEvidenceAfterUploadHookForTest = hook;
}

const driverFulfillmentProgressSchema = driverProgressSchema.extend({
  expectedVersion: z.coerce.number().int().positive(),
});

const driverFulfillmentVersionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

const driverPodFileAttachSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  fileType: z.nativeEnum(TripPodFileType),
});

const driverFuelEvidenceMetadataSchema = z.object({
  lat: z.coerce.number().finite().optional(),
  lng: z.coerce.number().finite().optional(),
  accuracy: z.coerce.number().finite().optional(),
  altitude: z.coerce.number().finite().optional(),
  gpsAt: z.coerce.number().int().positive().optional(),
  source: z.string().trim().max(20).optional(),
  sampleCount: z.coerce.number().int().positive().optional(),
  bestAccuracy: z.coerce.number().finite().optional(),
  elapsedMs: z.coerce.number().int().nonnegative().optional(),
});

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

function requireDriverIdempotencyKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác hiện trường này.');
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

function formatDecimal(value: number | undefined): string | null {
  return value == null || !Number.isFinite(value) ? null : String(value);
}

function fuelEvidenceExtensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  return 'jpg';
}

async function acquireDriverFuelEvidenceCleanupGuard(args: {
  idempotencyKey: string;
  storageKey: string;
  tripId: number;
  driverId: number;
}): Promise<StorageCleanupGuardLease | null> {
  const endpoint = DRIVER_IDEMPOTENCY_ENDPOINTS.FUEL_EVIDENCE_CREATE;
  const existingIdempotency = await findIdempotencyRecord(endpoint, args.idempotencyKey);
  if (existingIdempotency) return null;
  const storageKeyHash = createHash('sha256').update(args.storageKey).digest('hex').slice(0, 32);
  try {
    return await armStorageCleanupGuard({
      dedupeKey: `driver-fuel-evidence-orphan:${args.driverId}:${storageKeyHash}:${args.idempotencyKey}`,
      storageKey: args.storageKey,
      entityType: 'fuel_evidence_reviews',
      entityId: args.tripId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('storage cleanup guard already leased')) {
      const committed = await waitForIdempotencyRecord(endpoint, args.idempotencyKey);
      if (committed) return null;
      throw new ApiError(409, 'Ảnh nhiên liệu đang được xử lý. Vui lòng thử lại.');
    }
    throw error;
  }
}

async function releaseDriverFuelEvidenceCleanupGuard(
  lease: StorageCleanupGuardLease | null,
  error: unknown,
): Promise<void> {
  if (!lease) return;
  try {
    await releaseStorageCleanupGuard(lease, error);
  } catch (releaseError) {
    console.warn(
      `[driver.fuel-evidence.create] failed to release cleanup guard ${lease.dedupeKey}:`,
      releaseError instanceof Error ? releaseError.message : releaseError,
    );
  }
}

function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const expected = readExpectedUpdatedAt(req);
  if (!expected) throw new ApiError(428, message);
  return expected;
}

type DriverTripPhotoDeleteCommand = {
  ok: true;
  removed: number;
  storageKeys: string[];
};

function hashStorageKey(storageKey: string): string {
  return createHash('sha256').update(storageKey).digest('hex').slice(0, 32);
}

async function deleteDriverTripPhotosCommand(
  client: Tx,
  tripId: number,
  type: TripPhotoType,
  containerId: number | undefined,
  expectedUpdatedAt: Date | undefined,
): Promise<DriverTripPhotoDeleteCommand> {
  const conditions = [eq(s.tripPhotos.tripId, tripId), eq(s.tripPhotos.type, type)];
  if (containerId !== undefined) {
    conditions.push(eq(s.tripPhotos.tripContainerId, containerId));
  }
  const rows = await client.select({
    id: s.tripPhotos.id,
    storageKey: s.tripPhotos.storageKey,
    uploadedAt: s.tripPhotos.uploadedAt,
  })
    .from(s.tripPhotos)
    .where(and(...conditions))
    .orderBy(s.tripPhotos.uploadedAt)
    .for('update');

  if (rows.length === 0) {
    return { ok: true, removed: 0, storageKeys: [] };
  }

  const latest = rows[rows.length - 1];
  if (expectedUpdatedAt && latest.uploadedAt.getTime() !== expectedUpdatedAt.getTime()) {
    throw new ApiError(409, 'Ảnh bằng chứng đã thay đổi. Vui lòng tải lại chuyến trước khi xóa.');
  }

  for (const row of rows) {
    await enqueueStorageDelete(client, {
      dedupeKey: `driver-trip-photo-final:${row.id}:${hashStorageKey(row.storageKey)}`,
      payload: {
        storageKey: row.storageKey,
        mode: STORAGE_DELETE_MODE.FINAL_DELETE,
        entityType: 'trip_photos',
        entityId: row.id,
      },
    });
  }

  await client.delete(s.tripPhotos)
    .where(inArray(s.tripPhotos.id, rows.map((row) => row.id)));

  return {
    ok: true,
    removed: rows.length,
    storageKeys: rows.map((row) => row.storageKey),
  };
}

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

// Driver-app "Hành trình" screen (260827): New Orders / Running / History
// tabs, one Layer-1 summary card per fulfillment. See
// services/driver-journey-board.service.ts for why this is separate from
// the shared driverWorkInbox query.
router.get('/journey-board', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  res.json(await getDriverJourneyBoard(driver.id));
}));

// Driver-app topbar identity chip (260828): the driver's current vehicle
// plate shown next to their name. Shares the truck resolution with the
// vehicle-alerts read, so the header and the reminders agree on which truck
// is "the driver's xe". `null` plate when no truck is resolvable; the
// frontend hides the chip.
router.get('/vehicle', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const vehicle = await getDriverVehicle(driver.id);
  res.json(vehicle);
}));

router.get('/fulfillments/:fulfillmentId', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const detail = await getDriverFulfillmentDetail(driver.id, fulfillmentId);
  res.json(detail);
}));

router.get('/fulfillments/:fulfillmentId/progress', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await listDriverFulfillmentProgress(fulfillmentId, driver.id);
  res.json({ items });
}));

router.post('/fulfillments/:fulfillmentId/progress', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const parsed = driverFulfillmentProgressSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const idempotencyKey = req.header('Idempotency-Key') as string | undefined;
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    'driver.progress',
    () => recordDriverFulfillmentProgress({
      fulfillmentId,
      driverId: driver.id,
      input: parsed.data,
      recordedBy: getUser(req).userId,
      idempotencyKey,
    }),
  );
  if (!outcome.replayed && parsed.data.eventType === DriverProgressEventType.ORDER_RECEIVED) {
    await syncDriverFulfillmentStartSideEffects({
      fulfillmentId,
      driverId: driver.id,
      recordedBy: getUser(req).userId,
    });
  }
  res.status(outcome.replayed ? 200 : 201).json(outcome.event);
}));

router.get('/fulfillments/:fulfillmentId/evidence-status', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const detail = await getDriverFulfillmentDetail(driver.id, fulfillmentId);
  res.json(detail.evidenceStatus);
}));

router.get('/fulfillments/:fulfillmentId/pod', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await listPodSubmissionsForDriver(driver.id, fulfillmentId);
  res.json({ items });
}));

router.post('/fulfillments/:fulfillmentId/pod', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const parsed = driverFulfillmentVersionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const submission = await withMaterialWriteAuditContext(
    req,
    res,
    'trips.pod.create',
    () => createPodSubmission({
      driverId: driver.id,
      actorUserId: getUser(req).userId,
      fulfillmentId,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: requireDriverIdempotencyKey(req),
    }),
  );
  res.status(submission.replayed ? 200 : 201).json(submission.submission);
}));

router.post('/fulfillments/:fulfillmentId/pod/:submissionId/files', podUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  const submissionId = parseInt(req.params.submissionId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    throw new ApiError(400, 'ID phiên bản e-POD không hợp lệ');
  }
  const parsed = driverPodFileAttachSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const file = req.file;
  if (!file) {
    throw new ApiError(400, 'Cần chọn tệp e-POD để tải lên.');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const submission = await withMaterialWriteAuditContext(
    req,
    res,
    'trips.pod.files.attach',
    () => attachPodFile({
      driverId: driver.id,
      actorUserId: getUser(req).userId,
      fulfillmentId,
      submissionId,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: requireDriverIdempotencyKey(req),
      fileType: parsed.data.fileType,
      file,
    }),
  );
  res.json(submission.submission);
}));

router.post('/fulfillments/:fulfillmentId/pod/:submissionId/submit', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  const submissionId = parseInt(req.params.submissionId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    throw new ApiError(400, 'ID phiên bản e-POD không hợp lệ');
  }
  const parsed = driverFulfillmentVersionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const submission = await withMaterialWriteAuditContext(
    req,
    res,
    'trips.pod.submit',
    () => submitPod({
      driverId: driver.id,
      actorUserId: getUser(req).userId,
      fulfillmentId,
      submissionId,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: requireDriverIdempotencyKey(req),
    }),
  );
  res.json(submission.submission);
}));

router.get('/fulfillments/:fulfillmentId/pod-files/:fileId', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  const fileId = parseInt(req.params.fileId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw new ApiError(400, 'ID tệp e-POD không hợp lệ');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const file = await getDriverPodFileForDownload({
    driverId: driver.id,
    fulfillmentId,
    fileId,
  });
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename=\"${encodeURIComponent(file.originalFileName)}\"`);
  res.send(file.buffer);
}));

router.post('/fulfillments/:fulfillmentId/complete', asyncHandler(async (req: Request, res: Response) => {
  const fulfillmentId = parseInt(req.params.fulfillmentId as string, 10);
  if (!Number.isInteger(fulfillmentId) || fulfillmentId <= 0) {
    throw new ApiError(400, 'ID tác vụ không hợp lệ');
  }
  const parsed = driverFulfillmentVersionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    'driver.fulfillment.complete',
    () => completeOwnedFulfillmentTrip({
      fulfillmentId,
      driverId: driver.id,
      actorUserId: getUser(req).userId,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: requireDriverIdempotencyKey(req),
    }),
  );
  res.json(outcome.trip);
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
// queue replay doesn't duplicate. COMPLETED trips reject (costs affect financials).
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

// 27.8 cost-section Ghi chú — driver-written note for accounting to re-check
// auto-recorded costs (Tiền đường, Phí Lạch Huyện). Idempotent upsert.
router.put('/trips/:tripId/cost-submission-note', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  const parsed = driverCostSubmissionNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues.map((i: { message: string }) => i.message).join('; '));
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  const result = await updateDriverTripCostSubmissionNote(tripId, driver.id, parsed.data.note);
  res.json(result);
}));

router.post('/trips/:tripId/fuel-evidence', fuelEvidenceUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) {
    throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  }
  const driver = await getDriverByUserId(getUser(req).userId);
  await assertTripOwnedByDriver(tripId, driver.id);

  if (!req.file || req.file.size <= 0) {
    throw new ApiError(400, 'Cần tải lên ảnh màn hình bơm.');
  }
  const mimeType = sniffImageType(req.file.buffer);
  if (!mimeType) {
    throw new ApiError(400, 'Ảnh nhiên liệu phải là JPEG, PNG, WEBP hoặc HEIC hợp lệ.');
  }
  const parsedMeta = driverFuelEvidenceMetadataSchema.safeParse(req.body ?? {});
  if (!parsedMeta.success) {
    throw new ApiError(400, parsedMeta.error.issues.map((issue) => issue.message).join('; '));
  }

  const metadata = parsedMeta.data;
  const idempotencyKey = requireDriverIdempotencyKey(req);
  const storageHash = createHash('sha256').update(req.file.buffer).digest('hex');
  const requestHash = createHash('sha256')
    .update(`driver-fuel-evidence:${driver.id}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  const storageKey = [
    'fuel-evidence',
    String(tripId),
    String(driver.id),
    `${storageHash}-${requestHash}.${fuelEvidenceExtensionForMime(mimeType)}`,
  ].join('/');
  const cleanupGuard = await acquireDriverFuelEvidenceCleanupGuard({
    idempotencyKey,
    storageKey,
    tripId,
    driverId: driver.id,
  });

  let ocr: Awaited<ReturnType<typeof extractFuelEvidencePumpValues>> | null = null;
  if (cleanupGuard) {
    try {
      await storageService.upload(req.file.buffer, storageKey);
      if (fuelEvidenceAfterUploadHookForTest) {
        await fuelEvidenceAfterUploadHookForTest();
      }
      ocr = await extractFuelEvidencePumpValues(req.file.buffer, mimeType);
    } catch (error) {
      await releaseDriverFuelEvidenceCleanupGuard(cleanupGuard, error);
      throw error;
    }
  }

  try {
    const outcome = await withMaterialWriteAuditContext(
      req,
      res,
      DRIVER_IDEMPOTENCY_ENDPOINTS.FUEL_EVIDENCE_CREATE,
      () => runIdempotent<PersistFuelEvidenceReviewOutcome>({
        endpoint: DRIVER_IDEMPOTENCY_ENDPOINTS.FUEL_EVIDENCE_CREATE,
        idempotencyKey,
        payload: {
          tripId,
          driverId: driver.id,
          storageHash,
        },
        createdBy: getUser(req).userId,
        responseStatusCode: 201,
        create: async (tx) => {
          if (!cleanupGuard || !ocr) {
            throw new ApiError(409, 'Ảnh nhiên liệu đang được xử lý. Vui lòng thử lại.');
          }
          const persisted = await persistFuelEvidenceReviewForDriver({
            tripId,
            ownerDriverId: driver.id,
            ownerUserId: getUser(req).userId,
            storageKey,
            storageHash,
            originalFileName: req.file?.originalname ?? null,
            mimeType,
            sizeBytes: req.file?.size ?? req.file?.buffer.length ?? 0,
            capturedAt: new Date(),
            latitude: formatDecimal(metadata.lat),
            longitude: formatDecimal(metadata.lng),
            gpsAccuracy: formatDecimal(metadata.accuracy),
            gpsAltitude: formatDecimal(metadata.altitude),
            gpsAt: metadata.gpsAt ? new Date(metadata.gpsAt) : null,
            geotagSource: metadata.source ?? null,
            geotagSampleCount: metadata.sampleCount ?? null,
            geotagBestAccuracy: formatDecimal(metadata.bestAccuracy),
            geotagElapsedMs: metadata.elapsedMs ?? null,
            ocr,
            createdBy: getUser(req).userId,
          }, tx);
          if (persisted.ownsStorageKey) {
            const cancelled = await cancelStorageCleanupGuard(tx, cleanupGuard);
            if (!cancelled) {
              throw new ApiError(409, 'Ảnh nhiên liệu đang được xử lý. Vui lòng thử lại.');
            }
          }
          return persisted;
        },
        getEntityId: (value) => value.review.id,
        serializeResult: (value) => value.review,
        deserializeResult: (snapshot) => ({
          review: snapshot as FuelEvidenceReviewView,
          ownsStorageKey: false,
        }),
      }),
    );

    if (cleanupGuard && !outcome.result.ownsStorageKey) {
      await releaseDriverFuelEvidenceCleanupGuard(
        cleanupGuard,
        new Error('duplicate fuel evidence content uses the existing durable image'),
      );
    }
    res.status(outcome.statusCode).json(outcome.result.review);
  } catch (error) {
    await releaseDriverFuelEvidenceCleanupGuard(cleanupGuard, error);
    throw error;
  }
}));

// M8.6 — driver payslip periods (own issued salary periods with earnings).
// Read-only; RBAC inherits the driver_portal mount (DRIVER read).
router.get('/payslips', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const items = await getDriverPayslipPeriods(driver.id);
  res.json({ items });
}));

// M8.4 slice 4 — advisory evidence-readiness check before completion. Returns
// the list of missing recommended evidence (photos, DEPARTED, ARRIVED).
// Advisory only — never blocks (open §3 question resolved as advisory).
router.get('/trips/:tripId/evidence-status', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isInteger(tripId) || tripId <= 0) throw new ApiError(400, 'ID chuyến đi không hợp lệ');
  const driver = await getDriverByUserId(getUser(req).userId);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  const status = await getCompletionEvidenceStatus(tripId);
  res.json(status);
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

  const parsed = validatedTripContainerSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
  }
  // Canonical number everywhere: storage AND the idempotency fingerprint —
  // equivalent-but-differently-formatted retries must dedupe.
  const containerNumber = normalizeContainerNumber(parsed.data.containerNumber ?? '');
  const idempotencyKey = requireDriverIdempotencyKey(req);
  const outcome = await runIdempotent({
    endpoint: DRIVER_IDEMPOTENCY_ENDPOINTS.CONTAINER_CREATE,
    idempotencyKey,
    payload: { driverId: driver.id, ...parsed.data, containerNumber },
    createdBy: getUser(req).userId,
    responseStatusCode: 201,
    create: (tx) => createTripContainerInClient(tx, {
      tripId,
      containerTypeId: parsed.data.containerTypeId ?? null,
      containerNumber,
      sealNumber: parsed.data.sealNumber ?? null,
      cargoWeightKg: parsed.data.cargoWeightKg ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: getUser(req).userId,
      seals: parsed.data.seals,
    }),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

// PATCH one of the driver's own containers (Sửa / change number / change seal /
// change type). Ownership is enforced via getDriverTripDetail. The trip must
// not be COMPLETED — updateTripContainer enforces that.
router.patch('/trips/:tripId/containers/:containerId', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.tripId as string, 10);
  const containerId = parseInt(req.params.containerId as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  // The container must belong to THIS driver's trip. Ownership above only
  // proves the driver owns `tripId`; without this check a driver who owns any
  // single trip could patch any container row by guessing its id (IDOR).
  if (!trip.containers.some((c: { id: number }) => c.id === containerId)) {
    return res.status(404).json({ error: 'Không tìm thấy số cont' });
  }

  const parsed = validatedTripContainerPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
  }
  const idempotencyKey = requireDriverIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản số cont mới nhất trước khi cập nhật.',
  );
  const outcome = await runIdempotent({
    endpoint: DRIVER_IDEMPOTENCY_ENDPOINTS.CONTAINER_UPDATE,
    idempotencyKey,
    payload: {
      tripId,
      containerId,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      ...parsed.data,
      // Canonical fingerprint: retries with equivalent formatting dedupe.
      ...(parsed.data.containerNumber != null && parsed.data.containerNumber.trim()
        ? { containerNumber: normalizeContainerNumber(parsed.data.containerNumber) }
        : {}),
    },
    createdBy: getUser(req).userId,
    responseStatusCode: 200,
    create: (tx) => updateTripContainerInClient(tx, containerId, {
      containerTypeId: parsed.data.containerTypeId,
      containerNumber: parsed.data.containerNumber != null && parsed.data.containerNumber.trim()
        ? normalizeContainerNumber(parsed.data.containerNumber)
        : parsed.data.containerNumber,
      sealNumber: parsed.data.sealNumber,
      cargoWeightKg: parsed.data.cargoWeightKg,
      notes: parsed.data.notes,
      addSeals: parsed.data.addSeals,
      userId: getUser(req).userId,
    }, { expectedUpdatedAt }),
  });
  res.json(outcome.result);
}));

// Phase 2: full reconcile of one container's seals. Driver UI sends the
// desired full list; backend matches by id (insert new, update existing,
// delete the rest). Refuses on a COMPLETED trip — same guard as PATCH above.
router.put('/trips/:tripId/containers/:containerId/seals', asyncHandler(async (req: Request, res: Response) => {
  const driver = await getDriverByUserId(getUser(req).userId);
  const tripId = parseInt(req.params.tripId as string, 10);
  const containerId = parseInt(req.params.containerId as string, 10);
  const trip = await getDriverTripDetail(driver.id, tripId);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  if (!trip.containers.some((c: { id: number }) => c.id === containerId)) {
    return res.status(404).json({ error: 'Không tìm thấy số cont' });
  }

  const parsed = tripContainerSealBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: parsed.error.flatten() });
  }
  const idempotencyKey = requireDriverIdempotencyKey(req);
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản số cont mới nhất trước khi thay niêm phong.',
  );
  const outcome = await runIdempotent({
    endpoint: DRIVER_IDEMPOTENCY_ENDPOINTS.CONTAINER_SEALS_REPLACE,
    idempotencyKey,
    payload: {
      tripId,
      containerId,
      expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      seals: parsed.data.seals,
    },
    createdBy: getUser(req).userId,
    responseStatusCode: 200,
    create: (tx) => batchUpsertContainerSeals(
      containerId,
      parsed.data.seals,
      getUser(req).userId,
      { expectedUpdatedAt },
      tx,
    ),
  });
  res.json(outcome.result);
}));

// Remove all photos of one type (CONTAINER | SEAL) for the driver's own trip —
// the Sửa flow's "remove photo" affordance. Ownership is enforced via
// getDriverTripDetail (same IDOR-safe pattern as the PATCH route above): a
// driver can only touch photos of trips they own. The trip must not be COMPLETED,
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

  if (trip.status === 'COMPLETED') {
    throw new ApiError(409, 'Không thể xóa ảnh của chuyến đã hoàn thành');
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
    if (!trip.containers.some((c: { id: number }) => c.id === containerId)) {
      return res.status(404).json({ error: 'Không tìm thấy số cont' });
    }
  }
  const idempotencyKey = requireDriverIdempotencyKey(req);
  // 2026-09-11 user directive: the version precondition on photo delete is
  // removed — deletes always proceed. Ownership (getDriverTripDetail), the
  // COMPLETED block, the type check, and idempotency stay; the command
  // already treats an absent expectedUpdatedAt as "skip the staleness check".
  const outcome = await runIdempotent({
    endpoint: DRIVER_IDEMPOTENCY_ENDPOINTS.PHOTO_DELETE,
    idempotencyKey,
    payload: {
      tripId,
      photoType,
      containerId: containerId ?? null,
    },
    createdBy: getUser(req).userId,
    responseStatusCode: 200,
    create: (tx) => deleteDriverTripPhotosCommand(
      tx,
      tripId,
      photoType as TripPhotoType,
      containerId,
      undefined,
    ),
  });
  res.json({ ok: true, removed: outcome.result.removed });
}));

export default router;
