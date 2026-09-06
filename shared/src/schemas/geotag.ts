import { z } from 'zod';

/**
 * Event-driven mobile GPS geotagging (Phase 1 — foundation).
 *
 * Captures an accurate phone GPS fix at the moment a portal user submits a
 * photo (container/seal, port receipt, fuel pump, …) so the photo's claimed
 * location is provable for anti-fraud + compliance. The phone-GPS capture
 * uses navigator.geolocation directly from the portal client.
 *
 * The capture layer (warm-fix watchPosition) lives in the frontend; this file
 * is the shared wire contract consumed by the backend route + service.
 *
 * Requirements traceability:
 *   - M12-03-03: "Thiếu vị trí, ảnh mờ … phải cảnh báo" → accuracy + source
 *     recorded; freshness gate rejects stale/future fixes.
 *   - M0X-HT-04 (idempotency): one geotag per (entityType, entityId) → upsert.
 *   - M0X-HT-03 (audit log): recordedBy + createdAt + diagnostic fields.
 */

/** The photo-bearing entities a geotag can attach to. */
export const GEOTAG_ENTITY_TYPES = [
  'trip_photo',          // driver container/seal photo (M8.5)
  'trip_expense_photo',  // forwarder port-receipt photo (M9.5)
  'expense_photo',       // company expense receipt (fuel pump M12.3 / office)
] as const;
export type GeotagEntityType = typeof GEOTAG_ENTITY_TYPES[number];

/** Where the fix came from — distinguishes a live phone capture from a manual entry. */
export const GEOTAG_SOURCES = ['phone', 'exif', 'manual'] as const;
export type GeotagSource = typeof GEOTAG_SOURCES[number];

/**
 * Submit payload for POST /api/geotag.
 *
 * `gpsAt` is the device fix timestamp (epoch ms) — used server-side as an
 * anti-replay freshness gate (>300s stale or >60s future → 422). Optional so a
 * manual/office entry without a device fix still validates.
 *
 * The diagnostic fields (sampleCount / bestAccuracy / elapsedMs) are captured
 * by the warm-fix hook and stored for triage; they do not gate acceptance.
 */
export const geotagSchema = z.object({
  entityType: z.enum(GEOTAG_ENTITY_TYPES),
  entityId: z.coerce.number().int().positive('ID chứng từ không hợp lệ'),
  lat: z.number().min(-90, 'Vĩ độ không hợp lệ').max(90, 'Vĩ độ không hợp lệ'),
  lng: z.number().min(-180, 'Kinh độ không hợp lệ').max(180, 'Kinh độ không hợp lệ'),
  accuracy: z.number().min(0).optional(),
  altitude: z.number().optional(),
  gpsAt: z.number().int().nonnegative().optional(),
  source: z.enum(GEOTAG_SOURCES).optional().default('phone'),
  sampleCount: z.number().int().nonnegative().optional(),
  bestAccuracy: z.number().min(0).optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

export type GeotagInput = z.infer<typeof geotagSchema>;

/** Read shape returned by the API (DB row minus internal columns). */
export interface PhotoGeotag {
  id: number;
  entityType: GeotagEntityType;
  entityId: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  altitude: number | null;
  gpsAt: string | null;        // ISO timestamp
  source: GeotagSource;
  sampleCount: number | null;
  bestAccuracy: number | null;
  elapsedMs: number | null;
  recordedBy: number;
  createdAt: string;           // ISO timestamp
}

export const GEOTAG_PATHS = {
  SUBMIT: '/geotag',
  GET: (entityType: GeotagEntityType, entityId: number) => `/geotag/${entityType}/${entityId}`,
} as const;
