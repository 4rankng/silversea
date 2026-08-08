import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import crypto from 'crypto';
import sharp from 'sharp';
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
// auth + Casbin applied at mount point in index.ts
import { Role } from '@tingting/shared';
import { storageService } from '../services/storage.service';
import { authorizeExpensePhoto } from '../services/photo-authz.service';
import { config } from '../config';
import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { sniffImageType } from '../lib/format';
import { ApiError } from '../errors';
import { getRequestIdempotencyKey } from './utils/idempotency';
import {
  IDEMPOTENCY_ENDPOINTS,
  findIdempotencyRecord,
  runIdempotent,
  waitForIdempotencyRecord,
} from '../services/idempotency.service';
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
import { assertTripShipmentAccountingUnlocked } from '../services/shipment-accounting-lock.service';

// Maximum dimension for server-side downscale
const MAX_IMAGE_DIMENSION = 2048;
let tripPhotoAfterUploadHookForTest: null | (() => void | Promise<void>) = null;

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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

export type TripPhotoType = 'CONTAINER' | 'SEAL' | 'OTHER';
type UploadTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SaveTripPhotoOptions {
  /** Use the OCR-optimised pipeline (auto-contrast + JPEG q95) instead of the
   * default q85 pipeline. The processed buffer is returned so the OCR route can
   * reuse it for recognition instead of re-running sharp. */
  forOcr?: boolean;
  /** Phase 2: optional container row to link this photo to. The container
   *  must belong to `tripId`. Null/undefined leaves the photo at trip level
   *  (legacy behaviour), which is also the fallback for older callers. */
  containerId?: number | null;
  /** Stable command identity used to converge retries on one object/row. */
  storageKeySeed?: string;
  /** Use the caller's transaction so the photo row shares the same commit boundary. */
  tx?: UploadTx;
}

export function setTripPhotoAfterUploadHookForTest(
  hook: null | (() => void | Promise<void>),
) {
  tripPhotoAfterUploadHookForTest = hook;
}

export interface SavedTripPhoto {
  id: number;
  storageKey: string;
  url: string;
  buffer: Buffer;
  mimeType: string;
}

export interface PreparedTripPhoto {
  buffer: Buffer;
  mimeType: string;
  storageKey: string;
  url: string;
}

interface PreparedCompanyLogo {
  buffer: Buffer;
  storageKey: string;
  url: string;
}

/**
 * Sniff → sharp preprocess → storage → insert trip_photos row.
 *
 * Storage key keeps the `container-` / `seal-` prefix so the frontend's
 * `mapUrlsToPhotos` heuristic can categorise the photo by URL.
 *
 * Scoped to trip photos only (the expense-photo pipeline in forwarder.ts uses a
 * different table/key shape and is intentionally not merged here).
 */
export async function prepareTripPhoto(
  file: { buffer: Buffer },
  tripId: number,
  type: TripPhotoType,
  opts: SaveTripPhotoOptions = {},
): Promise<PreparedTripPhoto> {
  const mime = sniffImageType(file.buffer);
  if (!mime) {
    throw new ApiError(400, 'Định dạng file không được hỗ trợ hoặc file bị hỏng');
  }

  let processedBuffer: Buffer;
  let ext: string;

  if (opts.forOcr) {
    // OCR pipeline: downscale + auto-contrast so text stands out for the VLM.
    processedBuffer = await sharp(file.buffer)
      .rotate() // auto-orient from EXIF, then strip
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .normalise() // auto-contrast (helps faded/night/shadowed paint)
      .jpeg({ quality: 95 })
      .toBuffer();
    ext = '.jpg';
  } else if (mime === 'image/heic') {
    // Transcode HEIC to JPEG
    processedBuffer = await sharp(file.buffer)
      .rotate()
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    ext = '.jpg';
  } else {
    // JPEG/PNG/WebP: strip EXIF + downscale, keep format
    const pipeline = sharp(file.buffer)
      .rotate()
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .withMetadata({ orientation: undefined });

    if (mime === 'image/jpeg') {
      processedBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
      ext = '.jpg';
    } else if (mime === 'image/png') {
      processedBuffer = await pipeline.png().toBuffer();
      ext = '.png';
    } else {
      processedBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
      ext = '.webp';
    }
  }

  const uuid = opts.storageKeySeed
    ? crypto.createHash('sha256').update(opts.storageKeySeed).digest('hex').slice(0, 32)
    : crypto.randomUUID();
  const storageKey = `trips/${tripId}/${type.toLowerCase()}-${uuid}${ext}`;
  return {
    buffer: processedBuffer,
    mimeType: opts.forOcr ? 'image/jpeg' : mime,
    storageKey,
    url: `/api/photos/${encodeURIComponent(storageKey)}`,
  };
}

