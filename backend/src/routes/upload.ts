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

// Maximum dimension for server-side downscale
const MAX_IMAGE_DIMENSION = 2048;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

export type TripPhotoType = 'CONTAINER' | 'SEAL' | 'OTHER';

export interface SaveTripPhotoOptions {
  /** Use the OCR-optimised pipeline (auto-contrast + JPEG q95) instead of the
   * default q85 pipeline. The processed buffer is returned so the OCR route can
   * reuse it for recognition instead of re-running sharp. */
  forOcr?: boolean;
  /** Phase 2: optional container row to link this photo to. The container
   *  must belong to `tripId`. Null/undefined leaves the photo at trip level
   *  (legacy behaviour), which is also the fallback for older callers. */
  containerId?: number | null;
}

export interface SavedTripPhoto {
  storageKey: string;
  url: string;
  buffer: Buffer;
  mimeType: string;
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
export async function saveTripPhoto(
  file: { buffer: Buffer },
  tripId: number,
  type: TripPhotoType,
  userId: number,
  opts: SaveTripPhotoOptions = {},
): Promise<SavedTripPhoto> {
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

  const uuid = crypto.randomUUID();
  const key = `trips/${tripId}/${type.toLowerCase()}-${uuid}${ext}`;

  await storageService.upload(processedBuffer, key);
  await db.insert(s.tripPhotos).values({
    tripId,
    type,
    storageKey: key,
    uploadedBy: userId,
    // Phase 2: link to a specific container when provided. Caller is
    // responsible for ownership validation; we only set the FK if present.
    tripContainerId: opts.containerId ?? null,
  });

  return {
    storageKey: key,
    url: `/api/photos/${encodeURIComponent(key)}`,
    buffer: processedBuffer,
    mimeType: opts.forOcr ? 'image/jpeg' : mime,
  };
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
  // Capture the row ids up front and scope BOTH the file delete and the row
  // delete to this exact snapshot. A row inserted concurrently (e.g. a capture
  // landing mid-operation) is in neither `rows` nor `ids`, so it survives — its
  // file is not orphaned on disk and the driver's fresh upload is not silently
  // wiped. Scoping the DELETE to ids (rather than tripId+type) also makes the
  // returned count match what was actually removed.
  const conditions = [eq(s.tripPhotos.tripId, tripId), eq(s.tripPhotos.type, type)];
  if (containerId !== undefined) {
    conditions.push(eq(s.tripPhotos.tripContainerId, containerId));
  }
  const rows = await db.select({ id: s.tripPhotos.id, storageKey: s.tripPhotos.storageKey })
    .from(s.tripPhotos)
    .where(and(...conditions));

  // Best-effort file deletion: never let one bad file abort the row delete.
  await Promise.all(rows.map(row =>
    storageService.delete(row.storageKey).catch(err => {
      console.warn(
        `[deleteTripPhotosByType] failed to delete ${row.storageKey}:`,
        err instanceof Error ? err.message : err,
      );
    }),
  ));

  const ids = rows.map(r => r.id);
  if (ids.length > 0) {
    await db.delete(s.tripPhotos)
      .where(inArray(s.tripPhotos.id, ids));
  }

  return ids.length;
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

  let [row] = await db.select({ id: s.tripPhotos.id, storageKey: s.tripPhotos.storageKey })
    .from(s.tripPhotos)
    .where(and(...buildConditions(true)))
    .limit(1);
  // A container scope was requested but matched nothing: the photo may be a
  // legacy/unscoped row (tripContainerId IS NULL — `NULL = <id>` is never true
  // in SQL). Retry without the container filter so those photos are deletable
  // instead of a silent 0-removal the UI would report as success. The match is
  // still bound to (tripId, type, storageKey), and storageKey already encodes
  // `trips/${tripId}/…` (route-validated), so no cross-trip leak.
  if (!row && containerId !== undefined) {
    [row] = await db.select({ id: s.tripPhotos.id, storageKey: s.tripPhotos.storageKey })
      .from(s.tripPhotos)
      .where(and(...buildConditions(false)))
      .limit(1);
  }
  if (!row) return 0;

  await storageService.delete(row.storageKey).catch(err => {
    console.warn(
      `[deleteTripPhotoByStorageKey] failed to delete ${row.storageKey}:`,
      err instanceof Error ? err.message : err,
    );
  });
  await db.delete(s.tripPhotos).where(eq(s.tripPhotos.id, row.id));
  return 1;
}

const uploadRouter = Router();

/**
 * Save the company logo. Stored under a dedicated `company-assets/` prefix
 * (no DB row — the storage key lives in app_settings as company.logo_storage_key),
 * normalized to PNG so ExcelJS can embed it into the xlsx (webp isn't supported
 * by addImage). PUT /api/config/company-info persists the returned storageKey.
 */
export async function saveCompanyLogo(
  file: { buffer: Buffer },
): Promise<{ storageKey: string; url: string }> {
  const mime = sniffImageType(file.buffer);
  if (!mime) {
    throw new ApiError(400, 'Định dạng file không được hỗ trợ hoặc file bị hỏng');
  }
  const processedBuffer = await sharp(file.buffer)
    .rotate()
    .resize(640, 320, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const uuid = crypto.randomUUID();
  const key = `company-assets/logo-${uuid}.png`;
  await storageService.upload(processedBuffer, key);
  return { storageKey: key, url: `/api/photos/${encodeURIComponent(key)}` };
}

// Company logo upload. Mirrors the config router role gate (config.ts): DRIVER
// and FORWARDER cannot set the company identity. The storage key is persisted
// to app_settings via PUT /api/config/company-info.
uploadRouter.post('/company-logo', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const role = getUser(req).role;
  if (role === Role.DRIVER || role === Role.FORWARDER) {
    return res.status(403).json({ error: 'Không có quyền tải logo công ty' });
  }
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Không có file tải lên' });
  const saved = await saveCompanyLogo(file);
  res.status(201).json({ ok: true, storageKey: saved.storageKey, url: saved.url });
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

  const saved = await saveTripPhoto(file, tripId, type, getUser(req).userId);

  res.status(201).json({
    ok: true,
    storageKey: saved.storageKey,
    url: saved.url,
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

  const [trip] = await db.select({ id: s.trips.id, status: s.trips.status })
    .from(s.trips)
    .where(eq(s.trips.id, tripId))
    .limit(1);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  if (trip.status === 'LOCKED') {
    throw new ApiError(409, 'Không thể xóa ảnh của chuyến đã chốt');
  }

  if (containerId !== undefined) {
    const [container] = await db.select({ id: s.tripContainers.id })
      .from(s.tripContainers)
      .where(and(eq(s.tripContainers.id, containerId), eq(s.tripContainers.tripId, tripId)))
      .limit(1);
    if (!container) return res.status(404).json({ error: 'Không tìm thấy số cont' });
  }

  const removed = await deleteTripPhotoByStorageKey(tripId, photoType as TripPhotoType, storageKey, containerId);
  res.json({ ok: true, removed });
}));

// Authenticated Photos serving Router
const photosRouter = Router();

export function isCompanyLogoStorageKey(key: string): boolean {
  return /^company-assets\/logo-[^/]+\.png$/.test(key);
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

  // Valid key shapes: trip photos, expense receipt photos, debit-note template
  // logos, and the own-company logo. Trip photos get a driver ownership check;
  // receipt photos delegate to strict storage-key authz below.
  const tripMatch = key.match(/^trips\/(\d+)\//);
  const expenseMatch = key.match(/^expense-photos\/(\d+)\//);
  const templateLogoMatch = key.match(/^debit-note-templates\/(\d+)\//);
  const companyLogoMatch = isCompanyLogoStorageKey(key);
  if (!tripMatch && !expenseMatch && !templateLogoMatch && !companyLogoMatch) {
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
  } else if (expenseMatch) {
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
