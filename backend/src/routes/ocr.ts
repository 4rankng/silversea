import { Router } from 'express';
import { createHash } from 'node:crypto';
import multer from 'multer';
import type { Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { sniffImageType } from '../lib/format';
import { saveTripPhoto } from './upload';
import { extractContainerAndSeal, extractPumpReading } from '../services/ocr.service';
import { ApiError } from '../errors';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { runIdempotent } from '../services/idempotency.service';

// auth + Casbin ('ocr') applied at mount point in index.ts. Both routes below
// inherit casbinAuthz('ocr') from that single mount — no per-route policy.
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
});

/** Subset of AuthUser that the persist helper needs. */
interface OcrUser {
  userId: number;
  role: Role;
}

/** Inputs to persistOcrPhoto. `tripId` is required — persist always links a trip. */
interface PersistOcrInput {
  file: { buffer: Buffer };
  type: 'CONTAINER' | 'SEAL';
  tripId: number;
  /** Optional container row to link the photo to (must belong to `tripId`). */
  containerId: number | null;
  user: OcrUser;
  storageKeySeed?: string;
}

/** The persisted photo plus the processed buffer callers may recognize on. */
export interface PersistedOcrPhoto {
  photoUrl: string;
  storageKey: string;
  buffer: Buffer;
  mimeType: string;
}

/**
 * Parse an optional integer id from multipart body. Empty/absent → null; a
 * non-numeric value → ApiError(400) so the caller gets a clean validation error
 * rather than a NaN flowing into a DB query.
 */
function parseIdParam(raw: unknown, label: string): number | null {
  if (raw === undefined || raw === '') return null;
  const n = parseInt(String(raw), 10);
  if (isNaN(n)) throw new ApiError(400, `${label} không hợp lệ`);
  return n;
}

/**
 * Shared persist + link prefix for OCR photos. Performs DRIVER trip-ownership
 * (mirrors photosRouter) and container-belongs-to-trip validation, then saves
 * the photo via the OCR pipeline (`forOcr: true` → q95 normalised JPEG) and
 * returns the processed buffer so the caller may run recognition on it.
 *
 * Throws `ApiError` on authz/validation failure → `asyncHandler` forwards to
 * `globalErrorHandler`, which maps it to an HTTP response wire-identical to the
 * previous inline `res.status(...).json(...)` calls.
 *
 * Used by BOTH OCR routes:
 *   - `POST /`            (capture): persist, THEN recognize via
 *     `extractContainerAndSeal`.
 *   - `POST /persist-only` (flush): persist ONLY — recognition already happened
 *     at capture, so the flush must NOT call Gemini again.
 *
 * Exported so the service-layer test (`ocr-persist.test.ts`) can exercise the
 * ownership + container-link + persist logic directly, in the repo's
 * `photo-authz.test.ts` idiom (no HTTP/supertest harness needed).
 */
export async function persistOcrPhoto({
  file,
  type,
  tripId,
  containerId,
  user,
  storageKeySeed,
}: PersistOcrInput): Promise<PersistedOcrPhoto> {
  if (type !== 'CONTAINER' && type !== 'SEAL') {
    throw new ApiError(400, 'Loại ảnh không hợp lệ (CONTAINER hoặc SEAL)');
  }

  // DRIVER may only attach photos to trips they own (mirrors photosRouter).
  if (user.role === Role.DRIVER) {
    const [driver] = await db.select({ id: s.drivers.id }).from(s.drivers)
      .where(eq(s.drivers.userId, user.userId)).limit(1);
    if (!driver) throw new ApiError(403, 'Không có quyền truy cập');

    const [trip] = await db.select().from(s.trips)
      .where(and(eq(s.trips.id, tripId), eq(s.trips.driverId, driver.id)))
      .limit(1);
    if (!trip) throw new ApiError(403, 'Không có quyền quét ảnh của chuyến này');
  }

  // Optional container_id → link to a specific container row (must belong to trip).
  if (containerId !== null) {
    const [container] = await db.select({ tripId: s.tripContainers.tripId })
      .from(s.tripContainers)
      .where(eq(s.tripContainers.id, containerId))
      .limit(1);
    if (!container || container.tripId !== tripId) {
      throw new ApiError(400, 'Container không thuộc chuyến này');
    }
  }

  const saved = await saveTripPhoto(file, tripId, type, user.userId, {
    forOcr: true,
    containerId,
    storageKeySeed,
  });
  return {
    photoUrl: saved.url,
    storageKey: saved.storageKey,
    buffer: saved.buffer,
    mimeType: saved.mimeType,
  };
}

/**
 * POST /api/ocr — recognize container & seal numbers from a photo (capture path).
 *
 * Body (multipart): file (image), type ∈ {CONTAINER, SEAL}, optional trip_id,
 * optional container_id.
 *
 * - With trip_id (Edit): DRIVER ownership is enforced, the photo is persisted
 *   (OCR pipeline) and `photoUrl`/`storageKey` are returned.
 * - Without trip_id (Create preview): OCR only, nothing is persisted.
 *
 * Numbers are NEVER auto-committed here (spec Decision 1) — the caller must save
 * them through the existing container flow after visual confirmation.
 */