async function findTripPhotoByStorageKey(
  executor: typeof db | UploadTx,
  storageKey: string,
): Promise<{ id: number } | null> {
  const [existing] = await executor.select({ id: s.tripPhotos.id })
    .from(s.tripPhotos)
    .where(eq(s.tripPhotos.storageKey, storageKey))
    .limit(1);
  return existing ?? null;
}

export async function insertTripPhotoRecord(
  executor: typeof db | UploadTx,
  input: {
    tripId: number;
    type: TripPhotoType;
    storageKey: string;
    userId: number;
    containerId?: number | null;
  },
): Promise<number> {
  if (executor === db) {
    return db.transaction((tx) => insertTripPhotoRecord(tx, input));
  }
  await assertTripShipmentAccountingUnlocked(executor as UploadTx, input.tripId);
  const existing = await findTripPhotoByStorageKey(executor, input.storageKey);
  if (existing) return existing.id;
  const [created] = await executor.insert(s.tripPhotos).values({
    tripId: input.tripId,
    type: input.type,
    storageKey: input.storageKey,
    uploadedBy: input.userId,
    tripContainerId: input.containerId ?? null,
  }).returning({ id: s.tripPhotos.id });
  return created.id;
}

function hashStorageKey(storageKey: string): string {
  return crypto.createHash('sha256').update(storageKey).digest('hex').slice(0, 32);
}

function buildFinalDeleteDedupeKey(prefix: string, rowId: number, storageKey: string): string {
  return `${prefix}:${rowId}:${hashStorageKey(storageKey)}`;
}

async function enqueueTripPhotoFinalDelete(
  tx: UploadTx,
  rowId: number,
  storageKey: string,
  dedupePrefix: string,
): Promise<void> {
  await enqueueStorageDelete(tx, {
    dedupeKey: buildFinalDeleteDedupeKey(dedupePrefix, rowId, storageKey),
    payload: {
      storageKey,
      mode: STORAGE_DELETE_MODE.FINAL_DELETE,
      entityType: 'trip_photos',
      entityId: rowId,
    },
  });
}

async function acquireUploadCleanupGuard(args: {
  endpoint: string;
  idempotencyKey: string;
  dedupeKey: string;
  storageKey: string;
  entityType: string;
  entityId?: number;
}): Promise<StorageCleanupGuardLease | null> {
  const existingIdempotency = await findIdempotencyRecord(args.endpoint, args.idempotencyKey);
  if (existingIdempotency) return null;
  try {
    return await armStorageCleanupGuard({
      dedupeKey: args.dedupeKey,
      storageKey: args.storageKey,
      entityType: args.entityType,
      entityId: args.entityId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('storage cleanup guard already leased')
      || message.includes('storage cleanup guard already closed')
    ) {
      const committed = await waitForIdempotencyRecord(args.endpoint, args.idempotencyKey);
      if (committed) return null;
      throw new ApiError(409, 'Tệp đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
    }
    throw error;
  }
}

async function releaseUploadCleanupGuard(
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

/**
 * Remove every `trip_photos` row of a given (tripId, type) — the driver Sửa
 * flow's "remove photo" affordance. Storage files are deleted best-effort (a
 * missing/unreadable file is logged, not fatal) and the rows are removed via
 * Drizzle. Returns the count removed.
 *
 * `contPhotoKey`/`sealPhotoKey` resolve to the LATEST photo of a type, so
 * clearing ALL rows of that type is what actually makes the thumbnail
 * disappear — deleting only the latest would just resurface the previous one.
 */
export async function deleteTripPhotosByType(
  tripId: number,
  type: TripPhotoType,
  /**
   * Phase 2: when provided, scope the delete to only photos linked to this
   * specific container row (via trip_photos.trip_container_id). When omitted,
   * deletes ALL photos of this type for the trip — the legacy "remove all"
   * behaviour, which is what the editor's "Xoá ảnh" affordance expects.
   */
  containerId?: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    const conditions = [eq(s.tripPhotos.tripId, tripId), eq(s.tripPhotos.type, type)];
    if (containerId !== undefined) {
      conditions.push(eq(s.tripPhotos.tripContainerId, containerId));
    }
    const rows = await tx.select({ id: s.tripPhotos.id, storageKey: s.tripPhotos.storageKey })
      .from(s.tripPhotos)
      .where(and(...conditions))
      .for('update');
    if (rows.length === 0) return 0;
    for (const row of rows) {
      await enqueueTripPhotoFinalDelete(tx, row.id, row.storageKey, 'trip-photo-final');
    }
    await tx.delete(s.tripPhotos)
      .where(inArray(s.tripPhotos.id, rows.map((row) => row.id)));
    return rows.length;
  });
}

export async function deleteTripPhotoByStorageKey(
  tripId: number,
  type: TripPhotoType,
  storageKey: string,
  containerId?: number,
): Promise<number> {
  const buildConditions = (withContainer: boolean) => {
    const c = [
      eq(s.tripPhotos.tripId, tripId),
      eq(s.tripPhotos.type, type),
      eq(s.tripPhotos.storageKey, storageKey),
    ];
    if (withContainer && containerId !== undefined) {
      c.push(eq(s.tripPhotos.tripContainerId, containerId));
    }
    return c;
  };

  const row = await db.transaction(async (tx) => {
    await assertTripShipmentAccountingUnlocked(tx, tripId);
    let [locked] = await tx.select({
      id: s.tripPhotos.id,
      storageKey: s.tripPhotos.storageKey,
    })
      .from(s.tripPhotos)
      .where(and(...buildConditions(true)))
      .limit(1)
      .for('update');
    // A container scope was requested but matched nothing: the photo may be a
    // legacy unscoped row. Retry without the container filter while retaining
    // the trip/type/storage-key boundary.
    if (!locked && containerId !== undefined) {
      [locked] = await tx.select({
        id: s.tripPhotos.id,
        storageKey: s.tripPhotos.storageKey,
      })
        .from(s.tripPhotos)
        .where(and(...buildConditions(false)))
        .limit(1)
        .for('update');
    }
    if (!locked) return null;
    await enqueueTripPhotoFinalDelete(tx, locked.id, locked.storageKey, 'trip-photo-final');
    await tx.delete(s.tripPhotos).where(eq(s.tripPhotos.id, locked.id));
    return locked;
  });
  if (!row) return 0;
  return 1;
}

const uploadRouter = Router();

function requireUploadIdempotencyKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) throw new ApiError(400, 'Idempotency-Key là bắt buộc khi thay đổi tệp.');
  return key;
}