router.post('/', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const type = req.body.type as 'CONTAINER' | 'SEAL';

  if (!file) throw new ApiError(400, 'Không có file tải lên');
  if (type !== 'CONTAINER' && type !== 'SEAL') {
    throw new ApiError(400, 'Loại ảnh không hợp lệ (CONTAINER hoặc SEAL)');
  }

  const user = getUser(req);
  const tripId = parseIdParam(req.body.trip_id, 'trip_id');
  const containerId = parseIdParam(req.body.container_id, 'container_id');
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc khi xử lý ảnh OCR.');
  }

  // container_id only makes sense with a trip to link it to.
  if (containerId !== null && tripId === null) {
    throw new ApiError(400, 'container_id yêu cầu trip_id');
  }

  const fileHash = createHash('sha256').update(file.buffer).digest('hex');
  const { result: response } = await runIdempotent({
    endpoint: 'ocr.capture',
    idempotencyKey,
    payload: { type, tripId, containerId, fileHash },
    createdBy: user.userId,
    entityType: tripId === null ? 'OCR_PREVIEW' : 'TRIP_PHOTO',
    create: async () => {
      let photoUrl: string | undefined;
      let storageKey: string | undefined;
      let ocrBuffer = file.buffer;
      let ocrMime = sniffImageType(file.buffer) ?? 'image/jpeg';

      if (tripId !== null) {
        const saved = await persistOcrPhoto({
          file,
          type,
          tripId,
          containerId,
          user,
          storageKeySeed: `ocr-capture:${user.userId}:${idempotencyKey}`,
        });
        photoUrl = saved.photoUrl;
        storageKey = saved.storageKey;
        ocrBuffer = saved.buffer;
        ocrMime = saved.mimeType;
      }

      const result = await extractContainerAndSeal(ocrBuffer, type, ocrMime);
      return {
        ok: result.success,
        containerNumbers: result.containerNumbers,
        sealNumber: result.sealNumber,
        checkDigitWarnings: result.checkDigitWarnings,
        photoUrl,
        storageKey,
        model: result.model,
        error: result.error,
      };
    },
  });
  res.status(200).json(response);
}));

/**
 * POST /api/ocr/pump — recognize litres × unit_price ≈ total from a fuel-pump
 * display photo (M12.3).
 *
 * Body (multipart): file (image of fuel pump display).
 *
 * Returns a SUGGESTION — the caller (expense entry) must let the user confirm
 * or edit before committing. When litres × unitPrice deviates from total beyond
 * 5%, `mismatch: true` warns the caller to fall back to manual entry.
 */
router.post('/pump', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new ApiError(400, 'Không có file tải lên');

  const mimeType = sniffImageType(file.buffer) ?? 'image/jpeg';
  const result = await extractPumpReading(file.buffer, mimeType);

  res.status(200).json({
    ok: result.success,
    litres: result.litres,
    unitPrice: result.unitPrice,
    total: result.total,
    mismatch: result.mismatch,
    computedTotal: result.computedTotal,
    model: result.model,
    error: result.error,
  });
}));

/**
 * POST /api/ocr/persist-only — persist + link a container/seal photo WITHOUT
 * re-running recognition (the flush path).
 *
 * The create-mode flow already recognized the number at capture (`POST /api/ocr`);
 * after `saveContainers` assigns ids, the buffered photo only needs to be
 * persisted + linked to its container. Re-running Gemini here was pure waste —
 * one redundant VLM call per buffered container/seal photo.
 *
 * This handler STRUCTURALLY cannot recognize: there is no reference to
 * `extractContainerAndSeal` anywhere in it. That is deliberate — capture and
 * flush send wire-identical multipart bodies (`{file, type, trip_id,
 * container_id}`), so a `persist_only` flag on `POST /` would be a silent-
 * suppression footgun (a leaked flag would disable recognition with no error).
 * A dedicated route makes the intent unambiguous: the route IS the contract.
 *
 * Inherits `casbinAuthz('ocr')` from the mount at `index.ts` — no new Casbin
 * policy row, no new mount line. Requires `trip_id` (the photo must link to a
 * trip); `container_id` is optional (validated if present).
 */
router.post('/persist-only', upload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  const type = req.body.type as 'CONTAINER' | 'SEAL';

  if (!file) throw new ApiError(400, 'Không có file tải lên');

  const user = getUser(req);
  const tripId = parseIdParam(req.body.trip_id, 'trip_id');
  if (tripId === null) throw new ApiError(400, 'trip_id là bắt buộc');
  const containerId = parseIdParam(req.body.container_id, 'container_id');
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc khi lưu ảnh OCR.');
  }
  const fileHash = createHash('sha256').update(file.buffer).digest('hex');
  const { result: saved, replayed } = await runIdempotent({
    endpoint: 'ocr.persist-only',
    idempotencyKey,
    payload: { type, tripId, containerId, fileHash },
    createdBy: user.userId,
    entityType: 'TRIP_PHOTO',
    create: async () => {
      const persisted = await persistOcrPhoto({
        file,
        type,
        tripId,
        containerId,
        user,
        storageKeySeed: `ocr-persist-only:${user.userId}:${idempotencyKey}`,
      });
      return { photoUrl: persisted.photoUrl, storageKey: persisted.storageKey };
    },
  });

  if (replayed) {
    console.log(
      `[ocr] persist-only-replay, no work repeated (tripId=${tripId}, containerId=${containerId ?? '-'})`,
    );
  } else {
    // Distinct, greppable log line: `grep persist-only-flush` must yield ONLY
    // intentional first executions. Exact replays use the separate marker above.
    console.log(
      `[ocr] persist-only-flush, recognition skipped (tripId=${tripId}, containerId=${containerId ?? '-'})`,
    );
  }

  res.status(200).json({
    ok: true,
    photoUrl: saved.photoUrl,
    storageKey: saved.storageKey,
  });
}));

export default router;