function hashUpload(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Save the company logo. Stored under a dedicated `company-assets/` prefix
 * (no DB row — the storage key lives in app_settings as company.logo_storage_key),
 * normalized to PNG so ExcelJS can embed it into the xlsx (webp isn't supported
 * by addImage). PUT /api/config/company-info persists the returned storageKey.
 */
async function prepareCompanyLogo(
  file: { buffer: Buffer },
  storageKeySeed?: string,
): Promise<PreparedCompanyLogo> {
  const mime = sniffImageType(file.buffer);
  if (!mime) {
    throw new ApiError(400, 'Định dạng file không được hỗ trợ hoặc file bị hỏng');
  }
  const buffer = await sharp(file.buffer)
    .rotate()
    .resize(640, 320, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const uuid = storageKeySeed
    ? crypto.createHash('sha256').update(storageKeySeed).digest('hex').slice(0, 32)
    : crypto.randomUUID();
  const storageKey = `company-assets/logo-${uuid}.png`;
  return {
    buffer,
    storageKey,
    url: `/api/photos/${encodeURIComponent(storageKey)}`,
  };
}

// Company logo upload. Mirrors the config router role gate (config.ts): DRIVER
// and FORWARDER cannot set the company identity. The storage key is persisted
// to app_settings via PUT /api/config/company-info.
uploadRouter.post('/company-logo', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const role = getUser(req).role;
  if (role === Role.DRIVER || role === Role.OPS) {
    return res.status(403).json({ error: 'Không có quyền tải logo công ty' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Không có file tải lên' });
  const user = getUser(req);
  const idempotencyKey = requireUploadIdempotencyKey(req);
  const created = await prepareCompanyLogo(file, `company-logo:${user.userId}:${idempotencyKey}`);
  const cleanupGuard = await acquireUploadCleanupGuard({
    endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_COMPANY_LOGO,
    idempotencyKey,
    dedupeKey: `company-logo-orphan:${user.userId}:${hashStorageKey(created.storageKey)}:${idempotencyKey}`,
    storageKey: created.storageKey,
    entityType: 'company_logo',
  });
  if (cleanupGuard) {
    try {
      await storageService.upload(created.buffer, created.storageKey);
    } catch (error) {
      await releaseUploadCleanupGuard(cleanupGuard, error, 'upload.company-logo');
      throw error;
    }
  }
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    IDEMPOTENCY_ENDPOINTS.UPLOAD_COMPANY_LOGO,
    () => runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_COMPANY_LOGO,
      idempotencyKey,
      payload: { fileHash: hashUpload(file.buffer) },
      createdBy: user.userId,
      entityType: 'COMPANY_LOGO',
      responseStatusCode: 201,
      create: async (tx) => {
        if (!cleanupGuard) {
          throw new ApiError(409, 'Tệp đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
        }
        const cancelled = await cancelStorageCleanupGuard(tx, cleanupGuard);
        if (!cancelled) {
          throw new ApiError(409, 'Tệp đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
        }
        return { storageKey: created.storageKey, url: created.url };
      },
      onTransactionRollback: async (error) => {
        await releaseUploadCleanupGuard(cleanupGuard, error, 'upload.company-logo');
      },
    }),
  );
  res.status(outcome.statusCode).json({
    ok: true,
    storageKey: outcome.result.storageKey,
    url: outcome.result.url,
  });
}));

uploadRouter.post('/', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const tripId = parseInt(req.body.trip_id);
  const type = req.body.type as TripPhotoType;

  if (!file) return res.status(400).json({ error: 'Không có file tải lên' });
  if (isNaN(tripId)) return res.status(400).json({ error: 'trip_id không hợp lệ' });
  if (!['CONTAINER', 'SEAL', 'OTHER'].includes(type)) {
    return res.status(400).json({ error: 'Loại ảnh không hợp lệ' });
  }

  const user = getUser(req);
  const idempotencyKey = requireUploadIdempotencyKey(req);
  const prepared = await prepareTripPhoto(file, tripId, type, {
    storageKeySeed: `trip-photo:${user.userId}:${idempotencyKey}`,
  });
  const cleanupGuard = await acquireUploadCleanupGuard({
    endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO,
    idempotencyKey,
    dedupeKey: `trip-photo-orphan:${user.userId}:${hashStorageKey(prepared.storageKey)}:${idempotencyKey}`,
    storageKey: prepared.storageKey,
    entityType: 'trip_photos',
    entityId: tripId,
  });
  if (cleanupGuard) {
    try {
      await storageService.upload(prepared.buffer, prepared.storageKey);
    } catch (error) {
      await releaseUploadCleanupGuard(cleanupGuard, error, 'upload.trip-photo');
      throw error;
    }
  }
  const outcome = await withMaterialWriteAuditContext(
    req,
    res,
    IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO,
    () => runIdempotent({
      endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO,
      idempotencyKey,
      payload: { tripId, type, fileHash: hashUpload(file.buffer) },
      createdBy: user.userId,
      entityType: 'TRIP_PHOTO',
      responseStatusCode: 201,
      create: async (tx) => {
        if (!cleanupGuard) {
          throw new ApiError(409, 'Tệp đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
        }
        const cancelled = await cancelStorageCleanupGuard(tx, cleanupGuard);
        if (!cancelled) {
          throw new ApiError(409, 'Tệp đang được xử lý bởi yêu cầu khác. Vui lòng thử lại.');
        }
        if (tripPhotoAfterUploadHookForTest) {
          await tripPhotoAfterUploadHookForTest();
        }
        const id = await insertTripPhotoRecord(tx, {
          tripId,
          type,
          storageKey: prepared.storageKey,
          userId: user.userId,
        });
        return { id, storageKey: prepared.storageKey, url: prepared.url };
      },
      getEntityId: (value) => value.id,
      serializeResult: (value) => ({ storageKey: value.storageKey, url: value.url }),
      onTransactionRollback: async (error) => {
        await releaseUploadCleanupGuard(cleanupGuard, error, 'upload.trip-photo');
      },
    }),
  );

  res.status(outcome.statusCode).json({
    ok: true,
    storageKey: outcome.result.storageKey,
    url: outcome.result.url,
  });
}));

uploadRouter.post('/trips/:tripId/photos/:type/delete', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (isNaN(tripId)) return res.status(400).json({ error: 'trip_id không hợp lệ' });

  const photoType = String(req.params.type).toUpperCase();
  if (photoType !== 'CONTAINER' && photoType !== 'SEAL') {
    return res.status(400).json({ error: 'Loại ảnh không hợp lệ (container hoặc seal)' });
  }

  const storageKey = String(req.body?.storage_key ?? req.body?.storageKey ?? '');
  if (!storageKey || storageKey.includes('..')) {
    return res.status(400).json({ error: 'Đường dẫn ảnh không hợp lệ' });
  }
  if (!storageKey.startsWith(`trips/${tripId}/`)) {
    return res.status(400).json({ error: 'Ảnh không thuộc chuyến đi này' });
  }

  let containerId: number | undefined;
  const containerIdRaw = req.body?.container_id ?? req.body?.containerId;
  if (containerIdRaw !== undefined && containerIdRaw !== '') {
    containerId = parseInt(String(containerIdRaw), 10);
    if (isNaN(containerId)) return res.status(400).json({ error: 'container_id không hợp lệ' });
  }
  const user = getUser(req);
  const idempotencyKey = requireUploadIdempotencyKey(req);
  const { result } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.UPLOAD_TRIP_PHOTO_DELETE,
    idempotencyKey,
    payload: { tripId, photoType, storageKey, containerId: containerId ?? null },
    createdBy: user.userId,
    entityType: 'TRIP_PHOTO',
    create: async (tx) => {
      const [trip] = await tx.select({ id: s.trips.id, status: s.trips.status })
        .from(s.trips)
        .where(eq(s.trips.id, tripId))
        .limit(1);
      if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
      if (trip.status === 'COMPLETED') {
        throw new ApiError(409, 'Không thể xóa ảnh của chuyến đã hoàn thành');
      }

      if (containerId !== undefined) {
        const [container] = await tx.select({ id: s.tripContainers.id })
          .from(s.tripContainers)
          .where(and(eq(s.tripContainers.id, containerId), eq(s.tripContainers.tripId, tripId)))
          .limit(1);
        if (!container) throw new ApiError(404, 'Không tìm thấy số cont');
      }

      const buildConditions = (withContainer: boolean) => {
        const conditions = [
          eq(s.tripPhotos.tripId, tripId),
          eq(s.tripPhotos.type, photoType as TripPhotoType),
          eq(s.tripPhotos.storageKey, storageKey),
        ];
        if (withContainer && containerId !== undefined) {
          conditions.push(eq(s.tripPhotos.tripContainerId, containerId));
        }
        return conditions;
      };

      let [locked] = await tx.select({
        id: s.tripPhotos.id,
        storageKey: s.tripPhotos.storageKey,
      })
        .from(s.tripPhotos)
        .where(and(...buildConditions(true)))
        .limit(1)
        .for('update');
      if (!locked && containerId !== undefined) {
        [locked] = await tx.select({
          id: s.tripPhotos.id,
          storageKey: s.tripPhotos.storageKey,
        })
          .from(s.tripPhotos)
          .where(and(...buildConditions(false)))
          .limit(1)
          .for('update');
      }
      if (!locked) {
        throw new ApiError(409, 'Ảnh đã được xóa hoặc không còn tồn tại.');
      }
      await enqueueTripPhotoFinalDelete(tx, locked.id, locked.storageKey, 'trip-photo-final');
      await tx.delete(s.tripPhotos).where(eq(s.tripPhotos.id, locked.id));
      return { ok: true as const, id: locked.id, removed: 1, storageKey: locked.storageKey };
    },
    getEntityId: (value) => value.id,
    serializeResult: (value) => ({ ok: value.ok, removed: value.removed, storageKey: value.storageKey }),
  });
  res.json({ ok: result.ok, removed: result.removed });
}));

// Authenticated Photos serving Router
const photosRouter = Router();

export function isCompanyLogoStorageKey(key: string): boolean {
  return /^company-assets\/logo-[^/]+\.png$/.test(key);
}

export function isProtectedPhotoStorageKey(key: string): boolean {
  return /^trips\/\d+\//.test(key)
    || /^expense-photos\/\d+\//.test(key)
    || /^fuel-evidence\/\d+\/\d+\//.test(key)
    || /^debit-note-templates\/\d+\//.test(key)
    || isCompanyLogoStorageKey(key);
}

photosRouter.get('/{*path}', asyncHandler(async (req: Request, res: Response) => {
  // Express types `{*path}` params as string | string[]; collapse to a single path.
  const rawKey = Array.isArray(req.params.path) ? req.params.path.join('/') : (req.params.path ?? '');
  const key = decodeURIComponent(rawKey);

  // Defense-in-depth: no storage key ever contains a path segment; reject
  // traversal attempts up front (the resolved-path guard below also covers it).
  if (key.includes('..')) {
    return res.status(400).json({ error: 'Đường dẫn ảnh không hợp lệ' });
  }

  // Valid key shapes: trip photos, expense/fuel evidence photos, debit-note
  // template logos, and the own-company logo. Trip photos get a driver
  // ownership check; financial evidence delegates to exact-key authz below.
  const tripMatch = key.match(/^trips\/(\d+)\//);
  const expenseMatch = key.match(/^expense-photos\/(\d+)\//);
  const fuelEvidenceMatch = key.match(/^fuel-evidence\/(\d+)\/(\d+)\//);
  const templateLogoMatch = key.match(/^debit-note-templates\/(\d+)\//);
  if (!isProtectedPhotoStorageKey(key)) {
    return res.status(400).json({ error: 'Đường dẫn ảnh không hợp lệ' });
  }

  if (tripMatch) {
    const tripId = parseInt(tripMatch[1]);

    // Check permissions
    if (getUser(req).role === Role.DRIVER) {
      const [driver] = await db.select({ id: s.drivers.id }).from(s.drivers)
        .where(eq(s.drivers.userId, getUser(req).userId)).limit(1);

      if (!driver) {
        return res.status(403).json({ error: 'Không có quyền truy cập ảnh này' });
      }

      const [trip] = await db.select()
        .from(s.trips)
        .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driver.id)))
        .limit(1);

      if (!trip) {
        return res.status(403).json({ error: 'Không có quyền truy cập ảnh của chuyến đi này' });
      }
    }
  } else if (expenseMatch || fuelEvidenceMatch) {
    // Expense receipt photos are financial evidence. The `expense-photos/<id>/`
    // prefix is SHARED by two pipelines (company receipts → expense_photos, and
    // forwarder receipts → trip_expense_photos), so <id> alone is ambiguous.
    // Delegate to authorizeExpensePhoto, which resolves the domain by EXACT
    // storage_key and applies strictest-match (ADR 0042). Replaces the prior
    // inline block (N2) so the full decision matrix — incl. collision detection
    // and a clean not_found → 404 — lives in one pure, tested function.
    const user = getUser(req);
    const decision = await authorizeExpensePhoto(key, user);

    if (decision.reason === 'not_found') {
      return res.status(404).json({ error: 'Không tìm thấy ảnh' });
    }
    if (decision.reason === 'collision') {
      // Both tables hold this key and the caller isn't authorized under both.
      // A full-key collision is a write-path integrity signal (near-impossible
      // given keys embed Date.now()+ext), not normal traffic — surface it (N6)
      // rather than silently 403.
      console.warn(`[photos] storage_key collision denied: key=${key} role=${user.role} userId=${user.userId}`);
      return res.status(403).json({ error: 'Không có quyền truy cập ảnh chi phí' });
    }
    if (!decision.allow) {
      // forbidden — includes DRIVER (drivers never read expense receipts),
      // unowned forwarder keys, and company-only receipts requested by non-finance.
      return res.status(403).json({ error: 'Không có quyền truy cập ảnh chi phí' });
    }
    // allow → fall through to serve (MANAGER/ACCOUNTANT/ADMIN, or an ACTIVE
    // forwarder reading an own-owned trip-expense receipt).
  } else if (templateLogoMatch) {
    // Debit-note template logos are config artifacts (company letterheads), not
    // financial evidence. Readable by office staff only (ADMIN/MANAGER/ACCOUNTANT);
    // DRIVER/FORWARDER never see debit-note templates.
    const role = getUser(req).role;
    if (role !== Role.ADMIN && role !== Role.MANAGER && role !== Role.ACCOUNTANT) {
      return res.status(403).json({ error: 'Không có quyền truy cập ảnh này' });
    }
  }

  const uploadDir = path.resolve(config.uploadDir || path.join(process.cwd(), 'uploads'));
  const filePath = path.resolve(uploadDir, key);

  // Path traversal guard: resolved path must stay within uploadDir
  if (!filePath.startsWith(uploadDir + path.sep)) {
    return res.status(400).json({ error: 'Đường dẫn ảnh không hợp lệ' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  }

  res.sendFile(filePath);
}));

export { uploadRouter, photosRouter };
